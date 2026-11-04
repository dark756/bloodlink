import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { BLOOD_GROUPS, COMPONENTS } from "@/lib/constants";
import { rpcErrorResponse } from "../rpcError";

// Stock-out events an admin makes (docs/PLANS/ML_system.md, Part C, in the closed
// beta). create_admin_event() and end_admin_event() check is_admin() and write the
// audit log; an event ends by itself after its window.
//
// POST { action: "create", hospitalCode, componentId, bloodGroupId, windowHours, reason }
// POST { action: "end", id }

const WINDOWS = [24, 48, 72];
const CODE_PATTERN = /^[0-9]{1,10}$/;

export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireAdmin(supabase);
  if (response) return response;
  const body = await request.json().catch(() => null);

  if (body?.action === "end") {
    if (!Number.isInteger(body.id) || body.id < 1) return jsonError("Invalid event.", 400);
    const { error } = await supabase.rpc("end_admin_event", { p_id: body.id });
    if (error) return rpcErrorResponse(error);
    return NextResponse.json({ ok: true });
  }

  if (body?.action !== "create") return jsonError("Action must be create or end.", 400);
  const hospitalCode = String(body.hospitalCode ?? "").trim();
  if (!CODE_PATTERN.test(hospitalCode)) return jsonError("Enter the bank's eRaktKosh code.", 400);
  if (!COMPONENTS.some((component) => component.code === String(body.componentId))) {
    return jsonError("Choose a component.", 400);
  }
  if (!BLOOD_GROUPS.some((group) => group.code === String(body.bloodGroupId))) {
    return jsonError("Choose a blood group.", 400);
  }
  if (!WINDOWS.includes(body.windowHours)) return jsonError("Choose 24, 48 or 72 hours.", 400);
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10 || reason.length > 200) {
    return jsonError("Give a reason of 10 to 200 characters.", 400);
  }
  const { data, error } = await supabase.rpc("create_admin_event", {
    p_hospital_code: hospitalCode,
    p_component_id: String(body.componentId),
    p_group_code: String(body.bloodGroupId),
    p_window_hours: body.windowHours,
    p_reason: reason,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ ok: true, id: data });
}
