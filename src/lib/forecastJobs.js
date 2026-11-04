import {
  DEFAULT_COMPONENT,
  FORECAST_GROUPS,
  HORIZONS_H,
  buildCases,
  labelCase,
  latestGridTime,
  seriesFromHistory,
} from "./stockoutFeatures.js";
import {
  chooseCutOff,
  evaluateKillSwitch,
  fitPlatt,
  forecastMetrics,
  logit,
  scoreCase,
  sigmoid,
  thresholdOf,
  validateArtifact,
  withCalibration,
} from "./stockoutModel.js";

// The stock-out forecast's two scheduled jobs (docs/PLANS/ML_system.md, A3 and A4),
// run by the score-stock Edge Function as bloodlink_ml:
//
// - score, after each grid time (00:05, 06:05, 12:05 and 18:05 India time): every
//   bank and red-cell group above the model's low-stock threshold, scored with the live model and the latest
//   daily calibration, into stock_forecasts, with the three inputs raising the risk
//   most as reasons.
// - daily (03:15 India time): labels each scored grid time once its 72-hour window
//   has closed (forecast_outcomes); then, on the latest India day whose four grid
//   times are labelled (by the model's threshold), refits Platt scaling and the alert cut-off and records the
//   day's metrics (forecast_daily_metrics); then runs the kill switch, and prunes.
//
// The database is passed in (a pg client, or a stand-in in the tests), as for
// src/lib/collector.js. The explicit ".js" imports let Deno load this file.

export const COMPONENT_CODES = { PRBC: "12" };
export const GROUP_CODES = {
  "A+Ve": "11",
  "A-Ve": "12",
  "B+Ve": "13",
  "B-Ve": "14",
  "O+Ve": "15",
  "O-Ve": "16",
  "AB+Ve": "17",
  "AB-Ve": "18",
};
const GROUP_NAMES_BY_CODE = Object.fromEntries(
  Object.entries(GROUP_CODES).map(([name, code]) => [code, name]),
);
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// Inputs look back 7 days; one more day of history covers the step into the window.
export const HISTORY_DAYS = 8;
// Grid times labelled per daily run, oldest first, to stay inside the time limit.
export const LABEL_GRID_TIMES_PER_RUN = 8;
// Scored grid times older than this are never labelled (the forecasts are pruned
// at 60 days, but a long outage shouldn't make one run label weeks of them).
export const LABEL_LOOKBACK_DAYS = 10;
// The kill switch reads this many days of 48-hour metrics, and this many runs.
const KILL_SWITCH_DAYS = 7;
const KILL_SWITCH_RUNS = 5;
const INSERT_BATCH = 500;
// Probabilities are stored as real; this keeps their logits finite.
const P_FLOOR = 1e-7;

// The request body: { job: "score" | "daily", asOf? } -> { job, asOf } or { error }.
export function parseForecastRequest(body) {
  if (!body || typeof body !== "object") return { error: "body must be a JSON object" };
  if (body.job !== "score" && body.job !== "daily") return { error: "job must be score or daily" };
  if (body.asOf === undefined || body.asOf === null) return { job: body.job, asOf: null };
  const asOf = Date.parse(body.asOf);
  if (!Number.isFinite(asOf)) return { error: "asOf must be an ISO time" };
  return { job: body.job, asOf };
}

const clampP = (p) => Math.min(1 - P_FLOOR, Math.max(P_FLOOR, Number(p)));

// History rows for the inputs or labels between from and to: every update in
// (from, to], plus each bank's last two updates at or before from, so the first step
// into the window and a page cleared just before it are both seen.
export const HISTORY_SQL = `
  select hospital_code, entry_at, state_code, stock
  from public.stock_history
  where entry_at > $1 and entry_at <= $2
  union all
  select hospital_code, entry_at, state_code, stock
  from (
    select hospital_code, entry_at, state_code, stock,
      row_number() over (partition by hospital_code order by entry_at desc) as back
    from public.stock_history
    where entry_at <= $1
  ) earlier
  where back <= 2`;

/**
 * @param {{
 *   db: { query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }> },
 *   loadArtifact: (model: { id: string, artifact_path: string, artifact_sha256: string }) => Promise<any>,
 *   clock?: () => number,
 *   log?: (...parts: any[]) => void,
 * }} options
 */
