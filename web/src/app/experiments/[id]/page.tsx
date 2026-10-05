import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase, type Experiment } from "@/lib/supabase";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { StatsGrid } from "@/components/StatsGrid";
import { formatDateTime, formatNum, formatPct, formatR } from "@/lib/format";

export const dynamic = "force-dynamic";

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

  return (
    <div className="space-y-10">
      <div>
        <Link href="/" className="text-sm text-[#898781] hover:text-[#c3c2b7]">
          ← All experiments
        </Link>
        <div className="flex items-start justify-between gap-4 mt-2">
          <div>
            <h1 className="text-xl font-semibold">{exp.rule}</h1>
            <p className="text-sm text-[#898781] mt-1">
              {exp.symbol} · {exp.interval} · {exp.start_date} → {exp.end_date} · saved{" "}
              {formatDateTime(exp.created_at)}
            </p>
          </div>
          <StatusBadge verdict={v} />
        </div>
      </div>

      <section>
        <h2 className="text-sm font-medium text-[#898781] uppercase tracking-wide mb-3">
          Discovery set <span className="normal-case text-[#898781]/70">(optimistic by construction — not used for the verdict)</span>
        </h2>
        <StatsGrid stats={exp.discovery_stats} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#898781] uppercase tracking-wide mb-3">Validation set</h2>
        <StatsGrid stats={exp.validation_stats} />
      </section>

      <section>
        <h2 className="text-sm font-medium text-[#898781] uppercase tracking-wide mb-3">
          Final out-of-sample test set
        </h2>
        <StatsGrid stats={exp.test_stats} />
      </section>

      {exp.walk_forward && exp.walk_forward.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-[#898781] uppercase tracking-wide mb-3">
            Walk-forward consistency
          </h2>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs text-[#898781]">
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
                  <tr key={w.window} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">{w.window}</td>
                    <td className="px-4 py-3 text-[#c3c2b7] whitespace-nowrap">
                      {new Date(w.start).toLocaleDateString()} → {new Date(w.end).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{w.n_trades}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatPct(w.win_rate)}</td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: w.expectancy_r > 0 ? "#0ca30c" : w.expectancy_r < 0 ? "#d03b3b" : undefined }}
                    >
                      {formatR(w.expectancy_r)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{formatNum(w.profit_factor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-[#898781] mt-2">
            The rule is frozen across windows — this checks consistency over time, not re-optimization.
          </p>
        </section>
      )}

      {mc && (
        <section>
          <h2 className="text-sm font-medium text-[#898781] uppercase tracking-wide mb-3">
            Monte Carlo — bootstrap resample of test-set trades
          </h2>
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
