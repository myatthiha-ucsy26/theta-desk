import datetime as dt

import pytest

from theta.engine import autotrade as at

UTC = dt.timezone.utc


def leg(strike, delta, code=None, bid=1.0, ask=1.1):
    return {"strike": strike, "delta": delta, "price": (bid + ask) / 2, "code": code or f"C{strike:g}",
            "bid": bid, "ask": ask, "oi": 500, "iv": 0.2}


PUTS = [leg(721, -0.18), leg(726, -0.24), leg(731, -0.30), leg(736, -0.37)]
CALLS = [leg(780, 0.36), leg(785, 0.29), leg(790, 0.22)]


def test_five_wide_put_takes_long_five_below_the_short():
    pair = at.five_wide(PUTS, "SELL_PUT")
    assert (pair["short"]["strike"], pair["long"]["strike"]) == (731, 726)


def test_five_wide_call_takes_long_five_above_the_short():
    pair = at.five_wide(CALLS, "SELL_CALL")
    assert (pair["short"]["strike"], pair["long"]["strike"]) == (785, 790)


def test_five_wide_none_when_the_strike_does_not_exist():
    assert at.five_wide([leg(731, -0.30), leg(727.5, -0.25)], "SELL_PUT") is None
    assert at.five_wide(PUTS, "NO_TRADE") is None
    assert at.five_wide([], "SELL_PUT") is None


def test_spread_prices():
    p = at.spread_prices({"bid": 2.80, "ask": 2.82}, {"bid": 2.20, "ask": 2.22})
    assert p == {"mid": 0.60, "natural_credit": 0.58, "natural_debit": 0.62}


@pytest.mark.parametrize("pnl, slots, next_at", [(-300, 1, 500), (0, 1, 500), (499, 1, 500),
                                                 (500, 2, 1000), (1250, 3, 1500)])
def test_slots_compound_every_500_of_profit(pnl, slots, next_at):
    assert at.slots(pnl) == slots
    assert at.next_slot_at(pnl) == next_at


def test_max_loss():
    assert at.max_loss(0.60) == 440.0


def test_week_and_day_start_in_new_york():
    now = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)  # Wed 11:00 EDT
    assert at.week_start(now) == dt.datetime(2026, 9, 14, 4, 0, tzinfo=UTC)
    assert at.day_start(now) == dt.datetime(2026, 9, 16, 4, 0, tzinfo=UTC)


@pytest.mark.parametrize("h, m, ok", [(13, 44, False), (13, 45, True), (19, 29, True), (19, 30, False)])
def test_entry_window_skips_first_15_and_last_30_minutes(h, m, ok):
    assert at.in_entry_window(dt.datetime(2026, 9, 16, h, m, tzinfo=UTC)) is ok


def state(**over):
    s = {"mode": "auto", "paused": False, "pause_reason": "", "now": dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC),
         "day_pnl": 0.0, "open_count": 0, "week_entries": 0, "net_pnl": 0.0, "ticker_active": False,
         "cancelled_today": False, "buying_power": 1000.0, "max_loss": 440.0}
    s.update(over)
    return s


def test_entry_allowed_when_everything_is_clear():
    assert at.entry_block(state()) is None


@pytest.mark.parametrize("over, words", [
    ({"mode": "manual"}, "auto mode is off"),
    ({"paused": True, "pause_reason": "stopped by you"}, "stopped by you"),
    ({"day_pnl": -500.0}, "daily loss"),
    ({"now": dt.datetime(2026, 9, 16, 13, 40, tzinfo=UTC)}, "entry window"),
    ({"open_count": 1}, "slot"),
    ({"week_entries": 1}, "this week"),
    ({"ticker_active": True}, "already active"),
    ({"cancelled_today": True}, "cancelled today"),
    ({"buying_power": 300.0}, "buying power"),
])
def test_entry_blocks(over, words):
    assert words in at.entry_block(state(**over))


def test_second_slot_after_500_profit_allows_a_second_entry():
    assert at.entry_block(state(net_pnl=520.0, open_count=1, week_entries=1)) is None
    assert "slot" in at.entry_block(state(net_pnl=520.0, open_count=2, week_entries=1))


def test_price_block():
    assert at.price_block(0.62, 0.60, 0.30) is None
    assert "below minimum" in at.price_block(0.30, 0.25, 0.30)
    assert "fell" in at.price_block(1.00, 0.85, 0.30)


def test_entry_reprice_steps_down_to_the_natural_credit_then_stops():
    assert at.next_entry_price(0.60, 0.52) == 0.55
    assert at.next_entry_price(0.55, 0.52) == 0.52
    assert at.next_entry_price(0.52, 0.52) is None


def test_close_reprice_steps_up_without_a_cap():
    assert at.next_close_price(1.80) == 1.85


def test_tp_and_sl_levels():
    assert at.tp_price(0.60, 50) == 0.30
    assert at.tp_price(0.01, 99) == 0.01
    assert at.sl_breached(1.80, 0.60, 2.0) is True
    assert at.sl_breached(1.79, 0.60, 2.0) is False


@pytest.mark.parametrize("when, due", [
    (dt.datetime(2026, 9, 30, 18, 59, tzinfo=UTC), False),  # 14:59 NY on expiry day
    (dt.datetime(2026, 9, 30, 19, 0, tzinfo=UTC), True),
    (dt.datetime(2026, 10, 1, 14, 0, tzinfo=UTC), True),
    (dt.datetime(2026, 9, 29, 19, 30, tzinfo=UTC), False),
])
def test_expiry_close_due_at_3pm_new_york(when, due):
    assert at.expiry_close_due("2026-09-30", when) is due


def test_ai_check_due_hourly():
    now = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)
    assert at.ai_check_due(None, now)
    assert not at.ai_check_due("2026-09-16T14:30:00+00:00", now)
    assert at.ai_check_due("2026-09-16T14:00:00+00:00", now)


def test_realised_pnl():
    assert at.realised_pnl(0.60, 0.30, 1, 2.5) == 27.5


def open_trade(**over):
    t = {"state": "open", "filled_at": "2026-09-16T14:00:00+00:00", "contracts": 1,
         "short_code": "S", "long_code": "L"}
    t.update(over)
    return t


def test_reconcile_clean_when_legs_match():
    now = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)
    positions = [{"code": "S", "qty": -1.0}, {"code": "L", "qty": 1.0}, {"code": "US.AAPL", "qty": 10.0}]
    assert at.reconcile([open_trade()], positions, now) == []


def test_reconcile_flags_a_missing_short_leg_like_an_assignment():
    now = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)
    problems = at.reconcile([open_trade()], [{"code": "L", "qty": 1.0}], now)
    assert problems == ["S: expected -1, account holds +0"]


def test_reconcile_ignores_just_filled_and_non_open_trades():
    now = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)
    fresh = open_trade(filled_at="2026-09-16T14:59:00+00:00")
    closing = open_trade(state="closing")
    assert at.reconcile([fresh, closing], [], now) == []
