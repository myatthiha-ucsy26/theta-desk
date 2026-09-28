"""Marking the paper book to model.

An open spread is valued at the current spot and the remaining time, not at
expiration: a position that still has time value has not yet earned its credit.
"""
import datetime as dt

from theta.market import data as market_data
from theta.market import pricing

DEFAULT_SIGMA = 0.30
_SIGMA_CACHE = {}


def sigma_for(ticker, default=DEFAULT_SIGMA):
    """Realized-vol estimate used to mark an open position.

    The same estimator the backtest uses, so a marked position and a backtested
    one are valued on the same basis.

    Reads cached klines rather than querying OpenD: the portfolio panel marks
    every open position on each request, and one gateway round-trip per position
    per page load is both slow and a hard failure whenever OpenD is down.
    Memoised per ticker per day, and falls back to a flat 30% so marking never
    crashes the panel.
    """
    key = (ticker.upper(), dt.date.today())
    if key in _SIGMA_CACHE:
        return _SIGMA_CACHE[key]
    try:
        end = dt.date.today()
        start = (end - dt.timedelta(days=120)).strftime("%Y-%m-%d")
        df = market_data.fetch_klines(ticker, start, end.strftime("%Y-%m-%d"))
        sigma = pricing.estimate_iv(df["close"].tolist(), window=20, factor=1.15)
        sigma = sigma if sigma > 0 else default
    except Exception:
        sigma = default
    _SIGMA_CACHE[key] = sigma
    return sigma


def position_pnl(trade, spot, sigma, today):
    """Open P&L in dollars, marked to model."""
    T = pricing.years_to_expiry(trade["expiry"], today)
    cost_to_close = pricing.spread_value(
        spot, trade["short_strike"], trade["long_strike"],
        T, 0.04, sigma, trade["direction"],
    )
    return round((trade["credit"] - cost_to_close) * 100 * trade["contracts"], 2)
