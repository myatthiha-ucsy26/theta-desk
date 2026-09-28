import pytest

from theta.market import data as market_data
from theta.storage import db


@pytest.fixture
def client(make_client, monkeypatch):
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 650.0)

    def offline(*a, **k):
        raise RuntimeError("offline")
    monkeypatch.setattr(market_data, "fetch_klines", offline)
    return make_client()


OPEN = {"ticker": "META", "direction": "SELL_PUT", "short_strike": 600, "long_strike": 595,
        "width": 5, "credit": 1.25, "contracts": 2, "expiry": "2099-01-15", "mode": "ivrich"}


def signal(max_loss=375.0, ticker="AAPL"):
    return {"ticker": ticker, "direction": "SELL_PUT", "expiration": "2099-01-15",
            "spread": {"short": 200.0, "long": 195.0, "width": 5.0, "credit": 1.25, "max_loss": max_loss}}


# ---------------- manage ----------------

def test_paper_open_positions_carry_manage_fields(client):
    client.post("/api/paper/open", json=OPEN)
    pos = client.get("/api/paper").get_json()["open"][0]
    for key in ("spot", "days_left", "max_profit", "risk", "distance_pct", "profit_pct",
                "profit_take_hit", "short_breached", "mtm_pnl"):
        assert key in pos
    assert pos["spot"] == 650.0 and pos["risk"] == 750.0


def test_paper_stats_report_deployed_risk_against_cap(client):
    client.post("/api/paper/open", json=OPEN)
    client.post("/api/paper/open", json={**OPEN, "ticker": "AAPL"})
    stats = client.get("/api/paper").get_json()["stats"]
    assert stats["deployed_risk"] == 1500.0
    assert stats["risk_cap"] == db.DEFAULT_SETTINGS["max_deployed_risk"]


def test_paper_position_without_quote_still_listed(client, monkeypatch):
    client.post("/api/paper/open", json=OPEN)

    def down(tk):
        raise RuntimeError("OpenD down")
    monkeypatch.setattr(market_data, "get_spot", down)
    pos = client.get("/api/paper").get_json()["open"][0]
    assert pos["spot"] is None and pos["mtm_pnl"] is None and pos["risk"] == 750.0


# ---------------- size preview ----------------

def test_size_preview_for_empty_book(client):
    body = client.post("/api/size/preview", json={"ticker": "AAPL", "signal": signal()}).get_json()
    assert body["contracts"] == 1
    assert body["trade_risk"] == 375.0
    assert body["credit_total"] == 125.0
    assert body["deployed_before"] == 0.0 and body["deployed_after"] == 375.0
    assert body["cap"] == 2500.0
    assert body["ok"] is True


def test_size_preview_scales_contracts_to_500_risk(client):
    body = client.post("/api/size/preview", json={"ticker": "AAPL", "signal": signal(max_loss=150.0)}).get_json()
    assert body["contracts"] == 3
    assert body["trade_risk"] == 450.0
    assert body["credit_total"] == 375.0


def test_size_preview_uses_the_engine_risk_rules(client):
    client.post("/api/paper/open", json={**OPEN, "ticker": "AAPL"})
    body = client.post("/api/size/preview", json={"ticker": "AAPL", "signal": signal()}).get_json()
    assert body["ok"] is False and "already holding" in body["reason"]
    assert body["deployed_before"] == 750.0


def test_size_preview_requires_a_spread(client):
    bad = {"ticker": "AAPL", "signal": {"direction": "NO_TRADE", "spread": None}}
    assert client.post("/api/size/preview", json=bad).status_code == 400