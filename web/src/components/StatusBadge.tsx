import { VERDICT_LABEL, type Verdict } from "@/lib/evaluate";

const STYLES: Record<Verdict, { color: string; icon: string }> = {
  pass: { color: "#0ca30c", icon: "✓" },
  fail: { color: "#d03b3b", icon: "✕" },
  insufficient: { color: "#898781", icon: "·" },
};

export function StatusBadge({ verdict }: { verdict: Verdict }) {
  const { color, icon } = STYLES[verdict];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}1a` }}
    >
      <span aria-hidden>{icon}</span>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}
