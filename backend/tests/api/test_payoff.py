from theta import paper
from theta.market import data as market_data

BODY = {"direction": "SELL_PUT", "short_strike": 100, "long_strike": 95, "credit": 1.0,
        "contracts": 1, "days_left": 5, "spot": 104.0, "sigma": 0.3}


def test_payoff_with_explicit_spot_and_sigma_needs_no_market_data(client, monkeypatch):
    def offline(*a, **k):
        raise AssertionError("must not touch OpenD")
    monkeypatch.setattr(market_data, "get_spot", offline)
    resp = client.post("/api/payoff", json=BODY)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["days"][0] == 5 and body["max_profit"] == 100.0


def test_payoff_fills_spot_from_market_when_missing(client, monkeypatch):
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 110.0)
    body = {k: v for k, v in BODY.items() if k != "spot"}
    resp = client.post("/api/payoff", json={**body, "ticker": "META"})
    assert resp.get_json()["spot"] == 110.0


def test_payoff_accepts_expiry_instead_of_days_left(client):
    body = {k: v for k, v in BODY.items() if k != "days_left"}
    resp = client.post("/api/payoff", json={**body, "expiry": "2000-01-01"})
    assert resp.status_code == 200
    assert resp.get_json()["days"] == [0]


def test_payoff_missing_ticker_when_spot_absent_is_400(client):
    body = {k: v for k, v in BODY.items() if k != "spot"}
    assert client.post("/api/payoff", json=body).status_code == 400


def test_payoff_echoes_the_sigma_it_priced_at(client, monkeypatch):
    """Vega is a difference of two bumped grids, so the client needs the vol back to bump from."""
    monkeypatch.setattr(paper, "sigma_for", lambda tk: 0.42)
    body = {k: v for k, v in BODY.items() if k != "sigma"}
    resp = client.post("/api/payoff", json={**body, "ticker": "META"})
    assert resp.get_json()["sigma"] == 0.42
    assert client.post("/api/payoff", json=BODY).get_json()["sigma"] == 0.3


def test_payoff_missing_required_field_is_400(client):
    body = {k: v for k, v in BODY.items() if k != "credit"}
    resp = client.post("/api/payoff", json=body)
    assert resp.status_code == 400 and "credit" in resp.get_json()["error"]