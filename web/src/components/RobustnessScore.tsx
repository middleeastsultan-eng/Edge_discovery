import { AlertTriangle, Gauge } from "lucide-react";
import type { Experiment } from "@/lib/supabase";

const COMPONENT_LABELS: Record<string, string> = {
  expectancy: "Expectancy",
  oos_consistency: "Out-of-sample consistency",
  walk_forward_stability: "Walk-forward stability",
  parameter_stability: "Parameter stability",
  cost_sensitivity: "Cost sensitivity",
  sample_size: "Sample size",
  drawdown: "Drawdown",
  overfitting_resistance: "Overfitting resistance",
};

function scoreColor(value: number): string {
  if (value >= 70) return "#0ca30c";
  if (value >= 40) return "#fab219";
  return "#d03b3b";
}

export function RobustnessScore({ score }: { score: NonNullable<Experiment["robustness_score"]> }) {
  const totalColor = scoreColor(score.total);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div
          className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 text-lg font-bold tabular-nums"
          style={{ borderColor: totalColor, color: totalColor }}
        >
          {Math.round(score.total)}
        </div>
        <div>
          <div className="flex items-center gap-1.5 text-sm font-medium text-white">
            <Gauge size={14} style={{ color: totalColor }} />
            Robustness score
          </div>
          <p className="text-xs text-[#898781] mt-0.5 max-w-md">
            A summary across the dimensions that separate a real edge from an overfit one.
            It is not proof of future profitability.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
        {Object.entries(score.components).map(([key, value]) => {
          const color = scoreColor(value);
          return (
            <div key={key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-[#c3c2b7]">{COMPONENT_LABELS[key] ?? key}</span>
                <span className="tabular-nums font-medium" style={{ color }}>
                  {value}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {score.red_flags.length > 0 && (
        <div className="rounded-lg border border-[#d03b3b]/30 bg-[#d03b3b]/[0.06] px-3.5 py-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-[#ec835a] mb-2">
            <AlertTriangle size={13} />
            Red flags
          </div>
          <ul className="space-y-1.5">
            {score.red_flags.map((flag, i) => (
              <li key={i} className="text-xs text-[#c3c2b7] pl-4 relative">
                <span className="absolute left-0 text-[#ec835a]">·</span>
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
