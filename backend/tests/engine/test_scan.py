import datetime as dt

import pytest

from theta import strategy
from theta.storage import db
from theta.engine import edge
from theta.engine import scan

UTC = dt.timezone.utc


# ---------------- fixtures ----------------

def calm_then_wild(n=300, tail=25):
    """Volatility spikes at the end -> current RV rank near 1.0 (high bucket)."""
    c = [100.0]
    for i in range(n - tail):
        c.append(c[-1] * (1.001 if i % 2 else 0.999))
    for i in range(tail):
        c.append(c[-1] * (1.04 if i % 2 else 0.96))
    return c


def wild_then_calm(n=300, tail=25):
    """Volatility collapses at the end -> current RV rank near 0.0 (low bucket)."""
    c = [100.0]
    for i in range(n - tail):
        c.append(c[-1] * (1.04 if i % 2 else 0.96))
    for i in range(tail):
        c.append(c[-1] * (1.001 if i % 2 else 0.999))
    return c


def signal(direction="SELL_PUT", spread=True):
    s = {
        "ticker": "META", "spot": 650.0, "expiration": "2026-10-02", "dte": 14,
        "modes": ["ivrich"], "direction": direction, "iv_pct": 42.0, "iv_rank": None,
        "verdicts": {
            "meanrev": {"direction": direction, "reason": "oversold (RSI<35) + green candle"},
            "trend": {"direction": "NO_TRADE", "reason": "chop (ADX<20)"},
            "ivrich": {"direction": direction, "reason": "IV rich (IV/RV=1.40) + oversold (RSI<35)"},
        },
        "spread": None,
    }
    if spread:
        s["spread"] = {"side": "put", "short": 600.0, "long": 595.0, "width": 5.0,
                       "credit": 1.25, "max_loss": 375.0, "pop_pct": 71.2}
    return s


HIGH_EDGE = {("ivrich", 14, "high"): {"n": 611, "expectancy": 39.6},
             ("ivrich", 14, "mid"): {"n": 286, "expectancy": -14.1},
             ("ivrich", 14, "low"): {"n": 150, "expectancy": -20.0}}


def deps(**over):
    d = {
        "evaluate": lambda tk, dte, modes: signal(),
        "closes": lambda tk: calm_then_wild(),
        "edge_table": HIGH_EDGE,
        "open_positions": [],
        "ai_review": lambda tk, sig: ("CONFIRM", "no earnings this week"),
        "recently_alerted": lambda key: False,
    }
    d.update(over)
    return d


def settings(**over):
    s = {k: (list(v) if isinstance(v, list) else v) for k, v in db.DEFAULT_SETTINGS.items()}
    s.update(over)
    return s


# ---------------- rank ----------------

def test_rank_from_closes_matches_the_backtest_statistic():
    assert edge.rank_from_closes(calm_then_wild()) > 0.95
    assert edge.rank_from_closes(wild_then_calm()) < 0.05


def test_rank_from_closes_none_when_too_short():
    assert edge.rank_from_closes([100.0] * 10) is None
    assert edge.rank_from_closes([]) is None


# ---------------- market hours ----------------

@pytest.mark.parametrize("utc, expected", [
    (dt.datetime(2026, 9, 16, 13, 29, tzinfo=UTC), False),  # Wed 09:29 EDT
    (dt.datetime(2026, 9, 16, 13, 30, tzinfo=UTC), True),   # Wed 09:30 EDT
    (dt.datetime(2026, 9, 16, 19, 59, tzinfo=UTC), True),   # Wed 15:59 EDT
    (dt.datetime(2026, 9, 16, 20, 0, tzinfo=UTC), False),   # Wed 16:00 EDT
    (dt.datetime(2026, 9, 19, 15, 0, tzinfo=UTC), False),   # Saturday
    (dt.datetime(2026, 1, 14, 14, 35, tzinfo=UTC), True),   # Wed 09:35 EST (winter)
    (dt.datetime(2026, 1, 14, 14, 25, tzinfo=UTC), False),  # Wed 09:25 EST (winter)
])
def test_market_open(utc, expected):
    assert scan.market_open(utc) is expected


def test_market_open_rejects_naive_datetime():
    with pytest.raises(ValueError):
        scan.market_open(dt.datetime(2026, 9, 16, 14, 0))


# ---------------- gates ----------------

def test_all_gates_pass_produces_alert():
    d = scan.scan_ticker("meta", 14, settings(), deps())
    assert d["passed"] is True
    assert d["stage"] == "alert"
    assert d["ticker"] == "META"
    assert d["alert_key"] == "META|SELL_PUT|600.0|595.0|2026-10-02"
    assert d["ai_verdict"] == "CONFIRM"


