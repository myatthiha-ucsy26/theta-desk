import datetime as dt

import pytest

from theta.broker import manage

TODAY = dt.date(2026, 9, 16)
PUT = {"id": "p1", "ticker": "META", "direction": "SELL_PUT", "short_strike": 600.0,
       "long_strike": 595.0, "width": 5.0, "credit": 1.25, "contracts": 2,
       "expiry": "2026-09-25", "status": "open"}
CALL = {**PUT, "id": "c1", "direction": "SELL_CALL", "short_strike": 700.0, "long_strike": 705.0}


def test_money_fields():
    v = manage.position_view(PUT, spot=650.0, mtm=100.0, today=TODAY)
    assert v["max_profit"] == 250.0
    assert v["risk"] == 750.0
    assert v["profit_pct"] == pytest.approx(40.0)
    assert v["days_left"] == 9
    assert v["id"] == "p1" and v["mtm_pnl"] == 100.0 and v["spot"] == 650.0


def test_distance_is_positive_while_out_of_the_money():
    assert manage.position_view(PUT, 650.0, 0.0, TODAY)["distance_pct"] == pytest.approx(7.6923, abs=1e-3)
    assert manage.position_view(CALL, 650.0, 0.0, TODAY)["distance_pct"] == pytest.approx(7.6923, abs=1e-3)


def test_short_strike_breached():
    assert manage.position_view(PUT, 590.0, -300.0, TODAY)["short_breached"] is True
    assert manage.position_view(PUT, 650.0, 50.0, TODAY)["short_breached"] is False
    assert manage.position_view(CALL, 710.0, -300.0, TODAY)["short_breached"] is True


def test_profit_take_at_half_of_max_profit():
    assert manage.position_view(PUT, 650.0, 125.0, TODAY)["profit_take_hit"] is True
    assert manage.position_view(PUT, 650.0, 124.99, TODAY)["profit_take_hit"] is False


def test_days_left_never_negative():
    assert manage.position_view({**PUT, "expiry": "2026-09-10"}, 650.0, 0.0, TODAY)["days_left"] == 0


def test_missing_quote_leaves_market_fields_empty():
    v = manage.position_view(PUT, spot=None, mtm=None, today=TODAY)
    assert v["distance_pct"] is None and v["profit_pct"] is None
    assert v["short_breached"] is None and v["profit_take_hit"] is False
    assert v["risk"] == 750.0