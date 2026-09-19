"""Outbound notifications: Telegram alerts and the AI trade review.

stdlib urllib only. Shared by the dashboard endpoints (credentials may come from
the request) and the headless engine (credentials come from the environment).
"""
import json
import os
import urllib.parse
import urllib.request

from theta.market import data as market_data

DEFAULT_AI_ENDPOINT = ""
DEFAULT_AI_MODEL = ""

# The endpoints the dashboard offers, each with the models it serves. Served to the browser rather
# than copied into it: the auth header call_ai picks and the list the screen shows are the same
# fact about a provider, and two copies of it would drift apart.
#
# `auth` is the header the key rides in. Anthropic's own protocol reads x-api-key, but Moonshot and
# OpenRouter read only a bearer token -- a client that hard-codes one of those cannot talk to the
# other. `disable_thinking` turns extended thinking off, which Other Provider v4 needs: it otherwise
# spends the whole token budget thinking and returns no text at all. Providers whose models think
# only when asked are left alone rather than sent the field they would reject.
AI_PROVIDERS = [
    {
        "id": "anthropic",
        "label": "Anthropic",
        "url": "https://api.anthropic.com",
        "auth": "key",
        "disable_thinking": False,
        "models": [
            {"id": "claude-fable-5-1", "label": "Claude Fable 5.1 — flagship"},
            {"id": "claude-opus-5", "label": "Claude Opus 5 — strongest"},
            {"id": "claude-sonnet-5", "label": "Claude Sonnet 5 — balanced"},
            {"id": "claude-haiku-4-5-20251001", "label": "Claude Haiku 4.5 — fastest"},
        ],
    },
    {
        "id": "zhipu",
        "label": "Z.ai / Zhipu GLM",
        "url": "https://open.bigmodel.cn/api/anthropic",
        "auth": "key",
        "disable_thinking": False,
        "models": [
            {"id": "glm-5.3", "label": "GLM 5.3 — flagship"},
            {"id": "glm-5.3-flash", "label": "GLM 5.3 Flash — fast"},
            {"id": "glm-4.7", "label": "GLM 4.7 — mid-tier"},
        ],
    },
    {
        "id": "moonshot",
        "label": "Moonshot / Kimi",
        "url": "https://api.moonshot.cn/anthropic",
        "auth": "bearer",
        "disable_thinking": False,
        "models": [
            {"id": "kimi-k3", "label": "Kimi K3 — flagship"},
            {"id": "kimi-k2.6", "label": "Kimi K2.6 — optional thinking"},
        ],
    },
    {
        "id": "openrouter",
        "label": "OpenRouter",
        "url": "https://openrouter.ai/api",
        "auth": "bearer",
        "disable_thinking": False,
        "models": [
            {"id": "anthropic/claude-sonnet-5", "label": "Claude Sonnet 5"},
            {"id": "anthropic/claude-opus-5", "label": "Claude Opus 5"},
            {"id": "moonshot/kimi-k3", "label": "Kimi K3"},
        ],
    },
]

# What the AI is told about earnings. It has no news feed and cannot look anything up,
# so the calendar's answer is handed to it as a fact. "Could not check" must stay
# distinct from "there are none": only one of those is safe to sell premium on.
EARNINGS_UNKNOWN = "UNKNOWN"
EARNINGS_NONE = "NONE"
EARNINGS_HORIZON_DAYS = 14


# ---------------- telegram ----------------

def send_telegram(bot_token, chat_id, message, timeout=10):
    """(ok, error). Never raises."""
    payload = json.dumps({"chat_id": chat_id, "text": message, "parse_mode": "HTML"}).encode()
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            result = json.loads(resp.read().decode())
    except Exception as e:
        return False, str(e)
    if result.get("ok"):
        return True, None
    return False, result.get("description", "unknown")


def telegram_from_env(message, env=None):
    env = os.environ if env is None else env
    token, chat = env.get("TELEGRAM_BOT_TOKEN", ""), env.get("TELEGRAM_CHAT_ID", "")
    if not token or not chat:
        return False, "TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set"
    return send_telegram(token, chat, message)


# ---------------- AI ----------------

def earnings_fact(ticker, today=None, horizon_days=EARNINGS_HORIZON_DAYS, fetch=None):
    """The ticker's next earnings date, EARNINGS_NONE if the calendar has none scheduled,
    or EARNINGS_UNKNOWN if the calendar could not be read. Never raises."""
    fetch = market_data.next_earnings if fetch is None else fetch
    try:
        dated = fetch(ticker, today, horizon_days)
    except Exception:
        return EARNINGS_UNKNOWN
    return dated or EARNINGS_NONE


