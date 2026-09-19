"""SQLite storage for the engine. stdlib sqlite3 only, no ORM.

One file holds positions, settings, the decision journal, alert history and the
nightly edge table. Transactional writes replace papers.json, whose
read-modify-write pattern could silently drop a trade under concurrent requests.

Every function takes an open connection, so callers (Flask requests, the engine
thread, tests) each own their connection and nothing is shared across threads.
"""
import json
import os
import sqlite3

from theta import paths

DEFAULT_PATH = os.path.join(paths.DATA, "engine.db")

_POSITION_FIELDS = [
    "id", "ticker", "direction", "short_strike", "long_strike", "width", "credit",
    "contracts", "entry_date", "expiry", "mode", "status", "close_date", "close_pnl",
]

_SCHEMA = """
CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL,
    short_strike REAL NOT NULL,
    long_strike REAL NOT NULL,
    width REAL NOT NULL,
    credit REAL NOT NULL,
    contracts INTEGER NOT NULL,
    entry_date TEXT NOT NULL,
    expiry TEXT NOT NULL,
    mode TEXT,
    status TEXT NOT NULL,
    close_date TEXT,
    close_pnl REAL,
    entry_context TEXT
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    ticker TEXT NOT NULL,
    dte INTEGER NOT NULL,
    stage TEXT NOT NULL,
    passed INTEGER NOT NULL,
    direction TEXT,
    reason TEXT,
    payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS journal_ticker_dte ON journal (ticker, dte, id);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT NOT NULL,
    ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_key_ts ON alerts (key, ts);

CREATE TABLE IF NOT EXISTS edge_stats (
    mode TEXT NOT NULL,
    dte INTEGER NOT NULL,
    bucket TEXT NOT NULL,
    stats TEXT NOT NULL,
    built_at TEXT NOT NULL,
    PRIMARY KEY (mode, dte, bucket)
);

CREATE TABLE IF NOT EXISTS live_trades (
    id TEXT PRIMARY KEY,
    ticker TEXT NOT NULL,
    direction TEXT NOT NULL,
    expiry TEXT NOT NULL,
    short_code TEXT NOT NULL,
    long_code TEXT NOT NULL,
    short_strike REAL NOT NULL,
    long_strike REAL NOT NULL,
    width REAL NOT NULL,
    contracts INTEGER NOT NULL,
    planned_credit REAL NOT NULL,
    state TEXT NOT NULL,
    entry_order_id TEXT,
    entry_price REAL,
    entry_reprices INTEGER NOT NULL DEFAULT 0,
    credit REAL,
    tp_order_id TEXT,
    tp_tif TEXT,
    sl_hits INTEGER NOT NULL DEFAULT 0,
    close_order_id TEXT,
    close_price REAL,
    close_reprices INTEGER NOT NULL DEFAULT 0,
    exit_reason TEXT,
    close_debit REAL,
    fees REAL NOT NULL DEFAULT 0,
    pnl REAL,
    ai_reason TEXT,
    last_ai_check TEXT,
    opened_at TEXT NOT NULL,
    filled_at TEXT,
    closed_at TEXT
);
CREATE INDEX IF NOT EXISTS live_trades_state ON live_trades (state, opened_at);

CREATE TABLE IF NOT EXISTS order_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts TEXT NOT NULL,
    trade_id TEXT,
    action TEXT NOT NULL,
    order_id TEXT,
    price REAL,
    status TEXT NOT NULL,
    reason TEXT
);
"""

SIGNAL_MODES = ("meanrev", "trend", "ivrich")

# Expirations are scanned at any DTE in this range; 7 and 14 are only the defaults.
DTE_MIN, DTE_MAX = 1, 365

