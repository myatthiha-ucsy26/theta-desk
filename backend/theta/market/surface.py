"""IV surface shaping: raw per-contract implied vols -> a regular grid. Pure.

Rows are expirations (nearest first), columns are strikes (ascending), cells are
decimal IV or None where a strike has no quote for that expiration.
"""
import math


def pick_expiries(expiries, max_n=6):
    """Up to max_n (expiry, dte) pairs, evenly spread, always keeping the nearest and farthest."""
    ordered = sorted(expiries, key=lambda e: e[1])
    if len(ordered) <= max_n:
        return ordered
    idx = sorted({round(i * (len(ordered) - 1) / (max_n - 1)) for i in range(max_n)})
    return [ordered[i] for i in idx]


def _valid(iv):
    return iv is not None and isinstance(iv, (int, float)) and math.isfinite(iv) and iv > 0


def build_surface(points, spot, max_strikes=41):
    cells = {}
    dte_of = {}
    for p in points:
        if not _valid(p.get("iv")):
            continue
        cells.setdefault((p["expiry"], float(p["strike"])), []).append(float(p["iv"]))
        dte_of[p["expiry"]] = p["dte"]

    expiries = sorted(dte_of, key=lambda e: dte_of[e])
    count = {}
    for (_, k) in cells:
        count[k] = count.get(k, 0) + 1
    need = math.ceil(len(expiries) / 2)
    strikes = sorted(k for k, n in count.items() if n >= need)
    if len(strikes) > max_strikes:
        idx = sorted({round(i * (len(strikes) - 1) / (max_strikes - 1)) for i in range(max_strikes)})
        strikes = [strikes[i] for i in idx]

    grid = []
    for e in expiries:
        row = []
        for k in strikes:
            vals = cells.get((e, k))
            row.append(round(sum(vals) / len(vals), 6) if vals else None)
        grid.append(row)
    flat = [v for row in grid for v in row if v is not None]
    return {
        "spot": spot,
        "expiries": expiries,
        "dtes": [dte_of[e] for e in expiries],
        "strikes": strikes,
        "iv": grid,
        "min_iv": min(flat) if flat else None,
        "max_iv": max(flat) if flat else None,
    }