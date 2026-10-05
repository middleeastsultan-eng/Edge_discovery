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
import type { PaperTrade } from "@/lib/supabase";
import { formatUSD } from "@/lib/format";
import { CHART_BLUE, CHART_RED, TEXT_MUTED, TEXT_PRIMARY, GRIDLINE, BASELINE, SURFACE, BORDER, STATUS_GOOD } from "@/lib/theme";

type Point = {
  index: number;
  pnl_dollars: number;
  equity: number;
  drawdown: number;
  entry_time: string;
  experiment_id: number;
};

// Trades are already stored chronologically by entry_time with a running equity_after,
// so building the series is just reading equity_after through -- no need to re-derive
// cumulative sums the way EquityCurve.tsx does for per-experiment R-multiples.
function buildSeries(trades: PaperTrade[]): Point[] {
  let runningMax = -Infinity;
  return trades.map((t, i) => {
    runningMax = Math.max(runningMax, t.equity_after);
    return {
      index: i + 1,
      pnl_dollars: t.pnl_dollars,
      equity: t.equity_after,
      drawdown: Number((t.equity_after - runningMax).toFixed(2)),
      entry_time: t.entry_time,
      experiment_id: t.experiment_id,
    };
  });
}

function TooltipContent({ active, payload }: { active?: boolean; payload?: Array<{ payload: Point }> }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border px-3 py-2 text-xs shadow-sm" style={{ backgroundColor: SURFACE, borderColor: BORDER }}>
      <div className="mb-1" style={{ color: TEXT_MUTED }}>
        Trade #{p.index} · {new Date(p.entry_time).toLocaleDateString()} · experiment {p.experiment_id}
      </div>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3" style={{ backgroundColor: CHART_BLUE }} />
        <span className="font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>
          {formatUSD(p.equity)}
        </span>
        <span style={{ color: TEXT_MUTED }}>equity</span>
      </div>
      <div className="flex items-center gap-2 mt-0.5">
        <span className="h-0.5 w-3" style={{ backgroundColor: p.pnl_dollars >= 0 ? STATUS_GOOD : CHART_RED }} />
        <span className="tabular-nums" style={{ color: p.pnl_dollars >= 0 ? STATUS_GOOD : CHART_RED }}>
          {formatUSD(p.pnl_dollars)}
        </span>
        <span style={{ color: TEXT_MUTED }}>this trade</span>
      </div>
    </div>
  );
}

export function PaperEquityCurve({ trades }: { trades: PaperTrade[] }) {
  if (trades.length === 0) {
    return <div className="text-sm" style={{ color: TEXT_MUTED }}>No paper trades yet.</div>;
  }

  const data = buildSeries(trades);
  const starting = data[0].equity - data[0].pnl_dollars;

  return (
    <div className="space-y-1">
      <div>
        <div className="text-xs mb-2" style={{ color: TEXT_MUTED }}>
          Paper account equity by trade, chronological across every promoted pattern
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="index" tick={{ fill: TEXT_MUTED, fontSize: 11 }} axisLine={{ stroke: BASELINE }} tickLine={false} />
            <YAxis
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              axisLine={{ stroke: BASELINE }}
              tickLine={false}
              tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}`}
              width={64}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: TEXT_MUTED, strokeWidth: 1 }} />
            <ReferenceLine y={starting} stroke={BASELINE} strokeWidth={1} strokeDasharray="2 2" />
            <Line
              type="monotone"
              dataKey="equity"
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
          Drawdown (dollars below running peak)
        </div>
        <ResponsiveContainer width="100%" height={120}>
          <ComposedChart data={data} margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRIDLINE} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="index" hide />
            <YAxis
              tick={{ fill: TEXT_MUTED, fontSize: 11 }}
              axisLine={{ stroke: BASELINE }}
              tickLine={false}
              tickFormatter={(v) => `$${Number(v).toLocaleString("en-US")}`}
              width={64}
            />
            <Tooltip content={<TooltipContent />} cursor={{ stroke: TEXT_MUTED, strokeWidth: 1 }} />
            <Area type="monotone" dataKey="drawdown" stroke={CHART_RED} strokeWidth={2} fill={CHART_RED} fillOpacity={0.1} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
