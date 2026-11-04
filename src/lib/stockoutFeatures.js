import { DORMANT_DAYS, GROUP_NAMES } from "./stock.js";

// Inputs and labels for the stock-out forecast (docs/PLANS/ML_system.md, A2 and A4;
// docs/SUMMARIES/ml_models.md, phase 5.1). Pure: the caller reads stock_history and
// blood_banks and passes them in, so the score-stock Edge Function, the Node scripts
// and the tests build the same rows. The explicit ".js" import lets Deno load it.
//
// One case is one bank × one component × one blood group at one grid time: 00:00,
// 06:00, 12:00 or 18:00 India time. Stock is rebuilt at the bank's own update times
// (entry_at), carrying the last value forward, so the laptop's hourly sweeps and the
// cloud's 4.5-hourly ones give the same rows. Only cases with stock above zero at a
// bank that isn't dormant are scored.
//
// The Python dataset builder (ml/, phase 5.1) must give the same inputs on the same
// history: the parity test gates every model (A2). Each choice the summaries leave
// open is written down below, so the two can be checked against each other.

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
// India is UTC+05:30 all year.
export const INDIA_OFFSET_MS = 5.5 * HOUR_MS;
// The grid: every 6 hours from midnight India time.
export const GRID_STEP_MS = 6 * HOUR_MS;
export const HORIZONS_H = [24, 48, 72];
export const LOOKBACK_DAYS = 7;
// Rates "per day seen" divide by the days since the bank's first update, at least
// this many, so a bank first seen an hour ago doesn't get a rate 24 times too big.
export const MIN_DAYS_SEEN = 1;
// Days of supply when a bank used none of the group in the lookback, and its cap.
export const DAYS_OF_SUPPLY_CAP = 30;
// A whole component falling from this many units in total to zero in one update
// is a cleared page, not use (the label rules).
export const CLEARED_PAGE_MIN_UNITS = 10;
// Packed red cells, the component the interim model covers.
export const DEFAULT_COMPONENT = "PRBC";
// The 8 ABO and Rh groups; the forecast leaves out the Bombay groups.
export const FORECAST_GROUPS = GROUP_NAMES.slice(0, 8);
// A gap in collection longer than this drops a case's window (the label rules):
// the 4.5-hour interval plus the admin overview's 2 hours of grace.
export const DEFAULT_GAP_HOURS = 6.5;

// The 19 core inputs the dry run chose, in the artifact's order.
export const INPUT_NAMES = [
  "units",
  "bankUnits",
  "groupsStocked",
  "groupShare",
  "zeroDropsPerDay",
  "change24h",
  "change72h",
  "decreasesPerDay",
  "increasesPerDay",
  "daysOfSupply",
  "bankUsePerDay",
  "updates24h",
  "updatesPerDay",
  "hoursSinceUpdate",
  "autoRefresh",
  "ownership",
  "stateCode",
  "bloodGroup",
  "rhNegative",
];
// The inputs that are categories rather than numbers.
export const CATEGORICAL_INPUTS = new Set(["ownership", "stateCode", "bloodGroup"]);

// ── the grid ─────────────────────────────────────────────────────────────────

const toMs = (time) => (typeof time === "number" ? time : Date.parse(time));

// Whether a time lies on the grid.
export function isGridTime(time) {
  const ms = toMs(time);
  return Number.isFinite(ms) && (ms + INDIA_OFFSET_MS) % GRID_STEP_MS === 0;
}

// The latest grid time at or before a time, in ms.
export function latestGridTime(time) {
  const ms = toMs(time);
  return Math.floor((ms + INDIA_OFFSET_MS) / GRID_STEP_MS) * GRID_STEP_MS - INDIA_OFFSET_MS;
}

// Every grid time from `from` to `to`, both included, in ms.
export function gridTimesBetween(from, to) {
  const end = toMs(to);
  const times = [];
  let time = latestGridTime(from);
  if (time < toMs(from)) time += GRID_STEP_MS;
  for (; time <= end; time += GRID_STEP_MS) times.push(time);
  return times;
}

// ── series ───────────────────────────────────────────────────────────────────

// stock_history rows ({ hospital_code, entry_at, stock }) or archive lines
// ({ hospitalCode, entryAt, stock }) -> Map code -> [{ at (ms), stock }], sorted by
// update time, with one event per update time (the table's key).
export function seriesFromHistory(rows) {
  const byBank = new Map();
  for (const row of rows) {
    const code = String(row.hospital_code ?? row.hospitalCode ?? "");
    const at = toMs(
      row.entry_at instanceof Date ? row.entry_at.getTime() : (row.entry_at ?? row.entryAt),
    );
    if (!code || !Number.isFinite(at)) continue;
    const stock = typeof row.stock === "string" ? JSON.parse(row.stock) : (row.stock ?? {});
    if (!byBank.has(code)) byBank.set(code, new Map());
    byBank.get(code).set(at, stock);
  }
  const series = new Map();
  for (const [code, events] of byBank) {
    series.set(
      code,
      [...events.entries()].sort(([a], [b]) => a - b).map(([at, stock]) => ({ at, stock })),
    );
  }
  return series;
}

