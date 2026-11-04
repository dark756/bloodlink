"""metrics.py and export.py: the cut-off as tests/stockout-model.test.js pins it, and the
artifact scoring exactly as scikit-learn does."""

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

import dataset as ds
import export
import metrics


def test_the_cut_off_counts_one_false_alert_per_bank_group_and_day():
    # 14 banks on one day: a budget of 1 false alert per bank per week allows 2.
    bank = np.arange(1, 15)
    p = bank / 100
    y = (bank % 5 == 0).astype(int)
    # A second negative case for bank 14's group that day counts once.
    bank, p, y = np.r_[bank, 14], np.r_[p, 0.135], np.r_[y, 0]
    group, day = np.full(len(bank), ds.GROUPS.index("O-Ve")), np.zeros(len(bank), int)
    chosen = metrics.choose_cut_off(p, y, bank, group, day)
    assert chosen["allowed_false_alerts"] == 2 and chosen["cut_off"] == 0.12 and chosen["false_alerts"] == 2
    assert abs(chosen["false_alerts_per_bank_week"] - 1) < 1e-12 and chosen["recall"] == 0
    assert metrics.alert_metrics(p, y, bank, group, day, 0.095) == {"false_alerts": 4, "false_alerts_per_bank_week": 2.0, "recall": 0.5}


def test_platt_is_returned_as_the_apps_a_and_b():
    rng = np.random.default_rng(3)
    scores = rng.normal(-2, 1.5, 500)
    labels = rng.random(500) < 1 / (1 + np.exp(-(0.6 * scores - 0.3)))
    a, b = metrics.fit_platt(scores, labels)
    assert abs(a - 0.6) < 0.25 and abs(b + 0.3) < 0.6


def test_the_artifact_scores_as_scikit_learn_does():
    rng = np.random.default_rng(7)
    n = 400
    columns = {name: rng.gamma(2, 2, n) for name in ds.NUMERIC_INPUTS}
    columns["change24h"] = rng.normal(0, 3, n)
    columns["ownership"] = rng.choice(ds.OWNERSHIP_LEVELS, n).astype(object)
    columns["stateCode"] = rng.choice(["27", "29", "33"], n).astype(object)
    columns["group"] = rng.integers(0, 8, n)
    columns["time"] = np.zeros(n)
    spec = [{"input": name, "transform": ds.TRANSFORMS[name]} for name in ds.NUMERIC_INPUTS]
    spec += [{"input": "ownership", "transform": "dummy", "level": level} for level in ds.OWNERSHIP_LEVELS]
    spec += [{"input": "stateCode", "transform": "dummy", "level": level} for level in ("27", "29", "33")]
    spec += [{"input": "bloodGroup", "transform": "dummy", "level": group} for group in ds.GROUPS]
    X = np.column_stack([
        (export._column(columns, t["input"]) == t["level"]).astype(float) if t["transform"] == "dummy"
        else export._transform(t["transform"], columns[t["input"]])
        for t in spec
    ])
    y = rng.random(n) < 0.2
    scaler = StandardScaler().fit(X)
    model = LogisticRegression(max_iter=1000).fit(scaler.transform(X), y)
    block = export.horizon_block(spec, scaler, model, (1.0, 0.0))
    assert all("mean" not in term for term in block["terms"] if term["transform"] == "dummy")
    _, p_raw, p = export.score_artifact({"horizons": {"48": block}}, columns)[48]
    assert np.max(np.abs(p_raw - model.predict_proba(scaler.transform(X))[:, 1])) < 1e-12
    assert np.array_equal(p, p_raw)
