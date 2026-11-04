import { describe, expect, it } from "vitest";
import {
  ARTIFACT_FORMAT,
  alertMetrics,
  averagePrecision,
  calibrationRatio,
  chooseCutOff,
  evaluateKillSwitch,
  evaluateShadowExit,
  fitPlatt,
  forecastMetrics,
  forecastOverdue,
  indiaDay,
  isFailedRun,
  scoreCase,
  sigmoid,
  termValue,
  validateArtifact,
  withCalibration,
} from "@/lib/stockoutModel";
import sklearn from "./fixtures/stockout_sklearn.json";

const HOUR = 3_600_000;
const NOW = Date.parse("2026-11-04T07:00:00Z");

const horizon = (intercept, platt = { a: 1, b: 0 }) => ({
  intercept,
  terms: [
    { input: "units", transform: "log1p", mean: 1, scale: 2, coef: -0.8 },
    { input: "zeroDropsPerDay", transform: "identity", mean: 0.1, scale: 0.2, coef: 0.5 },
    { input: "change24h", transform: "slog", mean: 0, scale: 1, coef: -0.3 },
    { input: "rhNegative", transform: "identity", mean: 0, scale: 1, coef: 0.4 },
    { input: "stateCode", transform: "dummy", level: "27", coef: 0.2 },
  ],
  platt,
});
const artifact = {
  format: ARTIFACT_FORMAT,
  id: "stockout-logit-test",
  kind: "logistic",
  component: "PRBC",
  horizons: { 24: horizon(-3), 48: horizon(-2.5, { a: 0.8, b: -0.2 }), 72: horizon(-2) },
};
const inputs = {
  units: 2,
  zeroDropsPerDay: 0.3,
  change24h: -3,
  rhNegative: 1,
  stateCode: "27",
};

describe("the model artifact", () => {
  it("accepts a well-formed logistic artifact", () => {
    expect(validateArtifact(artifact)).toEqual({ artifact });
  });

  it("refuses artifacts it can't score", () => {
    const broken = (change) => validateArtifact({ ...artifact, ...change }).error;
    expect(broken({ format: "other/1" })).toMatch(/format/);
    expect(broken({ kind: "gbm" })).toMatch(/logistic/);
    expect(broken({ id: "Bad Name" })).toMatch(/id/);
    expect(broken({ horizons: { 24: horizon(-3), 48: horizon(-2) } })).toMatch(/horizon 72/);
    const term = (change) => {
      const bad = horizon(-3);
      bad.terms[0] = { ...bad.terms[0], ...change };
      return broken({ horizons: { ...artifact.horizons, 48: bad } });
    };
    expect(term({ input: "weekday" })).toMatch(/unknown input/);
    expect(term({ transform: "sqrt" })).toMatch(/transform/);
    expect(term({ scale: 0 })).toMatch(/scale/);
    expect(term({ input: "ownership" })).toMatch(/needs a dummy/);
    expect(term({ transform: "dummy" })).toMatch(/level/);
  });

  it("applies each transform, then standardizes", () => {
    const [units, drops, change, , state] = artifact.horizons[24].terms;
    expect(termValue(units, inputs)).toBeCloseTo((Math.log(3) - 1) / 2, 12);
    expect(termValue(drops, inputs)).toBeCloseTo(1, 12);
    expect(termValue(change, inputs)).toBeCloseTo(-Math.log(4), 12);
    expect(termValue(state, inputs)).toBe(1);
    expect(termValue(state, { stateCode: "30" })).toBe(0);
    expect(() => termValue(units, {})).toThrow(/not a number/);
  });

  it("scores each horizon as a dot product, then calibrates it", () => {
    const logit24 =
      -3 + -0.8 * ((Math.log(3) - 1) / 2) + 0.5 * 1 + -0.3 * -Math.log(4) + 0.4 * 1 + 0.2 * 1;
    const score = scoreCase(artifact, inputs);
    expect(score.logits[0]).toBeCloseTo(logit24, 12);
    expect(score.pRaw[0]).toBeCloseTo(sigmoid(logit24), 12);
    expect(score.p[0]).toBeCloseTo(sigmoid(logit24), 12);
    expect(score.p[1]).toBeCloseTo(sigmoid(0.8 * (logit24 + 0.5) - 0.2), 12);
    expect(score.pRaw[2]).toBeGreaterThan(score.pRaw[1]);
  });

  it("gives the three inputs pushing the risk up most, in words", () => {
    const { reasons } = scoreCase(artifact, inputs);
    expect(reasons.map((reason) => reason.input)).toEqual([
      "zeroDropsPerDay",
      "change24h",
      "rhNegative",
    ]);
    expect(reasons.map((reason) => reason.text)).toEqual([
      "ran out of this group in the past week",
      "down 3 units in 24 hours",
      "an Rh-negative group, held in small numbers",
    ]);
  });

  it("swaps in a day's calibration without touching the rest", () => {
    const calibrated = withCalibration(artifact, { 48: { a: 0.5, b: 0.1, iterations: 4 } });
    expect(calibrated.horizons[48].platt).toEqual({ a: 0.5, b: 0.1 });
    expect(calibrated.horizons[48].terms).toBe(artifact.horizons[48].terms);
    expect(calibrated.horizons[24]).toBe(artifact.horizons[24]);
    expect(artifact.horizons[48].platt).toEqual({ a: 0.8, b: -0.2 });
  });
});

