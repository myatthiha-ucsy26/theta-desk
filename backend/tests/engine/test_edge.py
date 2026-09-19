from theta.engine import edge


def _trade(mode, dte, rank, pnl):
    return {"mode": mode, "dte": dte, "iv_rank": rank, "pnl": pnl, "win": pnl > 0}


def test_iv_bucket_cuts_at_thirds():
    assert edge.iv_bucket(0.10) == "low"
    assert edge.iv_bucket(0.50) == "mid"
    assert edge.iv_bucket(0.90) == "high"


def test_iv_bucket_boundaries_are_lower_inclusive():
    assert edge.iv_bucket(1 / 3) == "mid"
    assert edge.iv_bucket(2 / 3) == "high"


def test_iv_bucket_handles_missing_rank():
    assert edge.iv_bucket(None) == "unranked"


def test_build_edge_table_groups_by_mode_dte_bucket():
    trades = [
        _trade("ivrich", 14, 0.90, 100.0),
        _trade("ivrich", 14, 0.90, 50.0),
        _trade("ivrich", 14, 0.10, -200.0),
        _trade("trend", 7, 0.90, 10.0),
    ]
    table = edge.build_edge_table(trades)
    assert set(table.keys()) == {
        ("ivrich", 14, "high"), ("ivrich", 14, "low"), ("trend", 7, "high"),
    }
    assert table[("ivrich", 14, "high")]["n"] == 2
    assert table[("ivrich", 14, "high")]["expectancy"] == 75.0


def test_passes_rejects_thin_sample_even_when_profitable():
    """A great-looking cell with 15 trades is the META screenshot trap."""
    table = edge.build_edge_table(
        [_trade("ivrich", 14, 0.90, 100.0) for _ in range(15)]
    )
    ok, reason = edge.passes(table, "ivrich", 14, 0.90)
    assert ok is False
    assert "15" in reason and "100" in reason


def test_passes_rejects_negative_expectancy_with_large_sample():
    """ivrich mid bucket: 162 trades, -$22/trade. Profitable-looking win rate,
    losing strategy. This cell must be refused."""
    trades = [_trade("ivrich", 7, 0.50, 100.0) for _ in range(120)]
    trades += [_trade("ivrich", 7, 0.50, -500.0) for _ in range(42)]
    table = edge.build_edge_table(trades)
    ok, reason = edge.passes(table, "ivrich", 7, 0.50)
    assert ok is False
    assert "expectancy" in reason.lower()


def test_passes_accepts_large_profitable_sample():
    trades = [_trade("ivrich", 14, 0.90, 100.0) for _ in range(200)]
    table = edge.build_edge_table(trades)
    ok, reason = edge.passes(table, "ivrich", 14, 0.90)
    assert ok is True
    assert "200" in reason


def test_passes_rejects_unknown_cell():
    ok, reason = edge.passes({}, "ivrich", 14, 0.90)
    assert ok is False
    assert "no backtest data" in reason.lower()


def test_high_bucket_cut_is_the_live_ivrich_gate():
    """The edge table's "high" bucket and the live ivrich gate must be the same
    number, or the gate stops meaning what the backtest measured."""
    from theta import strategy
    assert edge.HIGH_CUT == strategy.IV_RANK_RICH