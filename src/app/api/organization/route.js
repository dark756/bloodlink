import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireUser } from "@/lib/auth";
import { sanitizeOrganization } from "@/lib/organization";

const ORGANIZATION_COLUMNS =
  "id, kind, name, registration_number, eraktkosh_code, state_code, district_code, address, phone, status, review_note, reviewed_at, created_at";

// The signed-in user's own applications, newest first.
export async function GET() {
  const supabase = await createClient();
  const { user, response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase
    .from("organizations")
    .select(ORGANIZATION_COLUMNS)
    .eq("applicant_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/organization failed:", error.message);
    return jsonError("Could not load your applications.", 500);
  }
  return NextResponse.json({ applications: data });
}

// Submit a new application. It always starts as "pending": status isn't an
// insertable column, and the row-level policy rejects anything else.
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

  const { row, errors } = sanitizeOrganization(body?.organization);
  if (errors.length > 0) {
    return NextResponse.json({ error: errors[0], errors }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("organizations")
    .insert(row)
    .select(ORGANIZATION_COLUMNS)
    .single();
  if (error) {
    // 23505 is a unique violation: the one-open-application-per-person index.
    if (error.code === "23505") {
      return jsonError("You already have an application that is pending or approved.", 409);
    }
    console.error(`POST /api/organization failed for ${user.id}:`, error.message);
    return jsonError("Could not submit the application. Please check the form and try again.", 400);
  }
  return NextResponse.json({ application: data }, { status: 201 });
}
