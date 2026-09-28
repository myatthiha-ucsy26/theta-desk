"""Credit-spread signal core: indicators, signal verdicts, strike builder.

PURE functions — no OpenD, no Black-Scholes imports. Shared by the backtest and the
(future) live dashboard so the validated logic is exactly the traded logic.

Indicators take plain lists of prices. Verdicts take an `ind` dict (see build via
indicators()). Strike builder takes a list of candidate `legs` (built from BS in the
backtest, from live snapshots in the dashboard) so it stays free of any pricer.
"""
import math
import statistics

SELL_PUT = "SELL_PUT"
SELL_CALL = "SELL_CALL"
NO_TRADE = "NO_TRADE"


# ---------------- indicators ----------------
def rsi(closes, period: int = 14) -> float:
    """Sum-ratio RSI over the last `period` diffs (matches existing scan scripts)."""
    if len(closes) < 2:
        return 50.0
    diffs = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    seg = diffs[-period:]
    up = sum(d for d in seg if d > 0)
    dn = -sum(d for d in seg if d < 0)
    if dn == 0:
        return 100.0
    if up == 0:
        return 0.0
    rs = up / dn
    return 100.0 - 100.0 / (1.0 + rs)


def ema(values, period: int) -> float:
    """Last EMA value, seeded with the SMA of the first `period` points."""
    if not values:
        return None
    if len(values) <= period:
        return sum(values) / len(values)
    alpha = 2.0 / (period + 1)
    e = sum(values[:period]) / period
    for v in values[period:]:
        e = alpha * v + (1 - alpha) * e
    return e


def bollinger_pctb(closes, period: int = 20, mult: float = 2.0) -> float:
    """%B = (price - lower) / (upper - lower), bands = SMA +/- mult*population-std."""
    seg = closes[-period:]
    m = sum(seg) / len(seg)
    sd = statistics.pstdev(seg)
    upper, lower = m + mult * sd, m - mult * sd
    if upper == lower:
        return 0.5
    return (closes[-1] - lower) / (upper - lower)


def _wilder(vals, period):
    """Wilder running sum: seed = sum(first period), then s = s - s/period + v."""
    if len(vals) < period:
        return []
    s = sum(vals[:period])
    out = [s]
    for v in vals[period:]:
        s = s - s / period + v
        out.append(s)
    return out


def adx(highs, lows, closes, period: int = 14) -> float:
    n = len(highs)
    if n < period + 1:
        return 0.0
    trs, plus_dm, minus_dm = [], [], []
    for i in range(1, n):
        up_move = highs[i] - highs[i - 1]
        dn_move = lows[i - 1] - lows[i]
        plus_dm.append(up_move if (up_move > dn_move and up_move > 0) else 0.0)
        minus_dm.append(dn_move if (dn_move > up_move and dn_move > 0) else 0.0)
        trs.append(max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
                       abs(lows[i] - closes[i - 1])))
    str_, sp, sm = _wilder(trs, period), _wilder(plus_dm, period), _wilder(minus_dm, period)
    if not str_:
        return 0.0
    dxs = []
    for tr, p, m in zip(str_, sp, sm):
        if tr == 0:
            dxs.append(0.0)
            continue
        pdi, mdi = 100 * p / tr, 100 * m / tr
        denom = pdi + mdi
        dxs.append(100 * abs(pdi - mdi) / denom if denom else 0.0)
    if len(dxs) < period:
        return dxs[-1] if dxs else 0.0
    a = sum(dxs[:period]) / period
    for dx in dxs[period:]:
        a = (a * (period - 1) + dx) / period
    return a


def atr(highs, lows, closes, period: int = 14) -> float:
    trs = [max(highs[i] - lows[i], abs(highs[i] - closes[i - 1]),
               abs(lows[i] - closes[i - 1])) for i in range(1, len(closes))]
    if not trs:
        return 0.0
    if len(trs) < period:
        return sum(trs) / len(trs)
    a = sum(trs[:period]) / period
    for tr in trs[period:]:
        a = (a * (period - 1) + tr) / period
    return a


def expected_move(spot: float, iv: float, dte_days: float) -> float:
    """1 SD expected move over dte_days: spot * iv * sqrt(dte/365)."""
    return spot * iv * math.sqrt(dte_days / 365.0)


def build_indicators(highs, lows, closes, iv, rv, iv_rank=None, lookback: int = 5):
    """Assemble the `ind` dict consumed by verdict(). Shared by backtest and live so the
    signal inputs never drift between them."""
    return {
        "rsi": rsi(closes, 14),
        "pctb": bollinger_pctb(closes, 20, 2.0),
        "adx": adx(highs, lows, closes, 14),
        "ema20": ema(closes, 20),
        "ema50": ema(closes, 50),
        "close": closes[-1], "prev_close": closes[-2],
        "is_lower_low": lows[-1] < min(lows[-1 - lookback:-1]),
        "is_higher_high": highs[-1] > max(highs[-1 - lookback:-1]),
        "iv": iv, "rv": rv, "iv_rank": iv_rank,
    }