// Units of one group of one component in a compact stock object. A group or a
// component missing from it holds zero (the collector keeps only units above zero).
export function groupUnits(stock, component, group) {
  const units = stock?.[component]?.[group];
  return Number.isFinite(units) && units > 0 ? units : 0;
}

// Units of every group of one component.
export function componentUnits(stock, component) {
  let total = 0;
  for (const units of Object.values(stock?.[component] ?? {})) {
    if (Number.isFinite(units) && units > 0) total += units;
  }
  return total;
}

// Whether an update cleared a whole component: from CLEARED_PAGE_MIN_UNITS or more
// in total to zero.
export function isClearedPage(previousStock, stock, component) {
  return (
    componentUnits(previousStock, component) >= CLEARED_PAGE_MIN_UNITS &&
    componentUnits(stock, component) === 0
  );
}

// Index of the last event at or before a time, or -1.
export function indexAt(events, time) {
  let low = 0;
  let high = events.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (events[middle].at <= time) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

// ── bank attributes ──────────────────────────────────────────────────────────

// blood_banks.hospital_type ("Govt.", "Private", "Charitable/Vol", "Red Cross") as
// one of govt, private, charitable, red_cross or other.
export function ownershipOf(hospitalType) {
  const text = String(hospitalType ?? "").toLowerCase();
  if (text.startsWith("govt") || text.includes("government")) return "govt";
  if (text.includes("private")) return "private";
  if (text.includes("red cross")) return "red_cross";
  if (text.includes("charit") || text.includes("vol")) return "charitable";
  return "other";
}

export const isRhNegative = (group) => /-ve$/i.test(group);

// ── inputs ───────────────────────────────────────────────────────────────────

/**
 * The 19 inputs for one bank and group at one grid time, or null when the case
 * isn't scored: no update yet, no stock of the group, or a dormant bank.
 *
 * events must hold every update in the 7 days before asOf and the last one before
 * them (training passes the whole series). Choices the summaries leave open:
 * - "per day seen" divides by the days from the first event to asOf, between
 *   MIN_DAYS_SEEN and LOOKBACK_DAYS;
 * - a change, drop or update counts in the lookback when its update time is in
 *   (asOf − 7 days, asOf];
 * - a cleared page's step counts as no drop and no use, and the step that ends it
 *   as no refill, since the bank wasn't reporting in between;
 * - change24h and change72h are 0 when the bank had no update that long before;
 * - daysOfSupply is units ÷ decreases per day, capped at DAYS_OF_SUPPLY_CAP, and the
 *   cap when there were no decreases;
 * - bankUnits, groupsStocked and bankUsePerDay count every group of the component.
 *
 * @param {{
 *   events: { at: number, stock: any }[],
 *   bank?: { stateCode?: string | null, hospitalType?: string | null, autoRefresh?: boolean | null },
 *   group: string,
 *   asOf: number | string,
 *   component?: string,
 * }} options
 */
export function buildInputs({ events, bank = {}, group, asOf, component = DEFAULT_COMPONENT }) {
  const time = toMs(asOf);
  const current = indexAt(events, time);
  if (current < 0) return null;
  const latest = events[current];
  const hoursSinceUpdate = (time - latest.at) / HOUR_MS;
  if (hoursSinceUpdate > DORMANT_DAYS * 24) return null;
  const units = groupUnits(latest.stock, component, group);
  if (units <= 0) return null;

  const bankUnits = componentUnits(latest.stock, component);
  const groupsStocked = Object.values(latest.stock?.[component] ?? {}).filter(
    (value) => Number.isFinite(value) && value > 0,
  ).length;
  const windowStart = time - LOOKBACK_DAYS * DAY_MS;
  const daysSeen = Math.min(LOOKBACK_DAYS, Math.max(MIN_DAYS_SEEN, (time - events[0].at) / DAY_MS));

  let zeroDrops = 0;
  let decreases = 0;
  let increases = 0;
  let bankUse = 0;
  let updates = 0;
  let updates24h = 0;
  // Whether the page stood cleared after the previous event.
  let isCleared = false;
  for (let index = 1; index <= current; index += 1) {
    const previous = events[index - 1].stock;
    const { at, stock } = events[index];
    const isClearStep = isClearedPage(previous, stock, component);
    const isRestoreStep = isCleared && componentUnits(stock, component) > 0;
    if (isClearStep) isCleared = true;
    else if (isRestoreStep) isCleared = false;
    if (at <= windowStart) continue;

    updates += 1;
    if (at > time - DAY_MS) updates24h += 1;
    if (isClearStep || isRestoreStep) continue;
    const before = groupUnits(previous, component, group);
    const after = groupUnits(stock, component, group);
    if (after < before) decreases += before - after;
    if (after > before) increases += after - before;
    if (before > 0 && after === 0) zeroDrops += 1;
    for (const [name, value] of Object.entries(previous?.[component] ?? {})) {
      const drop = (Number.isFinite(value) ? value : 0) - groupUnits(stock, component, name);
      if (drop > 0) bankUse += drop;
    }
  }
  // The bank's first update has nothing to compare with, but still counts as one.
  if (events[0].at > windowStart && events[0].at <= time) {
    updates += 1;
    if (events[0].at > time - DAY_MS) updates24h += 1;
  }

  const unitsBefore = (hours) => {
    const index = indexAt(events, time - hours * HOUR_MS);
    return index < 0 ? null : groupUnits(events[index].stock, component, group);
  };
  const units24h = unitsBefore(24);
  const units72h = unitsBefore(72);
  const decreasesPerDay = decreases / daysSeen;

  return {
    units,
    bankUnits,
    groupsStocked,
    groupShare: bankUnits > 0 ? units / bankUnits : 0,
    zeroDropsPerDay: zeroDrops / daysSeen,
    change24h: units24h === null ? 0 : units - units24h,
    change72h: units72h === null ? 0 : units - units72h,
    decreasesPerDay,
    increasesPerDay: increases / daysSeen,
    daysOfSupply:
      decreasesPerDay > 0
        ? Math.min(DAYS_OF_SUPPLY_CAP, units / decreasesPerDay)
        : DAYS_OF_SUPPLY_CAP,
    bankUsePerDay: bankUse / daysSeen,
    updates24h,
    updatesPerDay: updates / daysSeen,
    hoursSinceUpdate,
    autoRefresh: bank.autoRefresh ? 1 : 0,
    ownership: ownershipOf(bank.hospitalType),
    stateCode: String(bank.stateCode ?? ""),
    bloodGroup: group,
    rhNegative: isRhNegative(group) ? 1 : 0,
  };
}

/**
 * Every scored case at one grid time: [{ hospitalCode, group, asOf, inputs }].
 * @param {{
 *   series: Map<string, { at: number, stock: any }[]>,
 *   banks?: Map<string, { stateCode?: string | null, hospitalType?: string | null, autoRefresh?: boolean | null }>,
 *   asOf: number | string,
 *   component?: string,
 *   groups?: string[],
 * }} options
 */
export function buildCases({
  series,
  banks = new Map(),
  asOf,
  component = DEFAULT_COMPONENT,
  groups = FORECAST_GROUPS,
}) {
  const time = toMs(asOf);
  const cases = [];
  for (const [hospitalCode, events] of series) {
    for (const group of groups) {
      const inputs = buildInputs({
        events,
        bank: banks.get(hospitalCode) ?? {},
        group,
        asOf: time,
        component,
      });
      if (inputs) cases.push({ hospitalCode, group, asOf: time, inputs });
    }
  }
  return cases;
}

// ── labels ───────────────────────────────────────────────────────────────────

// Spans with no collection: each pair of consecutive sweep times further apart than
// maxGapHours, as [start, end] in ms.
export function findGaps(sweepTimes, maxGapHours = DEFAULT_GAP_HOURS) {
  const times = sweepTimes
    .map(toMs)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] - times[index - 1] > maxGapHours * HOUR_MS) {
      gaps.push([times[index - 1], times[index]]);
    }
  }
  return gaps;
}

