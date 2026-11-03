"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import axios from "axios";
import { BLOOD_GROUPS, STATES, districtsFor } from "@/lib/constants";
import { evaluateEligibility } from "@/lib/eligibility";

// No gender is preselected: it sets the donation gap (90 days for men, 120 otherwise).
const EMPTY_FORM = {
  fullName: "",
  dob: "",
  gender: "",
  phone: "",
  stateCode: "",
  districtCode: "",
  emergencyName: "",
  emergencyPhone: "",
  isDonor: false,
  bloodGroupId: "",
  lastDonationDate: "",
  donationCamp: "",
  recentTattoo: false,
  pregnant: false,
  underweight: false,
  onMedication: false,
  medicationDetails: "",
  hasDisease: false,
};

// Form steps: 0 personal details, 1 blood details, 2 donor screening (donors only).
const PERSONAL_STEP = 0;
const BLOOD_STEP = 1;
const SCREENING_STEP = 2;

// The flat form state from a saved `details` object.
function formFromDetails(details) {
  const donorDetails = details.donorDetails ?? {};
  return {
    ...EMPTY_FORM,
    fullName: details.fullName ?? "",
    dob: details.dob ?? "",
    gender: details.gender ?? "",
    phone: details.phone ?? "",
    stateCode: details.stateCode ? String(details.stateCode) : "",
    districtCode: details.districtCode ? String(details.districtCode) : "",
    emergencyName: details.emergencyContact?.name ?? "",
    emergencyPhone: details.emergencyContact?.phone ?? "",
    isDonor: details.isDonor === true,
    bloodGroupId: details.bloodGroupId ? String(details.bloodGroupId) : "",
    lastDonationDate: donorDetails.lastDonationDate ?? "",
    donationCamp: donorDetails.donationCamp ?? "",
    recentTattoo: donorDetails.recentTattoo === true,
    pregnant: donorDetails.pregnant === true,
    underweight: donorDetails.underweight === true,
    onMedication: donorDetails.onMedication === true,
    medicationDetails: donorDetails.medicationDetails ?? "",
    hasDisease: donorDetails.hasDisease === true,
  };
}

// The nested `details` object the API expects, from the flat form state.
function detailsFromForm(form) {
  return {
    fullName: form.fullName,
    dob: form.dob,
    gender: form.gender,
    phone: form.phone,
    stateCode: form.stateCode,
    districtCode: form.districtCode,
    emergencyContact: { name: form.emergencyName, phone: form.emergencyPhone },
    isDonor: form.isDonor,
    bloodGroupId: form.bloodGroupId,
    donorDetails: form.isDonor
      ? {
          lastDonationDate: form.lastDonationDate || null,
          donationCamp: form.donationCamp || null,
          recentTattoo: form.recentTattoo,
          pregnant: form.pregnant,
          underweight: form.underweight,
          onMedication: form.onMedication,
          medicationDetails: form.onMedication ? form.medicationDetails : null,
          hasDisease: form.hasDisease,
        }
      : null,
  };
}

function FormField({ label, htmlFor, children }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  );
}

