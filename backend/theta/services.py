"""Wiring the engine and the monitor to the outside world.

Both take their dependencies as a dict of callables rather than importing them,
which is what lets the tests hand them fakes. Building those dicts is the only
job here; nothing in this module makes a decision.
"""
import datetime as dt

from theta import signals
from theta import notify
from theta.broker.paper import PaperBroker
from theta.market import data as market_data
from theta.engine import monitor, runner


def broker_for(ctx, account_mode):
    """The broker this account trades through.

    Paper gets a simulator that fills from live quotes; live gets the real one.
    The monitor cannot tell them apart, which is what makes paper mode worth
    anything: it exercises the same code.
    """
    if account_mode == "paper":
        return PaperBroker(ctx.connect, market_data.quotes, runner.utc_now, ctx.settings)
    return ctx.broker


def bot_services(ctx):
    """What the position monitor needs: quotes, legs, a broker and two outbound calls."""
    return {
        "broker": broker_for(ctx, ctx.settings()["account_mode"]),
        "quotes": market_data.quotes,
        "legs": market_data.fetch_legs,
        "spot": market_data.get_spot,
        # Bound through the context so a key saved in Settings reaches the bot too.
        "ai_exit": lambda trade, spot, mid: notify.ai_exit_review(
            trade, spot, mid, ctx.credential_env()),
        "send": lambda message: notify.telegram_from_env(message, ctx.credential_env()),
    }


def engine_services(ctx, history):
    """What the scan runner needs. `history` loads daily klines for a ticker."""
    return {
        "evaluate": signals.evaluate,
        # ~400 calendar days covers the 252-bar rank lookback plus its warm-up.
        "closes": lambda ticker: history(ticker, days=400)["close"].tolist(),
        "ai_review": lambda ticker, signal: notify.ai_review(
            ticker, signal, ctx.credential_env()),
        "send_alert": lambda message: notify.telegram_from_env(message, ctx.credential_env()),
        "autotrade": lambda conn, d, settings, now: monitor.enter(
            conn, d, settings, bot_services(ctx), now),
    }


def preflight(ctx):
    """What must be true before live trading may be switched on. Never returns secrets.

    On the paper account the broker checks are reported as satisfied and say so:
    a simulated fill needs quotes, not a funded, unlocked trading connection.
    """
    env = ctx.credential_env()
    account = ctx.settings()["account_mode"]
    checks = [
        {"name": "Telegram configured",
         "ok": bool(env.get("TELEGRAM_BOT_TOKEN") and env.get("TELEGRAM_CHAT_ID")), "detail": ""},
        {"name": "AI key configured", "ok": bool(env.get("AI_API_KEY")), "detail": ""},
        {"name": "Bot monitor running",
         "ok": ctx.monitor is not None and ctx.monitor.running, "detail": ""},
    ]
    for name, fn in (("OpenD connected to the real account", ctx.broker.buying_power),
                     ("Trading unlocked", ctx.broker.unlock)):
        if account == "paper":
            checks.append({"name": name, "ok": True, "detail": "not required on paper"})
            continue
        try:
            result = fn()
            checks.append({"name": name, "ok": True,
                           "detail": result if isinstance(result, str) else ""})
        except Exception as e:
            checks.append({"name": name, "ok": False, "detail": str(e)})
    return checks


def history(ticker, days=5 * 365):
    """Daily klines from the cache; OpenD only when the cache is stale."""
    end = dt.date.today()
    start = end - dt.timedelta(days=days)
    return market_data.fetch_klines(ticker, start.isoformat(), end.isoformat())
