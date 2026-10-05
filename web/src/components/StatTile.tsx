import type { LucideIcon } from "lucide-react";

const TONE_COLOR: Record<"neutral" | "good" | "bad", string> = {
  neutral: "#3987e5",
  good: "#0ca30c",
  bad: "#d03b3b",
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
  const valueColor = tone === "neutral" ? "#ffffff" : accent;

  return (
    <div className="group rounded-xl border border-white/10 bg-[#1a1a19] px-4 py-3.5 shadow-sm transition-colors hover:border-white/20">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs text-[#898781]">{label}</div>
        {Icon && (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-md"
            style={{ backgroundColor: `${accent}1a`, color: accent }}
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
