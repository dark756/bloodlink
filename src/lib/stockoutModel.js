import {
  CATEGORICAL_INPUTS,
  HORIZONS_H,
  INDIA_OFFSET_MS,
  INPUT_NAMES,
} from "./stockoutFeatures.js";

// Scoring, daily calibration, the alert cut-off, the daily metrics and the kill
// switch for the stock-out forecast (docs/PLANS/ML_system.md, A2 to A4 and A7).
// Pure, so the score-stock Edge Function, scripts and tests share it. Training stays
// in Python (ml/); this applies the JSON artifact it exports.
//
// The artifact, format ARTIFACT_FORMAT:
// {
//   "format": "bloodlink-stockout/1", "id": "stockout-logit-2027-01-04",
//   "kind": "logistic", "component": "PRBC",
//   "trainedFrom": "2026-10-23", "trainedTo": "2026-12-27",
//   "thresholdUnits": 2,
//   "horizons": {
//     "24": {
//       "intercept": -3.1,
//       "terms": [
//         { "input": "units", "transform": "log1p", "mean": 1.9, "scale": 1.1, "coef": -0.8 },
//         { "input": "stateCode", "transform": "dummy", "level": "27", "coef": 0.2 }
//       ],
//       "platt": { "a": 1, "b": 0 }
//     },
//     "48": { ... }, "72": { ... }
//   },
//   "evaluation": { ... }
// }
// A numeric term's value is (transform(input) − mean) ÷ scale; a dummy is 1 when the
// input equals its level and 0 otherwise. The logit is the intercept plus each
// coefficient × value, and P = sigmoid(a · logit + b) once calibrated.
// thresholdUnits is what the model predicts: the group's units falling to that many
// or fewer within each horizon. 0, or no value, is a stock-out.

export const ARTIFACT_FORMAT = "bloodlink-stockout/1";
export const TRANSFORMS = ["identity", "log1p", "slog", "dummy"];
export const MAX_THRESHOLD_UNITS = 20;

// The low-stock threshold an artifact was trained with.
export const thresholdOf = (artifact) => artifact?.thresholdUnits ?? 0;

// The kill switch (A4) and the shadow exit (A7). All are assumptions, set in shadow.
export const KILL_FALSE_ALERTS = 1.5; // per bank per week…
export const KILL_FALSE_ALERT_DAYS = 3; // …for this many days running
export const CALIBRATION_RANGE = [0.8, 1.25]; // mean prediction ÷ observed rate
export const KILL_FAILED_RUNS = 2; // the latest runs, all failed
export const SHADOW_FALSE_ALERTS = 1.2;
export const SHADOW_CLEAN_DAYS = 7; // no failed runs for this long
// The alert budget: false alerts per bank per week the cut-off allows.
export const ALERT_BUDGET = 1;
// The admin overview turns red when no scoring run has finished for this long.
export const FORECAST_OVERDUE_HOURS = 7;
// A run that never finished counts as failed once it is this old.
export const RUN_STALE_MINUTES = 30;
// The forecast's flags, which the kill switch turns off. admin_events is not one.
export const FORECAST_FLAGS = ["forecast_badge", "forecast_ranking", "forecast_appeals"];

const HOUR_MS = 3_600_000;

export const sigmoid = (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)));
export const logit = (p) => Math.log(p / (1 - p));

// ── the artifact ─────────────────────────────────────────────────────────────

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

// { artifact } when the artifact has the expected shape, or { error }.
export function validateArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") return { error: "artifact must be an object" };
  if (artifact.format !== ARTIFACT_FORMAT) return { error: `format must be ${ARTIFACT_FORMAT}` };
  if (artifact.kind !== "logistic") return { error: "only logistic artifacts can be scored" };
  if (typeof artifact.id !== "string" || !/^[a-z0-9][a-z0-9.-]{2,80}$/.test(artifact.id)) {
    return { error: "id must be a short lower-case name" };
  }
  const threshold = thresholdOf(artifact);
  if (!Number.isInteger(threshold) || threshold < 0 || threshold > MAX_THRESHOLD_UNITS) {
    return { error: `thresholdUnits must be a whole number from 0 to ${MAX_THRESHOLD_UNITS}` };
  }
  for (const hours of HORIZONS_H) {
    const horizon = artifact.horizons?.[hours];
    if (!horizon) return { error: `horizon ${hours} is missing` };
    if (!isFiniteNumber(horizon.intercept)) return { error: `horizon ${hours}: bad intercept` };
    if (!isFiniteNumber(horizon.platt?.a) || !isFiniteNumber(horizon.platt?.b)) {
      return { error: `horizon ${hours}: bad platt parameters` };
    }
    if (!Array.isArray(horizon.terms) || horizon.terms.length === 0) {
      return { error: `horizon ${hours}: no terms` };
    }
    for (const [index, term] of horizon.terms.entries()) {
      const where = `horizon ${hours}, term ${index}`;
      if (!INPUT_NAMES.includes(term.input))
        return { error: `${where}: unknown input ${term.input}` };
      if (!TRANSFORMS.includes(term.transform)) return { error: `${where}: unknown transform` };
      if (!isFiniteNumber(term.coef)) return { error: `${where}: bad coefficient` };
      if (term.transform === "dummy") {
        if (typeof term.level !== "string") return { error: `${where}: a dummy needs a level` };
      } else {
        if (CATEGORICAL_INPUTS.has(term.input)) {
          return { error: `${where}: ${term.input} is a category, so it needs a dummy` };
        }
        if (!isFiniteNumber(term.mean) || !isFiniteNumber(term.scale) || term.scale <= 0) {
          return { error: `${where}: bad mean or scale` };
        }
      }
    }
  }
  return { artifact };
}

