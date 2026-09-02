'use client';
import data from "@/../assets/district_data.json";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import axios from "axios";

const bloodGroups = {
  "A-Ve": 12,
  "B+Ve": 13,
  "B-Ve": 14,
  "O+Ve": 15,
  "AB+Ve": 17,
  "AB-Ve": 18,
  "A+Ve": 11,
  "O-Ve": 16,
  "Oh+VE": 22,
  "Oh-VE": 23
};

const styles = {
  page: {
    minHeight: "100vh",
    backgroundColor: "#0a0a0a",
    color: "#e8e8e8",
    fontFamily: "'DM Mono', 'Fira Mono', 'Courier New', monospace",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "48px 16px",
  },
  card: {
    width: "100%",
    maxWidth: "480px",
    backgroundColor: "#111",
    border: "1px solid #222",
    borderRadius: "4px",
    padding: "36px 32px",
  },
  stepIndicator: {
    display: "flex",
    gap: "8px",
    marginBottom: "32px",
    alignItems: "center",
  },
  stepDot: (active, done) => ({
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    border: `1px solid ${done ? "#2563eb" : active ? "#3b82f6" : "#333"}`,
    backgroundColor: done ? "#2563eb" : active ? "transparent" : "transparent",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "10px",
    color: done ? "#fff" : active ? "#3b82f6" : "#444",
    fontWeight: "600",
    transition: "all 0.2s",
    flexShrink: 0,
  }),
  stepLine: (done) => ({
    flex: 1,
    height: "1px",
    backgroundColor: done ? "#2563eb" : "#222",
    transition: "background-color 0.3s",
  }),
  heading: {
    fontSize: "13px",
    fontWeight: "600",
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "#888",
    marginBottom: "24px",
  },
  fieldGroup: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
    marginBottom: "24px",
  },
  label: {
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "#555",
    marginBottom: "4px",
    display: "block",
  },
  input: {
    width: "100%",
    backgroundColor: "#0d0d0d",
    border: "1px solid #222",
    borderRadius: "3px",
    color: "#e8e8e8",
    padding: "10px 12px",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  select: {
    width: "100%",
    backgroundColor: "#0d0d0d",
    border: "1px solid #222",
    borderRadius: "3px",
    color: "#e8e8e8",
    padding: "10px 12px",
    fontSize: "13px",
    fontFamily: "inherit",
    outline: "none",
    appearance: "none",
    boxSizing: "border-box",
    cursor: "pointer",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' stroke='%23555' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat",
    backgroundPosition: "right 12px center",
    paddingRight: "32px",
  },
  checkboxRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "10px",
    padding: "10px 12px",
    border: "1px solid #1a1a1a",
    borderRadius: "3px",
    cursor: "pointer",
    transition: "border-color 0.15s",
    backgroundColor: "#0d0d0d",
  },
  checkbox: {
    width: "15px",
    height: "15px",
    accentColor: "#3b82f6",
    marginTop: "1px",
    flexShrink: 0,
    cursor: "pointer",
  },
  checkboxLabel: {
    fontSize: "12px",
    color: "#aaa",
    lineHeight: "1.5",
    cursor: "pointer",
  },
  buttonRow: {
    display: "flex",
    gap: "8px",
    marginTop: "28px",
  },
  btnPrimary: {
    flex: 1,
    backgroundColor: "#2563eb",
    color: "#fff",
    border: "none",
    borderRadius: "3px",
    padding: "11px 20px",
    fontSize: "12px",
    fontFamily: "inherit",
    fontWeight: "600",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  btnSecondary: {
    backgroundColor: "transparent",
    color: "#555",
    border: "1px solid #222",
    borderRadius: "3px",
    padding: "11px 16px",
    fontSize: "12px",
    fontFamily: "inherit",
    fontWeight: "600",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    cursor: "pointer",
    transition: "border-color 0.15s, color 0.15s",
  },
  error: {
    fontSize: "12px",
    color: "#f87171",
    backgroundColor: "#1a0a0a",
    border: "1px solid #3b1515",
    borderRadius: "3px",
    padding: "10px 12px",
    marginBottom: "20px",
  },
  warning: {
    fontSize: "12px",
    color: "#fbbf24",
    backgroundColor: "#141007",
    border: "1px solid #3d2d0a",
    borderRadius: "3px",
    padding: "10px 12px",
    marginBottom: "16px",
    lineHeight: "1.5",
  },
  sectionDivider: {
    borderTop: "1px solid #1a1a1a",
    marginBottom: "16px",
    marginTop: "4px",
  },
  fieldWrapper: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
};

function Field({ label, children }) {
  return (
    <div style={styles.fieldWrapper}>
      <label style={styles.label}>{label}</label>
      {children}
    </div>
  );
}

