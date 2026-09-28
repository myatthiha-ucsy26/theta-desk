import pytest

from theta.market import data as market_data
from theta.storage import db

ACCOUNT = "paper"


@pytest.fixture
def client(make_client, db_path, monkeypatch):
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 650.0)

    def no_klines(*a, **k):
        raise RuntimeError("offline")
    monkeypatch.setattr(market_data, "fetch_klines", no_klines)
    return make_client(db_path=db_path)


BODY = {
    "ticker": "meta", "direction": "SELL_PUT", "short_strike": 600, "long_strike": 595,
    "width": 5, "credit": 1.25, "contracts": 2, "expiry": "2099-01-15", "mode": "ivrich",
}


def _rows(path):
    conn = db.connect(path)
    db.init(conn)
    try:
        return db.list_positions(conn, account=ACCOUNT)
    finally:
        conn.close()


def test_open_writes_to_database(client, db_path):
    resp = client.post("/api/paper/open", json=BODY)
    assert resp.status_code == 201
    rows = _rows(db_path)
    assert len(rows) == 1
    assert rows[0]["id"] == resp.get_json()["id"]
    assert rows[0]["ticker"] == "META" and rows[0]["contracts"] == 2


def test_open_stores_entry_context_when_supplied(client, db_path):
    ctx = {"rsi": 30.5, "iv_rank": 0.81}
    client.post("/api/paper/open", json={**BODY, "entry_context": ctx})
    assert _rows(db_path)[0]["entry_context"] == ctx


def test_open_missing_field_is_400(client, db_path):
    body = {k: v for k, v in BODY.items() if k != "credit"}
    assert client.post("/api/paper/open", json=body).status_code == 400
    assert _rows(db_path) == []


def test_list_marks_open_positions(client, db_path):
    client.post("/api/paper/open", json=BODY)
    data = client.get("/api/paper").get_json()
    assert data["stats"]["open_count"] == 1
    assert data["open"][0]["mtm_pnl"] is not None
    assert data["closed"] == []


def test_close_realizes_once(client, db_path):
    trade_id = client.post("/api/paper/open", json=BODY).get_json()["id"]
    first = client.post("/api/paper/close", json={"id": trade_id})
    assert first.status_code == 200
    assert _rows(db_path)[0]["status"] == "closed"
    second = client.post("/api/paper/close", json={"id": trade_id})
    assert second.status_code == 404