// The artifact with a horizon's Platt parameters replaced (the daily calibration).
export function withCalibration(artifact, plattByHorizon) {
  const horizons = { ...artifact.horizons };
  for (const [hours, platt] of Object.entries(plattByHorizon)) {
    horizons[hours] = { ...horizons[hours], platt: { a: platt.a, b: platt.b } };
  }
  return { ...artifact, horizons };
}

// ── scoring ──────────────────────────────────────────────────────────────────

// One term's value for an input object.
export function termValue(term, inputs) {
  const value = inputs[term.input];
  if (term.transform === "dummy") return String(value) === term.level ? 1 : 0;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`input ${term.input} is not a number`);
  let transformed = number;
  if (term.transform === "log1p") transformed = Math.log1p(Math.max(0, number));
  else if (term.transform === "slog")
    transformed = Math.sign(number) * Math.log1p(Math.abs(number));
  return (transformed - term.mean) / term.scale;
}

// Each term's contribution (coefficient × value) and the logit at one horizon.
export function horizonLogit(horizon, inputs) {
  let total = horizon.intercept;
  const contributions = horizon.terms.map((term) => {
    const contribution = term.coef * termValue(term, inputs);
    total += contribution;
    return { input: term.input, contribution };
  });
  return { logit: total, contributions };
}

// Scores one case: { logits, pRaw, p, reasons }, each array in HORIZONS_H order.
// reasons are the three inputs pushing the 48-hour risk up most.
export function scoreCase(artifact, inputs, { reasonHorizon = 48, reasonCount = 3 } = {}) {
  const logits = [];
  const pRaw = [];
  const p = [];
  let reasons = [];
  for (const hours of HORIZONS_H) {
    const horizon = artifact.horizons[hours];
    const { logit: value, contributions } = horizonLogit(horizon, inputs);
    logits.push(value);
    pRaw.push(sigmoid(value));
    p.push(sigmoid(horizon.platt.a * value + horizon.platt.b));
    if (hours === reasonHorizon) reasons = topReasons(contributions, inputs, reasonCount);
  }
  return { logits, pRaw, p, reasons };
}

// The inputs with the largest positive contributions, summed per input, in words.
export function topReasons(contributions, inputs, count = 3) {
  const byInput = new Map();
  for (const { input, contribution } of contributions) {
    byInput.set(input, (byInput.get(input) ?? 0) + contribution);
  }
  return [...byInput.entries()]
    .filter(([, contribution]) => contribution > 0)
    .sort(([, a], [, b]) => b - a)
    .slice(0, count)
    .map(([input, contribution]) => ({
      input,
      contribution: Math.round(contribution * 1000) / 1000,
      text: describeInput(input, inputs),
    }));
}

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const round1 = (value) => Math.round(value * 10) / 10;

