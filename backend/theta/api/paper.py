"""The paper book: open positions, closed results and position sizing."""
import datetime as dt
import uuid

from flask import Blueprint, jsonify, request

from theta import paper
from theta.broker import account, manage, settle
from theta.context import ctx
from theta.engine import scan
from theta.market import data as market_data
from theta.storage import db

bp = Blueprint("paper", __name__)


def _settle_due(conn, account, today):
    """Close any position whose expiry has passed, at that day's close."""
    for t in settle.due_for_settlement(
            db.list_positions(conn, account=account, status="open"), today):
        exp = dt.date.fromisoformat(t["expiry"])
        try:
            df = market_data.fetch_klines(
                t["ticker"], (exp - dt.timedelta(days=10)).isoformat(), exp.isoformat())
            close = settle.settlement_close(df, t["expiry"])
        except Exception:
            close = None
        if close is None:
            continue  # no expiry-day close yet; leave open and retry next request
        # Valued as of expiry, so T=0 and the pricer returns exact intrinsic.
        db.close_position(conn, t["id"], t["expiry"],
                          paper.position_pnl(t, close, paper.DEFAULT_SIGMA, exp))


@bp.route("/api/paper")
def api_paper():
    conn = ctx().connect()
    today = dt.date.today()
    try:
        settings = db.get_settings(conn)
        account = settings["account_mode"]
        _settle_due(conn, account, today)
        open_positions = db.list_positions(conn, account=account, status="open")
        closed_positions = db.list_positions(conn, account=account, status="closed")
        risk_cap = settings["max_deployed_risk"]
    finally:
        conn.close()

    open_list = []
    for t in open_positions:
        try:
            spot = market_data.get_spot(t["ticker"])
        except Exception:
            spot = None
        try:
            mtm = (paper.position_pnl(t, spot, paper.sigma_for(t["ticker"]), today)
                   if spot is not None else None)
        except Exception:
            mtm = None
        open_list.append(manage.position_view(t, spot, mtm, today))

    closed_pnls = [t["close_pnl"] for t in closed_positions if t["close_pnl"] is not None]
    wins = sum(1 for p in closed_pnls if p > 0)

    return jsonify({
        "open": open_list,
        "closed": closed_positions,
        "account": account,
        "stats": {
            "total_pnl": round(sum(closed_pnls), 2),
            "wins": wins,
            "losses": len(closed_pnls) - wins,
            "win_rate": round(wins / len(closed_pnls), 2) if closed_pnls else 0,
            "open_count": len(open_positions),
            "deployed_risk": round(sum(p["risk"] for p in open_list), 2),
            "risk_cap": risk_cap,
        },
    })


@bp.route("/api/account")
def api_account():
    try:
        return jsonify(account.fetch())
    except Exception as e:
        return jsonify({"error": f"Real account unavailable: {e}"}), 503


@bp.route("/api/paper/open", methods=["POST"])
def api_paper_open():
    body = request.get_json(force=True)
    required = ["ticker", "direction", "short_strike", "long_strike", "width", "credit", "expiry"]
    for k in required:
        if k not in body:
            return jsonify({"error": f"missing {k}"}), 400

    trade = {
        "id": f"pt_{dt.date.today().isoformat()}_{uuid.uuid4().hex[:8]}",
        "ticker": body["ticker"].upper(),
        "direction": body["direction"],
        "short_strike": float(body["short_strike"]),
        "long_strike": float(body["long_strike"]),
        "width": float(body["width"]),
        "credit": float(body["credit"]),
        "contracts": int(body.get("contracts", 1)),
        "entry_date": dt.date.today().isoformat(),
        "expiry": body["expiry"],
        "mode": body.get("mode", ""),
        "status": "open",
        "close_date": None,
        "close_pnl": None,
        "entry_context": body.get("entry_context"),
    }

    conn = ctx().connect()
    try:
        trade["account"] = db.get_settings(conn)["account_mode"]
        db.insert_position(conn, trade)
    finally:
        conn.close()
    return jsonify(trade), 201


@bp.route("/api/paper/close", methods=["POST"])
def api_paper_close():
    body = request.get_json(force=True)
    trade_id = body.get("id")
    if not trade_id:
        return jsonify({"error": "id required"}), 400

    conn = ctx().connect()
    try:
        account = db.get_settings(conn)["account_mode"]
        trade = next((t for t in db.list_positions(conn, account=account, status="open")
                      if t["id"] == trade_id), None)
        if trade is None:
            return jsonify({"error": "open trade not found"}), 404
        try:
            spot = market_data.get_spot(trade["ticker"])
            pnl = paper.position_pnl(trade, spot, paper.sigma_for(trade["ticker"]),
                                     dt.date.today())
        except Exception as e:
            return jsonify({"error": f"Close failed: {e}"}), 500
        close_date = dt.date.today().isoformat()
        if not db.close_position(conn, trade_id, close_date, pnl):
            return jsonify({"error": "open trade not found"}), 404
    finally:
        conn.close()
    return jsonify({**trade, "status": "closed", "close_date": close_date, "close_pnl": pnl})


@bp.route("/api/size/preview", methods=["POST"])
def api_size_preview():
    """How a signal's spread would be sized, checked with the engine's own risk rules."""
    body = request.get_json(silent=True) or {}
    ticker = (body.get("ticker") or "").strip().upper()
    signal = body.get("signal") or {}
    spread = signal.get("spread")
    if not ticker or not spread:
        return jsonify({"error": "ticker and a signal with a spread are required"}), 400
    conn = ctx().connect()
    try:
        settings = db.get_settings(conn)
        open_positions = db.list_positions(conn, account=settings["account_mode"],
                                           status="open")
    finally:
        conn.close()
    max_loss = float(spread["max_loss"])
    contracts = max(1, int(scan.RISK_PER_TRADE / max_loss)) if max_loss > 0 else 1
    before = sum(scan.position_risk(p) for p in open_positions)
    trade_risk = scan.signal_risk(signal)
    ok, reason = scan.risk_check(ticker, signal, open_positions, settings)
    return jsonify({
        "ticker": ticker,
        "contracts": contracts,
        "trade_risk": round(trade_risk, 2),
        "credit_total": round(float(spread["credit"]) * 100 * contracts, 2),
        "deployed_before": round(before, 2),
        "deployed_after": round(before + trade_risk, 2),
        "cap": settings["max_deployed_risk"],
        "open_positions": len(open_positions),
        "max_open_positions": settings["max_open_positions"],
        "ok": ok,
        "reason": reason,
    })
