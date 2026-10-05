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

const BLUE = "#3987e5";
const RED = "#e66767";
const MUTED = "#898781";
const GRID = "#2c2c2a";
const SURFACE = "#1a1a19";

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
      className="rounded-md border px-3 py-2 text-xs"
      style={{ backgroundColor: SURFACE, borderColor: "rgba(255,255,255,0.1)" }}
    >
      <div className="text-[#898781] mb-1">
        Trade #{p.index} · {new Date(p.entry_time).toLocaleDateString()} · {p.split}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3" style={{ backgroundColor: BLUE }} />
        <span className="text-white font-medium tabular-nums">{formatR(p.cumulative)}</span>
        <span className="text-[#898781]">cumulative</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="h-0.5 w-3" style={{ backgroundColor: p.r_multiple >= 0 ? "#0ca30c" : RED }} />
        <span className="tabular-nums" style={{ color: p.r_multiple >= 0 ? "#0ca30c" : RED }}>
          {formatR(p.r_multiple)}
        </span>
        <span className="text-[#898781]">this trade ({p.exit_reason})</span>
      </div>
    </div>
  );
}

export function EquityCurve({ trades }: { trades: ExperimentTrade[] }) {
  if (trades.length === 0) {
    return <div className="text-sm text-[#898781]">No trades to chart.</div>;
  }

  const data = buildSeries(trades);
  const firstTestIndex = data.find((d) => d.split === "test")?.index;

  return (
    <div className="space-y-1">
      <div>
        <div className="text-xs text-[#898781] mb-2">Cumulative R by trade (validation + test, chronological)</div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="index"
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: "#383835" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: "#383835" }}
              tickLine={false}
              tickFormatter={(v) => `${v}R`}
              width={40}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
            <ReferenceLine y={0} stroke="#383835" strokeWidth={1} />
            {firstTestIndex && (
              <ReferenceLine
                x={firstTestIndex}
                stroke={MUTED}
                strokeDasharray="2 2"
                label={{ value: "test →", position: "insideTopRight", fill: MUTED, fontSize: 11 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke={BLUE}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: BLUE, stroke: SURFACE, strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div>
        <div className="text-xs text-[#898781] mb-2 mt-4">Drawdown (R below running peak)</div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              tick={{ fill: MUTED, fontSize: 11 }}
              axisLine={{ stroke: "#383835" }}
              tickLine={false}
              tickFormatter={(v) => `${v}R`}
              width={40}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: MUTED, strokeWidth: 1 }} />
            <Area
              type="monotone"
              dataKey="drawdown"
              stroke={RED}
              strokeWidth={2}
              fill={RED}
              fillOpacity={0.1}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