// A plain-language reason for one input, for the "may run out soon" mark.
export function describeInput(input, inputs) {
  const value = inputs[input];
  switch (input) {
    case "units":
      return `only ${plural(value, "unit")} left`;
    case "bankUnits":
      return `${plural(value, "unit")} of red cells at the bank in all`;
    case "groupsStocked":
      return `${plural(value, "group")} in stock at the bank`;
    case "groupShare":
      return `${Math.round(value * 100)}% of the bank's red cells`;
    case "zeroDropsPerDay":
      return value > 0 ? "ran out of this group in the past week" : "hasn't run out lately";
    case "change24h":
    case "change72h": {
      const period = input === "change24h" ? "24 hours" : "3 days";
      if (value < 0) return `down ${plural(-value, "unit")} in ${period}`;
      return value > 0 ? `up ${plural(value, "unit")} in ${period}` : `no change in ${period}`;
    }
    case "decreasesPerDay":
      return `uses about ${round1(value)} units a day`;
    case "increasesPerDay":
      return value > 0
        ? `refilled about ${round1(value)} units a day`
        : "no refills in the past week";
    case "daysOfSupply":
      return `about ${round1(value)} days of supply at recent use`;
    case "bankUsePerDay":
      return `the bank uses about ${round1(value)} units a day`;
    case "updates24h":
      return `${plural(value, "update")} in 24 hours`;
    case "updatesPerDay":
      return `updates about ${round1(value)} times a day`;
    case "hoursSinceUpdate":
      return `last updated ${Math.round(value)} hours ago`;
    case "autoRefresh":
      return value ? "stock refreshed automatically" : "stock entered by hand";
    case "ownership":
      return "the kind of bank it is";
    case "stateCode":
      return "how banks in its state run";
    case "bloodGroup":
      return `${value} runs short more often`;
    case "rhNegative":
      return value ? "an Rh-negative group, held in small numbers" : "an Rh-positive group";
    default:
      return input;
  }
}

// ── calibration ──────────────────────────────────────────────────────────────

/**
 * Platt scaling: the a and b for which sigmoid(a · score + b) best fits the labels,
 * with Platt's smoothed targets, by Newton's method with a backtracking line search
 * (Lin, Lin and Weng, 2007). scikit-learn's sigmoid calibration fits the same loss,
 * and its A and B are −a and −b; tests/stockout-model.test.js checks the two agree.
 * scores are the raw logits; labels are true or false.
 */
export function fitPlatt(scores, labels, { maxIterations = 100 } = {}) {
  const n = scores.length;
  if (n === 0 || labels.length !== n) throw new Error("fitPlatt needs matching, non-empty lists");
  let positives = 0;
  for (const label of labels) if (label) positives += 1;
  const negatives = n - positives;
  const highTarget = (positives + 1) / (positives + 2);
  const lowTarget = 1 / (negatives + 2);
  const targets = labels.map((label) => (label ? highTarget : lowTarget));

  // Platt's notation: P = 1 / (1 + exp(A·f + B)).
  let A = 0;
  let B = Math.log((negatives + 1) / (positives + 1));
  const objective = (a, b) => {
    let total = 0;
    for (let index = 0; index < n; index += 1) {
      const fApB = scores[index] * a + b;
      total +=
        fApB >= 0
          ? targets[index] * fApB + Math.log1p(Math.exp(-fApB))
          : (targets[index] - 1) * fApB + Math.log1p(Math.exp(fApB));
    }
    return total;
  };
  let value = objective(A, B);
  let iterations = 0;
  let isConverged = false;
  const sigma = 1e-12; // keeps the Hessian positive definite
  for (; iterations < maxIterations; iterations += 1) {
    let h11 = sigma;
    let h22 = sigma;
    let h21 = 0;
    let g1 = 0;
    let g2 = 0;
    for (let index = 0; index < n; index += 1) {
      const fApB = scores[index] * A + B;
      const p = fApB >= 0 ? Math.exp(-fApB) / (1 + Math.exp(-fApB)) : 1 / (1 + Math.exp(fApB));
      const q = 1 - p;
      const d2 = p * q;
      h11 += scores[index] * scores[index] * d2;
      h22 += d2;
      h21 += scores[index] * d2;
      const d1 = targets[index] - p;
      g1 += scores[index] * d1;
      g2 += d1;
    }
    if (Math.abs(g1) < 1e-9 * n && Math.abs(g2) < 1e-9 * n) {
      isConverged = true;
      break;
    }
    const det = h11 * h22 - h21 * h21;
    const dA = -(h22 * g1 - h21 * g2) / det;
    const dB = -(-h21 * g1 + h11 * g2) / det;
    const gd = g1 * dA + g2 * dB;
    let step = 1;
    let isStepped = false;
    while (step >= 1e-10) {
      const newValue = objective(A + step * dA, B + step * dB);
      if (newValue < value + 1e-4 * step * gd) {
        A += step * dA;
        B += step * dB;
        value = newValue;
        isStepped = true;
        break;
      }
      step /= 2;
    }
    // No step lowers the loss any more: the fit is at the optimum to rounding.
    if (!isStepped) {
      isConverged = true;
      break;
    }
  }
  return { a: -A, b: -B, iterations, isConverged };
}

