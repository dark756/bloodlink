"""Phase 5.1's dataset builder: the stock-out forecast's 19 inputs and its labels.

docs/PLANS/ML_system.md, A2: training stays in Python, scoring runs in JS, and the two
must build the same inputs. This module is the Python twin of src/lib/stockoutFeatures.js:
every definition below matches a line there, and tests/stockout-parity.test.js checks
the two on a real week of history (the fixture ml/make_week_fixture.py writes).

One case is one bank x packed red cells x one blood group at one grid time: 00:00,
06:00, 12:00 or 18:00 India time. Stock is rebuilt at the bank's own update times
(entryAt), carrying the last value forward, so the laptop's hourly sweeps and the
cloud's 4.5-hourly ones give the same rows. Only cases with stock above the
threshold, at a bank that isn't dormant, are scored.

The choices the summaries left open are stockoutFeatures.js's:
- "per day seen" divides by the days from the bank's first update to the grid time,
  between MIN_DAYS_SEEN and LOOKBACK_DAYS;
- a change, drop or update counts in the lookback when its update time is in
  (t - 7 days, t];
- a cleared page's step counts as no drop and no use, and the step that ends it as no
  refill, since the bank wasn't reporting in between;
- the 24 h and 72 h changes are 0 when the bank had no update that long before;
- days of supply is units / decreases per day, capped at DAYS_OF_SUPPLY_CAP, and the
  cap when there were no decreases;
- the bank's units, groups stocked and use count every group of the component,
  the Bombay groups included.

Label rules (report 3, docs/SUMMARIES/ml_models.md, with the threshold chosen on 4
November): the event is the group's units falling to the threshold or below within
(t, t + H], given more than the threshold at t (a threshold of 0 is report 3's
stock-out); a case whose first update at or below the threshold is a cleared page is
left out; quick refills count; dormant banks are left out; a window past the end of
the data, or into a collection gap when gaps are given, is left out unless the event
was seen inside it.

Reads local files only: no eRaktKosh or database calls. Pure numpy, no pandas.
"""

import json
import math
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

# ── constants, as in src/lib/stockoutFeatures.js and src/lib/stock.js ──────────
HOUR_MS = 3_600_000
DAY_MS = 24 * HOUR_MS
INDIA_OFFSET_MS = 330 * 60_000  # UTC+05:30 all year
GRID_STEP_MS = 6 * HOUR_MS
HORIZONS_H = (24, 48, 72)
LOOKBACK_DAYS = 7
MIN_DAYS_SEEN = 1
DAYS_OF_SUPPLY_CAP = 30
CLEARED_PAGE_MIN_UNITS = 10
DORMANT_DAYS = 30
DEFAULT_GAP_HOURS = 6.5
# The low-stock threshold the deployed model predicts: units at or below it. 0 is a
# stock-out. The artifact records the value it was trained with.
DEFAULT_THRESHOLD_UNITS = 2
COMPONENT = "PRBC"
GROUPS = ["A+Ve", "A-Ve", "B+Ve", "B-Ve", "O+Ve", "O-Ve", "AB+Ve", "AB-Ve"]
ALL_STATES = 36  # a sweep is complete when every state answered

# The 19 inputs in the artifact's order, and how each enters logistic regression:
# the transforms of stockoutModel.js (log1p is log(1 + max(0, x)), slog is the signed
# log, dummy is one column per level). Trees would take the raw values.
INPUT_NAMES = [
    "units", "bankUnits", "groupsStocked", "groupShare", "zeroDropsPerDay", "change24h",
    "change72h", "decreasesPerDay", "increasesPerDay", "daysOfSupply", "bankUsePerDay",
    "updates24h", "updatesPerDay", "hoursSinceUpdate", "autoRefresh", "ownership",
    "stateCode", "bloodGroup", "rhNegative",
]
CATEGORICAL_INPUTS = ("ownership", "stateCode", "bloodGroup")
NUMERIC_INPUTS = [name for name in INPUT_NAMES if name not in CATEGORICAL_INPUTS]
TRANSFORMS = {
    "units": "log1p", "bankUnits": "log1p", "groupsStocked": "identity", "groupShare": "identity",
    "zeroDropsPerDay": "identity", "change24h": "slog", "change72h": "slog",
    "decreasesPerDay": "log1p", "increasesPerDay": "log1p", "daysOfSupply": "log1p",
    "bankUsePerDay": "log1p", "updates24h": "identity", "updatesPerDay": "identity",
    "hoursSinceUpdate": "log1p", "autoRefresh": "identity", "ownership": "dummy",
    "stateCode": "dummy", "bloodGroup": "dummy", "rhNegative": "identity",
}
OWNERSHIP_LEVELS = ["govt", "private", "charitable", "red_cross", "other"]

