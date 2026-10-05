export function StatTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueColor = tone === "good" ? "#0ca30c" : tone === "bad" ? "#d03b3b" : "#ffffff";
  return (
    <div className="rounded-lg border border-white/10 bg-[#1a1a19] px-4 py-3">
      <div className="text-xs text-[#898781] mb-1">{label}</div>
      <div className="text-xl font-semibold tabular-nums" style={{ color: valueColor }}>
        {value}
      </div>
    </div>
  );
}
