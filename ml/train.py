"""Train, backtest and export the interim stock-out model (docs/PLANS/ML_system.md, A2;
phase 0).

The model is the one the walk-forward dry run of 4 November chose
(../rough_work/ML-comparison/SUMMARY.md) and adopted that day: logistic regression on the 19 core
inputs, one model per horizon (24, 48, 72 h), every row, unweighted, standardized, L2
with C = 1. It predicts low stock: the group's units falling to --threshold (2 by
default) or fewer within the horizon. Another model can replace it later through
model_versions, if a later comparison shows it does better.

What a run does:
1. builds the dataset with dataset.py, the twin of src/lib/stockoutFeatures.js;
2. walks forward by India day, as walk_forward_check.py does: each test day is scored by
   a model trained only on grid times whose outcome was known before it began (a purge
   of one horizon), on an expanding window. Scores: PR-AUC, against the best baseline
   (the stock-out rate at that many units of that group); recall at 1 and 2 false
   alerts per bank per week; the calibration ratio; lift by group; and, as the app
   will run, Platt scaling and the cut-off set on the day H/24 + 1 days back and
   carried to the test day;
3. fits each horizon on every case whose outcome is known, with its starting Platt
   parameters and alert cut-off from the latest complete test day (out of sample for
   its fold);
4. writes the artifact with export.py, after checking that the artifact's own scorer
   gives scikit-learn's probabilities on every training row;
5. writes the parity fixture of the last week (week_fixture.py) for
   tests/stockout-parity.test.js.

Run from bloodlink/, with the pinned requirements (about 3 minutes):
    python -I ml/train.py ../blood_data/eraktkosh --until 2026-11-04T04:41:28.760Z [--threshold 2]
Reads local files only. The same --until and --threshold give the same artifact.
"""

import argparse
import json
import platform
import sys
import time
from pathlib import Path

# -I leaves this folder off sys.path; it holds only our code.
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np
import scipy
import sklearn
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

import dataset as ds
import export
import metrics
import week_fixture

ROOT = Path(__file__).resolve().parents[1]
DECISION_H = 48
MIN_TRAIN_TIMES = 12  # three days of grid times before the first test day, as the dry run
UNIT_BUCKETS = [2, 3, 6, 11, 21]  # the baseline: 1, 2, 3-5, 6-10, 11-20, 21+ units
C = 1.0
MAX_ITER = 3000
# The dry run's logistic regression with rates per day seen, the encoding built here,
# for stock-outs (threshold 0) (../rough_work/ML-comparison/results/feature_tests_summary.md,
# "Reference"; SUMMARY.md, section 1).
DRY_RUN = {"threshold_units": 0, "pr_auc_48h": 0.249, "recall_at_1_false_alert_48h": 0.147, "calibration_ratio_48h": 1.17, "until": "2026-11-03T07:37:39Z"}
started = time.perf_counter()


def log(text):
    print(f"[{time.perf_counter() - started:5.0f} s] {text}", flush=True)


# ── the design matrix ────────────────────────────────────────────────────────
def design_spec(state_levels):
    """One column per numeric input (its transform), then dummies for every level."""
    spec = [{"input": name, "transform": ds.TRANSFORMS[name]} for name in ds.NUMERIC_INPUTS]
    spec += [{"input": "ownership", "transform": "dummy", "level": level} for level in ds.OWNERSHIP_LEVELS]
    spec += [{"input": "stateCode", "transform": "dummy", "level": level} for level in state_levels]
    spec += [{"input": "bloodGroup", "transform": "dummy", "level": group} for group in ds.GROUPS]
    export.check_transforms([term for term in spec if term["transform"] != "dummy"])
    return spec


def design_matrix(columns, spec, rows=None):
    count = len(columns["time"]) if rows is None else len(rows)
    X = np.empty((count, len(spec)))
    for j, term in enumerate(spec):
        values = export._column(columns, term["input"])
        values = values if rows is None else values[rows]
        X[:, j] = (values == term["level"]) if term["transform"] == "dummy" else export._transform(term["transform"], values)
    return X


