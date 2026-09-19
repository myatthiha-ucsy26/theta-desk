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