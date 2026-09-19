"""Payoff and implied-volatility surfaces for the Study view."""
import datetime as dt
import time

from flask import Blueprint, jsonify, request

from theta import paper
from theta.market import data as market_data
from theta.market import payoff, surface

bp = Blueprint("surfaces", __name__)

SURFACE_TTL_SEC = 300
_SURFACE_CACHE = {}  # ticker -> (monotonic time, payload)


@bp.route("/api/payoff", methods=["POST"])
def api_payoff():
    """Payoff surface for a spread. spot and sigma are fetched when not supplied."""
    body = request.get_json(silent=True) or {}
    for k in ("direction", "short_strike", "long_strike", "credit"):
        if k not in body:
            return jsonify({"error": f"missing {k}"}), 400
    if "days_left" in body:
        days_left = int(body["days_left"])
    elif "expiry" in body:
        days_left = (dt.date.fromisoformat(body["expiry"]) - dt.date.today()).days
    else:
        return jsonify({"error": "missing days_left or expiry"}), 400
    ticker = (body.get("ticker") or "").strip()
    if ("spot" not in body or "sigma" not in body) and not ticker:
        return jsonify({"error": "ticker required when spot or sigma is not supplied"}), 400
    try:
        spot = float(body["spot"]) if "spot" in body else market_data.get_spot(ticker)
    except Exception as e:
        return jsonify({"error": f"spot unavailable: {e}"}), 502
    sigma = float(body["sigma"]) if "sigma" in body else paper.sigma_for(ticker)
    return jsonify(payoff.payoff_grid(
        body["direction"], float(body["short_strike"]), float(body["long_strike"]),
        float(body["credit"]), int(body.get("contracts", 1)), spot, days_left, sigma,
    ))


@bp.route("/api/iv-surface")
def api_iv_surface():
    """Implied-vol surface, cached per ticker for five minutes."""
    ticker = (request.args.get("ticker") or "").strip().upper()
    if not ticker:
        return jsonify({"error": "ticker required"}), 400
    hit = _SURFACE_CACHE.get(ticker)
    if hit and not request.args.get("refresh") and time.monotonic() - hit[0] < SURFACE_TTL_SEC:
        return jsonify(hit[1])
    try:
        spot = market_data.get_spot(ticker)
        points = market_data.iv_surface_points(ticker, spot)
    except Exception as e:
        return jsonify({"error": f"market data unavailable: {e}"}), 502
    payload = {"ticker": ticker, **surface.build_surface(points, spot)}
    _SURFACE_CACHE[ticker] = (time.monotonic(), payload)
    return jsonify(payload)
