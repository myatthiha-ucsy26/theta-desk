import pytest

from theta.engine import learn


def d(stage, passed=False, reason="r"):
    return {"stage": stage, "passed": passed, "reason": reason}


def test_funnel_counts_how_far_each_decision_got():
    decisions = [d("signal"), d("signal"), d("edge"), d("ai"), d("alert", True)]
    f = {row["stage"]: row for row in learn.funnel(decisions)}
    assert [row["stage"] for row in learn.funnel(decisions)] == list(learn.STAGES)
    assert f["signal"]["reached"] == 5 and f["signal"]["stopped"] == 2
    assert f["tradeable"]["reached"] == 3 and f["tradeable"]["stopped"] == 0
    assert f["edge"]["reached"] == 3 and f["edge"]["stopped"] == 1
    assert f["ai"]["reached"] == 2 and f["ai"]["stopped"] == 1
    assert f["alert"]["reached"] == 1 and f["alert"]["stopped"] == 1


def test_count_errors_separates_failures_from_real_rejections():
    decisions = [d("signal", reason="error: no ATM IV available"), d("signal", reason="ivrich: IV not rich")]
    assert learn.count_errors(decisions) == 1


def test_edge_cells_sorted_and_flagged():
    table = {
        ("ivrich", 14, "high"): {"n": 672, "expectancy": 37.6, "win_rate": 0.81},
        ("ivrich", 7, "high"): {"n": 847, "expectancy": 37.7, "win_rate": 0.82},
        ("trend", 7, "mid"): {"n": 60, "expectancy": 9.0, "win_rate": 0.76},
        ("meanrev", 14, "low"): {"n": 495, "expectancy": -33.7, "win_rate": 0.70},
    }
    cells = learn.edge_cells(table, min_n=100, min_expectancy=0.0)
    assert [(c["mode"], c["dte"], c["bucket"]) for c in cells] == [
        ("ivrich", 7, "high"), ("ivrich", 14, "high"), ("meanrev", 14, "low"), ("trend", 7, "mid"),
    ]
    by = {(c["mode"], c["dte"], c["bucket"]): c for c in cells}
    assert by[("ivrich", 7, "high")]["validated"] is True and by[("ivrich", 7, "high")]["passes"] is True
    assert by[("trend", 7, "mid")]["validated"] is False and by[("trend", 7, "mid")]["passes"] is False
    assert by[("meanrev", 14, "low")]["validated"] is True and by[("meanrev", 14, "low")]["passes"] is False


def test_bucket_order_is_low_mid_high_unranked():
    table = {("ivrich", 7, b): {"n": 1, "expectancy": 1.0, "win_rate": 1.0} for b in ("unranked", "high", "low", "mid")}
    assert [c["bucket"] for c in learn.edge_cells(table, 100, 0.0)] == ["low", "mid", "high", "unranked"]


def test_paper_vs_backtest_per_mode():
    closed = [{"mode": "ivrich", "close_pnl": 100.0}, {"mode": "ivrich", "close_pnl": -300.0},
              {"mode": "ivrich", "close_pnl": 80.0}, {"mode": "", "close_pnl": 50.0}]
    table = {
        ("ivrich", 7, "high"): {"n": 300, "expectancy": 40.0, "win_rate": 0.8},
        ("ivrich", 14, "high"): {"n": 100, "expectancy": 20.0, "win_rate": 0.8},
        ("ivrich", 7, "mid"): {"n": 500, "expectancy": -20.0, "win_rate": 0.7},   # gate blocks it
        ("ivrich", 14, "low"): {"n": 50, "expectancy": 90.0, "win_rate": 0.9},    # too thin
    }
    rows = {r["mode"]: r for r in learn.paper_vs_backtest(closed, table, min_n=100, min_expectancy=0.0)}
    iv = rows["ivrich"]
    assert iv["paper_n"] == 3
    assert iv["paper_expectancy"] == pytest.approx(-40.0)
    assert iv["paper_win_rate"] == pytest.approx(2 / 3)
    assert iv["backtest_n"] == 400
    assert iv["backtest_expectancy"] == pytest.approx(35.0)
    assert rows["manual"]["paper_n"] == 1 and rows["manual"]["backtest_n"] == 0
    assert rows["manual"]["backtest_expectancy"] is None


def test_paper_vs_backtest_ignores_closed_trades_without_pnl():
    rows = learn.paper_vs_backtest([{"mode": "ivrich", "close_pnl": None}], {}, 100, 0.0)
    assert rows == []