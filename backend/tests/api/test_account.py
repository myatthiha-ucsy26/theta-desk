from theta.broker import account
from theta.storage import db


def go_live(path):
    conn = db.connect(path)
    db.init(conn)
    db.put_settings(conn, {"account_mode": "live"})
    conn.close()


def test_account_returns_the_real_summary(client, db_path, monkeypatch):
    go_live(db_path)
    summary = {"net_value": 1.0, "cash": 2.0, "buying_power": 3.0,
               "unrealized_pl": 4.0, "open_count": 1, "currency": "USD"}
    monkeypatch.setattr(account, "fetch", lambda: summary)
    resp = client.get("/api/account")
    assert resp.status_code == 200
    assert resp.get_json() == {"account": "live", **summary}


def test_account_unavailable_is_503_with_the_reason(client, db_path, monkeypatch):
    go_live(db_path)

    def boom():
        raise RuntimeError("OpenD not reachable")
    monkeypatch.setattr(account, "fetch", boom)
    resp = client.get("/api/account")
    assert resp.status_code == 503
    assert "OpenD not reachable" in resp.get_json()["error"]


def test_the_paper_account_never_asks_opend(client, monkeypatch):
    """Paper mode has to work with OpenD down, or it is not much of a sandbox."""
    def boom():
        raise AssertionError("the paper account must not reach OpenD")
    monkeypatch.setattr(account, "fetch", boom)

    body = client.get("/api/account").get_json()
    assert body["account"] == "paper"
    assert body["power"] == db.DEFAULT_SETTINGS["paper_starting_cash"]
