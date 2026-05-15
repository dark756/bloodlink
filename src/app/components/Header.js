"use client";
import { useSession, signIn, signOut } from "next-auth/react";

export default function Header() {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  // console.log("Session data:", session);
  const initials = session?.user?.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <header className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">

        {/* Logo / brand */}
        <span className="font-semibold text-gray-900">Bloodlink</span>

        {/* Right side: auth status */}
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="h-8 w-24 animate-pulse rounded-md bg-gray-100" />
          ) : session ? (
            <>
              {/* Avatar */}
              {session.user?.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center justify-center">
                  {initials}
                </div>
              )}

              {/* Name */}
              <span className="text-sm text-gray-700 hidden sm:block">
                {session.user?.name}
              </span>

              {/* Sign out */}
              <button
                onClick={() => signOut()}
                className="text-sm px-3 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => signIn("google")}
              className="text-sm px-3 py-1.5 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Sign in with Google
            </button>
          )}
        </div>

      </div>
    </header>
  );
}