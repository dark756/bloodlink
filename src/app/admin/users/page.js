import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getBloodGroupName } from "@/lib/constants";
import { formatDateTime } from "@/lib/format";
import { RoleActions } from "../AdminActions";

const ROLES = ["user", "hospital", "blood_bank", "admin"];
const ROLE_LABELS = {
  user: "User",
  hospital: "Hospital",
  blood_bank: "Blood bank",
  admin: "Admin",
};

// Keep only characters that are safe inside a PostgREST filter value.
function sanitizeSearchText(value) {
  return typeof value === "string"
    ? value
        .replace(/[^\p{L}\p{N}@._ +-]/gu, "")
        .trim()
        .slice(0, 60)
    : "";
}

export default async function AdminUsersPage({ searchParams }) {
  const params = await searchParams;
  const searchText = sanitizeSearchText(params?.q);
  const role = ROLES.includes(params?.role) ? params.role : null;

  const supabase = await createClient();
  const currentUser = await getCurrentUser(supabase);

  let query = supabase
    .from("profiles")
    .select(
      "id, email, full_name, role, is_donor, is_profile_complete, blood_group_code, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(100);
  if (searchText) {
    query = query.or(`email.ilike.%${searchText}%,full_name.ilike.%${searchText}%`);
  }
  if (role) query = query.eq("role", role);
  const { data, error } = await query;

  return (
    <div className="card">
      <form className="card-title flex flex-wrap gap-2 items-center" action="/admin/users">
        <input
          name="q"
          defaultValue={searchText}
          placeholder="Search name or email"
          className="input"
          style={{ maxWidth: 260 }}
        />
        <select name="role" defaultValue={role ?? ""} className="select" style={{ maxWidth: 160 }}>
          <option value="">All roles</option>
          {ROLES.map((roleOption) => (
            <option key={roleOption} value={roleOption}>
              {ROLE_LABELS[roleOption]}
            </option>
          ))}
        </select>
        <button className="btn btn-outline btn-small" type="submit">
          Filter
        </button>
      </form>

      {error ? (
        <p className="card-body notice notice-error">Could not load users: {error.message}</p>
      ) : data.length === 0 ? (
        <p className="card-body text-sm text-[#666]">No matching users.</p>
      ) : (
        <ul>
          {data.map((profile) => (
            <li
              key={profile.id}
              className="result-item flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="result-name">
                  {profile.full_name || "(no name)"}{" "}
                  <span className="badge ml-1">{ROLE_LABELS[profile.role]}</span>
                </p>
                <p className="result-address">{profile.email}</p>
                <p className="text-xs text-[#666] mt-1">
                  {profile.is_profile_complete ? "Profile complete" : "Profile incomplete"}
                  {profile.is_donor &&
                    ` · donor${profile.blood_group_code ? `, ${getBloodGroupName(profile.blood_group_code)}` : ""}`}
                  {` · joined ${formatDateTime(profile.created_at)}`}
                </p>
              </div>
              <RoleActions
                userId={profile.id}
                role={profile.role}
                isSelf={profile.id === currentUser?.id}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
