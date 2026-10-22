"use client";
import { useEffect, useState } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { BLOOD_GROUPS, STATES, districtsFor } from "@/lib/constants";
import { evaluateEligibility } from "@/lib/eligibility";

const EMPTY_FORM = {
  fullName: "",
  dob: "",
  gender: "male",
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

function formFromDetails(d) {
  const donor = d.donorDetails ?? {};
  return {
    ...EMPTY_FORM,
    fullName: d.fullName ?? "",
    dob: d.dob ?? "",
    gender: d.gender ?? "male",
    phone: d.phone ?? "",
    stateCode: d.stateCode ? String(d.stateCode) : "",
    districtCode: d.districtCode ? String(d.districtCode) : "",
    emergencyName: d.emergencyContact?.name ?? "",
    emergencyPhone: d.emergencyContact?.phone ?? "",
    isDonor: d.isDonor === true,
    bloodGroupId: d.bloodGroupId ? String(d.bloodGroupId) : "",
    lastDonationDate: donor.lastDonationDate ?? "",
    donationCamp: donor.donationCamp ?? "",
    recentTattoo: donor.recentTattoo === true,
    pregnant: donor.pregnant === true,
    underweight: donor.underweight === true,
    onMedication: donor.onMedication === true,
    medicationDetails: donor.medicationDetails ?? "",
    hasDisease: donor.hasDisease === true,
  };
}

function detailsFromForm(f) {
  return {
    fullName: f.fullName,
    dob: f.dob,
    gender: f.gender,
    phone: f.phone,
    stateCode: f.stateCode,
    districtCode: f.districtCode,
    emergencyContact: { name: f.emergencyName, phone: f.emergencyPhone },
    isDonor: f.isDonor,
    bloodGroupId: f.bloodGroupId,
    donorDetails: f.isDonor
      ? {
          lastDonationDate: f.lastDonationDate || null,
          donationCamp: f.donationCamp || null,
          recentTattoo: f.recentTattoo,
          pregnant: f.pregnant,
          underweight: f.underweight,
          onMedication: f.onMedication,
          medicationDetails: f.onMedication ? f.medicationDetails : null,
          hasDisease: f.hasDisease,
        }
      : null,
  };
}

function Field({ label, htmlFor, children }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
    </div>
  );
}

function CheckRow({ checked, onChange, children }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{children}</span>
    </label>
  );
}

