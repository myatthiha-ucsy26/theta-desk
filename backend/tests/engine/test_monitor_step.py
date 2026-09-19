import datetime as dt

import pytest

from tests import fakes as f
from theta.storage import db
from theta.engine import monitor

ACCOUNT = "live"

UTC = dt.timezone.utc


@pytest.fixture
def conn(tmp_path):
    c = f.db(tmp_path)
    yield c
    c.close()


def entered(conn, b, svc):
    monitor.enter(conn, f.decision(), db.get_settings(conn), svc, f.NOW)
    return db.list_live_trades(conn, account=ACCOUNT)[0]


def opened(conn, b, svc, credit=0.60):
    t = entered(conn, b, svc)
    b.fill(t["entry_order_id"], credit)
    monitor.step(conn, db.get_settings(conn), svc, f.NOW)
    return db.get_live_trade(conn, t["id"])


def later(minutes):
    return f.NOW + dt.timedelta(minutes=minutes)


def test_fill_records_credit_places_gtc_tp_and_tells_telegram(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc, credit=0.58)
    assert (t["state"], t["credit"], t["fees"], t["tp_tif"]) == ("open", 0.58, 1.0, "GTC")
    tp = b.placed[-1]
    assert (tp["opening"], tp["price"], tp["gtc"], tp["order_id"]) == (False, 0.29, True, t["tp_order_id"])
    assert "Opened" in svc["sent"][-1] and "731/726" in svc["sent"][-1]


