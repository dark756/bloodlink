"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import axios from "axios";
import { getBloodGroupName, getDistrictName, getStateName } from "@/lib/constants";
import { capitalize, formatDate, getInitials } from "@/lib/format";

const ROLE_LABELS = {
  hospital: "Verified hospital account",
  blood_bank: "Verified blood bank account",
  admin: "Administrator",
};

function DetailRow({ label, children }) {
  return (
    <tr className="border-t border-[#e0e0e0]">
      <td className="py-2 text-[#666] w-1/2">{label}</td>
      <td className="py-2 text-right">{children}</td>
    </tr>
  );
}

function EligibilityBadge({ eligibility }) {
  if (!eligibility || eligibility.status === "not-donor") return "-";
  if (eligibility.status === "eligible") return <span className="badge badge-green">Yes</span>;
  if (eligibility.status === "review") return <span className="badge">Needs a staff check</span>;
  return <span className="badge">Not right now</span>;
}

export default function PeerToPeerPage() {
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = failed
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    axios
      .get("/api/details")
      .then(({ data }) => {
        if (!isCancelled) setProfile(data);
      })
      .catch(() => {
        if (!isCancelled) {
          setProfile(null);
          setLoadError("Could not load your profile. Please refresh the page.");
        }
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const details = profile?.details ?? null;
  const eligibility = profile?.eligibility ?? null;
  const displayName = details?.fullName || profile?.name || profile?.email || "";
  const initials = getInitials(displayName);

  return (
    <div className="page-wrap-small">
      <p className="notice notice-warn">
        🚧 This site is still under development. Donor matching is not working yet, so nothing here
        reaches a real donor.
      </p>

      <h1 className="page-title mt-5">Peer to Peer</h1>
      <p className="page-subtitle">Your donor profile. Matching with requests is coming next.</p>

      <div className="card mt-5">
        <h2 className="card-title">Your profile</h2>

        <div className="card-body">
          {profile === undefined ? (
            <p className="text-sm text-[#666]">Loading your profile...</p>
          ) : loadError ? (
            <p className="notice notice-error">{loadError}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {profile.avatarUrl ? (
                  <Image
                    src={profile.avatarUrl}
                    alt={displayName || "User"}
                    width={48}
                    height={48}
                    className="h-12 w-12 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-12 w-12 rounded-full bg-[#fdeaea] text-[#d32f2f] text-sm font-semibold flex items-center justify-center">
                    {initials}
                  </div>
                )}
                <div className="min-w-0">
                  <p className="result-name truncate">{displayName}</p>
                  <p className="result-address truncate">{profile.email}</p>
                  {ROLE_LABELS[profile.role] && (
                    <span className="badge badge-green mt-1">{ROLE_LABELS[profile.role]}</span>
                  )}
                </div>
              </div>

              {!details ? (
                <p className="text-sm text-[#666] mt-4">
                  You haven&apos;t filled in your details yet.{" "}
                  <Link href="/set-details" className="text-[#d32f2f] font-semibold">
                    Complete your profile
                  </Link>
                </p>
              ) : (
                <>
                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Personal</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <DetailRow label="Full name">{details.fullName || "-"}</DetailRow>
                      <DetailRow label="Date of birth">{formatDate(details.dob)}</DetailRow>
                      <DetailRow label="Gender">{capitalize(details.gender)}</DetailRow>
                      <DetailRow label="Phone">{details.phone || "-"}</DetailRow>
                      <DetailRow label="State">{getStateName(details.stateCode) ?? "-"}</DetailRow>
                      <DetailRow label="District">
                        {getDistrictName(details.stateCode, details.districtCode) ?? "-"}
                      </DetailRow>
                    </tbody>
                  </table>

                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Blood</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <DetailRow label="Blood group">
                        <span className="badge badge-red">
                          {getBloodGroupName(details.bloodGroupId) ?? "-"}
                        </span>
                      </DetailRow>
                      <DetailRow label="Willing to donate">
                        {details.isDonor ? "Yes" : "No"}
                      </DetailRow>
                    </tbody>
                  </table>

                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Emergency contact</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <DetailRow label="Name">{details.emergencyContact?.name || "-"}</DetailRow>
                      <DetailRow label="Phone">{details.emergencyContact?.phone || "-"}</DetailRow>
                    </tbody>
                  </table>

                  {details.isDonor && details.donorDetails && (
                    <>
                      <h3 className="font-semibold text-[#222] mt-5 mb-1">Donor info</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          <DetailRow label="Last donation">
                            {formatDate(details.donorDetails.lastDonationDate)}
                          </DetailRow>
                          <DetailRow label="Donation camp">
                            {details.donorDetails.donationCamp || "-"}
                          </DetailRow>
                          <DetailRow label="Eligible to donate">
                            <EligibilityBadge eligibility={eligibility} />
                          </DetailRow>
                          {eligibility?.nextEligibleDate && (
                            <DetailRow label="Eligible again from">
                              {formatDate(eligibility.nextEligibleDate)}
                            </DetailRow>
                          )}
                        </tbody>
                      </table>
                      {eligibility?.reasons?.length > 0 && (
                        <ul className="text-xs text-[#666] mt-2 list-disc ml-5">
                          {eligibility.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  <p className="text-xs text-[#666] mt-4">
                    Need to change something?{" "}
                    <Link href="/set-details" className="text-[#d32f2f] font-semibold">
                      Edit your details
                    </Link>
                  </p>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
