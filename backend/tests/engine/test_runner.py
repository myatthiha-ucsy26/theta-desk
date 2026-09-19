import datetime as dt

import pytest

from theta.storage import db as store
from theta.engine import runner

UTC = dt.timezone.utc
OPEN = dt.datetime(2026, 9, 16, 15, 0, tzinfo=UTC)      # Wed 11:00 New York
CLOSED = dt.datetime(2026, 9, 19, 15, 0, tzinfo=UTC)    # Saturday


def calm_then_wild(n=300, tail=25):
    c = [100.0]
    for i in range(n - tail):
        c.append(c[-1] * (1.001 if i % 2 else 0.999))
    for i in range(tail):
        c.append(c[-1] * (1.04 if i % 2 else 0.96))
    return c


def signal(ticker, dte):
    return {
        "ticker": ticker, "spot": 100.0, "expiration": "2026-10-02", "dte": dte,
        "modes": ["ivrich"], "direction": "SELL_PUT", "iv_pct": 40.0, "iv_rank": None,
        "verdicts": {"ivrich": {"direction": "SELL_PUT", "reason": "IV rich"}},
        "spread": {"side": "put", "short": 95.0, "long": 90.0, "width": 5.0,
                   "credit": 1.0, "max_loss": 400.0, "pop_pct": 70.0},
    }


EDGE = {("ivrich", 14, "high"): {"n": 600, "expectancy": 40.0},
        ("ivrich", 7, "high"): {"n": 600, "expectancy": 45.0}}


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "engine.db")
    conn = store.connect(path)
    store.init(conn)
    store.put_settings(conn, {"watchlist": ["AAA", "BBB"], "dtes": [14], "ai_enabled": False})
    yield path, conn
    conn.close()


class Services:
    def __init__(self, send_ok=True):
        self.sent = []
        self.evaluated = []
        self.send_ok = send_ok

    def as_dict(self):
        return {
            "evaluate": lambda tk, dte, modes: self.evaluated.append((tk, dte)) or signal(tk, dte),
            "closes": lambda tk: calm_then_wild(),
            "ai_review": lambda tk, sig: ("CONFIRM", "ok"),
            "send_alert": self.send,
        }

    def send(self, text):
        self.sent.append(text)
        return (True, None) if self.send_ok else (False, "telegram down")


# ---------------- run_cycle ----------------

def test_run_cycle_journals_every_ticker_and_dte(db):
    path, conn = db
    store.put_settings(conn, {"dtes": [7, 14]})
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    decisions = runner.run_cycle(conn, store.get_settings(conn), Services().as_dict(),
                                    now_fn=lambda: OPEN, sleep=lambda s: None)
    assert len(decisions) == 4
    assert len(store.recent_decisions(conn)) == 4


def test_run_cycle_alerts_once_then_dedupes(db):
    path, conn = db
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    svc = Services()
    s = store.get_settings(conn)
    first = runner.run_cycle(conn, s, svc.as_dict(), now_fn=lambda: OPEN, sleep=lambda x: None)
    assert [d["stage"] for d in first] == ["alert", "alert"]
    assert len(svc.sent) == 2
    later = OPEN + dt.timedelta(minutes=15)
    second = runner.run_cycle(conn, s, svc.as_dict(), now_fn=lambda: later, sleep=lambda x: None)
    assert [d["stage"] for d in second] == ["dedupe", "dedupe"]
    assert len(svc.sent) == 2


def test_run_cycle_alerts_again_after_cooldown(db):
    path, conn = db
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    svc = Services()
    s = store.get_settings(conn)
    runner.run_cycle(conn, s, svc.as_dict(), now_fn=lambda: OPEN, sleep=lambda x: None)
    next_day = OPEN + dt.timedelta(hours=25)
    runner.run_cycle(conn, s, svc.as_dict(), now_fn=lambda: next_day, sleep=lambda x: None)
    assert len(svc.sent) == 4


