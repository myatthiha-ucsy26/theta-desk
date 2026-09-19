"""OpenD data IO: cached daily klines. READ-ONLY, no orders.

Klines are cached to klines_cache/<TICKER>.csv so we fetch each symbol's history once
(Futu limits historical-kline requests). Re-runs read the cache.
"""
import os

from theta import paths
import time
import csv
import datetime as dt
import pandas as pd
from futu import OpenQuoteContext, RET_OK, KLType

from theta.market import ratelimit
from theta.market import surface

from theta import stats

HOST = os.environ.get("OPEND_HOST", "127.0.0.1")
PORT = int(os.environ.get("OPEND_PORT", "11111"))
CACHE_DIR = paths.KLINES
IV_DIR = paths.IV_HISTORY

_ctx = None

# OpenD rejects quote requests above these rates (per 30 seconds). The option-chain
# cap of 10 is confirmed by OpenD's own error message; the others are OpenD's
# documented quote limits. Each is kept slightly under, and shared by every caller in
# this process -- the engine thread, dashboard requests and the IV surface.
LIMITS = {
    "get_option_chain": ratelimit.RateLimiter(9, 30.0),
    "get_market_snapshot": ratelimit.RateLimiter(55, 30.0),
    "request_history_kline": ratelimit.RateLimiter(55, 30.0),
    "get_option_expiration_date": ratelimit.RateLimiter(55, 30.0),
    "get_financials_earnings_price_history": ratelimit.RateLimiter(55, 30.0),
}
FREQ_RETRIES = 2
_retry_sleep = time.sleep


def ctx():
    global _ctx
    if _ctx is None:
        _ctx = OpenQuoteContext(host=HOST, port=PORT)
    return _ctx


def _call(method, *args, **kwargs):
    """Call an OpenD quote method under its rate limiter.

    If OpenD still answers "high frequency" (another process may be using the same
    OpenD account), wait one full window and retry, up to FREQ_RETRIES times. Any
    other error is returned immediately for the caller to raise.
    """
    limiter = LIMITS[method]
    for attempt in range(FREQ_RETRIES + 1):
        limiter.acquire()
        result = getattr(ctx(), method)(*args, **kwargs)
        if result[0] == RET_OK or "frequency" not in str(result[1]).lower() or attempt == FREQ_RETRIES:
            return result
        _retry_sleep(limiter.window)


def norm(sym: str) -> str:
    sym = sym.strip().upper()
    return sym if "." in sym else f"US.{sym}"


