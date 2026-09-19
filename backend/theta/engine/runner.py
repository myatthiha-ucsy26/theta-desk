"""The engine's clock: runs scan cycles on a timer in a background thread.

Owns the IO that scan deliberately does not: the database, the edge-table
rebuild, and sending alerts. Services (quotes, AI, Telegram) are injected, so the
whole loop is testable without OpenD or the network.
"""
import datetime as dt
import threading
import time

from theta.storage import db
from theta.engine import edge
from theta.engine import scan
from theta.research.backtest import run_backtest

EDGE_MAX_AGE = dt.timedelta(hours=24)

# The 27 tickers of the 5-year validation run. The edge table always pools over
# these (plus the watchlist): pooling over a short watchlist alone leaves cells
# far below the 100-trade minimum -- two tickers gave ivrich/14d/high only 44
# trades -- and every alert would be UNVALIDATED.
EDGE_UNIVERSE = (
    "AAPL", "AMD", "AMZN", "ASML", "AVGO", "BE", "COST", "DELL", "GE", "GOOGL",
    "LULU", "META", "MKL", "MRNA", "MSFT", "MSTR", "MU", "NBIS", "NVDA", "ORCL",
    "PLTR", "QQQ", "RKLB", "SNDK", "SOXL", "SPY", "TSLA",
)
IDLE_RECHECK_SEC = 60  # how often a disabled / closed-market engine looks again


def utc_now():
    return dt.datetime.now(dt.timezone.utc)


def iso(t):
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds")


def next_scan_at(state, settings, now):
    """When the engine will next run a scheduled scan, as an ISO UTC string, or None.

    None while the engine is switched off (manual scans aside, nothing is scheduled).
    """
    if settings is None or not settings["engine_enabled"]:
        return None
    if state == "error":
        return iso(now + dt.timedelta(seconds=IDLE_RECHECK_SEC))
    if state == "market closed":
        return iso(scan.next_market_open(now))
    if state != "idle":
        return None
    candidate = now + dt.timedelta(minutes=settings["interval_min"])
    if settings["market_hours_only"] and not scan.market_open(candidate):
        return iso(scan.next_market_open(candidate))
    return iso(candidate)


def edge_is_stale(built_at, now):
    return built_at is None or now - dt.datetime.fromisoformat(built_at) > EDGE_MAX_AGE


def edge_covers(table, dtes):
    """True when the built table has a cell for every configured DTE.

    Adding an expiration in Settings must rebuild the table now, not up to
    EDGE_MAX_AGE later -- until then the gate has no data and blocks every scan.
    """
    return set(dtes) <= {dte for _, dte, _ in table}


def edge_universe(watchlist):
    """Tickers the edge table pools over: the validation universe plus the watchlist."""
    return sorted(set(EDGE_UNIVERSE) | {t.upper() for t in watchlist})


def build_edge_table(tickers, load_history, dtes=(7, 14), slippage=0.10):
    """Pooled backtest over the watchlist, bucketed by (mode, dte, IV rank).

    load_history(ticker) returns a daily kline DataFrame. Tickers whose history
    cannot be loaded are skipped rather than failing the whole build.
    """
    trades = []
    for tk in tickers:
        try:
            df = load_history(tk)
        except Exception:
            continue
        for mode in db.SIGNAL_MODES:
            for dte in dtes:
                trades += run_backtest(tk, df, [mode], dte, slippage=slippage)
    return edge.build_edge_table(trades)


def run_cycle(conn, settings, services, now_fn=utc_now, sleep=time.sleep):
    """Scan every watchlist ticker at every DTE; journal all; alert on passes."""
    edge_table, _ = db.load_edge_table(conn)
    cooldown = dt.timedelta(hours=settings["alert_cooldown_hours"])
    deps = {
        "evaluate": services["evaluate"],
        "closes": services["closes"],
        "ai_review": services["ai_review"],
        "edge_table": edge_table,
        "open_positions": db.list_positions(conn, account=settings["account_mode"],
                                            status="open"),
        "recently_alerted": lambda key: db.alerted_since(conn, key, iso(now_fn() - cooldown)),
    }
    decisions = []
    for i, ticker in enumerate(settings["watchlist"]):
        if i:
            sleep(settings["ticker_gap_sec"])
        for dte in settings["dtes"]:
            d = scan.scan_ticker(ticker, dte, settings, deps)
            if d["passed"]:
                ok, err = services["send_alert"](scan.format_alert(d))
                d["alert_sent"], d["alert_error"] = ok, err
                if ok:
                    # Only a delivered alert starts the cooldown; a failed send retries next cycle.
                    db.record_alert(conn, d["alert_key"], iso(now_fn()))
            # "dedupe" means every gate passed but the alert is in cooldown; the bot still
            # gets it, so an entry blocked once (e.g. before the entry window) is retried.
            # Settings are re-read here: a cycle takes minutes, and switching live trading
            # on or off must apply to the rest of it.
            if "autotrade" in services and d["stage"] in ("alert", "dedupe"):
                latest = db.get_settings(conn)
                if latest["mode"] == "auto":
                    d["autotrade"] = services["autotrade"](conn, d, latest, now_fn())
            db.log_decision(conn, d, iso(now_fn()))
            decisions.append(d)
    return decisions


