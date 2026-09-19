"""Gate 3: does this setup have measured historical edge?

Pooled across the whole watchlist rather than per-ticker. A single ticker in a
single mode yields roughly 15 trades, and 13 wins out of 15 happens 12.7% of the
time even when the true win rate is a losing 70% -- far too thin to gate on.
Pooling lifts every cell into the hundreds.

Gates on EXPECTANCY, never win rate: the short leg is chosen at delta 0.30, so a
~70% win rate is structural, not edge. With avg win ~$115 and avg loss ~$315 the
breakeven win rate is ~73%, barely above that free baseline.
"""
from theta.research.backtest import aggregate, iv_rank_at, rolling_rv
from theta.strategy import IV_RANK_RICH

LOW_CUT = 1 / 3
HIGH_CUT = IV_RANK_RICH  # the live ivrich gate; must not drift from it


def iv_bucket(rank):
    """Bucket an IV rank into low / mid / high, or unranked when absent."""
    if rank is None:
        return "unranked"
    if rank < LOW_CUT:
        return "low"
    if rank < HIGH_CUT:
        return "mid"
    return "high"


def build_edge_table(trades):
    """Group trades by (mode, dte, iv_bucket) and aggregate each cell."""
    groups = {}
    for t in trades:
        key = (t["mode"], t["dte"], iv_bucket(t.get("iv_rank")))
        groups.setdefault(key, []).append(t)
    return {k: aggregate(v) for k, v in groups.items()}


def passes(table, mode, dte, rank, min_n: int = 100, min_expectancy: float = 0.0):
    """(ok, reason) for whether this setup has demonstrated edge."""
    bucket = iv_bucket(rank)
    stats = table.get((mode, dte, bucket))
    if not stats or stats.get("n", 0) == 0:
        return False, f"no backtest data for {mode}/{dte}d/IV-{bucket}"

    n, exp = stats["n"], stats["expectancy"]
    label = f"{mode}/{dte}d/IV-{bucket}"
    if n < min_n:
        return False, f"{label}: only {n} trades, need {min_n} (UNVALIDATED)"
    if exp <= min_expectancy:
        return False, f"{label}: expectancy ${exp:+.1f}/trade over {n} trades — no edge"
    return True, f"{label}: expectancy ${exp:+.1f}/trade over {n} trades"


def rank_from_closes(closes):
    """Current RV percentile rank from daily closes -- the exact statistic the
    edge table was bucketed on, so a live lookup lands in the cell that was
    actually measured. Needs roughly a year of closes to be meaningful."""
    if not closes:
        return None
    return iv_rank_at(rolling_rv(list(closes)), len(closes) - 1)