describe("parity with scikit-learn", () => {
  it.each(sklearn.cases.map((entry) => [entry.name, entry]))(
    "fits the same Platt scaling as scikit-learn (%s)",
    (name, entry) => {
      const fit = fitPlatt(
        entry.scores,
        entry.labels.map((label) => label === 1),
      );
      expect(fit.isConverged).toBe(true);
      expect(fit.a).toBeCloseTo(-entry.platt.A, 6);
      expect(fit.b).toBeCloseTo(-entry.platt.B, 6);
      entry.probe.forEach((score, index) => {
        expect(Math.abs(sigmoid(fit.a * score + fit.b) - entry.calibrated[index])).toBeLessThan(
          1e-7,
        );
      });
    },
  );

  it.each(sklearn.cases.map((entry) => [entry.name, entry]))(
    "computes average precision as scikit-learn does (%s)",
    (name, entry) => {
      const labels = entry.labels.map((label) => label === 1);
      expect(averagePrecision(entry.scores, labels)).toBeCloseTo(entry.averagePrecision, 12);
    },
  );

  it("records the library versions the fixtures came from", () => {
    expect(sklearn).toMatchObject({ generatedBy: "ml/make_parity_fixtures.py", sklearn: "1.9.1" });
  });
});

describe("calibration and metrics", () => {
  it("leaves a calibrated score alone", () => {
    // Labels drawn so the chance is exactly sigmoid(score), in proportion.
    const scores = [];
    const labels = [];
    for (let step = -40; step <= 40; step += 1) {
      const score = step / 10;
      const positives = Math.round(sigmoid(score) * 200);
      for (let index = 0; index < 200; index += 1) {
        scores.push(score);
        labels.push(index < positives);
      }
    }
    const fit = fitPlatt(scores, labels);
    expect(fit.a).toBeCloseTo(1, 2);
    expect(fit.b).toBeCloseTo(0, 2);
  });

  it("refuses empty or mismatched lists", () => {
    expect(() => fitPlatt([], [])).toThrow();
    expect(() => fitPlatt([1, 2], [true])).toThrow();
  });

  it("returns no PR-AUC or calibration ratio without a stock-out", () => {
    expect(averagePrecision([0.1, 0.2], [false, false])).toBeNull();
    expect(calibrationRatio([0.1, 0.2], [false, false])).toBeNull();
    expect(calibrationRatio([0.25, 0.25, 0.5, 0.5], [true, false, false, false])).toBe(1.5);
  });

  it("dates cases by India's day", () => {
    expect(indiaDay("2026-11-03T18:29:00Z")).toBe("2026-11-03");
    expect(indiaDay(Date.parse("2026-11-03T18:30:00Z"))).toBe("2026-11-04");
  });
});

describe("the alert cut-off", () => {
  // 14 banks on one day: a budget of 1 false alert per bank per week allows 2.
  const cases = [];
  for (let bank = 1; bank <= 14; bank += 1) {
    cases.push({ hospitalCode: `${bank}`, group: "O-Ve", day: "2026-11-04", p: bank / 100 });
  }
  cases.forEach((entry) => (entry.outcome = Number(entry.hospitalCode) % 5 === 0));
  // A second negative case for bank 14's group that day counts once.
  cases.push({ hospitalCode: "14", group: "O-Ve", day: "2026-11-04", p: 0.135, outcome: false });

  it("picks the lowest cut-off within the budget, counting one alert per bank, group and day", () => {
    const chosen = chooseCutOff(cases);
    // Negatives from the top: 0.14 (bank 14), 0.13, 0.12; 0.10 is a stock-out.
    expect(chosen).toMatchObject({ allowedFalseAlerts: 2, cutOff: 0.12, falseAlerts: 2 });
    expect(chosen.falseAlertsPerBankWeek).toBeCloseTo(1, 12);
    expect(chosen.recall).toBe(0);
  });

  it("alerts above the cut-off only, and reports recall", () => {
    expect(alertMetrics(cases, 0.095)).toMatchObject({ falseAlerts: 4, recall: 1 / 2 });
    expect(alertMetrics(cases, 0)).toMatchObject({ falseAlerts: 12, recall: 1 });
  });

  it("alerts on everything when every negative fits in the budget", () => {
    expect(
      chooseCutOff(cases.slice(0, 3).concat({ ...cases[4], outcome: true }), { budget: 7 }).cutOff,
    ).toBe(0);
  });

  it("reports a day's metrics with lift by group", () => {
    const metrics = forecastMetrics(
      [
        { hospitalCode: "1", group: "O-Ve", day: "d", p: 0.9, outcome: true },
        { hospitalCode: "2", group: "O-Ve", day: "d", p: 0.1, outcome: false },
        { hospitalCode: "1", group: "A+Ve", day: "d", p: 0.2, outcome: false },
        { hospitalCode: "2", group: "A+Ve", day: "d", p: 0.4, outcome: true },
      ],
      0.3,
    );
    expect(metrics).toMatchObject({
      cases: 4,
      positives: 2,
      prAuc: 1,
      calibrationRatio: 0.8,
      cutOff: 0.3,
      recallAtCutOff: 1,
      falseAlertsPerBankWeek: 0,
    });
    expect(Object.keys(metrics.liftByGroup)).toEqual(["A+Ve", "O-Ve"]);
    expect(metrics.liftByGroup["O-Ve"]).toEqual({ cases: 2, baseRate: 0.5, prAuc: 1, lift: 2 });
  });
});

