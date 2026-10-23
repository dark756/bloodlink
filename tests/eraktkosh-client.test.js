import { describe, expect, it } from "vitest";
import { createEraktkoshClient, summarizeFreshness } from "@/lib/eraktkosh";

const ROW = {
  hospitalCode: "101",
  hospitalname: "City Blood Centre,",
  entrydate: "2026-10-23 10:00:00",
  components: { "Packed Red Blood Cells": { available_WithQty: "O +ve : 3" } },
};
const SAVED = { data: [ROW], fetchedAt: Date.parse("2026-10-23T05:00:00Z") };

// A clock the tests move by hand.
function makeClock(start = Date.parse("2026-10-23T06:30:00Z")) {
  let time = start;
  return { now: () => time, advance: (ms) => (time += ms) };
}

// A stand-in for axios: each GET runs the next step; the last step repeats.
function scriptedHttp(...steps) {
  const calls = [];
  return {
    calls,
    get(url, config) {
      calls.push({ url, params: config.params });
      const step = steps.length > 1 ? steps.shift() : steps[0];
      return step();
    },
  };
}
const answers = (data) => () => Promise.resolve({ data });
const httpError = (status) => () =>
  Promise.reject(Object.assign(new Error(`status ${status}`), { response: { status } }));
const networkError = () =>
  Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }));
const timeoutError = () =>
  Promise.reject(Object.assign(new Error("timeout of 25000ms exceeded"), { code: "ECONNABORTED" }));
const answersAfter = (ms, data) => () =>
  new Promise((resolve) => setTimeout(() => resolve({ data }), ms));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const makeClient = (http, options = {}) =>
  createEraktkoshClient({ http, retryDelayMs: () => 0, backupGiveUpMs: 50, ...options });
const goa = { stateCode: "30" };

describe("live calls and the memory cache", () => {
  it("validates live rows, then serves repeats from the cache", async () => {
    const http = scriptedHttp(answers([ROW]));
    const client = makeClient(http);
    const first = await client.fetchAvailability(goa);
    expect(first).toMatchObject({ source: "live", stale: false, upstream: "ok" });
    expect(first.data[0].hospitalname).toBe("City Blood Centre");
    expect(first.data[0].components["Packed Red Blood Cells"].available_WithQty).toBe("O+Ve : 3");
    expect((await client.fetchAvailability(goa)).source).toBe("cache");
    expect(http.calls).toHaveLength(1);
    expect(http.calls[0].params).toEqual(goa);
  });
  it("serves the older memory copy, marked stale, when eRaktKosh fails later", async () => {
    const clock = makeClock();
    const http = scriptedHttp(answers([ROW]), httpError(500));
    const client = makeClient(http, { now: clock.now });
    await client.fetchAvailability(goa);
    clock.advance(6 * 60 * 1000);
    const answer = await client.fetchAvailability(goa);
    expect(answer).toMatchObject({ source: "memory", stale: true, upstream: "down" });
    expect(http.calls).toHaveLength(3); // the first call, then a failure and its retry
  });
});

describe("the saved copy", () => {
  it("is served when eRaktKosh fails and nothing is in memory", async () => {
    const http = scriptedHttp(networkError);
    const client = makeClient(http, { savedStore: { availability: async () => SAVED } });
    const answer = await client.fetchAvailability(goa);
    expect(answer).toMatchObject({ source: "saved", stale: true, upstream: "down" });
    expect(answer.fetchedAt).toBe(SAVED.fetchedAt);
  });
  it("is served after the give-up wait while the slow call refreshes the cache", async () => {
    const http = scriptedHttp(answersAfter(150, [ROW]));
    const client = makeClient(http, { savedStore: { availability: async () => SAVED } });
    expect(await client.fetchAvailability(goa)).toMatchObject({
      source: "saved",
      upstream: "degraded",
    });
    await wait(200);
    expect((await client.fetchAvailability(goa)).source).toBe("cache");
    expect(http.calls).toHaveLength(1);
  });
  it("is not waited for: without a backup, a slow answer is still used", async () => {
    const client = makeClient(scriptedHttp(answersAfter(100, [ROW])), { backupGiveUpMs: 20 });
    expect((await client.fetchAvailability(goa)).source).toBe("live");
  });
  it("serves an empty saved answer, such as a state with no bank listing the component", async () => {
    const client = makeClient(scriptedHttp(networkError), {
      savedStore: { availability: async () => ({ data: [], fetchedAt: SAVED.fetchedAt }) },
    });
    expect(await client.fetchAvailability(goa)).toMatchObject({ source: "saved", data: [] });
  });
  it("leaves a clear error when there is no copy at all", async () => {
    const client = makeClient(scriptedHttp(httpError(404)), {
      savedStore: { availability: async () => null },
    });
    await expect(client.fetchAvailability(goa)).rejects.toMatchObject({ kind: "http" });
  });
});

describe("retries and failure kinds", () => {
  it("retries once on a server error, never on a bad request", async () => {
    const retried = scriptedHttp(httpError(503), answers([ROW]));
    expect((await makeClient(retried).fetchAvailability(goa)).source).toBe("live");
    expect(retried.calls).toHaveLength(2);

    const notRetried = scriptedHttp(httpError(404));
    await expect(makeClient(notRetried).fetchAvailability(goa)).rejects.toThrow();
    expect(notRetried.calls).toHaveLength(1);
  });
  it("tells timeouts, network errors and bad shapes apart", async () => {
    const timedOut = scriptedHttp(timeoutError);
    await expect(makeClient(timedOut).fetchAvailability(goa)).rejects.toMatchObject({
      kind: "timeout",
    });
    expect(timedOut.calls).toHaveLength(1); // a timeout is not retried
    await expect(
      makeClient(scriptedHttp(networkError)).fetchAvailability(goa),
    ).rejects.toMatchObject({ kind: "network" });
    await expect(
      makeClient(scriptedHttp(answers("<html>maintenance</html>"))).fetchAvailability(goa),
    ).rejects.toMatchObject({ kind: "shape" });
  });
  it("can simulate an outage without calling eRaktKosh", async () => {
    const http = scriptedHttp(answers([ROW]));
    await expect(makeClient(http, { simulate: "down" }).fetchAvailability(goa)).rejects.toThrow(
      /simulated/,
    );
    expect(http.calls).toHaveLength(0);
  });
});

