"""The parity fixture: one real week of history, for tests/stockout-parity.test.js.

docs/PLANS/ML_system.md, A2: on fixtures of real history, the Python dataset builder
and src/lib/stockoutFeatures.js must give the same inputs, and scikit-learn and
src/lib/stockoutModel.js the same probabilities to 6 decimal places. A model whose
parity test fails is never promoted.

The fixture holds, for 12 banks chosen to cover the cases that differ (auto-refresh
banks with drops to zero, cleared pages, banks first seen late, every kind of owner):
- every red-cell update each bank made from the start of the archive to the cut, so
  both sides see the same first update ("per day seen" counts from it);
- the bank attributes the app reads from blood_banks;
- at each of the week's 28 grid times, every case dataset.py scores: [bank, group,
  index into gridTimes, its 19 inputs, its labels at 24, 48 and 72 h, the probabilities
  scikit-learn gives raw, and with the artifact's starting Platt parameters].

train.py writes it after fitting, from the fitted pipelines. Bank stock is public
eRaktKosh data; the fixture holds no personal data.
"""

import json
from pathlib import Path

import numpy as np

import dataset as ds

FIXTURE_BANKS = 12
PROBABILITY_DECIMALS = 10  # the test compares to 6; the inputs are kept exact
SEED = 20261104
WEEK_GRID_TIMES = 28


def _bank_traits(archive):
    traits = {}
    first_sweep = archive.full_sweeps[0]
    for code, series in archive.series.items():
        total, units = series.total, series.units
        cleared = bool(np.any((total[:-1] >= ds.CLEARED_PAGE_MIN_UNITS) & (total[1:] == 0)))
        drops = int(np.sum((units[:-1] > 0) & (units[1:] == 0)))
        traits[code] = {
            "auto_refresh": archive.banks[code].auto_refresh,
            "cleared": cleared,
            "drops": drops,
            "late": bool(series.at[0] > first_sweep + ds.DAY_MS),
            "ownership": ds.ownership_of(archive.banks[code].hospital_type),
        }
    return traits


def select_banks(archive, candidates, count=FIXTURE_BANKS, seed=SEED):
    """A fixed mix of banks that have cases in the week, the same on every run."""
    rng = np.random.default_rng(seed)
    traits = _bank_traits(archive)
    candidates = sorted(candidates)
    chosen = []

    def take(pool, k, by=None):
        pool = [code for code in pool if code not in chosen]
        if by is not None:
            pool = sorted(pool, key=by)[:k]
        elif len(pool) > k:
            pool = [str(code) for code in rng.choice(pool, k, replace=False)]
        chosen.extend(sorted(pool)[:k])

    take([c for c in candidates if traits[c]["auto_refresh"] and traits[c]["drops"]], 3, by=lambda c: (-traits[c]["drops"], c))
    take([c for c in candidates if traits[c]["cleared"]], 2)
    take([c for c in candidates if traits[c]["late"]], 2)
    for level in ds.OWNERSHIP_LEVELS:
        take([c for c in candidates if traits[c]["ownership"] == level], 1)
    take([c for c in candidates if traits[c]["drops"]], count - len(chosen))
    return sorted(chosen)


def _compact(value):
    """Whole numbers as integers, to keep the fixture small; JSON reads both the same."""
    return int(value) if isinstance(value, float) and value.is_integer() else value


def _label(value):
    return None if value < 0 else bool(value == 1)


def write(archive, data, spec, pipelines, artifact, artifact_path, out_path, design_matrix):
    week = data.grid[-WEEK_GRID_TIMES:]
    in_week = np.isin(data["time"], week)
    codes = select_banks(archive, {data.codes[b] for b in np.unique(data["bank"][in_week])})
    sub = ds.Archive({c: archive.series[c] for c in codes}, {c: archive.banks[c] for c in codes}, archive.full_sweeps, archive.cutoff)
    week_data = ds.build_dataset(sub, times=week, threshold=data.threshold)

    p_raw, p_cal = {}, {}
    for hours, (scaler, model, (a, b)) in pipelines.items():
        X = scaler.transform(design_matrix(week_data.columns, spec), copy=False)
        p_raw[hours] = model.predict_proba(X)[:, 1]
        p_cal[hours] = 1 / (1 + np.exp(-(a * model.decision_function(X) + b)))

    inputs = week_data.inputs(range(len(week_data)))
    cases = []
    for row, entry in enumerate(inputs):
        cases.append([
            week_data.codes[week_data["bank"][row]],
            ds.GROUPS[week_data["group"][row]],
            int(np.searchsorted(week, week_data["time"][row])),
            [_compact(entry[name]) for name in ds.INPUT_NAMES],
            [_label(week_data[f"y{hours}"][row]) for hours in ds.HORIZONS_H],
            [round(float(p_raw[hours][row]), PROBABILITY_DECIMALS) for hours in ds.HORIZONS_H],
            [round(float(p_cal[hours][row]), PROBABILITY_DECIMALS) for hours in ds.HORIZONS_H],
        ])

    events = []
    for code in codes:
        series = archive.series[code]
        events += [{"hospitalCode": code, "entryAt": ds.iso(at), "stock": {ds.COMPONENT: stock}} for at, stock in zip(series.at, series.stocks)]
    root = Path(__file__).resolve().parents[1]  # bloodlink/
    artifact_path = Path(artifact_path).resolve()
    fixture = {
        "generatedBy": "ml/train.py (ml/week_fixture.py)",
        "artifact": artifact_path.relative_to(root).as_posix() if artifact_path.is_relative_to(root) else artifact_path.as_posix(),
        "artifactId": artifact["id"],
        "thresholdUnits": data.threshold,
        "dataEnd": ds.iso(archive.cutoff),
        "inputNames": ds.INPUT_NAMES,
        "horizons": list(ds.HORIZONS_H),
        "banks": {
            code: {
                "stateCode": archive.banks[code].state_code,
                "hospitalType": archive.banks[code].hospital_type,
                "autoRefresh": archive.banks[code].auto_refresh,
            }
            for code in codes
        },
        "events": events,
        "gridTimes": [ds.iso(time) for time in week],
        "cases": cases,
    }
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes((json.dumps(fixture, separators=(",", ":")) + "\n").encode("utf-8"))
    return {"path": out_path, "banks": len(codes), "events": len(events), "cases": len(cases), "grid_times": len(week)}
