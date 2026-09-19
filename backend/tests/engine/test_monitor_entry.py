import datetime as dt

import pytest

from tests import fakes as f
from theta.storage import db
from theta.engine import monitor

ACCOUNT = "live"


@pytest.fixture
def conn(tmp_path):
    c = f.db(tmp_path)
    yield c
    c.close()


def test_enter_sends_a_five_wide_combo_at_mid_and_records_it(conn):
    b = f.FakeBroker()
    out = monitor.enter(conn, f.decision(), db.get_settings(conn), f.services(b), f.NOW)
    assert out == "entry sent: SPY 731/726 at $0.60 credit"
    [p] = b.placed
    assert (p["short"], p["long"], p["opening"], p["price"], p["qty"], p["gtc"]) == (f.SHORT, f.LONG, True, 0.60, 1, False)
    [t] = db.list_live_trades(conn, account=ACCOUNT)
    assert p["remark"] == f"csbot:{t['id']}"
    assert (t["state"], t["entry_order_id"], t["planned_credit"], t["ai_reason"]) == ("entering", "o1", 0.60, "no events this week")
    assert db.recent_order_events(conn)[0]["action"] == "place_entry"


def test_enter_skips_when_manual_or_paused(conn):
    b = f.FakeBroker()
    s = db.get_settings(conn)
    assert monitor.enter(conn, f.decision(), {**s, "mode": "manual"}, f.services(b), f.NOW) == "skipped: auto mode is off"
    assert "stopped by you" in monitor.enter(conn, f.decision(), {**s, "bot_paused": True, "bot_pause_reason": "stopped by you"}, f.services(b), f.NOW)
    assert b.placed == []


def test_enter_respects_one_slot(conn):
    b = f.FakeBroker()
    s = db.get_settings(conn)
    monitor.enter(conn, f.decision("SPY"), s, f.services(b), f.NOW)
    out = monitor.enter(conn, f.decision("QQQ"), s, f.services(b), f.NOW)
    assert out.startswith("skipped:") and "slot" in out
    assert len(b.placed) == 1


def test_enter_skips_without_a_five_wide_strike(conn):
    b = f.FakeBroker()
    legs = [l for l in f.LEGS if l["strike"] != 726.0]
    out = monitor.enter(conn, f.decision(), db.get_settings(conn), f.services(b, legs=lambda *a: legs), f.NOW)
    assert out == "skipped: no 5-wide spread at the target delta"


def test_enter_skips_when_the_credit_is_too_small(conn):
    b = f.FakeBroker()
    s = {**db.get_settings(conn), "min_credit": 0.80}
    assert "below minimum" in monitor.enter(conn, f.decision(), s, f.services(b), f.NOW)


def test_rejection_is_logged_and_three_in_a_row_pause(conn):
    b = f.FakeBroker()
    b.fail_place = ["place: no buying power"] * 3
    svc = f.services(b)
    for _ in range(3):
        out = monitor.enter(conn, f.decision(), db.get_settings(conn), svc, f.NOW)
    assert out == "rejected: place: no buying power"
    s = db.get_settings(conn)
    assert s["bot_paused"] is True and "3 orders rejected" in s["bot_pause_reason"]
    assert len(svc["sent"]) == 1 and "Bot paused" in svc["sent"][0]
    assert db.list_live_trades(conn, account=ACCOUNT) == []


def test_unlock_failure_pauses_immediately_and_says_to_unlock_in_opend(conn):
    b = f.FakeBroker()
    b.fail_place = ["unlock: Trade is locked"]
    monitor.enter(conn, f.decision(), db.get_settings(conn), f.services(b), f.NOW)
    reason = db.get_settings(conn)["bot_pause_reason"]
    assert "Unlock button in OpenD" in reason and "Trade is locked" in reason


def test_enter_uses_the_latest_pause_not_the_cycle_start_settings(conn):
    """Stop trading pressed mid-cycle must stop the rest of that cycle."""
    b = f.FakeBroker()
    stale = db.get_settings(conn)
    db.put_settings(conn, {"bot_paused": True, "bot_pause_reason": "stopped by you"})
    out = monitor.enter(conn, f.decision(), stale, f.services(b), f.NOW)
    assert "stopped by you" in out and b.placed == []
