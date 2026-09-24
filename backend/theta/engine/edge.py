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


SIDE_NAMES = {"SELL_PUT": "bull put", "SELL_CALL": "bear call"}


def build_edge_table(trades):
    """Group trades by (mode, dte, iv_bucket) and aggregate each cell.

    Each cell also carries its bull puts and bear calls separately under "sides".
    The two can disagree: with IV priced near real chains, ivrich/14d/high was
    +$19/trade pooled while its bear calls alone lost $2/trade.
    """
    groups = {}
    for t in trades:
        key = (t["mode"], t["dte"], iv_bucket(t.get("iv_rank")))
        groups.setdefault(key, []).append(t)
    table = {}
    for k, v in groups.items():
        by_side = {}
        for t in v:
            by_side.setdefault(t["direction"], []).append(t)
        table[k] = {**aggregate(v), "sides": {d: aggregate(ts) for d, ts in by_side.items()}}
    return table


def cell(table, mode, dte, rank, direction=None):
    """The stats the gate judges: the direction's side of the cell when the cell
    has sides, else the pooled cell. None when there is nothing to judge."""
    stats = table.get((mode, dte, iv_bucket(rank)))
    if stats and direction and "sides" in stats:
        return stats["sides"].get(direction)
    return stats


def passes(table, mode, dte, rank, min_n: int = 100, min_expectancy: float = 0.0,
           direction=None):
    """(ok, reason) for whether this setup has demonstrated edge.

    With a direction, the direction's own side must also have edge. The side is
    an extra requirement, never a substitute: a strong side cannot rescue a cell
    that fails pooled. A table stored before sides existed is judged pooled only
    until its next rebuild.
    """
    label = f"{mode}/{dte}d/IV-{iv_bucket(rank)}"
    pooled = table.get((mode, dte, iv_bucket(rank)))
    ok, why = _judge(pooled, label, min_n, min_expectancy)
    if not ok or not (direction and "sides" in pooled):
        return ok, why
    return _judge(pooled["sides"].get(direction),
                  f"{label} {SIDE_NAMES.get(direction, direction)}", min_n, min_expectancy)


def _judge(stats, label, min_n, min_expectancy):
    if not stats or stats.get("n", 0) == 0:
        return False, f"no backtest data for {label}"
    n, exp = stats["n"], stats["expectancy"]
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