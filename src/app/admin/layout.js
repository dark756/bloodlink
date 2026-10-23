import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile, getCurrentUser } from "@/lib/auth";

export const metadata = { title: "Admin · Bloodlink" };

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/audit", label: "Audit log" },
];

// Second line of defence after the proxy: every admin page renders only for admins.
export default async function AdminLayout({ children }) {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login?next=/admin");
  const profile = await getCurrentProfile(supabase, user.id);
  if (profile?.role !== "admin") redirect("/");

  return (
    <div className="page-wrap">
      <h1 className="page-title">Admin</h1>
      <nav className="flex flex-wrap gap-2 mt-3">
        {TABS.map((tab) => (
          <Link key={tab.href} href={tab.href} className="btn btn-outline btn-small">
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="mt-5">{children}</div>
    </div>
  );
}
