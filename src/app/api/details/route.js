import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireUser } from "@/lib/auth";
import { sanitizeDetails } from "@/lib/profile";
import { detailsToRows, rowsToDetails } from "@/lib/profileStore";
import { evaluateEligibility } from "@/lib/eligibility";

// The signed-in user's own profile. Queries run as that user, so row-level
// security limits them to their own rows; there is no way to name another user.

export async function GET() {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const [{ data: profile, error }, { data: screening }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    supabase.from("donor_screening").select("*").eq("user_id", user.id).maybeSingle(),
  ]);
  if (error) {
    console.error("GET /api/details failed:", error.message);
    return jsonError("Could not load your profile. Please try again.", 500);
  }

  const draft = rowsToDetails(profile, screening);
  const details = profile?.is_profile_complete ? draft : null;

  return NextResponse.json({
    email: user.email,
    name: profile?.full_name || user.name,
    avatarUrl: user.avatarUrl,
    role: profile?.role ?? "user",
    details,
    // Partial answers (for example the name from Google) to prefill the form.
    draft,
    eligibility: details ? evaluateEligibility(details) : null,
  });
}

export async function POST(request) {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }

  const { details, errors } = sanitizeDetails(body?.details);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const rows = detailsToRows(details);
  const { data: updated, error: profileError } = await supabase
    .from("profiles")
    .update(rows.profile)
    .eq("id", user.id)
    .select("id");

  if (profileError) {
    console.error("profile update failed:", profileError.message);
    return jsonError("Could not save your details. Please check the form and try again.", 400);
  }
  if (!updated || updated.length === 0) {
    return jsonError("Your profile was not found. Please sign out and sign in again.", 404);
  }

  // Keep health answers only while the person is a donor.
  const screeningResult = rows.screening
    ? await supabase.from("donor_screening").upsert({ user_id: user.id, ...rows.screening })
    : await supabase.from("donor_screening").delete().eq("user_id", user.id);
  if (screeningResult.error) {
    console.error("screening save failed:", screeningResult.error.message);
    return jsonError(
      "Your details were saved, but the donor screening answers were not. Please try again.",
      500,
    );
  }

  return NextResponse.json({ message: "Details saved", eligibility: evaluateEligibility(details) });
}
