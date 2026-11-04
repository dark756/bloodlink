"""dataset.py against the same cases as tests/stockout-features.test.js, so the Python
builder and src/lib/stockoutFeatures.js are pinned to the same numbers."""

import numpy as np
import pytest

import dataset as ds

HOUR = ds.HOUR_MS
DAY = ds.DAY_MS
T = ds.to_ms("2026-11-04T06:30:00Z")  # 12:00 India time, a grid time


def series(*events, code="101"):
    return ds.Series.from_events(code, [(T + offset, groups or {}) for offset, groups in events])


def inputs_for(s, group, as_of=T, bank=ds.Bank(), threshold=0):
    cases = ds.bank_cases(s, bank, [as_of], threshold=threshold)
    if cases is None:
        return None
    rows = np.flatnonzero(cases["group"] == ds.GROUPS.index(group))
    if not len(rows):
        return None
    return {name: float(cases[name][rows[0]]) for name in ds.NUMERIC_INPUTS}


def labels_for(s, group, data_end, gaps=(), threshold=0):
    cases = ds.bank_cases(s, ds.Bank(), [T], data_end=data_end, gaps=gaps, threshold=threshold)
    rows = np.flatnonzero(cases["group"] == ds.GROUPS.index(group))
    return [{1: True, 0: False, -1: None}[int(cases[f"y{h}"][rows[0]])] for h in ds.HORIZONS_H]


def test_grid():
    assert ds.latest_grid_time(ds.to_ms("2026-11-04T12:29:59Z")) == T
    assert ds.latest_grid_time(ds.to_ms("2026-11-04T12:30:00Z")) == T + 6 * HOUR
    assert list(ds.grid_times_between("2026-11-04T00:30:00Z", "2026-11-04T12:30:00Z")) == [T - 6 * HOUR, T, T + 6 * HOUR]
    assert list(ds.grid_times_between("2026-11-04T00:31:00Z", "2026-11-04T06:29:00Z")) == []
    assert ds.india_day(ds.to_ms("2026-11-03T18:29:00Z")) == "2026-11-03"
    assert ds.india_day(ds.to_ms("2026-11-03T18:30:00Z")) == "2026-11-04"
    assert ds.iso(ds.to_ms("2026-11-02T23:54:56.000Z")) == "2026-11-02T23:54:56.000Z"


def test_ownership():
    assert [ds.ownership_of(t) for t in ("Govt.", "Private", "Charitable/Vol", "Red Cross", None)] == [
        "govt", "private", "charitable", "red_cross", "other"]


EVENTS = [
    (-10 * DAY, {"O+Ve": 10, "A+Ve": 5}),
    (-6 * DAY, {"O+Ve": 4, "A+Ve": 5}),
    (-5 * DAY, {"A+Ve": 5}),  # O+ runs out
    (-4 * DAY, {"O+Ve": 8, "A+Ve": 5}),  # and is refilled
    (-2 * DAY, {"O+Ve": 6, "A+Ve": 3}),
    (-12 * HOUR, {"O+Ve": 5, "A+Ve": 3}),
]


def test_the_inputs_from_the_last_7_days_as_rates_per_day_seen():
    got = inputs_for(series(*EVENTS), "O+Ve", bank=ds.Bank("27", "Govt.", True))
    assert got == {
        "units": 5, "bankUnits": 8, "groupsStocked": 2, "groupShare": 5 / 8,
        "zeroDropsPerDay": 1 / 7, "change24h": -1, "change72h": -3,
        "decreasesPerDay": 13 / 7, "increasesPerDay": 8 / 7, "daysOfSupply": 5 / (13 / 7),
        "bankUsePerDay": 15 / 7, "updates24h": 1, "updatesPerDay": 5 / 7, "hoursSinceUpdate": 12,
        "autoRefresh": 1, "rhNegative": 0,
    }


def test_only_groups_in_stock_at_banks_that_arent_dormant():
    s = series(*EVENTS)
    assert inputs_for(s, "B+Ve") is None
    assert inputs_for(s, "O+Ve", T - 11 * DAY) is None
    assert inputs_for(s, "O+Ve", T + 31 * DAY) is None
    assert inputs_for(s, "O+Ve", T + 29 * DAY) is not None


def test_at_least_one_day_for_a_bank_first_seen_hours_ago():
    got = inputs_for(series((-3 * HOUR, {"O-Ve": 4}), (-1 * HOUR, {"O-Ve": 2})), "O-Ve")
    assert got["decreasesPerDay"] == 2 and got["updatesPerDay"] == 2 and got["updates24h"] == 2
    assert got["change24h"] == 0 and got["daysOfSupply"] == 1 and got["rhNegative"] == 1 and got["autoRefresh"] == 0


