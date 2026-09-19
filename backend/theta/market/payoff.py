"""Payoff surface: a credit spread's P&L across spot price and days remaining. Pure.

Uses the same mark-to-model pricer as the paper book (pricing.spread_value), so
the surface shows exactly how an open position is valued. The expiry row is exact
intrinsic; every earlier row carries time value.
"""
from theta import strategy as cc
from theta.market import pricing

MAX_DAY_ROWS = 31


def _day_axis(days_left):
    days_left = max(int(days_left), 0)
    if days_left < MAX_DAY_ROWS:
        return list(range(days_left, -1, -1))
    n = MAX_DAY_ROWS - 1
    return sorted({round(days_left * i / n) for i in range(n + 1)}, reverse=True)


def payoff_grid(direction, short_strike, long_strike, credit, contracts, spot, days_left,
                sigma, r=0.04, n_spots=41):
    """{spots, days, pnl[day][spot], breakeven, max_profit, max_loss, spot} in dollars,
    plus the `sigma` the grid was priced at, which a caller needs to bump it for vega."""
    width = abs(short_strike - long_strike)
    lo = min(spot, short_strike, long_strike) * 0.9
    hi = max(spot, short_strike, long_strike) * 1.1
    step = (hi - lo) / (n_spots - 1)
    spots = [round(lo + i * step, 4) for i in range(n_spots)]
    days = _day_axis(days_left)
    pnl = [
        [round((credit - pricing.spread_value(s, short_strike, long_strike, d / 365.0,
                                                 r, sigma, direction)) * 100 * contracts, 2)
         for s in spots]
        for d in days
    ]
    breakeven = short_strike - credit if direction == cc.SELL_PUT else short_strike + credit
    return {
        "spots": spots, "days": days, "pnl": pnl,
        "breakeven": round(breakeven, 4),
        "max_profit": round(credit * 100 * contracts, 2),
        "max_loss": round(-(width - credit) * 100 * contracts, 2),
        "spot": spot, "sigma": sigma,
    }