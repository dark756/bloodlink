import { Plus_Jakarta_Sans, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import Header from "./components/Header";

const headFace = Plus_Jakarta_Sans({ variable: "--font-head-face", subsets: ["latin"] });
const bodyFace = Inter({ variable: "--font-body-face", subsets: ["latin"] });
const monoFace = JetBrains_Mono({ variable: "--font-mono-face", subsets: ["latin"] });

export const metadata = {
  title: "Bloodlink",
  description: "Search blood availability and find donors nearby.",
};

// Reads no cookies, so pages that don't read them either are prerendered. The header
// finds the signed-in user in the browser (#49).
// Runs before the first paint so a saved light-mode choice does not flash dark.
const themeScript = `try{if(localStorage.getItem("theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${headFace.variable} ${bodyFace.variable} ${monoFace.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-full flex flex-col">
        <Header />
        <main className="flex-1">{children}</main>
        <footer className="site-footer">
          <div className="max-w-[900px] mx-auto px-4 py-6 text-xs text-[var(--text-light)] text-center">
            Bloodlink — a student project. In an emergency, please call your nearest hospital
            directly. ·{" "}
            <Link href="/privacy" className="hover:text-[var(--accent-text)]">
              Privacy
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
