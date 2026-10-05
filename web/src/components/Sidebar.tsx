"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FlaskConical, Activity, Circle } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import type { AgentSettings } from "@/lib/supabase";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, BORDER, STATUS_GOOD, STATUS_CRITICAL, CHART_BLUE, tint } from "@/lib/theme";

const LINKS = [
  { href: "/", label: "Experiments", icon: FlaskConical },
  { href: "/research", label: "Research Health", icon: Activity },
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
          TRADING LAB
        </span>
      </Link>

      <nav className="flex-1 px-3 space-y-1">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors"
              style={{
                color: active ? TEXT_PRIMARY : TEXT_SECONDARY,
                backgroundColor: active ? tint(CHART_BLUE, 12) : "transparent",
              }}
            >
              <Icon size={16} style={{ color: active ? CHART_BLUE : TEXT_MUTED }} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4 space-y-3">
        {settings && (
          <div
            className="flex items-center gap-2 rounded-md px-3 py-2 text-xs"
            style={{ backgroundColor: tint(TEXT_MUTED, 8), color: TEXT_SECONDARY }}
          >
            <Circle
              size={7}
              fill={settings.paused ? STATUS_CRITICAL : STATUS_GOOD}
              style={{ color: settings.paused ? STATUS_CRITICAL : STATUS_GOOD }}
            />
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