# Engine off and manual by default: nothing scans or alerts until switched on.
# modes defaults to ivrich only -- in the 5-year backtest it held up in the 2022
# bear market, while trend's edge disappeared.
DEFAULT_SETTINGS = {
    "engine_enabled": False,
    "mode": "manual",
    "watchlist": ["SPY", "QQQ", "META", "NVDA", "AMD", "PLTR", "AAPL", "MSFT", "AMZN", "GOOGL"],
    "modes": ["ivrich"],
    "dtes": [7, 14],
    "interval_min": 15,
    "ticker_gap_sec": 5,
    "market_hours_only": True,
    # Gate switches. Signal and spread-fits always run; auto mode forces risk and AI on.
    "edge_enabled": True,
    "risk_enabled": True,
    "dedupe_enabled": True,
    "edge_min_n": 100,
    "edge_min_expectancy": 0.0,
    "max_open_positions": 5,
    "max_deployed_risk": 2500.0,
    "ai_enabled": True,
    "ai_allow_caution": True,
    "alert_cooldown_hours": 24,
    # Credentials. Empty means "not set here", and the environment (.env) answers instead, so a
    # headless run is unaffected. app.py lays these over os.environ for every outbound call.
    "ai_api_key": "",
    "ai_api_endpoint": "",
    "ai_model": "",
    "telegram_bot_token": "",
    "telegram_chat_id": "",
    # Live autotrade (mode "auto"). See docs/superpowers/specs/2026-09-17-live-autotrade-design.md.
    "tp_pct": 50.0,
    "sl_multiple": 2.0,
    "min_credit": 0.30,
    "bot_paused": False,
    "bot_pause_reason": "",
}


def connect(path=None):
    """Open a connection. WAL mode lets the engine thread write while requests read."""
    path = path or DEFAULT_PATH
    os.makedirs(os.path.dirname(path), exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def init(conn):
    """Create any missing tables. Safe to call on every connection."""
    conn.executescript(_SCHEMA)
    conn.commit()


def _position_row(row):
    d = {k: row[k] for k in _POSITION_FIELDS}
    d["entry_context"] = json.loads(row["entry_context"]) if row["entry_context"] else None
    return d


def insert_position(conn, trade):
    """Insert a position dict. Raises ValueError if the id already exists."""
    values = [trade.get(k) for k in _POSITION_FIELDS]
    ctx = trade.get("entry_context")
    values.append(json.dumps(ctx) if ctx is not None else None)
    cols = ", ".join(_POSITION_FIELDS + ["entry_context"])
    marks = ", ".join("?" for _ in values)
    try:
        conn.execute(f"INSERT INTO positions ({cols}) VALUES ({marks})", values)
    except sqlite3.IntegrityError as e:
        raise ValueError(f"position {trade.get('id')} already exists") from e
    conn.commit()


def list_positions(conn, status=None):
    """All positions, oldest entry first, optionally filtered by status."""
    if status is None:
        rows = conn.execute("SELECT * FROM positions ORDER BY entry_date, id").fetchall()
    else:
        rows = conn.execute(
            "SELECT * FROM positions WHERE status = ? ORDER BY entry_date, id", (status,)
        ).fetchall()
    return [_position_row(r) for r in rows]


def close_position(conn, position_id, close_date, close_pnl):
    """Close an OPEN position. Returns False if it is missing or already closed.

    The status check lives in the UPDATE itself, so a retry or a race can never
    overwrite a P&L that was already realized.
    """
    cur = conn.execute(
        "UPDATE positions SET status = 'closed', close_date = ?, close_pnl = ? "
        "WHERE id = ? AND status = 'open'",
        (close_date, close_pnl, position_id),
    )
    conn.commit()
    return cur.rowcount == 1


def import_papers_json(conn, path):
    """Copy trades from a legacy papers.json. Existing ids are skipped.

    Returns the number of trades newly imported, so running it twice imports 0.
    """
    if not os.path.exists(path):
        return 0
    with open(path) as f:
        trades = json.load(f).get("trades", [])
    added = 0
    for t in trades:
        try:
            insert_position(conn, t)
            added += 1
        except ValueError:
            pass
    return added


def get_settings(conn):
    """Stored settings merged over the defaults."""
    out = {k: (list(v) if isinstance(v, list) else v) for k, v in DEFAULT_SETTINGS.items()}
    for row in conn.execute("SELECT key, value FROM settings"):
        if row["key"] in out:
            out[row["key"]] = json.loads(row["value"])
    return out


def _validate(key, value):
    if key not in DEFAULT_SETTINGS:
        raise ValueError(f"unknown setting: {key}")
    default = DEFAULT_SETTINGS[key]
    if isinstance(default, bool):
        ok = isinstance(value, bool)
    elif isinstance(default, float):
        ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif isinstance(default, int):
        ok = isinstance(value, int) and not isinstance(value, bool)
    elif isinstance(default, list):
        ok = isinstance(value, list)
    else:
        ok = isinstance(value, type(default))
    if not ok:
        raise ValueError(f"{key} must be {type(default).__name__}")
    if key == "mode" and value not in ("manual", "auto"):
        raise ValueError("mode must be 'manual' or 'auto'")
    if key == "tp_pct" and not 0 < value < 100:
        raise ValueError("tp_pct must be between 0 and 100")
    if key == "sl_multiple" and value <= 0:
        raise ValueError("sl_multiple must be above 0")
    if key == "min_credit" and value < 0.05:
        raise ValueError("min_credit must be at least 0.05")
    if key == "modes" and (not value or any(m not in SIGNAL_MODES for m in value)):
        raise ValueError(f"modes must be a non-empty subset of {list(SIGNAL_MODES)}")
    if key == "watchlist":
        value = [str(t).strip().upper() for t in value if str(t).strip()]
        if not value:
            raise ValueError("watchlist must contain at least one ticker")
    if key == "dtes":
        if not value or any(not isinstance(d, int) or isinstance(d, bool) or not DTE_MIN <= d <= DTE_MAX
                            for d in value):
            raise ValueError(f"dtes must be a non-empty list of days between {DTE_MIN} and {DTE_MAX}")
        value = sorted(set(value))
    return value


def put_settings(conn, updates):
    """Validate every update first, then write them all. Returns the merged settings.

    All-or-nothing: one bad key rejects the whole update, so settings are never
    left half-applied.
    """
    clean = {k: _validate(k, v) for k, v in updates.items()}
    for k, v in clean.items():
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (k, json.dumps(v)),
        )
    conn.commit()
    return get_settings(conn)