// ── days, cut-offs and metrics ───────────────────────────────────────────────

// The India date of a time, as YYYY-MM-DD.
export function indiaDay(time) {
  const ms = typeof time === "number" ? time : Date.parse(time);
  return new Date(ms + INDIA_OFFSET_MS).toISOString().slice(0, 10);
}

// Labelled cases: [{ hospitalCode, group, day, p, outcome }], outcome true or false.
// Cases left out by the label rules (outcome null) must be removed first.
const caseKey = (entry) => `${entry.hospitalCode}|${entry.group}|${entry.day}`;
const bankDays = (cases) => {
  const banks = new Set(cases.map((entry) => entry.hospitalCode));
  const days = new Set(cases.map((entry) => entry.day));
  return { banks: banks.size, days: days.size };
};

// False alerts at a cut-off (an alert is p > cutOff), at most one per bank, group
// and day, per bank per week; and the share of stock-out cases alerted.
export function alertMetrics(cases, cutOff) {
  const falseKeys = new Set();
  let positives = 0;
  let caught = 0;
  for (const entry of cases) {
    if (entry.outcome) {
      positives += 1;
      if (entry.p > cutOff) caught += 1;
    } else if (entry.p > cutOff) {
      falseKeys.add(caseKey(entry));
    }
  }
  const { banks, days } = bankDays(cases);
  return {
    falseAlerts: falseKeys.size,
    falseAlertsPerBankWeek: banks && days ? (falseKeys.size / (banks * days)) * 7 : 0,
    recall: positives ? caught / positives : null,
  };
}

// The lowest cut-off that keeps false alerts at or under the budget per bank per
// week, counting at most one per bank, group and day (A4).
export function chooseCutOff(cases, { budget = ALERT_BUDGET } = {}) {
  const highestNegative = new Map();
  for (const entry of cases) {
    if (entry.outcome) continue;
    const key = caseKey(entry);
    highestNegative.set(key, Math.max(highestNegative.get(key) ?? -Infinity, entry.p));
  }
  const { banks, days } = bankDays(cases);
  const allowed = Math.floor((budget * banks * days) / 7);
  const sorted = [...highestNegative.values()].sort((a, b) => b - a);
  const cutOff = sorted.length > allowed ? sorted[allowed] : 0;
  return { cutOff, allowedFalseAlerts: allowed, ...alertMetrics(cases, cutOff) };
}

// Average precision, the PR-AUC the decision rule uses, computed as scikit-learn's
// average_precision_score: the sum over thresholds of (R_n − R_{n−1}) × P_n.
export function averagePrecision(scores, labels) {
  const order = scores.map((score, index) => index).sort((a, b) => scores[b] - scores[a]);
  const positives = labels.filter(Boolean).length;
  if (positives === 0) return null;
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let total = 0;
  for (let rank = 0; rank < order.length; rank += 1) {
    if (labels[order[rank]]) truePositives += 1;
    else falsePositives += 1;
    const isLastOfTie =
      rank === order.length - 1 || scores[order[rank + 1]] !== scores[order[rank]];
    if (!isLastOfTie) continue;
    const recall = truePositives / positives;
    total += (recall - previousRecall) * (truePositives / (truePositives + falsePositives));
    previousRecall = recall;
  }
  return total;
}

// Mean prediction ÷ observed rate; above 1 means the forecast predicts too many.
export function calibrationRatio(probabilities, labels) {
  const observed = labels.filter(Boolean).length;
  if (observed === 0) return null;
  const predicted = probabilities.reduce((sum, value) => sum + value, 0);
  return predicted / observed;
}

// One day's metrics for one horizon (forecast_daily_metrics), from labelled cases.
export function forecastMetrics(cases, cutOff) {
  const scores = cases.map((entry) => entry.p);
  const labels = cases.map((entry) => Boolean(entry.outcome));
  const groups = new Map();
  for (const entry of cases) {
    if (!groups.has(entry.group)) groups.set(entry.group, []);
    groups.get(entry.group).push(entry);
  }
  const liftByGroup = {};
  for (const [group, entries] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const groupLabels = entries.map((entry) => Boolean(entry.outcome));
    const baseRate = groupLabels.filter(Boolean).length / entries.length;
    const prAuc = averagePrecision(
      entries.map((entry) => entry.p),
      groupLabels,
    );
    liftByGroup[group] = {
      cases: entries.length,
      baseRate,
      prAuc,
      lift: prAuc !== null && baseRate > 0 ? prAuc / baseRate : null,
    };
  }
  const alerts = alertMetrics(cases, cutOff);
  return {
    cases: cases.length,
    positives: labels.filter(Boolean).length,
    prAuc: averagePrecision(scores, labels),
    calibrationRatio: calibrationRatio(scores, labels),
    cutOff,
    recallAtCutOff: alerts.recall,
    falseAlertsPerBankWeek: alerts.falseAlertsPerBankWeek,
    liftByGroup,
  };
}

