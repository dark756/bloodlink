import { getDistrictName, getStateName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import {
  ORGANIZATION_KINDS,
  ORGANIZATION_STATUS_BADGE_CLASSES,
  ORGANIZATION_STATUS_LABELS,
} from "@/lib/organization";
import { OrganizationActions } from "./AdminActions";

// Columns the admin pages read for an application, plus the applicant's and reviewer's
// names through the two foreign keys to profiles.
export const ORGANIZATION_SELECT =
  "id, kind, name, registration_number, eraktkosh_code, state_code, district_code, address, phone, status, review_note, reviewed_at, created_at, " +
  "applicant:profiles!organizations_applicant_id_fkey(email, full_name), reviewer:profiles!organizations_reviewed_by_fkey(email)";

// Server component: one application with its review controls.
export default function OrganizationCard({ organization }) {
  const location = [
    getDistrictName(organization.state_code, organization.district_code),
    getStateName(organization.state_code),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <li className="result-item">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="result-name">{organization.name}</h3>
        <span className={ORGANIZATION_STATUS_BADGE_CLASSES[organization.status]}>
          {ORGANIZATION_STATUS_LABELS[organization.status]}
        </span>
      </div>
      <p className="result-address">
        {ORGANIZATION_KINDS[organization.kind]} · Registration {organization.registration_number}
        {organization.eraktkosh_code
          ? ` · eRaktKosh code ${organization.eraktkosh_code}`
          : " · no eRaktKosh code"}
      </p>
      <p className="result-address">
        {organization.address}
        {location && `, ${location}`} · {organization.phone}
      </p>
      <p className="text-xs text-[#666] mt-1">
        Applied by {organization.applicant?.full_name || "unknown"} (
        {organization.applicant?.email || "no email"}) on {formatDateTime(organization.created_at)}
        {organization.reviewed_at &&
          ` · last reviewed ${formatDateTime(organization.reviewed_at)} by ${organization.reviewer?.email ?? "an admin"}`}
      </p>
      {organization.review_note && (
        <p className="text-xs mt-1">
          <strong>Note:</strong> {organization.review_note}
        </p>
      )}
      <OrganizationActions organizationId={organization.id} status={organization.status} />
    </li>
  );
}
