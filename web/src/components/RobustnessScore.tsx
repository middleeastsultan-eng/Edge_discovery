import { AlertTriangle, Gauge } from "lucide-react";
import type { Experiment } from "@/lib/supabase";
import { STATUS_GOOD, STATUS_WARNING, STATUS_CRITICAL, STATUS_SERIOUS, TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED } from "@/lib/theme";

const COMPONENT_LABELS: Record<string, string> = {
  expectancy: "Expectancy",
  oos_consistency: "Out-of-sample consistency",
  walk_forward_stability: "Walk-forward stability",
  parameter_stability: "Parameter stability",
  cost_sensitivity: "Cost sensitivity",
  sample_size: "Sample size",
  drawdown: "Drawdown",
  overfitting_resistance: "Overfitting resistance",
  profit_concentration: "Profit concentration",
};

const LABEL_COLOR: Record<string, string> = {
  Strong: STATUS_GOOD,
  Promising: STATUS_WARNING,
  Weak: STATUS_SERIOUS,
  Reject: STATUS_CRITICAL,
};

function scoreColor(value: number): string {
  if (value >= 70) return STATUS_GOOD;
  if (value >= 40) return STATUS_WARNING;
  return STATUS_CRITICAL;
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
          <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
            <Gauge size={14} style={{ color: totalColor }} />
            Robustness score
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
              style={{ color: LABEL_COLOR[score.label], backgroundColor: `${LABEL_COLOR[score.label]}1a` }}
            >
              {score.label}
            </span>
          </div>
          <p className="text-xs mt-0.5 max-w-md" style={{ color: TEXT_MUTED }}>
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
                <span style={{ color: TEXT_SECONDARY }}>{COMPONENT_LABELS[key] ?? key}</span>
                <span className="tabular-nums font-medium" style={{ color }}>
                  {value}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-black/10 overflow-hidden">
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
        <div
          className="rounded-lg px-3.5 py-3"
          style={{ border: `1px solid ${STATUS_CRITICAL}4d`, backgroundColor: `${STATUS_CRITICAL}0f` }}
        >
          <div className="flex items-center gap-1.5 text-xs font-medium mb-2" style={{ color: STATUS_SERIOUS }}>
            <AlertTriangle size={13} />
            Red flags
          </div>
          <ul className="space-y-1.5">
            {score.red_flags.map((flag, i) => (
              <li key={i} className="text-xs pl-4 relative" style={{ color: TEXT_SECONDARY }}>
                <span className="absolute left-0" style={{ color: STATUS_SERIOUS }}>·</span>
                {flag}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
