import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth";
import { rpcErrorResponse } from "../admin/rpcError";

// Deletes the signed-in user's own account (#18). delete_my_account() removes the
// auth user, and the database cascades to everything the person owns.
export async function DELETE() {
  const supabase = await createClient();
  const { response } = await requireUser(supabase);
  if (response) return response;

  const { error } = await supabase.rpc("delete_my_account");
  if (error) return rpcErrorResponse(error);
  // The session ended with the user; this clears its cookies from the browser.
  await supabase.auth.signOut({ scope: "local" });
  return NextResponse.json({ ok: true });
}