def test_gate1_no_trade_stops_at_signal_with_mode_reasons():
    d = scan.scan_ticker("META", 14, settings(), deps(evaluate=lambda *a: signal("NO_TRADE", spread=False)))
    assert (d["stage"], d["passed"]) == ("signal", False)
    assert "ivrich:" in d["reason"]


def test_gate1_evaluate_error_is_recorded_not_raised():
    def boom(*a):
        raise RuntimeError("no ATM IV available")
    d = scan.scan_ticker("META", 14, settings(), deps(evaluate=boom))
    assert (d["stage"], d["passed"]) == ("signal", False)
    assert "no ATM IV available" in d["reason"]


def test_gate2_no_spread_stops_at_tradeable():
    d = scan.scan_ticker("META", 14, settings(), deps(evaluate=lambda *a: signal(spread=False)))
    assert (d["stage"], d["passed"]) == ("tradeable", False)


def test_gate3_low_iv_rank_is_blocked_even_with_a_signal():
    d = scan.scan_ticker("META", 14, settings(), deps(closes=lambda tk: wild_then_calm()))
    assert (d["stage"], d["passed"]) == ("edge", False)
    assert "no edge" in d["reason"]


def test_gate3_empty_edge_table_fails_closed():
    """Before the first nightly build nothing may alert."""
    d = scan.scan_ticker("META", 14, settings(), deps(edge_table={}))
    assert (d["stage"], d["passed"]) == ("edge", False)
    assert "no backtest data" in d["reason"]


def test_gate3_thin_sample_is_blocked():
    thin = {("ivrich", 14, "high"): {"n": 40, "expectancy": 90.0}}
    d = scan.scan_ticker("META", 14, settings(), deps(edge_table=thin))
    assert (d["stage"], d["passed"]) == ("edge", False)
    assert "UNVALIDATED" in d["reason"]


def test_gate3_one_firing_mode_with_edge_is_enough():
    table = {**HIGH_EDGE, ("meanrev", 14, "high"): {"n": 20, "expectancy": 50.0}}
    s = settings(modes=["ivrich", "meanrev"])
    d = scan.scan_ticker("META", 14, s, deps(edge_table=table))
    assert d["passed"] is True
    assert d["edge"] == ["ivrich/14d/IV-high: expectancy $+39.6/trade over 611 trades"]


def test_gate3_blocks_when_no_firing_mode_has_edge():
    table = {("meanrev", 14, "high"): {"n": 20, "expectancy": 50.0}}
    s = settings(modes=["ivrich", "meanrev"])
    d = scan.scan_ticker("META", 14, s, deps(edge_table=table))
    assert (d["stage"], d["passed"]) == ("edge", False)
    assert "ivrich" in d["reason"] and "meanrev" in d["reason"]


SIDED_EDGE = {("ivrich", 14, "high"): {
    "n": 712, "expectancy": 19.1, "win_rate": 0.82,
    "sides": {"SELL_PUT": {"n": 318, "expectancy": 45.3, "win_rate": 0.84},
              "SELL_CALL": {"n": 394, "expectancy": -1.7, "win_rate": 0.80}}}}


def test_gate3_blocks_a_bear_call_whose_side_has_no_edge():
    """The pooled cell is positive only because of its bull puts."""
    d = scan.scan_ticker("META", 14, settings(directions=["SELL_PUT", "SELL_CALL"]),
                         deps(edge_table=SIDED_EDGE, evaluate=lambda *a: signal("SELL_CALL")))
    assert (d["stage"], d["passed"]) == ("edge", False)
    assert "bear call" in d["reason"] and "no edge" in d["reason"]


def test_gate3_passes_a_bull_put_on_its_own_side_stats():
    d = scan.scan_ticker("META", 14, settings(), deps(edge_table=SIDED_EDGE))
    assert d["passed"] is True
    assert d["edge"] == ["ivrich/14d/IV-high bull put: expectancy $+45.3/trade over 318 trades"]
    assert d["confidence"]["n"] == 318 and d["confidence"]["win_rate"] == 0.84


def test_signal_gate_blocks_a_direction_switched_off_in_settings():
    d = scan.scan_ticker("META", 14, settings(directions=["SELL_PUT"]),
                         deps(evaluate=lambda *a: signal("SELL_CALL")))
    assert (d["stage"], d["passed"]) == ("signal", False)
    assert d["direction"] == "SELL_CALL"
    assert d["reason"] == "bear call signal, but bear calls are switched off in settings"


