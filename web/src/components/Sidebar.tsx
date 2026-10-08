"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, Activity, Radio, Users, Circle, CandlestickChart, Wallet } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { AgentSettings } from "@/lib/supabase";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER, STATUS_GOOD, STATUS_CRITICAL, ACCENT, tint } from "@/lib/theme";

const LINKS = [
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/research", label: "Research Health", icon: Activity },
  { href: "/live", label: "Live Signals", icon: Radio },
  { href: "/live-chart", label: "Live Chart", icon: CandlestickChart },
  { href: "/paper-trading", label: "Paper Trading", icon: Wallet },
  { href: "/community", label: "Community", icon: Users },
];

export function Sidebar({ settings }: { settings: AgentSettings | null }) {
  const pathname = usePathname();

  return (
    <aside
      className="hidden md:flex md:flex-col md:w-60 md:shrink-0 border-r h-screen sticky top-0"
      style={{ borderColor: BORDER, backgroundColor: "var(--tl-page)" }}
    >
      <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
        <Image src="/logo-mark.png" alt="" width={28} height={28} className="rounded-full shrink-0" priority />
        <span className="text-sm font-semibold tracking-wide" style={{ color: TEXT_PRIMARY }}>
          EDGE DISCOVERY
        </span>
      </Link>

      <nav className="flex-1 px-3">
        <div className="px-3 mb-2 text-[10px] font-semibold tracking-wider uppercase" style={{ color: TEXT_MUTED }}>
          Navigation
        </div>
        <div className="space-y-1">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className="relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                style={{
                  color: active ? TEXT_PRIMARY : TEXT_SECONDARY,
                  backgroundColor: active ? tint(ACCENT, 12) : "transparent",
                }}
              >
                {active && (
                  <span
                    className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
                    style={{ backgroundColor: ACCENT }}
                  />
                )}
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
                  style={{ backgroundColor: active ? tint(ACCENT, 18) : tint(TEXT_MUTED, 10) }}
                >
                  <Icon size={14} style={{ color: active ? ACCENT : TEXT_MUTED }} />
                </span>
                {link.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="px-3 pb-4 space-y-3">
        {settings && (
          <div
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ backgroundColor: tint(TEXT_MUTED, 8), color: TEXT_SECONDARY }}
          >
            {settings.paused ? (
              <Circle size={7} fill={STATUS_CRITICAL} style={{ color: STATUS_CRITICAL }} />
            ) : (
              <span className="relative inline-flex h-[7px] w-[7px]" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: STATUS_GOOD }} />
                <span className="relative inline-flex h-[7px] w-[7px] rounded-full" style={{ backgroundColor: STATUS_GOOD }} />
              </span>
            )}
            {settings.paused ? "Research loop paused" : `Research loop running · ${settings.max_workers} worker(s)`}
          </div>
        )}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs" style={{ color: TEXT_MUTED }}>
            Theme
          </span>
          <ThemeToggle />
        </div>
      </div>
    </aside>
  );
}
