"""The forecast's scores, defined as src/lib/stockoutModel.js defines them, so the
backtest and the app's daily metrics (docs/PLANS/ML_system.md, A4) measure the same
thing:

- an alert is p > cut-off;
- a series raises at most one false alert per bank, group and India day;
- false alerts per bank per week = those alerts / (banks x days) x 7;
- the cut-off is the lowest that keeps false alerts within the budget (chooseCutOff);
- PR-AUC is scikit-learn's average precision; the calibration ratio is mean
  prediction / observed rate;
- Platt scaling is scikit-learn's sigmoid calibration on the raw logits, returned as
  stockoutModel.js's {a, b}: P = sigmoid(a * logit + b).
"""

import math

import numpy as np
from sklearn.calibration import _sigmoid_calibration
from sklearn.metrics import average_precision_score, brier_score_loss

from dataset import GROUPS


def _keys(bank, group, day):
    return (np.asarray(bank, np.int64) * len(GROUPS) + np.asarray(group, np.int64)) * 1_000_000 + np.asarray(day, np.int64)


def alert_metrics(p, y, bank, group, day, cut_off):
    """{false_alerts, false_alerts_per_bank_week, recall} at a cut-off (alertMetrics)."""
    p, y = np.asarray(p, float), np.asarray(y)
    alerted = p > cut_off
    false_keys = np.unique(_keys(bank, group, day)[alerted & (y == 0)])
    banks, days = len(np.unique(bank)), len(np.unique(day))
    positives = int((y == 1).sum())
    return {
        "false_alerts": int(len(false_keys)),
        "false_alerts_per_bank_week": len(false_keys) / (banks * days) * 7 if banks and days else 0.0,
        "recall": float(alerted[y == 1].sum() / positives) if positives else None,
    }


def choose_cut_off(p, y, bank, group, day, budget=1.0):
    """The lowest cut-off within the budget of false alerts per bank per week (chooseCutOff)."""
    p, y = np.asarray(p, float), np.asarray(y)
    negative = y == 0
    keys = _keys(bank, group, day)[negative]
    order = np.argsort(keys, kind="stable")
    keys, scores = keys[order], p[negative][order]
    starts = np.flatnonzero(np.r_[True, keys[1:] != keys[:-1]]) if len(keys) else np.array([], int)
    highest = np.sort(np.maximum.reduceat(scores, starts))[::-1] if len(keys) else np.array([])
    banks, days = len(np.unique(bank)), len(np.unique(day))
    allowed = math.floor(budget * banks * days / 7)
    cut_off = float(highest[allowed]) if len(highest) > allowed else 0.0
    return {"cut_off": cut_off, "allowed_false_alerts": allowed, **alert_metrics(p, y, bank, group, day, cut_off)}


def pr_auc(p, y):
    y = np.asarray(y)
    return float(average_precision_score(y, p)) if 0 < y.sum() < len(y) else None


def calibration_ratio(p, y):
    observed = int(np.sum(y))
    return float(np.sum(p) / observed) if observed else None


def brier(p, y):
    return float(brier_score_loss(y, p))


def fit_platt(logits, y):
    """{a, b} for sigmoid(a * logit + b); stockoutModel.js's fitPlatt fits the same."""
    A, B = _sigmoid_calibration(np.asarray(logits, float), np.asarray(y, int))
    return float(-A), float(-B)


def lift_by_group(p, y, group):
    """PR-AUC over each group's own stock-out rate."""
    out = {}
    for g, name in enumerate(GROUPS):
        rows = np.asarray(group) == g
        if not rows.any():
            continue
        base = float(np.mean(y[rows]))
        score = pr_auc(p[rows], y[rows])
        out[name] = {"cases": int(rows.sum()), "base_rate": base, "pr_auc": score, "lift": score / base if score is not None and base > 0 else None}
    return out