def fetch_klines(ticker: str, start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Daily OHLCV DataFrame (columns: date, open, high, low, close, volume).

    Cached per ticker. If the cache exists and covers [start, end], it is used unless
    refresh=True. Otherwise OpenD is queried and the cache is (re)written.
    """
    os.makedirs(CACHE_DIR, exist_ok=True)
    path = os.path.join(CACHE_DIR, f"{ticker.upper().replace('.', '_')}.csv")
    if not refresh and os.path.exists(path):
        df = pd.read_csv(path, parse_dates=["date"])
        if df["date"].min() <= pd.Timestamp(start) and df["date"].max() >= pd.Timestamp(end):
            return df[(df["date"] >= pd.Timestamp(start)) & (df["date"] <= pd.Timestamp(end))].reset_index(drop=True)

    ret, k, _ = _call("request_history_kline",
        norm(ticker), start=start, end=end, ktype=KLType.K_DAY, max_count=1500)
    if ret != RET_OK:
        raise RuntimeError(f"OpenD kline error for {ticker}: {k}")
    df = pd.DataFrame({
        "date": pd.to_datetime(k["time_key"]),
        "open": k["open"].astype(float),
        "high": k["high"].astype(float),
        "low": k["low"].astype(float),
        "close": k["close"].astype(float),
        "volume": k["volume"].astype(float),
    })
    df.to_csv(path, index=False)
    return df


def recent_klines(ticker: str, bars: int = 120) -> pd.DataFrame:
    """Fresh recent daily klines (for live indicators). Always queries OpenD."""
    end = dt.date.today()
    start = (end - dt.timedelta(days=bars * 2)).strftime("%Y-%m-%d")
    # Futu's max_count returns the EARLIEST N bars in [start, end]; capping at `bars`
    # truncates the recent end when the window holds more trading days than `bars`,
    # leaving a stale last close. Cover the whole window, then keep the latest `bars`.
    ret, k, _ = _call("request_history_kline",
        norm(ticker), start=start, end=end.strftime("%Y-%m-%d"),
        ktype=KLType.K_DAY, max_count=bars * 2)
    if ret != RET_OK:
        raise RuntimeError(f"OpenD kline error for {ticker}: {k}")
    df = pd.DataFrame({
        "date": pd.to_datetime(k["time_key"]),
        "high": k["high"].astype(float), "low": k["low"].astype(float),
        "close": k["close"].astype(float),
    })
    return df.tail(bars).reset_index(drop=True)


def get_spot(ticker: str) -> float:
    ret, snap = _call("get_market_snapshot", [norm(ticker)])
    if ret != RET_OK:
        raise RuntimeError(f"OpenD snapshot error: {snap}")
    return float(snap.iloc[0]["last_price"])


def pick_expiration(ticker: str, dte_target: int):
    """Nearest available expiration to dte_target days out. Returns (exp_str, dte_int)."""
    ret, e = _call("get_option_expiration_date", code=norm(ticker))
    if ret != RET_OK or len(e) == 0:
        raise RuntimeError(f"OpenD expiration error: {e}")
    e = e.copy()
    e = e[e["option_expiry_date_distance"] >= 1]
    e["d"] = (e["option_expiry_date_distance"] - dte_target).abs()
    r = e.sort_values("d").iloc[0]
    return r["strike_time"], int(r["option_expiry_date_distance"])


def snapshot(codes):
    """Raw OpenD snapshot rows for any codes: underlyings or option contracts."""
    ret, s = _call("get_market_snapshot", list(codes))
    if ret != RET_OK:
        raise RuntimeError(f"OpenD snapshot error: {s}")
    return s


def expirations(ticker: str):
    """Every listed expiration for a ticker as (date, dte, cycle), soonest first."""
    ret, e = _call("get_option_expiration_date", code=norm(ticker))
    if ret != RET_OK:
        raise RuntimeError(f"OpenD expiration error: {e}")
    rows = [{"expiration": r["strike_time"],
             "dte": int(r["option_expiry_date_distance"]),
             "cycle": r["expiration_cycle"]} for _, r in e.iterrows()]
    return sorted(rows, key=lambda r: r["dte"])


def option_chain(ticker: str, expiration: str):
    """The contract list for one expiration. Strikes and types only; quotes and
    greeks come from a snapshot of the codes this returns."""
    ret, chain = _call("get_option_chain", code=norm(ticker),
                       start=expiration, end=expiration)
    if ret != RET_OK:
        raise RuntimeError(f"OpenD chain error: {chain}")
    return chain


def _count(v) -> int:
    """A snapshot count as an int. OpenD sends NaN (and 'N/A') for legs it has no data on."""
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0
    return 0 if n != n else int(n)


def fetch_legs(ticker: str, exp: str, side: str, spot: float, pct: float = 0.15):
    """Option legs for one side with live delta, mid price, IV, bid/ask, OI and volume.

    Snapshot omits strike_price/option_type -> take them from the chain frame.
    """
    code = norm(ticker)
    ret, chain = _call("get_option_chain", code=code, start=exp, end=exp)
    if ret != RET_OK:
        raise RuntimeError(f"OpenD chain error: {chain}")
    ot = "PUT" if side == "put" else "CALL"
    chain = chain[chain["option_type"] == ot]
    lo, hi = spot * (1 - pct), spot * (1 + pct)
    chain = chain[(chain["strike_price"] >= lo) & (chain["strike_price"] <= hi)]
    strike_by = dict(zip(chain["code"], chain["strike_price"]))
    codes = chain["code"].tolist()
    legs = []
    for i in range(0, len(codes), 40):
        ret, s = _call("get_market_snapshot", codes[i:i + 40])
        if ret != RET_OK:
            raise RuntimeError(f"OpenD snapshot error: {s}")
        for _, r in s.iterrows():
            b, a = r.get("bid_price"), r.get("ask_price")
            mid = (b + a) / 2 if (b and a and b > 0 and a > 0) else r.get("last_price")
            dl = r.get("option_delta")
            if mid is None or dl is None:
                continue
            legs.append({
                "strike": float(strike_by[r["code"]]), "delta": float(dl),
                "price": float(mid), "iv": r.get("option_implied_volatility"),
                "oi": _count(r.get("option_open_interest")),
                "volume": _count(r.get("volume")),
                "code": r["code"], "bid": float(b or 0), "ask": float(a or 0),
            })
    legs.sort(key=lambda x: x["strike"])
    return legs


def quotes(codes):
    """Live bid/ask for option codes. A bid of 0 is a real quote (far out-of-the-money
    legs); a missing ask is not, so it raises rather than pricing a spread on nothing."""
    ret, s = _call("get_market_snapshot", list(codes))
    if ret != RET_OK:
        raise RuntimeError(f"OpenD snapshot error: {s}")
    out = {}
    for _, r in s.iterrows():
        b, a = r.get("bid_price"), r.get("ask_price")
        if a is not None and a > 0 and b is not None and b >= 0:
            out[r["code"]] = {"bid": float(b), "ask": float(a)}
    missing = [c for c in codes if c not in out]
    if missing:
        raise RuntimeError(f"no usable quote for {', '.join(missing)}")
    return out


def iv_surface_points(ticker: str, spot: float, today=None, max_days: int = 30,
                      max_expiries: int = 6, pct: float = 0.10, batch: int = 300):
    """Out-of-the-money implied vol per strike for up to max_expiries expirations.

    One option-chain request covers every expiration in the next max_days (OpenD
    allows only 10 chain requests per 30 seconds), then snapshots are fetched in
    batches. Puts at or below spot and calls at or above it, within +/-pct of spot.
    Returns [{expiry, dte, strike, iv}] with iv as a decimal.
    """
    today = today or dt.date.today()
    ret, chain = _call("get_option_chain", code=norm(ticker),
                       start=(today + dt.timedelta(days=1)).isoformat(),
                       end=(today + dt.timedelta(days=max_days)).isoformat())
    if ret != RET_OK:
        raise RuntimeError(f"OpenD chain error: {chain}")
    expiries = {(e, (dt.date.fromisoformat(e) - today).days) for e in chain["strike_time"].unique()}
    dte_by = dict(surface.pick_expiries(expiries, max_expiries))
    lo, hi = spot * (1 - pct), spot * (1 + pct)
    c = chain[chain["strike_time"].isin(list(dte_by))
              & (chain["strike_price"] >= lo) & (chain["strike_price"] <= hi)]
    c = c[((c["option_type"] == "PUT") & (c["strike_price"] <= spot))
          | ((c["option_type"] == "CALL") & (c["strike_price"] >= spot))]
    info = {code: (exp, float(k)) for code, exp, k in zip(c["code"], c["strike_time"], c["strike_price"])}
    codes = list(info)
    points = []
    for i in range(0, len(codes), batch):
        ret, snap = _call("get_market_snapshot", codes[i:i + batch])
        if ret != RET_OK:
            raise RuntimeError(f"OpenD snapshot error: {snap}")
        for code, iv in zip(snap["code"], snap["option_implied_volatility"]):
            if iv and iv > 0:
                exp, k = info[code]
                points.append({"expiry": exp, "dte": dte_by[exp], "strike": k, "iv": float(iv) / 100.0})
    return points


def atm_iv(ticker: str, exp: str, spot: float) -> float:
    """ATM implied vol (decimal) from the put nearest spot. OpenD returns IV in percent."""
    legs = fetch_legs(ticker, exp, "put", spot, pct=0.04)
    if not legs:
        return 0.0
    atm = min(legs, key=lambda x: abs(x["strike"] - spot))
    iv = atm.get("iv")
    return float(iv) / 100.0 if iv else 0.0


def log_iv(ticker: str, iv: float, day: str = None):
    """Append today's ATM IV to iv_history/<T>.csv (dedupe by date)."""
    os.makedirs(IV_DIR, exist_ok=True)
    day = day or dt.date.today().isoformat()
    path = os.path.join(IV_DIR, f"{ticker.upper()}.csv")
    rows = {}
    if os.path.exists(path):
        with open(path) as f:
            for d, v in csv.reader(f):
                rows[d] = v
    rows[day] = f"{iv:.6f}"
    with open(path, "w", newline="") as f:
        w = csv.writer(f)
        for d in sorted(rows):
            w.writerow([d, rows[d]])


def iv_rank(ticker: str, cur_iv: float, min_days: int = 20):
    """True IV rank (0..1) from logged history, or None if too few days logged.

    Percentile via stats.percentile_rank — the same statistic the backtest uses.
    """
    path = os.path.join(IV_DIR, f"{ticker.upper()}.csv")
    if not os.path.exists(path):
        return None
    with open(path) as f:
        vals = [float(v) for _, v in csv.reader(f)]
    return stats.percentile_rank(vals, cur_iv, min_count=min_days)


def next_earnings(ticker: str, today=None, horizon_days: int = 14):
    """'YYYY-MM-DD' of the ticker's next earnings inside the horizon, or None if none is scheduled.

    Futu schedules a report only a few weeks ahead, and lists it here as soon as it does, so
    within a 14-day horizon an imminent report is always already listed -- a missing date means
    nothing falls in the window, not that we failed to look. Failures raise, and the caller
    reports those as UNKNOWN; "there are none" and "could not check" must stay distinct, since
    only one of them is safe to sell premium on.
    """
    today = today or dt.date.today()
    ret, df = _call("get_financials_earnings_price_history", norm(ticker))
    if ret != RET_OK:
        raise RuntimeError(f"OpenD earnings history error for {ticker}: {df}")
    end = (today + dt.timedelta(days=horizon_days - 1)).isoformat()
    days = sorted(str(d)[:10] for d in df["pub_trading_day_str"].dropna())
    return next((d for d in days if today.isoformat() <= d <= end), None)


def close_ctx():
    global _ctx
    if _ctx is not None:
        _ctx.close()
        _ctx = None
