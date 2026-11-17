"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getInitials } from "@/lib/format";
import ThemeToggle from "./ThemeToggle";

// The header finds out who is signed in from the browser, so the root layout reads no
// cookies and pages can be prerendered instead of each waiting on a profile query
// (#49). The browser's own session is enough to show a name and links; the proxy, the
// API routes and the database check the session again before anything is shown.
export default function Header() {
  const router = useRouter();
  const pathname = usePathname();
  const [sessionUser, setSessionUser] = useState(undefined); // undefined until known, null when signed out
  const [profile, setProfile] = useState(null); // { userId, fullName, role }
  const [isSigningOut, setIsSigningOut] = useState(false);

  // The first event is INITIAL_SESSION, from the cookies; sign-in, sign-out and token
  // refreshes follow.
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event, session) => {
      setSessionUser(session?.user ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Read again on every page change, so a saved name or a new role shows without a reload.
  const userId = sessionUser?.id ?? null;
  useEffect(() => {
    if (!userId) return undefined;
    let isCancelled = false;
    createClient()
      .from("profiles")
      .select("full_name, role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (!isCancelled && data) {
          setProfile({ userId, fullName: data.full_name, role: data.role });
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [userId, pathname]);

  const metadata = sessionUser?.user_metadata ?? {};
  const ownProfile = profile?.userId === userId ? profile : null;
  const user = sessionUser
    ? {
        name: ownProfile?.fullName || metadata.full_name || metadata.name || sessionUser.email,
        avatarUrl: metadata.avatar_url ?? metadata.picture ?? null,
        role: ownProfile?.role ?? "user",
      }
    : null;
  const initials = getInitials(user?.name);

  async function handleSignOut() {
    setIsSigningOut(true);
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
    setIsSigningOut(false);
  }

  // Highlights the link for the page you are on.
  const isActive = (href) => (href === "/" ? pathname === "/" : pathname?.startsWith(href));
  const linkClass = (href) => `nav-link ${isActive(href) ? "nav-link-active" : ""}`;

  return (
    <header className="nav-shell">
      <div className="nav-row">
        <div className="nav-bar">
          <Link href="/" className="nav-brand">
            <span className="nav-dot" />
            Bloodlink
            <span className="nav-tag hidden sm:inline">EMERGENCY</span>
          </Link>

          <nav className="nav-links">
            <Link href="/" className={linkClass("/")}>
              Home
            </Link>
            <Link href="/search" className={linkClass("/search")}>
              Search
            </Link>
            {user && (
              <Link href="/peer-to-peer" className={linkClass("/peer-to-peer")}>
                My profile
              </Link>
            )}
            {user && (
              <Link href="/organization" className={linkClass("/organization")}>
                Organization
              </Link>
            )}
            {user?.role === "admin" && (
              <Link href="/admin" className={linkClass("/admin")}>
                Admin
              </Link>
            )}
          </nav>

          {/* Nothing shows on the right until the session is known, so a signed-in user
            never sees a "Sign in" button flash first. */}
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <Link href="/account" className="flex items-center gap-3" title="Your account">
                  {user.avatarUrl ? (
                    <Image
                      src={user.avatarUrl}
                      alt={user.name ?? "User"}
                      width={32}
                      height={32}
                      className="h-8 w-8 rounded-full object-cover"
                    />
                  ) : (
                    <div className="h-8 w-8 rounded-full bg-[var(--red-soft)] text-[var(--accent-text)] text-xs font-semibold flex items-center justify-center">
                      {initials}
                    </div>
                  )}
                  <span className="text-sm text-[var(--text)] hidden sm:block">{user.name}</span>
                </Link>
                <button
                  onClick={handleSignOut}
                  disabled={isSigningOut}
                  className="btn btn-outline btn-small"
                >
                  Sign out
                </button>
              </>
            ) : (
              sessionUser === null && (
                <Link href="/login" className="btn btn-primary btn-small">
                  Sign in
                </Link>
              )
            )}
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
