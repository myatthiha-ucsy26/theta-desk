"""Tests for strategy: indicators, signal verdicts, strike builder. Pure, no OpenD."""
from theta import strategy as cc


def approx(a, b, tol=1e-2):
    return abs(a - b) <= tol


# ---------------- indicators ----------------
def test_rsi_all_up_is_100():
    assert cc.rsi([1, 2, 3, 4, 5, 6], period=5) == 100.0

def test_rsi_all_down_is_0():
    assert cc.rsi([6, 5, 4, 3, 2, 1], period=5) == 0.0

def test_rsi_known_mixed():
    # last 4 diffs: +2,-1,+2,-1 -> up=4 dn=2 rs=2 rsi=100-100/3=66.67
    closes = [10, 12, 11, 13, 12]
    assert approx(cc.rsi(closes, period=4), 66.667, 0.1)

def test_ema_constant():
    assert approx(cc.ema([5.0] * 30, 10), 5.0)

def test_bollinger_pctb_midband_is_half():
    # flat-ish then a value equal to mean -> %B ~0.5; use symmetric series
    closes = [100, 102, 98, 101, 99, 100, 100]
    pb = cc.bollinger_pctb(closes, period=6, mult=2.0)
    assert 0.3 < pb < 0.7

def test_bollinger_pctb_above_upper_exceeds_1():
    closes = [100] * 10 + [106]  # stable window + last above band
    assert cc.bollinger_pctb(closes, period=10, mult=2.0) > 1.0

def test_adx_strong_uptrend_high():
    n = 40
    highs = [100 + i for i in range(n)]
    lows = [99 + i for i in range(n)]
    closes = [99.5 + i for i in range(n)]
    assert cc.adx(highs, lows, closes, period=14) > 20

def test_adx_chop_low():
    highs = [101, 100, 101, 100] * 10
    lows = [99, 98, 99, 98] * 10
    closes = [100, 99, 100, 99] * 10
    assert cc.adx(highs, lows, closes, period=14) < 20

def test_expected_move():
    # 664 * 0.35 * sqrt(7/365) ~= 32.18
    assert approx(cc.expected_move(664, 0.35, 7), 32.18, 0.2)


# ---------------- verdicts ----------------
def base_ind(**kw):
    ind = dict(rsi=50, pctb=0.5, adx=15, ema20=100, ema50=100,
               close=100, prev_close=100, is_lower_low=False,
               is_higher_high=False, iv=0.30, rv=0.25)
    ind.update(kw)
    return ind

def test_meanrev_oversold_stabilizing_sell_put():
    d, _ = cc.verdict("meanrev", base_ind(rsi=30, close=101, prev_close=100))
    assert d == cc.SELL_PUT

def test_meanrev_falling_knife_no_trade():
    d, _ = cc.verdict("meanrev", base_ind(rsi=30, close=99, prev_close=100,
                                          is_lower_low=True, adx=30))
    assert d == cc.NO_TRADE

def test_meanrev_overbought_rejection_sell_call():
    d, _ = cc.verdict("meanrev", base_ind(rsi=70, close=99, prev_close=100))
    assert d == cc.SELL_CALL

def test_meanrev_neutral_no_trade():
    d, _ = cc.verdict("meanrev", base_ind(rsi=50))
    assert d == cc.NO_TRADE

def test_trend_up_sell_put():
    d, _ = cc.verdict("trend", base_ind(adx=25, ema20=105, ema50=100, close=106))
    assert d == cc.SELL_PUT

def test_trend_down_sell_call():
    d, _ = cc.verdict("trend", base_ind(adx=25, ema20=95, ema50=100, close=94))
    assert d == cc.SELL_CALL

def test_trend_chop_no_trade():
    d, _ = cc.verdict("trend", base_ind(adx=15, ema20=105, ema50=100, close=106))
    assert d == cc.NO_TRADE

def test_ivrich_gate_open_uses_meanrev_direction():
    d, _ = cc.verdict("ivrich", base_ind(rsi=30, close=101, prev_close=100, iv=0.40, rv=0.25))
    assert d == cc.SELL_PUT  # iv/rv = 1.6 > 1.2, gate open

def test_ivrich_gate_closed_no_trade():
    d, _ = cc.verdict("ivrich", base_ind(rsi=30, close=101, prev_close=100, iv=0.26, rv=0.25))
    assert d == cc.NO_TRADE  # iv/rv ~1.04 < 1.2, gate closed


# ---------------- combine ----------------
def test_combine_agree():
    assert cc.combine([cc.SELL_PUT, cc.SELL_PUT]) == cc.SELL_PUT

def test_combine_one_mode_firing_is_enough():
    assert cc.combine([cc.SELL_PUT, cc.NO_TRADE]) == cc.SELL_PUT
    assert cc.combine([cc.NO_TRADE, cc.NO_TRADE, cc.SELL_CALL]) == cc.SELL_CALL

def test_combine_nothing_firing_is_no_trade():
    assert cc.combine([cc.NO_TRADE, cc.NO_TRADE]) == cc.NO_TRADE

def test_combine_conflict_no_trade():
    assert cc.combine([cc.SELL_PUT, cc.SELL_CALL]) == cc.NO_TRADE
    assert cc.combine([cc.SELL_PUT, cc.NO_TRADE, cc.SELL_CALL]) == cc.NO_TRADE

def test_agreement_counts_modes_on_the_signal_side():
    assert cc.agreement([cc.SELL_PUT, cc.NO_TRADE, cc.SELL_PUT], cc.SELL_PUT) == (2, 3)
    assert cc.agreement([cc.NO_TRADE, cc.NO_TRADE], cc.NO_TRADE) == (0, 2)


