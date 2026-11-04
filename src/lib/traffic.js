import trafficProfiles from "../../assets/traffic_profiles.json";
import { createTrafficModel } from "./trafficModel.js";

// The travel-time model in src/lib/trafficModel.js, bound to the TomTom profiles in
// assets/traffic_profiles.json. Pure and browser-safe. Node scripts import
// trafficModel.js instead and pass the profiles in.

export {
  DETOUR_FACTOR,
  METRO_MARGIN_KM,
  RAIN,
  ZONE_MIN_BANKS,
  ZONE_SCALE,
  congestionPercent,
  describeCongestion,
  formatIndiaTime,
  indiaClock,
  rainFactor,
  trafficConditions,
} from "./trafficModel.js";

export const { findMetro, trafficZone, estimateTravel } = createTrafficModel(trafficProfiles);
