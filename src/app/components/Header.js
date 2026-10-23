"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/format";

// `user` comes from the root layout, which reads it on the server:
// { email, name, avatarUrl, role } or null.
export default function Header({ user }) {
  const router = useRouter();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const initials = getInitials(user?.name);

  async function handleSignOut() {
    setIsSigningOut(true);
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
    setIsSigningOut(false);
  }

  return (
    <header className="w-full border-b border-[#e0e0e0] bg-white">
      <div className="max-w-[900px] mx-auto px-4 min-h-14 py-2 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex items-center gap-4 text-sm">
          <Link href="/" className="font-bold text-[#222]">
            🩸 Bloodlink
          </Link>
          <Link href="/search" className="text-[#444] hover:text-[#d32f2f]">
            Search
          </Link>
          {user && (
            <Link href="/peer-to-peer" className="text-[#444] hover:text-[#d32f2f]">
              My profile
            </Link>
          )}
          {user && (
            <Link href="/organization" className="text-[#444] hover:text-[#d32f2f]">
              Organization
            </Link>
          )}
          {user?.role === "admin" && (
            <Link href="/admin" className="text-[#d32f2f] font-semibold">
              Admin
            </Link>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <>
              {user.avatarUrl ? (
                <Image
                  src={user.avatarUrl}
                  alt={user.name ?? "User"}
                  width={32}
                  height={32}
                  className="h-8 w-8 rounded-full object-cover"
                />
              ) : (
                <div className="h-8 w-8 rounded-full bg-[#fdeaea] text-[#d32f2f] text-xs font-semibold flex items-center justify-center">
                  {initials}
                </div>
              )}
              <span className="text-sm text-[#222] hidden sm:block">{user.name}</span>
              <button
                onClick={handleSignOut}
                disabled={isSigningOut}
                className="btn btn-outline btn-small"
              >
                Sign out
              </button>
            </>
          ) : (
            <Link href="/login" className="btn btn-outline btn-small">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
