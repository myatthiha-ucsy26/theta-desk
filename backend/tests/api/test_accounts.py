"""Switching between the paper and live accounts."""
import pytest

from tests import fakes as f
from theta import services
from theta.storage import db


LIVE_TRADE = {
    "account": "live", "ticker": "SPY", "direction": "SELL_PUT", "expiry": "2026-09-30",
    "short_code": "S", "long_code": "L", "short_strike": 100.0, "long_strike": 95.0,
    "width": 5.0, "contracts": 1, "planned_credit": 0.6,
    "opened_at": "2026-09-16T15:00:00+00:00",
}


@pytest.fixture
def client(make_client, db_path, monkeypatch):
    broker = f.FakeBroker()
    monkeypatch.setattr(services, "bot_services", lambda context: f.services(broker))
    monkeypatch.setattr(services, "preflight",
                        lambda context: [{"name": "OpenD", "ok": True, "detail": ""}])
    return make_client(db_path=db_path, broker=broker), db_path


def seed(path, settings=None, trade=None):
    conn = db.connect(path)
    db.init(conn)
    if settings:
        db.put_settings(conn, settings)
    if trade:
        db.insert_live_trade(conn, {**LIVE_TRADE, **trade})
    conn.close()


def test_the_paper_account_is_the_default(client):
    c, _ = client
    assert c.get("/api/settings").get_json()["account_mode"] == "paper"


def test_switching_to_paper_is_refused_while_live_positions_are_open(client):
    """The monitor follows the account, and it is the only thing that closes a
    position. Switching away would leave a funded spread with nothing watching it."""
    c, path = client
    seed(path, {"account_mode": "live"}, {"id": "t1", "state": "open"})

    r = c.post("/api/settings", json={"account_mode": "paper"})
    assert r.status_code == 409
    assert "SPY" in r.get_json()["error"]
    assert c.get("/api/settings").get_json()["account_mode"] == "live"


def test_switching_to_paper_is_allowed_once_the_live_book_is_flat(client):
    c, path = client
    seed(path, {"account_mode": "live"}, {"id": "t1", "state": "closed"})
    r = c.post("/api/settings", json={"account_mode": "paper"})
    assert r.status_code == 200 and r.get_json()["account_mode"] == "paper"


def test_an_entering_trade_also_blocks_the_switch(client):
    """An order working at the exchange is every bit as real as a filled one."""
    c, path = client
    seed(path, {"account_mode": "live"}, {"id": "t1", "state": "entering"})
    assert c.post("/api/settings", json={"account_mode": "paper"}).status_code == 409


def test_a_paper_position_never_blocks_anything(client):
    c, path = client
    seed(path, {"account_mode": "live"},
         {"id": "p1", "account": "paper", "state": "open"})
    assert c.post("/api/settings", json={"account_mode": "paper"}).status_code == 200


def test_the_bot_view_reports_its_account(client):
    c, path = client
    seed(path, {"account_mode": "live"})
    assert c.get("/api/bot").get_json()["account_mode"] == "live"


def test_each_account_keeps_its_own_book(client):
    c, path = client
    seed(path, None, {"id": "pt", "account": "paper", "state": "closed", "pnl": 90.0,
                      "closed_at": "2026-09-17T15:00:00+00:00"})
    seed(path, None, {"id": "lt", "account": "live", "state": "closed", "pnl": -400.0,
                      "closed_at": "2026-09-17T15:00:00+00:00"})

    paper = c.get("/api/bot").get_json()
    assert [t["id"] for t in paper["closed"]] == ["pt"] and paper["net_pnl"] == 90.0

    seed(path, {"account_mode": "live"})
    live = c.get("/api/bot").get_json()
    assert [t["id"] for t in live["closed"]] == ["lt"] and live["net_pnl"] == -400.0


def test_preflight_does_not_demand_opend_on_paper(make_client, db_path):
    """A simulated fill needs quotes, not a funded, unlocked trading connection."""
    class Unreachable:
        def buying_power(self): raise RuntimeError("OpenD is not running")
        def unlock(self): raise RuntimeError("OpenD is not running")

    c = make_client(db_path=db_path, broker=Unreachable())
    body = c.get("/api/bot/preflight").get_json()
    broker_checks = [x for x in body["checks"] if "OpenD" in x["name"] or "unlock" in x["name"].lower()]
    assert broker_checks and all(x["ok"] for x in broker_checks)
    assert all("not required" in x["detail"] for x in broker_checks)
