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

  var isEligibleToDonate =
    donor &&
    !recentTattoo &&
    !pregnant &&
    !underweight &&
    !hasDisease;


  useEffect(() => { //update districts when state changes
    const selectedState = states.find(s => s.stateCode === stateCode);

    if (selectedState) {
      setDistricts(selectedState.districts);
      setDistrictCode("");
    } else {
      setDistricts([]);
    }
  }, [stateCode, states]);

  useEffect(() => {
    //get partial data to prefill form if user has already filled some details
  }, []);

  const handleSubmit = async () => {
    setLoading(true);
    setPart(part + 1);

    const payload = {
      email: session.user.email,
      details:{
      fullName,
      dob,
      gender,
      phone,
      stateCode,
      districtCode,
      emergencyContact: {
        name: emergencyName,
        phone: emergencyPhone,
      },

      isDonor: donor,
      bloodGroupId,
      donorDetails: donor
        ? {
          lastDonationDate: lastDonationDate || null,
          donationCamp: donationCamp || null,
          recentTattoo,
          pregnant,
          underweight,
          onMedication,
          medicationDetails: onMedication ? medicationDetails : null,
          hasDisease,
          isEligibleToDonate,
        }
        : null,

      isProfileComplete: true
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
  }
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
    // Skip part 2 entirely if not a donor
    donor ? setPart(2) : handleSubmit();
  };

  return (
    <div>
      <h1>Set Details Page</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}

      {/* ───── PART 1 ───── */}
      {part === 0 && (
        <form onSubmit={handlePart0Continue}>
          <input
            type="text"
            placeholder="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          /><br />

          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            required
          /><br />

          <select value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="other">Other</option>
          </select><br />

          <input
            type="tel"
            placeholder="Phone number"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          /><br />

          <select
            value={stateCode}
            onChange={(e) => { setStateCode(e.target.value); setDistrictCode(""); }}
            required
          >
            <option value="">Select State</option>
            {states.map(s => (
              <option key={s.stateCode} value={s.stateCode}>{s.stateName}</option>
            ))}
          </select><br />

          {districts.length > 0 && (
            <select
              value={districtCode}
              onChange={(e) => setDistrictCode(e.target.value)}
            >
              <option value="">Select District</option>
              {districts.map(d => (
                <option key={d.districtCode} value={d.districtCode}>{d.districtName}</option>
              ))}
            </select>
          )}<br />

          <input
            type="text"
            placeholder="Emergency contact: full name"
            value={emergencyName}
            onChange={(e) => setEmergencyName(e.target.value)}
          /><br />

          <input
            type="tel"
            placeholder="Emergency contact: phone number"
            value={emergencyPhone}
            onChange={(e) => setEmergencyPhone(e.target.value)}
          /><br />

          <button type="submit">Continue</button>
        </form>
      )}

      {/* ───── PART 2 ───── */}
      {part === 1 && (
        <form onSubmit={handlePart1Continue}>
          <h2>Part 2: Blood Details</h2>

          <p>Do you wish to donate blood?</p>
          <select
            value={donor}
            onChange={(e) => setDonor(e.target.value === "true")}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select><br />

          <p>Select blood type</p>
          <select
            value={bloodGroupId}
            onChange={(e) => setBloodGroupId(e.target.value)}
            required
          >
            <option value="">Select Blood Group</option>
            {Object.entries(bloodGroups).map(([name, code]) => (
              <option key={code} value={code}>{name}</option>
            ))}
          </select><br />

          <button type="button" onClick={() => setPart(0)}>Back</button>
          {/* label changes based on whether donor screening is needed */}
          <button type="submit">{donor ? "Continue" : "Submit details"}</button>
        </form>
      )}

      {/* ───── PART 3 (donor only) ───── */}
      {part === 2 && donor && (
        <div>
          <h2>Part 3: Donor Screening</h2>

          <input
            type="date"
            placeholder="Last donation date"
            value={lastDonationDate}
            onChange={(e) => setLastDonationDate(e.target.value)}
          /><br />

          <input
            type="text"
            placeholder="Donation camp organization (if applicable)"
            value={donationCamp}
            onChange={(e) => setDonationCamp(e.target.value)}
          /><br />

          <label>
            <input
              type="checkbox"
              checked={recentTattoo}
              onChange={(e) => setRecentTattoo(e.target.checked)}
            /> Recent tattoo or piercing in last 6 months?
          </label><br />

          <label>
            <input
              type="checkbox"
              checked={pregnant}
              onChange={(e) => setPregnant(e.target.checked)}
            /> Currently pregnant or breastfeeding?
          </label><br />

          <label>
            <input
              type="checkbox"
              checked={underweight}
              onChange={(e) => setUnderweight(e.target.checked)}
            /> Weight under 50kg?
          </label><br />

          <label>
            <input
              type="checkbox"
              checked={onMedication}
              onChange={(e) => setOnMedication(e.target.checked)}
            /> Currently on any medication?
          </label><br />

          {onMedication && (
            <input
              type="text"
              placeholder="Specify medication name and dosage"
              value={medicationDetails}
              onChange={(e) => setMedicationDetails(e.target.value)}
            />
          )}<br />

          <label>
            <input
              type="checkbox"
              checked={hasDisease}
              onChange={(e) => setHasDisease(e.target.checked)}
            /> HIV/AIDS/Hepatitis/Malaria/Syphilis diagnosis?
          </label><br />

          {/* Show eligibility warning before submit */}
          {!isEligibleToDonate && (
            <p style={{ color: "orange" }}>
              ⚠️ Based on your answers, you may not be eligible to donate right now.
              You can still complete your profile.
            </p>
          )}

          <button type="button" onClick={() => setPart(1)}>Back</button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Saving..." : "Submit details"}
          </button>
        </div>
      )}
    </div>
  );
}