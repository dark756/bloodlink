import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUP_CODES, createForecastJobs, parseForecastRequest } from "@/lib/forecastJobs";
import { INPUT_NAMES } from "@/lib/stockoutFeatures";
import week from "./fixtures/stockout_week.json";

// The score-stock jobs (src/lib/forecastJobs.js) against a stand-in for the pg
// session that serves the parity fixture's real week. The stand-in applies the
// history query's window as the SQL does, so these tests also show that reading 8
// days plus each bank's two earlier updates gives the inputs training used.

const artifact = JSON.parse(fs.readFileSync(new URL(`../${week.artifact}`, import.meta.url)));
const MODEL = {
  id: artifact.id,
  artifact_path: `${artifact.id}.json`,
  artifact_sha256: "0".repeat(64),
  evaluation: artifact.evaluation,
};
const HOUR = 3_600_000;
const historyRows = week.events.map((event) => ({
  hospital_code: event.hospitalCode,
  entry_at: new Date(event.entryAt),
  state_code: week.banks[event.hospitalCode].stateCode,
  stock: event.stock,
}));
const bankRows = Object.entries(week.banks).map(([code, bank]) => ({
  hospital_code: code,
  hospital_type: bank.hospitalType,
  auto_refresh: bank.autoRefresh,
}));
const groupByCode = Object.fromEntries(
  Object.entries(GROUP_CODES).map(([name, code]) => [code, name]),
);

// Rows in (from, to], plus each bank's last two at or before from: HISTORY_SQL.
function historyWindow(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  const inside = historyRows.filter((row) => row.entry_at > start && row.entry_at <= end);
  const earlier = new Map();
  for (const row of historyRows) {
    if (row.entry_at > start) continue;
    const list = earlier.get(row.hospital_code) ?? [];
    list.push(row);
    earlier.set(row.hospital_code, list);
  }
  const before = [...earlier.values()].flatMap((list) =>
    list.sort((a, b) => b.entry_at - a.entry_at).slice(0, 2),
  );
  return [...inside, ...before];
}

function fakeDb(answers = {}) {
  const queries = [];
  return {
    queries,
    statements: (pattern) => queries.filter(({ text }) => pattern.test(text)),
    async query(text, params = []) {
      queries.push({ text, params });
      for (const [pattern, answer] of answers.overrides ?? []) {
        if (pattern.test(text))
          return { rows: typeof answer === "function" ? answer(params) : answer };
      }
      if (/from public\.model_versions/.test(text)) return { rows: answers.models ?? [MODEL] };
      if (/insert into public\.forecast_runs/.test(text)) return { rows: [{ id: 41 }] };
      if (/from public\.stock_history/.test(text))
        return { rows: historyWindow(params[0], params[1]) };
      if (/from public\.blood_banks/.test(text)) return { rows: bankRows };
      return { rows: [] };
    },
  };
}

const jobsWith = (db, clock = () => Date.parse(week.dataEnd)) =>
  createForecastJobs({ db, loadArtifact: async () => artifact, clock });

// The fixture's cases at one grid time, by bank and group.
const expectedAt = (gridIndex) =>
  new Map(
    week.cases
      .filter((entry) => entry[2] === gridIndex)
      .map((entry) => [`${entry[0]}|${entry[1]}`, entry]),
  );

describe("the request", () => {
  it("takes a score or daily job, with an optional grid time", () => {
    expect(parseForecastRequest({ job: "score" })).toEqual({ job: "score", asOf: null });
    expect(parseForecastRequest({ job: "daily", asOf: "2026-11-04T00:30:00Z" })).toEqual({
      job: "daily",
      asOf: Date.parse("2026-11-04T00:30:00Z"),
    });
    expect(parseForecastRequest({ job: "train" }).error).toMatch(/score or daily/);
    expect(parseForecastRequest(null).error).toMatch(/object/);
    expect(parseForecastRequest({ job: "score", asOf: "soon" }).error).toMatch(/ISO/);
  });
});

