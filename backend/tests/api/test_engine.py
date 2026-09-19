from theta.storage import db
from theta import services
from theta.context import AppContext


def _log(path, ticker, dte, stage, ts):
    conn = db.connect(path)
    db.init(conn)
    db.log_decision(conn, {"ticker": ticker, "dte": dte, "stage": stage, "passed": stage == "alert",
                              "direction": "SELL_PUT", "reason": stage}, ts)
    conn.close()


def test_status_when_engine_not_started(client, db_path):
    body = client.get("/api/engine/status").get_json()
    assert body["running"] is False
    assert body["state"] == "not started"
    assert body["engine_enabled"] is False


def test_status_reports_runner_state(make_client):
    class FakeRunner:
        running = True
        status = {"state": "idle", "last_cycle": "2026-09-16T15:00:00+00:00", "decisions": 20}
    body = make_client(runner=FakeRunner()).get("/api/engine/status").get_json()
    assert body["running"] is True
    assert body["state"] == "idle" and body["decisions"] == 20


def test_status_publishes_the_market_hours_setting(make_client, db_path):
    """The header blocks Scan now outside market hours; it needs this flag to know whether to."""
    class FakeRunner:
        running = True
        status = {"state": "idle"}
    client = make_client(db_path=db_path, runner=FakeRunner())
    assert client.get("/api/engine/status").get_json()["market_hours_only"] is True

    conn = db.connect(db_path)
    try:
        db.init(conn)
        db.put_settings(conn, {"market_hours_only": False})
    finally:
        conn.close()
    assert client.get("/api/engine/status").get_json()["market_hours_only"] is False


def test_scan_latest_returns_newest_decision_per_ticker_and_dte(client, db_path):
    _log(db_path, "META", 14, "edge", "2026-09-16T15:00:00+00:00")
    _log(db_path, "META", 14, "alert", "2026-09-16T15:15:00+00:00")
    _log(db_path, "AAPL", 7, "signal", "2026-09-16T15:15:00+00:00")
    rows = client.get("/api/scan/latest").get_json()
    assert [(r["decision"]["ticker"], r["decision"]["stage"]) for r in rows] == [
        ("AAPL", "signal"), ("META", "alert"),
    ]


def test_journal_limit_is_respected_and_capped(client, db_path):
    for i in range(5):
        _log(db_path, "META", 14, "signal", f"2026-09-16T15:0{i}:00+00:00")
    assert len(client.get("/api/journal?limit=3").get_json()) == 3
    assert len(client.get("/api/journal?limit=99999").get_json()) == 5
    assert client.get("/api/journal?limit=abc").status_code == 400


def test_engine_services_are_wired():
    wired = services.engine_services(AppContext(), services.history)
    assert set(wired) == {"evaluate", "closes", "ai_review", "send_alert", "autotrade"}
    assert all(callable(f) for f in wired.values())