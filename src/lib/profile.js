import { BLOOD_GROUPS, findState } from "./constants";

// Validates and whitelists the profile form before it is stored.
// Anything not listed here is dropped, so clients can't write arbitrary fields.

// Same pattern as the CHECK constraints in supabase/migrations.
export const PHONE_PATTERN = /^\+?[\d -]{7,20}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ["male", "female", "other"];

// A trimmed string cut to maxLength; anything that isn't a string becomes "".
export function trimText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Returns "YYYY-MM-DD", null when empty, or false when invalid or in the future.
function parsePastDate(value, today) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  if (Number.isNaN(new Date(value).getTime())) return false;
  return value <= today ? value : false;
}

export function sanitizeDetails(input, now = new Date()) {
  const fields = input && typeof input === "object" ? input : {};
  const today = now.toISOString().slice(0, 10);
  const errors = [];

  const fullName = trimText(fields.fullName, 100);
  if (!fullName) errors.push("Full name is required.");

  const dob = parsePastDate(fields.dob, today);
  if (!dob) errors.push("Enter a valid date of birth.");

  const gender = GENDERS.includes(fields.gender) ? fields.gender : null;
  if (!gender) errors.push("Select a gender.");

  const phone = trimText(fields.phone, 20);
  if (!PHONE_PATTERN.test(phone)) errors.push("Enter a valid phone number.");

  const state = findState(fields.stateCode);
  if (!state) errors.push("Select a valid state.");

  const districtCode = trimText(fields.districtCode, 6);
  if (
    districtCode &&
    !state?.districts.some((district) => String(district.districtCode) === districtCode)
  ) {
    errors.push("Select a valid district.");
  }

  const emergencyName = trimText(fields.emergencyContact?.name, 100);
  const emergencyPhone = trimText(fields.emergencyContact?.phone, 20);
  if (emergencyPhone && !PHONE_PATTERN.test(emergencyPhone)) {
    errors.push("Enter a valid emergency contact phone.");
  }

  const bloodGroupId = String(fields.bloodGroupId ?? "");
  if (!BLOOD_GROUPS.some((group) => group.code === bloodGroupId)) {
    errors.push("Select a blood group.");
  }

  const isDonor = fields.isDonor === true;
  let donorDetails = null;
  if (isDonor) {
    const donorInput =
      fields.donorDetails && typeof fields.donorDetails === "object" ? fields.donorDetails : {};
    const lastDonationDate = parsePastDate(donorInput.lastDonationDate, today);
    if (lastDonationDate === false) errors.push("Enter a valid last donation date.");
    const onMedication = donorInput.onMedication === true;
    donorDetails = {
      lastDonationDate: lastDonationDate || null,
      donationCamp: trimText(donorInput.donationCamp, 100) || null,
      recentTattoo: donorInput.recentTattoo === true,
      pregnant: donorInput.pregnant === true,
      underweight: donorInput.underweight === true,
      onMedication,
      medicationDetails: onMedication ? trimText(donorInput.medicationDetails, 200) || null : null,
      hasDisease: donorInput.hasDisease === true,
    };
  }

  return {
    errors,
    details: {
      fullName,
      dob: dob || null,
      gender,
      phone,
      stateCode: state ? String(state.stateCode) : null,
      districtCode: districtCode || null,
      emergencyContact: { name: emergencyName || null, phone: emergencyPhone || null },
      isDonor,
      bloodGroupId,
      donorDetails,
    },
  };
}