describe("scoring a grid time", () => {
  it("scores the same cases as the parity fixture, with its probabilities", async () => {
    const db = fakeDb();
    const gridIndex = week.gridTimes.length - 1;
    // Five minutes after the grid time, as the cron job runs.
    const clock = () => Date.parse(week.gridTimes[gridIndex]) + 5 * 60_000;
    const result = await jobsWith(db, clock).score();
    const expected = expectedAt(gridIndex);
    expect(result).toMatchObject({ rowsScored: expected.size, calibration: "artifact" });

    const insert = db.statements(/insert into public\.stock_forecasts/);
    const params = insert.flatMap(({ params: values }) => values);
    expect(params.length).toBe(expected.size * 8);
    let largest = 0;
    for (let start = 0; start < params.length; start += 8) {
      const [code, component, groupCode, asOf, model, pRaw, p, reasons] = params.slice(
        start,
        start + 8,
      );
      const entry = expected.get(`${code}|${groupByCode[groupCode]}`);
      expect(entry).toBeDefined();
      expect([component, asOf, model]).toEqual(["12", week.gridTimes[gridIndex], artifact.id]);
      for (let index = 0; index < 3; index += 1) {
        largest = Math.max(
          largest,
          Math.abs(pRaw[index] - entry[5][index]),
          Math.abs(p[index] - entry[6][index]),
        );
      }
      expect(JSON.parse(reasons).length).toBeLessThanOrEqual(3);
    }
    expect(largest).toBeLessThan(5e-7);
    expect(db.statements(/^commit$/)).toHaveLength(1);
    const finish = db.statements(/update public\.forecast_runs/)[0];
    expect(finish.params[1]).toBe(expected.size);
    expect(finish.params[3]).toBeNull();
  });

  it("uses the daily job's latest calibration when there is one", async () => {
    const db = fakeDb({
      overrides: [
        [/from public\.forecast_daily_metrics/, [{ horizon_h: 48, platt_a: 2, platt_b: -1 }]],
      ],
    });
    const gridIndex = week.gridTimes.length - 1;
    await jobsWith(db, () => Date.parse(week.gridTimes[gridIndex])).score();
    const values = db.statements(/insert into public\.stock_forecasts/)[0].params;
    const [pRaw, p] = [values[5], values[6]];
    const logit48 = Math.log(pRaw[1] / (1 - pRaw[1]));
    expect(p[1]).toBeCloseTo(1 / (1 + Math.exp(-(2 * logit48 - 1))), 6);
    expect(p[0]).not.toBeCloseTo(pRaw[0], 9); // 24 h keeps the artifact's own calibration
  });

  it("skips a grid time already scored, and records why", async () => {
    const db = fakeDb({ overrides: [[/select 1 from public\.stock_forecasts/, [{}]]] });
    const result = await jobsWith(db).score();
    expect(result).toMatchObject({ rowsScored: 0, skipped: expect.stringMatching(/already/) });
    expect(db.statements(/insert into public\.stock_forecasts/)).toHaveLength(0);
  });

  it("refuses to score without a live model, or with an artifact that isn't it", async () => {
    await expect(jobsWith(fakeDb({ models: [] })).score()).rejects.toThrow(/no live model/);
    const other = fakeDb({ models: [{ ...MODEL, id: "stockout-logit-other" }] });
    await expect(jobsWith(other).score()).rejects.toThrow(/the artifact is/);
  });

  it("records a failed run and rolls the inserts back", async () => {
    const db = fakeDb({
      overrides: [
        [
          /insert into public\.stock_forecasts/,
          () => {
            throw new Error("disk full");
          },
        ],
      ],
    });
    await expect(jobsWith(db).score()).rejects.toThrow(/disk full/);
    expect(db.statements(/^rollback$/)).toHaveLength(1);
    expect(db.statements(/update public\.forecast_runs/)[0].params[3]).toBe("disk full");
  });
});

