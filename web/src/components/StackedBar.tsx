import { tint, TEXT_MUTED } from "@/lib/theme";

export type Segment = { value: number; color: string; label: string };

export function StackedBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);

  return (
    <div className="space-y-2">
      <div className="flex h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: tint(TEXT_MUTED, 15) }}>
        {segments.map((s) =>
          s.value > 0 ? (
            <div key={s.label} style={{ width: `${(s.value / total) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${s.value}`} />
          ) : null
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" style={{ color: TEXT_MUTED }}>
        {segments.map((s) => (
          <div key={s.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            {s.label} · {s.value.toLocaleString()}
          </div>
        ))}
      </div>
    </div>
  );
}
