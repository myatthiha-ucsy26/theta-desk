import io
import json
import urllib.parse
import urllib.request

import pytest

from theta.market import data as market_data
from theta import notify


class FakeResponse(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


@pytest.fixture
def http(monkeypatch):
    """Capture outgoing requests; tests set .reply to control the response."""
    state = {"requests": [], "reply": {}, "raise": None}

    def fake_urlopen(req, timeout=None):
        state["requests"].append(req)
        if state["raise"]:
            raise state["raise"]
        return FakeResponse(json.dumps(state["reply"]).encode())

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    return state


@pytest.fixture(autouse=True)
def no_earnings_lookup(monkeypatch):
    """ai_review and ai_exit_review ask market_data for the real date, which opens OpenD.
    Unit tests answer instead; test_cs_data_earnings.py covers the lookup itself."""
    monkeypatch.setattr(market_data, "next_earnings", lambda ticker, *a, **k: None)


AI_ENV = {"AI_API_KEY": "K", "AI_API_ENDPOINT": "https://example.test/anthropic",
          "AI_MODEL": "m1"}

SIGNAL = {
    "spot": 650.0, "direction": "SELL_PUT", "expiration": "2026-10-02", "dte": 14,
    "iv_pct": 42.0, "iv_rank": None, "indicators": {"rsi": 31.0, "pctb": 0.08, "adx": 18.0},
    "verdicts": {"ivrich": {"direction": "SELL_PUT", "reason": "IV rich"}},
    "spread": {"side": "put", "short": 600.0, "long": 595.0, "width": 5.0, "credit": 1.25,
               "max_loss": 375.0, "roi_pct": 33.3, "pop_pct": 71.2, "breakeven": 598.75,
               "short_delta": -0.3},
}


# ---------------- telegram ----------------

def test_send_telegram_posts_html_message(http):
    http["reply"] = {"ok": True}
    assert notify.send_telegram("TOKEN", "123", "<b>hi</b>") == (True, None)
    req = http["requests"][0]
    assert req.full_url == "https://api.telegram.org/botTOKEN/sendMessage"
    assert json.loads(req.data) == {"chat_id": "123", "text": "<b>hi</b>", "parse_mode": "HTML"}


def test_send_telegram_reports_api_error(http):
    http["reply"] = {"ok": False, "description": "chat not found"}
    assert notify.send_telegram("TOKEN", "123", "hi") == (False, "chat not found")


def test_send_telegram_reports_network_error(http):
    http["raise"] = OSError("timed out")
    ok, err = notify.send_telegram("TOKEN", "123", "hi")
    assert ok is False and "timed out" in err


def test_telegram_from_env_without_credentials_does_not_call_network(http):
    ok, err = notify.telegram_from_env("hi", env={})
    assert ok is False and "TELEGRAM_BOT_TOKEN" in err
    assert http["requests"] == []


def test_telegram_from_env_uses_env(http):
    http["reply"] = {"ok": True}
    env = {"TELEGRAM_BOT_TOKEN": "T", "TELEGRAM_CHAT_ID": "9"}
    assert notify.telegram_from_env("hi", env=env) == (True, None)
    assert http["requests"][0].full_url == "https://api.telegram.org/botT/sendMessage"


# ---------------- AI ----------------

def test_build_ai_prompt_includes_trade_and_reply_format():
    p = notify.build_ai_prompt("META", SIGNAL)
    assert "Ticker: META at $650.0" in p
    assert "$600.0/595.0" in p
    assert "VERDICT:" in p and "REASON:" in p


def test_prompt_states_the_real_earnings_date():
    p = notify.build_ai_prompt("META", SIGNAL, earnings="2026-10-01")
    assert "META reports on 2026-10-01" in p


def test_prompt_says_none_scheduled_when_the_calendar_was_checked():
    p = notify.build_ai_prompt("META", SIGNAL, earnings=notify.EARNINGS_NONE)
    assert "no earnings scheduled" in p
    assert "2026-10-01" not in p


def test_prompt_marks_unknown_earnings_and_forbids_guessing():
    p = notify.build_ai_prompt("META", SIGNAL, earnings=notify.EARNINGS_UNKNOWN)
    assert "UNKNOWN" in p
    assert "do not" in p.lower() and "guess" in p.lower()


def test_prompt_never_asks_the_model_to_look_up_events_it_cannot_see():
    """The old wording asked it to 'check for upcoming earnings'; it answered from memory."""
    p = notify.build_ai_prompt("META", SIGNAL, earnings="2026-10-01")
    assert "Check for: 1) upcoming earnings" not in p


def test_earnings_defaults_to_unknown_when_not_supplied():
    p = notify.build_ai_prompt("META", SIGNAL)
    assert notify.EARNINGS_UNKNOWN in p


def test_earnings_fact_reports_the_date_or_none(monkeypatch):
    assert notify.earnings_fact("META", fetch=lambda *a: "2026-10-01") == "2026-10-01"
    assert notify.earnings_fact("META", fetch=lambda *a: None) == notify.EARNINGS_NONE


def test_earnings_fact_degrades_to_unknown_when_opend_fails():
    def boom(*a):
        raise RuntimeError("OpenD is down")
    assert notify.earnings_fact("META", fetch=boom) == notify.EARNINGS_UNKNOWN


def test_ai_review_hands_the_model_the_real_earnings_date(http, monkeypatch):
    """The entry review is what vetoes a trade, so it must get the calendar's answer."""
    monkeypatch.setattr(market_data, "next_earnings", lambda ticker, *a, **k: "2026-10-01")
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.ai_review("META", SIGNAL, env=AI_ENV)
    assert "META reports on 2026-10-01" in json.loads(http["requests"][0].data)["messages"][0]["content"]


@pytest.mark.parametrize("content, expected", [
    ("VERDICT: CONFIRM\nREASON: clean week", ("CONFIRM", "clean week")),
    ("VERDICT: AVOID\nREASON: earnings Thursday", ("AVOID", "earnings Thursday")),
    ("VERDICT: CAUTION\nREASON: CPI print", ("CAUTION", "CPI print")),
    ("verdict: confirm\nreason: lower case ok", ("CONFIRM", "lower case ok")),
])
def test_parse_ai_verdict(content, expected):
    assert notify.parse_ai_verdict(content) == expected


def test_parse_ai_verdict_without_verdict_line_is_none():
    verdict, reason = notify.parse_ai_verdict("I think it looks fine.")
    assert verdict is None
    assert reason == "I think it looks fine."


def test_call_ai_sends_key_and_joins_text_blocks(http):
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\n"},
                                 {"type": "thinking", "text": "ignored"},
                                 {"type": "text", "text": "REASON: ok"}]}
    content = notify.call_ai("KEY", "https://example.test/anthropic/", "m1", "prompt")
    assert content == "VERDICT: CONFIRM\nREASON: ok"
    req = http["requests"][0]
    assert req.full_url == "https://example.test/anthropic/v1/messages"
    assert req.get_header("X-api-key") == "KEY"
    assert json.loads(req.data)["model"] == "m1"