def test_failed_send_is_not_recorded_so_it_retries(db):
    path, conn = db
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    s = store.get_settings(conn)
    down = Services(send_ok=False)
    first = runner.run_cycle(conn, s, down.as_dict(), now_fn=lambda: OPEN, sleep=lambda x: None)
    assert first[0]["alert_sent"] is False and first[0]["alert_error"] == "telegram down"
    up = Services()
    later = OPEN + dt.timedelta(minutes=15)
    runner.run_cycle(conn, s, up.as_dict(), now_fn=lambda: later, sleep=lambda x: None)
    assert len(up.sent) == 2


def test_run_cycle_sleeps_between_tickers_only(db):
    path, conn = db
    store.put_settings(conn, {"watchlist": ["AAA", "BBB", "CCC"], "ticker_gap_sec": 5})
    naps = []
    runner.run_cycle(conn, store.get_settings(conn), Services().as_dict(),
                        now_fn=lambda: OPEN, sleep=naps.append)
    assert naps == [5, 5]


def test_run_cycle_uses_open_positions_for_risk(db):
    path, conn = db
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    store.insert_position(conn, {
        "id": "p1", "account": "paper", "ticker": "AAA", "direction": "SELL_PUT", "short_strike": 95.0,
        "long_strike": 90.0, "width": 5.0, "credit": 1.0, "contracts": 1,
        "entry_date": "2026-09-10", "expiry": "2026-09-25", "mode": "ivrich",
        "status": "open", "close_date": None, "close_pnl": None,
    })
    decisions = runner.run_cycle(conn, store.get_settings(conn), Services().as_dict(),
                                    now_fn=lambda: OPEN, sleep=lambda x: None)
    assert {d["ticker"]: d["stage"] for d in decisions} == {"AAA": "risk", "BBB": "alert"}


# ---------------- edge freshness ----------------

def test_edge_is_stale():
    assert runner.edge_is_stale(None, OPEN) is True
    assert runner.edge_is_stale("2026-09-16T14:00:00+00:00", OPEN) is False
    assert runner.edge_is_stale("2026-09-15T14:00:00+00:00", OPEN) is True


def test_edge_universe_always_includes_the_validation_tickers():
    """A short watchlist must not shrink the pooled sample below the 100-trade gate."""
    u = runner.edge_universe(["spy", "XYZ"])
    assert set(runner.EDGE_UNIVERSE) <= set(u)
    assert "XYZ" in u
    assert u == sorted(set(u))


def test_build_edge_table_skips_tickers_without_history():
    def load(tk):
        raise RuntimeError("no data")
    assert runner.build_edge_table(["AAA"], load) == {}


def test_edge_covers_needs_a_cell_for_every_configured_dte():
    assert runner.edge_covers(EDGE, [7, 14])
    assert not runner.edge_covers(EDGE, [7, 30])
    assert not runner.edge_covers({}, [7])


# ---------------- Runner.tick ----------------

def make_runner(path, svc, now, builds, dtes_seen=None):
    def fake_build(tickers, load_history, dtes=(7, 14)):
        builds.append(list(tickers))
        if dtes_seen is not None:
            dtes_seen.append(list(dtes))
        return EDGE
    return runner.Runner(path, svc.as_dict(), load_history=lambda tk: None,
                            now_fn=lambda: now, sleep=lambda s: None, build_fn=fake_build)


def test_tick_does_nothing_while_disabled(db):
    path, conn = db
    svc, builds = Services(), []
    r = make_runner(path, svc, OPEN, builds)
    r.tick()
    assert r.status["state"] == "disabled"
    assert svc.evaluated == [] and builds == []


def test_tick_waits_outside_market_hours(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})
    svc, builds = Services(), []
    r = make_runner(path, svc, CLOSED, builds)
    r.tick()
    assert r.status["state"] == "market closed"
    assert svc.evaluated == []


def test_tick_builds_missing_edge_table_then_scans(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})
    svc, builds = Services(), []
    r = make_runner(path, svc, OPEN, builds)
    r.tick()
    assert builds == [runner.edge_universe(["AAA", "BBB"])]
    assert store.load_edge_table(conn)[1] == "2026-09-16T15:00:00+00:00"
    assert r.status["state"] == "idle"
    assert r.status["decisions"] == 2 and r.status["alerts"] == 2
    assert len(svc.sent) == 2


def test_tick_reuses_fresh_edge_table(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})
    store.save_edge_table(conn, EDGE, "2026-09-16T14:00:00+00:00")
    svc, builds = Services(), []
    make_runner(path, svc, OPEN, builds).tick()
    assert builds == []


