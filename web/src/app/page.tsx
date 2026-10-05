import Link from "next/link";
import { FlaskConical, CheckCircle2, Percent, Tags, ArrowRight } from "lucide-react";
import { supabase, type Experiment } from "@/lib/supabase";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { StackedBar } from "@/components/StackedBar";
import { formatDate, formatNum, formatPct, formatR } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT, STATUS_GOOD, STATUS_CRITICAL, TABLE_HEADER_BG, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { data, error } = await supabase
    .from("experiments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{ border: `1px solid ${tint(STATUS_CRITICAL, 25)}`, backgroundColor: tint(STATUS_CRITICAL, 10), color: STATUS_CRITICAL }}
      >
        Failed to load experiments: {error.message}
      </div>
    );
  }

  const experiments = (data ?? []) as Experiment[];
  const passing = experiments.filter((e) => verdict(e) === "pass").length;
  const failing = experiments.filter((e) => verdict(e) === "fail").length;
  const insufficient = experiments.filter((e) => verdict(e) === "insufficient").length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold mb-1.5" style={{ color: TEXT_PRIMARY }}>
          Experiments
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
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

      {experiments.length > 0 && (
        <div className="rounded-xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
          <h2 className="text-xs mb-3" style={{ color: TEXT_MUTED }}>
            Verdict distribution
          </h2>
          <StackedBar
            segments={[
              { value: passing, color: STATUS_GOOD, label: "Survived validation" },
              { value: failing, color: STATUS_CRITICAL, label: "Failed validation" },
              { value: insufficient, color: TEXT_MUTED, label: "Not enough trades" },
            ]}
          />
        </div>
      )}

      {experiments.length === 0 ? (
        <div
          className="rounded-xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No experiments saved yet. Run{" "}
          <code style={{ color: TEXT_SECONDARY }}>python run_research.py</code> to generate the first one.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b text-left text-xs"
                style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}
              >
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
                  <tr
                    key={exp.id}
                    className="group border-b last:border-0 transition-colors hover:bg-[var(--tl-text-primary)]/[0.03]"
                    style={{ borderColor: BORDER_SOFT }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: TEXT_SECONDARY }}>
                      {formatDate(exp.created_at)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                        {exp.symbol}
                      </span>{" "}
                      <span style={{ color: TEXT_MUTED }}>{exp.interval}</span>
                    </td>
                    <td className="px-4 py-3 max-w-md truncate" style={{ color: TEXT_SECONDARY }} title={exp.rule}>
                      <Link
                        href={`/experiments/${exp.id}`}
                        className="transition-colors hover:text-[var(--tl-chart-blue)]"
                        style={{ fontFamily: "var(--font-geist-mono)" }}
                      >
                        {exp.rule}
                      </Link>
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: valExp == null ? TEXT_MUTED : valExp > 0 ? STATUS_GOOD : STATUS_CRITICAL }}
                    >
                      {formatR(valExp)}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: testExp == null ? TEXT_MUTED : testExp > 0 ? STATUS_GOOD : STATUS_CRITICAL }}
                    >
                      {formatR(testExp)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {formatNum(exp.test_stats?.profit_factor)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge verdict={verdict(exp)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/experiments/${exp.id}`}>
                        <ArrowRight
                          size={15}
                          className="opacity-0 transition-opacity group-hover:opacity-100"
                          style={{ color: TEXT_MUTED }}
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