def _earnings_line(ticker, earnings, horizon_days):
    if earnings == EARNINGS_UNKNOWN:
        return ("Earnings: UNKNOWN — no calendar data was available. Do not recall or "
                "guess an earnings date.")
    if earnings == EARNINGS_NONE:
        return (f"Earnings: NONE — no earnings scheduled in the next {horizon_days} days "
                "(exchange calendar).")
    return f"Earnings: {ticker} reports on {earnings} (exchange calendar)."


def build_ai_prompt(ticker, signal, earnings=EARNINGS_UNKNOWN, horizon_days=EARNINGS_HORIZON_DAYS):
    direction = signal.get("direction", "NO_TRADE")
    spread = signal.get("spread")
    verdicts = signal.get("verdicts", {})
    indicators = signal.get("indicators", {})
    iv_pct = signal.get("iv_pct", "?")
    iv_rank = signal.get("iv_rank", "?")

    reasons = []
    for m in ["meanrev", "trend", "ivrich"]:
        v = verdicts.get(m, {})
        reasons.append(f"  {m}: {v.get('direction', '?')} — {v.get('reason', '?')}")

    prompt_parts = [
        f"Ticker: {ticker} at ${signal.get('spot', '?')}",
        f"Direction: {direction}",
        f"Expiration: {signal.get('expiration', '?')} ({signal.get('dte', '?')} DTE)",
        f"IV: {iv_pct}%  IV rank: {iv_rank}",
        _earnings_line(ticker, earnings, horizon_days),
        f"Indicators: RSI {indicators.get('rsi', '?')}, %B {indicators.get('pctb', '?')}, ADX {indicators.get('adx', '?')}",
        f"Mode verdicts:",
        *reasons,
    ]

    if spread:
        prompt_parts += [
            f"Proposed spread: {spread.get('side', '?')} ${spread.get('short', '?')}/{spread.get('long', '?')} (w {spread.get('width', '?')})",
            f"Credit: ${spread.get('credit', 0)*100:.0f}  Max loss: ${spread.get('max_loss', 0):.0f}  ROI: {spread.get('roi_pct', '?')}%",
            f"POP: {spread.get('pop_pct', '?')}%  Breakeven: ${spread.get('breakeven', '?')}  Short delta: {spread.get('short_delta', '?')}",
        ]

    prompt_parts += [
        "",
        "Judge only from the facts above. Do not recall or invent earnings dates, news or "
        "events; if a fact you need is UNKNOWN, say so instead of guessing it.",
        "Check for: 1) whether the earnings date falls inside this trade's life, 2) whether the technical setup aligns, 3) any macro risks you are confident about.",
        "Reply with EXACTLY ONE line starting with VERDICT: followed by CONFIRM | CAUTION | AVOID.",
        "Then on the next line, start with REASON: followed by 1-2 sentences explaining your reasoning.",
    ]
    return "\n".join(prompt_parts)


def parse_ai_verdict(content):
    """(verdict, reason). verdict is None when the reply has no VERDICT: line."""
    verdict = None
    reason = content
    for line in content.split("\n"):
        line = line.strip()
        if line.upper().startswith("VERDICT:"):
            v = line.split(":", 1)[1].strip().upper()
            if "CONFIRM" in v:
                verdict = "CONFIRM"
            elif "AVOID" in v:
                verdict = "AVOID"
            elif "CAUTION" in v:
                verdict = "CAUTION"
        elif line.upper().startswith("REASON:"):
            reason = line.split(":", 1)[1].strip()
    return verdict, reason


def _provider_for(endpoint):
    """The listed provider an endpoint belongs to, or None for one we know nothing about.

    Matched on host, so a custom path under a known provider still gets the right treatment.
    None means an endpoint saved before the list existed, or one typed in by hand.
    """
    host = urllib.parse.urlsplit(endpoint).netloc.lower()
    for p in AI_PROVIDERS:
        if urllib.parse.urlsplit(p["url"]).netloc.lower() == host:
            return p
    return None


