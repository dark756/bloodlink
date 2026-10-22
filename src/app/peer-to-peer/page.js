"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";
import axios from "axios";
import { getBloodGroupName, getDistrictName, getStateName } from "@/lib/constants";

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function capitalise(value) {
  if (!value) return "-";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function Row({ label, children }) {
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

export default function PeerToPeer() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState(undefined); // undefined = loading, null = failed
  const [loadError, setLoadError] = useState("");

  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  useEffect(() => {
    if (status !== "authenticated") return undefined;
    let cancelled = false;
    axios
      .get("/api/details")
      .then(({ data }) => {
        if (!cancelled) setProfile(data);
      })
      .catch(() => {
        if (!cancelled) {
          setProfile(null);
          setLoadError("Could not load your profile. Please refresh the page.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const loading = status === "loading" || (status === "authenticated" && profile === undefined);
  const details = profile?.details ?? null;
  const eligibility = profile?.eligibility ?? null;

  return (
    <div className="page-wrap-small">
      <p className="notice notice-warn">
        🚧 This site is still under development. Donor matching is not working yet, so nothing here reaches a real donor.
      </p>

      <h1 className="page-title mt-5">Peer to Peer</h1>
      <p className="page-subtitle">Your donor profile. Matching with requests is coming next.</p>

      <div className="card mt-5">
        <h2 className="card-title">Your profile</h2>

        <div className="card-body">
          {loading ? (
            <p className="text-sm text-[#666]">Loading your profile...</p>
          ) : !session ? (
            <p className="text-sm text-[#666]">You are not signed in.</p>
          ) : loadError ? (
            <p className="notice notice-error">{loadError}</p>
          ) : (
            <>
              <div className="flex items-center gap-3">
                {session.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt={session.user.name ?? "User"}
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
                  <p className="result-name truncate">{details?.fullName || session.user?.name}</p>
                  <p className="result-address truncate">{session.user?.email}</p>
                </div>
              </div>

              {!details ? (
                <p className="text-sm text-[#666] mt-4">
                  You haven&apos;t filled in your details yet.{" "}
                  <Link href="/set-details" className="text-[#d32f2f] font-semibold">Complete your profile</Link>
                </p>
              ) : (
                <>
                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Personal</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <Row label="Full name">{details.fullName || "-"}</Row>
                      <Row label="Date of birth">{formatDate(details.dob)}</Row>
                      <Row label="Gender">{capitalise(details.gender)}</Row>
                      <Row label="Phone">{details.phone || "-"}</Row>
                      <Row label="State">{getStateName(details.stateCode) ?? "-"}</Row>
                      <Row label="District">{getDistrictName(details.stateCode, details.districtCode) ?? "-"}</Row>
                    </tbody>
                  </table>

                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Blood</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <Row label="Blood group">
                        <span className="badge badge-red">{getBloodGroupName(details.bloodGroupId) ?? "-"}</span>
                      </Row>
                      <Row label="Willing to donate">{details.isDonor ? "Yes" : "No"}</Row>
                    </tbody>
                  </table>

                  <h3 className="font-semibold text-[#222] mt-5 mb-1">Emergency contact</h3>
                  <table className="w-full text-sm">
                    <tbody>
                      <Row label="Name">{details.emergencyContact?.name || "-"}</Row>
                      <Row label="Phone">{details.emergencyContact?.phone || "-"}</Row>
                    </tbody>
                  </table>

                  {details.isDonor && details.donorDetails && (
                    <>
                      <h3 className="font-semibold text-[#222] mt-5 mb-1">Donor info</h3>
                      <table className="w-full text-sm">
                        <tbody>
                          <Row label="Last donation">{formatDate(details.donorDetails.lastDonationDate)}</Row>
                          <Row label="Donation camp">{details.donorDetails.donationCamp || "-"}</Row>
                          <Row label="Eligible to donate">
                            <EligibilityBadge eligibility={eligibility} />
                          </Row>
                          {eligibility?.nextEligibleDate && (
                            <Row label="Eligible again from">{formatDate(eligibility.nextEligibleDate)}</Row>
                          )}
                        </tbody>
                      </table>
                      {eligibility?.reasons?.length > 0 && (
                        <ul className="text-xs text-[#666] mt-2 list-disc ml-5">
                          {eligibility.reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}

                  <p className="text-xs text-[#666] mt-4">
                    Need to change something?{" "}
                    <Link href="/set-details" className="text-[#d32f2f] font-semibold">Edit your details</Link>
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
