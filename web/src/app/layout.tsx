import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Sidebar } from "@/components/Sidebar";
import { MobileNav } from "@/components/MobileNav";
import { supabase, type AgentSettings } from "@/lib/supabase";
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
  title: "Edge Discovery",
  description: "Systematic strategy research: discovery, validation, walk-forward and Monte Carlo results.",
};

export const dynamic = "force-dynamic";

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

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { data: settingsData } = await supabase
    .from("local_agent_settings")
    .select("max_workers, paused")
    .eq("id", 1)
    .single();
  const settings = (settingsData ?? null) as AgentSettings | null;

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
        className="min-h-full flex"
        style={{ backgroundColor: "var(--tl-page)", color: "var(--tl-text-primary)" }}
      >
        <Sidebar settings={settings} />
        <div className="flex-1 flex flex-col min-w-0">
          <MobileNav />
          <main className="flex-1 px-6 py-8 max-w-6xl w-full mx-auto">{children}</main>
        </div>
      </body>
    </html>
  );
}
