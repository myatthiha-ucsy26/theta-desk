import pytest

from theta.storage import db


@pytest.fixture
def conn(tmp_path):
    c = db.connect(str(tmp_path / "engine.db"))
    db.init(c)
    yield c
    c.close()


def _decision(ticker="META", dte=14, stage="edge", passed=False, reason="thin", **kw):
    d = {"ticker": ticker, "dte": dte, "stage": stage, "passed": passed,
         "direction": "SELL_PUT", "reason": reason}
    d.update(kw)
    return d


def test_log_decision_round_trips_full_payload(conn):
    d = _decision(signal={"spot": 650.0, "spread": {"short": 600}})
    db.log_decision(conn, d, "2026-09-16T14:00:00+00:00")
    rows = db.recent_decisions(conn)
    assert len(rows) == 1
    assert rows[0]["ts"] == "2026-09-16T14:00:00+00:00"
    assert rows[0]["decision"] == d


def test_recent_decisions_newest_first_and_limited(conn):
    for i in range(5):
        db.log_decision(conn, _decision(reason=f"r{i}"), f"2026-09-16T14:0{i}:00+00:00")
    rows = db.recent_decisions(conn, limit=3)
    assert [r["decision"]["reason"] for r in rows] == ["r4", "r3", "r2"]


def test_latest_per_ticker_keeps_only_newest_per_ticker_and_dte(conn):
    db.log_decision(conn, _decision("META", 14, reason="old"), "2026-09-16T14:00:00+00:00")
    db.log_decision(conn, _decision("META", 14, reason="new"), "2026-09-16T14:15:00+00:00")
    db.log_decision(conn, _decision("META", 7, reason="seven"), "2026-09-16T14:00:00+00:00")
    db.log_decision(conn, _decision("AAPL", 14, reason="apple"), "2026-09-16T14:05:00+00:00")
    rows = db.latest_per_ticker(conn)
    assert [(r["decision"]["ticker"], r["decision"]["dte"], r["decision"]["reason"]) for r in rows] == [
        ("AAPL", 14, "apple"), ("META", 7, "seven"), ("META", 14, "new"),
    ]


def test_alerted_since_is_false_before_any_alert(conn):
    assert db.alerted_since(conn, "META|SELL_PUT|600|595|2026-10-02", "2026-09-15T00:00:00+00:00") is False


def test_alerted_since_respects_the_cutoff(conn):
    key = "META|SELL_PUT|600|595|2026-10-02"
    db.record_alert(conn, key, "2026-09-16T14:00:00+00:00")
    assert db.alerted_since(conn, key, "2026-09-15T14:00:00+00:00") is True
    assert db.alerted_since(conn, key, "2026-09-16T15:00:00+00:00") is False
    assert db.alerted_since(conn, "OTHER|KEY", "2026-09-15T14:00:00+00:00") is False


def test_edge_table_round_trips_with_tuple_keys(conn):
    table = {
        ("ivrich", 14, "high"): {"n": 611, "expectancy": 39.6, "win_rate": 0.81},
        ("ivrich", 7, "mid"): {"n": 357, "expectancy": -19.3, "win_rate": 0.72},
    }
    db.save_edge_table(conn, table, "2026-09-16T06:00:00+00:00")
    loaded, built_at = db.load_edge_table(conn)
    assert loaded == table
    assert built_at == "2026-09-16T06:00:00+00:00"


def test_save_edge_table_replaces_previous_build(conn):
    db.save_edge_table(conn, {("trend", 7, "low"): {"n": 1, "expectancy": 1.0}}, "2026-09-15T06:00:00+00:00")
    db.save_edge_table(conn, {("ivrich", 14, "high"): {"n": 2, "expectancy": 2.0}}, "2026-09-16T06:00:00+00:00")
    loaded, built_at = db.load_edge_table(conn)
    assert list(loaded) == [("ivrich", 14, "high")]
    assert built_at == "2026-09-16T06:00:00+00:00"


def test_load_edge_table_empty(conn):
    assert db.load_edge_table(conn) == ({}, None)