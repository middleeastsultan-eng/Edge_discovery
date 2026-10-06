import Link from "next/link";
import { FlaskConical, CheckCircle2, Percent, Tags, ArrowRight } from "lucide-react";
import { supabase, type Experiment } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAll";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { StackedBar } from "@/components/StackedBar";
import { BannerBackground } from "@/components/BannerBackground";
import { formatDate, formatNum, formatPct, formatR } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT, STATUS_GOOD, STATUS_CRITICAL, TABLE_HEADER_BG, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

// Stat tiles and the verdict distribution must reflect every experiment ever run, not
// just the page of rows shown in the table below -- otherwise "Total experiments" (and
// everything derived from it) silently freezes at the table's row limit once the real
// count grows past it. verdict() only ever looks at validation_stats/test_stats'
// n_trades and expectancy_r, so this pulls just those two JSONB columns (plus symbol)
// for the whole table -- far cheaper than select("*") across every experiment.
type VerdictFields = Pick<Experiment, "id" | "symbol" | "validation_stats" | "test_stats">;

export default async function ExperimentsPage() {
  let allExperiments: VerdictFields[];
  try {
    allExperiments = await fetchAllRows<VerdictFields>((from, to) =>
      supabase.from("experiments").select("id, symbol, validation_stats, test_stats").order("id", { ascending: true }).range(from, to),
    );
  } catch (err) {
    return (
      <div
        className="rounded-lg px-4 py-3 text-sm"
        style={{ border: `1px solid ${tint(STATUS_CRITICAL, 25)}`, backgroundColor: tint(STATUS_CRITICAL, 10), color: STATUS_CRITICAL }}
      >
        Failed to load experiments: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  const { data, error } = await supabase.from("experiments").select("*").order("created_at", { ascending: false }).limit(100);

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
  const totalExperiments = allExperiments.length;
  const allVerdicts = allExperiments.map((e) => verdict(e as Experiment));
  const passing = allVerdicts.filter((v) => v === "pass").length;
  const failing = allVerdicts.filter((v) => v === "fail").length;
  const insufficient = allVerdicts.filter((v) => v === "insufficient").length;
  const symbolsCovered = new Set(allExperiments.map((e) => e.symbol)).size;

  return (
    <div className="space-y-8">
      <div
        className="relative overflow-hidden rounded-2xl px-6 py-10 sm:px-10 sm:py-14 shadow-sm animate-in fade-in duration-700"
        style={{ border: `1px solid ${BORDER}` }}
      >
        <BannerBackground query="candlestick stock chart screen" />
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
        <StatTile label="Total experiments" value={String(totalExperiments)} icon={FlaskConical} />
        <StatTile
          label="Survived validation"
          value={String(passing)}
          tone={passing > 0 ? "good" : "neutral"}
          icon={CheckCircle2}
        />
        <StatTile
          label="Pass rate"
          value={totalExperiments ? formatPct(passing / totalExperiments) : "—"}
          icon={Percent}
        />
        <StatTile label="Symbols covered" value={String(symbolsCovered)} icon={Tags} />
      </div>

      {totalExperiments > 0 && (
        <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
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

      {totalExperiments === 0 ? (
        <div
          className="rounded-2xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No experiments saved yet. Run{" "}
          <code style={{ color: TEXT_SECONDARY }}>python run_research.py</code> to generate the first one.
        </div>
      ) : (
        <div className="space-y-2">
          {totalExperiments > experiments.length && (
            <p className="text-xs" style={{ color: TEXT_MUTED }}>
              Showing the latest {experiments.length} of {totalExperiments} experiments.
            </p>
          )}
          <div className="overflow-x-auto rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
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
                    <td className="px-4 py-3 max-w-md" style={{ color: TEXT_SECONDARY }}>
                      <Link
                        href={`/experiments/${exp.id}`}
                        className="block truncate transition-colors hover:text-[var(--tl-accent)]"
                        style={{ fontFamily: "var(--font-geist-mono)" }}
                        title={exp.rule}
                      >
                        {exp.rule}
                      </Link>
                      {exp.plain_english && (
                        <div className="truncate text-xs mt-0.5" style={{ color: TEXT_MUTED }} title={exp.plain_english}>
                          {exp.plain_english}
                        </div>
                      )}
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
        </div>
      )}
    </div>
  );
}
