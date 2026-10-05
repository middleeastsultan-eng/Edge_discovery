"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TEXT_PRIMARY, TEXT_SECONDARY, BORDER } from "@/lib/theme";

const LINKS = [
  { href: "/", label: "Experiments" },
  { href: "/research", label: "Research Health" },
  { href: "/live", label: "Live Signals" },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <header
      className="md:hidden sticky top-0 z-10 border-b px-4 py-3 flex items-center justify-between"
      style={{ borderColor: BORDER, backgroundColor: "color-mix(in srgb, var(--tl-surface) 92%, transparent)" }}
    >
      <Link href="/" className="inline-flex items-center gap-2">
        <Image src="/logo-mark.png" alt="" width={24} height={24} className="rounded-full shrink-0" priority />
        <span className="text-sm font-semibold tracking-wide" style={{ color: TEXT_PRIMARY }}>
          TRADING LAB
        </span>
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={{ color: pathname === link.href ? TEXT_PRIMARY : TEXT_SECONDARY }}
          >
            {link.label}
          </Link>
        ))}
        <ThemeToggle />
      </nav>
    </header>
  );
}
