import io
import json
import urllib.request

from theta.market import data as market_data
from theta.storage import db


def _conn(path):
    c = db.connect(path)
    db.init(c)
    return c


def test_decisions_since_returns_only_newer_oldest_first(client, db_path):
    c = _conn(db_path)
    for ts in ("2026-09-10T14:00:00+00:00", "2026-09-15T14:00:00+00:00", "2026-09-16T14:00:00+00:00"):
        db.log_decision(c, {"ticker": "SPY", "dte": 7, "stage": "signal", "passed": False, "reason": ts}, ts)
    rows = db.decisions_since(c, "2026-09-15T00:00:00+00:00")
    c.close()
    assert [r["ts"] for r in rows] == ["2026-09-15T14:00:00+00:00", "2026-09-16T14:00:00+00:00"]


def test_learn_endpoint_shape(client, db_path):
    c = _conn(db_path)
    db.save_edge_table(c, {("ivrich", 7, "high"): {"n": 847, "expectancy": 37.7, "win_rate": 0.82}},
                          "2026-09-16T06:00:00+00:00")
    c.close()
    body = client.get("/api/learn").get_json()
    assert set(body) >= {"days", "decisions", "errors", "funnel", "edge", "edge_built_at", "paper", "min_n"}
    assert body["days"] == 7 and body["min_n"] == 100
    assert body["edge"][0]["passes"] is True
    assert body["edge_built_at"] == "2026-09-16T06:00:00+00:00"


def test_learn_days_is_clamped_and_validated(client, db_path):
    assert client.get("/api/learn?days=9999").get_json()["days"] == 90
    assert client.get("/api/learn?days=x").status_code == 400


def test_settings_reset_restores_defaults(client, db_path):
    client.post("/api/settings", json={"engine_enabled": True, "interval_min": 30})
    body = client.post("/api/settings/reset").get_json()
    assert body == db.DEFAULT_SETTINGS
    assert client.get("/api/settings").get_json() == db.DEFAULT_SETTINGS


def test_default_watchlist_is_the_backtested_ten():
    # Each has five years of cached history, a positive IV-rich backtest at 7 and 14 DTE
    # including the 2022 bear market, and liquid weekly options.
    assert db.DEFAULT_SETTINGS["watchlist"] == [
        "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "TSLA", "AVGO", "AMD"]


def test_settings_defaults_serves_the_default_watchlist_without_saving(client, db_path):
    client.post("/api/settings", json={"watchlist": ["MRNA"]})
    body = client.get("/api/settings/defaults").get_json()
    assert body == {"watchlist": db.DEFAULT_SETTINGS["watchlist"]}
    assert client.get("/api/settings").get_json()["watchlist"] == ["MRNA"]


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def test_ai_confirm_uses_ai_model_from_environment(client, db_path, monkeypatch):
    seen = []

    def fake_urlopen(req, timeout=None):
        seen.append(json.loads(req.data))
        return FakeResponse(json.dumps({"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}).encode())
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    # The endpoint asks market_data for the real earnings date, which opens OpenD.
    monkeypatch.setattr(market_data, "next_earnings", lambda ticker, *a, **k: None)
    monkeypatch.setenv("AI_API_KEY", "K")
    monkeypatch.setenv("AI_API_ENDPOINT", "https://example.test")
    monkeypatch.setenv("AI_MODEL", "some-model-v1")
    resp = client.post("/api/ai/confirm", json={"ticker": "META", "signal": {"direction": "SELL_PUT"}})
    assert resp.status_code == 200
    assert seen[0]["model"] == "some-model-v1"