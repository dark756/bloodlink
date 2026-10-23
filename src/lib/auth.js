import { NextResponse } from "next/server";

// Server-side identity helpers. getClaims() verifies the access token
// (locally when the project uses asymmetric signing keys), so the result can be
// trusted, unlike getSession().

export async function getCurrentUser(supabase) {
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  const metadata = claims.user_metadata ?? {};
  return {
    id: claims.sub,
    email: claims.email ?? null,
    name: metadata.full_name ?? metadata.name ?? null,
    avatarUrl: metadata.avatar_url ?? metadata.picture ?? null,
  };
}

export async function getCurrentProfile(supabase, userId) {
  const { data } = await supabase
    .from("profiles")
    .select("id, email, full_name, role, is_profile_complete, organization_id")
    .eq("id", userId)
    .maybeSingle();
  return data ?? null;
}

export function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}

// For API routes: returns { user } or a ready-made error response.
export async function requireUser(supabase) {
  const user = await getCurrentUser(supabase);
  if (!user) return { response: jsonError("Not signed in", 401) };
  return { user };
}

// For API routes: returns { user, profile } for an admin, or a ready-made error response.
export async function requireAdmin(supabase) {
  const user = await getCurrentUser(supabase);
  if (!user) return { response: jsonError("Not signed in", 401) };
  const profile = await getCurrentProfile(supabase, user.id);
  if (profile?.role !== "admin") return { response: jsonError("Admins only", 403) };
  return { user, profile };
}

// Only allow same-site relative redirects, never "//evil.com" or absolute URLs.
export function safeNextPath(value, fallback = "/") {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  ) {
    return fallback;
  }
  return value;
}
