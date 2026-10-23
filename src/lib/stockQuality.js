import { cleanText, isDormant, normalizeGroupName, parseEntryDate } from "./stock.js";

// Checks and cleans eRaktKosh blood-availability rows before they are cached,
// saved or ranked. Rows keep eRaktKosh's own shape, so everything downstream
// reads them unchanged. The explicit ".js" import lets the Node scripts use it too.
//
// Rules, set from a survey of all 4,707 banks on 2026-10-23 (../report3.md, point 3.1):
// - Units per group must be whole numbers from 0 to 2,000. 30 entries were
//   above that, up to 15,280, and are dropped.
// - Group labels become the 10 canonical names ("O +ve" -> "O+Ve"). Unknown
//   labels are dropped.
// - An update time more than 10 minutes in the future becomes unknown.
// - If one response lists a bank twice, the row with the newer update time wins.
// - Names and addresses lose stray trailing commas.
// Every change is counted in the report.

export const MAX_UNITS_PER_GROUP = 2000;
export const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

export function emptyQualityReport() {
  return {
    rowsIn: 0,
    rowsOut: 0,
    missingCodes: 0,
    duplicateRows: 0,
    renamedGroups: 0,
    unknownGroups: 0,
    unparsedEntries: 0,
    droppedUnitCounts: 0,
    missingDates: 0,
    futureDates: 0,
    dormantBanks: 0,
  };
}

export function mergeQualityReports(reports) {
  const total = emptyQualityReport();
  for (const report of reports) {
    for (const key of Object.keys(total)) total[key] += report?.[key] ?? 0;
  }
  return total;
}

// "O +ve : 3, X : 2, A+Ve : 99999" -> "O+Ve : 3", counting what changed.
function cleanQuantities(text, report) {
  if (typeof text !== "string" || text.trim() === "") return text ?? null;
  const kept = [];
  for (const part of text.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const match = entry.match(/^(.+?)\s*:\s*(-?\d+(?:\.\d+)?)$/);
    if (!match) {
      report.unparsedEntries += 1;
      continue;
    }
    const groupName = normalizeGroupName(match[1]);
    if (!groupName) {
      report.unknownGroups += 1;
      continue;
    }
    const units = Number(match[2]);
    if (!Number.isInteger(units) || units < 0 || units > MAX_UNITS_PER_GROUP) {
      report.droppedUnitCounts += 1;
      continue;
    }
    if (groupName !== match[1].trim()) report.renamedGroups += 1;
    kept.push(`${groupName} : ${units}`);
  }
  return kept.join(", ");
}

function cleanRow(row, now, report) {
  const cleaned = {
    ...row,
    hospitalCode: String(row.hospitalCode).trim(),
    hospitalname: cleanText(row.hospitalname),
    hospitaladd: cleanText(row.hospitaladd),
  };

  const updatedAt = parseEntryDate(row.entrydate);
  if (!updatedAt) {
    report.missingDates += 1;
    cleaned.entrydate = null;
  } else if (updatedAt - now > FUTURE_TOLERANCE_MS) {
    report.futureDates += 1;
    cleaned.entrydate = null;
  }

  cleaned.components = Object.fromEntries(
    Object.entries(row.components ?? {}).map(([componentName, component]) => [
      componentName,
      { ...component, available_WithQty: cleanQuantities(component?.available_WithQty, report) },
    ]),
  );
  return cleaned;
}

const updateTime = (row) => parseEntryDate(row.entrydate)?.getTime() ?? -Infinity;

// rows: one eRaktKosh blood-availability response. Returns { rows, report }.
export function validateAvailabilityRows(rows, { now = new Date() } = {}) {
  const report = emptyQualityReport();
  const rowsByCode = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    report.rowsIn += 1;
    if (row?.hospitalCode === undefined || row.hospitalCode === null) {
      report.missingCodes += 1;
      continue;
    }
    if (String(row.hospitalCode).trim() === "") {
      report.missingCodes += 1;
      continue;
    }
    const cleaned = cleanRow(row, now, report);
    const existing = rowsByCode.get(cleaned.hospitalCode);
    if (existing) {
      report.duplicateRows += 1;
      if (updateTime(cleaned) <= updateTime(existing)) continue;
    }
    rowsByCode.set(cleaned.hospitalCode, cleaned);
  }

  const cleanedRows = [...rowsByCode.values()];
  report.rowsOut = cleanedRows.length;
  report.dormantBanks = cleanedRows.filter((row) => isDormant(row.entrydate, now)).length;
  return { rows: cleanedRows, report };
}