def test_call_ai_turns_off_thinking(http):
    """Some models think by default and can spend the whole answer
    budget on it: 512 tokens of thinking and no text, even at 4096. Thinking must be off."""
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://example.test", "m1", "prompt")
    assert json.loads(http["requests"][0].data)["thinking"] == {"type": "disabled"}


# ---------------- provider-aware calling ----------------

def test_a_bearer_provider_gets_a_bearer_token(http):
    """Moonshot and OpenRouter read only Authorization. Sent x-api-key, they reject the call."""
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://api.moonshot.cn/anthropic", "kimi-k3", "prompt")
    req = http["requests"][0]
    assert req.get_header("Authorization") == "Bearer KEY"
    assert req.get_header("X-api-key") is None


def test_an_x_api_key_provider_still_gets_x_api_key(http):
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://api.anthropic.com", "claude-sonnet-5", "prompt")
    req = http["requests"][0]
    assert req.get_header("X-api-key") == "KEY"
    assert req.get_header("Authorization") is None


def test_a_provider_that_wants_thinking_keeps_it(http):
    """Claude 5 thinks adaptively and Kimi rejects the field outright, so it is not sent."""
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://api.anthropic.com", "claude-sonnet-5", "prompt")
    assert "thinking" not in json.loads(http["requests"][0].data)


