"""Live bot: state, pre-flight checks and the manual controls."""
from flask import Blueprint, jsonify, request

from theta import services
from theta.context import ctx
from theta.engine import autotrade, monitor, runner
from theta.market import data as market_data
from theta.storage import db

bp = Blueprint("bot", __name__)


def _payload(conn, context):
    settings = db.get_settings(conn)
    account = settings["account_mode"]
    trades = db.list_live_trades(conn, account=account)
    active = [t for t in trades if t["state"] in db.ACTIVE_STATES]
    marks = {}
    codes = [c for t in active if t["state"] == "open"
             for c in (t["short_code"], t["long_code"])]
    if codes:
        try:
            q = market_data.quotes(codes)
            marks = {t["id"]: autotrade.spread_prices(q[t["short_code"]],
                                                      q[t["long_code"]])["mid"]
                     for t in active if t["state"] == "open"}
        except Exception:
            marks = {}
    net = db.bot_net_pnl(conn, account=account)
    return {
        "mode": settings["mode"], "account_mode": account,
        "paused": settings["bot_paused"],
        "pause_reason": settings["bot_pause_reason"],
        "monitor": (context.monitor.status if context.monitor is not None
                    else {"state": "not started", "last_ok": None, "last_error": None}),
        "net_pnl": net, "slots": autotrade.slots(net),
        "next_slot_at": autotrade.next_slot_at(net),
        "active": active,
        "closed": [t for t in reversed(trades) if t["state"] == "closed"],
        "marks": marks, "events": db.recent_order_events(conn, 100),
    }


@bp.route("/api/bot")
def api_bot():
    context = ctx()
    conn = context.connect()
    try:
        return jsonify(_payload(conn, context))
    finally:
        conn.close()


@bp.route("/api/bot/preflight")
def api_bot_preflight():
    checks = services.preflight(ctx())
    return jsonify({"checks": checks, "ready": all(c["ok"] for c in checks)})


@bp.route("/api/bot/stop", methods=["POST"])
def api_bot_stop():
    context = ctx()
    conn = context.connect()
    try:
        monitor.stop_trading(conn, services.bot_services(context), runner.utc_now())
        return jsonify(_payload(conn, context))
    finally:
        conn.close()


@bp.route("/api/bot/resume", methods=["POST"])
def api_bot_resume():
    context = ctx()
    conn = context.connect()
    try:
        monitor.resume(conn, services.bot_services(context), runner.utc_now())
        return jsonify(_payload(conn, context))
    finally:
        conn.close()


@bp.route("/api/bot/close-all", methods=["POST"])
def api_bot_close_all():
    body = request.get_json(silent=True) or {}
    if body.get("confirm") != "CLOSE":
        return jsonify({"error": "Type CLOSE to close every bot position"}), 400
    context = ctx()
    conn = context.connect()
    try:
        return jsonify({"closing": monitor.close_all(conn, services.bot_services(context),
                                                     runner.utc_now())})
    finally:
        conn.close()
