import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Header from "./components/Header";
import SessionWrapper from "./components/SessionWrapper";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata = {
  title: "Bloodlink",
  description: "Search blood availability and find donors nearby.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SessionWrapper>       {/* ← wraps everything with SessionProvider */}
          <Header />
          <main className="flex-1">{children}</main>
          <footer className="border-t border-[#e0e0e0] bg-white">
            <div className="max-w-[900px] mx-auto px-4 py-5 text-xs text-[#666] text-center">
              Bloodlink — a student project. In an emergency, please call your
              nearest hospital directly.
            </div>
          </footer>
        </SessionWrapper>
      </body>
    </html>
  );
}
