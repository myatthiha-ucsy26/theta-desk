"""Account scoping and the migration that introduced it."""
import sqlite3

import pytest

from theta.storage import db


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "a.db"))
    db.init(c)
    yield c
    c.close()


def position(id, account, **over):
    p = {"id": id, "account": account, "ticker": "SPY", "direction": "SELL_PUT",
         "short_strike": 100.0, "long_strike": 95.0, "width": 5.0, "credit": 1.0,
         "contracts": 1, "entry_date": "2026-09-01", "expiry": "2026-09-30",
         "mode": "ivrich", "status": "open", "close_date": None, "close_pnl": None}
    p.update(over)
    return p


def live(id, account, **over):
    t = {"id": id, "account": account, "ticker": "SPY", "direction": "SELL_PUT",
         "expiry": "2026-09-30", "short_code": "S", "long_code": "L",
         "short_strike": 100.0, "long_strike": 95.0, "width": 5.0, "contracts": 1,
         "planned_credit": 0.6, "state": "open", "opened_at": "2026-09-16T15:00:00+00:00"}
    t.update(over)
    return t


def test_positions_are_scoped_to_their_account(conn):
    db.insert_position(conn, position("p1", "paper"))
    db.insert_position(conn, position("l1", "live"))
    assert [p["id"] for p in db.list_positions(conn, account="paper")] == ["p1"]
    assert [p["id"] for p in db.list_positions(conn, account="live")] == ["l1"]


def test_live_trades_are_scoped_to_their_account(conn):
    db.insert_live_trade(conn, live("p1", "paper"))
    db.insert_live_trade(conn, live("l1", "live"))
    assert [t["id"] for t in db.list_live_trades(conn, account="paper")] == ["p1"]
    assert [t["id"] for t in db.list_live_trades(conn, ("open",), account="live")] == ["l1"]


def test_pnl_never_totals_the_two_accounts_together(conn):
    """The number that matters most is the one a mix-up would corrupt."""
    closed = {"state": "closed", "closed_at": "2026-09-17T15:00:00+00:00"}
    db.insert_live_trade(conn, live("p1", "paper", pnl=1000.0, **closed))
    db.insert_live_trade(conn, live("l1", "live", pnl=-50.0, **closed))
    assert db.bot_net_pnl(conn, account="paper") == 1000.0
    assert db.bot_net_pnl(conn, account="live") == -50.0


def test_the_account_must_be_named(conn):
    """Forgetting it is a TypeError, not a quietly wrong total."""
    with pytest.raises(TypeError):
        db.list_positions(conn)
    with pytest.raises(TypeError):
        db.list_live_trades(conn)
    with pytest.raises(TypeError):
        db.bot_net_pnl(conn)


def test_a_live_trade_needs_an_account(conn):
    with pytest.raises(ValueError, match="account"):
        db.insert_live_trade(conn, {k: v for k, v in live("x", "live").items() if k != "account"})


def test_open_live_trades_are_reported_for_the_switch_guard(conn):
    db.insert_live_trade(conn, live("open1", "live", state="open"))
    db.insert_live_trade(conn, live("done", "live", state="closed"))
    db.insert_live_trade(conn, live("paper1", "paper", state="open"))
    assert [t["id"] for t in db.open_live_trades_any_account(conn, "live")] == ["open1"]


def test_migration_adds_accounts_to_a_database_that_predates_them(tmp_path):
    """An existing engine.db keeps its rows, and they land in the right account:
    everything hand-recorded was paper, everything the bot placed was real."""
    path = str(tmp_path / "old.db")
    old = sqlite3.connect(path)
    old.executescript("""
        CREATE TABLE positions (
            id TEXT PRIMARY KEY, ticker TEXT, direction TEXT, short_strike REAL,
            long_strike REAL, width REAL, credit REAL, contracts INTEGER,
            entry_date TEXT, expiry TEXT, mode TEXT, status TEXT,
            close_date TEXT, close_pnl REAL, entry_context TEXT);
        CREATE TABLE live_trades (
            id TEXT PRIMARY KEY, ticker TEXT, direction TEXT, expiry TEXT,
            short_code TEXT, long_code TEXT, short_strike REAL, long_strike REAL,
            width REAL, contracts INTEGER, planned_credit REAL, state TEXT,
            entry_reprices INTEGER DEFAULT 0, sl_hits INTEGER DEFAULT 0,
            close_reprices INTEGER DEFAULT 0, fees REAL DEFAULT 0, opened_at TEXT);
    """)
    old.execute("INSERT INTO positions (id, ticker, status, entry_date) "
                "VALUES ('old_p', 'SPY', 'open', '2026-09-01')")
    old.execute("INSERT INTO live_trades (id, ticker, state, opened_at) "
                "VALUES ('old_l', 'SPY', 'open', '2026-09-01T00:00:00+00:00')")
    old.commit()
    old.close()

    conn = db.connect(path)
    db.init(conn)
    try:
        assert [p["id"] for p in db.list_positions(conn, account="paper")] == ["old_p"]
        assert [t["id"] for t in db.list_live_trades(conn, account="live")] == ["old_l"]
        db.init(conn)        # running it again must not fail or duplicate
        assert len(db.list_positions(conn, account="paper")) == 1
    finally:
        conn.close()
