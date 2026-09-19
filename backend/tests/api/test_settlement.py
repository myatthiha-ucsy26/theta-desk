import pandas as pd
import pytest

from theta.market import data as market_data
from theta.storage import db

ACCOUNT = "paper"


EXPIRED = {
    "account": ACCOUNT, "id": "pt_test_1",
    "ticker": "TEST",
    "direction": "SELL_PUT",
    "short_strike": 100.0,
    "long_strike": 95.0,
    "width": 5.0,
    "credit": 1.00,
    "contracts": 1,
    "entry_date": "2024-09-06",
    "expiry": "2024-09-20",
    "mode": "ivrich",
    "status": "open",
    "close_date": None,
    "close_pnl": None,
}


@pytest.fixture
def db_with_expired(db_path):
    path = db_path
    conn = db.connect(path)
    db.init(conn)
    db.insert_position(conn, EXPIRED)
    conn.close()
    return path


def _saved(path):
    conn = db.connect(path)
    try:
        return db.list_positions(conn, account=ACCOUNT)[0]
    finally:
        conn.close()


def _klines(rows):
    return pd.DataFrame({
        "date": pd.to_datetime([d for d, _ in rows]),
        "open": [c for _, c in rows], "high": [c for _, c in rows],
        "low": [c for _, c in rows], "close": [c for _, c in rows],
        "volume": [1e6] * len(rows),
    })


def test_expired_trade_settles_at_expiry_close_not_live_spot(client, db_with_expired, monkeypatch):
    """THE REGRESSION.

    Expiry close was 104 (above the 100 short strike -> keep the full $100 credit).
    By the time the panel is opened the stock has crashed to 80. The old code
    settled at the live 80 and booked a max loss of -$400 on a trade that won.
    """
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 80.0)
    monkeypatch.setattr(
        market_data, "fetch_klines",
        lambda tk, start, end, refresh=False: _klines([("2024-09-19", 102.0), ("2024-09-20", 104.0)]),
    )

    resp = client.get("/api/paper")
    closed = resp.get_json()["closed"]

    assert len(closed) == 1
    assert closed[0]["close_pnl"] == 100.0
    assert closed[0]["close_date"] == "2024-09-20"
    saved = _saved(db_with_expired)
    assert saved["status"] == "closed" and saved["close_pnl"] == 100.0


def test_expired_trade_stays_open_when_no_expiry_close(client, db_with_expired, monkeypatch):
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 80.0)

    def boom(*a, **k):
        raise RuntimeError("OpenD down")
    monkeypatch.setattr(market_data, "fetch_klines", boom)

    resp = client.get("/api/paper")
    body = resp.get_json()

    assert body["closed"] == []
    assert _saved(db_with_expired)["status"] == "open"