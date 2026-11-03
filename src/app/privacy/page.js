import Link from "next/link";
import { formatDate } from "@/lib/format";
import { CONTACT_EMAIL, PRIVACY_VERSION } from "@/lib/privacy";

export const metadata = { title: "Privacy note · Bloodlink" };

// The notice that India's Digital Personal Data Protection Act, 2023 asks for (#18):
// what is stored and why, who receives what, for how long, and how to use your rights.
// People agree to PRIVACY_VERSION on the details form; change it when this text changes.

const STORED_DATA = [
  {
    what: "Your account: email address and name, and your profile picture if you sign in with Google",
    why: "To sign you in and show who is signed in",
    who: "You and bloodLink's admins",
  },
  {
    what: "Your profile: date of birth, gender, phone number, state and district, blood group, emergency contact, and whether you are willing to donate",
    why: "To show whether you may be able to donate, and later to ask you to donate when a blood centre near you needs your group",
    who: "You and bloodLink's admins",
  },
  {
    what: "Donor screening answers: last donation; a recent tattoo, piercing or acupuncture; pregnancy, breastfeeding, a recent birth, abortion or miscarriage; weight under 45 kg; medication; and the listed infections. Only if you are willing to donate",
    why: "To estimate whether you may be able to donate. The estimate is only a guide; blood banks do the real screening",
    who: "Only you. Admins can't see them",
  },
  {
    what: "Organization applications: the hospital's or blood bank's name, registration number, eRaktKosh code, address and phone",
    why: "To verify hospitals and blood banks before they get their tools",
    who: "You and bloodLink's admins",
  },
  {
    what: "Which version of this note you agreed to, and when",
    why: "To show that you agreed",
    who: "You and bloodLink's admins",
  },
];

const OUTSIDE_SERVICES = [
  {
    service: "eRaktKosh (Ministry of Health and Family Welfare)",
    gets: "Your search pin, rounded to about 110 m",
    why: "Finds blood banks near you",
  },
  {
    service: "The public OSRM routing server",
    gets: "Your search pin, rounded to about 110 m, and the blood banks' positions",
    why: "Road distances and driving times",
  },
  {
    service: "OpenStreetMap's Nominatim",
    gets: "Your pin, rounded to about 110 m, sent by bloodLink's server rather than your browser",
    why: "The place name shown under the map",
  },
  {
    service: "Open-Meteo",
    gets: "Your search pin, rounded to about 11 km",
    why: "Current rain, which slows travel estimates",
  },
  {
    service: "CARTO",
    gets: "Requests for the map tiles your browser shows, with your IP address, as with any website",
    why: "The map",
  },
  {
    service: "Supabase",
    gets: "Everything bloodLink stores, kept in its Mumbai (India) data centre",
    why: "bloodLink's database and sign-in",
  },
  {
    service: "Google, only if you choose Google sign-in",
    gets: "Google tells bloodLink your name, email address and profile picture",
    why: "Sign-in",
  },
];

function Section({ title, children }) {
  return (
    <div className="card mt-5">
      <h2 className="card-title">{title}</h2>
      <div className="card-body text-sm leading-relaxed flex flex-col gap-3">{children}</div>
    </div>
  );
}

export default function PrivacyPage() {
  const contact = CONTACT_EMAIL ? (
    <a href={`mailto:${CONTACT_EMAIL}`} className="text-[#d32f2f] font-semibold">
      {CONTACT_EMAIL}
    </a>
  ) : (
    <a href="https://github.com/dark756/bloodlink" className="text-[#d32f2f] font-semibold">
      the project&apos;s GitHub page
    </a>
  );

  return (
    <div className="page-wrap">
      <h1 className="page-title">Privacy note</h1>
      <p className="page-subtitle">
        Version of {formatDate(PRIVACY_VERSION)}. bloodLink is a final-year B.Tech student project.
        It is not a medical service, and it is for people aged 18 or over.
      </p>

      <Section title="What bloodLink stores">
        <p>
          Searching for blood needs no account and stores nothing about you. With an account,
          bloodLink stores the following, and only for the reasons given.
        </p>
        <table className="w-full text-left">
          <thead className="text-xs text-[#666]">
            <tr>
              <th className="py-2 pr-3 font-semibold">What</th>
              <th className="py-2 pr-3 font-semibold">Why</th>
              <th className="py-2 font-semibold">Who can see it</th>
            </tr>
          </thead>
          <tbody>
            {STORED_DATA.map((item) => (
              <tr key={item.what} className="border-t border-[#e0e0e0] align-top">
                <td className="py-2 pr-3">{item.what}</td>
                <td className="py-2 pr-3 text-[#666]">{item.why}</td>
                <td className="py-2 text-[#666]">{item.who}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Admin actions, such as approving an organization or changing a role, are kept in an audit
          log that only admins can read.
        </p>
      </Section>

      <Section title="What bloodLink doesn't keep">
        <p>
          Where you search from is never written to bloodLink&apos;s database. Your pin is rounded
          to about 110 m in your browser. The server keeps rounded points in its memory, with
          nothing that links them to you, only to answer repeat searches faster; they are gone when
          the server restarts.
        </p>
        <p>
          Your IP address is kept in the server&apos;s memory to limit how many searches one person
          can make in a minute, and is never written to the database.
        </p>
      </Section>

      <Section title="Who else receives data">
        <table className="w-full text-left">
          <thead className="text-xs text-[#666]">
            <tr>
              <th className="py-2 pr-3 font-semibold">Service</th>
              <th className="py-2 pr-3 font-semibold">What it receives</th>
              <th className="py-2 font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            {OUTSIDE_SERVICES.map((item) => (
              <tr key={item.service} className="border-t border-[#e0e0e0] align-top">
                <td className="py-2 pr-3">{item.service}</td>
                <td className="py-2 pr-3 text-[#666]">{item.gets}</td>
                <td className="py-2 text-[#666]">{item.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>bloodLink never sells or shares your details with anyone else.</p>
      </Section>

      <Section title="How long it is kept">
        <p>Your account, profile and applications: until you delete your account.</p>
        <p>
          Donor screening answers: until you say you are no longer willing to donate, or delete your
          account, whichever comes first. They are deleted straight away.
        </p>
        <p>
          Audit log entries stay after you delete your account, but they no longer point to you.
        </p>
      </Section>

      <Section title="Your choices and rights">
        <p>
          <strong>See and correct your details</strong> on{" "}
          <Link href="/peer-to-peer" className="text-[#d32f2f] font-semibold">
            My profile
          </Link>{" "}
          and the{" "}
          <Link href="/set-details" className="text-[#d32f2f] font-semibold">
            details form
          </Link>
          .
        </p>
        <p>
          <strong>Delete your account</strong> on the{" "}
          <Link href="/account" className="text-[#d32f2f] font-semibold">
            Account page
          </Link>
          . Everything listed above goes at once, and your agreement to this note is withdrawn. To
          stop only the health answers, say you are no longer willing to donate.
        </p>
        <p>
          <strong>Ask a question, make a request or complain</strong> through {contact}. You can
          also name someone to use these rights for you if you become unable to. If you are not
          satisfied with the answer, you can complain to the Data Protection Board of India.
        </p>
      </Section>

      <Section title="Changes to this note">
        <p>
          When this note changes, its version date changes, and bloodLink asks you to agree again
          the next time you save your details.
        </p>
      </Section>
    </div>
  );
}
