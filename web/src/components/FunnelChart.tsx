"use client";

import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, LabelList } from "recharts";
import type { FunnelStage } from "@/lib/researchHealth";
import { ACCENT, TEXT_MUTED, TEXT_PRIMARY, TEXT_SECONDARY, SURFACE, BORDER, GRIDLINE } from "@/lib/theme";

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: FunnelStage }> }) {
  if (!active || !payload || !payload.length) return null;
  const s = payload[0].payload;
  return (
    <div className="rounded-md border px-3 py-2 text-xs shadow-sm max-w-[240px]" style={{ backgroundColor: SURFACE, borderColor: BORDER }}>
      <div className="font-medium mb-1" style={{ color: TEXT_PRIMARY }}>{s.label}</div>
      <div style={{ color: TEXT_SECONDARY }}>{s.count.toLocaleString()} hypotheses</div>
      {s.pctOfPrevious !== null && (
        <div style={{ color: TEXT_MUTED }}>{formatPct(s.pctOfPrevious)} of previous stage</div>
      )}
      {s.note && <div className="mt-1" style={{ color: TEXT_MUTED }}>{s.note}</div>}
    </div>
  );
}

export function FunnelChart({ stages }: { stages: FunnelStage[] }) {
  const rows = [...stages].reverse(); // Recharts vertical bar lists top-to-bottom as array order

  return (
    <ResponsiveContainer width="100%" height={stages.length * 44}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, left: 0, bottom: 4 }} barCategoryGap={10}>
        <XAxis type="number" dataKey="count" hide domain={[0, "dataMax"]} />
        <YAxis
          type="category"
          dataKey="label"
          width={220}
          tick={{ fill: TEXT_SECONDARY, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<TooltipContent />} cursor={{ fill: GRIDLINE, opacity: 0.4 }} />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
          {rows.map((s) => (
            <Cell key={s.label} fill={ACCENT} />
          ))}
          <LabelList
            dataKey="count"
            position="right"
            formatter={(v) => (typeof v === "number" ? v.toLocaleString() : "")}
            style={{ fill: TEXT_PRIMARY, fontSize: 12, fontWeight: 600 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
