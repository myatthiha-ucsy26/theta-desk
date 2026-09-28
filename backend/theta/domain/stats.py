"""Pure statistics shared by the live path and the backtest. No IO.

The single definition of "rank" in this project. The live signal and the backtest
both rank the same input too -- the 20-day realised vol's percentile over a year,
via backtest.iv_rank_at -- because no free history of option IV exists to
backtest on, so a threshold measured on RV only means something when applied to RV.
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