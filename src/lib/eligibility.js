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

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function calculateAge(dob, now = new Date()) {
  const birthDate = toDate(dob);
  if (!birthDate) return null;
  let age = now.getFullYear() - birthDate.getFullYear();
  const isBeforeBirthday =
    now.getMonth() < birthDate.getMonth() ||
    (now.getMonth() === birthDate.getMonth() && now.getDate() < birthDate.getDate());
  if (isBeforeBirthday) age -= 1;
  return age;
}

// Returns { status, eligible, reasons, nextEligibleDate }
// status: "not-donor" | "eligible" | "review" | "deferred"
export function evaluateEligibility(details, now = new Date()) {
  if (!details?.isDonor) {
    return { status: "not-donor", eligible: false, reasons: [], nextEligibleDate: null };
  }

  const donorDetails = details.donorDetails ?? {};
  const reasons = [];
  let nextEligibleDate = null;

  const age = calculateAge(details.dob, now);
  if (age === null) reasons.push("Date of birth is missing.");
  else if (age < ELIGIBILITY_RULES.minAge) {
    reasons.push(`Donors must be at least ${ELIGIBILITY_RULES.minAge}.`);
  } else if (age > ELIGIBILITY_RULES.maxAge) {
    reasons.push(`Donors must be ${ELIGIBILITY_RULES.maxAge} or younger.`);
  }

  const lastDonation = toDate(donorDetails.lastDonationDate);
  if (lastDonation) {
    const minGapDays =
      details.gender === "male"
        ? ELIGIBILITY_RULES.intervalDaysMale
        : ELIGIBILITY_RULES.intervalDaysOther;
    const daysSinceDonation = Math.floor((now - lastDonation) / MS_PER_DAY);
    if (daysSinceDonation < minGapDays) {
      nextEligibleDate = new Date(lastDonation.getTime() + minGapDays * MS_PER_DAY)
        .toISOString()
        .slice(0, 10);
      reasons.push(
        `Last donation was ${daysSinceDonation} days ago; the minimum gap is ${minGapDays} days.`,
      );
    }
  }

  if (donorDetails.recentTattoo) reasons.push("Tattoo or piercing in the last 6 months.");
  if (donorDetails.pregnant) reasons.push("Currently pregnant or breastfeeding.");
  if (donorDetails.underweight) reasons.push("Body weight under 50 kg.");
  if (donorDetails.hasDisease) reasons.push("Reported a blood-transmissible infection.");

  const status =
    reasons.length > 0 ? "deferred" : donorDetails.onMedication ? "review" : "eligible";
  if (status === "review") reasons.push("Current medication needs a check by blood bank staff.");

  return { status, eligible: status === "eligible", reasons, nextEligibleDate };
}
