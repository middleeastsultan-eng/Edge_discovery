import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { Geist, Geist_Mono } from "next/font/google";
import { NavLinks } from "@/components/NavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
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

// Runs before paint so the stored/preferred theme applies with no flash.
const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_SCRIPT }} />
      </head>
      <body
        className="min-h-full flex flex-col"
        style={{ backgroundColor: "var(--tl-page)", color: "var(--tl-text-primary)" }}
      >
        <header
          className="sticky top-0 z-10 border-b px-6 py-3.5 backdrop-blur-sm"
          style={{ borderColor: "var(--tl-border)", backgroundColor: "color-mix(in srgb, var(--tl-surface) 92%, transparent)" }}
        >
          <div className="flex items-center justify-between">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Image
                src="/logo-mark.png"
                alt=""
                width={28}
                height={28}
                className="rounded-full shrink-0"
                priority
              />
              <span className="text-sm font-semibold tracking-wide" style={{ color: "var(--tl-text-primary)" }}>
                TRADING LAB
              </span>
            </Link>
            <div className="flex items-center gap-4">
              <NavLinks />
              <span className="h-4 w-px" style={{ backgroundColor: "var(--tl-border)" }} />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">{children}</main>
      </body>
    </html>
  );
}
