import pytest

from tests import fakes as f
from theta import services
from theta.storage import db

ACCOUNT = "live"


@pytest.fixture
def client(make_client, db_path, monkeypatch):
    broker = f.FakeBroker()                        # tests never reach OpenD
    svc = f.services(broker)
    monkeypatch.setattr(services, "bot_services", lambda context: svc)
    return make_client(db_path=db_path, broker=broker, monitor=None), db_path, broker, svc


def ready(monkeypatch, ok=True):
    monkeypatch.setattr(services, "preflight",
                        lambda context: [{"name": "OpenD", "ok": ok, "detail": ""}])


def test_starting_the_paper_bot_needs_no_confirmation(client):
    """Nothing is at stake on the paper account, so it must not demand a ritual."""
    c, *_ = client
    r = c.post("/api/settings", json={"mode": "auto"})
    assert r.status_code == 200
    body = r.get_json()
    assert (body["mode"], body["account_mode"]) == ("auto", "paper")


def test_going_live_needs_live_confirmation(client, monkeypatch):
    c, path, *_ = client
    ready(monkeypatch)
    r = c.post("/api/settings", json={"account_mode": "live", "mode": "auto"})
    assert r.status_code == 400 and "LIVE" in r.get_json()["error"]
    r = c.post("/api/settings", json={"account_mode": "live", "mode": "auto", "confirm": "LIVE"})
    body = r.get_json()
    assert r.status_code == 200 and body["mode"] == "auto" and body["account_mode"] == "live"
    assert "confirm" not in body


def test_going_live_needs_a_ready_preflight(client, monkeypatch):
    c, *_ = client
    ready(monkeypatch, ok=False)
    r = c.post("/api/settings", json={"account_mode": "live", "mode": "auto", "confirm": "LIVE"})
    assert r.status_code == 400 and "OpenD" in r.get_json()["error"]


def test_other_settings_save_without_confirmation(client):
    c, *_ = client
    assert c.post("/api/settings", json={"tp_pct": 40}).get_json()["tp_pct"] == 40


def test_bot_status_reports_slots_and_trades(client):
    c, path, broker, svc = client
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"mode": "auto", "account_mode": ACCOUNT})
    db.insert_live_trade(conn, {
        "id": "w", "account": ACCOUNT, "ticker": "SPY", "direction": "SELL_PUT", "expiry": "2026-09-30",
        "short_code": f.SHORT, "long_code": f.LONG, "short_strike": 731.0, "long_strike": 726.0,
        "width": 5.0, "contracts": 1, "planned_credit": 0.6, "state": "closed", "pnl": 520.0,
        "opened_at": "2026-09-15T15:00:00+00:00", "closed_at": "2026-09-15T18:00:00+00:00"})
    conn.close()
    body = c.get("/api/bot").get_json()
    assert (body["mode"], body["slots"], body["next_slot_at"], body["net_pnl"]) == ("auto", 2, 1000.0, 520.0)
    assert [t["id"] for t in body["closed"]] == ["w"] and body["monitor"]["state"] == "not started"


def test_stop_resume_and_close_all(client):
    c, path, broker, svc = client
    assert c.post("/api/bot/stop").get_json()["paused"] is True
    assert c.post("/api/bot/resume").get_json()["paused"] is False
    assert c.post("/api/bot/close-all", json={}).status_code == 400
    assert c.post("/api/bot/close-all", json={"confirm": "CLOSE"}).get_json() == {"closing": 0}


def test_resume_sends_a_telegram_message(client):
    c, path, broker, svc = client
    c.post("/api/bot/stop")
    svc["sent"].clear()

    assert c.post("/api/bot/resume").get_json()["paused"] is False

    assert len(svc["sent"]) == 1 and "Bot resumed" in svc["sent"][0]


def test_preflight_never_leaks_the_password(client, monkeypatch):
    c, *_ = client
    monkeypatch.setenv("MOOMOO_TRADE_PASSWORD", "hunter2")
    body = c.get("/api/bot/preflight").get_json()
    assert "hunter2" not in str(body)
    assert body["ready"] is False   # the monitor is not running in tests


def test_preflight_does_not_require_a_trade_password(client, monkeypatch):
    c, *_ = client
    monkeypatch.delenv("MOOMOO_TRADE_PASSWORD", raising=False)
    names = [x["name"] for x in c.get("/api/bot/preflight").get_json()["checks"]]
    assert "Trade password in .env" not in names
    assert "Trading unlocked" in names
