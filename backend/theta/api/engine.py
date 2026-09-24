"""Engine status, on-demand scans and the decision journal."""
from flask import Blueprint, jsonify, request

from theta.context import ctx
from theta.storage import db

bp = Blueprint("engine", __name__)

MAX_JOURNAL_ROWS = 500


@bp.route("/api/engine/status")
def api_engine_status():
    context = ctx()
    settings = context.settings()
    if context.runner is None:
        body = {"running": False, "state": "not started"}
    else:
        body = {"running": context.runner.running, **context.runner.status}
    body.update({"engine_enabled": settings["engine_enabled"], "mode": settings["mode"],
                 "account_mode": settings["account_mode"],
                 "market_hours_only": settings["market_hours_only"]})
    return jsonify(body)


@bp.route("/api/scan/now", methods=["POST"])
def api_scan_now():
    """Run one full engine cycle now, whatever the switch and market hours say."""
    runner = ctx().runner
    if runner is None:
        return jsonify({"error": "The engine isn't running. Start the app with ./run.sh."}), 503
    ok, reason = runner.request_scan()
    if not ok:
        return jsonify({"error": reason}), 409
    return jsonify({"started": True}), 202


@bp.route("/api/scan/latest")
def api_scan_latest():
    """The board: the newest decision for each ticker and DTE Settings still scans.

    Rows for a ticker or DTE since dropped from Settings would otherwise stay on the
    board indefinitely and read as if they were still being scanned. They remain in
    the journal.
    """
    conn = ctx().connect()
    try:
        settings = db.get_settings(conn)
        rows = db.latest_per_ticker(conn)
    finally:
        conn.close()
    watchlist, dtes = set(settings["watchlist"]), set(settings["dtes"])
    return jsonify([r for r in rows
                    if r["decision"]["ticker"] in watchlist and r["decision"]["dte"] in dtes])


@bp.route("/api/scan/clear", methods=["POST"])
def api_scan_clear():
    """Empty the scan board. Scanning carries on; only the logged decisions go."""
    conn = ctx().connect()
    try:
        return jsonify({"cleared": db.clear_journal(conn)})
    finally:
        conn.close()


@bp.route("/api/journal")
def api_journal():
    try:
        limit = int(request.args.get("limit", 100))
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400
    limit = max(1, min(limit, MAX_JOURNAL_ROWS))
    conn = ctx().connect()
    try:
        return jsonify(db.recent_decisions(conn, limit=limit))
    finally:
        conn.close()
