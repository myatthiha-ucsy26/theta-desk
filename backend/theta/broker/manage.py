"""Manage view: what an open position looks like right now. Pure."""
import datetime as dt

from theta import strategy as cc

PROFIT_TAKE_FRACTION = 0.5


def position_view(position, spot, mtm, today):
    """The position plus the fields the Manage screen needs.

    distance_pct is positive while the short strike is still out of the money.
    spot and mtm may be None when quotes are unavailable.
    """
    max_profit = position["credit"] * 100 * position["contracts"]
    risk = (position["width"] - position["credit"]) * 100 * position["contracts"]
    days_left = max((dt.date.fromisoformat(position["expiry"]) - today).days, 0)
    if spot is None:
        distance = breached = None
    else:
        gap = spot - position["short_strike"] if position["direction"] == cc.SELL_PUT \
            else position["short_strike"] - spot
        distance = round(gap / spot * 100, 4)
        breached = gap < 0
    return {
        **position,
        "spot": spot,
        "mtm_pnl": mtm,
        "days_left": days_left,
        "max_profit": round(max_profit, 2),
        "risk": round(risk, 2),
        "distance_pct": distance,
        "short_breached": breached,
        "profit_pct": round(mtm / max_profit * 100, 2) if mtm is not None and max_profit else None,
        "profit_take_hit": mtm is not None and mtm >= PROFIT_TAKE_FRACTION * max_profit,
    }