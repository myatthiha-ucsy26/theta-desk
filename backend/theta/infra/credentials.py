"""Which settings stand in for which environment variable, and which are secret.

The engine runs headless and reads the environment; the dashboard writes
settings. Mapping one onto the other in a single place is what stops the two
halves disagreeing about where a key came from.
"""

# A stored value is laid over os.environ rather than replacing it, so an empty
# setting leaves .env in charge.
SETTING_ENV = {
    "ai_api_key": "AI_API_KEY",
    "ai_api_endpoint": "AI_API_ENDPOINT",
    "ai_model": "AI_MODEL",
    "telegram_bot_token": "TELEGRAM_BOT_TOKEN",
    "telegram_chat_id": "TELEGRAM_CHAT_ID",
}

# The two that authenticate something, so they are never sent back in the clear.
# A saved secret reads out as this fixed mask, which the write path recognises
# and leaves alone. The width is constant, so it says only that a value is set.
SECRET_SETTINGS = ("ai_api_key", "telegram_bot_token")
SECRET_MASK = "********"


def env_with(environ, stored):
    """A copy of `environ` with the credentials saved in Settings laid over it."""
    env = dict(environ)
    for key, name in SETTING_ENV.items():
        if stored.get(key):
            env[name] = stored[key]
    return env


def public(settings):
    """Settings as the browser may see them: a stored secret comes back masked."""
    out = dict(settings)
    for key in SECRET_SETTINGS:
        if out.get(key):
            out[key] = SECRET_MASK
    return out


def without_unchanged_secrets(body):
    """Drop masked secrets from a settings write.

    The screen edits a diff and never saw the real secret, so a mask posted back
    can only mean "unchanged". Dropping it here is what makes the mask safe to
    return at all.
    """
    return {k: v for k, v in body.items()
            if not (k in SECRET_SETTINGS and v == SECRET_MASK)}
