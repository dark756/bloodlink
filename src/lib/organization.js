import { findState } from "./constants";
import { PHONE_PATTERN, trimText } from "./profile";

export const ORGANIZATION_KINDS = {
  hospital: "Hospital",
  blood_bank: "Blood bank",
};

export const ORGANIZATION_STATUS_LABELS = {
  pending: "Waiting for review",
  approved: "Verified",
  rejected: "Not approved",
  suspended: "Suspended",
};

// CSS classes for each application status badge.
export const ORGANIZATION_STATUS_BADGE_CLASSES = {
  pending: "badge",
  approved: "badge badge-green",
  rejected: "badge badge-red",
  suspended: "badge badge-red",
};

const ERAKTKOSH_CODE_PATTERN = /^\d{1,10}$/;

// Validates a hospital or blood-bank application. Mirrors the CHECK
// constraints on public.organizations, which enforce the same rules.
export function sanitizeOrganization(input) {
  const fields = input && typeof input === "object" ? input : {};
  const errors = [];

  const kind = Object.hasOwn(ORGANIZATION_KINDS, fields.kind) ? fields.kind : null;
  if (!kind) errors.push("Choose hospital or blood bank.");

  const name = trimText(fields.name, 200);
  if (name.length < 2) errors.push("Enter the organization's name.");

  const registrationNumber = trimText(fields.registrationNumber, 100);
  if (registrationNumber.length < 2) errors.push("Enter the registration or licence number.");

  const eraktkoshCode = trimText(fields.eraktkoshCode, 10);
  if (eraktkoshCode && !ERAKTKOSH_CODE_PATTERN.test(eraktkoshCode)) {
    errors.push("The eRaktKosh code must be digits only.");
  }

  const state = findState(fields.stateCode);
  if (!state) errors.push("Select a valid state.");

  const districtCode = trimText(fields.districtCode, 6);
  if (
    districtCode &&
    !state?.districts.some((district) => String(district.districtCode) === districtCode)
  ) {
    errors.push("Select a valid district.");
  }

  const address = trimText(fields.address, 500);
  if (address.length < 5) errors.push("Enter the full address.");

  const phone = trimText(fields.phone, 20);
  if (!PHONE_PATTERN.test(phone)) errors.push("Enter a valid phone number.");

  return {
    errors,
    row: {
      kind,
      name,
      registration_number: registrationNumber,
      eraktkosh_code: eraktkoshCode || null,
      state_code: state ? String(state.stateCode) : null,
      district_code: districtCode || null,
      address,
      phone,
    },
  };
}
