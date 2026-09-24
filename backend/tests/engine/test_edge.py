from theta.engine import edge


def _trade(mode, dte, rank, pnl, direction="SELL_PUT"):
    return {"mode": mode, "dte": dte, "iv_rank": rank, "pnl": pnl, "win": pnl > 0,
            "direction": direction}


def _winning_puts_losing_calls(puts=200, calls=150):
    """ivrich 14d high: bull puts +$100 each, bear calls -$20 each. Pooled positive."""
    return ([_trade("ivrich", 14, 0.90, 100.0, "SELL_PUT") for _ in range(puts)]
            + [_trade("ivrich", 14, 0.90, -20.0, "SELL_CALL") for _ in range(calls)])


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


def test_build_edge_table_keeps_each_side_of_a_cell():
    table = edge.build_edge_table(_winning_puts_losing_calls())
    cell = table[("ivrich", 14, "high")]
    assert cell["n"] == 350
    assert cell["sides"]["SELL_PUT"]["n"] == 200
    assert cell["sides"]["SELL_PUT"]["expectancy"] == 100.0
    assert cell["sides"]["SELL_CALL"]["expectancy"] == -20.0


def test_passes_refuses_a_losing_side_inside_a_profitable_cell():
    """Backtest 2026-09: ivrich/14d/high pooled +$19/trade while its bear calls
    alone were -$2. The winning bull puts must not carry the bear calls through."""
    table = edge.build_edge_table(_winning_puts_losing_calls())
    ok, reason = edge.passes(table, "ivrich", 14, 0.90, direction="SELL_CALL")
    assert ok is False
    assert "bear call" in reason and "no edge" in reason


def test_passes_accepts_the_winning_side():
    table = edge.build_edge_table(_winning_puts_losing_calls())
    ok, reason = edge.passes(table, "ivrich", 14, 0.90, direction="SELL_PUT")
    assert ok is True
    assert "bull put" in reason and "200 trades" in reason


def test_passes_refuses_a_thin_side_inside_a_validated_cell():
    table = edge.build_edge_table(_winning_puts_losing_calls(puts=300, calls=40))
    ok, reason = edge.passes(table, "ivrich", 14, 0.90, direction="SELL_CALL")
    assert ok is False
    assert "only 40 trades" in reason


def test_passes_refuses_a_side_with_no_trades():
    table = edge.build_edge_table(_winning_puts_losing_calls(calls=0))
    ok, reason = edge.passes(table, "ivrich", 14, 0.90, direction="SELL_CALL")
    assert ok is False
    assert "no backtest data" in reason


def test_passes_never_lets_a_side_through_a_cell_that_fails():
    """trend/14d/low: pooled -$9/trade, its bull puts alone +$7. The split may
    only ever block trades; a strong side must not rescue a losing cell."""
    trades = ([_trade("trend", 14, 0.10, 20.0, "SELL_PUT") for _ in range(150)]
              + [_trade("trend", 14, 0.10, -60.0, "SELL_CALL") for _ in range(150)])
    table = edge.build_edge_table(trades)
    ok, reason = edge.passes(table, "trend", 14, 0.10, direction="SELL_PUT")
    assert ok is False
    assert "no edge" in reason and "bull put" not in reason


def test_passes_falls_back_to_the_pooled_cell_for_a_table_built_before_sides():
    """A stored table from before the split has no "sides" until the next rebuild."""
    table = {("ivrich", 14, "high"): {"n": 611, "expectancy": 39.6}}
    ok, _ = edge.passes(table, "ivrich", 14, 0.90, direction="SELL_CALL")
    assert ok is True


def test_cell_returns_the_side_stats():
    table = edge.build_edge_table(_winning_puts_losing_calls())
    assert edge.cell(table, "ivrich", 14, 0.90, "SELL_PUT")["n"] == 200
    assert edge.cell(table, "ivrich", 14, 0.90, None)["n"] == 350
    assert edge.cell({}, "ivrich", 14, 0.90, "SELL_PUT") is None


def test_high_bucket_cut_is_the_live_ivrich_gate():
    """The edge table's "high" bucket and the live ivrich gate must be the same
    number, or the gate stops meaning what the backtest measured."""
    from theta import strategy
    assert edge.HIGH_CUT == strategy.IV_RANK_RICH