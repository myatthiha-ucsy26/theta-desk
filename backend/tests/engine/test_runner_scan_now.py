import datetime as dt
import time

import pytest

from theta.storage import db as store
from theta.engine import runner
from tests.engine.test_runner import CLOSED, EDGE, OPEN, Services, make_runner


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "engine.db")
    conn = store.connect(path)
    store.init(conn)
    store.put_settings(conn, {"watchlist": ["AAA", "BBB"], "dtes": [14], "ai_enabled": False})
    store.save_edge_table(conn, EDGE, "2026-09-16T14:00:00+00:00")
    yield path, conn
    conn.close()


def test_forced_tick_scans_even_when_the_engine_is_off(db):
    path, conn = db
    svc = Services()
    r = make_runner(path, svc, OPEN, [])
    r.tick(force=True)
    assert r.status["state"] == "idle"
    assert len(svc.evaluated) == 2
    assert r.status["last_trigger"] == "manual"


def test_forced_tick_scans_outside_market_hours(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})
    svc = Services()
    make_runner(path, svc, CLOSED, []).tick(force=True)
    assert len(svc.evaluated) == 2


def test_scheduled_tick_still_respects_the_switch(db):
    path, conn = db
    svc = Services()
    r = make_runner(path, svc, OPEN, [])
    r.tick()
    assert r.status["state"] == "disabled" and svc.evaluated == []


def test_scheduled_tick_records_its_trigger(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})
    r = make_runner(path, Services(), OPEN, [])
    r.tick()
    assert r.status["last_trigger"] == "schedule"


def test_request_scan_needs_a_running_thread(db):
    path, conn = db
    ok, reason = make_runner(path, Services(), OPEN, []).request_scan()
    assert ok is False and "not running" in reason


def test_request_scan_refuses_while_a_cycle_is_running(db):
    path, conn = db
    r = make_runner(path, Services(), OPEN, [])
    r.start()
    try:
        r._busy = True
        ok, reason = r.request_scan()
        assert ok is False and "already" in reason
    finally:
        r._busy = False
        r.stop(timeout=5)


def test_request_scan_wakes_an_idle_engine_immediately(db):
    """Engine off: the loop is parked for 60 seconds. Scan now must not wait for that."""
    path, conn = db
    svc = Services()
    r = make_runner(path, svc, OPEN, [])
    r.start()
    try:
        deadline = time.monotonic() + 5
        while r.status["state"] != "disabled" and time.monotonic() < deadline:
            time.sleep(0.01)
        assert svc.evaluated == []
        ok, _ = r.request_scan()
        assert ok is True
        deadline = time.monotonic() + 5
        while len(svc.evaluated) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(svc.evaluated) == 2
    finally:
        r.stop(timeout=5)
    assert r.running is False


def test_enabling_the_engine_wakes_an_idle_engine_immediately(db):
    """Engine off: the loop is parked for 60 seconds. Turning the switch on must not wait for it."""
    path, conn = db
    svc = Services()
    r = make_runner(path, svc, OPEN, [])
    r.start()
    try:
        deadline = time.monotonic() + 5
        while r.status["state"] != "disabled" and time.monotonic() < deadline:
            time.sleep(0.01)
        assert svc.evaluated == []
        store.put_settings(conn, {"engine_enabled": True})
        r.wake()
        deadline = time.monotonic() + 5
        while len(svc.evaluated) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        assert len(svc.evaluated) == 2
    finally:
        r.stop(timeout=5)


def test_stop_is_not_delayed_by_the_wait(db):
    path, conn = db
    r = make_runner(path, Services(), OPEN, [])
    r.start()
    time.sleep(0.05)
    started = time.monotonic()
    r.stop(timeout=5)
    assert time.monotonic() - started < 2 and r.running is False
