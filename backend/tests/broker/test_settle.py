import datetime as dt

from theta.broker import settle


def _t(expiry, status="open"):
    return {"id": f"x{expiry}", "expiry": expiry, "status": status}


def test_due_for_settlement_picks_up_past_expiry():
    trades = [_t("2026-09-10")]
    assert settle.due_for_settlement(trades, dt.date(2026, 9, 16)) == trades


def test_due_for_settlement_ignores_future_expiry():
    assert settle.due_for_settlement([_t("2026-09-25")], dt.date(2026, 9, 16)) == []


def test_due_for_settlement_ignores_expiry_day_itself():
    """On expiry day the position is still live until the close."""
    assert settle.due_for_settlement([_t("2026-09-16")], dt.date(2026, 9, 16)) == []


def test_due_for_settlement_ignores_already_closed():
    assert settle.due_for_settlement(
        [_t("2026-09-10", status="closed")], dt.date(2026, 9, 16)
    ) == []


def test_due_for_settlement_handles_empty():
    assert settle.due_for_settlement([], dt.date(2026, 9, 16)) == []


import pandas as pd


def _df(rows):
    return pd.DataFrame({
        "date": pd.to_datetime([d for d, _ in rows]),
        "close": [c for _, c in rows],
    })


def test_settlement_close_uses_close_on_expiry_day():
    df = _df([("2026-09-17", 101.0), ("2026-09-18", 104.0), ("2026-09-21", 90.0)])
    assert settle.settlement_close(df, "2026-09-18") == 104.0


def test_settlement_close_ignores_prices_after_expiry():
    """THE REGRESSION. A crash three days after expiry must not touch the result."""
    df = _df([("2026-09-18", 104.0), ("2026-09-21", 50.0), ("2026-09-22", 40.0)])
    assert settle.settlement_close(df, "2026-09-18") == 104.0


def test_settlement_close_falls_back_to_prior_session_on_holiday():
    # Expiry lands on a market holiday: settle at the last session before it.
    df = _df([("2026-09-17", 99.0), ("2026-09-21", 70.0)])
    assert settle.settlement_close(df, "2026-09-18") == 99.0


def test_settlement_close_none_when_no_bar_near_expiry():
    df = _df([("2026-09-01", 99.0)])
    assert settle.settlement_close(df, "2026-09-18") is None


def test_settlement_close_none_when_only_later_bars():
    df = _df([("2026-09-21", 99.0)])
    assert settle.settlement_close(df, "2026-09-18") is None


def test_settlement_close_none_for_empty_frame():
    assert settle.settlement_close(_df([]), "2026-09-18") is None