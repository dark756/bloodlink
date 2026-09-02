import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    const { pathname } = req.nextUrl;
    const token = req.nextauth.token;
    //console.log(token)

    const isProfileComplete = token?.isProfileComplete;

    // Allow access to set-details page itself (avoid redirect loop)
    const isSettingsPage = pathname === "/set-details";

    if (!isProfileComplete && !isSettingsPage) {
      console.log(`redirected to set details\nprofile: ${isProfileComplete}`)
      return NextResponse.redirect(new URL("/set-details", req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      // Only run middleware function if user is logged in
      authorized: ({ token }) => !!token,
    },
  }
);

// Protect these routes — add more as needed
export const config = {
  matcher: ["/peer-to-peer"],
};