class Runner:
    def __init__(self, db_path, services, load_history, now_fn=utc_now, sleep=None,
                 build_fn=build_edge_table):
        self.db_path = db_path
        self.services = services
        self.load_history = load_history
        self.now_fn = now_fn
        self.build_fn = build_fn
        self._stop = threading.Event()
        self._wake = threading.Event()   # set by stop() and request_scan() to end a wait early
        self._lock = threading.Lock()
        self._busy = False               # a tick is in progress
        self._scan_requested = False
        self.sleep = sleep if sleep is not None else self._stop.wait
        self._thread = None
        self.status = {
            "state": "stopped", "last_tick": None, "last_cycle": None,
            "last_error": None, "edge_built_at": None, "decisions": 0, "alerts": 0,
            "last_trigger": None, "next_scan_at": None,
        }

    @property
    def running(self):
        return self._thread is not None and self._thread.is_alive()

    def request_scan(self):
        """Ask the engine thread to run one full cycle now. Returns (ok, reason).

        A manual scan ignores the on/off switch and market hours -- the person asked
        for it -- but goes through exactly the same gates, journal and alerts.
        """
        with self._lock:
            if not self.running:
                return False, "the engine thread is not running"
            if self._busy or self._scan_requested:
                return False, "a scan is already running"
            self._scan_requested = True
        self._wake.set()
        return True, "scan started"

    def wake(self):
        """End the current wait early so the loop re-reads the settings.

        Nothing else nudges a parked loop, so flipping the switch would leave the badged
        state stale until the next recheck -- up to IDLE_RECHECK_SEC of the header saying
        "Off" next to a switch that is plainly on.
        """
        self._wake.set()

    def tick(self, force=False):
        """One pass: check switches and hours, refresh the edge table, scan. Never raises.

        force=True is a manual scan: it skips the on/off switch and market-hours checks.
        """
        conn = db.connect(self.db_path)
        settings = None
        try:
            db.init(conn)
            now = self.now_fn()
            settings = db.get_settings(conn)
            self.status["last_tick"] = iso(now)
            if not force and not settings["engine_enabled"]:
                self.status["state"] = "disabled"
                return settings
            if not force and settings["market_hours_only"] and not scan.market_open(now):
                self.status["state"] = "market closed"
                return settings
            self.status["last_trigger"] = "manual" if force else "schedule"

            table, built_at = db.load_edge_table(conn)
            if edge_is_stale(built_at, now) or not edge_covers(table, settings["dtes"]):
                self.status["state"] = "building edge table"
                table = self.build_fn(edge_universe(settings["watchlist"]), self.load_history,
                                      dtes=settings["dtes"])
                built_at = iso(now)
                db.save_edge_table(conn, table, built_at)
            self.status["edge_built_at"] = built_at

            self.status["state"] = "scanning"
            decisions = run_cycle(conn, settings, self.services, self.now_fn, self.sleep)
            self.status.update({
                "state": "idle",
                "last_cycle": iso(self.now_fn()),
                "last_error": None,
                "decisions": len(decisions),
                "alerts": sum(1 for d in decisions if d.get("alert_sent")),
            })
        except Exception as e:
            self.status["state"] = "error"
            self.status["last_error"] = str(e)
        finally:
            conn.close()
        return settings

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                force, self._scan_requested = self._scan_requested, False
                self._busy = True
            try:
                settings = self.tick(force=force)
            finally:
                with self._lock:
                    self._busy = False
            if self.status["state"] == "idle" and settings:
                wait = settings["interval_min"] * 60
            else:
                wait = IDLE_RECHECK_SEC
            self.status["next_scan_at"] = next_scan_at(self.status["state"], settings, self.now_fn())
            self._wake.wait(wait)
            self._wake.clear()
        self.status["state"] = "stopped"

    def start(self):
        if self.running:
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._loop, name="cs-engine", daemon=True)
        self._thread.start()

    def stop(self, timeout=10):
        self._stop.set()
        self._wake.set()
        if self._thread is not None:
            self._thread.join(timeout)