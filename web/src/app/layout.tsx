import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Trading Lab",
  description: "Systematic strategy research: discovery, validation, walk-forward and Monte Carlo results.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#0d0d0d] text-neutral-100">
        <header className="border-b border-white/10 px-6 py-3.5">
          <a href="/" className="inline-flex items-center gap-2.5">
            <span
              className="flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold text-white"
              style={{ backgroundColor: "#3987e5" }}
            >
              T
            </span>
            <span className="text-sm font-semibold tracking-wide text-neutral-200">TRADING LAB</span>
          </a>
        </header>
        <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">{children}</main>
      </body>
    </html>
  );
}
