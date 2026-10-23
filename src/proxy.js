import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Runs before every page request (see config.matcher):
// 1. Refreshes the Supabase session and writes updated auth cookies.
// 2. Sends signed-out users away from protected pages to /login.
// 3. Sends users with an incomplete profile from /peer-to-peer to /set-details.
// 4. Keeps non-admins out of /admin. Admin pages and admin database functions
//    check the role again, so this is a convenience, not the only guard.

const PROTECTED_PATHS = ["/peer-to-peer", "/set-details", "/organization", "/admin"];

// True for the path itself and anything below it: "/admin" matches "/admin/users".
function isUnderPath(pathname, basePath) {
  return pathname === basePath || pathname.startsWith(basePath + "/");
}

export async function proxy(request) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
          Object.entries(headers ?? {}).forEach(([name, value]) =>
            response.headers.set(name, value),
          );
        },
      },
    },
  );

  // Don't run other code between creating the client and this call; it is what
  // refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub ?? null;
  const { pathname, search } = request.nextUrl;

  const redirectTo = (path) => {
    const redirect = NextResponse.redirect(new URL(path, request.url));
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  };

  if (!userId) {
    if (PROTECTED_PATHS.some((basePath) => isUnderPath(pathname, basePath))) {
      return redirectTo(`/login?next=${encodeURIComponent(pathname + search)}`);
    }
    return response;
  }

  if (pathname === "/login") {
    return redirectTo("/");
  }

  const needsProfile = isUnderPath(pathname, "/peer-to-peer") || isUnderPath(pathname, "/admin");
  if (needsProfile) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role, is_profile_complete")
      .eq("id", userId)
      .maybeSingle();

    if (isUnderPath(pathname, "/admin") && profile?.role !== "admin") {
      return redirectTo("/");
    }
    if (isUnderPath(pathname, "/peer-to-peer") && !profile?.is_profile_complete) {
      return redirectTo("/set-details");
    }
  }

  return response;
}

export const config = {
  // Every page except static files, images and API routes (route handlers
  // refresh the session themselves through their own Supabase client).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