def fit(X, y):
    """StandardScaler, in place, then logistic regression: the dry run's settings."""
    scaler = StandardScaler(copy=False).fit(X)
    model = LogisticRegression(C=C, max_iter=MAX_ITER).fit(scaler.transform(X, copy=False), y)
    if model.n_iter_[0] >= MAX_ITER:
        log(f"  warning: logistic regression stopped at {MAX_ITER} iterations")
    return scaler, model


def logits_of(scaler, model, X):
    return model.decision_function(scaler.transform(X, copy=False))


# ── the walk forward ─────────────────────────────────────────────────────────
def folds(grid, cutoff, hours):
    """(India day, train times, test times) for each day with enough training data."""
    eligible = grid[grid + hours * ds.HOUR_MS <= cutoff]
    out = []
    for day in np.unique(ds.india_day_number(eligible)):
        start = int(day) * ds.DAY_MS - ds.INDIA_OFFSET_MS
        train_times = eligible[eligible + hours * ds.HOUR_MS <= start]
        test_times = eligible[(eligible >= start) & (eligible < start + ds.DAY_MS)]
        if len(train_times) >= MIN_TRAIN_TIMES and len(test_times):
            out.append((int(day), train_times, test_times))
    return out


def unit_bucket_rates(data, y, train, test):
    """The best baseline: the training stock-out rate at that many units of that group."""
    bucket = data["group"] * (len(UNIT_BUCKETS) + 1) + np.digitize(data["units"], UNIT_BUCKETS)
    cells = len(ds.GROUPS) * (len(UNIT_BUCKETS) + 1)
    counts = np.bincount(bucket[train], minlength=cells)
    hits = np.bincount(bucket[train], weights=y[train], minlength=cells)
    mean = y[train].mean()
    return ((hits + 20 * mean) / (counts + 20))[bucket[test]]


