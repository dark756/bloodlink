import { describe, expect, it } from "vitest";
import {
  ARCHIVE_VERSION,
  collectionOverdue,
  intervalHours,
  STATE_BATCHES,
  createCollector,
  isCollectorSecret,
  parseCollectorRequest,
} from "@/lib/collector";
import districtData from "../assets/district_data.json";
import stateBoundaries from "../assets/state_boundaries.json";

const NOW = Date.parse("2026-11-03T06:30:00Z");
const stockRow = (hospitalCode, entrydate, quantities = "O +ve : 3") => ({
  hospitalCode,
  hospitalname: `Bank ${hospitalCode},`,
  entrydate,
  components: { "Packed Red Blood Cells": { available_WithQty: quantities } },
});

// A stand-in for the pg session: records every statement and answers the few
// reads the collector makes. failOn makes a matching statement throw.
function fakeDb({ previous = {}, directory = [], recentRun = false, failOn = null } = {}) {
  const queries = [];
  return {
    queries,
    statements: (pattern) => queries.filter(({ text }) => pattern.test(text)),
    async query(text, params = []) {
      queries.push({ text, params });
      if (failOn?.test(text)) throw new Error("simulated write failure");
      if (/from public\.blood_banks/.test(text)) return { rows: directory };
      if (/from public\.bank_stock_latest/.test(text)) {
        const rows = Object.entries(previous[params[0]] ?? {}).map(([code, entryAt]) => ({
          hospital_code: code,
          entry_at: entryAt ? new Date(entryAt) : null,
        }));
        return { rows };
      }
      if (/select 1 from public\.collector_runs/.test(text)) return { rows: recentRun ? [{}] : [] };
      if (/insert into public\.collector_runs/.test(text)) return { rows: [{ id: 7 }] };
      if (/prune_stock_store/.test(text)) return { rows: [{ result: { history_deleted: 0 } }] };
      return { rows: [] };
    },
  };
}

// A stand-in for fetch: answers by stateCode (or for the directory call), with a
// row list, an HTTP status, or a thrown network error.
function fakeFetch(answers) {
  const urls = [];
  const fetch = async (url) => {
    urls.push(url);
    const params = new URL(url).searchParams;
    const answer = answers[params.get("stateCode") ?? "nearest"];
    if (answer === "network") throw new TypeError("fetch failed");
    const status = typeof answer === "number" ? answer : 200;
    const body = typeof answer === "number" ? "error" : JSON.stringify(answer);
    return { ok: status === 200, status, text: async () => body };
  };
  return { fetch, urls };
}

function makeCollector({ db = fakeDb(), answers = {}, clock = () => NOW, ...options } = {}) {
  const archived = { history: [], sweeps: [], directory: [] };
  const errors = [];
  const { fetch, urls } = fakeFetch(answers);
  const collector = createCollector({
    db,
    fetch,
    districtData,
    stateBoundaries,
    archive: {
      history: (lines) => archived.history.push(...lines),
      sweep: (summary) => archived.sweeps.push(summary),
      directory: (data, seenAt) => archived.directory.push({ data, seenAt }),
    },
    runner: "edge",
    clock,
    sleep: async () => {},
    log: () => {},
    logError: (message) => errors.push(message),
    ...options,
  });
  return { collector, db, archived, errors, urls };
}

