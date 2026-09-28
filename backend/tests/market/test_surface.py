from theta.market import surface


def test_pick_expiries_keeps_all_when_few():
    e = [("2026-09-18", 2), ("2026-09-25", 9)]
    assert surface.pick_expiries(e, max_n=6) == e


def test_pick_expiries_samples_evenly_and_keeps_both_ends():
    e = [(f"d{i}", i) for i in range(1, 14)]          # 13 expirations
    picked = surface.pick_expiries(e, max_n=6)
    assert len(picked) == 6
    assert picked[0] == ("d1", 1) and picked[-1] == ("d13", 13)
    assert [d for _, d in picked] == sorted(d for _, d in picked)


def test_pick_expiries_sorts_by_dte():
    e = [("late", 20), ("early", 3), ("mid", 10)]
    assert surface.pick_expiries(e) == [("early", 3), ("mid", 10), ("late", 20)]


def _p(expiry, dte, strike, iv):
    return {"expiry": expiry, "dte": dte, "strike": strike, "iv": iv}


def test_build_surface_rows_are_expiries_columns_are_strikes():
    pts = [_p("A", 7, 95.0, 0.30), _p("A", 7, 100.0, 0.25), _p("A", 7, 105.0, 0.28),
           _p("B", 14, 95.0, 0.29), _p("B", 14, 100.0, 0.24), _p("B", 14, 105.0, 0.27)]
    s = surface.build_surface(pts, spot=100.0)
    assert s["expiries"] == ["A", "B"] and s["dtes"] == [7, 14]
    assert s["strikes"] == [95.0, 100.0, 105.0]
    assert s["iv"] == [[0.30, 0.25, 0.28], [0.29, 0.24, 0.27]]
    assert (s["min_iv"], s["max_iv"]) == (0.24, 0.30)
    assert s["spot"] == 100.0


def test_build_surface_marks_missing_cells_as_none():
    pts = [_p("A", 7, 95.0, 0.30), _p("A", 7, 100.0, 0.25),
           _p("B", 14, 95.0, 0.29), _p("B", 14, 100.0, 0.24), _p("B", 14, 105.0, 0.27),
           _p("C", 21, 100.0, 0.23), _p("C", 21, 105.0, 0.26)]
    s = surface.build_surface(pts, spot=100.0)
    assert s["strikes"] == [95.0, 100.0, 105.0]
    assert s["iv"][0] == [0.30, 0.25, None]


def test_build_surface_drops_strikes_present_in_under_half_the_expiries():
    """A strike listed for only one expiration makes a spike, not a surface."""
    pts = [_p("A", 7, 100.0, 0.25), _p("A", 7, 101.0, 0.9),
           _p("B", 14, 100.0, 0.24), _p("C", 21, 100.0, 0.23)]
    assert surface.build_surface(pts, spot=100.0)["strikes"] == [100.0]


def test_build_surface_ignores_invalid_iv_and_averages_duplicates():
    pts = [_p("A", 7, 100.0, 0.20), _p("A", 7, 100.0, 0.30),
           _p("A", 7, 105.0, None), _p("A", 7, 110.0, 0.0), _p("A", 7, 115.0, -1)]
    s = surface.build_surface(pts, spot=100.0)
    assert s["strikes"] == [100.0]
    assert s["iv"] == [[0.25]]


def test_build_surface_downsamples_to_max_strikes():
    pts = [_p("A", 7, float(k), 0.2) for k in range(50, 151)]   # 101 strikes
    s = surface.build_surface(pts, spot=100.0, max_strikes=41)
    assert len(s["strikes"]) == 41
    assert s["strikes"][0] == 50.0 and s["strikes"][-1] == 150.0


def test_build_surface_empty():
    s = surface.build_surface([], spot=100.0)
    assert s["expiries"] == [] and s["strikes"] == [] and s["iv"] == []
    assert s["min_iv"] is None and s["max_iv"] is None