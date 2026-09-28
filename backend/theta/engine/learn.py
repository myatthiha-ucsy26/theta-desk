"""Learn view: is the edge real? Pure summaries over journal, edge table and paper book."""

STAGES = ("signal", "tradeable", "edge", "risk", "ai", "dedupe", "alert")
BUCKET_ORDER = {"low": 0, "mid": 1, "high": 2, "unranked": 3}


def funnel(decisions):
    """For each stage: how many decisions reached it, and how many stopped there.

    A decision with stage "alert" cleared everything; it counts as stopping at alert.
    """
    index = {s: i for i, s in enumerate(STAGES)}
    rows = []
    for i, stage in enumerate(STAGES):
        rows.append({
            "stage": stage,
            "reached": sum(1 for d in decisions if index.get(d["stage"], -1) >= i),
            "stopped": sum(1 for d in decisions if d["stage"] == stage),
        })
    return rows


def count_errors(decisions):
    """Decisions that stopped on a data or system error rather than a rule."""
    return sum(1 for d in decisions if str(d.get("reason", "")).startswith("error:"))


def edge_cells(table, min_n, min_expectancy):
    cells = []
    for (mode, dte, bucket), s in table.items():
        validated = s["n"] >= min_n
        cells.append({
            "mode": mode, "dte": dte, "bucket": bucket,
            "n": s["n"], "expectancy": s["expectancy"], "win_rate": s.get("win_rate"),
            "validated": validated,
            "passes": validated and s["expectancy"] > min_expectancy,
        })
    cells.sort(key=lambda c: (c["mode"], c["dte"], BUCKET_ORDER.get(c["bucket"], 9)))
    return cells


def paper_vs_backtest(closed_positions, table, min_n, min_expectancy):
    """Per mode: realised paper results beside the backtest cells the gate lets through."""
    by_mode = {}
    for p in closed_positions:
        if p.get("close_pnl") is None:
            continue
        by_mode.setdefault(p.get("mode") or "manual", []).append(p["close_pnl"])
    rows = []
    for mode in sorted(by_mode):
        pnls = by_mode[mode]
        gated = [s for (m, _, _), s in table.items()
                 if m == mode and s["n"] >= min_n and s["expectancy"] > min_expectancy]
        bt_n = sum(s["n"] for s in gated)
        rows.append({
            "mode": mode,
            "paper_n": len(pnls),
            "paper_win_rate": sum(1 for v in pnls if v > 0) / len(pnls),
            "paper_expectancy": sum(pnls) / len(pnls),
            "paper_total": round(sum(pnls), 2),
            "backtest_n": bt_n,
            "backtest_expectancy": (sum(s["expectancy"] * s["n"] for s in gated) / bt_n) if bt_n else None,
        })
    return rows