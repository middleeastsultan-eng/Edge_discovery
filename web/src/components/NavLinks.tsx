"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Experiments" },
  { href: "/research", label: "Research Health" },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-5 text-sm">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="relative py-1 transition-colors"
            style={{ color: active ? "var(--tl-text-primary)" : "var(--tl-text-secondary)" }}
          >
            {link.label}
            {active && (
              <span
                className="absolute -bottom-[1px] left-0 right-0 h-[2px] rounded-full"
                style={{ backgroundColor: "var(--tl-chart-blue)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
