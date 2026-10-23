import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";

// Finishes Google sign-in (?code=...) and email confirmation links
// (?code=... or ?token_hash=...&type=...), then sends the user on.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const nextPath = safeNextPath(searchParams.get("next"), "/");
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const otpType = searchParams.get("type");

  const supabase = await createClient();
  let error = null;

  if (code) {
    ({ error } = await supabase.auth.exchangeCodeForSession(code));
  } else if (tokenHash && otpType) {
    ({ error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: otpType }));
  } else {
    error = new Error("Missing sign-in code");
  }

  if (error) {
    console.error("auth callback failed:", error.message);
    return NextResponse.redirect(`${origin}/login?error=callback`);
  }
  return NextResponse.redirect(`${origin}${nextPath}`);
}
