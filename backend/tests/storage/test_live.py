import pytest

from theta.storage import db


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "live.db"))
    db.init(c)
    yield c
    c.close()


def trade(id="t1", **over):
    t = {
        "id": id, "ticker": "SPY", "direction": "SELL_PUT", "expiry": "2026-09-30",
        "short_code": "US.SPY260930P731000", "long_code": "US.SPY260930P726000",
        "short_strike": 731.0, "long_strike": 726.0, "width": 5.0, "contracts": 1,
        "planned_credit": 0.60, "state": "entering", "entry_order_id": "o1", "entry_price": 0.60,
        "opened_at": "2026-09-16T15:00:00+00:00",
    }
    t.update(over)
    return t


def test_insert_get_update_live_trade(conn):
    db.insert_live_trade(conn, trade())
    db.update_live_trade(conn, "t1", state="open", credit=0.58, filled_at="2026-09-16T15:01:00+00:00")
    t = db.get_live_trade(conn, "t1")
    assert (t["state"], t["credit"], t["sl_hits"], t["fees"]) == ("open", 0.58, 0, 0)
    assert db.get_live_trade(conn, "nope") is None


def test_update_rejects_unknown_field(conn):
    db.insert_live_trade(conn, trade())
    with pytest.raises(ValueError, match="bogus"):
        db.update_live_trade(conn, "t1", bogus=1)


def test_list_live_trades_filters_by_state_oldest_first(conn):
    db.insert_live_trade(conn, trade("b", opened_at="2026-09-16T16:00:00+00:00", state="open"))
    db.insert_live_trade(conn, trade("a", opened_at="2026-09-16T15:00:00+00:00", state="closed"))
    assert [t["id"] for t in db.list_live_trades(conn)] == ["a", "b"]
    assert [t["id"] for t in db.list_live_trades(conn, db.ACTIVE_STATES)] == ["b"]


def test_order_events_newest_first_and_rejection_streak(conn):
    ts = "2026-09-16T15:00:00+00:00"
    db.log_order_event(conn, ts, "place_entry", "rejected", reason="no bp")
    db.log_order_event(conn, ts, "place_tp", "sent")
    db.log_order_event(conn, ts, "ai_check", "HOLD")
    db.log_order_event(conn, ts, "place_close", "rejected")
    db.log_order_event(conn, ts, "place_close", "rejected")
    assert db.consecutive_rejections(conn) == 2
    assert db.recent_order_events(conn, 1)[0]["action"] == "place_close"


def test_bot_pnl_entries_and_cancellations(conn):
    db.insert_live_trade(conn, trade("w", state="closed", pnl=120.0, closed_at="2026-09-15T15:00:00+00:00"))
    db.insert_live_trade(conn, trade("l", state="closed", pnl=-40.0, closed_at="2026-09-16T15:00:00+00:00"))
    db.insert_live_trade(conn, trade("c", state="entry_cancelled"))
    assert db.bot_net_pnl(conn) == 80.0
    assert db.bot_net_pnl(conn, since_ts="2026-09-16T00:00:00+00:00") == -40.0
    assert db.bot_entries_since(conn, "2026-09-14T04:00:00+00:00") == 2
    assert db.cancelled_since(conn, "SPY", "2026-09-16T00:00:00+00:00") == 1


def test_bot_net_pnl_is_zero_with_no_closed_trades(conn):
    assert db.bot_net_pnl(conn) == 0.0
