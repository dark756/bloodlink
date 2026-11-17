import Link from "next/link";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <span className="hero-badge mt-6">
        <span className="nav-dot" />
        Live blood availability
      </span>
      <h1 className="hero-title mt-8">
        Find blood
        <br />
        when you <em>need it.</em>
      </h1>
      <p className="page-subtitle max-w-xl text-base mt-6">
        Bloodlink lets you check blood availability at blood banks across India, or look for donors
        near you.
      </p>

      <div className="flex flex-wrap gap-3 mt-8">
        <Link href="/search" className="btn btn-primary">
          Search Live Stock →
        </Link>
        <Link href="/peer-to-peer" className="btn btn-outline">
          Donor network
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 mt-14">
        <Link href="/search" className="card card-body hover:border-[var(--accent)]">
          <div className="text-2xl">🔍</div>
          <h2 className="mt-3 text-lg font-bold text-[var(--text)]">Search Blood Availability</h2>
          <p className="text-sm text-[var(--text-light)] mt-1">
            Search by state and district, or use your current location to find the nearest blood
            banks.
          </p>
          <p className="text-sm text-[var(--accent-text)] font-bold mt-4">Search now →</p>
        </Link>

        <Link href="/peer-to-peer" className="card card-body hover:border-[var(--accent)]">
          <div className="text-2xl">🤝</div>
          <h2 className="mt-3 text-lg font-bold text-[var(--text)]">Peer to peer donor network</h2>
          <p className="text-sm text-[var(--text-light)] mt-1">
            Ask nearby donors to give at a blood centre. This part of the site is still being built.
          </p>
          <p className="text-sm text-[var(--accent-text)] font-bold mt-4">Take a look →</p>
        </Link>
      </div>

      <p className="text-xs text-[var(--text-light)] mt-10">
        Availability data comes from public blood bank listings, so it may not always be up to date.
      </p>
    </div>
  );
}
