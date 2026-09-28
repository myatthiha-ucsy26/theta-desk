import pandas as pd

from theta.research.backtest import run_backtest


def _synthetic_df(n=400):
    """A gently oscillating series: enough movement to trigger signals."""
    import math
    dates = pd.date_range("2024-01-01", periods=n, freq="D")
    closes = [100 + 10 * math.sin(i / 9.0) + 0.02 * i for i in range(n)]
    return pd.DataFrame({
        "date": dates,
        "open": closes,
        "high": [c * 1.01 for c in closes],
        "low": [c * 0.99 for c in closes],
        "close": closes,
        "volume": [1e6] * n,
    })


def test_run_backtest_records_iv_rank_on_every_trade():
    trades = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14)
    assert trades, "synthetic series should produce at least one trade"
    for t in trades:
        assert "iv_rank" in t
        assert t["iv_rank"] is None or 0.0 <= t["iv_rank"] <= 1.0


def test_run_backtest_still_records_existing_fields():
    trades = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14)
    for key in ("ticker", "entry", "expiry", "dte", "mode", "direction", "pnl", "win"):
        assert key in trades[0]

# ---------------- exits: the backtest must trade the rules the bot trades ----------------

def _random_walk(n=500, seed=7):
    """A seeded 2.5%-a-day walk: rough enough that stops and wide wings both occur."""
    import random
    rnd, closes = random.Random(seed), [100.0]
    for _ in range(n - 1):
        closes.append(closes[-1] * (1 + rnd.gauss(0, 0.025)))
    return pd.DataFrame({
        "date": pd.date_range("2024-01-01", periods=n, freq="D"),
        "open": closes, "high": [c * 1.01 for c in closes], "low": [c * 0.99 for c in closes],
        "close": closes, "volume": [1e6] * n,
    })


def test_without_exit_rules_every_trade_is_held_to_expiry():
    trades = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14)
    assert {t["exit"] for t in trades} == {"expiry"}
    assert all(t["exit_date"] == t["expiry"] for t in trades)


def test_take_profit_closes_early_at_the_target():
    trades = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14, tp_pct=50)
    tps = [t for t in trades if t["exit"] == "tp"]
    assert tps, "a 14-day spread on this series should reach half its credit"
    for t in tps:
        assert t["exit_date"] < t["expiry"]
        assert t["pnl"] >= t["credit"] * 50 * t["contracts"] - 0.01


def test_stop_loss_closes_early_at_the_multiple():
    trades = run_backtest("TEST", _random_walk(), ["meanrev"], 14, sl_multiple=0.5)
    sls = [t for t in trades if t["exit"] == "sl"]
    assert sls, "a tight stop should trigger on this series"
    for t in sls:
        assert t["exit_date"] < t["expiry"]
        assert t["pnl"] <= -t["credit"] * 50 * t["contracts"] + 0.01


def test_an_early_exit_frees_the_ticker_for_the_next_entry():
    held = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14)
    managed = run_backtest("TEST", _synthetic_df(), ["meanrev"], 14, tp_pct=50)
    assert len(managed) > len(held)


def test_width_builds_the_bots_fixed_width_spread():
    trades = run_backtest("TEST", _random_walk(), ["meanrev"], 14, width=5.0)
    assert trades and {t["width"] for t in trades} == {5.0}