def test_signal_gate_passes_a_direction_that_is_on():
    d = scan.scan_ticker("META", 14, settings(directions=["SELL_PUT"]), deps())
    assert d["passed"] is True


def test_gate3_ignores_modes_that_did_not_fire():
    """trend is checked but says NO_TRADE, so its missing backtest data must not block."""
    s = settings(modes=["ivrich", "trend"])
    d = scan.scan_ticker("META", 14, s, deps())
    assert d["passed"] is True


def test_confidence_records_agreement_and_best_backtest_win_rate():
    table = {("ivrich", 14, "high"): {"n": 611, "expectancy": 39.6, "win_rate": 0.78},
             ("meanrev", 14, "high"): {"n": 900, "expectancy": 12.0, "win_rate": 0.74}}
    s = settings(modes=["ivrich", "meanrev", "trend"])
    d = scan.scan_ticker("META", 14, s, deps(edge_table=table))
    assert d["confidence"] == {"agree": 2, "of": 3, "win_rate": 0.78, "n": 611}


def test_confidence_without_backtest_before_the_edge_gate():
    s = settings(modes=["ivrich", "trend"])
    d = scan.scan_ticker("META", 14, s, deps(evaluate=lambda *a: signal(spread=False)))
    assert d["confidence"] == {"agree": 1, "of": 2, "win_rate": None, "n": None}


def test_gate4_existing_position_in_same_ticker_blocks():
    held = [{"ticker": "META", "width": 5.0, "credit": 1.0, "contracts": 1}]
    d = scan.scan_ticker("META", 14, settings(), deps(open_positions=held))
    assert (d["stage"], d["passed"]) == ("risk", False)
    assert "already holding" in d["reason"]


def test_gate4_position_count_limit():
    held = [{"ticker": f"T{i}", "width": 1.0, "credit": 0.5, "contracts": 1} for i in range(5)]
    d = scan.scan_ticker("META", 14, settings(), deps(open_positions=held))
    assert (d["stage"], d["passed"]) == ("risk", False)
    assert "max 5" in d["reason"]


def test_gate4_deployed_risk_limit():
    # Two open spreads risking $400 x 3 contracts = $1200 each -> $2400 deployed.
    held = [{"ticker": t, "width": 5.0, "credit": 1.0, "contracts": 3} for t in ("AAPL", "MSFT")]
    d = scan.scan_ticker("META", 14, settings(), deps(open_positions=held))
    assert (d["stage"], d["passed"]) == ("risk", False)
    assert "exceed" in d["reason"]


def test_gate5_ai_avoid_blocks():
    d = scan.scan_ticker("META", 14, settings(), deps(ai_review=lambda *a: ("AVOID", "earnings tomorrow")))
    assert (d["stage"], d["passed"]) == ("ai", False)
    assert "earnings tomorrow" in d["reason"]


def test_gate5_ai_unavailable_fails_closed():
    d = scan.scan_ticker("META", 14, settings(), deps(ai_review=lambda *a: ("UNAVAILABLE", "AI_API_KEY not set")))
    assert (d["stage"], d["passed"]) == ("ai", False)


def test_gate5_caution_respects_setting():
    ai = lambda *a: ("CAUTION", "Fed meeting")
    assert scan.scan_ticker("META", 14, settings(), deps(ai_review=ai))["passed"] is True
    blocked = scan.scan_ticker("META", 14, settings(ai_allow_caution=False), deps(ai_review=ai))
    assert (blocked["stage"], blocked["passed"]) == ("ai", False)


def test_gate5_skipped_when_ai_disabled():
    def never(*a):
        raise AssertionError("AI must not be called when disabled")
    d = scan.scan_ticker("META", 14, settings(ai_enabled=False), deps(ai_review=never))
    assert d["passed"] is True and d["ai_verdict"] is None


def test_gate6_recent_alert_is_suppressed():
    d = scan.scan_ticker("META", 14, settings(), deps(recently_alerted=lambda key: True))
    assert (d["stage"], d["passed"]) == ("dedupe", False)


def test_cheap_gates_run_before_ai():
    """AI costs money: it must never see a setup the free gates already rejected."""
    calls = []
    d = scan.scan_ticker("META", 14, settings(), deps(
        closes=lambda tk: wild_then_calm(),
        ai_review=lambda *a: calls.append(a) or ("CONFIRM", ""),
    ))
    assert d["stage"] == "edge" and calls == []


