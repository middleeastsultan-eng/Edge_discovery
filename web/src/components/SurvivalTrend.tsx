"use client";

import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { WeeklySurvival } from "@/lib/researchHealth";
import { CHART_BLUE, CHART_GREEN, CHART_AMBER, CHART_TEAL, TEXT_MUTED, TEXT_PRIMARY, GRIDLINE, BASELINE, SURFACE, BORDER } from "@/lib/theme";

const SERIES: Array<{ key: keyof WeeklySurvival; label: string; color: string }> = [
  { key: "level1Pct", label: "Level 1", color: CHART_GREEN },
  { key: "validationPct", label: "Validation", color: CHART_AMBER },
  { key: "robustPct", label: "Robustness", color: CHART_BLUE },
  { key: "finalTestPct", label: "Final test", color: CHART_TEAL },
];

function TooltipContent({ active, payload, label }: { active?: boolean; payload?: Array<{ dataKey: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-md border px-3 py-2 text-xs shadow-sm" style={{ backgroundColor: SURFACE, borderColor: BORDER }}>
      <div className="mb-1" style={{ color: TEXT_MUTED }}>Week of {label}</div>
      {payload.map((p) => {
        const series = SERIES.find((s) => s.key === p.dataKey);
        if (!series || p.value == null) return null;
        return (
          <div key={p.dataKey} className="flex items-center gap-2">
            <span className="h-0.5 w-3" style={{ backgroundColor: series.color }} />
            <span className="tabular-nums font-medium" style={{ color: TEXT_PRIMARY }}>{(p.value * 100).toFixed(1)}%</span>
            <span style={{ color: TEXT_MUTED }}>{series.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SurvivalTrend({ data }: { data: WeeklySurvival[] }) {
  if (data.length === 0) {
    return <div className="text-sm" style={{ color: TEXT_MUTED }}>No research runs yet.</div>;
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={GRIDLINE} strokeDasharray="0" vertical={false} />
        <XAxis
          dataKey="weekStart"
          tick={{ fill: TEXT_MUTED, fontSize: 11 }}
          axisLine={{ stroke: BASELINE }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: TEXT_MUTED, fontSize: 11 }}
          axisLine={{ stroke: BASELINE }}
          tickLine={false}
          tickFormatter={(v) => `${Math.round(v * 100)}%`}
          width={42}
        />
        <Tooltip content={<TooltipContent />} />
        <Legend
          formatter={(value) => <span style={{ color: TEXT_MUTED, fontSize: 12 }}>{value}</span>}
          iconType="line"
          iconSize={12}
        />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
