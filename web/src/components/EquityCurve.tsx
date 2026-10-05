"use client";

import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { ExperimentTrade } from "@/lib/supabase";
import { formatR } from "@/lib/format";
import { CHART_BLUE, CHART_RED, TEXT_MUTED, TEXT_PRIMARY, GRIDLINE, BASELINE, SURFACE, BORDER, STATUS_GOOD } from "@/lib/theme";

type Point = {
  index: number;
  r_multiple: number;
  cumulative: number;
  drawdown: number;
  split: string;
  entry_time: string;
  exit_reason: string;
};

function buildSeries(trades: ExperimentTrade[]): Point[] {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.entry_time).getTime() - new Date(b.entry_time).getTime()
  );
  let cumulative = 0;
  let runningMax = 0;
  return sorted.map((t, i) => {
    cumulative += t.r_multiple;
    runningMax = Math.max(runningMax, cumulative);
    return {
      index: i + 1,
      r_multiple: t.r_multiple,
      cumulative: Number(cumulative.toFixed(3)),
      drawdown: Number((cumulative - runningMax).toFixed(3)),
      split: t.split,
      entry_time: t.entry_time,
      exit_reason: t.exit_reason,
    };
  });
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div
      className="rounded-md border px-3 py-2 text-xs shadow-sm"
      style={{ backgroundColor: SURFACE, borderColor: BORDER }}
    >
      <div className="mb-1" style={{ color: TEXT_MUTED }}>
        Trade #{p.index} · {new Date(p.entry_time).toLocaleDateString()} · {p.split}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3" style={{ backgroundColor: CHART_BLUE }} />
        <span className="font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>
          {formatR(p.cumulative)}
        </span>
        <span style={{ color: TEXT_MUTED }}>cumulative</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="h-0.5 w-3" style={{ backgroundColor: p.r_multiple >= 0 ? STATUS_GOOD : CHART_RED }} />
        <span className="tabular-nums" style={{ color: p.r_multiple >= 0 ? STATUS_GOOD : CHART_RED }}>
          {formatR(p.r_multiple)}
        </span>
        <span style={{ color: TEXT_MUTED }}>this trade ({p.exit_reason})</span>
      </div>
    </div>
  );
}

export function EquityCurve({ trades }: { trades: ExperimentTrade[] }) {
  if (trades.length === 0) {
    return <div className="text-sm" style={{ color: TEXT_MUTED }}>No trades to chart.</div>;
  }

  const data = buildSeries(trades);
  const firstTestIndex = data.find((d) => d.split === "test")?.index;

  return (
    <div className="space-y-1">
      <div>
        <div className="text-xs mb-2" style={{ color: TEXT_MUTED }}>
          Cumulative R by trade (validation + test, chronological)
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="index"
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              axisLine={{ stroke: BASELINE }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              axisLine={{ stroke: BASELINE }}
              tickLine={false}
              tickFormatter={(v) => `${v}R`}
              width={40}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: TEXT_MUTED, strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke={BASELINE} strokeWidth={1} />
            {firstTestIndex && (
              <ReferenceLine
                x={firstTestIndex}
                stroke={TEXT_MUTED}
                strokeDasharray="2 2"
                label={{ value: "test →", position: "insideTopRight", fill: TEXT_MUTED, fontSize: 11 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke={CHART_BLUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: CHART_BLUE, stroke: SURFACE, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-xs mb-2 mt-4" style={{ color: TEXT_MUTED }}>
          Drawdown (R below running peak)
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              axisLine={{ stroke: BASELINE }}
              tickLine={false}
              tickFormatter={(v) => `${v}R`}
              width={40}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: TEXT_MUTED, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke={CHART_RED}
              strokeWidth={2}
              fill={CHART_RED}
              fillOpacity={0.1}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