/**
 * The outcome of one case at each horizon, by the label rules fixed before the
 * backtest: true when the group reaches zero within (asOf, asOf + H]; null when the
 * case is left out (a cleared page comes first, the window runs past dataEnd or
 * into a gap); false otherwise. A drop to zero that was seen counts even across a
 * gap, since a gap can only hide one. Quick refills still count. Returns null when the
 * case isn't scored at all (no stock at asOf, or a dormant bank).
 * @param {{
 *   events: { at: number, stock: any }[],
 *   group: string,
 *   asOf: number | string,
 *   dataEnd: number | string,
 *   component?: string,
 *   horizons?: number[],
 *   gaps?: number[][],
 * }} options
 */
export function labelCase({
  events,
  group,
  asOf,
  dataEnd,
  component = DEFAULT_COMPONENT,
  horizons = HORIZONS_H,
  gaps = [],
}) {
  const time = toMs(asOf);
  const end = toMs(dataEnd);
  const current = indexAt(events, time);
  if (current < 0) return null;
  if (time - events[current].at > DORMANT_DAYS * DAY_MS) return null;
  if (groupUnits(events[current].stock, component, group) <= 0) return null;

  // The first time the group reaches zero after asOf, and whether it was a cleared page.
  let firstZero = null;
  for (let index = current + 1; index < events.length; index += 1) {
    if (groupUnits(events[index].stock, component, group) === 0) {
      firstZero = {
        at: events[index].at,
        isCleared: isClearedPage(events[index - 1].stock, events[index].stock, component),
      };
      break;
    }
  }

  return horizons.map((hours) => {
    const windowEnd = time + hours * HOUR_MS;
    if (firstZero && firstZero.at <= windowEnd) return firstZero.isCleared ? null : true;
    if (windowEnd > end) return null;
    if (gaps.some(([start, stop]) => start < windowEnd && stop > time)) return null;
    return false;
  });
}