_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# ── time ─────────────────────────────────────────────────────────────────────
def to_ms(stamp):
    """Milliseconds since 1970 from an ISO time, exactly (no float rounding)."""
    if isinstance(stamp, (int, np.integer)):
        return int(stamp)
    moment = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return (moment - _EPOCH) // timedelta(milliseconds=1)


def iso(ms):
    """An ISO time in UTC with milliseconds, as JS's toISOString."""
    moment = _EPOCH + timedelta(milliseconds=int(ms))
    return moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"


def india_day(ms):
    """The India date of a time, as YYYY-MM-DD (stockoutModel.js's indiaDay)."""
    return (_EPOCH + timedelta(milliseconds=int(ms) + INDIA_OFFSET_MS)).strftime("%Y-%m-%d")


def india_day_number(ms):
    """Days since 1970 by India's date; vectorized."""
    return (np.asarray(ms, dtype=np.int64) + INDIA_OFFSET_MS) // DAY_MS


def latest_grid_time(ms):
    return ((int(ms) + INDIA_OFFSET_MS) // GRID_STEP_MS) * GRID_STEP_MS - INDIA_OFFSET_MS


def grid_times_between(start, end):
    """Every grid time from start to end, both included, in ms (gridTimesBetween)."""
    start, end = to_ms(start), to_ms(end)
    time = latest_grid_time(start)
    if time < start:
        time += GRID_STEP_MS
    return np.arange(time, end + 1, GRID_STEP_MS, dtype=np.int64)


def find_gaps(sweep_times, max_gap_hours=DEFAULT_GAP_HOURS):
    """Spans with no collection: consecutive sweeps further apart than max_gap_hours (findGaps)."""
    times = sorted(to_ms(time) for time in sweep_times)
    return [(a, b) for a, b in zip(times, times[1:]) if b - a > max_gap_hours * HOUR_MS]


# ── bank attributes ──────────────────────────────────────────────────────────
def ownership_of(hospital_type):
    """blood_banks.hospital_type as one of OWNERSHIP_LEVELS (ownershipOf)."""
    text = str(hospital_type or "").lower()
    if text.startswith("govt") or "government" in text:
        return "govt"
    if "private" in text:
        return "private"
    if "red cross" in text:
        return "red_cross"
    if "charit" in text or "vol" in text:
        return "charitable"
    return "other"


def is_rh_negative(group):
    return group.lower().endswith("-ve")


# ── one bank's series ────────────────────────────────────────────────────────
def _units(value):
    """groupUnits: a finite number above zero, else 0."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return 0.0
    return float(value) if math.isfinite(value) and value > 0 else 0.0


@dataclass
class Series:
    """One bank's events, sorted by update time, one per update time."""

    code: str
    at: np.ndarray  # int64 ms
    units: np.ndarray  # [n, 8] the forecast groups' units
    total: np.ndarray  # [n] every group of the component with units above zero
    stocked: np.ndarray  # [n] how many groups of the component are above zero
    bank_drop: np.ndarray  # [n] the component's use at each step, over every group; 0 at the first
    stocks: list = field(default_factory=list, repr=False)  # the component's {group: units}, for fixtures

    @classmethod
    def from_events(cls, code, events):
        """events: [(at_ms, {group: units} of the component)], sorted, unique times."""
        n = len(events)
        at = np.fromiter((at for at, _ in events), dtype=np.int64, count=n)
        units = np.zeros((n, len(GROUPS)))
        total, stocked, bank_drop = np.zeros(n), np.zeros(n, dtype=np.int64), np.zeros(n)
        previous = {}
        for index, (_, stock) in enumerate(events):
            for g, group in enumerate(GROUPS):
                units[index, g] = _units(stock.get(group))
            values = [_units(value) for value in stock.values()]
            total[index] = sum(values)
            stocked[index] = sum(1 for value in values if value > 0)
            if index:
                # stockoutFeatures.js: for each group in the previous stock, its fall.
                bank_drop[index] = sum(
                    max(_units(value) - _units(stock.get(name)), 0.0) for name, value in previous.items()
                )
            previous = stock
        return cls(code, at, units, total, stocked, bank_drop, [stock for _, stock in events])


def _running(values):
    """Running totals with a leading zero: out[i + 1] = values[0] + ... + values[i]."""
    return np.concatenate([np.zeros((1,) + values.shape[1:]), np.cumsum(values, axis=0)])


@dataclass
class Bank:
    state_code: str = ""
    hospital_type: str | None = None
    auto_refresh: bool = False


def bank_cases(series, bank, times, horizons=HORIZONS_H, data_end=None, gaps=(), threshold=0):
    """Every scored case of one bank at the given grid times, with its inputs and labels.

    Returns a dict of arrays, one entry per case (time, group), or None. Inputs follow
    buildInputs and labels labelCase in src/lib/stockoutFeatures.js; a label is 1, 0
    or -1 (left out). Cases at or below the threshold aren't scored.
    """
    at, units_all, total = series.at, series.units, series.total
    times = np.asarray(times, dtype=np.int64)
    current = np.searchsorted(at, times, side="right") - 1
    seen = current >= 0
    times, current = times[seen], current[seen]
    hours_since = (times - at[current]) / HOUR_MS
    active = hours_since <= DORMANT_DAYS * 24
    times, current, hours_since = times[active], current[active], hours_since[active]
    if not len(times):
        return None

    # Steps: event k compared with event k - 1. A cleared page's step, and the step
    # that restores it, are neither use nor refills nor drops.
    n = len(at)
    clear = np.zeros(n, dtype=bool)
    restore = np.zeros(n, dtype=bool)
    is_cleared = False
    for k in range(1, n):
        clear[k] = total[k - 1] >= CLEARED_PAGE_MIN_UNITS and total[k] == 0
        restore[k] = is_cleared and total[k] > 0
        if clear[k]:
            is_cleared = True
        elif restore[k]:
            is_cleared = False
    counted = ~(clear | restore)
    counted[0] = False
    previous = np.vstack([units_all[:1], units_all[:-1]])
    decrease = np.where(counted[:, None], np.maximum(previous - units_all, 0), 0)
    increase = np.where(counted[:, None], np.maximum(units_all - previous, 0), 0)
    to_zero = np.where(counted[:, None], (previous > 0) & (units_all == 0), False).astype(float)
    bank_use = np.where(counted, series.bank_drop, 0)
    decreases, increases, zero_drops, bank_used = (_running(x) for x in (decrease, increase, to_zero, bank_use))

    # The lookback holds steps whose update time is in (t - 7 days, t]: indices (start, current].
    start = np.searchsorted(at, times - LOOKBACK_DAYS * DAY_MS, side="right") - 1
    day_back = np.searchsorted(at, times - DAY_MS, side="right") - 1
    three_days_back = np.searchsorted(at, times - 72 * HOUR_MS, side="right") - 1
    days_seen = np.minimum(LOOKBACK_DAYS, np.maximum(MIN_DAYS_SEEN, (times - at[0]) / DAY_MS))
    window = lambda running: running[current + 1] - running[start + 1]

    units = units_all[current]
    ti, gi = np.nonzero(units > threshold)
    if not len(ti):
        return None
    c = current[ti]
    u = units[ti, gi]
    seen_days = days_seen[ti]
    decreases_per_day = window(decreases)[ti, gi] / seen_days
    before = lambda index: np.where(index[ti] >= 0, u - units_all[np.maximum(index[ti], 0), gi], 0.0)
    with np.errstate(divide="ignore"):
        supply = np.where(decreases_per_day > 0, np.minimum(DAYS_OF_SUPPLY_CAP, u / decreases_per_day), DAYS_OF_SUPPLY_CAP)
    cases = {
        "time": times[ti],
        "group": gi,
        "units": u,
        "bankUnits": total[c],
        "groupsStocked": series.stocked[c].astype(float),
        "groupShare": u / total[c],
        "zeroDropsPerDay": window(zero_drops)[ti, gi] / seen_days,
        "change24h": before(day_back),
        "change72h": before(three_days_back),
        "decreasesPerDay": decreases_per_day,
        "increasesPerDay": window(increases)[ti, gi] / seen_days,
        "daysOfSupply": supply.astype(float),
        "bankUsePerDay": window(bank_used)[ti] / seen_days,
        "updates24h": (c - day_back[ti]).astype(float),
        "updatesPerDay": (c - start[ti]) / seen_days,
        "hoursSinceUpdate": hours_since[ti],
        "autoRefresh": np.full(len(ti), 1.0 if bank.auto_refresh else 0.0),
        "rhNegative": np.array([1.0 if is_rh_negative(GROUPS[g]) else 0.0 for g in gi]),
    }

    # Labels: the first update after t at or below the threshold, and whether it was a
    # cleared page.
    cleared_zero = np.r_[False, (total[:-1] >= CLEARED_PAGE_MIN_UNITS) & (total[1:] == 0)]
    zero_at = np.full(len(ti), np.iinfo(np.int64).max, dtype=np.int64)
    zero_is_cleared = np.zeros(len(ti), dtype=bool)
    for g in range(len(GROUPS)):
        rows = np.flatnonzero(gi == g)
        if not len(rows):
            continue
        zeros = np.flatnonzero(units_all[:, g] <= threshold)
        k = np.searchsorted(zeros, c[rows], side="right")
        found = k < len(zeros)
        zero_at[rows[found]] = at[zeros[k[found]]]
        zero_is_cleared[rows[found]] = cleared_zero[zeros[k[found]]]
    case_time = times[ti]
    for hours in horizons:
        window_end = case_time + hours * HOUR_MS
        label = np.zeros(len(ti), dtype=np.int8)
        open_window = np.ones(len(ti), dtype=bool)
        if data_end is not None:
            open_window &= window_end <= data_end
        for gap_start, gap_end in gaps:
            open_window &= ~((gap_start < window_end) & (gap_end > case_time))
        label[~open_window] = -1
        hit = zero_at <= window_end
        label[hit] = np.where(zero_is_cleared[hit], -1, 1)
        cases[f"y{hours}"] = label
    return cases


# ── the archive ──────────────────────────────────────────────────────────────
def read_ndjson(path):
    """Every complete line of an NDJSON file; the collector may be writing the last one."""
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            pass
    return rows


@dataclass
class Archive:
    series: dict  # code -> Series
    banks: dict  # code -> Bank
    full_sweeps: list  # finishedAt of every complete sweep up to the cut, in ms
    cutoff: int  # the last complete sweep: data_end for the labels

    @property
    def gaps(self):
        return find_gaps(self.full_sweeps)


def load_archive(data_dir, until=None, codes=None):
    """The laptop's copy of the collector's archive (../blood_data/eraktkosh/), cut at the
    last complete sweep at or before `until`. Only events fetched by then are read, as
    the walk-forward test did. `codes` keeps only those banks."""
    data_dir = Path(data_dir)
    sweeps = read_ndjson(data_dir / "sweeps.ndjson")
    full = sorted(to_ms(s["finishedAt"]) for s in sweeps if len(s.get("states", [])) == ALL_STATES)
    if until is not None:
        full = [time for time in full if time <= to_ms(until)]
    if not full:
        raise ValueError("no complete sweep in the archive before the cut")
    cutoff = full[-1]

    by_bank, states = {}, {}
    for path in sorted((data_dir / "history").glob("*.ndjson")):
        for event in read_ndjson(path):
            code = str(event.get("hospitalCode") or "")
            if not code or (codes is not None and code not in codes):
                continue
            if to_ms(event["fetchedAt"]) > cutoff:
                continue
            stock = (event.get("stock") or {}).get(COMPONENT) or {}
            by_bank.setdefault(code, {})[to_ms(event["entryAt"])] = stock  # the last line read wins
            states[code] = str(event.get("stateCode") or "")
    series = {code: Series.from_events(code, sorted(events.items())) for code, events in sorted(by_bank.items())}

    refresh = set()
    for path in sorted((data_dir / "refresh_hospitals").glob("*.json"))[-1:]:
        refresh = {str(code) for code in json.loads(path.read_text(encoding="utf-8"))}
    hospital_type = {}
    for path in sorted((data_dir / "directory").glob("20*.json"))[-1:]:
        for entry in json.loads(path.read_text(encoding="utf-8")):
            hospital_type[str(entry["hospitalCode"])] = entry.get("hospitalType")
    banks = {code: Bank(states.get(code, ""), hospital_type.get(code), code in refresh) for code in series}
    return Archive(series, banks, full, cutoff)


@dataclass
class Dataset:
    """Every case, column by column: the inputs, the labels and who and when."""

    columns: dict
    codes: list  # bank index -> hospital code
    cutoff: int
    grid: np.ndarray
    threshold: int = 0

    def __len__(self):
        return len(self.columns["time"])

    def __getitem__(self, name):
        return self.columns[name]

    def inputs(self, rows):
        """The 19 inputs of the rows asked for, as dicts (buildInputs' shape)."""
        out = []
        for row in rows:
            entry = {name: float(self.columns[name][row]) for name in NUMERIC_INPUTS}
            entry["ownership"] = self.columns["ownership"][row]
            entry["stateCode"] = self.columns["stateCode"][row]
            entry["bloodGroup"] = GROUPS[self.columns["group"][row]]
            out.append({name: entry[name] for name in INPUT_NAMES})
        return out


def build_dataset(archive, times=None, gaps=(), horizons=HORIZONS_H, threshold=0):
    """Cases for every bank at every grid time (from the first complete sweep to the cut,
    unless `times` is given). Labels use the cut as the end of the data and the event
    is falling to `threshold` units or below; `gaps` are collection gaps to censor,
    none by default (see docs/PLANS/ML_system.md, phase 0)."""
    if times is None:
        times = grid_times_between(archive.full_sweeps[0], archive.cutoff)
    times = np.asarray(times, dtype=np.int64)
    parts, codes = [], []
    for code, series in archive.series.items():
        bank = archive.banks.get(code, Bank())
        cases = bank_cases(series, bank, times, horizons, archive.cutoff, gaps, threshold)
        if cases is None:
            continue
        count = len(cases["time"])
        cases["bank"] = np.full(count, len(codes), dtype=np.int32)
        cases["ownership"] = np.full(count, ownership_of(bank.hospital_type), dtype=object)
        cases["stateCode"] = np.full(count, bank.state_code, dtype=object)
        codes.append(code)
        parts.append(cases)
    columns = {name: np.concatenate([part[name] for part in parts]) for name in parts[0]}
    return Dataset(columns, codes, archive.cutoff, times, threshold)


def summary(dataset):
    """Counts for a log line: cases, banks, grid times and stock-outs per horizon."""
    out = {"cases": len(dataset), "banks": len(dataset.codes), "grid_times": len(dataset.grid)}
    for hours in HORIZONS_H:
        y = dataset[f"y{hours}"]
        out[f"stockouts_{hours}h"] = int((y == 1).sum())
        out[f"usable_{hours}h"] = int((y >= 0).sum())
    return out


if __name__ == "__main__":
    import sys

    archive_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[2] / "blood_data" / "eraktkosh"
    until = sys.argv[sys.argv.index("--until") + 1] if "--until" in sys.argv else None
    threshold = int(sys.argv[sys.argv.index("--threshold") + 1]) if "--threshold" in sys.argv else DEFAULT_THRESHOLD_UNITS
    archive = load_archive(archive_dir, until)
    dataset = build_dataset(archive, threshold=threshold)
    print(json.dumps({"cut": iso(archive.cutoff), "threshold": threshold, "gaps_over_6_5_h": len(archive.gaps), **summary(dataset)}, indent=1))