export default function SetDetails() {
  const { data: session, status, update } = useSession();
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [part, setPart] = useState(0);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const userName = session?.user?.name ?? "";

  // Prefill from the saved profile so editing never starts from a blank form.
  useEffect(() => {
    if (status !== "authenticated") return undefined;
    let cancelled = false;
    axios
      .get("/api/details")
      .then(({ data }) => {
        if (cancelled) return;
        if (data.details) {
          setForm(formFromDetails(data.details));
          setIsEditing(true);
        } else if (userName) {
          setForm((f) => ({ ...f, fullName: f.fullName || userName }));
        }
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your saved details. You can still fill in the form.");
      })
      .finally(() => {
        if (!cancelled) setProfileLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [status, userName]);

  const setField = (field) => (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [field]: value }));
  };

  const districts = districtsFor(form.stateCode);
  const eligibility = evaluateEligibility(detailsFromForm(form));
  const steps = form.isDonor ? [0, 1, 2] : [0, 1];

  async function handleSubmit() {
    setSaving(true);
    setError("");
    try {
      await axios.post("/api/details", { details: detailsFromForm(form) });
      await update(); // refresh the session cookie so the middleware sees the completed profile
      router.push("/peer-to-peer");
      router.refresh();
    } catch (err) {
      setError(err?.response?.data?.error || "Could not save your details. Please try again.");
      setSaving(false);
    }
  }

  function handlePart0Continue(e) {
    e.preventDefault();
    if (!form.fullName || !form.dob || !form.phone || !form.stateCode) {
      setError("Please fill in all required fields.");
      return;
    }
    setError("");
    setPart(1);
  }

  function handlePart1Continue(e) {
    e.preventDefault();
    if (!form.bloodGroupId) {
      setError("Please select a blood group.");
      return;
    }
    setError("");
    if (form.isDonor) setPart(2);
    else handleSubmit();
  }

  if (status === "unauthenticated") {
    return (
      <div className="page-wrap-small">
        <h1 className="page-title">Complete your profile</h1>
        <p className="notice notice-warn mt-5">Please sign in to fill in your details.</p>
        <button className="btn btn-primary mt-4" onClick={() => signIn("google")}>Sign in with Google</button>
      </div>
    );
  }

  if (status === "loading" || !profileLoaded) {
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
        <div className="flex items-center gap-2 mb-6">
          {steps.map((step, i) => (
            <div key={step} className="flex items-center gap-2" style={{ flex: i < steps.length - 1 ? 1 : "none" }}>
              <div className={"step-dot" + (part > step ? " step-dot-done" : part === step ? " step-dot-current" : "")}>
                {part > step ? "✓" : step + 1}
              </div>
              {i < steps.length - 1 && <div className={"step-line" + (part > step ? " step-line-done" : "")} />}
            </div>
          ))}
        </div>

        {error && <p className="notice notice-error mb-4">{error}</p>}

        {part === 0 && (
          <form onSubmit={handlePart0Continue}>
            <h2 className="font-semibold text-[#222] mb-3">Personal Details</h2>
            <div className="flex flex-col gap-3 mb-5">
              <Field label="Full Name" htmlFor="fullName">
                <input id="fullName" className="input" type="text" placeholder="As on official ID"
                  value={form.fullName} onChange={setField("fullName")} required />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Date of Birth" htmlFor="dob">
                  <input id="dob" className="input" type="date" value={form.dob} onChange={setField("dob")} required />
                </Field>
                <Field label="Gender" htmlFor="gender">
                  <select id="gender" className="select" value={form.gender} onChange={setField("gender")}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>

              <Field label="Phone Number" htmlFor="phone">
                <input id="phone" className="input" type="tel" placeholder="+91 XXXXX XXXXX"
                  value={form.phone} onChange={setField("phone")} required />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="State" htmlFor="state">
                  <select
                    id="state"
                    className="select"
                    value={form.stateCode}
                    onChange={(e) => setForm((f) => ({ ...f, stateCode: e.target.value, districtCode: "" }))}
                    required
                  >
                    <option value="">Select</option>
                    {STATES.map((s) => (
                      <option key={s.stateCode} value={s.stateCode}>{s.stateName}</option>
                    ))}
                  </select>
                </Field>
                {districts.length > 0 && (
                  <Field label="District" htmlFor="district">
                    <select id="district" className="select" value={form.districtCode} onChange={setField("districtCode")}>
                      <option value="">Select</option>
                      {districts.map((d) => (
                        <option key={d.districtCode} value={d.districtCode}>{d.districtName}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>

            <h2 className="font-semibold text-[#222] mb-3">Emergency Contact</h2>
            <div className="flex flex-col gap-3">
              <Field label="Full Name" htmlFor="emergencyName">
                <input id="emergencyName" className="input" type="text" placeholder="Contact person's name"
                  value={form.emergencyName} onChange={setField("emergencyName")} />
              </Field>
              <Field label="Phone Number" htmlFor="emergencyPhone">
                <input id="emergencyPhone" className="input" type="tel" placeholder="+91 XXXXX XXXXX"
                  value={form.emergencyPhone} onChange={setField("emergencyPhone")} />
              </Field>
            </div>

            <div className="flex gap-2 mt-6">
              <button type="submit" className="btn btn-primary">Continue →</button>
            </div>
          </form>
        )}

        {part === 1 && (
          <form onSubmit={handlePart1Continue}>
            <h2 className="font-semibold text-[#222] mb-3">Blood Details</h2>
            <div className="flex flex-col gap-3">
              <Field label="Blood Group" htmlFor="bloodGroup">
                <select id="bloodGroup" className="select" value={form.bloodGroupId} onChange={setField("bloodGroupId")} required>
                  <option value="">Select Blood Group</option>
                  {BLOOD_GROUPS.map((g) => (
                    <option key={g.code} value={g.code}>{g.name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Willing to Donate Blood?" htmlFor="isDonor">
                <select
                  id="isDonor"
                  className="select"
                  value={String(form.isDonor)}
                  onChange={(e) => setForm((f) => ({ ...f, isDonor: e.target.value === "true" }))}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
            </div>

            <div className="flex gap-2 mt-6">
              <button type="button" className="btn btn-outline" onClick={() => setPart(0)} disabled={saving}>← Back</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {form.isDonor ? "Continue →" : saving ? "Saving…" : "Save Details"}
              </button>
            </div>
          </form>
        )}

        {part === 2 && form.isDonor && (
          <div>
            <h2 className="font-semibold text-[#222] mb-3">Donor Screening</h2>
            <div className="flex flex-col gap-3 mb-5">
              <Field label="Last Donation Date" htmlFor="lastDonation">
                <input id="lastDonation" className="input" type="date" value={form.lastDonationDate}
                  onChange={setField("lastDonationDate")} />
              </Field>
              <Field label="Donation Camp / Organisation" htmlFor="camp">
                <input id="camp" className="input" type="text" placeholder="Optional"
                  value={form.donationCamp} onChange={setField("donationCamp")} />
              </Field>
            </div>

            <h2 className="font-semibold text-[#222] mb-3">Health Screening</h2>
            <div className="flex flex-col gap-2 mb-4">
              <CheckRow checked={form.recentTattoo} onChange={setField("recentTattoo")}>
                Tattoo or piercing in the last 6 months?
              </CheckRow>
              <CheckRow checked={form.pregnant} onChange={setField("pregnant")}>
                Currently pregnant or breastfeeding?
              </CheckRow>
              <CheckRow checked={form.underweight} onChange={setField("underweight")}>
                Body weight under 50 kg?
              </CheckRow>
              <CheckRow checked={form.onMedication} onChange={setField("onMedication")}>
                Currently on any medication?
              </CheckRow>
              {form.onMedication && (
                <Field label="Medication Name & Dosage" htmlFor="medication">
                  <input id="medication" className="input" type="text" placeholder="e.g. Metformin 500mg"
                    value={form.medicationDetails} onChange={setField("medicationDetails")} />
                </Field>
              )}
              <CheckRow checked={form.hasDisease} onChange={setField("hasDisease")}>
                Diagnosed with HIV/AIDS, Hepatitis, Malaria, or Syphilis?
              </CheckRow>
            </div>

            {eligibility.status !== "eligible" && (
              <div className="notice notice-warn">
                <p>
                  {eligibility.status === "review"
                    ? "You may be able to donate, but blood bank staff will need to check:"
                    : "Based on your answers, you may not be able to donate right now:"}
                </p>
                <ul className="list-disc ml-5 mt-1">
                  {eligibility.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
                <p className="mt-1">You can still save your profile. Eligibility is re-checked automatically.</p>
              </div>
            )}

            <div className="flex gap-2 mt-6">
              <button type="button" className="btn btn-outline" onClick={() => setPart(1)} disabled={saving}>← Back</button>
              <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? "Saving…" : "Save Details"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
