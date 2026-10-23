"use client";
import { useEffect, useState } from "react";
import axios from "axios";
import { STATES, districtsFor, getDistrictName, getStateName } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import {
  ORGANIZATION_KINDS,
  ORGANIZATION_STATUS_BADGE_CLASSES,
  ORGANIZATION_STATUS_LABELS,
} from "@/lib/organization";

const EMPTY_FORM = {
  kind: "hospital",
  name: "",
  registrationNumber: "",
  eraktkoshCode: "",
  stateCode: "",
  districtCode: "",
  address: "",
  phone: "",
};

// One of the user's own applications, with its status and the reviewer's note.
function ApplicationCard({ application }) {
  return (
    <div className="card mt-5">
      <h2 className="card-title flex items-center justify-between gap-2">
        <span>{application.name}</span>
        <span className={ORGANIZATION_STATUS_BADGE_CLASSES[application.status]}>
          {ORGANIZATION_STATUS_LABELS[application.status]}
        </span>
      </h2>
      <div className="card-body text-sm">
        <p className="text-[#666]">
          {ORGANIZATION_KINDS[application.kind]} · Registration {application.registration_number}
          {application.eraktkosh_code && ` · eRaktKosh code ${application.eraktkosh_code}`}
        </p>
        <p className="text-[#666] mt-1">
          {application.address},{" "}
          {getDistrictName(application.state_code, application.district_code) ?? ""}{" "}
          {getStateName(application.state_code) ?? ""} · {application.phone}
        </p>
        <p className="text-xs text-[#666] mt-2">
          Submitted {formatDate(application.created_at)}
          {application.reviewed_at && ` · Reviewed ${formatDate(application.reviewed_at)}`}
        </p>
        {application.status === "pending" && (
          <p className="notice notice-warn mt-3">
            An administrator will check these details before verifying the account.
          </p>
        )}
        {application.status === "approved" && (
          <p
            className="notice mt-3"
            style={{ background: "#e6f4ea", borderColor: "#b7dfc4", color: "#1b7a41" }}
          >
            Your account is verified as a {ORGANIZATION_KINDS[application.kind].toLowerCase()}.
          </p>
        )}
        {application.review_note && (
          <p className="text-sm mt-3">
            <strong>Reviewer note:</strong> {application.review_note}
          </p>
        )}
      </div>
    </div>
  );
}

export default function OrganizationPage() {
  const [applications, setApplications] = useState(undefined); // undefined = loading
  const [form, setForm] = useState(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/organization")
      .then(({ data }) => {
        if (!isCancelled) setApplications(data.applications);
      })
      .catch(() => {
        if (!isCancelled) {
          setApplications([]);
          setError("Could not load your applications. Please refresh the page.");
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  // Returns an onChange handler that copies an input's value into the form.
  const handleFieldChange = (fieldName) => (event) =>
    setForm((current) => ({ ...current, [fieldName]: event.target.value }));
  const districts = districtsFor(form.stateCode);
  // A pending or approved application blocks a new one (the database allows only one).
  const openApplication = applications?.find(
    (application) => application.status === "pending" || application.status === "approved",
  );

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");
    try {
      const { data } = await axios.post("/api/organization", { organization: form });
      setApplications((current) => [data.application, ...(current ?? [])]);
      setForm(EMPTY_FORM);
    } catch (err) {
      setError(err?.response?.data?.error || "Could not submit the application. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="page-wrap-small">
      <h1 className="page-title">Register an organization</h1>
      <p className="page-subtitle">
        Hospitals and blood banks get extra tools once an administrator verifies them. Individual
        donors don&apos;t need this.
      </p>

      {error && <p className="notice notice-error mt-5">{error}</p>}

      {applications === undefined ? (
        <p className="text-sm text-[#666] mt-5">Loading…</p>
      ) : (
        <>
          {applications.map((application) => (
            <ApplicationCard key={application.id} application={application} />
          ))}

          {!openApplication && (
            <form onSubmit={handleSubmit} className="card card-body mt-5 flex flex-col gap-3">
              <h2 className="font-semibold text-[#222]">
                {applications.length > 0 ? "Submit a new application" : "Application"}
              </h2>

              <div>
                <label className="label" htmlFor="kind">
                  Type
                </label>
                <select
                  id="kind"
                  className="select"
                  value={form.kind}
                  onChange={handleFieldChange("kind")}
                >
                  {Object.entries(ORGANIZATION_KINDS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label" htmlFor="name">
                  Organization name
                </label>
                <input
                  id="name"
                  className="input"
                  value={form.name}
                  onChange={handleFieldChange("name")}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="registrationNumber">
                    Registration / licence no.
                  </label>
                  <input
                    id="registrationNumber"
                    className="input"
                    value={form.registrationNumber}
                    onChange={handleFieldChange("registrationNumber")}
                    required
                  />
                </div>
                <div>
                  <label className="label" htmlFor="eraktkoshCode">
                    eRaktKosh code (optional)
                  </label>
                  <input
                    id="eraktkoshCode"
                    className="input"
                    inputMode="numeric"
                    value={form.eraktkoshCode}
                    onChange={handleFieldChange("eraktkoshCode")}
                    placeholder="Blood banks only"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label" htmlFor="state">
                    State
                  </label>
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
                </div>
                {districts.length > 0 && (
                  <div>
                    <label className="label" htmlFor="district">
                      District
                    </label>
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
                  </div>
                )}
              </div>
              <div>
                <label className="label" htmlFor="address">
                  Address
                </label>
                <input
                  id="address"
                  className="input"
                  value={form.address}
                  onChange={handleFieldChange("address")}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="phone">
                  Phone
                </label>
                <input
                  id="phone"
                  className="input"
                  type="tel"
                  value={form.phone}
                  onChange={handleFieldChange("phone")}
                  required
                />
              </div>
              <button type="submit" className="btn btn-primary mt-2" disabled={isSubmitting}>
                {isSubmitting ? "Submitting…" : "Submit for verification"}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
