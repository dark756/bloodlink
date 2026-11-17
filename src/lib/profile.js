import { BLOOD_GROUPS, findState } from "./constants";

// Validates and whitelists the profile form before it is stored.
// Anything not listed here is dropped, so clients can't write arbitrary fields.

// Same pattern as the CHECK constraints in supabase/migrations.
export const PHONE_PATTERN = /^\+?[\d -]{7,20}$/;
const MOBILE_PATTERN = /^[6-9]\d{9}$/;

// The 10 digits of an Indian mobile number from whatever was typed or saved: spaces,
// dashes, "+91", "91" or a leading 0 are dropped. Not validated, so a partly typed
// number comes back as typed.
export function mobileDigits(value) {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.startsWith("91")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 10);
}

// "+91XXXXXXXXXX" for a valid mobile number, else null.
export function toIndianMobile(value) {
  const digits = mobileDigits(value);
  return MOBILE_PATTERN.test(digits) ? `+91${digits}` : null;
}
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ["male", "female", "other"];
const IST_OFFSET_MS = 5.5 * 3_600_000;

// Today in India as "YYYY-MM-DD". People type local dates, and between midnight
// and 05:30 India's date is a day ahead of UTC's.
function indiaToday(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// A trimmed string cut to maxLength; anything that isn't a string becomes "".
export function trimText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Returns "YYYY-MM-DD", null when empty, or false when invalid or in the future.
function parsePastDate(value, today) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  // A real calendar date: JavaScript would roll "2026-02-30" over to 2 March.
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value <= today ? value : false;
}

export function sanitizeDetails(input, now = new Date()) {
  const fields = input && typeof input === "object" ? input : {};
  const today = indiaToday(now);
  const errors = [];

  const fullName = trimText(fields.fullName, 100);
  if (!fullName) errors.push("Full name is required.");

  const dob = parsePastDate(fields.dob, today);
  if (!dob) errors.push("Enter a valid date of birth.");

  const gender = GENDERS.includes(fields.gender) ? fields.gender : null;
  if (!gender) errors.push("Select a gender.");

  const phone = toIndianMobile(fields.phone);
  if (!phone) errors.push("Enter a valid 10-digit mobile number.");

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
  const emergencyDigits = mobileDigits(fields.emergencyContact?.phone);
  const emergencyPhone = toIndianMobile(emergencyDigits);
  if (emergencyDigits && !emergencyPhone) {
    errors.push("Enter a valid 10-digit emergency contact mobile number.");
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
