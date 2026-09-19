from theta.storage import db


class FakeRunner:
    running = True
    status = {"state": "idle"}

    def __init__(self, result):
        self.result = result
        self.calls = 0

    def request_scan(self):
        self.calls += 1
        return self.result


def test_scan_now_starts_a_cycle(make_client):
    fake = FakeRunner((True, "scan started"))
    resp = make_client(runner=fake).post("/api/scan/now")
    assert resp.status_code == 202
    assert resp.get_json() == {"started": True}
    assert fake.calls == 1


def test_scan_now_while_busy_is_409_with_the_reason(make_client):
    runner = FakeRunner((False, "a scan is already running"))
    resp = make_client(runner=runner).post("/api/scan/now")
    assert resp.status_code == 409
    assert resp.get_json()["error"] == "a scan is already running"


def test_scan_now_without_engine_thread_is_503(client):
    resp = client.post("/api/scan/now")
    assert resp.status_code == 503
    assert "./run.sh" in resp.get_json()["error"]


def test_status_reports_the_last_trigger(make_client):
    fake = FakeRunner((True, ""))
    fake.status = {"state": "idle", "last_trigger": "manual"}
    body = make_client(runner=fake).get("/api/engine/status").get_json()
    assert body["last_trigger"] == "manual"


def test_clear_scan_empties_the_board_and_says_how_many(client, db_path):
    conn = db.connect(db_path)
    db.init(conn)
    db.log_decision(conn, {"ticker": "META", "dte": 7, "stage": "signal", "passed": False,
                              "direction": None, "reason": "IV not rich"}, "2026-09-17T00:57:00+00:00")
    db.log_decision(conn, {"ticker": "QQQ", "dte": 14, "stage": "signal", "passed": False,
                              "direction": None, "reason": "IV not rich"}, "2026-09-17T00:57:00+00:00")
    conn.close()
    assert len(client.get("/api/journal").get_json()) == 2

    assert client.post("/api/scan/clear").get_json() == {"cleared": 2}
    assert client.get("/api/journal").get_json() == []
    assert client.get("/api/scan/latest").get_json() == []