# ---------------- strike builder ----------------
def test_build_spread_put_picks_short_by_delta_and_caps_risk():
    legs = [
        {"strike": 95, "delta": -0.30, "price": 2.0},
        {"strike": 90, "delta": -0.16, "price": 1.0},
        {"strike": 85, "delta": -0.08, "price": 0.5},
    ]
    sp = cc.build_spread(legs, cc.SELL_PUT, target_delta=0.30, max_risk=500)
    assert sp["short_strike"] == 95
    assert sp["long_strike"] == 90       # 85 would give maxloss 850 > 500
    assert approx(sp["credit"], 1.0)
    assert approx(sp["max_loss"], 400)
    assert approx(sp["pop"], 0.70)
    assert approx(sp["breakeven"], 94.0)

def test_build_spread_no_fit_returns_none():
    legs = [{"strike": 95, "delta": -0.30, "price": 2.0}]  # no long leg available
    assert cc.build_spread(legs, cc.SELL_PUT, target_delta=0.30, max_risk=500) is None


def test_build_spread_carries_the_legs_it_chose_from_a_live_chain():
    legs = [
        {"strike": 95, "delta": -0.30, "price": 2.0, "bid": 1.98, "ask": 2.02,
         "iv": 21.5, "oi": 14820, "volume": 3110, "code": "US.SPY260930P95000"},
        {"strike": 90, "delta": -0.16, "price": 1.0, "bid": 0.98, "ask": 1.02,
         "iv": 23.0, "oi": 22410, "volume": 5490, "code": "US.SPY260930P90000"},
    ]
    sp = cc.build_spread(legs, cc.SELL_PUT, target_delta=0.30, max_risk=500)
    assert sp["short_leg"]["code"] == "US.SPY260930P95000"
    assert (sp["short_leg"]["bid"], sp["short_leg"]["ask"]) == (1.98, 2.02)
    assert (sp["short_leg"]["oi"], sp["short_leg"]["volume"]) == (14820, 3110)
    assert sp["long_leg"]["code"] == "US.SPY260930P90000"
    assert sp["long_leg"]["strike"] == 90


def test_build_spread_leaves_a_reconstructed_legs_quotes_empty():
    # The backtest builds legs from Black-Scholes, so there is no chain to quote from.
    legs = [{"strike": 95, "delta": -0.30, "price": 2.0},
            {"strike": 90, "delta": -0.16, "price": 1.0}]
    sp = cc.build_spread(legs, cc.SELL_PUT, target_delta=0.30, max_risk=500)
    assert sp["short_leg"] == {"strike": 95, "delta": -0.30, "bid": None, "ask": None,
                               "iv": None, "oi": None, "volume": None, "code": None}
    # The numbers the trade is priced on are still there.
    assert approx(sp["credit"], 1.0) and approx(sp["max_loss"], 400)


# ---------------- build_indicators ----------------
def test_build_indicators_fields_and_flags():
    highs = [10, 11, 12, 11, 13, 9]
    lows = [9, 10, 11, 10, 12, 7]
    closes = [9.5, 10.5, 11.5, 10.5, 12.5, 8.0]
    ind = cc.build_indicators(highs, lows, closes, iv=0.4, rv=0.3, iv_rank=0.6, lookback=5)
    assert ind["close"] == 8.0 and ind["prev_close"] == 12.5
    assert ind["is_lower_low"] is True          # last low 7 < min prior lows
    assert ind["is_higher_high"] is False
    assert ind["iv"] == 0.4 and ind["rv"] == 0.3 and ind["iv_rank"] == 0.6
    assert "rsi" in ind and "adx" in ind and "ema20" in ind


# ---------------- Task 9: 5-year threshold ----------------
def test_ivrich_threshold_is_two_thirds():
    assert abs(cc.IV_RANK_RICH - 2 / 3) < 1e-9


def test_ivrich_mid_rank_is_blocked():
    """THE REGRESSION. Rank 0.60 passed the old `>= 0.5` gate. Over 5 years the
    ivrich mid bucket lost money in every period (-$19/trade overall, -$31 to
    -$62/trade in 2022). It must no longer trade."""
    d, reason = cc.verdict("ivrich", base_ind(rsi=30, close=101, prev_close=100, iv_rank=0.60))
    assert d == cc.NO_TRADE
    assert "not rich" in reason


def test_ivrich_rank_exactly_at_threshold_trades():
    d, _ = cc.verdict("ivrich", base_ind(rsi=30, close=101, prev_close=100, iv_rank=cc.IV_RANK_RICH))
    assert d == cc.SELL_PUT


def test_ivrich_high_rank_trades():
    d, _ = cc.verdict("ivrich", base_ind(rsi=30, close=101, prev_close=100, iv_rank=0.90))
    assert d == cc.SELL_PUT


def test_trend_trade_reasons_carry_bear_market_caution():
    up, up_reason = cc.verdict("trend", base_ind(adx=25, ema20=105, ema50=100, close=106))
    down, down_reason = cc.verdict("trend", base_ind(adx=25, ema20=95, ema50=100, close=94))
    assert up == cc.SELL_PUT and "CAUTION" in up_reason
    assert down == cc.SELL_CALL and "CAUTION" in down_reason


def test_trend_no_trade_reason_has_no_caution():
    d, reason = cc.verdict("trend", base_ind(adx=15, ema20=105, ema50=100, close=106))
    assert d == cc.NO_TRADE
    assert "CAUTION" not in reason
