// Builds assets/traffic_profiles.json from the TomTom Traffic Index city pages.
//
//   node scripts/build-traffic-profiles.mjs
//
// For each Indian city TomTom measures, it keeps the metro area's bounding box,
// free-flow speeds, weekday-hour congestion grid and monthly levels. It also
// averages them into an "india" profile for places outside those cities.
// Run it about once a year, when TomTom publishes a new index. It makes one
// request every 2 seconds. The figures are TomTom's and must be credited.

import { writeFile } from "node:fs/promises";

const CITY_KEYS = [
  "ahmedabad",
  "bengaluru",
  "chennai",
  "ernakulam",
  "hyderabad",
  "jaipur",
  "kolkata",
  "mumbai",
  "new-delhi",
  "pune",
];
const PAGE_URL = (key) => `https://www.tomtom.com/traffic-index/city/${key}/`;
const OUTPUT_PATH = new URL("../assets/traffic_profiles.json", import.meta.url);
// Same order as Date.getUTCDay(), so index 0 is Sunday.
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const REQUEST_GAP_MS = 2000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round1 = (value) => Math.round(value * 10) / 10;
const round3 = (value) => Math.round(value * 1000) / 1000;
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;

function unescapeHtml(text) {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// Astro serialises island props as [0, value] for values and [1, [...]] for arrays.
function decodeProps(value) {
  if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[0])) {
    if (value[0] === 0) return decodeProps(value[1]);
    if (value[0] === 1) return value[1].map(decodeProps);
    return value[1];
  }
  if (Array.isArray(value)) return value.map(decodeProps);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeProps(item)]));
  }
  return value;
}

function findCityProps(html) {
  for (const match of html.matchAll(
    /<astro-island[^>]*?component-url="([^"]*)"[^>]*?props="([^"]*)"/g,
  )) {
    if (!match[1].includes("CityMapHeader")) continue;
    return decodeProps(JSON.parse(unescapeHtml(match[2])));
  }
  throw new Error("city data not found in page");
}

function toCityProfile(props) {
  const metro = props.traffic.metro;
  const allRoads = metro.all;
  const congestionByTime = new Map(allRoads.weekHour.map((entry) => [entry.time, entry.c]));
  const weekHour = DAYS.map((day) =>
    Array.from({ length: 24 }, (_, hour) => {
      const value = congestionByTime.get(`${day}-${hour}`);
      if (typeof value !== "number") throw new Error(`missing ${day}-${hour}`);
      return round1(value);
    }),
  );
  const baseCongestion = allRoads.base.c;
  const [[minLon, minLat], [maxLon, maxLat]] = props.bounds;
  return {
    key: props.cityConfig.id,
    name: props.cityConfig.name,
    population: props.cityConfig.population,
    lat: props.cityConfig.lat,
    lon: props.cityConfig.lon,
    bounds: { minLat, minLon, maxLat, maxLon },
    freeFlowKmh: allRoads.base.fv,
    highwayFreeFlowKmh: metro.highways?.base?.fv ?? null,
    highwayCongestion: metro.highways?.base?.c ?? null,
    baseCongestion,
    morningPeak: { hour: Number(allRoads.am.time), congestion: allRoads.am.c },
    eveningPeak: { hour: Number(allRoads.pm.time), congestion: allRoads.pm.c },
    // Month level / yearly level, January first. Carries the monsoon effect.
    seasonal: allRoads.monthly.map((month) => round3(month.c / baseCongestion)),
    weekHour,
  };
}

// The average Indian shape (each city's grid divided by its own yearly level),
// scaled to the average level, plus average speeds and seasonal factors.
function toIndiaProfile(cities) {
  const baseCongestion = round1(mean(cities.map((city) => city.baseCongestion)));
  const weekHour = DAYS.map((_, day) =>
    Array.from({ length: 24 }, (_, hour) =>
      round1(
        baseCongestion * mean(cities.map((city) => city.weekHour[day][hour] / city.baseCongestion)),
      ),
    ),
  );
  const withHighways = cities.filter((city) => city.highwayFreeFlowKmh !== null);
  return {
    freeFlowKmh: round1(mean(cities.map((city) => city.freeFlowKmh))),
    highwayFreeFlowKmh: round1(mean(withHighways.map((city) => city.highwayFreeFlowKmh))),
    highwayCongestion: round1(mean(withHighways.map((city) => city.highwayCongestion))),
    baseCongestion,
    seasonal: Array.from({ length: 12 }, (_, month) =>
      round3(mean(cities.map((city) => city.seasonal[month]))),
    ),
    weekHour,
  };
}

const cities = [];
for (const key of CITY_KEYS) {
  const response = await fetch(PAGE_URL(key), {
    headers: { "User-Agent": "bloodLink-student-project (traffic profile build)" },
  });
  if (!response.ok) throw new Error(`${key}: HTTP ${response.status}`);
  const city = toCityProfile(findCityProps(await response.text()));
  cities.push(city);
  console.log(
    `${city.name}: yearly ${city.baseCongestion}%, free-flow ${city.freeFlowKmh} km/h, ` +
      `evening peak ${city.eveningPeak.congestion}% at ${city.eveningPeak.hour}:00`,
  );
  await sleep(REQUEST_GAP_MS);
}

const profiles = {
  source:
    "TomTom Traffic Index 2025, city pages (metro area, all roads), https://www.tomtom.com/traffic-index/",
  retrievedOn: new Date().toISOString().slice(0, 10),
  notes: [
    "congestion = % extra travel time over free-flow; weekHour[day][hour], day 0 = Sunday, India time",
    "seasonal[month] = that month's level / the yearly level, January first",
  ],
  cities,
  india: toIndiaProfile(cities),
};
await writeFile(OUTPUT_PATH, JSON.stringify(profiles) + "\n");
console.log(`Wrote ${cities.length} cities and the India average to ${OUTPUT_PATH.pathname}`);