describe("collecting states", () => {
  it("uploads changed rows in full and only refreshes the fetch time of the rest", async () => {
    const db = fakeDb({
      previous: { 30: { 101: "2026-11-03T04:30:00.000Z", 102: "2026-11-02T04:30:00.000Z" } },
    });
    const { collector, archived } = makeCollector({
      db,
      // 101 is unchanged (10:00 India time is 04:30 UTC); 102 updated; 103 is new.
      answers: {
        30: [
          stockRow("101", "2026-11-03 10:00:00"),
          stockRow("102", "2026-11-03 09:00:00"),
          stockRow("103", "2026-11-03 08:00:00"),
        ],
      },
    });
    const outcome = await collector.collectStates(["30"]);

    expect(outcome).toMatchObject({ isSuccess: true, statesSaved: 1, rowsChanged: 2 });
    const [latest] = db.statements(/insert into public\.bank_stock_latest/);
    expect(latest.params.filter((value) => /^10[1-3]$/.test(value))).toEqual(["102", "103"]);
    const [refresh] = db.statements(/update public\.bank_stock_latest set fetched_at/);
    expect(refresh.params[1]).toEqual(["101"]);
    expect(archived.history.map((line) => line.hospitalCode)).toEqual(["102", "103"]);
    expect(archived.history[0]).toMatchObject({
      v: ARCHIVE_VERSION,
      stateCode: "30",
      entryAt: "2026-11-03T03:30:00.000Z",
      stock: { PRBC: { "O+Ve": 3 } },
    });
  });

  it("adds history only for rows with an update time", async () => {
    const { collector, db, archived } = makeCollector({
      answers: { 30: [stockRow("101", null), stockRow("102", "2026-11-03 09:00:00")] },
    });
    const outcome = await collector.collectStates(["30"]);
    expect(outcome.rowsChanged).toBe(1);
    expect(db.statements(/insert into public\.stock_history/)[0].params[0]).toBe("102");
    expect(archived.history.map((line) => line.hospitalCode)).toEqual(["102"]);
  });

  it("logs a failed state and carries on with the batch", async () => {
    const { collector, db, errors } = makeCollector({
      answers: { 30: 503, 31: "network", 34: [stockRow("201", "2026-11-03 09:00:00")] },
    });
    const outcome = await collector.collectStates(["30", "31", "34"]);
    expect(outcome).toMatchObject({ isSuccess: true, statesSaved: 1, statesFailed: 2 });
    const failures = db
      .statements(/insert into public\.upstream_calls/)
      .filter(({ params }) => params[2] === false);
    expect(failures.map(({ params }) => [params[1], params[7]])).toEqual([
      ["30", "http"],
      ["31", "network"],
    ]);
    expect(errors).toEqual(["Goa: failed (http)", "Lakshadweep: failed (network)"]);
    expect(outcome.sweep.states.map((state) => state.ok)).toEqual([false, false, true]);
  });

  it("rolls back a state whose save fails, without archiving it, and goes on", async () => {
    const db = fakeDb({ failOn: /insert into public\.stock_history/ });
    const { collector, archived } = makeCollector({
      db,
      answers: { 30: [stockRow("101", "2026-11-03 09:00:00")] },
    });
    const outcome = await collector.collectStates(["30"]);
    expect(outcome).toMatchObject({ isSuccess: false, statesSaved: 0, statesFailed: 1 });
    expect(db.statements(/^rollback$/)).toHaveLength(1);
    expect(db.statements(/^commit$/)).toHaveLength(0);
    expect(archived.history).toEqual([]);
    expect(outcome.sweep.states[0]).toMatchObject({ ok: false, failureKind: "save" });
  });

  it("starts no state once the time budget is spent, and reports the rest as skipped", async () => {
    let time = NOW;
    const clock = () => (time += 10_000); // each reading moves the clock 10 s
    const { collector, urls } = makeCollector({
      clock,
      answers: { 30: [], 31: [], 34: [] },
    });
    const outcome = await collector.collectStates(["30", "31", "34"], {
      stopStartingAt: NOW + 60_000,
    });
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.length).toBeLessThan(3);
    expect(outcome.statesSkipped).toBe(3 - urls.length);
    expect(outcome.sweep.states.at(-1)).toMatchObject({ stateCode: "34", failureKind: "skipped" });
  });
});

describe("the four batches", () => {
  it("cover all 36 states exactly once", () => {
    const batched = Object.values(STATE_BATCHES).flat();
    const allStates = districtData.statesWithDistricts.map((state) => String(state.stateCode));
    expect(Object.keys(STATE_BATCHES)).toEqual(["1", "2", "3", "4"]);
    expect(new Set(batched).size).toBe(batched.length);
    expect([...batched].sort()).toEqual([...allStates].sort());
    expect(allStates).toHaveLength(36);
  });
});

describe("the directory run", () => {
  it("flags a bank outside its own state wrong_state, as the laptop does", async () => {
    const goaBank = { hospitalCode: 1, name: "Goa Medical College", stateCode: 30 };
    const { collector, db, archived } = makeCollector({
      answers: {
        nearest: [
          { ...goaBank, latitude: 15.4909, longitude: 73.8278 }, // Panaji
          { ...goaBank, hospitalCode: 2, latitude: 28.6139, longitude: 77.209 }, // central Delhi
          { ...goaBank, hospitalCode: 3, latitude: 15.3, longitude: 74.1 },
          { ...goaBank, hospitalCode: 4, latitude: 15.3, longitude: 74.1 }, // same point as 3
          { ...goaBank, hospitalCode: 5, latitude: null, longitude: null },
        ],
      },
    });
    const outcome = await collector.collectDirectory();
    expect(outcome.qualityCounts).toEqual({ ok: 1, wrong_state: 1, shared: 2, missing: 1 });
    const [insert] = db.statements(/insert into public\.blood_banks/);
    const flags = insert.params.filter((value) =>
      ["ok", "wrong_state", "shared", "missing"].includes(value),
    );
    expect(flags).toEqual(["ok", "wrong_state", "shared", "shared", "missing"]);
    expect(archived.directory).toHaveLength(1);
  });

  it("refuses to run without the state outlines", async () => {
    const { collector } = makeCollector({ stateBoundaries: null });
    await expect(collector.collectDirectory()).rejects.toThrow(/stateBoundaries/);
  });
});

