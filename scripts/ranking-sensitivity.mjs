// How sensitive is the ranking to its weights?
//
//   node scripts/ranking-sensitivity.mjs --capture http://localhost:3000 <dir>   save real candidate sets
//   node scripts/ranking-sensitivity.mjs <dir>                                  analyse them
//
// --capture makes 52 searches, each with its own X-Forwarded-For; start the server
// with TRUSTED_PROXY_HOPS=1, or the rate limit stops it after 20.
//
// For every saved ranked search and every urgency, each weight is moved by ±20%
// (the rest rescaled so they still add up to 1) and the banks are ranked again.
// It reports how often the first choice stays the same and Kendall's tau between
// the new order and the original (1 = same order, 0 = unrelated).

import fs from "node:fs";
import path from "node:path";
import { URGENCY_LEVELS, WEIGHTS, rankSources } from "../src/lib/ranking.js";

const PLACES = [
  ["Mumbai", 19.076, 72.8777],
  ["New Delhi", 28.6139, 77.209],
  ["Bengaluru", 12.9716, 77.5946],
  ["Kolkata", 22.5726, 88.3639],
  ["Chennai", 13.0827, 80.2707],
  ["Hyderabad", 17.385, 78.4867],
  ["Pune", 18.5204, 73.8567],
  ["Jaipur", 26.9124, 75.7873],
  ["Lucknow", 26.8467, 80.9462],
  ["Patna", 25.5941, 85.1376],
  ["Nashik", 19.9975, 73.7898],
  ["Guwahati", 26.1445, 91.7362],
  ["Barmer (rural)", 25.75, 71.39],
];
const GROUPS = [
  ["15", "O+"],
  ["16", "O-"],
  ["11", "A+"],
  ["13", "B+"],
];
const FACTORS = [0.8, 1.2];

async function capture(baseUrl, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  let user = 0;
  for (const [place, lat, lng] of PLACES) {
    for (const [groupCode, groupName] of GROUPS) {
      user += 1;
      const query = `lat=${lat}&lng=${lng}&componentId=12&bloodGroupId=${groupCode}&units=3&urgency=urgent`;
      const response = await fetch(`${baseUrl}/api/blood-search?${query}`, {
        headers: { "X-Forwarded-For": `10.7.0.${user}` },
      });
      const body = await response.json();
      const fileName = `${place.replace(/\W+/g, "_")}_${groupName.replace("+", "pos").replace("-", "neg")}.json`;
      fs.writeFileSync(
        path.join(outDir, fileName),
        JSON.stringify({ place, groupName, capturedAt: new Date().toISOString(), ...body }),
      );
      console.log(`${place} ${groupName}: ${body.results?.length ?? body.error} banks`);
    }
  }
}

function kendallTau(orderA, orderB) {
  const position = new Map(orderB.map((code, index) => [code, index]));
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < orderA.length; i += 1) {
    for (let j = i + 1; j < orderA.length; j += 1) {
      if (position.get(orderA[i]) < position.get(orderA[j])) concordant += 1;
      else discordant += 1;
    }
  }
  const pairs = concordant + discordant;
  return pairs === 0 ? 1 : (concordant - discordant) / pairs;
}

function perturbed(weights, name, factor) {
  const changed = { ...weights, [name]: weights[name] * factor };
  const total = Object.values(changed).reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(Object.entries(changed).map(([key, weight]) => [key, weight / total]));
}

function analyse(dir) {
  const sets = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")))
    .filter((set) => Array.isArray(set.results) && set.results.length >= 3);
  const summary = {};
  const urgencyFlips = { criticalVsRoutineTopDiffers: 0, sets: sets.length };

  for (const urgency of URGENCY_LEVELS) {
    const rows = [];
    for (const set of sets) {
      const sources = set.results.map((bank) => ({
        hospitalCode: bank.hospitalCode,
        units: bank.units,
        etaMinutes: bank.etaMinutes,
        etaSource: bank.etaSource,
        entryDate: bank.entryDate,
        isDormant: bank.isDormant,
      }));
      const options = { urgency, unitsNeeded: set.unitsNeeded, now: new Date(set.capturedAt) };
      const base = rankSources(sources, options).map((bank) => bank.hospitalCode);
      for (const name of Object.keys(WEIGHTS[urgency])) {
        for (const factor of FACTORS) {
          const order = rankSources(sources, {
            ...options,
            weights: perturbed(WEIGHTS[urgency], name, factor),
          }).map((bank) => bank.hospitalCode);
          rows.push({ name, factor, sameTop: order[0] === base[0], tau: kendallTau(base, order) });
        }
      }
    }
    const byWeight = {};
    for (const name of Object.keys(WEIGHTS[urgency])) {
      const subset = rows.filter((row) => row.name === name);
      byWeight[name] = {
        topUnchangedPct: Math.round(
          (100 * subset.filter((row) => row.sameTop).length) / subset.length,
        ),
        meanTau: Number((subset.reduce((sum, row) => sum + row.tau, 0) / subset.length).toFixed(3)),
        minTau: Number(Math.min(...subset.map((row) => row.tau)).toFixed(3)),
      };
    }
    summary[urgency] = {
      runs: rows.length,
      topUnchangedPct: Math.round((100 * rows.filter((row) => row.sameTop).length) / rows.length),
      meanTau: Number((rows.reduce((sum, row) => sum + row.tau, 0) / rows.length).toFixed(3)),
      byWeight,
    };
  }

  for (const set of sets) {
    const sources = set.results.map((bank) => ({ ...bank }));
    const now = new Date(set.capturedAt);
    const top = (urgency) =>
      rankSources(sources, { urgency, unitsNeeded: set.unitsNeeded, now })[0].hospitalCode;
    if (top("critical") !== top("routine")) urgencyFlips.criticalVsRoutineTopDiffers += 1;
  }

  const banksPerSet = sets.map((set) => set.results.length).sort((a, b) => a - b);
  const report = {
    candidateSets: sets.length,
    banksPerSet: {
      min: banksPerSet[0],
      median: banksPerSet[banksPerSet.length >> 1],
      max: banksPerSet.at(-1),
    },
    urgencyFlips,
    summary,
  };
  console.log(JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "sensitivity_report.json"), JSON.stringify(report, null, 2));
}

const args = process.argv.slice(2);
if (args[0] === "--capture") await capture(args[1].replace(/\/$/, ""), args[2]);
else analyse(args[0]);
