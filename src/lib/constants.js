import districtData from "../../assets/district_data.json";

// Lookup tables come from assets/district_data.json, which uses the same
// codes as eRaktKosh. Codes are strings everywhere.

const compareByNumericCode = (a, b) => Number(a.code) - Number(b.code);

export const STATES = districtData.statesWithDistricts;

export const BLOOD_GROUPS = districtData.bloodGroups
  .map((group) => ({ code: String(group.bloodGroupCode), name: group.bloodGroupName }))
  .sort(compareByNumericCode);

export const COMPONENTS = districtData.componentList
  .map((component) => ({
    code: String(component.componentCode),
    name: component.componentName,
    shortName: component.componentShortName,
  }))
  .sort(compareByNumericCode);

export function findState(stateCode) {
  return STATES.find((state) => String(state.stateCode) === String(stateCode)) ?? null;
}

export function districtsFor(stateCode) {
  return findState(stateCode)?.districts ?? [];
}

export function getStateName(stateCode) {
  return findState(stateCode)?.stateName ?? null;
}

export function getDistrictName(stateCode, districtCode) {
  return (
    districtsFor(stateCode).find(
      (district) => String(district.districtCode) === String(districtCode),
    )?.districtName ?? null
  );
}

export function getBloodGroupName(code) {
  return BLOOD_GROUPS.find((group) => group.code === String(code))?.name ?? null;
}

export function getComponentName(code) {
  return COMPONENTS.find((component) => component.code === String(code))?.name ?? null;
}
