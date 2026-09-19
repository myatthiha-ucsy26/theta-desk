import pytest

from theta.market import payoff

PUT = dict(direction="SELL_PUT", short_strike=100.0, long_strike=95.0, credit=1.0, contracts=1)
CALL = dict(direction="SELL_CALL", short_strike=100.0, long_strike=105.0, credit=1.0, contracts=1)


def test_grid_shape_one_row_per_day_down_to_expiry():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=10, sigma=0.3)
    assert g["days"] == list(range(10, -1, -1))
    assert len(g["pnl"]) == 11
    assert all(len(row) == len(g["spots"]) for row in g["pnl"])


def test_spot_axis_is_ascending_and_covers_both_strikes_and_spot():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=10, sigma=0.3)
    s = g["spots"]
    assert s == sorted(s)
    assert s[0] < 95.0 and s[-1] > 104.0


def test_expiry_row_is_exact_intrinsic_payoff():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=10, sigma=0.3)
    expiry = g["pnl"][-1]
    assert expiry[-1] == pytest.approx(100.0)   # far above short strike: keep credit
    assert expiry[0] == pytest.approx(-400.0)   # far below long strike: max loss


def test_time_value_means_open_rows_are_below_max_profit():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=10, sigma=0.3)
    top_spot_today = g["pnl"][0][-1]
    assert top_spot_today < 100.0


def test_pnl_never_outside_max_loss_and_max_profit():
    g = payoff.payoff_grid(**CALL, spot=98.0, days_left=14, sigma=0.5)
    for row in g["pnl"]:
        for v in row:
            assert -400.0 - 1e-6 <= v <= 100.0 + 1e-6


def test_summary_fields():
    g = payoff.payoff_grid(**{**PUT, "contracts": 2}, spot=104.0, days_left=10, sigma=0.3)
    assert g["max_profit"] == 200.0
    assert g["max_loss"] == -800.0
    assert g["breakeven"] == 99.0
    assert g["spot"] == 104.0
    call = payoff.payoff_grid(**CALL, spot=98.0, days_left=10, sigma=0.3)
    assert call["breakeven"] == 101.0


def test_long_horizons_are_sampled_to_at_most_31_rows():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=90, sigma=0.3)
    assert len(g["days"]) <= 31
    assert g["days"][0] == 90 and g["days"][-1] == 0
    assert g["days"] == sorted(set(g["days"]), reverse=True)


def test_past_expiry_is_a_single_expiry_row():
    g = payoff.payoff_grid(**PUT, spot=104.0, days_left=-3, sigma=0.3)
    assert g["days"] == [0]