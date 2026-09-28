
import pytest

from theta.storage import db

ACCOUNT = "paper"


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "engine.db"))
    db.init(c)
    yield c
    c.close()


def _trade(id_="pt_1", **kw):
    t = {
        "account": ACCOUNT, "id": id_, "ticker": "META", "direction": "SELL_PUT",
        "short_strike": 600.0, "long_strike": 595.0, "width": 5.0, "credit": 1.25,
        "contracts": 1, "entry_date": "2026-09-01", "expiry": "2026-09-15",
        "mode": "ivrich", "status": "open", "close_date": None, "close_pnl": None,
    }
    t.update(kw)
    return t


def test_init_is_idempotent(conn):
    db.init(conn)
    db.init(conn)
    assert db.list_positions(conn, account=ACCOUNT) == []


def test_insert_then_list_round_trips_every_field(conn):
    db.insert_position(conn, _trade())
    rows = db.list_positions(conn, account=ACCOUNT)
    assert len(rows) == 1
    for k, v in _trade().items():
        assert rows[0][k] == v


def test_insert_duplicate_id_raises(conn):
    db.insert_position(conn, _trade())
    with pytest.raises(ValueError):
        db.insert_position(conn, _trade())


def test_entry_context_round_trips_as_dict(conn):
    ctx = {"rsi": 31.2, "iv_rank": 0.8, "gates": ["signal", "edge"]}
    db.insert_position(conn, _trade(entry_context=ctx))
    assert db.list_positions(conn, account=ACCOUNT)[0]["entry_context"] == ctx


def test_list_positions_filters_by_status(conn):
    db.insert_position(conn, _trade("a"))
    db.insert_position(conn, _trade("b", status="closed", close_pnl=50.0, close_date="2026-09-15"))
    assert [t["id"] for t in db.list_positions(conn, status="open", account=ACCOUNT)] == ["a"]
    assert [t["id"] for t in db.list_positions(conn, status="closed", account=ACCOUNT)] == ["b"]


def test_close_position_sets_status_date_and_pnl(conn):
    db.insert_position(conn, _trade())
    assert db.close_position(conn, "pt_1", "2026-09-15", 125.0) is True
    row = db.list_positions(conn, account=ACCOUNT)[0]
    assert (row["status"], row["close_date"], row["close_pnl"]) == ("closed", "2026-09-15", 125.0)


def test_close_position_refuses_already_closed(conn):
    """Idempotency: closing twice must not overwrite the first realized P&L."""
    db.insert_position(conn, _trade())
    db.close_position(conn, "pt_1", "2026-09-15", 125.0)
    assert db.close_position(conn, "pt_1", "2026-09-16", -400.0) is False
    assert db.list_positions(conn, account=ACCOUNT)[0]["close_pnl"] == 125.0
