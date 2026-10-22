import data from "../../assets/district_data.json";

// Lookup tables come from assets/district_data.json, which uses the same
// codes as eRaktKosh. Codes are strings everywhere.

const byNumericCode = (a, b) => Number(a.code) - Number(b.code);

export const STATES = data.statesWithDistricts;

export const BLOOD_GROUPS = data.bloodGroups
  .map((g) => ({ code: String(g.bloodGroupCode), name: g.bloodGroupName }))
  .sort(byNumericCode);

export const COMPONENTS = data.componentList
  .map((c) => ({ code: String(c.componentCode), name: c.componentName, shortName: c.componentShortName }))
  .sort(byNumericCode);

export function findState(stateCode) {
  return STATES.find((s) => String(s.stateCode) === String(stateCode)) ?? null;
}

export function districtsFor(stateCode) {
  return findState(stateCode)?.districts ?? [];
}

export function getStateName(stateCode) {
  return findState(stateCode)?.stateName ?? null;
}

export function getDistrictName(stateCode, districtCode) {
  return districtsFor(stateCode).find((d) => String(d.districtCode) === String(districtCode))?.districtName ?? null;
}

export function getBloodGroupName(code) {
  return BLOOD_GROUPS.find((g) => g.code === String(code))?.name ?? null;
}

export function getComponentName(code) {
  return COMPONENTS.find((c) => c.code === String(code))?.name ?? null;
}
