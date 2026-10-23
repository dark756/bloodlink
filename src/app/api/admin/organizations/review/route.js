import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { rpcErrorResponse } from "../../rpcError";

const DECISIONS = ["approved", "rejected", "suspended"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Body: { organizationId, decision: "approved" | "rejected" | "suspended", note? }
export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireAdmin(supabase);
  if (response) return response;

  const body = await request.json().catch(() => null);
  const organizationId = body?.organizationId;
  const decision = body?.decision;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;

  if (typeof organizationId !== "string" || !UUID_PATTERN.test(organizationId)) {
    return jsonError("Invalid organization.", 400);
  }
  if (!DECISIONS.includes(decision)) return jsonError("Invalid decision.", 400);

  // review_organization() checks is_admin() itself and writes the audit log.
  const { error } = await supabase.rpc("review_organization", {
    p_organization_id: organizationId,
    p_decision: decision,
    p_note: note || null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ ok: true });
}
