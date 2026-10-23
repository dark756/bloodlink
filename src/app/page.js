import Link from "next/link";

export default function HomePage() {
  return (
    <div className="page-wrap">
      <h1 className="text-3xl font-bold text-[#222]">Find blood when you need it</h1>
      <p className="page-subtitle max-w-lg">
        Bloodlink lets you check blood availability at blood banks across India, or look for donors
        near you.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 mt-8">
        <Link href="/search" className="card card-body hover:border-[#d32f2f]">
          <div className="text-2xl">🔍</div>
          <h2 className="mt-2 font-semibold text-[#222]">Search Blood Availability</h2>
          <p className="text-sm text-[#666] mt-1">
            Search by state and district, or use your current location to find the nearest blood
            banks.
          </p>
          <p className="text-sm text-[#d32f2f] font-semibold mt-3">Search now →</p>
        </Link>

        <Link href="/peer-to-peer" className="card card-body hover:border-[#d32f2f]">
          <div className="text-2xl">🤝</div>
          <h2 className="mt-2 font-semibold text-[#222]">Peer to peer donor network</h2>
          <p className="text-sm text-[#666] mt-1">
            Connect directly with donors in your area. This part of the site is still being built.
          </p>
          <p className="text-sm text-[#d32f2f] font-semibold mt-3">Take a look →</p>
        </Link>
      </div>

      <p className="text-xs text-[#666] mt-8">
        Availability data comes from public blood bank listings, so it may not always be up to date.
      </p>
    </div>
  );
}
