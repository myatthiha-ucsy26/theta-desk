"""Turning live market data into a signal the desk can act on.

Composes the market layer and the strategy layer: fetch bars, spot, expiration
and ATM IV, build indicators, ask each mode for a verdict, then size a spread
if one fired. The result dict is what both the HTTP endpoint and the scanning
engine hand on, so the browser and the journal describe a signal identically.
"""
from theta import strategy as cc
from theta.engine import edge
from theta.market import data as market_data
from theta.market.pricing import estimate_iv

ALL_MODES = ["meanrev", "trend", "ivrich"]
OI_FLOOR = 50
# Enough daily bars for the 20-day RV plus its one-year (252-bar) percentile window.
HISTORY_BARS = 300


def num(v, dp):
    """A snapshot number rounded for JSON. OpenD sends NaN or 'N/A' for a field it has no
    value for, and neither survives jsonify."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else round(f, dp)


def leg_payload(L):
    iv = num(L["iv"], 6)
    return {
        "strike": L["strike"],
        "delta": num(L["delta"], 3),
        "bid": num(L["bid"], 2), "ask": num(L["ask"], 2),
        # OpenD reports IV in percent; the rest of the payload carries decimals.
        "iv": None if iv is None else round(iv / 100.0, 4),
        "oi": L["oi"], "volume": L["volume"], "code": L["code"],
    }


def spread_payload(spread, spot, em):
    """The chosen spread as the browser reads it, both legs' own quotes included.

    Shared by the stream and the synchronous endpoint: they build the same result dict, and
    when each kept its own copy the legs landed in one and not the other.
    """
    if not spread:
        return None
    short_k = spread["short_strike"]
    return {
        "side": spread["side"], "short": short_k, "long": spread["long_strike"],
        "width": spread["width"], "credit": round(spread["credit"], 2),
        "max_loss": round(spread["max_loss"], 0),
        "roi_pct": round(spread["roi"] * 100, 1), "pop_pct": round(spread["pop"] * 100, 1),
        "breakeven": round(spread["breakeven"], 2),
        "short_delta": round(spread["short_delta"], 3),
        "em_distance": round((abs(spot - short_k) / em) if em > 0 else 0, 2),
        "short_leg": leg_payload(spread["short_leg"]), "long_leg": leg_payload(spread["long_leg"]),
    }


def evaluate(ticker, dte_target, modes):
    """Synchronous version — kept for /api/signal endpoint backward compat."""
    kl = market_data.recent_klines(ticker, HISTORY_BARS)
    highs, lows, closes = kl["high"].tolist(), kl["low"].tolist(), kl["close"].tolist()
    if len(closes) < 55:
        raise RuntimeError("not enough price history")
    spot = market_data.get_spot(ticker)
    exp, dte = market_data.pick_expiration(ticker, dte_target)
    iv = market_data.atm_iv(ticker, exp, spot)
    if iv <= 0:
        raise RuntimeError("no ATM IV available (market closed or illiquid)")
    market_data.log_iv(ticker, iv)
    # The rank the edge table was bucketed on (realised-vol percentile), not the logged
    # ATM IV: gating on one statistic and validating on another would judge a trade
    # against a cell it never belonged to.
    rank = edge.rank_from_closes(closes)
    rv = estimate_iv(closes, window=20, factor=1.0)

    ind = cc.build_indicators(highs, lows, closes, iv=iv, rv=rv, iv_rank=rank)
    verdicts = {m: cc.verdict(m, ind) for m in ALL_MODES}
    dirs = [verdicts[m][0] for m in modes]
    direction = cc.combine(dirs) if len(dirs) > 1 else dirs[0]
    em = cc.expected_move(spot, iv, dte)

    spread = None
    if direction != cc.NO_TRADE:
        side = "put" if direction == cc.SELL_PUT else "call"
        legs = [L for L in market_data.fetch_legs(ticker, exp, side, spot, 0.15)
                if L["oi"] >= OI_FLOOR]
        spread = cc.build_spread(legs, direction, target_delta=0.30, max_risk=500)

    out = {
        "ticker": ticker.upper(), "spot": round(spot, 2), "expiration": exp, "dte": dte,
        "modes": modes, "direction": direction,
        "expected_move": round(em, 2),
        "sd1_down": round(spot - em, 2), "sd1_up": round(spot + em, 2),
        "iv_pct": round(iv * 100, 1),
        "iv_rank": (round(rank, 2) if rank is not None else None),
        "iv_rv": round(iv / rv, 2) if rv > 0 else None,
        "indicators": {
            "rsi": round(ind["rsi"], 1), "pctb": round(ind["pctb"], 2),
            "adx": round(ind["adx"], 1),
            "ema20": round(ind["ema20"], 2), "ema50": round(ind["ema50"], 2),
            "last_close": round(ind["close"], 2),
        },
        "verdicts": {m: {"direction": verdicts[m][0], "reason": verdicts[m][1]} for m in ALL_MODES},
        "spread": spread_payload(spread, spot, em),
    }
    return out