def test_a_custom_path_under_a_known_host_is_still_recognised(http):
    """Matching is on host, so a gateway in front of a listed provider keeps its treatment."""
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://api.anthropic.com/gateway", "claude-sonnet-5", "prompt")
    req = http["requests"][0]
    assert req.get_header("X-api-key") == "KEY"
    assert "thinking" not in json.loads(req.data)


def test_a_provider_listed_for_thinking_gets_it(http):
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://vendor.test/anthropic", "thinking-model-v1", "prompt")
    assert json.loads(http["requests"][0].data)["thinking"] == {"type": "disabled"}


def test_an_unknown_host_keeps_the_shape_it_always_had(http):
    """Every custom endpoint has been called with x-api-key and thinking off; that must not move."""
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: ok"}]}
    notify.call_ai("KEY", "https://ai.internal.corp/anthropic", "house-model", "prompt")
    req = http["requests"][0]
    assert req.get_header("X-api-key") == "KEY"
    assert json.loads(req.data)["thinking"] == {"type": "disabled"}


def test_the_provider_list_can_be_rendered_as_a_dropdown():
    """The browser shows this list verbatim, so a malformed entry is a broken option."""
    assert notify.AI_PROVIDERS
    for p in notify.AI_PROVIDERS:
        assert p["id"] and p["label"] and p["url"].startswith("https://")
        assert p["auth"] in ("key", "bearer")
        assert isinstance(p["disable_thinking"], bool)
        assert p["models"], f"{p['id']} offers no models, so picking it would strand the screen"
        for m in p["models"]:
            assert m["id"] and m["label"]
    hosts = [urllib.parse.urlsplit(p["url"]).netloc for p in notify.AI_PROVIDERS]
    assert len(hosts) == len(set(hosts)), "two providers share a host, so _provider_for is ambiguous"


def test_no_endpoint_or_model_is_built_in():
    """The review is a paid call to somebody else's service. Unset must mean off,
    not a quiet call to an endpoint the operator never chose."""
    assert not hasattr(notify, "DEFAULT_AI_ENDPOINT")
    assert not hasattr(notify, "DEFAULT_AI_MODEL")
    for provider in notify.AI_PROVIDERS:
        assert "default" not in provider["label"].lower()
        for model in provider["models"]:
            assert "default" not in model["label"].lower()


def test_an_unconfigured_review_says_exactly_what_is_missing():
    assert notify.ai_review("META", SIGNAL, env={}) == (
        "UNAVAILABLE", "AI_API_KEY, AI_API_ENDPOINT, AI_MODEL not set")
    key_only = {"AI_API_KEY": "K"}
    assert notify.ai_review("META", SIGNAL, env=key_only) == (
        "UNAVAILABLE", "AI_API_ENDPOINT, AI_MODEL not set")
    assert notify.ai_exit_review(TRADE, 745.0, 1.0, env=key_only) == (
        "UNAVAILABLE", "AI_API_ENDPOINT, AI_MODEL not set")


def test_a_blank_setting_counts_as_unset():
    """A cleared field in the dashboard writes "", which must not reach call_ai."""
    env = {"AI_API_KEY": "K", "AI_API_ENDPOINT": "   ", "AI_MODEL": "m1"}
    assert notify.ai_review("META", SIGNAL, env=env)[0] == "UNAVAILABLE"


def test_ai_review_with_only_thinking_and_no_text_is_unavailable(http):
    http["reply"] = {"content": [{"type": "thinking", "thinking": "hmm..."}], "stop_reason": "max_tokens"}
    assert notify.ai_review("META", SIGNAL, env=AI_ENV)[0] == "UNAVAILABLE"


