"""Read-only market data over MCP.

Exposes the OpenD quote path — underlying snapshots, expirations and option
chains — to any MCP client, so market questions can be asked without going
through the dashboard. It places no orders and writes nothing.

Every request goes through theta.market.data, which means it shares this
project's OpenD rate limiters rather than competing with the engine for the
same quota.

Run with:  python -m theta.mcp_server
"""
from mcp.server.mcpserver import MCPServer

from theta.market import data

mcp = MCPServer("moomoo")

SNAPSHOT_BATCH = 40  # OpenD caps a snapshot request at this many codes


@mcp.tool()
def quote(symbols: str) -> str:
    """Latest snapshot for one or more underlyings (comma-separated, e.g. 'SPY,QQQ').

    Returns last price, previous close and percent change.
    """
    codes = [data.norm(s) for s in symbols.split(",") if s.strip()]
    if not codes:
        return "No symbols given."
    rows = []
    for _, r in data.snapshot(codes).iterrows():
        last, prev = r.get("last_price"), r.get("prev_close_price")
        rows.append({
            "code": r["code"],
            "last": round(float(last), 2) if last is not None else None,
            "prev_close": round(float(prev), 2) if prev else None,
            "change_pct": round((last - prev) / prev * 100, 2) if prev and last else None,
        })
    return str(rows)


@mcp.tool()
def option_expirations(symbol: str) -> str:
    """Listed option expirations for a symbol, with days to expiration."""
    return str(data.expirations(symbol))


@mcp.tool()
def option_chain(symbol: str, expiration: str, option_type: str = "PUT",
                 strike_pct: float = 0.10, min_strike: float = 0.0,
                 max_strike: float = 0.0) -> str:
    """One expiration's chain with live bid/ask, IV, delta, theta, open interest and volume.

    expiration: 'YYYY-MM-DD', from option_expirations.
    option_type: 'PUT', 'CALL' or 'ALL'.
    strike_pct: window around spot to include (0.10 = +/-10%), ignored when
    min_strike or max_strike is given. Keep the window narrow: every contract
    costs snapshot quota.
    """
    spot = data.get_spot(symbol)
    chain = data.option_chain(symbol, expiration)

    wanted = option_type.upper()
    if wanted in ("PUT", "CALL"):
        chain = chain[chain["option_type"] == wanted]

    if min_strike or max_strike:
        lo, hi = min_strike or 0, max_strike or float("inf")
    else:
        lo, hi = spot * (1 - strike_pct), spot * (1 + strike_pct)
    chain = chain[(chain["strike_price"] >= lo) & (chain["strike_price"] <= hi)]

    codes = chain["code"].tolist()
    if not codes:
        return f"No strikes between {lo:.1f} and {hi:.1f} (spot {spot:.2f})."

    # The snapshot omits strike and type, so carry them over from the chain.
    strike_of = dict(zip(chain["code"], chain["strike_price"]))
    type_of = dict(zip(chain["code"], chain["option_type"]))

    contracts = []
    for i in range(0, len(codes), SNAPSHOT_BATCH):
        for _, r in data.snapshot(codes[i:i + SNAPSHOT_BATCH]).iterrows():
            contracts.append({
                "code": r["code"],
                "type": type_of.get(r["code"]),
                "strike": float(strike_of[r["code"]]),
                "bid": r.get("bid_price"),
                "ask": r.get("ask_price"),
                "last": r.get("last_price"),
                "iv": r.get("option_implied_volatility"),
                "delta": _round(r.get("option_delta"), 4),
                "theta": _round(r.get("option_theta"), 4),
                "oi": r.get("option_open_interest"),
                "vol": r.get("volume"),
            })
    contracts.sort(key=lambda c: c["strike"])
    return str({"symbol": data.norm(symbol), "spot": round(spot, 2),
                "expiration": expiration, "count": len(contracts),
                "contracts": contracts})


def _round(v, dp):
    return round(float(v), dp) if v is not None else None


if __name__ == "__main__":
    mcp.run()
