import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

// Signed-out users are sent to the NextAuth sign-in page by withAuth.
// Signed-in users with an incomplete profile are sent to /set-details.
export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const isProfileComplete = req.nextauth.token?.isProfileComplete === true;

    // /set-details itself stays reachable, both to avoid a redirect loop and so
    // users with a complete profile can edit it.
    if (!isProfileComplete && pathname !== "/set-details") {
      return NextResponse.redirect(new URL("/set-details", req.url));
    }
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token }) => !!token,
    },
  }
);

export const config = {
  matcher: ["/peer-to-peer", "/set-details"],
};
