import { BLOOD_GROUPS, findState } from "./constants";

// Validates and whitelists the profile form before it is stored.
// Anything not listed here is dropped, so clients can't write arbitrary fields.

const PHONE_PATTERN = /^\+?[\d\s-]{7,20}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GENDERS = ["male", "female", "other"];

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

// Returns "YYYY-MM-DD", null when empty, or false when invalid or in the future.
function pastDay(value, today) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !DAY_PATTERN.test(value)) return false;
  if (Number.isNaN(new Date(value).getTime())) return false;
  return value <= today ? value : false;
}

export function sanitizeDetails(input, now = new Date()) {
  const src = input && typeof input === "object" ? input : {};
  const today = now.toISOString().slice(0, 10);
  const errors = [];

  const fullName = text(src.fullName, 100);
  if (!fullName) errors.push("Full name is required.");

  const dob = pastDay(src.dob, today);
  if (!dob) errors.push("Enter a valid date of birth.");

  const gender = GENDERS.includes(src.gender) ? src.gender : null;
  if (!gender) errors.push("Select a gender.");

  const phone = text(src.phone, 20);
  if (!PHONE_PATTERN.test(phone)) errors.push("Enter a valid phone number.");

  const state = findState(src.stateCode);
  if (!state) errors.push("Select a valid state.");

  const districtCode = text(src.districtCode, 6);
  if (districtCode && !state?.districts.some((d) => String(d.districtCode) === districtCode)) {
    errors.push("Select a valid district.");
  }

  const emergencyName = text(src.emergencyContact?.name, 100);
  const emergencyPhone = text(src.emergencyContact?.phone, 20);
  if (emergencyPhone && !PHONE_PATTERN.test(emergencyPhone)) errors.push("Enter a valid emergency contact phone.");

  const bloodGroupId = String(src.bloodGroupId ?? "");
  if (!BLOOD_GROUPS.some((g) => g.code === bloodGroupId)) errors.push("Select a blood group.");

  const isDonor = src.isDonor === true;
  let donorDetails = null;
  if (isDonor) {
    const d = src.donorDetails && typeof src.donorDetails === "object" ? src.donorDetails : {};
    const lastDonationDate = pastDay(d.lastDonationDate, today);
    if (lastDonationDate === false) errors.push("Enter a valid last donation date.");
    const onMedication = d.onMedication === true;
    donorDetails = {
      lastDonationDate: lastDonationDate || null,
      donationCamp: text(d.donationCamp, 100) || null,
      recentTattoo: d.recentTattoo === true,
      pregnant: d.pregnant === true,
      underweight: d.underweight === true,
      onMedication,
      medicationDetails: onMedication ? text(d.medicationDetails, 200) || null : null,
      hasDisease: d.hasDisease === true,
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
