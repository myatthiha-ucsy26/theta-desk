import datetime as dt

import pandas as pd
import pytest

from theta.market import data as market_data

TODAY = dt.date(2026, 9, 18)


class NoLimiter:
    window = 30.0

    def acquire(self):
        return 0.0


class FakeCtx:
    """Serves the F10 earnings rows for one ticker."""

    def __init__(self, days=(), ret=0):
        self.days = list(days)
        self.ret = ret

    def get_financials_earnings_price_history(self, code):
        if self.ret != 0:
            return self.ret, "OpenD not connected"
        return 0, pd.DataFrame({"pub_trading_day_str": self.days})


@pytest.fixture
def ctx(monkeypatch):
    fake = FakeCtx()
    monkeypatch.setattr(market_data, "LIMITS", {"get_financials_earnings_price_history": NoLimiter()})
    monkeypatch.setattr(market_data, "_ctx", fake)
    return fake


def test_next_earnings_returns_a_date_inside_the_horizon(ctx):
    ctx.days = ["2026-09-24"]
    assert market_data.next_earnings("COST", today=TODAY, horizon_days=14) == "2026-09-24"


def test_next_earnings_ignores_dates_beyond_the_horizon(ctx):
    """Futu lists a report as soon as it is scheduled, well before it lands in the window."""
    ctx.days = ["2026-10-20"]
    assert market_data.next_earnings("ACN", today=TODAY, horizon_days=14) is None


def test_next_earnings_ignores_dates_already_past(ctx):
    """AVGO reported on 2026-09-02; its next report is months away and unscheduled."""
    ctx.days = ["2026-09-02", "2026-06-05"]
    assert market_data.next_earnings("AVGO", today=TODAY, horizon_days=14) is None


def test_next_earnings_takes_the_soonest_upcoming_of_several(ctx):
    ctx.days = ["2026-09-24", "2026-09-22", "2026-09-02"]
    assert market_data.next_earnings("COST", today=TODAY, horizon_days=14) == "2026-09-22"


def test_next_earnings_is_none_when_the_ticker_has_no_rows(ctx):
    assert market_data.next_earnings("AAPL", today=TODAY, horizon_days=14) is None


def test_next_earnings_ignores_missing_dates(ctx):
    ctx.days = [None, float("nan"), "2026-09-24"]
    assert market_data.next_earnings("COST", today=TODAY, horizon_days=14) == "2026-09-24"


def test_openD_error_raises(tmp_path, monkeypatch):
    """'No earnings' and 'could not check' must not collapse into the same answer."""
    monkeypatch.setattr(market_data, "LIMITS", {"get_financials_earnings_price_history": NoLimiter()})
    monkeypatch.setattr(market_data, "_ctx", FakeCtx(ret=-1))
    with pytest.raises(RuntimeError, match="earnings"):
        market_data.next_earnings("COST", today=TODAY, horizon_days=14)