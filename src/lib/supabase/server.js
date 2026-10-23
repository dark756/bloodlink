import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase client for server components and route handlers. Queries run as the
// signed-in user, so row-level security applies. No service-role key is used.
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server components can't set cookies. The proxy refreshes the
            // session on every page request, so this is safe to ignore.
          }
        },
      },
    },
  );
}