def test_a_cleared_page_is_no_drop_no_use_and_no_refill():
    got = inputs_for(series((-3 * DAY, {"O+Ve": 6, "A+Ve": 5}), (-2 * DAY, None), (-DAY - HOUR, {"O+Ve": 6, "A+Ve": 5})), "O+Ve")
    assert got["zeroDropsPerDay"] == 0 and got["decreasesPerDay"] == 0 and got["increasesPerDay"] == 0
    assert got["bankUsePerDay"] == 0 and got["daysOfSupply"] == ds.DAYS_OF_SUPPLY_CAP and got["updatesPerDay"] == 1


def test_a_small_bank_using_its_last_units_is_a_real_drop():
    got = inputs_for(series((-3 * DAY, {"O+Ve": 3}), (-2 * DAY, None), (-DAY - HOUR, {"O+Ve": 2})), "O+Ve")
    assert got["zeroDropsPerDay"] == pytest.approx(1 / 3)
    assert got["increasesPerDay"] == pytest.approx(2 / 3)


def test_the_bombay_groups_count_in_the_banks_totals():
    got = inputs_for(series((-2 * DAY, {"O+Ve": 3, "Oh+VE": 2}), (-DAY, {"O+Ve": 3})), "O+Ve")
    assert got["bankUnits"] == 3 and got["groupsStocked"] == 1 and got["bankUsePerDay"] == 2 / 2


BEFORE = [(-HOUR, {"O+Ve": 4, "A+Ve": 9})]


def test_labels_mark_a_drop_to_zero_within_each_horizon():
    end = T + 100 * HOUR
    assert labels_for(series(*BEFORE, (30 * HOUR, {"A+Ve": 9})), "O+Ve", end) == [False, True, True]
    assert labels_for(series(*BEFORE, (24 * HOUR, {"A+Ve": 9})), "O+Ve", end) == [True, True, True]
    # A quick refill still counts.
    assert labels_for(series(*BEFORE, (5 * HOUR, {"A+Ve": 9}), (7 * HOUR, {"O+Ve": 6, "A+Ve": 9})), "O+Ve", end) == [True, True, True]


def test_labels_leave_out_a_case_whose_first_zero_is_a_cleared_page():
    end = T + 100 * HOUR
    assert labels_for(series(*BEFORE, (10 * HOUR, None), (20 * HOUR, {"O+Ve": 3})), "O+Ve", end) == [None, None, None]
    assert labels_for(series(*BEFORE, (50 * HOUR, None)), "O+Ve", end) == [False, False, None]


def test_labels_drop_windows_past_the_data_or_into_a_gap():
    s = series(*BEFORE)
    assert labels_for(s, "O+Ve", T + 50 * HOUR) == [False, False, None]
    gap = [(T + 30 * HOUR, T + 40 * HOUR)]
    assert labels_for(s, "O+Ve", T + 100 * HOUR, gap) == [False, None, None]
    # A drop that was seen counts across a gap.
    assert labels_for(series(*BEFORE, (60 * HOUR, {"A+Ve": 9})), "O+Ve", T + 100 * HOUR, gap) == [False, None, True]


def test_gaps_longer_than_6_5_hours():
    sweeps = [ds.iso(T + hours * HOUR) for hours in (0, 4.5, 9, 18, 22.5)]
    assert ds.find_gaps(sweeps) == [(T + 9 * HOUR, T + 18 * HOUR)]
    assert ds.find_gaps(sweeps, 10) == []


def test_a_threshold_scores_only_groups_above_it_and_labels_the_fall_to_it():
    s = series((-HOUR, {"O+Ve": 4, "A+Ve": 2}), (30 * HOUR, {"O+Ve": 2, "A+Ve": 2}), (60 * HOUR, {"O+Ve": 1, "A+Ve": 2}))
    assert inputs_for(s, "A+Ve", threshold=2) is None  # already at the threshold
    assert inputs_for(s, "O+Ve", threshold=2)["units"] == 4
    assert labels_for(s, "O+Ve", T + 100 * HOUR, threshold=2) == [False, True, True]
    assert labels_for(s, "O+Ve", T + 100 * HOUR, threshold=1) == [False, False, True]
    assert labels_for(s, "O+Ve", T + 100 * HOUR) == [False, False, False]
