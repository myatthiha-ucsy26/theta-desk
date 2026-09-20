import io
import json
import urllib.request

import pytest

from theta.market import data as market_data


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture(autouse=True)
def no_earnings_lookup(monkeypatch):
    """The AI endpoints ask market_data for the real earnings date, which opens OpenD."""
    monkeypatch.setattr(market_data, "next_earnings", lambda ticker, *a, **k: None)


def _fake(monkeypatch, reply, seen):
    def fake_urlopen(req, timeout=None):
        seen.append(req)
        return FakeResponse(json.dumps(reply).encode())
    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)


def test_ai_confirm_endpoint_keeps_its_response_shape(client, monkeypatch):
    seen = []
    _fake(monkeypatch, {"content": [{"type": "text", "text": "VERDICT: AVOID\nREASON: earnings"}]}, seen)
    resp = client.post("/api/ai/confirm", json={
        "api_key": "K", "api_endpoint": "https://example.test", "model": "m1", "ticker": "META",
        "signal": {"direction": "SELL_PUT", "spot": 650.0},
    })
    assert resp.status_code == 200
    body = resp.get_json()
    assert body["verdict"] == "AVOID" and body["reason"] == "earnings"
    assert "raw" in body


def test_ai_confirm_endpoint_unparseable_reply_stays_caution_for_the_dashboard(client, monkeypatch):
    seen = []
    _fake(monkeypatch, {"content": [{"type": "text", "text": "Looks fine."}]}, seen)
    resp = client.post("/api/ai/confirm", json={
        "api_key": "K", "api_endpoint": "https://example.test", "model": "m1", "ticker": "META",
        "signal": {"direction": "SELL_PUT"},
    })
    assert resp.get_json()["verdict"] == "CAUTION"


def test_ai_confirm_empty_answer_is_an_error_not_a_blank_caution(client, monkeypatch):
    """The model once returned only thinking; the dashboard showed a blank CAUTION."""
    seen = []
    _fake(monkeypatch, {"content": [{"type": "thinking", "thinking": "..."}]}, seen)
    resp = client.post("/api/ai/confirm", json={
        "api_key": "K", "api_endpoint": "https://example.test", "model": "m1", "ticker": "META",
        "signal": {"direction": "SELL_PUT"},
    })
    assert resp.status_code == 502
    assert "empty answer" in resp.get_json()["error"]


def test_telegram_endpoint_uses_env_credentials(client, monkeypatch):
    seen = []
    _fake(monkeypatch, {"ok": True}, seen)
    monkeypatch.setenv("TELEGRAM_BOT_TOKEN", "ENVTOKEN")
    monkeypatch.setenv("TELEGRAM_CHAT_ID", "42")
    resp = client.post("/api/alert/telegram", json={"message": "hi"})
    assert resp.get_json() == {"ok": True}
    assert seen[0].full_url == "https://api.telegram.org/botENVTOKEN/sendMessage"


def test_telegram_endpoint_api_error_is_400(client, monkeypatch):
    seen = []
    _fake(monkeypatch, {"ok": False, "description": "bot was blocked"}, seen)
    resp = client.post("/api/alert/telegram",
                                      json={"bot_token": "T", "chat_id": "1", "message": "hi"})
    assert resp.status_code == 400
    assert resp.get_json()["error"] == "bot was blocked"


def test_ai_confirm_requires_a_model_now_that_none_is_built_in(client):
    """There is no default model to fall back on, so a request without one is a
    bad request rather than a call to something nobody chose."""
    resp = client.post("/api/ai/confirm", json={
        "api_key": "K", "api_endpoint": "https://example.test", "ticker": "META",
        "signal": {"direction": "SELL_PUT"},
    })
    assert resp.status_code == 400
    assert "model" in resp.get_json()["error"]
