import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { rpcErrorResponse } from "../../rpcError";

const ASSIGNABLE_ROLES = ["user", "admin"];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Body: { userId, role: "user" | "admin" }
export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireAdmin(supabase);
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (typeof body?.userId !== "string" || !UUID_PATTERN.test(body.userId)) {
    return jsonError("Invalid user.", 400);
  }
  if (!ASSIGNABLE_ROLES.includes(body?.role)) {
    return jsonError("Role must be user or admin.", 400);
  }

  // set_user_role() checks is_admin(), protects the last admin, and writes the audit log.
  const { error } = await supabase.rpc("set_user_role", {
    p_user_id: body.userId,
    p_role: body.role,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ ok: true });
}