function CheckRow({ checked, onChange, children }) {
  return (
    <label style={{
      ...styles.checkboxRow,
      borderColor: checked ? "#1d3a6e" : "#1a1a1a",
    }}>
      <input
        type="checkbox"
        style={styles.checkbox}
        checked={checked}
        onChange={onChange}
      />
      <span style={styles.checkboxLabel}>{children}</span>
    </label>
  );
}

export default function SetDetails() {
  const { data: session, update } = useSession();
  const [part, setPart] = useState(0);
  const states = data.statesWithDistricts;
  const [districts, setDistricts] = useState([]);

  const [fullName, setFullName] = useState("");
  const [dob, setDob] = useState("");
  const [gender, setGender] = useState("male");
  const [phone, setPhone] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [districtCode, setDistrictCode] = useState("");
  const [emergencyName, setEmergencyName] = useState("");
  const [emergencyPhone, setEmergencyPhone] = useState("");

  const [donor, setDonor] = useState(false);
  const [bloodGroupId, setBloodGroupId] = useState("");

  const [lastDonationDate, setLastDonationDate] = useState("");
  const [donationCamp, setDonationCamp] = useState("");
  const [recentTattoo, setRecentTattoo] = useState(false);
  const [pregnant, setPregnant] = useState(false);
  const [underweight, setUnderweight] = useState(false);
  const [onMedication, setOnMedication] = useState(false);
  const [medicationDetails, setMedicationDetails] = useState("");
  const [hasDisease, setHasDisease] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const isEligibleToDonate =
    donor && !recentTattoo && !pregnant && !underweight && !hasDisease;

  useEffect(() => {
    const selectedState = states.find(s => s.stateCode === stateCode);
    if (selectedState) {
      setDistricts(selectedState.districts);
      setDistrictCode("");
    } else {
      setDistricts([]);
    }
  }, [stateCode, states]);

  useEffect(() => {
    // prefill form if partial data exists
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setPart(part + 1);

    const payload = {
      email: session.user.email,
      details: {
        fullName, dob, gender, phone, stateCode, districtCode,
        emergencyContact: { name: emergencyName, phone: emergencyPhone },
        isDonor: donor,
        bloodGroupId,
        donorDetails: donor ? {
          lastDonationDate: lastDonationDate || null,
          donationCamp: donationCamp || null,
          recentTattoo, pregnant, underweight, onMedication,
          medicationDetails: onMedication ? medicationDetails : null,
          hasDisease,
          isEligibleToDonate,
        } : null,
        isProfileComplete: true,
      }
    };

    const response = await axios.post("/api/details", { payload });
    if (response.status !== 200) {
      setError("Failed to submit details. Please try again.");
      setLoading(false);
      return;
    }
    alert("Details submitted!");
    setLoading(false);
  };

  const handlePart0Continue = (e) => {
    e.preventDefault();
    if (!fullName || !dob || !phone || !stateCode) {
      setError("Please fill in all required fields.");
      return;
    }
    setError("");
    setPart(1);
  };

  const handlePart1Continue = (e) => {
    e.preventDefault();
    if (!bloodGroupId) {
      setError("Please select a blood group.");
      return;
    }
    setError("");
    donor ? setPart(2) : handleSubmit();
  };

  const totalSteps = 3;

  return (
    <div style={styles.page}>
      <div style={styles.card}>

        {/* Step indicator */}
        <div style={styles.stepIndicator}>
          {[0, 1, 2].map((step, i) => (
            <div key={step} style={{ display: "flex", alignItems: "center", flex: i < 2 ? 1 : "none" }}>
              <div style={styles.stepDot(part === step, part > step)}>
                {part > step ? "✓" : step + 1}
              </div>
              {i < 2 && <div style={styles.stepLine(part > step)} />}
            </div>
          ))}
        </div>

        {error && <div style={styles.error}>{error}</div>}

        {/* ───── PART 1 ───── */}
        {part === 0 && (
          <form onSubmit={handlePart0Continue}>
            <p style={styles.heading}>Personal Details</p>
            <div style={styles.fieldGroup}>
              <Field label="Full Name">
                <input
                  style={styles.input}
                  type="text"
                  placeholder="As on official ID"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <Field label="Date of Birth">
                  <input
                    style={styles.input}
                    type="date"
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Gender">
                  <select style={styles.select} value={gender} onChange={(e) => setGender(e.target.value)}>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
              </div>

              <Field label="Phone Number">
                <input
                  style={styles.input}
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  required
                />
              </Field>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                <Field label="State">
                  <select
                    style={styles.select}
                    value={stateCode}
                    onChange={(e) => { setStateCode(e.target.value); setDistrictCode(""); }}
                    required
                  >
                    <option value="">Select</option>
                    {states.map(s => (
                      <option key={s.stateCode} value={s.stateCode}>{s.stateName}</option>
                    ))}
                  </select>
                </Field>
                {districts.length > 0 && (
                  <Field label="District">
                    <select
                      style={styles.select}
                      value={districtCode}
                      onChange={(e) => setDistrictCode(e.target.value)}
                    >
                      <option value="">Select</option>
                      {districts.map(d => (
                        <option key={d.districtCode} value={d.districtCode}>{d.districtName}</option>
                      ))}
                    </select>
                  </Field>
                )}
              </div>
            </div>

            <div style={styles.sectionDivider} />
            <p style={styles.heading}>Emergency Contact</p>
            <div style={styles.fieldGroup}>
              <Field label="Full Name">
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Contact person's name"
                  value={emergencyName}
                  onChange={(e) => setEmergencyName(e.target.value)}
                />
              </Field>
              <Field label="Phone Number">
                <input
                  style={styles.input}
                  type="tel"
                  placeholder="+91 XXXXX XXXXX"
                  value={emergencyPhone}
                  onChange={(e) => setEmergencyPhone(e.target.value)}
                />
              </Field>
            </div>

            <div style={styles.buttonRow}>
              <button type="submit" style={styles.btnPrimary}>Continue →</button>
            </div>
          </form>
        )}

        {/* ───── PART 2 ───── */}
        {part === 1 && (
          <form onSubmit={handlePart1Continue}>
            <p style={styles.heading}>Blood Details</p>
            <div style={styles.fieldGroup}>
              <Field label="Blood Group">
                <select
                  style={styles.select}
                  value={bloodGroupId}
                  onChange={(e) => setBloodGroupId(e.target.value)}
                  required
                >
                  <option value="">Select Blood Group</option>
                  {Object.entries(bloodGroups).map(([name, code]) => (
                    <option key={code} value={code}>{name}</option>
                  ))}
                </select>
              </Field>

              <Field label="Willing to Donate Blood?">
                <select
                  style={styles.select}
                  value={donor}
                  onChange={(e) => setDonor(e.target.value === "true")}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </Field>
            </div>

            <div style={styles.buttonRow}>
              <button type="button" style={styles.btnSecondary} onClick={() => setPart(0)}>← Back</button>
              <button type="submit" style={styles.btnPrimary}>
                {donor ? "Continue →" : "Submit Details"}
              </button>
            </div>
          </form>
        )}

        {/* ───── PART 3 (donor only) ───── */}
        {part === 2 && donor && (
          <div>
            <p style={styles.heading}>Donor Screening</p>
            <div style={styles.fieldGroup}>
              <Field label="Last Donation Date">
                <input
                  style={styles.input}
                  type="date"
                  value={lastDonationDate}
                  onChange={(e) => setLastDonationDate(e.target.value)}
                />
              </Field>
              <Field label="Donation Camp / Organisation">
                <input
                  style={styles.input}
                  type="text"
                  placeholder="Optional"
                  value={donationCamp}
                  onChange={(e) => setDonationCamp(e.target.value)}
                />
              </Field>
            </div>

            <div style={styles.sectionDivider} />
            <p style={{ ...styles.label, marginBottom: "10px" }}>Health Screening</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "20px" }}>
              <CheckRow checked={recentTattoo} onChange={(e) => setRecentTattoo(e.target.checked)}>
                Tattoo or piercing in the last 6 months?
              </CheckRow>
              <CheckRow checked={pregnant} onChange={(e) => setPregnant(e.target.checked)}>
                Currently pregnant or breastfeeding?
              </CheckRow>
              <CheckRow checked={underweight} onChange={(e) => setUnderweight(e.target.checked)}>
                Body weight under 50 kg?
              </CheckRow>
              <CheckRow checked={onMedication} onChange={(e) => setOnMedication(e.target.checked)}>
                Currently on any medication?
              </CheckRow>
              {onMedication && (
                <Field label="Medication Name & Dosage">
                  <input
                    style={styles.input}
                    type="text"
                    placeholder="e.g. Metformin 500mg"
                    value={medicationDetails}
                    onChange={(e) => setMedicationDetails(e.target.value)}
                  />
                </Field>
              )}
              <CheckRow checked={hasDisease} onChange={(e) => setHasDisease(e.target.checked)}>
                Diagnosed with HIV/AIDS, Hepatitis, Malaria, or Syphilis?
              </CheckRow>
            </div>

            {!isEligibleToDonate && (
              <div style={styles.warning}>
                ⚠ Based on your responses, you may not be eligible to donate at this time. You can still complete your profile.
              </div>
            )}

            <div style={styles.buttonRow}>
              <button type="button" style={styles.btnSecondary} onClick={() => setPart(1)}>← Back</button>
              <button
                type="button"
                style={{ ...styles.btnPrimary, opacity: loading ? 0.6 : 1, cursor: loading ? "not-allowed" : "pointer" }}
                onClick={handleSubmit}
                disabled={loading}
              >
                {loading ? "Saving…" : "Submit Details"}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
