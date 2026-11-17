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
// Ages and gaps are counted on India's calendar (UTC+5:30), so a birthday or a gap ends at
// India's midnight wherever the code runs; a 29 February birthday falls on 1 March in
// non-leap years.
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
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// All date maths here runs on India-date strings ("YYYY-MM-DD"), never on the machine's zone
// (#64). Kept private so this file stays free of imports.
function indiaDate(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

// "YYYY-MM-DD" for a date-only string, the India date of a timestamp, null when empty/invalid.
function toDateString(value) {
  if (!value) return null;
  if (typeof value === "string" && DATE_PATTERN.test(value.slice(0, 10))) {
    const day = value.slice(0, 10);
    return Number.isNaN(new Date(`${day}T00:00:00Z`).getTime()) ? null : day;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : indiaDate(date);
}

function dayNumber(day) {
  return Date.parse(`${day}T00:00:00Z`) / MS_PER_DAY;
}

function addDays(day, days) {
  return new Date((dayNumber(day) + days) * MS_PER_DAY).toISOString().slice(0, 10);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// The birthday in a given year; a 29 February birth has it on 1 March in non-leap years.
function birthdayIn(dob, year) {
  let month = dob.slice(5, 7);
  let dayOfMonth = dob.slice(8, 10);
  if (month === "02" && dayOfMonth === "29" && !isLeapYear(year)) {
    month = "03";
    dayOfMonth = "01";
  }
  return `${String(year).padStart(4, "0")}-${month}-${dayOfMonth}`;
}

function ageOn(dob, today) {
  const year = Number(today.slice(0, 4));
  const age = year - Number(dob.slice(0, 4));
  return today < birthdayIn(dob, year) ? age - 1 : age;
}

function gapDaysFor(gender) {
  return gender === "male"
    ? ELIGIBILITY_RULES.intervalDaysMale
    : ELIGIBILITY_RULES.intervalDaysOther;
}

// Age in whole years on India's date of `now`; it changes exactly on the India birthday.
export function calculateAge(dob, now = new Date()) {
  const birth = toDateString(dob);
  if (!birth) return null;
  return ageOn(birth, indiaDate(now));
}

// The span of India dates on which the person may donate, from the rules above. `donations`
// are centre-confirmed dates; the later of those and the self-reported last donation counts.
// Both dates are null when no window exists (not a donor, no dob, a deferral answer, or the
// window is empty). Not clamped to today. The database function refresh_donor_status() must
// give the same answers (tests/fixtures/eligibility_parity.json).
export function eligibilityWindow(details, { donations = [] } = {}) {
  const none = { eligibleFrom: null, eligibleUntil: null };
  const donorDetails = details?.donorDetails ?? {};
  const needsStaffCheck = details?.isDonor === true && donorDetails.onMedication === true;
  const dob = toDateString(details?.dob);
  if (!details?.isDonor || !dob) return { ...none, needsStaffCheck };
  if (
    donorDetails.recentTattoo ||
    donorDetails.pregnant ||
    donorDetails.underweight ||
    donorDetails.hasDisease
  ) {
    return { ...none, needsStaffCheck };
  }

  const dates = [donorDetails.lastDonationDate, ...donations].map(toDateString).filter(Boolean);
  const latestDonation = dates.length > 0 ? dates.reduce((a, b) => (b > a ? b : a)) : null;

  const birthYear = Number(dob.slice(0, 4));
  let eligibleFrom = birthdayIn(dob, birthYear + ELIGIBILITY_RULES.minAge);
  if (latestDonation) {
    const afterGap = addDays(latestDonation, gapDaysFor(details.gender));
    if (afterGap > eligibleFrom) eligibleFrom = afterGap;
  }
  const lastAge = latestDonation ? ELIGIBILITY_RULES.maxAge : ELIGIBILITY_RULES.maxFirstTimeAge;
  const eligibleUntil = addDays(birthdayIn(dob, birthYear + lastAge + 1), -1);

  if (eligibleFrom > eligibleUntil) return { ...none, needsStaffCheck };
  return { eligibleFrom, eligibleUntil, needsStaffCheck };
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
  const lastDonation = toDateString(donorDetails.lastDonationDate);
  const today = indiaDate(now);

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
    const minGapDays = gapDaysFor(details.gender);
    const daysSinceDonation = dayNumber(today) - dayNumber(lastDonation);
    if (daysSinceDonation < minGapDays) {
      nextEligibleDate = addDays(lastDonation, minGapDays);
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
