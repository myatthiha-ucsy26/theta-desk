"""Pure statistics shared by the live path and the backtest. No IO.

The single definition of "rank" in this project. Both market_data.iv_rank (logged ATM
IV) and backtest.iv_rank_at (realized vol proxy) must route through here, so a
rank threshold means the same thing live as it did in the backtest.
"""


def percentile_rank(values, current: float, min_count: int = 20):
    """Fraction of `values` at or below `current`, in [0.0, 1.0].

    Returns None when there is not enough history to be meaningful.

    Deliberately a percentile, not a min-max normalization: min-max lets one
    historical outlier permanently compress every later reading.
    """
    if not values or len(values) < min_count:
        return None
    return sum(1 for v in values if v <= current) / len(values)