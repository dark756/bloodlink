"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import Image from "next/image";
import Link from "next/link";

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
    <header className="w-full border-b border-[#e0e0e0] bg-white">
      <div className="max-w-[900px] mx-auto px-4 h-14 flex items-center justify-between">

        {/* Logo / brand */}
        <span className="font-bold text-[#222]">
          <Link href="/">🩸 Bloodlink</Link>
        </span>

        {/* Right side: auth status */}
        <div className="flex items-center gap-3">
          {loading ? (
            <span className="text-sm text-[#666]">Loading...</span>
          ) : session ? (
            <>
              {/* Avatar */}
              {session.user?.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? "User"}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#fdeaea] text-[#d32f2f] text-xs font-semibold flex items-center justify-center">
                  {initials}
                </div>
              )}

              {/* Name */}
              <span className="text-sm text-[#222] hidden sm:block">
                {session.user?.name}
              </span>

              {/* Sign out */}
              <button
                onClick={() => signOut()}
                className="btn btn-outline btn-small"
              >
                Sign out
              </button>
            </>
          ) : (
            <button
              onClick={() => signIn("google")}
              className="btn btn-outline btn-small"
            >
              Sign in with Google
            </button>
          )}
        </div>

      </div>
    </header>
  );
}
