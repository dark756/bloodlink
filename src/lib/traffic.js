import trafficProfiles from "../../assets/traffic_profiles.json";

// Travel time to a blood bank by road, for the time of day it is asked.
//
//   ETA = free-flow time × (1 + congestion / 100) × rain factor
//
//   free-flow time  the slower of OSRM's time and the road distance at the zone's
//                   measured free-flow speed. OSRM's car profile assumes near-limit
//                   speeds (a median 65 km/h over 94 Mumbai bank trips), while
//                   TomTom measures 33.7 km/h for free-flowing Mumbai traffic.
//   congestion      % extra travel time for this weekday, hour and month, from the
//                   zone's TomTom Traffic Index 2025 profile (assets/traffic_profiles.json)
//   rain factor     1.15 in moderate rain, 1.3 in heavy rain, 1 otherwise
//
// Zones: the 10 Indian metros TomTom measures use their own profile. Elsewhere the
// average Indian profile is scaled by blood-bank density within 15 km, which
// stands in for population density. Without a road route, road distance is
// straight-line distance × 1.34, the median measured over the same Mumbai trips.

export const DETOUR_FACTOR = 1.34;
export const METRO_MARGIN_KM = 10;
// Banks within 15 km. A city starts where the ring search's "urban" area starts.
export const ZONE_MIN_BANKS = { city: 11, town: 3 };
// Share of the Indian average congestion level. Inside each of 34 countries in
// the TomTom index, congestion relative to the largest city falls by 0.168 per
// tenfold drop in population (411 cities). From the Indian metro average (9.7 M
// people) that gives 0.89 for a city of about 2 M and 0.73 for a town of about
// 300 k. rural is an assumption: half the congestion on Indian metro highways.
export const ZONE_SCALE = { metro: 1, city: 0.89, town: 0.73, rural: 0.29 };
export const RAIN = {
  moderateMmPerHour: 2.5,
  heavyMmPerHour: 7.6,
  moderateFactor: 1.15,
  heavyFactor: 1.3,
};

const IST_OFFSET_MS = 5.5 * 3_600_000;
const KM_PER_DEGREE = 111.32;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const roundToTenth = (value) => Math.round(value * 10) / 10;

// Weekday (0 = Sunday), hour, minute and month (0 = January) on India's clock.
export function indiaClock(now = new Date()) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    day: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    month: shifted.getUTCMonth(),
  };
}

// "Fri 6:05 pm" in India time.
export function formatIndiaTime(now = new Date()) {
  const { day, hour, minute } = indiaClock(now);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${DAY_NAMES[day]} ${hour12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;
}

// The TomTom metro whose area (plus a margin) contains the point, nearest centre first.
export function findMetro(latitude, longitude) {
  const latMargin = METRO_MARGIN_KM / KM_PER_DEGREE;
  const lonMargin = METRO_MARGIN_KM / (KM_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const squaredDistance = (city) => (city.lat - latitude) ** 2 + (city.lon - longitude) ** 2;
  return (
    trafficProfiles.cities
      .filter(
        ({ bounds }) =>
          latitude >= bounds.minLat - latMargin &&
          latitude <= bounds.maxLat + latMargin &&
          longitude >= bounds.minLon - lonMargin &&
          longitude <= bounds.maxLon + lonMargin,
      )
      .sort((a, b) => squaredDistance(a) - squaredDistance(b))[0] ?? null
  );
}

// The traffic zone for a search: its kind, free-flow speed and congestion profile.
export function trafficZone({ latitude, longitude }, banksWithin15Km) {
  const metro = findMetro(latitude, longitude);
  if (metro) {
    return {
      kind: "metro",
      name: metro.name,
      freeFlowKmh: metro.freeFlowKmh,
      scale: ZONE_SCALE.metro,
      weekHour: metro.weekHour,
      seasonal: metro.seasonal,
    };
  }
  const { india } = trafficProfiles;
  const kind =
    banksWithin15Km >= ZONE_MIN_BANKS.city
      ? "city"
      : banksWithin15Km >= ZONE_MIN_BANKS.town
        ? "town"
        : "rural";
  // Free-flow speed: city streets, open road for rural trips, and halfway for
  // towns, whose trips mix town streets with open road.
  const freeFlowKmh = {
    city: india.freeFlowKmh,
    town: (india.freeFlowKmh + india.highwayFreeFlowKmh) / 2,
    rural: india.highwayFreeFlowKmh,
  };
  return {
    kind,
    name: null,
    freeFlowKmh: freeFlowKmh[kind],
    scale: ZONE_SCALE[kind],
    weekHour: india.weekHour,
    seasonal: india.seasonal,
  };
}

// % extra travel time now: the weekday-hour value, interpolated to the minute,
// times the month's seasonal factor and the zone's scale.
export function congestionPercent(zone, now = new Date()) {
  const { day, hour, minute, month } = indiaClock(now);
  const nextDay = hour === 23 ? (day + 1) % 7 : day;
  const nextHour = (hour + 1) % 24;
  const thisHourValue = zone.weekHour[day][hour];
  const nextHourValue = zone.weekHour[nextDay][nextHour];
  const hourValue = thisHourValue + ((nextHourValue - thisHourValue) * minute) / 60;
  return roundToTenth(hourValue * zone.seasonal[month] * zone.scale);
}

export function rainFactor(rainMmPerHour) {
  if (!Number.isFinite(rainMmPerHour)) return 1;
  if (rainMmPerHour >= RAIN.heavyMmPerHour) return RAIN.heavyFactor;
  if (rainMmPerHour >= RAIN.moderateMmPerHour) return RAIN.moderateFactor;
  return 1;
}

export function describeCongestion(congestion) {
  if (congestion < 10) return "light traffic";
  if (congestion < 35) return "moderate traffic";
  if (congestion < 75) return "heavy traffic";
  return "rush-hour traffic";
}

// Conditions shared by every bank in one search.
export function trafficConditions(zone, { now = new Date(), rainMmPerHour = null } = {}) {
  const congestion = congestionPercent(zone, now);
  return {
    zone: zone.kind,
    city: zone.name,
    localTime: formatIndiaTime(now),
    congestionPercent: congestion,
    label: describeCongestion(congestion),
    rainMmPerHour: Number.isFinite(rainMmPerHour) ? roundToTenth(rainMmPerHour) : null,
    rainFactor: rainFactor(rainMmPerHour),
  };
}

// trip: { straightLineM, leg } where leg is { distanceM, durationS } from OSRM, or null.
// Returns { etaMinutes, roadDistanceM, etaSource } with etaSource "road" or "estimate".
export function estimateTravel({ straightLineM, leg }, zone, conditions) {
  const hasRoute = Number.isFinite(leg?.distanceM) && Number.isFinite(leg?.durationS);
  const roadKm = hasRoute ? leg.distanceM / 1000 : (straightLineM / 1000) * DETOUR_FACTOR;
  const routeMinutes = hasRoute ? leg.durationS / 60 : 0;
  const freeFlowMinutes = Math.max(routeMinutes, (roadKm / zone.freeFlowKmh) * 60);
  const minutes =
    freeFlowMinutes * (1 + conditions.congestionPercent / 100) * conditions.rainFactor;
  return {
    etaMinutes: Math.max(1, Math.round(minutes)),
    roadDistanceM: hasRoute ? Math.round(leg.distanceM) : null,
    etaSource: hasRoute ? "road" : "estimate",
  };
}
