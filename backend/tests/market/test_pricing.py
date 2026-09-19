"""Tests for pricing: Black-Scholes pricer + IV estimate. Pure, no OpenD."""
import math
import pytest
from theta.market.pricing import norm_cdf, bs_price, bs_delta, estimate_iv, strike_for_delta


def approx(a, b, tol=1e-3):
    return abs(a - b) <= tol


# --- normal CDF ---
def test_norm_cdf_center():
    assert approx(norm_cdf(0.0), 0.5)

def test_norm_cdf_known():
    assert approx(norm_cdf(0.1), 0.539828, 1e-4)
    assert approx(norm_cdf(-0.1), 0.460172, 1e-4)


# --- Black-Scholes price (reference values, r=0, S=K=100, T=1, sigma=0.2) ---
def test_bs_call_atm_r0():
    assert approx(bs_price(100, 100, 1.0, 0.0, 0.2, "call"), 7.9656, 0.01)

def test_bs_put_atm_r0_equals_call():
    # r=0, S=K -> put == call by parity
    assert approx(bs_price(100, 100, 1.0, 0.0, 0.2, "put"), 7.9656, 0.01)

def test_put_call_parity():
    S, K, T, r, sig = 105, 100, 0.5, 0.04, 0.25
    c = bs_price(S, K, T, r, sig, "call")
    p = bs_price(S, K, T, r, sig, "put")
    # c - p = S - K e^{-rT}
    assert approx(c - p, S - K * math.exp(-r * T), 1e-6)

def test_bs_price_at_expiry_is_intrinsic():
    assert approx(bs_price(110, 100, 0.0, 0.04, 0.2, "call"), 10.0)
    assert approx(bs_price(90, 100, 0.0, 0.04, 0.2, "put"), 10.0)
    assert approx(bs_price(90, 100, 0.0, 0.04, 0.2, "call"), 0.0)


# --- delta ---
def test_call_delta_atm_r0():
    assert approx(bs_delta(100, 100, 1.0, 0.0, 0.2, "call"), 0.539828, 1e-4)

def test_put_delta_atm_r0():
    assert approx(bs_delta(100, 100, 1.0, 0.0, 0.2, "put"), -0.460172, 1e-4)

def test_call_delta_monotonic_in_strike():
    # higher strike -> lower call delta
    d_low = bs_delta(100, 90, 0.25, 0.04, 0.3, "call")
    d_high = bs_delta(100, 110, 0.25, 0.04, 0.3, "call")
    assert d_low > d_high


# --- IV estimate (realized vol * factor, annualized) ---
def test_estimate_iv_zero_for_constant_growth():
    closes = [100 * (1.01 ** i) for i in range(6)]  # constant log return -> zero vol
    assert approx(estimate_iv(closes, window=5, factor=1.15), 0.0, 1e-9)

def test_estimate_iv_known_series():
    closes = [100, 101, 100, 101, 100]  # 4 alternating returns
    # hand-computed annualized vol (ddof=1) ~= 0.18236; factor 1.0
    assert approx(estimate_iv(closes, window=4, factor=1.0), 0.18236, 5e-3)

def test_estimate_iv_factor_scales_linearly():
    closes = [100, 101, 100, 101, 100]
    base = estimate_iv(closes, window=4, factor=1.0)
    assert approx(estimate_iv(closes, window=4, factor=2.0), 2.0 * base, 1e-9)


# --- strike for target delta ---
def test_strike_for_delta_put_030():
    S, T, r, sig = 648.0, 13 / 365, 0.04, 0.38
    K = strike_for_delta(S, T, r, sig, target_delta=0.30, opt="put", step=1.0)
    assert K < S  # OTM put below spot
    assert approx(abs(bs_delta(S, K, T, r, sig, "put")), 0.30, 0.02)

def test_strike_for_delta_call_030():
    S, T, r, sig = 648.0, 13 / 365, 0.04, 0.38
    K = strike_for_delta(S, T, r, sig, target_delta=0.30, opt="call", step=1.0)
    assert K > S  # OTM call above spot
    assert approx(abs(bs_delta(S, K, T, r, sig, "call")), 0.30, 0.02)


import datetime as dt

import pytest

from theta.market.pricing import spread_value, years_to_expiry

R = 0.04
SIG = 0.30


def test_spread_value_at_expiry_equals_intrinsic_otm():
    # Bull put 100/95, spot 105 -> finishes worthless, costs nothing to close.
    assert spread_value(105.0, 100.0, 95.0, 0.0, R, SIG, "SELL_PUT") == 0.0


def test_spread_value_at_expiry_equals_intrinsic_max_loss():
    # Bull put 100/95, spot 90 -> fully in the money, costs the full width.
    assert spread_value(90.0, 100.0, 95.0, 0.0, R, SIG, "SELL_PUT") == 5.0


def test_spread_value_otm_with_time_left_exceeds_intrinsic():
    """THE REGRESSION. The old code said this spread costs 0.00 to close.

    It does not: three days from expiry the short put still carries time value,
    so closing costs ~0.04/share. Reporting 0.00 hands back the entire credit as
    profit on a position that is still open.
    """
    v = spread_value(105.0, 100.0, 95.0, 3 / 365, R, SIG, "SELL_PUT")
    assert v == pytest.approx(0.0391, abs=0.002)
    assert v > 0.0


def test_spread_value_itm_with_time_left_is_below_width():
    # Deep ITM but not yet settled: worth less than the full width.
    v = spread_value(97.0, 100.0, 95.0, 3 / 365, R, SIG, "SELL_PUT")
    assert v == pytest.approx(2.822, abs=0.01)
    assert v < 5.0


def test_spread_value_bear_call_mirrors_bull_put():
    # Bear call 100/105, spot 95 -> OTM, near worthless at expiry.
    assert spread_value(95.0, 100.0, 105.0, 0.0, R, SIG, "SELL_CALL") == 0.0
    # spot 110 -> fully ITM, full width.
    assert spread_value(110.0, 100.0, 105.0, 0.0, R, SIG, "SELL_CALL") == 5.0


def test_spread_value_never_negative_and_never_exceeds_width():
    for spot in (60.0, 90.0, 97.0, 100.0, 105.0, 140.0):
        for T in (0.0, 1 / 365, 3 / 365, 14 / 365):
            v = spread_value(spot, 100.0, 95.0, T, R, SIG, "SELL_PUT")
            assert 0.0 <= v <= 5.0


def test_years_to_expiry_counts_calendar_days():
    assert years_to_expiry("2026-09-18", dt.date(2026, 9, 15)) == pytest.approx(3 / 365)


def test_years_to_expiry_is_zero_on_expiry_day():
    assert years_to_expiry("2026-09-18", dt.date(2026, 9, 18)) == 0.0


def test_years_to_expiry_floors_at_zero_when_past():
    assert years_to_expiry("2026-09-18", dt.date(2026, 9, 25)) == 0.0
