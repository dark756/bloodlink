import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Link href="/search/v3" className="text-2xl font-bold text-blue-500">
          Search Blood Availability
        </Link>
     <Link href="/peer-to-peer" className="text-2xl font-bold text-blue-500">
          peer to peer donor network
        </Link>
    </main>
    </div>
  );
}
