import json

from tests import fakes
from theta.market import data as market_data
from theta.storage import db
from theta import notify
from theta import services
from theta import credentials


def test_get_settings_returns_defaults(client):
    assert client.get("/api/settings").get_json() == db.DEFAULT_SETTINGS


def test_post_settings_updates_and_returns_full_settings(client):
    resp = client.post("/api/settings", json={"interval_min": 30})
    assert resp.status_code == 200
    assert resp.get_json()["interval_min"] == 30
    assert client.get("/api/settings").get_json()["interval_min"] == 30


def test_post_invalid_settings_is_400_with_message(client):
    resp = client.post("/api/settings", json={"leverage": 10})
    assert resp.status_code == 400
    assert "unknown setting" in resp.get_json()["error"]


def test_post_non_object_is_400(client):
    assert client.post("/api/settings", json=[1, 2]).status_code == 400


class FakeRunner:
    def __init__(self):
        self.woken = 0

    def wake(self):
        self.woken += 1


def test_post_settings_wakes_the_engine(make_client):
    """Turning the switch on must reach the parked loop, not wait out its 60s recheck."""
    runner = FakeRunner()
    client = make_client(runner=runner)
    assert client.post("/api/settings", json={"engine_enabled": True}).status_code == 200
    assert runner.woken == 1


def test_post_invalid_settings_does_not_wake_the_engine(make_client):
    runner = FakeRunner()
    client = make_client(runner=runner)
    assert client.post("/api/settings", json={"leverage": 10}).status_code == 400
    assert runner.woken == 0


# ---------------- credentials ----------------

def test_a_saved_secret_is_never_sent_back_in_the_clear(client):
    client.post("/api/settings", json={"ai_api_key": "sk-live-123", "telegram_bot_token": "123:AA"})

    body = client.get("/api/settings").get_json()
    assert body["ai_api_key"] == credentials.SECRET_MASK
    assert body["telegram_bot_token"] == credentials.SECRET_MASK
    assert "sk-live-123" not in json.dumps(body)
    # The endpoint and the chat id name a destination rather than authenticate one, so they stay
    # readable -- the screen has to show which chat it is posting into.
    assert client.post("/api/settings", json={"telegram_chat_id": "9"}).status_code == 200
    assert client.get("/api/settings").get_json()["telegram_chat_id"] == "9"


def test_posting_the_mask_back_leaves_the_stored_secret_alone(client, monkeypatch, context):
    """The screen edits a diff but never saw the key, so the mask can only mean "unchanged"."""
    monkeypatch.delenv("AI_API_KEY", raising=False)
    client.post("/api/settings", json={"ai_api_key": "sk-live-123"})
    client.post("/api/settings", json={"ai_api_key": credentials.SECRET_MASK, "interval_min": 30})

    assert context.credential_env()["AI_API_KEY"] == "sk-live-123"


def test_a_stored_credential_reaches_the_engine(client, monkeypatch, context):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)

    client.post("/api/settings", json={
        "ai_api_key": "sk-live-123", "telegram_bot_token": "T", "telegram_chat_id": "9",
    })

    env = context.credential_env()
    assert env["AI_API_KEY"] == "sk-live-123"
    assert (env["TELEGRAM_BOT_TOKEN"], env["TELEGRAM_CHAT_ID"]) == ("T", "9")


def test_an_empty_setting_leaves_the_environment_in_charge(client, monkeypatch, context):
    """A blank field must not blank the environment out, or .env would stop working."""
    monkeypatch.setenv("AI_API_KEY", "from-dot-env")
    client.post("/api/settings", json={"ai_api_key": ""})

    assert context.credential_env()["AI_API_KEY"] == "from-dot-env"


def test_a_stored_setting_beats_the_environment(client, monkeypatch, context):
    monkeypatch.setenv("AI_API_KEY", "from-dot-env")
    client.post("/api/settings", json={"ai_api_key": "from-dashboard"})

    assert context.credential_env()["AI_API_KEY"] == "from-dashboard"


def test_clearing_a_saved_key_removes_it(client, monkeypatch, context):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    client.post("/api/settings", json={"ai_api_key": "sk-live-123"})
    client.post("/api/settings", json={"ai_api_key": ""})

    assert context.credential_env().get("AI_API_KEY", "") == ""


def test_restoring_defaults_forgets_the_credentials(client, monkeypatch, context):
    monkeypatch.delenv("AI_API_KEY", raising=False)
    client.post("/api/settings", json={"ai_api_key": "sk-live-123"})
    assert client.post("/api/settings/reset").get_json()["ai_api_key"] == ""

    assert context.credential_env().get("AI_API_KEY", "") == ""


def test_preflight_reads_a_key_saved_in_settings(client, monkeypatch, context):
    """The dashboard is the only place a headless run can be handed credentials."""
    monkeypatch.delenv("AI_API_KEY", raising=False)
    context.broker = fakes.FakeBroker()  # preflight must never reach OpenD

    def ai():
        return [c["ok"] for c in services.preflight(context)
                if c["name"] == "AI key configured"]

    assert ai() == [False]

    client.post("/api/settings", json={"ai_api_key": "sk-live-123"})
    assert ai() == [True]


def test_preflight_does_not_credit_half_a_telegram_pair(client, monkeypatch, context):
    monkeypatch.delenv("TELEGRAM_BOT_TOKEN", raising=False)
    monkeypatch.delenv("TELEGRAM_CHAT_ID", raising=False)
    context.broker = fakes.FakeBroker()

    def telegram():
        return [c["ok"] for c in services.preflight(context)
                if c["name"] == "Telegram configured"]

    client.post("/api/settings", json={"telegram_bot_token": "T"})
    assert telegram() == [False]

    client.post("/api/settings", json={"telegram_chat_id": "9"})
    assert telegram() == [True]


# ---------------- the AI provider list ----------------

def test_the_provider_list_is_served_to_the_dashboard(client):
    """The screen renders this rather than its own copy: which header a provider wants is a fact
    only notify knows, and a second copy in TypeScript would drift from it."""
    body = client.get("/api/ai/providers").get_json()
    assert body == notify.AI_PROVIDERS
    assert any(p["url"] == notify.DEFAULT_AI_ENDPOINT for p in body)


def test_a_saved_model_reaches_the_dashboard_review(client, monkeypatch):
    """The confirm endpoint reads the saved model, or the key/endpoint picker would be a lie."""
    monkeypatch.delenv("AI_MODEL", raising=False)
    # The confirm endpoint asks market_data for the earnings date, which opens OpenD. Answer instead.
    monkeypatch.setattr(market_data, "next_earnings", lambda ticker, *a, **k: None)
    client.post("/api/settings", json={"ai_model": "claude-sonnet-5"})

    sent = {}

    def fake_call(api_key, api_endpoint, model, prompt, **kw):
        sent["model"] = model
        return "VERDICT: CONFIRM\nREASON: ok"

    monkeypatch.setattr(notify, "call_ai", fake_call)
    resp = client.post("/api/ai/confirm", json={
        "api_key": "K", "api_endpoint": "https://api.anthropic.com",
        "ticker": "SPY", "signal": {"direction": "NO_TRADE"},
    })

    assert resp.status_code == 200
    assert sent["model"] == "claude-sonnet-5"