import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { hasAgreedToPrivacy } from "@/lib/privacy";
import DeleteAccountCard from "./DeleteAccountCard";

export const metadata = { title: "Your account · Bloodlink" };

// Every signed-in person can reach this page, whether or not their profile is
// complete, so anyone can delete their account (#18).
export default async function AccountPage() {
  const supabase = await createClient();
  const user = await getCurrentUser(supabase);
  if (!user) redirect("/login?next=/account");
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, privacy_version, privacy_accepted_at")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="page-wrap-small">
      <h1 className="page-title">Your account</h1>
      <p className="page-subtitle">Signed in as {user.email}</p>

      <div className="card mt-5">
        <h2 className="card-title">Privacy</h2>
        <div className="card-body text-sm flex flex-col gap-2">
          {hasAgreedToPrivacy(profile?.privacy_version) ? (
            <p>
              You agreed to the current privacy note on{" "}
              {formatDateTime(profile.privacy_accepted_at)}.
            </p>
          ) : (
            <p>
              You haven&apos;t agreed to the current privacy note yet. You will be asked when you
              next save your details.
            </p>
          )}
          <p>
            <Link href="/privacy" className="text-[#d32f2f] font-semibold">
              Read the privacy note
            </Link>{" "}
            ·{" "}
            <Link href="/set-details" className="text-[#d32f2f] font-semibold">
              Edit your details
            </Link>
          </p>
        </div>
      </div>

      <DeleteAccountCard isAdmin={profile?.role === "admin"} />
    </div>
  );
}