# ---------------- signal verdicts ----------------
def _meanrev(ind):
    rsi_v, pctb, adx_v = ind["rsi"], ind["pctb"], ind["adx"]
    close, prev = ind["close"], ind["prev_close"]
    oversold = rsi_v < 35 or pctb < 0.10
    overbought = rsi_v > 65 or pctb > 0.90
    if oversold:
        if ind.get("is_lower_low") and adx_v > 25:
            return NO_TRADE, "oversold but falling knife (new low + strong down ADX)"
        if close > prev:
            return SELL_PUT, "oversold + stabilizing (green candle)"
        return NO_TRADE, "oversold but not stabilizing"
    if overbought:
        if ind.get("is_higher_high") and adx_v > 25:
            return NO_TRADE, "overbought but parabolic (new high + strong ADX)"
        if close < prev:
            return SELL_CALL, "overbought + rejection (red candle)"
        return NO_TRADE, "overbought but no rejection"
    return NO_TRADE, "neutral (no extreme)"


# 5-year backtest (27 tickers, 2021-09..2026-09): the ivrich mid IV-rank bucket
# (1/3..2/3) lost money in every period, including out-of-sample and the 2022 bear.
# Only the high bucket held up. Shared with edge.HIGH_CUT so the live gate and
# the backtest bucket are the same number.
IV_RANK_RICH = 2 / 3

# Same backtest: trend's high-IV edge collapsed in the 2022 bear (+$1.0 at 7d,
# -$6.2 at 14d) while meanrev and ivrich held. Flagged, not blocked.
TREND_CAUTION = "CAUTION: no edge in 2022 bear market (5y backtest)"


def _trend(ind):
    if ind["adx"] < 20:
        return NO_TRADE, "chop (ADX<20)"
    if ind["ema20"] > ind["ema50"] and ind["close"] > ind["ema20"]:
        return SELL_PUT, f"uptrend (EMA20>EMA50, price>EMA20, ADX>20) — {TREND_CAUTION}"
    if ind["ema20"] < ind["ema50"] and ind["close"] < ind["ema20"]:
        return SELL_CALL, f"downtrend (EMA20<EMA50, price<EMA20, ADX>20) — {TREND_CAUTION}"
    return NO_TRADE, "trend unclear"


def _ivrich(ind):
    rv, iv, rank = ind.get("rv", 0), ind.get("iv", 0), ind.get("iv_rank")
    ratio = iv / rv if rv > 0 else 0.0
    gate = (rank >= IV_RANK_RICH) if rank is not None else (ratio > 1.2)
    if not gate:
        tag = f"vol rank {rank:.2f}" if rank is not None else f"IV/RV={ratio:.2f}"
        return NO_TRADE, f"IV not rich ({tag})"
    d, r = _meanrev(ind)
    tag = f"vol rank {rank:.2f}" if rank is not None else f"IV/RV={ratio:.2f}"
    if d == NO_TRADE:
        return NO_TRADE, f"IV rich ({tag}) but no mean-rev signal"
    return d, f"IV rich ({tag}) + {r}"


_MODES = {"meanrev": _meanrev, "trend": _trend, "ivrich": _ivrich}


def verdict(mode: str, ind: dict):
    """Return (direction, reason) for a single mode."""
    return _MODES[mode](ind)


def combine(directions):
    """Any mode firing is enough. Modes that fire on opposite sides cancel to NO_TRADE."""
    nonflat = set(directions) - {NO_TRADE}
    return nonflat.pop() if len(nonflat) == 1 else NO_TRADE


def agreement(directions, direction):
    """(modes on the signal's side, modes checked). Zero agree when there is no trade."""
    agree = 0 if direction == NO_TRADE else sum(1 for d in directions if d == direction)
    return agree, len(directions)


# ---------------- strike builder ----------------
def _leg_quote(L):
    """The chosen leg's own market data, when the caller had a chain to read it from.

    The backtest reconstructs legs from Black-Scholes, so it has no bid/ask/OI/volume —
    those come back None rather than as a made-up zero.
    """
    return {
        "strike": L["strike"], "delta": L.get("delta"),
        "bid": L.get("bid"), "ask": L.get("ask"),
        "iv": L.get("iv"), "oi": L.get("oi"), "volume": L.get("volume"),
        "code": L.get("code"),
    }


def build_spread(legs, direction, target_delta: float = 0.30,
                 max_risk: float = 500.0, contract_mult: int = 100):
    """Pick short leg nearest target delta, long leg maximizing credit within max_risk.

    legs: [{"strike", "delta", "price"}] for the correct option side. Returns a spread
    dict or None if no long leg fits the risk cap.
    """
    if direction == SELL_PUT:
        side = "put"
    elif direction == SELL_CALL:
        side = "call"
    else:
        return None
    if not legs:
        return None
    short = min(legs, key=lambda L: abs(abs(L["delta"]) - target_delta))
    if side == "put":
        longs = [L for L in legs if L["strike"] < short["strike"]]
    else:
        longs = [L for L in legs if L["strike"] > short["strike"]]
    short_q = _leg_quote(short)
    best = None
    for lng in longs:
        width = abs(short["strike"] - lng["strike"])
        credit = short["price"] - lng["price"]
        if credit <= 0:
            continue
        max_loss = (width - credit) * contract_mult
        if max_loss <= 0 or max_loss > max_risk:
            continue
        if best is None or credit > best["credit"]:
            be = short["strike"] - credit if side == "put" else short["strike"] + credit
            best = {
                "side": side, "direction": direction,
                "short_strike": short["strike"], "long_strike": lng["strike"],
                "width": width, "credit": credit, "max_loss": max_loss,
                "roi": credit / (width - credit), "pop": 1 - abs(short["delta"]),
                "breakeven": be, "short_delta": short["delta"],
                "short_leg": short_q, "long_leg": _leg_quote(lng),
            }
    return best
