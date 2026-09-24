"""The daily-kline cache: it must never shrink, and never keep an unfinished bar."""
import datetime as dt
import os

import pandas as pd
import pytest

from theta.market import data as market_data

TODAY = dt.date(2026, 9, 24)


def _bars(start, end):
    days = pd.bdate_range(start, end)
    return pd.DataFrame({
        "time_key": [d.strftime("%Y-%m-%d 00:00:00") for d in days],
        "open": 1.0, "high": 2.0, "low": 0.5, "close": [float(i) for i in range(len(days))],
        "volume": 100.0,
    })


@pytest.fixture
def opend(monkeypatch, tmp_path):
    """A fake OpenD that answers any kline range and records what was asked."""
    asked = []

    def call(method, code, start, end, **kw):
        asked.append((start, end))
        return 0, _bars(start, end), None

    monkeypatch.setattr(market_data, "CACHE_DIR", str(tmp_path))
    monkeypatch.setattr(market_data, "_call", call)
    return asked, tmp_path


def _cached(tmp_path):
    return pd.read_csv(tmp_path / "SPY.csv", parse_dates=["date"])


def test_a_short_request_does_not_shrink_a_longer_cache(opend):
    asked, tmp_path = opend
    market_data.fetch_klines("SPY", "2021-09-24", "2026-09-24", today=TODAY)
    long_start = _cached(tmp_path)["date"].min()

    market_data.fetch_klines("SPY", "2026-05-27", "2026-09-25", today=TODAY + dt.timedelta(days=1))

    assert _cached(tmp_path)["date"].min() == long_start


def test_todays_unfinished_bar_is_neither_cached_nor_returned(opend):
    _, tmp_path = opend
    df = market_data.fetch_klines("SPY", "2026-09-01", "2026-09-24", today=TODAY)
    assert df["date"].max().date() < TODAY
    assert _cached(tmp_path)["date"].max().date() < TODAY


def test_a_cache_refreshed_today_is_reused_without_asking_opend_again(opend):
    asked, tmp_path = opend
    market_data.fetch_klines("SPY", "2026-01-02", "2026-09-24", today=TODAY)
    # The cache stops at yesterday by design; it must still count as current today.
    now = dt.datetime.combine(TODAY, dt.time(10, 0)).timestamp()
    os.utime(tmp_path / "SPY.csv", (now, now))

    df = market_data.fetch_klines("SPY", "2026-06-01", "2026-09-24", today=TODAY)

    assert len(asked) == 1
    assert df["date"].min() >= pd.Timestamp("2026-06-01")