def test_tp_falls_back_to_day_when_gtc_is_rejected(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = entered(conn, b, svc)
    b.fill(t["entry_order_id"])
    b.fail_place = ["place: GTC not supported for combo orders"]
    monitor.step(conn, db.get_settings(conn), svc, f.NOW)
    t = db.get_live_trade(conn, t["id"])
    assert t["tp_tif"] == "DAY" and b.placed[-1]["gtc"] is False


def test_unfilled_entry_steps_down_then_cancels(conn):
    b = f.FakeBroker()
    svc = f.services(b, quotes=lambda codes: {f.SHORT: {"bid": 2.70, "ask": 2.92}, f.LONG: {"bid": 2.20, "ask": 2.22}})
    t = entered(conn, b, svc)
    for i in range(1, 6):
        monitor.step(conn, db.get_settings(conn), svc, later(i))
    t = db.get_live_trade(conn, t["id"])
    assert [p for _, p in b.repriced] == [0.55, 0.50, 0.48]   # natural credit 2.70 - 2.22 = 0.48; then cancel
    assert t["state"] == "entry_cancelled" and b.cancelled == [t["entry_order_id"]]


def test_reprice_falls_back_to_cancel_and_replace(conn):
    b = f.FakeBroker()
    b.fail_reprice = True
    svc = f.services(b, quotes=lambda codes: {f.SHORT: {"bid": 2.70, "ask": 2.92}, f.LONG: {"bid": 2.20, "ask": 2.22}})
    t = entered(conn, b, svc)
    monitor.step(conn, db.get_settings(conn), svc, later(1))
    t = db.get_live_trade(conn, t["id"])
    assert b.cancelled == ["o1"] and t["entry_order_id"] == "o2" and b.placed[-1]["price"] == 0.55


def test_tp_fill_closes_with_pnl(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    b.fill(t["tp_order_id"], 0.30)
    monitor.step(conn, db.get_settings(conn), svc, later(5))
    t = db.get_live_trade(conn, t["id"])
    assert (t["state"], t["exit_reason"], t["close_debit"], t["pnl"]) == ("closed", "tp", 0.30, 28.0)  # 30 - 2 fees
    assert "Closed" in svc["sent"][-1]


def breach(codes):
    return {f.SHORT: {"bid": 5.00, "ask": 5.10}, f.LONG: {"bid": 3.20, "ask": 3.30}}   # mid 1.80 = 3x 0.60


def test_stop_loss_needs_two_checks_then_cancels_tp_and_closes_at_mid(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    svc["quotes"] = breach
    monitor.step(conn, db.get_settings(conn), svc, later(1))
    assert db.get_live_trade(conn, t["id"])["sl_hits"] == 1
    monitor.step(conn, db.get_settings(conn), svc, later(2))
    t2 = db.get_live_trade(conn, t["id"])
    assert t["tp_order_id"] in b.cancelled
    assert (t2["state"], t2["exit_reason"], t2["close_price"]) == ("closing", "sl", 1.80)
    assert (b.placed[-1]["opening"], b.placed[-1]["price"]) == (False, 1.80)


def test_stop_loss_resets_when_price_recovers(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    svc["quotes"] = breach
    monitor.step(conn, db.get_settings(conn), svc, later(1))
    svc["quotes"] = lambda codes: f.QUOTES
    monitor.step(conn, db.get_settings(conn), svc, later(2))
    assert db.get_live_trade(conn, t["id"])["sl_hits"] == 0


def test_tp_that_filled_during_the_cancel_books_as_tp(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    b.fill_on_cancel.add(t["tp_order_id"])
    svc["quotes"] = breach
    monitor.step(conn, db.get_settings(conn), svc, later(1))
    monitor.step(conn, db.get_settings(conn), svc, later(2))
    t = db.get_live_trade(conn, t["id"])
    assert (t["state"], t["exit_reason"]) == ("closed", "tp")
    assert not any(p["opening"] is False and p["price"] == 1.80 for p in b.placed)


def test_closing_order_raises_price_until_filled_and_alerts_after_three(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    svc["quotes"] = breach
    for i in (1, 2):
        monitor.step(conn, db.get_settings(conn), svc, later(i))
    for i in (3, 4, 5):
        monitor.step(conn, db.get_settings(conn), svc, later(i))
    t = db.get_live_trade(conn, t["id"])
    assert (t["close_price"], t["close_reprices"]) == (1.95, 3)
    assert any("still not filled" in m for m in svc["sent"])
    b.fill(t["close_order_id"], 1.95)
    monitor.step(conn, db.get_settings(conn), svc, later(6))
    t = db.get_live_trade(conn, t["id"])
    assert (t["state"], t["pnl"]) == ("closed", -137.0)  # (0.60 - 1.95) * 100 - 2 fees


def test_ai_exit_closes_and_is_checked_hourly(conn):
    b = f.FakeBroker()
    calls = []
    svc = f.services(b, ai_exit=lambda trade, spot, mid: calls.append(mid) or ("HOLD", "calm"))
    t = opened(conn, b, svc)
    monitor.step(conn, db.get_settings(conn), svc, later(30))
    assert len(calls) == 1
    svc["ai_exit"] = lambda trade, spot, mid: ("EXIT", "CPI surprise risk tomorrow")
    monitor.step(conn, db.get_settings(conn), svc, later(91))
    t = db.get_live_trade(conn, t["id"])
    assert (t["state"], t["exit_reason"]) == ("closing", "ai")
    assert any("CPI surprise" in m for m in svc["sent"])


def test_expiry_day_close_at_3pm_new_york(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    monitor.step(conn, db.get_settings(conn), svc, dt.datetime(2026, 9, 30, 19, 0, tzinfo=UTC))
    assert db.get_live_trade(conn, t["id"])["exit_reason"] == "expiry"


def test_dead_day_tp_is_placed_again(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    b.orders[t["tp_order_id"]]["status"] = "CANCELLED_ALL"
    monitor.step(conn, db.get_settings(conn), svc, later(5))
    assert db.get_live_trade(conn, t["id"])["tp_order_id"] != t["tp_order_id"]


def test_one_failing_trade_does_not_stop_the_others_and_step_reports_it(conn):
    b = f.FakeBroker()
    svc = f.services(b)
    t = opened(conn, b, svc)
    svc["quotes"] = lambda codes: (_ for _ in ()).throw(RuntimeError("OpenD disconnected"))
    with pytest.raises(RuntimeError, match="OpenD disconnected"):
        monitor.step(conn, db.get_settings(conn), svc, later(1))