def test_tick_rebuilds_when_a_new_expiration_has_no_cells(db):
    """A custom DTE arrives with no backtest data, so the table rebuilds for it."""
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True, "dtes": [7, 30]})
    store.save_edge_table(conn, EDGE, "2026-09-16T14:00:00+00:00")
    svc, builds, dtes_seen = Services(), [], []
    make_runner(path, svc, OPEN, builds, dtes_seen).tick()
    assert builds == [runner.edge_universe(["AAA", "BBB"])]
    assert dtes_seen == [[7, 30]]


def test_tick_records_errors_instead_of_crashing(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True})

    def broken_build(tickers, load_history, dtes=(7, 14)):
        raise RuntimeError("OpenD not reachable")
    r = runner.Runner(path, Services().as_dict(), load_history=lambda tk: None,
                         now_fn=lambda: OPEN, sleep=lambda s: None, build_fn=broken_build)
    r.tick()
    assert r.status["state"] == "error"
    assert "OpenD not reachable" in r.status["last_error"]


def test_market_hours_only_can_be_switched_off(db):
    path, conn = db
    store.put_settings(conn, {"engine_enabled": True, "market_hours_only": False})
    store.save_edge_table(conn, EDGE, "2026-09-19T14:00:00+00:00")
    svc, builds = Services(), []
    make_runner(path, svc, CLOSED, builds).tick()
    assert len(svc.evaluated) == 2


def test_start_and_stop_background_thread(db):
    path, conn = db
    r = make_runner(path, Services(), OPEN, [])
    r.start()
    assert r.running is True
    r.stop(timeout=5)
    assert r.running is False


def test_run_cycle_hands_passed_decisions_to_autotrade_in_auto_mode(db):
    path, conn = db
    store.put_settings(conn, {"mode": "auto", "ai_enabled": True, "watchlist": ["AAA"]})
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    handed = []
    svc = Services().as_dict()
    svc["autotrade"] = lambda c, d, s, now: handed.append((d["ticker"], now)) or "entry sent: test"
    [d] = runner.run_cycle(conn, store.get_settings(conn), svc, now_fn=lambda: OPEN, sleep=lambda s: None)
    assert handed == [("AAA", OPEN)]
    assert d["autotrade"] == "entry sent: test"
    assert store.recent_decisions(conn)[0]["decision"]["autotrade"] == "entry sent: test"


def test_run_cycle_retries_autotrade_while_the_alert_is_in_cooldown(db):
    path, conn = db
    store.put_settings(conn, {"mode": "auto", "ai_enabled": True, "watchlist": ["AAA"]})
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    handed = []
    svc = Services().as_dict()
    svc["autotrade"] = lambda c, d, s, now: handed.append(d["stage"]) or "skipped: outside the entry window"
    for _ in range(2):
        runner.run_cycle(conn, store.get_settings(conn), svc, now_fn=lambda: OPEN, sleep=lambda s: None)
    assert handed == ["alert", "dedupe"]


def test_run_cycle_never_autotrades_in_manual_mode(db):
    path, conn = db
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    svc = Services().as_dict()
    svc["autotrade"] = lambda *a: pytest.fail("autotrade called in manual mode")
    runner.run_cycle(conn, store.get_settings(conn), svc, now_fn=lambda: OPEN, sleep=lambda s: None)


def test_switching_to_auto_mid_cycle_applies_to_the_rest_of_that_cycle(db):
    path, conn = db
    store.put_settings(conn, {"ai_enabled": True, "watchlist": ["AAA"]})
    store.save_edge_table(conn, EDGE, "2026-09-16T06:00:00+00:00")
    stale = store.get_settings(conn)            # the cycle starts in manual mode
    store.put_settings(conn, {"mode": "auto"})  # then LIVE is switched on
    handed = []
    svc = Services().as_dict()
    svc["autotrade"] = lambda c, d, s, now: handed.append(d["ticker"]) or "entry sent: test"
    runner.run_cycle(conn, stale, svc, now_fn=lambda: OPEN, sleep=lambda s: None)
    assert handed == ["AAA"]
