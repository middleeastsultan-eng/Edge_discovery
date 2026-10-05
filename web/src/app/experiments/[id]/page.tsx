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

export const dynamic = "force-dynamic";

function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: ElementType;
  children: ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium text-[#c3c2b7] mb-3">
      <Icon size={15} className="text-[#3987e5]" />
      {children}
    </h2>
  );
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
          className="inline-flex items-center gap-1.5 text-sm text-[#898781] transition-colors hover:text-[#c3c2b7]"
        >
          <ArrowLeft size={14} />
          All experiments
        </Link>
        <div className="flex items-start justify-between gap-4 mt-3">
          <div>
            <h1
              className="text-lg font-semibold text-white leading-snug"
              style={{ fontFamily: "var(--font-geist-mono)" }}
            >
              {exp.rule}
            </h1>
            <p className="text-sm text-[#898781] mt-1.5">
              <span className="text-[#c3c2b7] font-medium">{exp.symbol}</span> · {exp.interval} ·{" "}
              {exp.start_date} → {exp.end_date} · saved {formatDateTime(exp.created_at)}
            </p>
          </div>
          <StatusBadge verdict={v} />
        </div>
      </div>

      {exp.robustness_score && (
        <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
          <RobustnessScore score={exp.robustness_score} />
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
        <SectionHeading icon={Dices}>
          Discovery set
          <span className="font-normal text-[#898781]/70 normal-case">
            (optimistic by construction — not used for the verdict)
          </span>
        </SectionHeading>
        <StatsGrid stats={exp.discovery_stats} />
      </section>

      <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
        <SectionHeading icon={FlaskConical}>Validation set</SectionHeading>
        <StatsGrid stats={exp.validation_stats} />
      </section>

      <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
        <SectionHeading icon={ShieldCheck}>Final out-of-sample test set</SectionHeading>
        <StatsGrid stats={exp.test_stats} />
      </section>

      <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
        <SectionHeading icon={LineChart}>Equity curve</SectionHeading>
        <EquityCurve trades={(trades ?? []) as ExperimentTrade[]} />
      </section>

      {exp.walk_forward && exp.walk_forward.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
          <SectionHeading icon={History}>Walk-forward consistency</SectionHeading>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs text-[#898781]">
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
                  <tr key={w.window} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-[#c3c2b7]">{w.window}</td>
                    <td className="px-4 py-3 text-[#c3c2b7] whitespace-nowrap">
                      {new Date(w.start).toLocaleDateString()} → {new Date(w.end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">{w.n_trades}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">{formatPct(w.win_rate)}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: w.expectancy_r > 0 ? "#0ca30c" : w.expectancy_r < 0 ? "#d03b3b" : undefined }}
                    >
                      {formatR(w.expectancy_r)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">{formatNum(w.profit_factor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#898781] mt-3">
            The rule is frozen across windows — this checks consistency over time, not re-optimization.
          </p>
        </section>
      )}

      {exp.cost_stress && exp.cost_stress.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
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
          <p className="text-xs text-[#898781] mt-3">
            If expectancy turns negative as costs scale up, part of the edge was a transaction-cost
            artifact rather than real signal.
          </p>
        </section>
      )}

      {exp.parameter_stability && exp.parameter_stability.perturbations.length > 0 && (
        <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
          <SectionHeading icon={SlidersHorizontal}>
            Parameter perturbation
            <span className="font-normal text-[#898781]/70 normal-case">
              (stability score: {formatPct(exp.parameter_stability.score)})
            </span>
          </SectionHeading>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs text-[#898781]">
                  <th className="px-4 py-3 font-medium">Feature</th>
                  <th className="px-4 py-3 font-medium text-right">Nudge</th>
                  <th className="px-4 py-3 font-medium text-right">New threshold</th>
                  <th className="px-4 py-3 font-medium text-right">Trades</th>
                  <th className="px-4 py-3 font-medium text-right">Expectancy</th>
                </tr>
              </thead>
              <tbody>
                {exp.parameter_stability.perturbations.map((p, i) => (
                  <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-[#c3c2b7]" style={{ fontFamily: "var(--font-geist-mono)" }}>
                      {p.feature}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#898781]">
                      {p.step_frac > 0 ? "+" : ""}
                      {(p.step_frac * 100).toFixed(0)}%σ
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">{formatNum(p.perturbed_value, 4)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">{p.n_trades}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: p.expectancy_r > 0 ? "#0ca30c" : p.expectancy_r < 0 ? "#d03b3b" : undefined }}
                    >
                      {formatR(p.expectancy_r)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#898781] mt-3">
            Run on the discovery set — this asks whether the threshold sits in a region that works, or
            whether it's an isolated spike that happened to fit the noise.
          </p>
        </section>
      )}

      {mc && (
        <section className="rounded-xl border border-white/10 bg-[#1a1a19] p-4 shadow-sm">
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
