import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Dices, ShieldCheck, FlaskConical, LineChart, History, Dice5, DollarSign, SlidersHorizontal } from "lucide-react";
import { supabase, type Experiment, type ExperimentTrade } from "@/lib/supabase";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { StatsGrid } from "@/components/StatsGrid";
import { EquityCurve } from "@/components/EquityCurve";
import { RobustnessScore } from "@/components/RobustnessScore";
import { formatDateTime, formatNum, formatPct, formatR } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, STATUS_GOOD, STATUS_CRITICAL, CHART_BLUE } from "@/lib/theme";

export const dynamic = "force-dynamic";

const cardStyle = { backgroundColor: SURFACE, border: `1px solid ${BORDER}` };

function SectionHeading({ icon: Icon, children }: { icon: ElementType; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
      <Icon size={15} style={{ color: CHART_BLUE }} />
      {children}
    </h2>
  );
}

function expectancyColor(v: number | null | undefined): string | undefined {
  if (v == null) return undefined;
  return v > 0 ? STATUS_GOOD : v < 0 ? STATUS_CRITICAL : undefined;
}

export default async function ExperimentDetail(props: PageProps<"/experiments/[id]">) {
  const { id } = await props.params;

  const { data, error } = await supabase
    .from("experiments")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    notFound();
  }

  const exp = data as Experiment;
  const v = verdict(exp);
  const mc = exp.monte_carlo;

  const { data: trades } = await supabase
    .from("experiment_trades")
    .select("*")
    .eq("experiment_id", exp.id)
    .order("entry_time", { ascending: true });

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm transition-colors hover:text-[#52514e]"
          style={{ color: TEXT_MUTED }}
        >
          <ArrowLeft size={14} />
          All experiments
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div>
            <h1
              className="text-lg font-semibold leading-snug"
              style={{ color: TEXT_PRIMARY, fontFamily: "var(--font-geist-mono)" }}
            >
              {exp.rule}
            </h1>
            <p className="text-sm mt-1.5" style={{ color: TEXT_MUTED }}>
              <span className="font-medium" style={{ color: TEXT_SECONDARY }}>
                {exp.symbol}
              </span>{" "}
              · {exp.interval} · {exp.start_date} → {exp.end_date} · saved {formatDateTime(exp.created_at)}
            </p>
          </div>
          <StatusBadge verdict={v} />
        </div>
      </div>

      {exp.robustness_score && (
        <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
          <RobustnessScore score={exp.robustness_score} />
        </section>
      )}

      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={Dices}>
          Discovery set
          <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
            (optimistic by construction — not used for the verdict)
          </span>
        </SectionHeading>
        <StatsGrid stats={exp.discovery_stats} />
      </section>

      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={FlaskConical}>Validation set</SectionHeading>
        <StatsGrid stats={exp.validation_stats} />
      </section>

      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={ShieldCheck}>Final out-of-sample test set</SectionHeading>
        <StatsGrid stats={exp.test_stats} />
      </section>

      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={LineChart}>Equity curve</SectionHeading>
        <EquityCurve trades={(trades ?? []) as ExperimentTrade[]} />
      </section>

      {exp.walk_forward && exp.walk_forward.length > 0 && (
        <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={History}>Walk-forward consistency</SectionHeading>
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: BORDER, backgroundColor: "rgba(11,11,11,0.02)", color: TEXT_MUTED }}
                >
                  <th className="px-4 py-3 font-medium">Window</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 font-medium text-right">Trades</th>
                  <th className="px-4 py-3 font-medium text-right">Win rate</th>
                  <th className="px-4 py-3 font-medium text-right">Expectancy</th>
                  <th className="px-4 py-3 font-medium text-right">Profit factor</th>
                </tr>
              </thead>
              <tbody>
                {exp.walk_forward.map((w) => (
                  <tr
                    key={w.window}
                    className="border-b last:border-0 hover:bg-black/[0.02]"
                    style={{ borderColor: "rgba(11,11,11,0.06)" }}
                  >
                    <td className="px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                      {w.window}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: TEXT_SECONDARY }}>
                      {new Date(w.start).toLocaleDateString()} → {new Date(w.end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {w.n_trades}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {formatPct(w.win_rate)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: expectancyColor(w.expectancy_r) }}>
                      {formatR(w.expectancy_r)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {formatNum(w.profit_factor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
            The rule is frozen across windows — this checks consistency over time, not re-optimization.
          </p>
        </section>
      )}

      {exp.cost_stress && exp.cost_stress.length > 0 && (
        <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={DollarSign}>Cost stress — fees and slippage multiplied up</SectionHeading>
          <div className="grid grid-cols-3 gap-3">
            {exp.cost_stress.map((c) => (
              <StatTile
                key={c.cost_multiplier}
                label={`${c.cost_multiplier}x costs`}
                value={formatR(c.expectancy_r)}
                tone={c.expectancy_r > 0 ? "good" : "bad"}
              />
            ))}
          </div>
          <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
            If expectancy turns negative as costs scale up, part of the edge was a transaction-cost
            artifact rather than real signal.
          </p>
        </section>
      )}

      {exp.parameter_stability && exp.parameter_stability.perturbations.length > 0 && (
        <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={SlidersHorizontal}>
            Parameter perturbation
            <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
              (stability score: {formatPct(exp.parameter_stability.score)})
            </span>
          </SectionHeading>
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: BORDER, backgroundColor: "rgba(11,11,11,0.02)", color: TEXT_MUTED }}
                >
                  <th className="px-4 py-3 font-medium">Feature</th>
                  <th className="px-4 py-3 font-medium text-right">Nudge</th>
                  <th className="px-4 py-3 font-medium text-right">New threshold</th>
                  <th className="px-4 py-3 font-medium text-right">Trades</th>
                  <th className="px-4 py-3 font-medium text-right">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {exp.parameter_stability.perturbations.map((p, i) => (
                  <tr
                    key={i}
                    className="border-b last:border-0 hover:bg-black/[0.02]"
                    style={{ borderColor: "rgba(11,11,11,0.06)" }}
                  >
                    <td className="px-4 py-3" style={{ color: TEXT_SECONDARY, fontFamily: "var(--font-geist-mono)" }}>
                      {p.feature}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_MUTED }}>
                      {p.step_frac > 0 ? "+" : ""}
                      {(p.step_frac * 100).toFixed(0)}%σ
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {formatNum(p.perturbed_value, 4)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {p.n_trades}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: expectancyColor(p.expectancy_r) }}>
                      {formatR(p.expectancy_r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
            Run on the discovery set — this asks whether the threshold sits in a region that works, or
            whether it&apos;s an isolated spike that happened to fit the noise.
          </p>
        </section>
      )}

      {mc && (
        <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={Dice5}>Monte Carlo — bootstrap resample of test-set trades</SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <StatTile label="Median outcome" value={formatR(mc.final_r_p50)} />
            <StatTile label="5th percentile" value={formatR(mc.final_r_p5)} tone={mc.final_r_p5 < 0 ? "bad" : "neutral"} />
            <StatTile label="95th percentile" value={formatR(mc.final_r_p95)} />
            <StatTile label="Median max drawdown" value={formatR(mc.max_drawdown_r_p50)} />
            <StatTile label="95th pct. max drawdown" value={formatR(mc.max_drawdown_r_p95)} />
            <StatTile
              label="P(final result negative)"
              value={formatPct(mc.prob_final_negative)}
              tone={mc.prob_final_negative > 0.3 ? "bad" : "neutral"}
            />
          </div>
        </section>
      )}
    </div>
  );
}