def call_ai(api_key, api_endpoint, model, prompt, timeout=20):
    """POST to an Anthropic-compatible /v1/messages endpoint; return the joined text."""
    url = f"{api_endpoint.rstrip('/')}/v1/messages"
    provider = _provider_for(api_endpoint)

    payload = {
        "model": model,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}],
    }
    # Other Provider v4 models think by default and spent the whole budget on it, returning no text at
    # all (even with 4096 tokens). A two-line verdict needs no thinking. An endpoint we do not
    # recognise keeps the field, which is how every custom endpoint has been called all along.
    if provider is None or provider["disable_thinking"]:
        payload["thinking"] = {"type": "disabled"}

    headers = {"Content-Type": "application/json", "anthropic-version": "2023-06-01"}
    # Anthropic's own protocol reads x-api-key. Moonshot and OpenRouter read only a bearer token,
    # and would answer a request carrying x-api-key with an auth error.
    if provider is not None and provider["auth"] == "bearer":
        headers["Authorization"] = f"Bearer {api_key}"
    else:
        headers["x-api-key"] = api_key

    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        result = json.loads(resp.read().decode())
    return "".join(b.get("text", "") for b in result.get("content", []) if b.get("type") == "text")


def ai_review(ticker, signal, env=None):
    """Engine-side review. (verdict, reason); verdict is CONFIRM | CAUTION | AVOID | UNAVAILABLE.

    Anything that is not a clearly parsed verdict -- no key, network failure, a
    reply without a VERDICT line -- is UNAVAILABLE, which the engine treats as a no.
    """
    env = os.environ if env is None else env
    key = env.get("AI_API_KEY", "")
    if not key:
        return "UNAVAILABLE", "AI_API_KEY not set"
    try:
        content = call_ai(
            key,
            env.get("AI_API_ENDPOINT") or DEFAULT_AI_ENDPOINT,
            env.get("AI_MODEL") or DEFAULT_AI_MODEL,
            build_ai_prompt(ticker, signal, earnings_fact(ticker)),
        )
    except Exception as e:
        return "UNAVAILABLE", f"AI call failed: {e}"
    verdict, reason = parse_ai_verdict(content)
    if verdict is None:
        return "UNAVAILABLE", f"unparseable AI reply: {content[:200]}"
    return verdict, reason


# ---------------- AI exit review (live autotrade) ----------------

def build_exit_prompt(trade, spot, mid_debit, earnings=EARNINGS_UNKNOWN,
                      horizon_days=EARNINGS_HORIZON_DAYS):
    side = "bull put" if trade["direction"] == "SELL_PUT" else "bear call"
    return "\n".join([
        f"Open position: {trade['ticker']} {side} spread, short ${trade['short_strike']:g} / "
        f"long ${trade['long_strike']:g}, expires {trade['expiry']}.",
        f"Sold for ${trade['credit']:.2f} per share; it costs ${mid_debit:.2f} to close now. Spot ${spot:.2f}.",
        _earnings_line(trade["ticker"], earnings, horizon_days),
        "",
        "Judge only from the facts above. Do not recall or invent earnings dates, news or "
        "events; if a fact you need is UNKNOWN, say so instead of guessing it.",
        "Check whether the earnings date falls before this spread's expiry, and whether anything "
        "you are confident about makes holding it to expiry materially riskier.",
        "Reply with EXACTLY ONE line starting with VERDICT: followed by EXIT | HOLD.",
        "Then on the next line, start with REASON: followed by 1-2 sentences.",
    ])


def parse_exit_verdict(content):
    verdict, reason = None, content
    for line in content.split("\n"):
        line = line.strip()
        if line.upper().startswith("VERDICT:"):
            v = line.split(":", 1)[1].strip().upper()
            verdict = "EXIT" if "EXIT" in v else "HOLD" if "HOLD" in v else None
        elif line.upper().startswith("REASON:"):
            reason = line.split(":", 1)[1].strip()
    return verdict, reason


def ai_exit_review(trade, spot, mid_debit, env=None):
    """(verdict, reason); verdict is EXIT | HOLD | UNAVAILABLE. Only a parsed EXIT closes a trade."""
    env = os.environ if env is None else env
    key = env.get("AI_API_KEY", "")
    if not key:
        return "UNAVAILABLE", "AI_API_KEY not set"
    try:
        content = call_ai(key, env.get("AI_API_ENDPOINT") or DEFAULT_AI_ENDPOINT,
                          env.get("AI_MODEL") or DEFAULT_AI_MODEL,
                          build_exit_prompt(trade, spot, mid_debit, earnings_fact(trade["ticker"])))
    except Exception as e:
        return "UNAVAILABLE", f"AI call failed: {e}"
    verdict, reason = parse_exit_verdict(content)
    if verdict is None:
        return "UNAVAILABLE", f"unparseable AI reply: {content[:200]}"
    return verdict, reason
