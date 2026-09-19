import datetime as dt

import pytest

from theta.storage import db
from theta.engine import scan
from theta.engine import runner
from tests.engine.test_runner import CLOSED, EDGE, OPEN, Services, make_runner

UTC = dt.timezone.utc


def S(**over):
    s = {k: (list(v) if isinstance(v, list) else v) for k, v in db.DEFAULT_SETTINGS.items()}
    s.update({"engine_enabled": True}, **over)
    return s


# ---------------- next_market_open ----------------

@pytest.mark.parametrize("now, expected", [
    (dt.datetime(2026, 9, 16, 12, 0, tzinfo=UTC), dt.datetime(2026, 9, 16, 13, 30, tzinfo=UTC)),  # Wed before open
    (dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC), dt.datetime(2026, 9, 17, 13, 30, tzinfo=UTC)),  # Wed during session
    (dt.datetime(2026, 9, 18, 21, 0, tzinfo=UTC), dt.datetime(2026, 9, 21, 13, 30, tzinfo=UTC)),  # Fri after close
    (dt.datetime(2026, 9, 19, 15, 0, tzinfo=UTC), dt.datetime(2026, 9, 21, 13, 30, tzinfo=UTC)),  # Saturday
    (dt.datetime(2026, 1, 14, 12, 0, tzinfo=UTC), dt.datetime(2026, 1, 14, 14, 30, tzinfo=UTC)),  # winter (EST)
])
def test_next_market_open(now, expected):
    assert scan.next_market_open(now) == expected


# ---------------- next_scan_at ----------------

def test_next_scan_after_a_cycle_is_one_interval_later():
    assert runner.next_scan_at("idle", S(interval_min=15), OPEN) == "2026-09-16T15:15:00+00:00"


def test_next_scan_jumps_to_market_open_when_the_interval_ends_after_the_close():
    near_close = dt.datetime(2026, 9, 16, 19, 50, tzinfo=UTC)  # 3:50 PM New York
    assert runner.next_scan_at("idle", S(interval_min=15), near_close) == "2026-09-17T13:30:00+00:00"


def test_next_scan_ignores_market_hours_when_that_setting_is_off():
    near_close = dt.datetime(2026, 9, 16, 19, 50, tzinfo=UTC)
    assert runner.next_scan_at("idle", S(interval_min=15, market_hours_only=False), near_close) \
        == "2026-09-16T20:05:00+00:00"


def test_next_scan_while_market_closed_is_the_next_open():
    assert runner.next_scan_at("market closed", S(), CLOSED) == "2026-09-21T13:30:00+00:00"


def test_no_next_scan_while_the_engine_is_off():
    assert runner.next_scan_at("disabled", S(engine_enabled=False), OPEN) is None
    # A manual scan while the switch is off leaves the state idle, but nothing is scheduled.
    assert runner.next_scan_at("idle", S(engine_enabled=False), OPEN) is None


def test_next_scan_after_an_error_is_the_retry():
    assert runner.next_scan_at("error", S(), OPEN) == "2026-09-16T15:01:00+00:00"


def test_no_next_scan_without_settings():
    assert runner.next_scan_at("error", None, OPEN) is None


# ---------------- runner status ----------------

def test_runner_status_starts_with_no_next_scan(tmp_path):
    r = make_runner(str(tmp_path / "e.db"), Services(), OPEN, [])
    assert r.status["next_scan_at"] is None


def test_loop_publishes_next_scan_after_a_tick(tmp_path):
    import time
    path = str(tmp_path / "engine.db")
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"engine_enabled": True, "watchlist": ["AAA"], "dtes": [14], "ai_enabled": False})
    db.save_edge_table(conn, EDGE, "2026-09-16T14:00:00+00:00")
    conn.close()
    r = make_runner(path, Services(), OPEN, [])
    r.start()
    try:
        deadline = time.monotonic() + 5
        while r.status["next_scan_at"] is None and time.monotonic() < deadline:
            time.sleep(0.01)
        assert r.status["next_scan_at"] == "2026-09-16T15:15:00+00:00"
    finally:
        r.stop(timeout=5)