def test_ai_review_without_key_is_unavailable_and_offline(http):
    assert notify.ai_review("META", SIGNAL, env={})[0] == "UNAVAILABLE"
    assert http["requests"] == []


def test_ai_review_confirm(http):
    http["reply"] = {"content": [{"type": "text", "text": "VERDICT: CONFIRM\nREASON: quiet week"}]}
    assert notify.ai_review("META", SIGNAL, env=AI_ENV) == ("CONFIRM", "quiet week")


def test_ai_review_unparseable_reply_is_unavailable_not_caution(http):
    """The engine must not treat a garbled reply as a soft yes."""
    http["reply"] = {"content": [{"type": "text", "text": "Sure! Looks good to me."}]}
    assert notify.ai_review("META", SIGNAL, env=AI_ENV)[0] == "UNAVAILABLE"


def test_ai_review_network_error_is_unavailable(http):
    http["raise"] = OSError("connection refused")
    verdict, reason = notify.ai_review("META", SIGNAL, env=AI_ENV)
    assert verdict == "UNAVAILABLE" and "connection refused" in reason


TRADE = {"ticker": "SPY", "direction": "SELL_PUT", "short_strike": 731.0, "long_strike": 726.0,
         "expiry": "2026-09-30", "credit": 0.60}


def test_exit_prompt_describes_the_open_spread():
    p = notify.build_exit_prompt(TRADE, 745.2, 1.10)
    assert "SPY bull put spread, short $731 / long $726, expires 2026-09-30" in p
    assert "Sold for $0.60" in p and "$1.10 to close" in p and "EXIT | HOLD" in p


def test_exit_prompt_states_the_real_earnings_date():
    """Holding through earnings is the risk the exit review exists to catch."""
    p = notify.build_exit_prompt(TRADE, 745.2, 1.10, earnings="2026-09-28")
    assert "SPY reports on 2026-09-28" in p


def test_exit_prompt_marks_unknown_earnings_and_forbids_guessing():
    p = notify.build_exit_prompt(TRADE, 745.2, 1.10, earnings=notify.EARNINGS_UNKNOWN)
    assert "UNKNOWN" in p
    assert "do not" in p.lower() and "guess" in p.lower()
    assert "Check for news, earnings" not in p


def test_ai_exit_review_passes_the_earnings_fact(monkeypatch):
    seen = {}

    def fake_call(key, endpoint, model, prompt):
        seen["prompt"] = prompt
        return "VERDICT: HOLD\nREASON: quiet"

    monkeypatch.setattr(notify, "call_ai", fake_call)
    monkeypatch.setattr(market_data, "next_earnings", lambda t, *a, **k: "2026-09-28")
    notify.ai_exit_review(TRADE, 745.0, 1.0, env=AI_ENV)
    assert "SPY reports on 2026-09-28" in seen["prompt"]


def test_parse_exit_verdict():
    assert notify.parse_exit_verdict("VERDICT: EXIT\nREASON: CPI tomorrow") == ("EXIT", "CPI tomorrow")
    assert notify.parse_exit_verdict("VERDICT: hold\nREASON: calm") == ("HOLD", "calm")
    assert notify.parse_exit_verdict("no idea")[0] is None


def test_ai_exit_review_unavailable_without_key_or_on_bad_reply(monkeypatch):
    assert notify.ai_exit_review(TRADE, 745.0, 1.0, env={})[0] == "UNAVAILABLE"
    monkeypatch.setattr(notify, "call_ai", lambda *a, **k: "hmm")
    assert notify.ai_exit_review(TRADE, 745.0, 1.0, env=AI_ENV)[0] == "UNAVAILABLE"
    monkeypatch.setattr(notify, "call_ai", lambda *a, **k: "VERDICT: EXIT\nREASON: news")
    assert notify.ai_exit_review(TRADE, 745.0, 1.0, env=AI_ENV) == ("EXIT", "news")