describe("recording runs", () => {
  it("refuses a job that already ran within the guard, and rolls back", async () => {
    const db = fakeDb({ recentRun: true });
    const { collector } = makeCollector({ db });
    expect(await collector.startRun({ job: "stock", batch: 2, guardMinutes: 50 })).toBeNull();
    expect(db.statements(/insert into public\.collector_runs/)).toHaveLength(0);
    expect(db.statements(/^rollback$/)).toHaveLength(1);
  });

  it("records a run that passes the guard, under an advisory lock", async () => {
    const db = fakeDb();
    const { collector } = makeCollector({ db });
    const run = await collector.startRun({ job: "stock", batch: 2, sweepId: 5, guardMinutes: 50 });
    expect(run).toEqual({ id: 7 });
    expect(db.statements(/pg_advisory_xact_lock/)[0].params).toEqual(["collector_runs:stock:2"]);
    expect(db.statements(/insert into public\.collector_runs/)[0].params).toEqual([
      "stock",
      2,
      5,
      "edge",
    ]);
    await collector.finishRun(run, { statesSaved: 9, rowsArchived: 40, archiveDay: "2026-11-03" });
    const [update] = db.statements(/update public\.collector_runs/);
    expect(update.params.slice(0, 2)).toEqual([7, 9]);
    expect(update.params[6]).toBe("2026-11-03");
  });

  it("writes nothing when runs aren't recorded", async () => {
    const db = fakeDb();
    const { collector } = makeCollector({ db, recordRuns: false });
    const run = await collector.startRun({ job: "prune" });
    await collector.finishRun(run, { result: {} });
    expect(db.queries).toEqual([]);
  });
});

describe("the function's request checks", () => {
  const SECRET = "s".repeat(40);

  it("refuses a wrong, missing or short secret", () => {
    expect(isCollectorSecret(SECRET, SECRET)).toBe(true);
    expect(isCollectorSecret(`${SECRET.slice(0, -1)}t`, SECRET)).toBe(false);
    expect(isCollectorSecret(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(isCollectorSecret(`${SECRET}s`, SECRET)).toBe(false);
    expect(isCollectorSecret(null, SECRET)).toBe(false);
    expect(isCollectorSecret("short", "short")).toBe(false);
    expect(isCollectorSecret(undefined, undefined)).toBe(false);
  });

  it("accepts a batch, or the directory and the prune, and nothing else", () => {
    expect(parseCollectorRequest({ batch: 3, sweep: 12 })).toEqual({
      batch: 3,
      sweepId: 12,
      directory: false,
      prune: false,
    });
    expect(parseCollectorRequest({ directory: true, prune: true })).toMatchObject({
      batch: null,
      directory: true,
      prune: true,
    });
    for (const body of [
      null,
      [],
      {},
      { batch: 5 },
      { batch: "1" },
      { batch: 1.5 },
      { batch: 1, prune: true },
      { batch: 1, sweep: -1 },
      { sweep: 3 },
      { directory: "yes" },
      { states: ["30"] },
    ]) {
      expect(parseCollectorRequest(body)).toHaveProperty("error");
    }
  });
});

describe("the overdue warning", () => {
  const now = new Date("2026-11-03T12:00:00Z");
  it("reads Postgres intervals", () => {
    expect(intervalHours("04:30:00")).toBe(4.5);
    expect(intervalHours("1 day 02:00:00")).toBe(26);
    expect(intervalHours("nonsense")).toBeNull();
  });
  it("warns after the interval plus 2 hours, and not before", () => {
    expect(collectionOverdue("2026-11-03T05:40:00Z", "04:30:00", now)).toMatchObject({
      isOverdue: false,
      limitHours: 6.5,
    });
    expect(collectionOverdue("2026-11-03T05:20:00Z", "04:30:00", now).isOverdue).toBe(true);
    // No cloud sweep yet: the laptop's runs are judged against the default interval.
    expect(collectionOverdue("2026-11-03T05:20:00Z", null, now).isOverdue).toBe(true);
    expect(collectionOverdue(null, null, now).isOverdue).toBe(true);
  });
});
