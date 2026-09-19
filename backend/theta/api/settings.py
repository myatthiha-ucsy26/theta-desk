"""Settings, credentials, outbound test messages and the learn view."""
import datetime as dt

from flask import Blueprint, jsonify, request

from theta import credentials, notify, services
from theta.context import ctx
from theta.engine import learn
from theta.storage import db

bp = Blueprint("settings", __name__)


def _secret(body_value, env_name):
    """Prefer an explicitly supplied value, then the saved setting, then the environment.

    The engine runs headless with no browser to supply credentials, so settings
    and env are the real source. The request body stays supported for the
    interactive dashboard.
    """
    v = (body_value or "").strip()
    return v or ctx().credential_env().get(env_name, "")


@bp.route("/api/settings", methods=["GET", "POST"])
def api_settings():
    context = ctx()
    conn = context.connect()
    try:
        if request.method == "GET":
            return jsonify(credentials.public(db.get_settings(conn)))
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify({"error": "JSON object required"}), 400
        body = credentials.without_unchanged_secrets(body)
        confirm = body.pop("confirm", None)
        current = db.get_settings(conn)
        wanted_account = body.get("account_mode", current["account_mode"])
        wanted_mode = body.get("mode", current["mode"])

        # Leaving the live account while it still holds positions would strand
        # them: the monitor is the only thing that closes a position, and it
        # follows the account. Refuse, and say what is in the way.
        if current["account_mode"] == "live" and wanted_account == "paper":
            open_live = db.open_live_trades_any_account(conn, "live")
            if open_live:
                names = ", ".join(sorted({t["ticker"] for t in open_live}))
                return jsonify({"error": (
                    f"Close the live account's open positions first ({names}). "
                    "Switching to paper would leave them unmanaged.")}), 409

        # Real money needs the speed bumps; the paper account needs none of them.
        going_live = (wanted_account == "live" and wanted_mode == "auto"
                      and not (current["account_mode"] == "live" and current["mode"] == "auto"))
        if going_live:
            if confirm != "LIVE":
                return jsonify({"error": "Type LIVE to switch on live trading"}), 400
            failed = [c["name"] for c in services.preflight(context) if not c["ok"]]
            if failed:
                return jsonify({"error": "Pre-flight failed: " + ", ".join(failed)}), 400
        try:
            saved = db.put_settings(conn, body)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        if context.runner is not None:
            context.runner.wake()
        return jsonify(credentials.public(saved))
    finally:
        conn.close()


@bp.route("/api/settings/reset", methods=["POST"])
def api_settings_reset():
    conn = ctx().connect()
    try:
        return jsonify(credentials.public(db.reset_settings(conn)))
    finally:
        conn.close()


@bp.route("/api/alert/telegram", methods=["POST"])
def api_alert_telegram():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "JSON body required"}), 400
    bot_token = _secret(body.get("bot_token"), "TELEGRAM_BOT_TOKEN")
    chat_id = _secret(body.get("chat_id"), "TELEGRAM_CHAT_ID")
    message = (body.get("message") or "").strip()
    if not bot_token or not chat_id or not message:
        return jsonify({"error": "bot_token, chat_id, and message required"}), 400
    ok, err = notify.send_telegram(bot_token, chat_id, message)
    if ok:
        return jsonify({"ok": True})
    return jsonify({"error": err}), 400


@bp.route("/api/ai/providers")
def api_ai_providers():
    """The endpoints the AI review offers, each with the models it serves.

    Served rather than hard-coded in the browser: which header a provider wants
    and which models it serves are the same fact, and notify has to know the
    former to make the call at all.
    """
    return jsonify(notify.AI_PROVIDERS)


@bp.route("/api/ai/confirm", methods=["POST"])
def api_ai_confirm():
    body = request.get_json(silent=True)
    if not body:
        return jsonify({"error": "JSON body required"}), 400
    api_key = _secret(body.get("api_key"), "AI_API_KEY")
    api_endpoint = _secret(body.get("api_endpoint"), "AI_API_ENDPOINT").rstrip("/")
    model = _secret(body.get("model"), "AI_MODEL") or notify.DEFAULT_AI_MODEL
    ticker = (body.get("ticker") or "").strip()
    signal = body.get("signal") or {}
    if not api_key or not api_endpoint or not ticker or not signal:
        return jsonify({"error": "api_key, api_endpoint, ticker, and signal required"}), 400

    try:
        content = notify.call_ai(api_key, api_endpoint, model,
                                 notify.build_ai_prompt(ticker, signal,
                                                        notify.earnings_fact(ticker)))
    except Exception as e:
        return jsonify({"error": str(e)}), 500
    if not content.strip():
        return jsonify({"error": "The AI sent back an empty answer. Try again in a moment."}), 502
    verdict, reason = notify.parse_ai_verdict(content)
    # An unparseable reply has always shown as CAUTION; keep that.
    return jsonify({"verdict": verdict or "CAUTION", "reason": reason, "raw": content[:1000]})


@bp.route("/api/learn")
def api_learn():
    """Gate funnel over recent days, the edge table, and paper results vs backtest."""
    try:
        days = int(request.args.get("days", 7))
    except ValueError:
        return jsonify({"error": "days must be an integer"}), 400
    days = max(1, min(days, 90))
    since = (dt.datetime.now(dt.timezone.utc)
             - dt.timedelta(days=days)).isoformat(timespec="seconds")
    conn = ctx().connect()
    try:
        settings = db.get_settings(conn)
        decisions = [r["decision"] for r in db.decisions_since(conn, since)]
        table, built_at = db.load_edge_table(conn)
        closed = db.list_positions(conn, account=settings["account_mode"], status="closed")
    finally:
        conn.close()
    min_n, min_exp = settings["edge_min_n"], settings["edge_min_expectancy"]
    return jsonify({
        "days": days,
        "decisions": len(decisions),
        "errors": learn.count_errors(decisions),
        "funnel": learn.funnel(decisions),
        "edge": learn.edge_cells(table, min_n, min_exp),
        "edge_built_at": built_at,
        "min_n": min_n,
        "paper": learn.paper_vs_backtest(closed, table, min_n, min_exp),
    })
