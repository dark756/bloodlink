import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { jsonError, requireUser } from "@/lib/auth";
import { sanitizeCardAction, toCard } from "@/lib/donorCards";
import { rpcErrorResponse } from "@/app/api/admin/rpcError";

// The signed-in donor's request cards and their answers. Every call runs as that user through
// the database functions, which take the id from the session; nothing here reads a user id
// from the request. Before the migration is applied the functions don't exist: GET then
// answers { available: false }. For someone who isn't in the network the list is empty.
export const dynamic = "force-dynamic";

// A missing function (PGRST202, 42883) or table, before the migration.
const isMissingObject = (error) => ["42P01", "PGRST205", "PGRST202", "42883"].includes(error?.code);

export async function GET() {
  const supabase = await createClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { data, error } = await supabase.rpc("my_request_cards");
  if (error) {
    if (isMissingObject(error)) return NextResponse.json({ available: false, cards: [] });
    return rpcErrorResponse(error);
  }
  return NextResponse.json({ available: true, cards: (data ?? []).map(toCard) });
}

export async function POST(request) {
  const supabase = await createClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  const input = sanitizeCardAction(body);
  if (input.error) return jsonError(input.error, 400);

  let result;
  if (input.action === "respond") {
    result = await supabase.rpc("respond", {
      p_request_id: input.requestId,
      p_accept: input.accept,
    });
  } else if (input.action === "cancel") {
    result = await supabase.rpc("cancel_response", { p_request_id: input.requestId });
  } else if (input.action === "seen") {
    result = await supabase.rpc("mark_card_seen", { p_request_id: input.requestId });
  } else {
    result = await supabase.rpc("check_in", { p_request_id: input.requestId, p_code: input.code });
  }
  if (result.error) {
    if (isMissingObject(result.error)) return jsonError("Requests aren't open yet.", 503);
    return rpcErrorResponse(result.error);
  }
  return NextResponse.json({ message: "Done" });
}
