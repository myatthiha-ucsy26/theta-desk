import pytest

from theta.market import data as market_data
from theta.api import surfaces


@pytest.fixture
def client(make_client, monkeypatch):
    surfaces._SURFACE_CACHE.clear()
    calls = []

    def points(ticker, spot, **kw):
        calls.append(ticker)
        return [{"expiry": "2026-09-18", "dte": 2, "strike": 100.0, "iv": 0.25},
                {"expiry": "2026-09-25", "dte": 9, "strike": 100.0, "iv": 0.22}]
    monkeypatch.setattr(market_data, "get_spot", lambda tk: 100.0)
    monkeypatch.setattr(market_data, "iv_surface_points", points)
    return make_client(), calls


def test_surface_endpoint_returns_grid(client):
    c, calls = client
    body = c.get("/api/iv-surface?ticker=spy").get_json()
    assert body["ticker"] == "SPY"
    assert body["dtes"] == [2, 9] and body["strikes"] == [100.0]
    assert calls == ["SPY"]


def test_surface_is_cached_for_five_minutes(client):
    c, calls = client
    c.get("/api/iv-surface?ticker=SPY")
    c.get("/api/iv-surface?ticker=spy")
    assert calls == ["SPY"]


def test_refresh_bypasses_cache(client):
    c, calls = client
    c.get("/api/iv-surface?ticker=SPY")
    c.get("/api/iv-surface?ticker=SPY&refresh=1")
    assert calls == ["SPY", "SPY"]


def test_missing_ticker_is_400(client):
    c, _ = client
    assert c.get("/api/iv-surface").status_code == 400


def test_market_data_error_is_502(client, monkeypatch):
    c, _ = client

    def boom(tk):
        raise RuntimeError("OpenD down")
    monkeypatch.setattr(market_data, "get_spot", boom)
    resp = c.get("/api/iv-surface?ticker=QQQ")
    assert resp.status_code == 502 and "OpenD down" in resp.get_json()["error"]