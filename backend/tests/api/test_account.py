from theta.broker import account


def test_account_returns_the_real_summary(client, monkeypatch):
    summary = {"net_value": 1.0, "cash": 2.0, "buying_power": 3.0,
               "unrealized_pl": 4.0, "open_count": 1, "currency": "USD"}
    monkeypatch.setattr(account, "fetch", lambda: summary)
    resp = client.get("/api/account")
    assert resp.status_code == 200
    assert resp.get_json() == summary


def test_account_unavailable_is_503_with_the_reason(client, monkeypatch):
    def boom():
        raise RuntimeError("OpenD not reachable")
    monkeypatch.setattr(account, "fetch", boom)
    resp = client.get("/api/account")
    assert resp.status_code == 503
    assert "OpenD not reachable" in resp.get_json()["error"]
