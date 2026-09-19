"""Black-Scholes pricer + realized-vol IV estimate. Pure functions, no OpenD.

Used by the backtest to reconstruct option prices from underlying price history
(no free historical option chain exists). IV is estimated from realized vol, which
keeps collected credit conservative (real IV usually exceeds RV).
"""
import datetime as dt
import math

SQRT252 = math.sqrt(252.0)


def norm_cdf(x: float) -> float:
    """Standard normal CDF via erf (no scipy dependency)."""
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1_d2(S, K, T, r, sigma):
    v = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / v
    return d1, d1 - v


def bs_price(S: float, K: float, T: float, r: float, sigma: float, opt: str) -> float:
    """Black-Scholes price. T in years. opt = 'call' | 'put'. T<=0 or sigma<=0 -> intrinsic."""
    opt = opt.lower()
    if T <= 0 or sigma <= 0:
        return max(S - K, 0.0) if opt == "call" else max(K - S, 0.0)
    d1, d2 = _d1_d2(S, K, T, r, sigma)
    disc = math.exp(-r * T)
    if opt == "call":
        return S * norm_cdf(d1) - K * disc * norm_cdf(d2)
    return K * disc * norm_cdf(-d2) - S * norm_cdf(-d1)


def bs_delta(S: float, K: float, T: float, r: float, sigma: float, opt: str) -> float:
    """Option delta. Call in [0,1], put in [-1,0]."""
    opt = opt.lower()
    if T <= 0 or sigma <= 0:
        if opt == "call":
            return 1.0 if S > K else 0.0
        return -1.0 if S < K else 0.0
    d1, _ = _d1_d2(S, K, T, r, sigma)
    return norm_cdf(d1) if opt == "call" else norm_cdf(d1) - 1.0


def estimate_iv(closes, window: int = 20, factor: float = 1.15) -> float:
    """Annualized realized vol of the last `window` log returns, scaled by `factor`.

    Returns 0.0 if there is not enough data. factor approximates the IV premium over RV.
    """
    if closes is None or len(closes) < 2:
        return 0.0
    seg = list(closes)[-(window + 1):]
    rets = [math.log(seg[i] / seg[i - 1]) for i in range(1, len(seg))]
    n = len(rets)
    if n < 2:
        return 0.0
    mean = sum(rets) / n
    var = sum((x - mean) ** 2 for x in rets) / (n - 1)  # sample std, ddof=1
    return math.sqrt(var) * SQRT252 * factor


def strike_for_delta(S, T, r, sigma, target_delta: float, opt: str, step: float = 1.0):
    """Grid-search the OTM strike whose |delta| is closest to target_delta.

    put  -> strikes at/below spot; call -> strikes at/above spot.
    """
    opt = opt.lower()
    target = abs(target_delta)
    lo, hi = S * 0.5, S * 1.5
    k = math.floor(lo / step) * step
    best_k, best_err = None, float("inf")
    while k <= hi:
        if k > 0 and ((opt == "put" and k <= S) or (opt == "call" and k >= S)):
            err = abs(abs(bs_delta(S, k, T, r, sigma, opt)) - target)
            if err < best_err:
                best_err, best_k = err, k
        k += step
    return best_k


def spread_value(spot: float, short_strike: float, long_strike: float,
                 T: float, r: float, sigma: float, direction: str) -> float:
    """Cost per share to close a credit spread right now. Always in [0, width].

    This is the honest mark: at T>0 an out-of-the-money spread still costs
    something to buy back, because the short leg has time value left. Pricing it
    at expiration intrinsic instead (the old behaviour) reports the whole credit
    as profit while the trade is still live.

    direction: "SELL_PUT" (bull put) or "SELL_CALL" (bear call).
    """
    opt = "put" if direction == "SELL_PUT" else "call"
    short_leg = bs_price(spot, short_strike, T, r, sigma, opt)
    long_leg = bs_price(spot, long_strike, T, r, sigma, opt)
    width = abs(short_strike - long_strike)
    return min(max(short_leg - long_leg, 0.0), width)


def years_to_expiry(expiry: str, today: dt.date) -> float:
    """Calendar days from `today` to ISO date `expiry`, in years. Floored at 0."""
    exp = dt.date.fromisoformat(expiry)
    return max((exp - today).days, 0) / 365.0
