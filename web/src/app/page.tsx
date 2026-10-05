import Link from "next/link";
import { supabase, type Experiment } from "@/lib/supabase";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { formatDate, formatNum, formatPct, formatR } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data, error } = await supabase
    .from("experiments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="rounded-lg border border-[#d03b3b]/40 bg-[#d03b3b]/10 px-4 py-3 text-sm text-[#d03b3b]">
        Failed to load experiments: {error.message}
      </div>
    );
  }

  const experiments = (data ?? []) as Experiment[];
  const passing = experiments.filter((e) => verdict(e) === "pass").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Experiments</h1>
        <p className="text-sm text-[#c3c2b7]">
          Every candidate rule the discovery engine has found and tested, newest first. Discovery-set
          numbers are excluded from the pass/fail verdict on purpose — only validation and out-of-sample
          test performance count.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total experiments" value={String(experiments.length)} />
        <StatTile label="Survived validation" value={String(passing)} tone={passing > 0 ? "good" : "neutral"} />
        <StatTile
          label="Pass rate"
          value={experiments.length ? formatPct(passing / experiments.length) : "—"}
        />
        <StatTile
          label="Symbols covered"
          value={String(new Set(experiments.map((e) => e.symbol)).size)}
        />
      </div>

      {experiments.length === 0 ? (
        <div className="rounded-lg border border-white/10 bg-[#1a1a19] px-4 py-8 text-center text-sm text-[#898781]">
          No experiments saved yet. Run <code className="text-[#c3c2b7]">python run_research.py</code> to
          generate the first one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs text-[#898781]">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium text-right">Val. expectancy</th>
                <th className="px-4 py-3 font-medium text-right">Test expectancy</th>
                <th className="px-4 py-3 font-medium text-right">Test PF</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp) => (
                <tr key={exp.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-[#c3c2b7] whitespace-nowrap">{formatDate(exp.created_at)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {exp.symbol} <span className="text-[#898781]">{exp.interval}</span>
                  </td>
                  <td className="px-4 py-3 max-w-md truncate text-[#c3c2b7]" title={exp.rule}>
                    <Link href={`/experiments/${exp.id}`} className="hover:text-white hover:underline">
                      {exp.rule}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatR(exp.validation_stats?.expectancy_r)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatR(exp.test_stats?.expectancy_r)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatNum(exp.test_stats?.profit_factor)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge verdict={verdict(exp)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
