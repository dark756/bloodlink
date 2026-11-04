import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireAdmin } from "@/lib/auth";
import { REVIEW_DECISIONS } from "@/lib/bankLocations";
import { getStateName } from "@/lib/constants";
import { createStateChecker } from "@/lib/stateBounds";
import stateBoundaries from "../../../../../../assets/state_boundaries.json";
import { rpcErrorResponse } from "../../rpcError";

const stateChecker = createStateChecker(stateBoundaries);
const CODE_PATTERN = /^[0-9]{1,10}$/;

// An admin's decision on a bank's position (/admin/locations; #33, #34).
// Body: { hospitalCode, decision: "accepted" | "moved" | "rejected" | "cant_place",
//         latitude?, longitude? (for moved), note? }
// A moved pin must lie in the bank's own state, by the same check location search
// uses, so a slip of the mouse can't send patients to another state.
export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireAdmin(supabase);
  if (response) return response;

  const body = await request.json().catch(() => null);
  const hospitalCode = String(body?.hospitalCode ?? "");
  const decision = body?.decision;
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) : null;
  if (!CODE_PATTERN.test(hospitalCode)) return jsonError("Invalid bank code.", 400);
  if (!REVIEW_DECISIONS.includes(decision)) return jsonError("Invalid decision.", 400);

  let latitude = null;
  let longitude = null;
  if (decision === "moved") {
    latitude = Number(body?.latitude);
    longitude = Number(body?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return jsonError("Place the pin on the map first.", 400);
    }
    const { data: stockRow, error } = await supabase
      .from("bank_stock_latest")
      .select("state_code")
      .eq("hospital_code", hospitalCode)
      .maybeSingle();
    if (error) return jsonError("Could not check the bank's state. Please try again.", 500);
    const stateCode = stockRow?.state_code;
    if (!stateCode) return jsonError("Bank not found.", 404);
    const problem = stateChecker.locationProblem({ latitude, longitude, stateCode });
    if (problem !== null) {
      return jsonError(
        `That pin is outside ${getStateName(stateCode) ?? "the bank's state"}. Place it in the bank's own state.`,
        400,
      );
    }
  }

  // review_bank_location() checks is_admin() itself and writes the audit log.
  const { error } = await supabase.rpc("review_bank_location", {
    p_hospital_code: hospitalCode,
    p_decision: decision,
    p_latitude: latitude,
    p_longitude: longitude,
    p_note: note || null,
  });
  if (error) return rpcErrorResponse(error);
  return NextResponse.json({ ok: true });
}
