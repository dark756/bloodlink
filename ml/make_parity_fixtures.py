"""Reference values from scikit-learn for the JS side of the stock-out forecast.

docs/PLANS/ML_system.md, A2 and A4: the daily calibration (Platt scaling) and the
PR-AUC run in JS (src/lib/stockoutModel.js), so they must agree with the library the
models are trained and judged with. This writes tests/fixtures/stockout_sklearn.json,
which tests/stockout-model.test.js reads:

- Platt scaling: scikit-learn's own sigmoid calibration (the function
  CalibratedClassifierCV(method="sigmoid") calls) on fixed, seeded scores;
- average precision: sklearn.metrics.average_precision_score, ties included.

Run from bloodlink/, with the pinned requirements:
    python -m pip install -r ml/requirements.txt
    python -I ml/make_parity_fixtures.py
The output is the same on every run (fixed seeds, rounded inputs).
"""

import json
import pathlib

import numpy as np
import sklearn
from sklearn.calibration import _sigmoid_calibration
from sklearn.metrics import average_precision_score

OUT = pathlib.Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "stockout_sklearn.json"


def case(name, scores, labels, probe):
    # Rounded first, so JS and Python fit exactly the same numbers.
    scores = np.round(np.asarray(scores, dtype=float), 6)
    labels = np.asarray(labels, dtype=int)
    probe = np.round(np.asarray(probe, dtype=float), 6)
    A, B = _sigmoid_calibration(scores, labels)
    calibrated = 1.0 / (1.0 + np.exp(A * probe + B))
    return {
        "name": name,
        "scores": scores.tolist(),
        "labels": labels.tolist(),
        "platt": {"A": float(A), "B": float(B)},
        "probe": probe.tolist(),
        "calibrated": calibrated.tolist(),
        "averagePrecision": float(average_precision_score(labels, scores)),
    }


def main():
    rng = np.random.default_rng(20261104)
    cases = []

    # An over-confident model, as logistic regression was in the dry run: the true
    # chance is sigmoid(0.7 * score - 0.4).
    scores = rng.normal(-2.5, 1.5, 600)
    labels = rng.random(600) < 1 / (1 + np.exp(-(0.7 * scores - 0.4)))
    cases.append(case("over-confident", scores, labels, np.linspace(-6, 2, 9)))

    # Rare stock-outs, about 3%, as at 24 hours.
    scores = rng.normal(-4, 1.2, 800)
    labels = rng.random(800) < 1 / (1 + np.exp(-(1.1 * scores + 0.5)))
    cases.append(case("rare", scores, labels, np.linspace(-8, 0, 9)))

    # Scores beyond 30, which scikit-learn rescales before fitting.
    scores = rng.normal(0, 20, 300)
    labels = rng.random(300) < 1 / (1 + np.exp(-scores / 10))
    cases.append(case("large scores", scores, labels, np.linspace(-60, 60, 7)))

    # Many tied scores, for average precision's handling of ties.
    scores = rng.integers(0, 6, 200) / 2 - 2
    labels = rng.random(200) < 0.15 + 0.1 * (scores + 2)
    cases.append(case("ties", scores, labels, [-2.0, 0.0, 0.5]))

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "generatedBy": "ml/make_parity_fixtures.py",
        "sklearn": sklearn.__version__,
        "numpy": np.__version__,
        "cases": cases,
    }
    OUT.write_text(json.dumps(payload) + "\n")
    print(f"wrote {OUT} with {len(cases)} cases (scikit-learn {sklearn.__version__})")


if __name__ == "__main__":
    main()
