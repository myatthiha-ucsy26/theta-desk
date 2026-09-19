"""Signal and backtest endpoints, synchronous and streaming."""
import datetime as dt

from flask import Blueprint, Response, jsonify, request

from theta import signals
from theta.api import streams
from theta.market import data as market_data
from theta.research.backtest import aggregate, run_backtest

bp = Blueprint("signal", __name__)

SSE_HEADERS = {"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}


def _query():
    """(ticker, dte, modes) from the query string, or (None, error response)."""
    ticker = request.args.get("ticker", "").strip()
    if not ticker:
        return None, (jsonify({"error": "ticker required"}), 400)
    try:
        dte = int(request.args.get("dte", "14"))
    except ValueError:
        return None, (jsonify({"error": "bad dte"}), 400)
    modes = [m for m in request.args.get("modes", "ivrich").split(",")
             if m in signals.ALL_MODES] or ["ivrich"]
    return (ticker, dte, modes), None


@bp.route("/api/signal")
def api_signal():
    parsed, err = _query()
    if err:
        return err
    ticker, dte, modes = parsed
    try:
        return jsonify(signals.evaluate(ticker, dte, modes))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/signal/stream")
def api_signal_stream():
    """Streams each computation step as a log line."""
    parsed, err = _query()
    if err:
        return err
    ticker, dte, modes = parsed
    return Response(streams.evaluate_stream(ticker, dte, modes),
                    mimetype="text/event-stream", headers=SSE_HEADERS)


@bp.route("/api/backtest")
def api_backtest():
    parsed, err = _query()
    if err:
        return err
    ticker, dte, modes = parsed
    years = int(request.args.get("years", "2"))
    try:
        end = dt.date.today()
        start = (end - dt.timedelta(days=years * 365)).isoformat()
        df = market_data.fetch_klines(ticker, start, end.isoformat())
        trades = run_backtest(ticker, df, modes, dte)
        last_trades = [{k: (v.isoformat() if hasattr(v, "isoformat") else v)
                        for k, v in t.items()} for t in trades[-20:]]
        return jsonify({"stats": aggregate(trades), "trades": last_trades})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@bp.route("/api/backtest/stream")
def api_backtest_stream():
    parsed, err = _query()
    if err:
        return err
    ticker, dte, modes = parsed
    years = int(request.args.get("years", "2"))
    return Response(streams.backtest_stream(ticker, dte, modes, years),
                    mimetype="text/event-stream", headers=SSE_HEADERS)
