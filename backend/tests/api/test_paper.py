import datetime as dt

import pytest
from theta import paper



TRADE = {
    "ticker": "TEST",
    "direction": "SELL_PUT",
    "short_strike": 100.0,
    "long_strike": 95.0,
    "width": 5.0,
    "credit": 1.00,
    "contracts": 1,
    "expiry": "2026-09-18",
}


def test_paper_pnl_at_expiry_otm_is_full_credit():
    # Expiry day, spot well above the short strike: the credit is genuinely kept.
    pnl = paper.position_pnl(TRADE, 105.0, 0.30, dt.date(2026, 9, 18))
    assert pnl == pytest.approx(100.0)


def test_paper_pnl_at_expiry_itm_is_max_loss():
    # Expiry day, fully through both strikes: lose width minus credit.
    pnl = paper.position_pnl(TRADE, 90.0, 0.30, dt.date(2026, 9, 18))
    assert pnl == pytest.approx(-400.0)


def test_paper_pnl_open_position_is_not_yet_full_credit():
    """THE REGRESSION (spec 3.2).

    Three days before expiry with spot at 105, the old code returned the full
    $100 credit. The position is still open and still costs ~$4 to close, so the
    honest mark is ~$96.
    """
    pnl = paper.position_pnl(TRADE, 105.0, 0.30, dt.date(2026, 9, 15))
    assert pnl < 100.0
    assert pnl == pytest.approx(96.1, abs=1.0)


def test_paper_pnl_scales_with_contracts():
    multi = {**TRADE, "contracts": 3}
    one = paper.position_pnl(TRADE, 105.0, 0.30, dt.date(2026, 9, 15))
    three = paper.position_pnl(multi, 105.0, 0.30, dt.date(2026, 9, 15))
    assert three == pytest.approx(one * 3)


def test_paper_pnl_never_below_max_loss():
    for spot in (10.0, 50.0, 90.0, 94.9):
        pnl = paper.position_pnl(TRADE, spot, 0.30, dt.date(2026, 9, 15))
        assert pnl >= -400.0 - 1e-6