// ── runs, the kill switch and shadow mode ────────────────────────────────────

// Whether a forecast_runs row failed: an error, or no finish long after it began.
export function isFailedRun(run, now = Date.now()) {
  if (run.error) return true;
  if (run.finished_at ?? run.finishedAt) return false;
  const started = Date.parse(run.started_at ?? run.startedAt);
  return Number.isFinite(started) && now - started > RUN_STALE_MINUTES * 60_000;
}

const inRange = (value, [low, high]) => value !== null && value >= low && value <= high;

/**
 * Whether the kill switch turns the forecast's flags off (A4), and why.
 * metrics: one horizon's forecast_daily_metrics rows, oldest first
 * ({ day, falseAlertsPerBankWeek, calibrationRatio }); runs: forecast_runs rows of
 * the scoring job, newest first.
 */
export function evaluateKillSwitch({ metrics = [], runs = [], now = Date.now() }) {
  const reasons = [];
  const recent = metrics.slice(-KILL_FALSE_ALERT_DAYS);
  if (
    recent.length === KILL_FALSE_ALERT_DAYS &&
    recent.every((row) => row.falseAlertsPerBankWeek > KILL_FALSE_ALERTS)
  ) {
    reasons.push(
      `false alerts above ${KILL_FALSE_ALERTS} per bank per week for ${KILL_FALSE_ALERT_DAYS} days`,
    );
  }
  const latest = metrics.at(-1);
  if (
    latest &&
    latest.calibrationRatio !== null &&
    !inRange(latest.calibrationRatio, CALIBRATION_RANGE)
  ) {
    reasons.push(
      `calibration ratio ${round2(latest.calibrationRatio)} outside ${CALIBRATION_RANGE.join(" to ")}`,
    );
  }
  const latestRuns = runs.slice(0, KILL_FAILED_RUNS);
  if (latestRuns.length === KILL_FAILED_RUNS && latestRuns.every((run) => isFailedRun(run, now))) {
    reasons.push(`the last ${KILL_FAILED_RUNS} runs failed`);
  }
  return { shouldStop: reasons.length > 0, reasons };
}

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Whether two weeks of shadow mode may end (A7), and what still holds it back.
 * metrics: the 48-hour rows of the latest day, or of every shadow day, oldest first;
 * runs: the scoring job's runs, newest first; isParityPassed: the parity test's result.
 */
export function evaluateShadowExit({ metrics = [], runs = [], isParityPassed, now = Date.now() }) {
  const blockers = [];
  const latest = metrics.at(-1);
  if (!latest) blockers.push("no daily metrics yet");
  else {
    if (!inRange(latest.calibrationRatio, CALIBRATION_RANGE)) {
      blockers.push(`calibration ratio not within ${CALIBRATION_RANGE.join(" to ")}`);
    }
    if (!(latest.falseAlertsPerBankWeek <= SHADOW_FALSE_ALERTS)) {
      blockers.push(`false alerts above ${SHADOW_FALSE_ALERTS} per bank per week`);
    }
  }
  if (!isParityPassed) blockers.push("the parity test hasn't passed");
  const since = now - SHADOW_CLEAN_DAYS * 24 * HOUR_MS;
  const window = runs.filter((run) => Date.parse(run.started_at ?? run.startedAt) >= since);
  if (window.length === 0) blockers.push(`no runs in the last ${SHADOW_CLEAN_DAYS} days`);
  else if (window.some((run) => isFailedRun(run, now))) {
    blockers.push(`a run failed in the last ${SHADOW_CLEAN_DAYS} days`);
  }
  return { canExit: blockers.length === 0, blockers };
}

// The admin overview's warning: no scoring run has finished for FORECAST_OVERDUE_HOURS.
export function forecastOverdue(lastFinishedAt, now = Date.now()) {
  const finished = lastFinishedAt ? Date.parse(lastFinishedAt) : NaN;
  const hoursSince = Number.isFinite(finished) ? (now - finished) / HOUR_MS : null;
  return {
    isOverdue: hoursSince === null || hoursSince > FORECAST_OVERDUE_HOURS,
    hoursSince,
    limitHours: FORECAST_OVERDUE_HOURS,
  };
}