describe("the kill switch and shadow mode", () => {
  const day = (falseAlertsPerBankWeek, calibrationRatio = 1) => ({
    falseAlertsPerBankWeek,
    calibrationRatio,
  });
  const run = (hoursAgo, error = null, finished = true) => ({
    started_at: new Date(NOW - hoursAgo * HOUR).toISOString(),
    finished_at: finished ? new Date(NOW - hoursAgo * HOUR + 60_000).toISOString() : null,
    error,
  });

  it("stops after three days of too many false alerts, not two", () => {
    expect(evaluateKillSwitch({ metrics: [day(1), day(1.6), day(1.7)] }).shouldStop).toBe(false);
    const stop = evaluateKillSwitch({ metrics: [day(1.6), day(1.6), day(1.7)] });
    expect(stop).toEqual({
      shouldStop: true,
      reasons: ["false alerts above 1.5 per bank per week for 3 days"],
    });
  });

  it("stops when calibration drifts out of 0.8 to 1.25", () => {
    expect(evaluateKillSwitch({ metrics: [day(1, 1.25)] }).shouldStop).toBe(false);
    expect(evaluateKillSwitch({ metrics: [day(1, 1.3)] }).reasons).toEqual([
      "calibration ratio 1.3 outside 0.8 to 1.25",
    ]);
    expect(evaluateKillSwitch({ metrics: [day(1, 0.7)] }).shouldStop).toBe(true);
    expect(evaluateKillSwitch({ metrics: [day(1, null)] }).shouldStop).toBe(false);
  });

  it("stops when the last two runs failed, counting a run that never finished", () => {
    expect(isFailedRun(run(1, null, false), NOW)).toBe(true);
    expect(isFailedRun(run(0.1, null, false), NOW)).toBe(false);
    const runs = (...list) => evaluateKillSwitch({ runs: list, now: NOW }).shouldStop;
    expect(runs(run(1, "boom"), run(7, null))).toBe(false);
    expect(runs(run(1, "boom"), run(7, null, false))).toBe(true);
  });

  it("lets shadow mode end only when every exit condition holds", () => {
    const runs = [run(1), run(7), run(30), run(100)];
    expect(
      evaluateShadowExit({ metrics: [day(1.1)], runs, isParityPassed: true, now: NOW }),
    ).toEqual({ canExit: true, blockers: [] });
    expect(
      evaluateShadowExit({
        metrics: [day(1.3, 1.3)],
        runs: [run(1), run(150, "boom"), run(170, "boom")],
        isParityPassed: false,
        now: NOW,
      }).blockers,
    ).toEqual([
      "calibration ratio not within 0.8 to 1.25",
      "false alerts above 1.2 per bank per week",
      "the parity test hasn't passed",
      "a run failed in the last 7 days",
    ]);
    expect(evaluateShadowExit({ isParityPassed: true, now: NOW }).blockers).toEqual([
      "no daily metrics yet",
      "no runs in the last 7 days",
    ]);
  });

  it("warns when no scoring run has finished for 7 hours", () => {
    expect(forecastOverdue(new Date(NOW - 6 * HOUR).toISOString(), NOW).isOverdue).toBe(false);
    expect(forecastOverdue(new Date(NOW - 8 * HOUR).toISOString(), NOW).isOverdue).toBe(true);
    expect(forecastOverdue(null, NOW)).toEqual({
      isOverdue: true,
      hoursSince: null,
      limitHours: 7,
    });
  });
});
