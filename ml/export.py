"""The model artifact: the JSON file src/lib/stockoutModel.js scores (docs/PLANS/ML_system.md, A2).

Format "bloodlink-stockout/1", for each horizon:
- a numeric term {input, transform, mean, scale, coef}: its value is
  (transform(input) - mean) / scale;
- a dummy term {input, transform: "dummy", level, coef}: 1 when the input equals the
  level, else 0;
- the intercept, and the starting Platt parameters {a, b}: P = sigmoid(a * logit + b).

Training standardizes the dummies as well (StandardScaler on the whole design matrix,
as the walk-forward test did). A standardized dummy's (d - mean) / scale * coef is
(coef / scale) * d - coef * mean / scale, so its coefficient is divided by its scale
and the rest moves into the intercept. The scores don't change.

score_artifact() is a second scorer, vectorized, that reads only the artifact. train.py
checks it against scikit-learn's predict_proba on every training row before writing.
"""

import hashlib
import json
from pathlib import Path

import numpy as np

from dataset import GROUPS, TRANSFORMS

ARTIFACT_FORMAT = "bloodlink-stockout/1"


def horizon_block(spec, scaler, model, platt):
    """One horizon's terms from a fitted StandardScaler and LogisticRegression.

    spec: one {input, transform[, level]} per design-matrix column, in order."""
    coef = model.coef_.ravel().astype(float)
    mean, scale = scaler.mean_.astype(float), scaler.scale_.astype(float)
    intercept = float(model.intercept_[0])
    terms = []
    for column, term in enumerate(spec):
        if term["transform"] == "dummy":
            intercept -= coef[column] * mean[column] / scale[column]
            terms.append({"input": term["input"], "transform": "dummy", "level": term["level"], "coef": coef[column] / scale[column]})
        else:
            terms.append({"input": term["input"], "transform": term["transform"], "mean": mean[column], "scale": scale[column], "coef": coef[column]})
    return {"intercept": intercept, "terms": terms, "platt": {"a": float(platt[0]), "b": float(platt[1])}}


def build_artifact(model_id, horizons, trained_from, trained_to, evaluation, extra=None):
    """The artifact as a dict; horizons maps 24, 48, 72 to horizon_block()'s output."""
    artifact = {
        "format": ARTIFACT_FORMAT,
        "id": model_id,
        "kind": "logistic",
        "component": "PRBC",
        "trainedFrom": trained_from,
        "trainedTo": trained_to,
        "horizons": {str(hours): block for hours, block in sorted(horizons.items())},
        "evaluation": evaluation,
    }
    artifact.update(extra or {})
    return artifact


def write_artifact(artifact, folder):
    """Writes <id>.json and <id>.sha256 (sha256sum's format); returns (path, sha256)."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{artifact['id']}.json"
    text = json.dumps(artifact, indent=1, ensure_ascii=False) + "\n"
    path.write_bytes(text.encode("utf-8"))
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    (folder / f"{artifact['id']}.sha256").write_bytes(f"{digest}  {path.name}\n".encode("utf-8"))
    return path, digest


# ── scoring from the artifact alone ──────────────────────────────────────────
def _transform(kind, values):
    values = np.asarray(values, dtype=float)
    if kind == "log1p":
        return np.log1p(np.maximum(values, 0))
    if kind == "slog":
        return np.sign(values) * np.log1p(np.abs(values))
    return values


def _column(columns, name):
    """An input's values from a dataset's columns; the blood group is stored as its index."""
    if name == "bloodGroup":
        return np.asarray(GROUPS, dtype=object)[columns["group"]]
    return columns[name]


def horizon_logits(block, columns, rows=None):
    """The logits of one horizon for every row (or the rows asked for)."""
    pick = (lambda values: values) if rows is None else (lambda values: values[rows])
    logit = None
    for term in block["terms"]:
        values = pick(_column(columns, term["input"]))
        if term["transform"] == "dummy":
            part = term["coef"] * (values.astype(str) == term["level"])
        else:
            part = term["coef"] * ((_transform(term["transform"], values) - term["mean"]) / term["scale"])
        logit = part if logit is None else logit + part
    return block["intercept"] + logit


def sigmoid(x):
    x = np.asarray(x, dtype=float)
    out = np.empty_like(x)
    positive = x >= 0
    out[positive] = 1 / (1 + np.exp(-x[positive]))
    out[~positive] = np.exp(x[~positive]) / (1 + np.exp(x[~positive]))
    return out


def score_artifact(artifact, columns, rows=None):
    """{hours: (logit, p_raw, p)} for each horizon, from the artifact alone."""
    out = {}
    for hours, block in artifact["horizons"].items():
        logit = horizon_logits(block, columns, rows)
        out[int(hours)] = (logit, sigmoid(logit), sigmoid(block["platt"]["a"] * logit + block["platt"]["b"]))
    return out


def check_transforms(spec):
    """Every numeric column uses its input's transform from dataset.TRANSFORMS."""
    for term in spec:
        expected = TRANSFORMS[term["input"]]
        if term["transform"] != expected:
            raise ValueError(f"{term['input']}: transform {term['transform']}, expected {expected}")
