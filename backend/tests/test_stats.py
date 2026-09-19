import pytest

from theta import stats


def test_percentile_rank_all_below_returns_one():
    assert stats.percentile_rank([1.0] * 20, 5.0) == 1.0


def test_percentile_rank_all_above_returns_zero():
    assert stats.percentile_rank([9.0] * 20, 1.0) == 0.0


def test_percentile_rank_counts_values_at_or_below_current():
    vals = [float(i) for i in range(1, 21)]  # 1..20
    # 5 of the 20 values are <= 5.0
    assert stats.percentile_rank(vals, 5.0) == 0.25


def test_percentile_rank_returns_none_below_min_count():
    assert stats.percentile_rank([1.0] * 19, 1.0) is None


def test_percentile_rank_respects_custom_min_count():
    assert stats.percentile_rank([1.0, 2.0, 3.0], 2.0, min_count=3) == pytest.approx(2 / 3)


def test_percentile_rank_handles_empty_list():
    assert stats.percentile_rank([], 1.0) is None


def test_percentile_rank_is_not_minmax():
    """A single outlier must not drag the rank toward zero.

    This is the regression that the old market_data.iv_rank min-max formula failed:
    (cur - lo) / (hi - lo) with an outlier high gives ~0.09, while the true
    percentile is 0.95.
    """
    vals = [1.0] * 19 + [100.0]
    assert stats.percentile_rank(vals, 1.5) == 0.95