# ---------------- alert text ----------------

def test_format_alert_escapes_html():
    """Telegram parses HTML: 'EMA20>EMA50' or 'RSI<35' unescaped breaks the message."""
    d = scan.scan_ticker("META", 14, settings(), deps())
    text = scan.format_alert(d)
    assert "<b>META · Bull Put</b>" in text
    assert "RSI&lt;35" in text
    assert "RSI<35" not in text
    assert "600" in text and "595" in text


def test_format_alert_prices_the_trade_per_contract():
    """Credit is quoted per share and max loss per contract: on a phone both must
    be the same unit, or '$1.25 credit, $375 max loss' reads as a 300x payoff."""
    d = scan.scan_ticker("META", 14, settings(), deps())
    text = scan.format_alert(d)
    assert "💵 Sell $600 / Buy $595" in text
    assert "💰 Credit $125 · max loss $375" in text
    assert " POP 71% · spot $650" in text


def test_format_alert_flags_caution_on_its_own_line():
    """The 2022-bear caveat is a warning about the mode, not part of the setup
    sentence it is glued to by ' — '."""
    sig = signal()
    sig["modes"] = ["trend"]
    sig["verdicts"]["trend"] = {"direction": "SELL_PUT",
                                "reason": f"uptrend (EMA20>EMA50, ADX>20) — {strategy.TREND_CAUTION}"}
    d = scan.scan_ticker("META", 14, settings(modes=["trend"]),
                              deps(evaluate=lambda *a: sig))
    text = scan.format_alert(d)
    assert "🧭 uptrend (EMA20&gt;EMA50, ADX&gt;20)" in text
    assert f"⚠️ {strategy.TREND_CAUTION}" in text

def test_format_alert_shows_confidence_and_only_firing_mode_reasons():
    table = {("ivrich", 14, "high"): {"n": 611, "expectancy": 39.6, "win_rate": 0.78}}
    s = settings(modes=["ivrich", "trend"])
    d = scan.scan_ticker("META", 14, s, deps(edge_table=table))
    text = scan.format_alert(d)
    assert "🎯 Confidence · 1/2 modes agree · 78% backtest win (n=611)" in text
    assert "chop" not in text


def test_auto_mode_forces_the_ai_gate_even_when_disabled():
    calls = []
    def ai(tk, sig):
        calls.append(tk)
        return ("CONFIRM", "ok")
    d = scan.scan_ticker("META", 14, settings(mode="auto", ai_enabled=False), deps(ai_review=ai))
    assert calls == ["META"] and d["passed"] is True


def test_auto_mode_treats_caution_as_no():
    d = scan.scan_ticker("META", 14, settings(mode="auto", ai_allow_caution=True),
                              deps(ai_review=lambda tk, sig: ("CAUTION", "earnings Thursday")))
    assert (d["stage"], d["passed"]) == ("ai", False)


# ---------------- gate switches ----------------

def test_edge_gate_skipped_when_disabled():
    """A setup the edge table would block alerts once the edge gate is switched off."""
    d = scan.scan_ticker("META", 14, settings(edge_enabled=False),
                              deps(closes=lambda tk: wild_then_calm()))
    assert d["passed"] is True and d["skipped"] == ["edge"]
    assert "📊 Edge" not in scan.format_alert(d)


def test_risk_gate_skipped_when_disabled():
    held = [{"ticker": "META", "width": 5.0, "credit": 1.0, "contracts": 1}]
    d = scan.scan_ticker("META", 14, settings(risk_enabled=False), deps(open_positions=held))
    assert d["passed"] is True and d["skipped"] == ["risk"]


def test_repeat_gate_skipped_when_disabled():
    d = scan.scan_ticker("META", 14, settings(dedupe_enabled=False),
                              deps(recently_alerted=lambda key: True))
    assert d["passed"] is True and d["skipped"] == ["dedupe"]
    assert d["alert_key"]


def test_ai_gate_recorded_as_skipped_when_disabled():
    d = scan.scan_ticker("META", 14, settings(ai_enabled=False), deps())
    assert d["skipped"] == ["ai"]


def test_auto_mode_forces_the_risk_gate_even_when_disabled():
    """Live trading has no other risk check: the risk gate cannot be switched off there."""
    held = [{"ticker": "META", "width": 5.0, "credit": 1.0, "contracts": 1}]
    d = scan.scan_ticker("META", 14, settings(mode="auto", risk_enabled=False),
                              deps(open_positions=held))
    assert (d["stage"], d["passed"]) == ("risk", False)