export function createForecastJobs({ db, loadArtifact, clock = Date.now, log = () => {} }) {
  async function insertRows(table, columns, rows, conflictClause = "", casts = {}) {
    for (let start = 0; start < rows.length; start += INSERT_BATCH) {
      const batch = rows.slice(start, start + INSERT_BATCH);
      const values = [];
      const tuples = batch.map((row, rowIndex) => {
        const placeholders = row.map((value, columnIndex) => {
          values.push(value);
          return `$${rowIndex * columns.length + columnIndex + 1}${casts[columns[columnIndex]] ?? ""}`;
        });
        return `(${placeholders.join(", ")})`;
      });
      await db.query(
        `insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")} ${conflictClause}`,
        values,
      );
    }
  }

  async function startRun(job, asOf, modelVersion) {
    const { rows } = await db.query(
      "insert into public.forecast_runs (job, as_of, model_version) values ($1, $2, $3) returning id",
      [job, new Date(asOf).toISOString(), modelVersion],
    );
    return rows[0].id;
  }

  async function finishRun(runId, { rowsScored = null, result = null, error = null } = {}) {
    await db.query(
      "update public.forecast_runs set finished_at = now(), rows_scored = $2, result = $3::jsonb, error = $4 where id = $1",
      [
        runId,
        rowsScored,
        result === null ? null : JSON.stringify(result),
        error?.slice(0, 1000) ?? null,
      ],
    );
  }

  // The live model and its artifact, checked; throws when there is none.
  async function liveModel() {
    const { rows } = await db.query(
      "select id, artifact_path, artifact_sha256, evaluation from public.model_versions where status = 'live'",
    );
    if (rows.length === 0) throw new Error("no live model in model_versions");
    const checked = validateArtifact(await loadArtifact(rows[0]));
    if (checked.error) throw new Error(`model ${rows[0].id}: ${checked.error}`);
    if (checked.artifact.id !== rows[0].id) {
      throw new Error(`model ${rows[0].id}: the artifact is ${checked.artifact.id}`);
    }
    return { ...rows[0], artifact: checked.artifact };
  }

  // The newest daily Platt parameters per horizon, for the model.
  async function latestCalibration(modelVersion) {
    const { rows } = await db.query(
      `select distinct on (horizon_h) horizon_h, platt_a, platt_b
       from public.forecast_daily_metrics
       where model_version = $1 and platt_a is not null and platt_b is not null
       order by horizon_h, day desc`,
      [modelVersion],
    );
    return Object.fromEntries(
      rows.map((row) => [row.horizon_h, { a: Number(row.platt_a), b: Number(row.platt_b) }]),
    );
  }

  async function loadHistory(from, to) {
    const { rows } = await db.query(HISTORY_SQL, [
      new Date(from).toISOString(),
      new Date(to).toISOString(),
    ]);
    const series = seriesFromHistory(rows);
    // The state a bank's updates were collected under, as training reads it.
    const states = new Map();
    for (const row of rows) {
      const at = new Date(row.entry_at).getTime();
      const code = String(row.hospital_code);
      if (!states.has(code) || states.get(code).at <= at) {
        states.set(code, { at, stateCode: row.state_code });
      }
    }
    return { series, states };
  }

  async function loadBanks(states) {
    const { rows } = await db.query(
      "select hospital_code, hospital_type, auto_refresh from public.blood_banks",
    );
    const attributes = new Map(rows.map((row) => [String(row.hospital_code), row]));
    const banks = new Map();
    for (const [code, { stateCode }] of states) {
      const row = attributes.get(code);
      banks.set(code, {
        stateCode,
        hospitalType: row?.hospital_type ?? null,
        autoRefresh: row?.auto_refresh === true,
      });
    }
    return banks;
  }

  // ── score ──────────────────────────────────────────────────────────────────
  /** @param {{ asOf?: number | null }} [options] the grid time; the latest one by default */
  async function score({ asOf = null } = {}) {
    const time = latestGridTime(asOf ?? clock());
    const model = await liveModel();
    const runId = await startRun("score", time, model.id);
    try {
      const { rows: done } = await db.query(
        "select 1 from public.stock_forecasts where as_of = $1 and model_version = $2 limit 1",
        [new Date(time).toISOString(), model.id],
      );
      if (done.length > 0) {
        const result = { skipped: "this grid time is already scored" };
        await finishRun(runId, { rowsScored: 0, result });
        return { runId, asOf: time, rowsScored: 0, ...result };
      }
      const calibration = await latestCalibration(model.id);
      const artifact = withCalibration(model.artifact, calibration);
      const { series, states } = await loadHistory(time - HISTORY_DAYS * DAY_MS, time);
      const banks = await loadBanks(states);
      const cases = buildCases({
        series,
        banks,
        asOf: time,
        groups: FORECAST_GROUPS,
        threshold: thresholdOf(model.artifact),
      });
      const asOfIso = new Date(time).toISOString();
      const rows = cases.map(({ hospitalCode, group, inputs }) => {
        const { pRaw, p, reasons } = scoreCase(artifact, inputs);
        return [
          hospitalCode,
          COMPONENT_CODES[DEFAULT_COMPONENT],
          GROUP_CODES[group],
          asOfIso,
          model.id,
          pRaw,
          p,
          JSON.stringify(reasons),
        ];
      });
      await db.query("begin");
      try {
        await insertRows(
          "stock_forecasts",
          [
            "hospital_code",
            "component_id",
            "blood_group_code",
            "as_of",
            "model_version",
            "p_raw",
            "p",
            "reasons",
          ],
          rows,
          "on conflict do nothing",
          { p_raw: "::real[]", p: "::real[]", reasons: "::jsonb" },
        );
        await db.query("commit");
      } catch (error) {
        await db.query("rollback").catch(() => {});
        throw error;
      }
      const result = {
        banks: series.size,
        calibration: Object.keys(calibration).length > 0 ? "daily" : "artifact",
      };
      await finishRun(runId, { rowsScored: rows.length, result });
      log(`scored ${rows.length} cases at ${asOfIso} with ${model.id}`);
      return { runId, asOf: time, rowsScored: rows.length, ...result };
    } catch (error) {
      await finishRun(runId, { error: error.message }).catch(() => {});
      throw error;
    }
  }

  // ── daily ──────────────────────────────────────────────────────────────────

  // The start of the newest cloud sweep whose four batches all finished: stock is
  // known for every state up to then. null before the first one.
  async function dataEnd() {
    const { rows } = await db.query(
      `select min(started_at) as started_at
       from public.collector_runs
       where job = 'stock' and sweep_id is not null and finished_at is not null
       group by sweep_id
       having count(distinct batch) = 4
       order by min(started_at) desc
       limit 1`,
    );
    return rows.length > 0 ? new Date(rows[0].started_at).getTime() : null;
  }

  // Labels scored grid times whose 72-hour window has closed and that have no
  // outcomes yet, oldest first. Returns the grid times labelled.
  async function labelOutcomes(model, end) {
    const { rows: pending } = await db.query(
      `select distinct f.as_of
       from public.stock_forecasts f
       where f.model_version = $1
         and f.as_of + interval '72 hours' <= $2
         and f.as_of >= $3
         and not exists (select 1 from public.forecast_outcomes o where o.as_of = f.as_of)
       order by f.as_of
       limit ${LABEL_GRID_TIMES_PER_RUN}`,
      [
        model.id,
        new Date(end).toISOString(),
        new Date(clock() - LABEL_LOOKBACK_DAYS * DAY_MS).toISOString(),
      ],
    );
    if (pending.length === 0) return [];
    const times = pending.map((row) => new Date(row.as_of).getTime());
    const { series } = await loadHistory(times[0], end);
    const outcomes = [];
    for (const time of times) {
      const { rows: scored } = await db.query(
        `select hospital_code, blood_group_code from public.stock_forecasts
         where model_version = $1 and as_of = $2 and component_id = $3`,
        [model.id, new Date(time).toISOString(), COMPONENT_CODES[DEFAULT_COMPONENT]],
      );
      for (const row of scored) {
        const events = series.get(String(row.hospital_code));
        const group = GROUP_NAMES_BY_CODE[row.blood_group_code];
        const labels =
          events && group
            ? labelCase({
                events,
                group,
                asOf: time,
                dataEnd: end,
                threshold: thresholdOf(model.artifact),
              })
            : null;
        // A case scored at the time but not labelled now (its history was pruned, or
        // the bank's page changed) gets null at every horizon.
        outcomes.push([
          String(row.hospital_code),
          COMPONENT_CODES[DEFAULT_COMPONENT],
          row.blood_group_code,
          new Date(time).toISOString(),
          labels ?? [null, null, null],
        ]);
      }
    }
    await insertRows(
      "forecast_outcomes",
      ["hospital_code", "component_id", "blood_group_code", "as_of", "stockout"],
      outcomes,
      "on conflict (hospital_code, component_id, blood_group_code, as_of) do update set stockout = excluded.stockout, labelled_at = now()",
      { stockout: "::boolean[]" },
    );
    return times;
  }

  // The latest India day whose four grid times are labelled and that has no metrics
  // for the model yet, or null.
  async function dayToCalibrate(model) {
    const { rows } = await db.query(
      `with days as (
         select (o.as_of at time zone 'Asia/Kolkata')::date as day, count(distinct o.as_of) as times
         from public.forecast_outcomes o
         where o.as_of >= $2
         group by 1
       )
       select days.day::text as day
       from days
       where days.times = 4
         and not exists (
           select 1 from public.forecast_daily_metrics d
           where d.model_version = $1 and d.day = days.day
         )
         and exists (
           select 1 from public.stock_forecasts f
           where f.model_version = $1
             and f.as_of >= days.day::timestamp at time zone 'Asia/Kolkata'
             and f.as_of < (days.day + 1)::timestamp at time zone 'Asia/Kolkata'
         )
       order by days.day desc
       limit 1`,
      [model.id, new Date(clock() - LABEL_LOOKBACK_DAYS * DAY_MS).toISOString()],
    );
    return rows[0]?.day ?? null;
  }

  async function calibrateDay(model, day) {
    const start = Date.parse(`${day}T00:00:00+05:30`);
    const { rows } = await db.query(
      `select f.hospital_code, f.blood_group_code, f.as_of, f.p_raw, f.p, o.stockout
       from public.stock_forecasts f
       join public.forecast_outcomes o using (hospital_code, component_id, blood_group_code, as_of)
       where f.model_version = $1 and f.as_of >= $2 and f.as_of < $3`,
      [model.id, new Date(start).toISOString(), new Date(start + DAY_MS).toISOString()],
    );
    const { rows: previousRows } = await db.query(
      `select distinct on (horizon_h) horizon_h, cut_off
       from public.forecast_daily_metrics
       where model_version = $1 and day < $2 and cut_off is not null
       order by horizon_h, day desc`,
      [model.id, day],
    );
    const previousCutOff = Object.fromEntries(
      previousRows.map((row) => [row.horizon_h, Number(row.cut_off)]),
    );
    const summary = {};
    for (const [index, hours] of HORIZONS_H.entries()) {
      const cases = [];
      for (const row of rows) {
        const outcome = row.stockout?.[index];
        if (outcome === null || outcome === undefined) continue;
        cases.push({
          hospitalCode: String(row.hospital_code),
          group: GROUP_NAMES_BY_CODE[row.blood_group_code] ?? row.blood_group_code,
          day,
          logit: logit(clampP(row.p_raw[index])),
          p: Number(row.p[index]),
          outcome: Boolean(outcome),
        });
      }
      const positives = cases.filter((entry) => entry.outcome).length;
      // How the scores in force did: the calibrated P stored at scoring time, and the
      // cut-off then in force (the artifact's on the first day).
      const cutOffInForce =
        previousCutOff[hours] ?? model.evaluation?.by_horizon?.[hours]?.cut_off ?? null;
      const live =
        cases.length > 0 && cutOffInForce !== null ? forecastMetrics(cases, cutOffInForce) : null;
      // The next days' calibration and cut-off, fitted on this day's raw scores.
      let platt = null;
      let cutOff = null;
      if (positives > 0 && positives < cases.length) {
        platt = fitPlatt(
          cases.map((entry) => entry.logit),
          cases.map((entry) => entry.outcome),
        );
        const calibrated = cases.map((entry) => ({
          ...entry,
          p: sigmoid(platt.a * entry.logit + platt.b),
        }));
        cutOff = chooseCutOff(calibrated).cutOff;
      }
      await db.query(
        `insert into public.forecast_daily_metrics
           (day, horizon_h, model_version, cases, positives, pr_auc, calibration_ratio, platt_a,
            platt_b, cut_off, recall_at_cut_off, false_alerts_per_bank_week, lift_by_group)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
         on conflict (day, horizon_h, model_version) do update set
           cases = excluded.cases, positives = excluded.positives, pr_auc = excluded.pr_auc,
           calibration_ratio = excluded.calibration_ratio, platt_a = excluded.platt_a,
           platt_b = excluded.platt_b, cut_off = excluded.cut_off,
           recall_at_cut_off = excluded.recall_at_cut_off,
           false_alerts_per_bank_week = excluded.false_alerts_per_bank_week,
           lift_by_group = excluded.lift_by_group`,
        [
          day,
          hours,
          model.id,
          cases.length,
          positives,
          live?.prAuc ?? null,
          live?.calibrationRatio ?? null,
          platt?.a ?? null,
          platt?.b ?? null,
          cutOff === null ? null : Math.min(1, Math.max(0, cutOff)),
          live?.recallAtCutOff ?? null,
          live?.falseAlertsPerBankWeek ?? null,
          live ? JSON.stringify(live.liftByGroup) : null,
        ],
      );
      summary[hours] = {
        cases: cases.length,
        positives,
        platt: platt && { a: platt.a, b: platt.b },
        cutOff,
        prAuc: live?.prAuc ?? null,
        calibrationRatio: live?.calibrationRatio ?? null,
        falseAlertsPerBankWeek: live?.falseAlertsPerBankWeek ?? null,
      };
    }
    return summary;
  }

  async function killSwitch(model) {
    const { rows: metrics } = await db.query(
      `select day, false_alerts_per_bank_week, calibration_ratio
       from public.forecast_daily_metrics
       where model_version = $1 and horizon_h = 48 and cases > 0
       order by day desc
       limit ${KILL_SWITCH_DAYS}`,
      [model.id],
    );
    const { rows: runs } = await db.query(
      `select started_at, finished_at, error from public.forecast_runs
       where job = 'score' order by started_at desc limit ${KILL_SWITCH_RUNS}`,
    );
    const decision = evaluateKillSwitch({
      metrics: metrics
        .map((row) => ({
          day: row.day,
          falseAlertsPerBankWeek:
            row.false_alerts_per_bank_week === null ? null : Number(row.false_alerts_per_bank_week),
          calibrationRatio: row.calibration_ratio === null ? null : Number(row.calibration_ratio),
        }))
        .reverse(),
      runs,
      now: clock(),
    });
    if (decision.shouldStop) {
      const { rows } = await db.query("select public.stop_forecast_flags($1) as stopped", [
        decision.reasons.join("; ").slice(0, 500),
      ]);
      return { ...decision, flagsStopped: rows[0]?.stopped ?? 0 };
    }
    return { ...decision, flagsStopped: 0 };
  }

  async function daily() {
    const model = await liveModel();
    const end = await dataEnd();
    const runId = await startRun("daily", end ?? clock(), model.id);
    try {
      if (end === null) throw new Error("no complete cloud sweep yet");
      const labelled = await labelOutcomes(model, end);
      const day = await dayToCalibrate(model);
      const calibration = day ? await calibrateDay(model, day) : null;
      const kill = await killSwitch(model);
      const { rows: pruned } = await db.query("select public.prune_forecasts() as result");
      const result = {
        dataEnd: new Date(end).toISOString(),
        labelled: labelled.map((time) => new Date(time).toISOString()),
        day,
        calibration,
        killSwitch: kill,
        pruned: pruned[0]?.result ?? null,
      };
      await finishRun(runId, { rowsScored: 0, result });
      log(`daily: labelled ${labelled.length} grid times; calibrated ${day ?? "no day"}`);
      return { runId, ...result };
    } catch (error) {
      await finishRun(runId, { error: error.message }).catch(() => {});
      throw error;
    }
  }

  return { score, daily, liveModel, dataEnd };
}