def walk_forward(data, X_all, hours, quick=False):
    y = data[f"y{hours}"]
    usable = y >= 0
    plan = folds(data.grid, data.cutoff, hours)
    if quick:
        plan = plan[-(hours // 24 + 3):]
    y01 = np.where(usable, y, 0).astype(float)
    results = []
    for day, train_times, test_times in plan:
        train = np.flatnonzero(np.isin(data["time"], train_times) & usable)
        test = np.flatnonzero(np.isin(data["time"], test_times) & usable)
        scaler, model = fit(X_all[train], y[train])
        logit = logits_of(scaler, model, X_all[test])
        results.append({
            "day": day, "rows": test, "logit": logit, "p": export.sigmoid(logit), "y": y[test],
            "baseline": unit_bucket_rates(data, y01, train, test), "full_day": len(test_times) == 4,
            "train_rows": len(train), "train_stockouts": int(y[train].sum()),
        })
        log(f"  {hours} h, test day {ds.india_day(day * ds.DAY_MS)}: {len(train)} training rows, {len(test)} test rows, {int(y[test].sum())} stock-outs")
    return results


def evaluate(data, results, hours):
    """The backtest's scores at one horizon, pooled over the test days."""
    rows = np.concatenate([r["rows"] for r in results])
    p = np.concatenate([r["p"] for r in results])
    y = np.concatenate([r["y"] for r in results])
    baseline = np.concatenate([r["baseline"] for r in results])
    bank, group = data["bank"][rows], data["group"][rows]
    day = ds.india_day_number(data["time"][rows])
    at_1 = metrics.choose_cut_off(p, y, bank, group, day, budget=1.0)
    at_2 = metrics.choose_cut_off(p, y, bank, group, day, budget=2.0)
    out = {
        "test_days": [ds.india_day(r["day"] * ds.DAY_MS) for r in results],
        "cases": int(len(y)), "stockouts": int(y.sum()), "base_rate": float(y.mean()),
        "pr_auc": metrics.pr_auc(p, y),
        "pr_auc_by_day": {ds.india_day(r["day"] * ds.DAY_MS): metrics.pr_auc(r["p"], r["y"]) for r in results},
        "baseline_pr_auc": metrics.pr_auc(baseline, y),
        "recall_at_1_false_alert": at_1["recall"],
        "recall_at_2_false_alerts": at_2["recall"],
        "calibration_ratio": metrics.calibration_ratio(p, y),
        "brier": metrics.brier(p, y),
        "lift_by_group": metrics.lift_by_group(p, y, group),
    }
    out["beats_baseline_by"] = out["pr_auc"] / out["baseline_pr_auc"] - 1 if out["baseline_pr_auc"] else None

    # As the app runs: Platt and the cut-off set on the day H/24 + 1 days back.
    by_day = {r["day"]: r for r in results}
    carried = []
    for r in results:
        earlier = by_day.get(r["day"] - (hours // 24 + 1))
        if earlier is None:
            continue
        a, b = metrics.fit_platt(earlier["logit"], earlier["y"])
        e_rows = earlier["rows"]
        cut = metrics.choose_cut_off(
            export.sigmoid(a * earlier["logit"] + b), earlier["y"], data["bank"][e_rows], data["group"][e_rows],
            ds.india_day_number(data["time"][e_rows]),
        )["cut_off"]
        carried.append((r, export.sigmoid(a * r["logit"] + b), cut))
    if carried:
        c_rows = np.concatenate([r["rows"] for r, _, _ in carried])
        c_p = np.concatenate([p_cal for _, p_cal, _ in carried])
        c_y = np.concatenate([r["y"] for r, _, _ in carried])
        c_raw = np.concatenate([r["p"] for r, _, _ in carried])
        # Each day alerts at its own carried cut-off; false alerts are counted per day.
        alerted = np.concatenate([p_cal > cut for r, p_cal, cut in carried])
        c_bank, c_group = data["bank"][c_rows], data["group"][c_rows]
        c_day = ds.india_day_number(data["time"][c_rows])
        flagged = metrics.alert_metrics(alerted.astype(float), c_y, c_bank, c_group, c_day, 0.5)
        out["carried"] = {
            "test_days": [ds.india_day(r["day"] * ds.DAY_MS) for r, _, _ in carried],
            "cases": int(len(c_y)),
            "calibration_ratio_raw": metrics.calibration_ratio(c_raw, c_y),
            "calibration_ratio": metrics.calibration_ratio(c_p, c_y),
            "brier_raw": metrics.brier(c_raw, c_y),
            "brier": metrics.brier(c_p, c_y),
            "false_alerts_per_bank_week": flagged["false_alerts_per_bank_week"],
            "recall": flagged["recall"],
        }
    return out


# ── the run ──────────────────────────────────────────────────────────────────
def gap_effect(data, gaps):
    """What the label rule's gap clause would remove: negatives whose window crosses a
    gap. Seen stock-outs stay, so the rule raises the stock-out rate of what is left."""
    out = {}
    for hours in ds.HORIZONS_H:
        y, t = data[f"y{hours}"], data["time"]
        crosses = np.zeros(len(y), bool)
        for start, end in gaps:
            crosses |= (start < t + hours * ds.HOUR_MS) & (end > t)
        known = y >= 0
        kept = known & ~(crosses & (y == 0))
        out[str(hours)] = {
            "cases": int(known.sum()), "rate": float(y[known].mean()),
            "cases_with_gap_rule": int(kept.sum()), "rate_with_gap_rule": float(y[kept].mean()),
        }
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("archive", nargs="?", default=str(ROOT.parent / "blood_data" / "eraktkosh"))
    parser.add_argument("--until", help="cut at the last complete sweep at or before this time")
    parser.add_argument("--out", default=str(ROOT / "ml" / "models"))
    parser.add_argument("--fixture", default=str(ROOT / "tests" / "fixtures" / "stockout_week.json"))
    parser.add_argument("--threshold", type=int, default=ds.DEFAULT_THRESHOLD_UNITS, help="low stock: units at or below this")
    parser.add_argument("--quick", action="store_true", help="the last few test days only")
    args = parser.parse_args()

    archive = ds.load_archive(args.archive, args.until)
    data = ds.build_dataset(archive, threshold=args.threshold)
    log(f"cut at {ds.iso(archive.cutoff)}, threshold {args.threshold} units: {json.dumps(ds.summary(data))}")
    gaps = gap_effect(data, archive.gaps)
    log(f"{len(archive.gaps)} collection gaps over {ds.DEFAULT_GAP_HOURS} h; the gap rule would leave {json.dumps(gaps)}")

    states = sorted(set(data["stateCode"]))
    spec = design_spec(states)
    X_all = design_matrix(data.columns, spec)
    log(f"design matrix {X_all.shape[0]} x {X_all.shape[1]}")

    evaluation, blocks, pipelines = {}, {}, {}
    for hours in ds.HORIZONS_H:
        results = walk_forward(data, X_all, hours, args.quick)
        evaluation[str(hours)] = evaluate(data, results, hours)
        e = evaluation[str(hours)]
        log(f"{hours} h: PR-AUC {e['pr_auc']:.3f} (baseline {e['baseline_pr_auc']:.3f}), recall at 1 false alert {e['recall_at_1_false_alert']:.3f}, calibration {e['calibration_ratio']:.2f}"
            + (f"; carried: calibration {e['carried']['calibration_ratio']:.2f}, false alerts {e['carried']['false_alerts_per_bank_week']:.2f}, recall {e['carried']['recall']:.3f}" if "carried" in e else ""))

        # Starting Platt parameters and alert cut-off: the latest complete test day, out
        # of sample. The daily job replaces both once live outcomes exist.
        last = [r for r in results if r["full_day"]][-1]
        platt = metrics.fit_platt(last["logit"], last["y"])
        rows = last["rows"]
        evaluation[str(hours)]["platt_day"] = ds.india_day(last["day"] * ds.DAY_MS)
        evaluation[str(hours)]["cut_off"] = metrics.choose_cut_off(
            export.sigmoid(platt[0] * last["logit"] + platt[1]), last["y"], data["bank"][rows], data["group"][rows],
            ds.india_day_number(data["time"][rows]),
        )["cut_off"]

        y = data[f"y{hours}"]
        train = np.flatnonzero((y >= 0) & (data["time"] + hours * ds.HOUR_MS <= data.cutoff))
        X = X_all[train]
        scaler, model = fit(X, y[train])  # X is now standardized
        sk_p = model.predict_proba(X)[:, 1]
        blocks[hours] = export.horizon_block(spec, scaler, model, platt)
        _, own_p, _ = export.score_artifact({"horizons": {hours: blocks[hours]}}, data.columns, train)[hours]
        gap = float(np.max(np.abs(own_p - sk_p)))
        if gap > 1e-9:
            raise SystemExit(f"{hours} h: the artifact's scores differ from scikit-learn's by {gap}")
        pipelines[hours] = (scaler, model, platt)
        evaluation[str(hours)]["training"] = {"rows": int(len(train)), "stockouts": int(y[train].sum()), "iterations": int(model.n_iter_[0]), "artifact_vs_sklearn": gap}
        log(f"{hours} h: final fit on {len(train)} rows in {model.n_iter_[0]} iterations; artifact matches scikit-learn to {gap:.1e}")
        del X

    first, last_time = int(data.grid[0]), int(data.cutoff)
    model_id = f"stockout-logit-t{args.threshold}-{ds.india_day(last_time)}"
    artifact = export.build_artifact(
        model_id, blocks, ds.india_day(first), ds.india_day(last_time),
        {
            "method": "walk forward by India day, expanding window, purged one horizon (dry-run harness)",
            "decision_horizon_h": DECISION_H,
            "threshold_units": args.threshold,
            "by_horizon": evaluation,
            "dry_run_reference": DRY_RUN,
            "gap_rule_effect": gaps,
        },
        {
            "thresholdUnits": args.threshold,
            "inputs": ds.INPUT_NAMES,
            "dataset": {
                "builder": "ml/dataset.py", "cut": ds.iso(archive.cutoff), "grid_times": int(len(data.grid)),
                "cases": int(len(data)), "banks": len(data.codes), "collection_gaps_over_6_5_h": len(archive.gaps),
                "labels": f"units at or below {args.threshold} within the horizon, by report 3's rules otherwise; collection gaps not censored",
            },
            "training": {
                "model": "LogisticRegression(C=1.0, lbfgs), StandardScaler, every row unweighted",
                "python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "scikit_learn": sklearn.__version__,
            },
        },
    )
    path, digest = export.write_artifact(artifact, args.out)
    log(f"wrote {path} (sha256 {digest})")

    fixture = week_fixture.write(archive, data, spec, pipelines, artifact, path, args.fixture, design_matrix)
    log(f"wrote {fixture['path']}: {fixture['banks']} banks, {fixture['events']} events, {fixture['cases']} cases at {fixture['grid_times']} grid times")


if __name__ == "__main__":
    main()