def reset_settings(conn):
    """Forget every stored setting, returning to DEFAULT_SETTINGS."""
    conn.execute("DELETE FROM settings")
    conn.commit()
    return get_settings(conn)


# ---------------- journal ----------------
# Timestamps are ISO-8601 UTC strings with a fixed format
# ("2026-09-16T14:00:00+00:00"), so string comparison is time comparison.

def log_decision(conn, decision, ts):
    """Record one scan decision -- including rejections, and why."""
    cur = conn.execute(
        "INSERT INTO journal (ts, ticker, dte, stage, passed, direction, reason, payload) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (ts, decision["ticker"], decision["dte"], decision["stage"], int(bool(decision["passed"])),
         decision.get("direction"), decision.get("reason"), json.dumps(decision, default=str)),
    )
    conn.commit()
    return cur.lastrowid


def _journal_row(row):
    return {"id": row["id"], "ts": row["ts"], "decision": json.loads(row["payload"])}


def recent_decisions(conn, limit=100):
    """Newest decisions first."""
    rows = conn.execute("SELECT * FROM journal ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_journal_row(r) for r in rows]


def latest_per_ticker(conn):
    """The most recent decision for each (ticker, dte), sorted by ticker then dte."""
    rows = conn.execute(
        "SELECT j.* FROM journal j "
        "JOIN (SELECT ticker, dte, MAX(id) AS id FROM journal GROUP BY ticker, dte) m "
        "ON j.id = m.id ORDER BY j.ticker, j.dte"
    ).fetchall()
    return [_journal_row(r) for r in rows]


def clear_journal(conn):
    """Drop every logged decision. The engine keeps scanning; this only empties the board."""
    cur = conn.execute("DELETE FROM journal")
    conn.commit()
    return cur.rowcount


def decisions_since(conn, since_ts):
    """Decisions at or after since_ts, oldest first."""
    rows = conn.execute("SELECT * FROM journal WHERE ts >= ? ORDER BY id", (since_ts,)).fetchall()
    return [_journal_row(r) for r in rows]


# ---------------- alerts ----------------

def record_alert(conn, key, ts):
    conn.execute("INSERT INTO alerts (key, ts) VALUES (?, ?)", (key, ts))
    conn.commit()


def alerted_since(conn, key, since_ts):
    """True if this alert key was sent at or after since_ts."""
    row = conn.execute(
        "SELECT 1 FROM alerts WHERE key = ? AND ts >= ? LIMIT 1", (key, since_ts)
    ).fetchone()
    return row is not None


# ---------------- edge table ----------------

def save_edge_table(conn, table, built_at):
    """Replace the whole edge table with a new build, atomically."""
    with conn:
        conn.execute("DELETE FROM edge_stats")
        conn.executemany(
            "INSERT INTO edge_stats (mode, dte, bucket, stats, built_at) VALUES (?, ?, ?, ?, ?)",
            [(m, d, b, json.dumps(stats), built_at) for (m, d, b), stats in table.items()],
        )


def load_edge_table(conn):
    """(table keyed by (mode, dte, bucket), built_at) -- or ({}, None) if never built."""
    rows = conn.execute("SELECT * FROM edge_stats").fetchall()
    if not rows:
        return {}, None
    table = {(r["mode"], r["dte"], r["bucket"]): json.loads(r["stats"]) for r in rows}
    return table, rows[0]["built_at"]


# ---------------- live autotrade ----------------

ACTIVE_STATES = ("entering", "open", "closing")

_LIVE_FIELDS = [
    "id", "ticker", "direction", "expiry", "short_code", "long_code", "short_strike",
    "long_strike", "width", "contracts", "planned_credit", "state", "entry_order_id",
    "entry_price", "entry_reprices", "credit", "tp_order_id", "tp_tif", "sl_hits",
    "close_order_id", "close_price", "close_reprices", "exit_reason", "close_debit",
    "fees", "pnl", "ai_reason", "last_ai_check", "opened_at", "filled_at", "closed_at",
]


def insert_live_trade(conn, trade):
    cols = [k for k in _LIVE_FIELDS if k in trade]
    conn.execute(
        f"INSERT INTO live_trades ({', '.join(cols)}) VALUES ({', '.join('?' for _ in cols)})",
        [trade[k] for k in cols],
    )
    conn.commit()


def update_live_trade(conn, trade_id, **fields):
    unknown = (set(fields) - set(_LIVE_FIELDS)) | ({"id"} & set(fields))
    if unknown:
        raise ValueError(f"cannot update live_trades field(s): {', '.join(sorted(unknown))}")
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(f"UPDATE live_trades SET {sets} WHERE id = ?", [*fields.values(), trade_id])
    conn.commit()


def get_live_trade(conn, trade_id):
    row = conn.execute("SELECT * FROM live_trades WHERE id = ?", (trade_id,)).fetchone()
    return dict(row) if row else None


def list_live_trades(conn, states=None):
    if states is None:
        rows = conn.execute("SELECT * FROM live_trades ORDER BY opened_at, id").fetchall()
    else:
        marks = ", ".join("?" for _ in states)
        rows = conn.execute(
            f"SELECT * FROM live_trades WHERE state IN ({marks}) ORDER BY opened_at, id", tuple(states)
        ).fetchall()
    return [dict(r) for r in rows]


def log_order_event(conn, ts, action, status, trade_id=None, order_id=None, price=None, reason=None):
    conn.execute(
        "INSERT INTO order_events (ts, trade_id, action, order_id, price, status, reason) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (ts, trade_id, action, order_id, price, status, reason),
    )
    conn.commit()


def recent_order_events(conn, limit=200):
    rows = conn.execute("SELECT * FROM order_events ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [dict(r) for r in rows]


def consecutive_rejections(conn):
    """How many of the most recent order placements were rejected, in a row."""
    rows = conn.execute(
        "SELECT status FROM order_events WHERE action LIKE 'place_%' ORDER BY id DESC LIMIT 50"
    ).fetchall()
    n = 0
    for r in rows:
        if r["status"] != "rejected":
            break
        n += 1
    return n


def bot_net_pnl(conn, since_ts=None):
    sql = "SELECT COALESCE(SUM(pnl), 0) AS total FROM live_trades WHERE state = 'closed'"
    args = ()
    if since_ts is not None:
        sql += " AND closed_at >= ?"
        args = (since_ts,)
    return float(conn.execute(sql, args).fetchone()["total"])


def bot_entries_since(conn, since_ts):
    return conn.execute(
        "SELECT COUNT(*) AS n FROM live_trades WHERE state != 'entry_cancelled' AND opened_at >= ?",
        (since_ts,),
    ).fetchone()["n"]


def cancelled_since(conn, ticker, since_ts):
    return conn.execute(
        "SELECT COUNT(*) AS n FROM live_trades WHERE ticker = ? AND state = 'entry_cancelled' AND opened_at >= ?",
        (ticker.upper(), since_ts),
    ).fetchone()["n"]