function CheckboxRow({ checked, onChange, children }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

// Shown on the step that saves, until the person has agreed to the current privacy note.
function PrivacyConsentRow({ checked, onChange }) {
  return (
    <div className="mt-5">
      <CheckboxRow checked={checked} onChange={onChange}>
        I&apos;m 18 or older, I&apos;ve read the{" "}
        <Link href="/privacy" target="_blank" className="text-[#d32f2f] font-semibold">
          privacy note
        </Link>
        , and I agree to bloodLink storing these details as it describes.
      </CheckboxRow>
    </div>
  );
}

function StepIndicator({ stepCount, currentStep }) {
  const stepIndexes = Array.from({ length: stepCount }, (_, index) => index);
  return (
    <div className="flex items-center gap-2 mb-6">
      {stepIndexes.map((stepIndex) => {
        const isDone = currentStep > stepIndex;
        const isLast = stepIndex === stepCount - 1;
        const dotClass = isDone
          ? " step-dot-done"
          : currentStep === stepIndex
            ? " step-dot-current"
            : "";
        return (
          <div
            key={stepIndex}
            className="flex items-center gap-2"
            style={{ flex: isLast ? "none" : 1 }}
          >
            <div className={"step-dot" + dotClass}>{isDone ? "✓" : stepIndex + 1}</div>
            {!isLast && <div className={"step-line" + (isDone ? " step-line-done" : "")} />}
          </div>
        );
      })}
    </div>
  );
}

export default function SetDetailsPage() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [currentStep, setCurrentStep] = useState(PERSONAL_STEP);
  const [isProfileLoaded, setIsProfileLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  // Until the saved profile says otherwise, the privacy box is shown; the API
  // refuses to save without agreement anyway.
  const [needsPrivacyConsent, setNeedsPrivacyConsent] = useState(true);
  const [isPrivacyAccepted, setIsPrivacyAccepted] = useState(false);

  // Prefill from the saved profile (or partial answers, such as the name from
  // Google) so editing never starts from a blank form. The proxy guarantees a
  // signed-in user; a 401 here means the session expired.
  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/details")
      .then(({ data }) => {
        if (isCancelled) return;
        setNeedsPrivacyConsent(data.hasAgreedToPrivacy !== true);
        if (data.details) {
          setForm(formFromDetails(data.details));
          setIsEditing(true);
        } else if (data.draft) {
          setForm((current) => ({
            ...formFromDetails(data.draft),
            gender: data.draft.gender ?? current.gender,
          }));
        }
      })
      .catch((err) => {
        if (isCancelled) return;
        if (err?.response?.status === 401) {
          router.push("/login?next=/set-details");
          return;
        }
        setError("Could not load your saved details. You can still fill in the form.");
      })
      .finally(() => {
        if (!isCancelled) setIsProfileLoaded(true);
      });
    return () => {
      isCancelled = true;
    };
  }, [router]);

  // Returns an onChange handler that copies an input's value (or checkbox state) into the form.
  const handleFieldChange = (fieldName) => (event) => {
    const value = event.target.type === "checkbox" ? event.target.checked : event.target.value;
    setForm((current) => ({ ...current, [fieldName]: value }));
  };

  const districts = districtsFor(form.stateCode);
  const eligibility = evaluateEligibility(detailsFromForm(form));
  const stepCount = form.isDonor ? 3 : 2;
  const isWaitingForConsent = needsPrivacyConsent && !isPrivacyAccepted;

  async function handleSubmit() {
    if (isWaitingForConsent) {
      setError("Please read the privacy note and tick the box to agree before saving.");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await axios.post("/api/details", {
        details: detailsFromForm(form),
        acceptPrivacy: needsPrivacyConsent && isPrivacyAccepted,
      });
      router.push("/peer-to-peer");
      router.refresh();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save your details. Please try again.");
      setIsSaving(false);
    }
  }

  function handlePersonalStepSubmit(event) {
    event.preventDefault();
    if (!form.fullName || !form.dob || !form.gender || !form.phone || !form.stateCode) {
      setError("Please fill in all required fields.");
      return;
    }
    setError("");
    setCurrentStep(BLOOD_STEP);
  }

  function handleBloodStepSubmit(event) {
    event.preventDefault();
    if (!form.bloodGroupId) {
      setError("Please select a blood group.");
      return;
    }
    setError("");
    if (form.isDonor) setCurrentStep(SCREENING_STEP);
    else handleSubmit();
  }

  if (!isProfileLoaded) {
    return (
      <div className="page-wrap-small">
        <p className="text-sm text-[#666] flex items-center gap-2">
          <span className="spinner" /> Loading your details…
        </p>
      </div>
    );
  }

  return (
    <div className="page-wrap-small">
      <h1 className="page-title">{isEditing ? "Edit your profile" : "Complete your profile"}</h1>
      <p className="page-subtitle">We need a few details before you can use the donor network.</p>

      <div className="card card-body mt-5">
        <StepIndicator stepCount={stepCount} currentStep={currentStep} />

        {error && <p className="notice notice-error mb-4">{error}</p>}

        {currentStep === PERSONAL_STEP && (
          <form onSubmit={handlePersonalStepSubmit}>
            <h2 className="font-semibold text-[#222] mb-3">Personal Details</h2>
            <div className="flex flex-col gap-3 mb-5">
              <FormField label="Full Name" htmlFor="fullName">
                <input
                  id="fullName"
                  className="input"
                  type="text"
                  placeholder="As on official ID"
                  value={form.fullName}
                  onChange={handleFieldChange("fullName")}
                  required
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="Date of Birth" htmlFor="dob">
                  <input
                    id="dob"
                    className="input"
                    type="date"
                    value={form.dob}
                    onChange={handleFieldChange("dob")}
                    required
                  />
                </FormField>
                <FormField label="Gender" htmlFor="gender">
                  <select
                    id="gender"
                    className="select"
                    value={form.gender}
                    onChange={handleFieldChange("gender")}
                    required
                  >
                    <option value="">Select</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </FormField>
              </div>

              <FormField label="Phone Number" htmlFor="phone">
                <input
                  id="phone"
                  className="input"
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={form.phone}
                  onChange={handleFieldChange("phone")}
                  required
                />
              </FormField>

              <div className="grid grid-cols-2 gap-3">
                <FormField label="State" htmlFor="state">
                  <select
                    id="state"
                    className="select"
                    value={form.stateCode}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        stateCode: event.target.value,
                        districtCode: "",
                      }))
                    }
                    required
                  >
                    <option value="">Select</option>
                    {STATES.map((state) => (
                      <option key={state.stateCode} value={state.stateCode}>
                        {state.stateName}
                      </option>
                    ))}
                  </select>
                </FormField>
                {districts.length > 0 && (
                  <FormField label="District" htmlFor="district">
                    <select
                      id="district"
                      className="select"
                      value={form.districtCode}
                      onChange={handleFieldChange("districtCode")}
                    >
                      <option value="">Select</option>
                      {districts.map((district) => (
                        <option key={district.districtCode} value={district.districtCode}>
                          {district.districtName}
                        </option>
                      ))}
                    </select>
                  </FormField>
                )}
              </div>
            </div>

            <h2 className="font-semibold text-[#222] mb-3">Emergency Contact</h2>
            <div className="flex flex-col gap-3">
              <FormField label="Full Name" htmlFor="emergencyName">
                <input
                  id="emergencyName"
                  className="input"
                  type="text"
                  placeholder="Contact person's name"
                  value={form.emergencyName}
                  onChange={handleFieldChange("emergencyName")}
                />
              </FormField>
              <FormField label="Phone Number" htmlFor="emergencyPhone">
                <input
                  id="emergencyPhone"
                  className="input"
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={form.emergencyPhone}
                  onChange={handleFieldChange("emergencyPhone")}
                />
              </FormField>
            </div>

            <div className="flex gap-2 mt-6">
              <button type="submit" className="btn btn-primary">
                Continue →
              </button>
            </div>
          </form>
        )}

        {currentStep === BLOOD_STEP && (
          <form onSubmit={handleBloodStepSubmit}>
            <h2 className="font-semibold text-[#222] mb-3">Blood Details</h2>
            <div className="flex flex-col gap-3">
              <FormField label="Blood Group" htmlFor="bloodGroup">
                <select
                  id="bloodGroup"
                  className="select"
                  value={form.bloodGroupId}
                  onChange={handleFieldChange("bloodGroupId")}
                  required
                >
                  <option value="">Select Blood Group</option>
                  {BLOOD_GROUPS.map((group) => (
                    <option key={group.code} value={group.code}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </FormField>

              <FormField label="Willing to Donate Blood?" htmlFor="isDonor">
                <select
                  id="isDonor"
                  className="select"
                  value={String(form.isDonor)}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, isDonor: event.target.value === "true" }))
                  }
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </FormField>
            </div>

            {!form.isDonor && needsPrivacyConsent && (
              <PrivacyConsentRow
                checked={isPrivacyAccepted}
                onChange={(event) => setIsPrivacyAccepted(event.target.checked)}
              />
            )}

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setCurrentStep(PERSONAL_STEP)}
                disabled={isSaving}
              >
                ← Back
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={isSaving || (!form.isDonor && isWaitingForConsent)}
              >
                {form.isDonor ? "Continue →" : isSaving ? "Saving…" : "Save Details"}
              </button>
            </div>
          </form>
        )}

        {currentStep === SCREENING_STEP && form.isDonor && (
          <div>
            <h2 className="font-semibold text-[#222] mb-3">Donor Screening</h2>
            <div className="flex flex-col gap-3 mb-5">
              <FormField label="Last Donation Date" htmlFor="lastDonationDate">
                <input
                  id="lastDonationDate"
                  className="input"
                  type="date"
                  value={form.lastDonationDate}
                  onChange={handleFieldChange("lastDonationDate")}
                />
                {/* Without a date, eligibility treats the person as a first-time donor. */}
                <p className="text-xs text-[#666] mt-1">
                  Leave it empty if you have never donated.
                </p>
              </FormField>
              <FormField label="Donation Camp / Organisation" htmlFor="donationCamp">
                <input
                  id="donationCamp"
                  className="input"
                  type="text"
                  placeholder="Optional"
                  value={form.donationCamp}
                  onChange={handleFieldChange("donationCamp")}
                />
              </FormField>
            </div>

            <h2 className="font-semibold text-[#222] mb-1">Health Screening</h2>
            <p className="text-xs text-[#666] mb-3">
              Only you can see these answers, not even bloodLink&apos;s admins. They are deleted as
              soon as you are no longer a donor, or when you delete your account.
            </p>
            <div className="flex flex-col gap-2 mb-4">
              {/* Worded as NBTC's 2017 guidelines put them; see src/lib/eligibility.js. */}
              <CheckboxRow checked={form.recentTattoo} onChange={handleFieldChange("recentTattoo")}>
                Tattoo, piercing, acupuncture or another invasive cosmetic procedure in the last 12
                months, for you or your partner?
              </CheckboxRow>
              <CheckboxRow checked={form.pregnant} onChange={handleFieldChange("pregnant")}>
                Pregnant or breastfeeding now, gave birth in the last 12 months, or had an abortion
                or miscarriage in the last 6 months?
              </CheckboxRow>
              <CheckboxRow checked={form.underweight} onChange={handleFieldChange("underweight")}>
                Body weight under 45 kg?
              </CheckboxRow>
              <CheckboxRow checked={form.onMedication} onChange={handleFieldChange("onMedication")}>
                Currently on any medication?
              </CheckboxRow>
              {form.onMedication && (
                <FormField label="Medication Name & Dosage" htmlFor="medicationDetails">
                  <input
                    id="medicationDetails"
                    className="input"
                    type="text"
                    placeholder="e.g. Metformin 500mg"
                    value={form.medicationDetails}
                    onChange={handleFieldChange("medicationDetails")}
                  />
                </FormField>
              )}
              <CheckboxRow checked={form.hasDisease} onChange={handleFieldChange("hasDisease")}>
                Diagnosed with HIV/AIDS, Hepatitis, Malaria, or Syphilis?
              </CheckboxRow>
            </div>

            {eligibility.status !== "eligible" && (
              <div className="notice notice-warn">
                <p>
                  {eligibility.status === "review"
                    ? "You may be able to donate, but blood bank staff will need to check:"
                    : "Based on your answers, you may not be able to donate right now:"}
                </p>
                <ul className="list-disc ml-5 mt-1">
                  {eligibility.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
                <p className="mt-1">
                  You can still save your profile. Eligibility is re-checked automatically.
                </p>
              </div>
            )}

            {needsPrivacyConsent && (
              <PrivacyConsentRow
                checked={isPrivacyAccepted}
                onChange={(event) => setIsPrivacyAccepted(event.target.checked)}
              />
            )}

            <div className="flex gap-2 mt-6">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setCurrentStep(BLOOD_STEP)}
                disabled={isSaving}
              >
                ← Back
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSubmit}
                disabled={isSaving || isWaitingForConsent}
              >
                {isSaving ? "Saving…" : "Save Details"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
