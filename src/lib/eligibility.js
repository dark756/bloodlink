// Donor eligibility, computed when it is read rather than frozen at submit time.
//
// Thresholds follow India's NBTC (National Blood Transfusion Council) "Guidelines for
// Blood Donor Selection & Blood Donor Referral" (NACO letter S-12016/5/2016, 11 October
// 2017), checked on 2026-10-26 against the copy the Union of India filed in the Supreme
// Court (WP (C) 275 of 2021, Annexure A5):
// - clause 2: age 18 to 65, but a first-time donor shall not be over 60;
// - clause 3: at least 45 kg for a 350 ml donation (more than 55 kg for 450 ml, which
//   the blood bank chooses);
// - clause 4: 90 days between whole-blood donations for men, 120 for women;
// - clauses 15 to 17: 12 months after delivery, 6 months after an abortion, and the
//   whole period of breastfeeding;
// - clause 47: 12 months after a tattoo, acupuncture, piercing or other invasive
//   cosmetic procedure, by the donor or their spouse or partner.
// "other" gets the 120-day gap, the conservative choice; the guidelines name only men
// and women. With no last donation recorded, the person counts as a first-time donor.
// This is informational only; the blood bank's medical officer makes the final call.

export const ELIGIBILITY_RULES = {
  minAge: 18,
  maxAge: 65,
  maxFirstTimeAge: 60,
  minWeightKg: 45,
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
  const lastDonation = toDate(donorDetails.lastDonationDate);

  const age = calculateAge(details.dob, now);
  if (age === null) reasons.push("Date of birth is missing.");
  else if (age < ELIGIBILITY_RULES.minAge) {
    reasons.push(`Donors must be at least ${ELIGIBILITY_RULES.minAge}.`);
  } else if (age > ELIGIBILITY_RULES.maxAge) {
    reasons.push(`Donors must be ${ELIGIBILITY_RULES.maxAge} or younger.`);
  } else if (age > ELIGIBILITY_RULES.maxFirstTimeAge && !lastDonation) {
    reasons.push(
      `First-time donors must be ${ELIGIBILITY_RULES.maxFirstTimeAge} or younger. If you have donated before, add your last donation date.`,
    );
  }

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

  if (donorDetails.recentTattoo) {
    reasons.push("Tattoo, piercing, acupuncture or a similar procedure in the last 12 months.");
  }
  if (donorDetails.pregnant) {
    reasons.push(
      "Pregnancy, breastfeeding, a birth in the last 12 months, or an abortion or miscarriage in the last 6 months.",
    );
  }
  if (donorDetails.underweight) {
    reasons.push(`Body weight under ${ELIGIBILITY_RULES.minWeightKg} kg.`);
  }
  if (donorDetails.hasDisease) reasons.push("Reported a blood-transmissible infection.");

  const status =
    reasons.length > 0 ? "deferred" : donorDetails.onMedication ? "review" : "eligible";
  if (status === "review") reasons.push("Current medication needs a check by blood bank staff.");

  return { status, eligible: status === "eligible", reasons, nextEligibleDate };
}
