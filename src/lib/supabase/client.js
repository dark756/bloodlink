"use client";
import { createBrowserClient } from "@supabase/ssr";

// Supabase client for client components. The session lives in cookies so the
// server (proxy, route handlers, server components) sees the same login.
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}
