import Link from "next/link";
import { FlaskConical, CheckCircle2, Percent, Tags, ArrowRight } from "lucide-react";
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
        <h1 className="text-2xl font-semibold mb-1.5 text-white">Experiments</h1>
        <p className="text-sm text-[#898781] max-w-2xl">
          Every candidate rule the discovery engine has found and tested, newest first. Discovery-set
          numbers are excluded from the pass/fail verdict on purpose — only validation and out-of-sample
          test performance count.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Total experiments" value={String(experiments.length)} icon={FlaskConical} />
        <StatTile
          label="Survived validation"
          value={String(passing)}
          tone={passing > 0 ? "good" : "neutral"}
          icon={CheckCircle2}
        />
        <StatTile
          label="Pass rate"
          value={experiments.length ? formatPct(passing / experiments.length) : "—"}
          icon={Percent}
        />
        <StatTile
          label="Symbols covered"
          value={String(new Set(experiments.map((e) => e.symbol)).size)}
          icon={Tags}
        />
      </div>

      {experiments.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-[#1a1a19] px-4 py-10 text-center text-sm text-[#898781]">
          No experiments saved yet. Run <code className="text-[#c3c2b7]">python run_research.py</code> to
          generate the first one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10 shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02] text-left text-xs text-[#898781]">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium text-right">Val. expectancy</th>
                <th className="px-4 py-3 font-medium text-right">Test expectancy</th>
                <th className="px-4 py-3 font-medium text-right">Test PF</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {experiments.map((exp) => {
                const valExp = exp.validation_stats?.expectancy_r;
                const testExp = exp.test_stats?.expectancy_r;
                return (
                  <tr key={exp.id} className="group border-b border-white/5 last:border-0 hover:bg-white/[0.035]">
                    <td className="px-4 py-3 text-[#c3c2b7] whitespace-nowrap">{formatDate(exp.created_at)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="text-white font-medium">{exp.symbol}</span>{" "}
                      <span className="text-[#898781]">{exp.interval}</span>
                    </td>
                    <td className="px-4 py-3 max-w-md truncate text-[#c3c2b7]" title={exp.rule}>
                      <Link
                        href={`/experiments/${exp.id}`}
                        className="transition-colors hover:text-[#3987e5]"
                        style={{ fontFamily: "var(--font-geist-mono)" }}
                      >
                        {exp.rule}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: valExp == null ? "#898781" : valExp > 0 ? "#0ca30c" : "#d03b3b" }}
                    >
                      {formatR(valExp)}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: testExp == null ? "#898781" : testExp > 0 ? "#0ca30c" : "#d03b3b" }}
                    >
                      {formatR(testExp)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[#c3c2b7]">
                      {formatNum(exp.test_stats?.profit_factor)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge verdict={verdict(exp)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/experiments/${exp.id}`}>
                        <ArrowRight
                          size={15}
                          className="text-[#898781] opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
