import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  HORIZONS_H,
  INPUT_NAMES,
  buildCases,
  labelCase,
  seriesFromHistory,
} from "@/lib/stockoutFeatures";
import { scoreCase, thresholdOf, validateArtifact } from "@/lib/stockoutModel";
import week from "./fixtures/stockout_week.json";

// The parity test (docs/PLANS/ML_system.md, A2): on a real week of history, the
// Python dataset builder (ml/dataset.py) and stockoutFeatures.js build the same
// inputs and labels, and scikit-learn and stockoutModel.js give the same
// probabilities to 6 decimal places. ml/train.py writes the fixture and the artifact
// together; a model whose parity test fails is never promoted.

const artifact = JSON.parse(fs.readFileSync(new URL(`../${week.artifact}`, import.meta.url)));
const series = seriesFromHistory(week.events);
const banks = new Map(Object.entries(week.banks));
// The low-stock threshold the model predicts, which decides the cases and labels.
const threshold = thresholdOf(artifact);
const key = (code, group, gridIndex) => `${code}|${group}|${gridIndex}`;
const expected = new Map(week.cases.map((entry) => [key(entry[0], entry[1], entry[2]), entry]));

// Every case stockoutFeatures.js builds at each of the week's grid times.
const built = week.gridTimes.flatMap((asOf, gridIndex) =>
  buildCases({ series, banks, asOf, threshold }).map((entry) => ({ ...entry, gridIndex })),
);

describe("parity with the Python side on a real week", () => {
  it("is the artifact the fixture was made with, and a valid one", () => {
    expect(artifact.id).toBe(week.artifactId);
    expect(validateArtifact(artifact)).toEqual({ artifact });
    expect(week.inputNames).toEqual(INPUT_NAMES);
    expect(week.horizons).toEqual(HORIZONS_H);
    expect(week.thresholdUnits).toBe(threshold);
    expect(week.gridTimes).toHaveLength(28);
  });

  it("scores the same cases: every bank, group and grid time", () => {
    expect(built.length).toBe(week.cases.length);
    const keys = built.map((entry) => key(entry.hospitalCode, entry.group, entry.gridIndex));
    expect(new Set(keys)).toEqual(new Set(expected.keys()));
  });

  it("builds the same 19 inputs, exactly", () => {
    const mismatches = [];
    for (const entry of built) {
      const want = expected.get(key(entry.hospitalCode, entry.group, entry.gridIndex))[3];
      INPUT_NAMES.forEach((name, index) => {
        if (entry.inputs[name] !== want[index]) {
          mismatches.push(`${entry.hospitalCode} ${entry.group} ${entry.gridIndex} ${name}`);
        }
      });
    }
    expect(mismatches).toEqual([]);
  });

  it("labels each case the same way at 24, 48 and 72 hours", () => {
    const dataEnd = Date.parse(week.dataEnd);
    const mismatches = built.filter((entry) => {
      const want = expected.get(key(entry.hospitalCode, entry.group, entry.gridIndex))[4];
      const got = labelCase({
        events: series.get(entry.hospitalCode),
        group: entry.group,
        asOf: entry.asOf,
        dataEnd,
        threshold,
      });
      return JSON.stringify(got) !== JSON.stringify(want);
    });
    expect(mismatches).toEqual([]);
  });

  it("gives scikit-learn's probabilities to 6 decimal places, raw and calibrated", () => {
    let largest = 0;
    for (const entry of built) {
      const [, , , , , pRaw, p] = expected.get(
        key(entry.hospitalCode, entry.group, entry.gridIndex),
      );
      const score = scoreCase(artifact, entry.inputs);
      HORIZONS_H.forEach((hours, index) => {
        largest = Math.max(
          largest,
          Math.abs(score.pRaw[index] - pRaw[index]),
          Math.abs(score.p[index] - p[index]),
        );
      });
    }
    expect(largest).toBeLessThan(5e-7);
  });

  it("covers the cases that differ: stock-outs, left-out labels and every kind of owner", () => {
    const labels = week.cases.flatMap((entry) => entry[4]);
    expect(labels.filter((label) => label === true).length).toBeGreaterThan(20);
    expect(labels.filter((label) => label === null).length).toBeGreaterThan(20);
    const owners = new Set(week.cases.map((entry) => entry[3][INPUT_NAMES.indexOf("ownership")]));
    expect(owners).toEqual(new Set(["govt", "private", "charitable", "red_cross", "other"]));
    expect(week.cases.some((entry) => entry[3][INPUT_NAMES.indexOf("autoRefresh")] === 1)).toBe(
      true,
    );
  });
});