describe("the circuit", () => {
  it("opens after 3 failures in a minute, then lets one request test eRaktKosh", async () => {
    const clock = makeClock();
    const http = scriptedHttp(networkError);
    const client = makeClient(http, {
      now: clock.now,
      savedStore: { availability: async () => SAVED },
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await client.fetchAvailability(goa)).upstream).toBe("down");
      clock.advance(1_000);
    }
    const callsWhenOpened = http.calls.length; // 3 lookups, each with one retry
    expect(callsWhenOpened).toBe(6);

    expect((await client.fetchAvailability(goa)).source).toBe("saved");
    expect(http.calls).toHaveLength(callsWhenOpened); // skipped while open

    clock.advance(2 * 60 * 1000);
    http.get = scriptedHttp(answers([ROW])).get; // eRaktKosh is back
    expect((await client.fetchAvailability(goa)).source).toBe("live");
  });
  it("keeps other states live while one state keeps failing", async () => {
    const http = scriptedHttp(answers([ROW]));
    const client = makeClient(http, {
      simulateStates: ["27"],
      savedStore: { availability: async () => SAVED },
    });
    for (const bloodGroupId of ["11", "13", "15", "16"]) {
      const answer = await client.fetchAvailability({ stateCode: "27", bloodGroupId });
      expect(answer.source).toBe("saved");
    }
    expect(await client.fetchAvailability(goa)).toMatchObject({ source: "live", upstream: "ok" });
    expect(http.calls.map((call) => call.params.stateCode)).toEqual(["30"]);
  });
  it("skips every lookup once failures come from more than one place", async () => {
    const http = scriptedHttp(networkError);
    const client = makeClient(http, { savedStore: { availability: async () => SAVED } });
    await client.fetchAvailability({ stateCode: "27" });
    await client.fetchAvailability(goa);
    await client.fetchAvailability({ stateCode: "27", bloodGroupId: "16" });
    const callsWhenOpened = http.calls.length;
    expect(await client.fetchAvailability({ stateCode: "33" })).toMatchObject({
      source: "saved",
      upstream: "down",
    });
    expect(http.calls).toHaveLength(callsWhenOpened); // Tamil Nadu was never tried
  });
});

describe("freshness summary", () => {
  const at = (iso) => Date.parse(iso);
  it("reports the worst source, both ages and the failed states", () => {
    const summary = summarizeFreshness(
      [
        { source: "live", fetchedAt: at("2026-10-23T06:30:00Z"), upstream: "ok" },
        { source: "saved", fetchedAt: at("2026-10-23T05:00:00Z"), upstream: "down" },
      ],
      ["Karnataka"],
    );
    expect(summary).toEqual({
      source: "saved",
      fetchedAt: "2026-10-23T06:30:00.000Z",
      oldestFetchedAt: "2026-10-23T05:00:00.000Z",
      upstream: "down",
      failedStates: ["Karnataka"],
      locationsSource: null,
      locationsFetchedAt: null,
    });
  });
  it("keeps the weekly directory's age out of the stock's age", () => {
    const summary = summarizeFreshness(
      [{ source: "saved", fetchedAt: at("2026-10-23T17:35:00Z"), upstream: "down" }],
      [],
      {
        locationAnswer: {
          source: "saved",
          fetchedAt: at("2026-10-19T22:05:00Z"),
          upstream: "down",
        },
      },
    );
    expect(summary).toMatchObject({
      source: "saved",
      oldestFetchedAt: "2026-10-23T17:35:00.000Z",
      locationsSource: "saved",
      locationsFetchedAt: "2026-10-19T22:05:00.000Z",
    });
  });
  it("falls back to the location answer when there is no stock answer", () => {
    const summary = summarizeFreshness([], [], {
      locationAnswer: { source: "saved", fetchedAt: at("2026-10-23T13:18:00Z"), upstream: "down" },
    });
    expect(summary).toMatchObject({ source: "saved", oldestFetchedAt: "2026-10-23T13:18:00.000Z" });
  });
  it("is ok when everything was live", () => {
    expect(summarizeFreshness([{ source: "cache", fetchedAt: 0, upstream: "ok" }]).upstream).toBe(
      "ok",
    );
  });
});

describe("shared live calls", () => {
  it("makes one eRaktKosh call for concurrent lookups of the same thing", async () => {
    const http = scriptedHttp(answersAfter(30, [ROW]));
    const client = makeClient(http);
    const results = await Promise.all([
      client.fetchAvailability(goa),
      client.fetchAvailability(goa),
    ]);
    expect(results.map((result) => result.source)).toEqual(["live", "live"]);
    expect(http.calls).toHaveLength(1);
  });
});

describe("a shorter wait when eRaktKosh is known to be slow", () => {
  it("serves the saved copy after the shorter give-up time", async () => {
    const client = makeClient(scriptedHttp(answersAfter(200, [ROW])), {
      backupGiveUpMs: 1_000,
      savedStore: { availability: async () => SAVED },
    });
    const started = Date.now();
    const answer = await client.fetchAvailability(goa, { giveUpMs: 30 });
    expect(answer.source).toBe("saved");
    expect(Date.now() - started).toBeLessThan(150);
  });
});
