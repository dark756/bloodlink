import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { rpcErrorResponse } from "../rpcError";

// The flags an admin may switch (docs/PLANS/ML_system.md, A6 and Parts B and C):
// the forecast's mark, its ranking factor and its suggestions to donors, and admins'
// stock-out events.
const SWITCHABLE_FLAGS = ["forecast_badge", "forecast_ranking", "forecast_appeals", "admin_events"];

// Body: { name: one of SWITCHABLE_FLAGS, isEnabled: boolean }
export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireAdmin(supabase);
  if (response) return response;

  const body = await request.json().catch(() => null);
  if (!SWITCHABLE_FLAGS.includes(body?.name)) {
    return jsonError(`Flag must be one of ${SWITCHABLE_FLAGS.join(", ")}.`, 400);
  }
  if (typeof body?.isEnabled !== "boolean")
    return jsonError("isEnabled must be true or false.", 400);

  // set_feature_flag() checks is_admin() and writes the audit log.
  const { error } = await supabase.rpc("set_feature_flag", {
    p_name: body.name,
    p_enabled: body.isEnabled,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ ok: true });
}
