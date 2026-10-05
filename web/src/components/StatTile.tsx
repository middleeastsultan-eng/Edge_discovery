import type { LucideIcon } from "lucide-react";
import { STATUS_GOOD, STATUS_CRITICAL, TEXT_PRIMARY, TEXT_MUTED, SURFACE, BORDER, tint } from "@/lib/theme";

// "neutral" stays muted gray, not the brand green -- a plain count (like
// "Total experiments") isn't a pass/fail signal and shouldn't borrow the
// color that means "this strategy survived validation."
const TONE_COLOR: Record<"neutral" | "good" | "bad", string> = {
  neutral: TEXT_MUTED,
  good: STATUS_GOOD,
  bad: STATUS_CRITICAL,
};

export function StatTile({
  label,
  value,
  tone = "neutral",
  icon: Icon,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
  icon?: LucideIcon;
}) {
  const accent = TONE_COLOR[tone];
  const valueColor = tone === "neutral" ? TEXT_PRIMARY : accent;

  return (
    <div
      className="group rounded-2xl px-4 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md animate-in fade-in slide-in-from-bottom-1 duration-500 fill-mode-both"
      style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs" style={{ color: TEXT_MUTED }}>
          {label}
        </div>
        {Icon && (
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full"
            style={{ backgroundColor: tint(accent, 12), color: accent }}
          >
            <Icon size={14} strokeWidth={2.25} />
          </div>
        )}
      </div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: valueColor }}>
        {value}
      </div>
    </div>
  );
}
