"use client";

import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";
import type { CumulativePoint } from "@/lib/researchHealth";
import { CHART_BLUE, CHART_GREEN, CHART_AMBER, CHART_TEAL, TEXT_MUTED, TEXT_PRIMARY, SURFACE, BORDER } from "@/lib/theme";

function MiniTrend({ data, dataKey, label, color }: { data: CumulativePoint[]; dataKey: keyof CumulativePoint; label: string; color: string }) {
  const latest = data.length ? (data[data.length - 1][dataKey] as number) : 0;

  return (
    <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
      <div className="flex items-center gap-1.5 text-xs mb-1" style={{ color: TEXT_MUTED }}>
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        {label}
      </div>
      <div className="text-xl font-semibold tabular-nums mb-2" style={{ color: TEXT_PRIMARY }}>
        {latest.toLocaleString()}
      </div>
      <ResponsiveContainer width="100%" height={60}>
        <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
          <XAxis dataKey="date" hide />
          <YAxis hide domain={[0, "auto"]} />
          <Tooltip
            formatter={(value) => [Number(value).toLocaleString(), label]}
            labelFormatter={(d) => new Date(d as string).toLocaleDateString()}
            contentStyle={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}`, fontSize: 12 }}
          />
          <Area type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} fill={color} fillOpacity={0.1} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CumulativeTrends({ data }: { data: CumulativePoint[] }) {
  if (data.length === 0) {
    return <div className="text-sm" style={{ color: TEXT_MUTED }}>No research runs yet.</div>;
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <MiniTrend data={data} dataKey="hypotheses" label="Cumulative hypotheses tested" color={CHART_BLUE} />
      <MiniTrend data={data} dataKey="level1" label="Cumulative Level-1 signals" color={CHART_GREEN} />
      <MiniTrend data={data} dataKey="validation" label="Cumulative validation survivors" color={CHART_AMBER} />
      <MiniTrend data={data} dataKey="finalTest" label="Cumulative final-test passes" color={CHART_TEAL} />
    </div>
  );
}
