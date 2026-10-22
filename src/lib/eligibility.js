// Donor eligibility, computed when it is read rather than frozen at submit time.
//
// Thresholds follow India's NBTC (National Blood Transfusion Council) 2017
// donor-selection guidelines as we understand them: age 18-65 and a minimum
// gap of 90 days (men) or 120 days (women) between whole-blood donations.
// Re-check them against the current guidelines before relying on them.
// This is informational only; blood banks do the real screening.

export const ELIGIBILITY_RULES = {
  minAge: 18,
  maxAge: 65,
  intervalDaysMale: 90,
  intervalDaysOther: 120,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function ageOn(dob, now = new Date()) {
  const birth = toDate(dob);
  if (!birth) return null;
  let age = now.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    now.getMonth() < birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

// Returns { status, eligible, reasons, nextEligibleDate }
// status: "not-donor" | "eligible" | "review" | "deferred"
export function evaluateEligibility(details, now = new Date()) {
  if (!details?.isDonor) {
    return { status: "not-donor", eligible: false, reasons: [], nextEligibleDate: null };
  }

  const donor = details.donorDetails ?? {};
  const reasons = [];
  let nextEligibleDate = null;

  const age = ageOn(details.dob, now);
  if (age === null) reasons.push("Date of birth is missing.");
  else if (age < ELIGIBILITY_RULES.minAge) reasons.push(`Donors must be at least ${ELIGIBILITY_RULES.minAge}.`);
  else if (age > ELIGIBILITY_RULES.maxAge) reasons.push(`Donors must be ${ELIGIBILITY_RULES.maxAge} or younger.`);

  const lastDonation = toDate(donor.lastDonationDate);
  if (lastDonation) {
    const interval =
      details.gender === "male" ? ELIGIBILITY_RULES.intervalDaysMale : ELIGIBILITY_RULES.intervalDaysOther;
    const daysSince = Math.floor((now - lastDonation) / DAY_MS);
    if (daysSince < interval) {
      nextEligibleDate = new Date(lastDonation.getTime() + interval * DAY_MS).toISOString().slice(0, 10);
      reasons.push(`Last donation was ${daysSince} days ago; the minimum gap is ${interval} days.`);
    }
  }

  if (donor.recentTattoo) reasons.push("Tattoo or piercing in the last 6 months.");
  if (donor.pregnant) reasons.push("Currently pregnant or breastfeeding.");
  if (donor.underweight) reasons.push("Body weight under 50 kg.");
  if (donor.hasDisease) reasons.push("Reported a blood-transmissible infection.");

  const status = reasons.length > 0 ? "deferred" : donor.onMedication ? "review" : "eligible";
  if (status === "review") reasons.push("Current medication needs a check by blood bank staff.");

  return { status, eligible: status === "eligible", reasons, nextEligibleDate };
}
