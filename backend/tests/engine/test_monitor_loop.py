import datetime as dt

import pytest

from tests import fakes as f
from theta.storage import db
from theta.engine import monitor

UTC = dt.timezone.utc
SATURDAY = dt.datetime(2026, 9, 19, 15, 0, tzinfo=UTC)


@pytest.fixture
def path(tmp_path):
    f.db(tmp_path).close()
    return str(tmp_path / "bot.db")


def with_conn(path, fn):
    conn = db.connect(path)
    try:
        return fn(conn)
    finally:
        conn.close()


def open_trade(path, b, svc):
    def go(conn):
        monitor.enter(conn, f.decision(), db.get_settings(conn), svc, f.NOW)
        t = db.list_live_trades(conn)[0]
        b.fill(t["entry_order_id"])
        monitor.step(conn, db.get_settings(conn), svc, f.NOW)
        return db.get_live_trade(conn, t["id"])
    return with_conn(path, go)


def test_recover_flags_unknown_bot_orders_and_leg_mismatch(path):
    b = f.FakeBroker()
    svc = f.services(b)
    t = open_trade(path, b, svc)
    b.orders["x9"] = {"order_id": "x9", "status": "SUBMITTED", "price": 1.0, "dealt_qty": 0,
                      "dealt_avg_price": 0, "remark": "csbot:ghost", "error": ""}
    later = f.NOW + dt.timedelta(minutes=10)
    problems = with_conn(path, lambda c: monitor.recover(c, svc, later))
    assert any("ghost" in p for p in problems)
    assert any(f.SHORT in p for p in problems)   # FakeBroker holds no positions
    b.pos = [{"code": f.SHORT, "qty": -1.0}, {"code": f.LONG, "qty": 1.0}]
    del b.orders["x9"]
    assert with_conn(path, lambda c: monitor.recover(c, svc, later)) == []


def test_stop_trading_pauses_and_cancels_working_entries(path):
    b = f.FakeBroker()
    svc = f.services(b)
    with_conn(path, lambda c: monitor.enter(c, f.decision(), db.get_settings(c), svc, f.NOW))
    with_conn(path, lambda c: monitor.stop_trading(c, svc, f.NOW))
    s = with_conn(path, db.get_settings)
    assert s["bot_paused"] is True and s["bot_pause_reason"] == "stopped by you"
    assert b.cancelled == ["o1"]


def test_resume_allows_entries_again_and_says_so(path):
    svc = f.services(f.FakeBroker())
    with_conn(path, lambda c: monitor.pause(c, svc, "stopped by you", f.NOW))
    svc["sent"].clear()

    with_conn(path, lambda c: monitor.resume(c, svc, f.NOW))

    s = with_conn(path, db.get_settings)
    assert s["bot_paused"] is False and s["bot_pause_reason"] == ""
    assert len(svc["sent"]) == 1 and "Bot resumed" in svc["sent"][0]


def test_resume_already_running_says_nothing(path):
    svc = f.services(f.FakeBroker())

    with_conn(path, lambda c: monitor.resume(c, svc, f.NOW))

    assert svc["sent"] == []


def test_close_all_closes_open_spreads_and_stops(path):
    b = f.FakeBroker()
    svc = f.services(b)
    t = open_trade(path, b, svc)
    n = with_conn(path, lambda c: monitor.close_all(c, svc, f.NOW))
    t = with_conn(path, lambda c: db.get_live_trade(c, t["id"]))
    assert n == 1 and (t["state"], t["exit_reason"]) == ("closing", "manual")
    assert with_conn(path, db.get_settings)["bot_paused"] is True


def test_tick_is_idle_without_trades_and_waits_when_market_closed(path):
    b = f.FakeBroker()
    svc = f.services(b)
    m = monitor.Monitor(path, svc, now_fn=lambda: f.NOW)
    m.tick()
    assert m.status["state"] == "idle"
    open_trade(path, b, svc)
    m.now_fn = lambda: SATURDAY
    m.tick()
    assert m.status["state"] == "market closed"


def test_tick_pauses_after_two_consecutive_mismatches(path):
    b = f.FakeBroker()
    svc = f.services(b)
    open_trade(path, b, svc)
    b.pos = [{"code": f.SHORT, "qty": -1.0}, {"code": f.LONG, "qty": 1.0}]
    clock = {"now": f.NOW + dt.timedelta(minutes=5)}
    m = monitor.Monitor(path, svc, now_fn=lambda: clock["now"])
    m.tick()
    assert m.status["state"] == "watching"
    b.pos = [{"code": f.LONG, "qty": 1.0}]        # short leg assigned away
    m.tick()
    assert with_conn(path, db.get_settings)["bot_paused"] is False
    m.tick()
    assert "position mismatch" in with_conn(path, db.get_settings)["bot_pause_reason"]


def test_watchdog_alerts_once_when_trades_are_unwatched_for_three_minutes(path):
    b = f.FakeBroker()
    svc = f.services(b)
    open_trade(path, b, svc)
    b.pos = [{"code": f.SHORT, "qty": -1.0}, {"code": f.LONG, "qty": 1.0}]
    clock = {"now": f.NOW + dt.timedelta(minutes=5)}
    m = monitor.Monitor(path, svc, now_fn=lambda: clock["now"])
    m.tick()
    svc["quotes"] = lambda codes: (_ for _ in ()).throw(RuntimeError("OpenD disconnected"))
    for minutes in (6, 7, 8, 9, 10):
        clock["now"] = f.NOW + dt.timedelta(minutes=minutes)
        m.tick()
    alerts = [msg for msg in svc["sent"] if "NOT being watched" in msg]
    assert m.status["state"] == "error" and len(alerts) == 1