describe("the daily job", () => {
  const dataEnd = week.dataEnd;
  // A grid time whose 72-hour window has closed.
  const gridIndex = week.gridTimes.findIndex(
    (time) => Date.parse(time) + 72 * HOUR <= Date.parse(dataEnd),
  );

  it("labels a scored grid time once its 72 hours have closed, as the fixture does", async () => {
    const expected = expectedAt(gridIndex);
    const scored = [...expected.values()].map((entry) => ({
      hospital_code: entry[0],
      blood_group_code: GROUP_CODES[entry[1]],
    }));
    const db = fakeDb({
      overrides: [
        [/from public\.collector_runs/, [{ started_at: new Date(dataEnd) }]],
        [/select distinct f\.as_of/, [{ as_of: new Date(week.gridTimes[gridIndex]) }]],
        [/select hospital_code, blood_group_code from public\.stock_forecasts/, scored],
        [/prune_forecasts/, [{ result: { forecasts_deleted: 0 } }]],
      ],
    });
    const result = await jobsWith(db).daily();
    expect(result.labelled).toEqual([week.gridTimes[gridIndex]]);
    const values = db
      .statements(/insert into public\.forecast_outcomes/)
      .flatMap(({ params }) => params);
    expect(values.length).toBe(expected.size * 5);
    for (let start = 0; start < values.length; start += 5) {
      const [code, , groupCode, , labels] = values.slice(start, start + 5);
      expect(labels).toEqual(expected.get(`${code}|${groupByCode[groupCode]}`)[4]);
    }
    expect(result.day).toBeNull();
    expect(result.killSwitch.shouldStop).toBe(false);
  });

  it("calibrates a fully labelled day, records how the scores in force did, and runs the kill switch", async () => {
    const day = "2026-11-01";
    const start = Date.parse(`${day}T00:00:00+05:30`);
    // 40 cases a grid time over 10 banks: the riskier half falls low at 48 h.
    const rows = [];
    for (let slot = 0; slot < 4; slot += 1) {
      for (let index = 0; index < 40; index += 1) {
        const risk = 0.05 + (index % 20) * 0.04;
        rows.push({
          hospital_code: String(1000 + (index % 10)),
          blood_group_code: index < 20 ? "15" : "16",
          as_of: new Date(start + slot * 6 * HOUR),
          p_raw: [risk / 2, risk, Math.min(0.99, risk * 1.5)],
          p: [risk / 2, risk, Math.min(0.99, risk * 1.5)],
          stockout: [index % 20 >= 17, index % 20 >= 10, index % 20 >= 5],
        });
      }
    }
    const db = fakeDb({
      overrides: [
        [/from public\.collector_runs/, [{ started_at: new Date(dataEnd) }]],
        [/with days as/, [{ day }]],
        [/join public\.forecast_outcomes o using/, rows],
        [
          /select day, false_alerts_per_bank_week, calibration_ratio/,
          [
            { day: "2026-11-01", false_alerts_per_bank_week: 1.8, calibration_ratio: 1.6 },
            { day: "2026-10-31", false_alerts_per_bank_week: 1.7, calibration_ratio: 1.0 },
            { day: "2026-10-30", false_alerts_per_bank_week: 1.6, calibration_ratio: 1.0 },
          ],
        ],
        [/stop_forecast_flags/, [{ stopped: 2 }]],
        [/prune_forecasts/, [{ result: { forecasts_deleted: 0 } }]],
      ],
    });
    const result = await jobsWith(db).daily();
    expect(result.day).toBe(day);
    const metricRows = db.statements(/insert into public\.forecast_daily_metrics/);
    expect(metricRows.map(({ params }) => params[1])).toEqual([24, 48, 72]);
    const [, , model, cases, positives, prAuc, ratio, a, b, cutOff] = metricRows[1].params;
    expect([model, cases, positives]).toEqual([artifact.id, 160, 80]);
    expect(prAuc).toBeGreaterThan(0.9);
    expect(ratio).toBeCloseTo(rows.reduce((sum, row) => sum + row.p[1], 0) / 80, 9);
    expect(a).toBeGreaterThan(0);
    expect(Number.isFinite(b)).toBe(true);
    expect(cutOff).toBeGreaterThanOrEqual(0);
    expect(cutOff).toBeLessThanOrEqual(1);
    // Three days over 1.5 false alerts, and a ratio outside 0.8 to 1.25: stop.
    expect(result.killSwitch).toMatchObject({ shouldStop: true, flagsStopped: 2 });
    expect(db.statements(/stop_forecast_flags/)[0].params[0]).toMatch(
      /false alerts.*calibration ratio/,
    );
  });

  it("fails, and says so, before the first complete cloud sweep", async () => {
    const db = fakeDb();
    await expect(jobsWith(db).daily()).rejects.toThrow(/no complete cloud sweep/);
    expect(db.statements(/update public\.forecast_runs/)[0].params[3]).toMatch(
      /no complete cloud sweep/,
    );
  });
});

it("keeps the inputs in the artifact's order", () => {
  expect(artifact.inputs).toEqual(INPUT_NAMES);
});
