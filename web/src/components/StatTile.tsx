import type { LucideIcon } from "lucide-react";
import { STATUS_GOOD, STATUS_CRITICAL, CHART_BLUE, TEXT_PRIMARY, TEXT_MUTED, SURFACE, BORDER, tint } from "@/lib/theme";

const TONE_COLOR: Record<"neutral" | "good" | "bad", string> = {
  neutral: CHART_BLUE,
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
      className="group rounded-xl px-4 py-3.5 shadow-sm transition-colors"
      style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs" style={{ color: TEXT_MUTED }}>
          {label}
        </div>
        {Icon && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ backgroundColor: tint(accent, 10), color: accent }}
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
