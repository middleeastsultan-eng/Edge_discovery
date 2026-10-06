import Link from "next/link";
import type { ElementType, ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowLeft, Dices, ShieldCheck, FlaskConical, LineChart, CandlestickChart, History, Dice5, DollarSign, SlidersHorizontal, Microscope, Radio, Repeat } from "lucide-react";
import { supabase, type Experiment, type ExperimentTrade, type ForwardValidation } from "@/lib/supabase";
import { verdict } from "@/lib/evaluate";
import { StatusBadge } from "@/components/StatusBadge";
import { StatTile } from "@/components/StatTile";
import { StatsGrid } from "@/components/StatsGrid";
import { EquityCurve } from "@/components/EquityCurve";
import { RobustnessScore } from "@/components/RobustnessScore";
import { BannerBackground } from "@/components/BannerBackground";
import { PatternChart } from "@/components/PatternChart";
import { ForwardStatusBadge, type ForwardStatus } from "@/components/ForwardStatusBadge";
import { getCandles, toPercentChangeSeries } from "@/lib/candles";
import { detectDivergences, type DivergenceEvent } from "@/lib/structure";
import { fetchAllRows } from "@/lib/fetchAll";
import { computeFeatureSeries, evaluateSignal } from "@/lib/indicators";
import { computeRecurrence } from "@/lib/recurrence";
import { formatDateTime, formatNum, formatPct, formatR } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT, STATUS_GOOD, STATUS_CRITICAL, ACCENT, TABLE_HEADER_BG, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

const cardStyle = { backgroundColor: SURFACE, border: `1px solid ${BORDER}` };

// Must match trading_lab/backtest.py's BacktestConfig defaults -- the same multiples
// compute_trade_levels() in live.py uses to price a real entry.
const SL_ATR = 1.0;
const TP_ATR = 2.0;

function SectionHeading({ icon: Icon, children }: { icon: ElementType; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
      <Icon size={15} style={{ color: ACCENT }} />
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

  // Long-running tracked patterns accumulate forward trades indefinitely -- an unbounded
  // .select() alone isn't safe past 1000 rows (PostgREST's silent default cap, see
  // fetchAll.ts), so every trade (equity curve, chart markers, recurrence stats) is
  // fetched through the same paginating helper used elsewhere.
  const trades = await fetchAllRows<ExperimentTrade>((from, to) =>
    supabase
      .from("experiment_trades")
      .select("*")
      .eq("experiment_id", exp.id)
      .order("id", { ascending: true })
      .range(from, to),
  );

  const tradeList = trades;
  const forwardTrades = tradeList.filter((t) => t.split === "forward");
  const historicalTrades = tradeList.filter((t) => t.split !== "forward");

  const { data: fvData } = await supabase
    .from("forward_validation")
    .select("*")
    .eq("experiment_id", exp.id)
    .maybeSingle();
  const forwardValidation = fvData as ForwardValidation | null;
  const forwardStatus: ForwardStatus = forwardValidation ? forwardValidation.status : "not checked yet";

  // "How many times has this fired live" and "how often does it recur" -- prefer the
  // live/forward record once there's enough of it (>=3 occurrences) to say anything
  // meaningful; otherwise fall back to the larger historical (validation+test) sample,
  // clearly labeled as backtest-derived rather than proven live frequency.
  const liveRecurrence = computeRecurrence(forwardTrades.map((t) => new Date(t.entry_time)));
  const historicalRecurrence = computeRecurrence(historicalTrades.map((t) => new Date(t.entry_time)));
  const recurrence = liveRecurrence ?? historicalRecurrence;
  const recurrenceSource: "live" | "historical" | null = liveRecurrence ? "live" : historicalRecurrence ? "historical" : null;

  // Chart only the validation+test window the trades actually span (plus a little
  // padding), not the full multi-year discovery range -- same "discovery-set
  // performance is excluded, it's optimistic by construction" reasoning used
  // everywhere else on this page, and keeps the candle fetch bounded.
  let candles: Awaited<ReturnType<typeof getCandles>> = [];
  let qqqSeries: { time: number; value: number }[] = [];
  let spySeries: { time: number; value: number }[] = [];
  let divergenceEvents: DivergenceEvent[] = [];
  if (tradeList.length > 0 && exp.source) {
    const entryTimes = tradeList.map((t) => new Date(t.entry_time).getTime());
    const exitTimes = tradeList.map((t) => new Date(t.exit_time).getTime());
    const padMs = 20 * 24 * 60 * 60 * 1000; // 20 days
    const chartStart = new Date(Math.min(...entryTimes) - padMs);
    const chartEnd = new Date(Math.min(Math.max(...exitTimes) + padMs, Date.now()));
    candles = await getCandles(exp.symbol, exp.interval, exp.source, chartStart, chartEnd);

    // Index overlay: Nasdaq 100 (QQQ) and S&P 500 (SPY), normalized to % change so
    // they're comparable on the same chart regardless of this experiment's own symbol
    // or absolute price level. Reuse the already-fetched candles when this experiment
    // IS QQQ or SPY instead of re-fetching the identical data.
    const [qqqCandles, spyCandles] = await Promise.all([
      exp.symbol === "QQQ" ? Promise.resolve(candles) : getCandles("QQQ", exp.interval, "stocks", chartStart, chartEnd),
      exp.symbol === "SPY" ? Promise.resolve(candles) : getCandles("SPY", exp.interval, "stocks", chartStart, chartEnd),
    ]);
    qqqSeries = toPercentChangeSeries(qqqCandles);
    spySeries = toPercentChangeSeries(spyCandles);

    // Structure divergence: QQQ breaks a recent swing high/low and SPY doesn't confirm
    // it (or vice versa) around the same time -- a pro trader's observation that this
    // has preceded a strong directional run. Flagged for tracking/visual confirmation;
    // not yet wired into discovery/backtesting, which only looks at one symbol at a time.
    divergenceEvents = detectDivergences(qqqCandles, spyCandles);
  }

  // Signal overlay: where the rule's raw boolean condition was historically true, not
  // just where trades were actually taken (the markers already show that separately).
  const features = computeFeatureSeries(candles);
  const signal = evaluateSignal(features, exp.clauses);

  // Buy/sell price lines: a concrete worked example tied to the most recent real trade,
  // computed the same way trading_lab/live.py's compute_trade_levels() prices an entry.
  let latestTradeLevels: { entry: number; stop: number; target: number } | null = null;
  if (tradeList.length > 0) {
    const latestTrade = tradeList[tradeList.length - 1];
    const entryTimeSec = Math.floor(new Date(latestTrade.entry_time).getTime() / 1000);
    const entryFeatureRow = features.find((f) => f.time === entryTimeSec);
    if (entryFeatureRow?.atr_14 !== undefined) {
      const atr = entryFeatureRow.atr_14;
      latestTradeLevels = {
        entry: latestTrade.entry_price,
        stop: latestTrade.entry_price - SL_ATR * atr,
        target: latestTrade.entry_price + TP_ATR * atr,
      };
    }
  }

  return (
    <div className="space-y-10">
      <div>
        <Link
          href="/experiments"
          className="inline-flex items-center gap-1.5 text-sm transition-colors hover:text-[var(--tl-text-secondary)]"
          style={{ color: TEXT_MUTED }}
        >
          <ArrowLeft size={14} />
          All experiments
        </Link>
      </div>

      <section className="relative overflow-hidden rounded-2xl p-5 shadow-sm space-y-5 animate-in fade-in duration-700" style={cardStyle}>
        <BannerBackground query="financial charts analysis abstract" />
        <div className="flex items-start justify-between gap-4">
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

        {exp.robustness_score && (
          <div className="pt-5" style={{ borderTop: `1px solid ${BORDER}` }}>
            <RobustnessScore score={exp.robustness_score} />
          </div>
        )}
      </section>

      {exp.information_test && (
        <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={Microscope}>
            Level-1 information test
            <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
              (does the condition shift the next-{exp.information_test.horizon}-bar return distribution?)
            </span>
            {exp.information_test.label && (
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                style={{ color: STATUS_GOOD, backgroundColor: tint(STATUS_GOOD, 10) }}
              >
                {exp.information_test.label.replace(/_/g, " ")}
              </span>
            )}
          </SectionHeading>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatTile
              label="Conditional mean return"
              value={`${(exp.information_test.conditional_mean_return * 100).toFixed(3)}%`}
              tone={exp.information_test.conditional_mean_return > exp.information_test.baseline_mean_return ? "good" : "bad"}
            />
            <StatTile label="Baseline mean return" value={`${(exp.information_test.baseline_mean_return * 100).toFixed(3)}%`} />
            {exp.information_test.gross_edge !== undefined ? (
              <StatTile
                label="Gross edge"
                value={`${exp.information_test.gross_edge > 0 ? "+" : ""}${(exp.information_test.gross_edge * 100).toFixed(3)}%`}
                tone={exp.information_test.gross_edge > 0 ? "good" : "bad"}
              />
            ) : exp.information_test.difference !== undefined ? (
              <StatTile
                label="Difference"
                value={`${exp.information_test.difference > 0 ? "+" : ""}${(exp.information_test.difference * 100).toFixed(3)}%`}
                tone={exp.information_test.difference > 0 ? "good" : "bad"}
              />
            ) : null}
            {exp.information_test.net_edge !== undefined && (
              <StatTile
                label="Net edge (after est. costs)"
                value={`${exp.information_test.net_edge > 0 ? "+" : ""}${(exp.information_test.net_edge * 100).toFixed(3)}%`}
                tone={exp.information_test.net_edge > 0 ? "good" : "bad"}
              />
            )}
            {exp.information_test.effect_size !== undefined && (
              <StatTile label="Effect size (rank-biserial)" value={exp.information_test.effect_size.toFixed(3)} />
            )}
            {exp.information_test.cost_estimate !== undefined && (
              <StatTile label="Est. round-trip cost" value={`${(exp.information_test.cost_estimate * 100).toFixed(3)}%`} />
            )}
            <StatTile label="P(positive) | condition" value={formatPct(exp.information_test.conditional_p_positive)} />
            <StatTile label="P(positive) | baseline" value={formatPct(exp.information_test.baseline_p_positive)} />
          </div>
          <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
            p = {exp.information_test.p_value < 0.0001 ? exp.information_test.p_value.toExponential(2) : exp.information_test.p_value.toFixed(4)}
            {exp.information_test.q_value !== undefined && (
              <> · q = {exp.information_test.q_value < 0.0001 ? exp.information_test.q_value.toExponential(2) : exp.information_test.q_value.toFixed(4)} (FDR-adjusted)</>
            )}
            {" "}· n={exp.information_test.n_condition} condition / {exp.information_test.n_baseline} baseline.
            Significance alone isn&apos;t the whole story — with enough observations a tiny, economically meaningless
            difference can produce a tiny p-value, which is why effect size and the raw difference are shown
            alongside it, not instead of it.
          </p>
        </section>
      )}

      <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={Dices}>
          Discovery set
          <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
            (optimistic by construction — not used for the verdict)
          </span>
        </SectionHeading>
        <StatsGrid stats={exp.discovery_stats} />
      </section>

      <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={FlaskConical}>Validation set</SectionHeading>
        <StatsGrid stats={exp.validation_stats} />
      </section>

      <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={ShieldCheck}>Final out-of-sample test set</SectionHeading>
        <StatsGrid stats={exp.test_stats} />
      </section>

      <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={CandlestickChart}>
          Pattern on the chart
          <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
            (validation + test window -- gold strip above shows when the rule&apos;s condition was true;
            trade markers show where it actually entered)
          </span>
        </SectionHeading>
        <PatternChart
          candles={candles} trades={tradeList} signal={signal} latestTradeLevels={latestTradeLevels}
          qqqSeries={qqqSeries} spySeries={spySeries} divergenceEvents={divergenceEvents}
        />
      </section>

      <section className="rounded-2xl p-4 shadow-sm space-y-4" style={cardStyle}>
        <SectionHeading icon={Radio}>
          Live tracking
          <ForwardStatusBadge status={forwardStatus} />
        </SectionHeading>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatTile label="Live occurrences (forward trades)" value={String(forwardTrades.length)} />
          <StatTile
            label="Forward win rate"
            value={forwardValidation?.forward_stats ? formatPct(forwardValidation.forward_stats.win_rate) : "—"}
          />
          <StatTile
            label="Forward expectancy"
            value={forwardValidation?.forward_stats ? formatR(forwardValidation.forward_stats.expectancy_r) : "—"}
            tone={
              !forwardValidation?.forward_stats ? "neutral"
              : forwardValidation.forward_stats.expectancy_r > 0 ? "good"
              : forwardValidation.forward_stats.expectancy_r < 0 ? "bad" : "neutral"
            }
          />
          <StatTile
            label="Promoted since"
            value={forwardValidation?.promoted_at ? new Date(forwardValidation.promoted_at).toLocaleDateString() : "—"}
          />
        </div>

        <div className="pt-1" style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
          <h3 className="flex items-center gap-1.5 text-xs font-medium pt-3 mb-2" style={{ color: TEXT_SECONDARY }}>
            <Repeat size={13} style={{ color: ACCENT }} />
            How often does this recur?
          </h3>
          {recurrence ? (
            <div className="text-sm" style={{ color: TEXT_SECONDARY }}>
              Based on {recurrence.occurrences}{" "}
              {recurrenceSource === "live" ? "live forward trades" : "historical (validation + test) trades"}, this
              pattern has fired roughly every{" "}
              <span className="font-medium" style={{ color: TEXT_PRIMARY }}>{recurrence.medianGapDays.toFixed(1)} days</span>{" "}
              (typically between {recurrence.p25GapDays.toFixed(1)} and {recurrence.p75GapDays.toFixed(1)} days apart).
              Last occurrence: {recurrence.lastOccurrence.toLocaleDateString()}. Based on that pace, the next
              occurrence might land around{" "}
              <span className="font-medium" style={{ color: TEXT_PRIMARY }}>{recurrence.nextExpectedMedian.toLocaleDateString()}</span>{" "}
              (roughly {recurrence.nextExpectedWindow[0].toLocaleDateString()} to {recurrence.nextExpectedWindow[1].toLocaleDateString()}).
              {recurrenceSource === "historical" && (
                <span className="block mt-1" style={{ color: TEXT_MUTED }}>
                  Not enough live occurrences yet to base this on live data alone -- shown using the larger
                  historical sample instead.
                </span>
              )}
              <span className="block mt-1 text-xs" style={{ color: TEXT_MUTED }}>
                This is a rough estimate from past gaps, not a schedule -- real markets don&apos;t repeat on a fixed
                clock, and the gap between occurrences has varied (see range above).
              </span>
            </div>
          ) : (
            <p className="text-sm" style={{ color: TEXT_MUTED }}>
              Not enough occurrences yet ({Math.max(forwardTrades.length, historicalTrades.length)} so far, need at
              least 3) to estimate how often this pattern recurs.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
        <SectionHeading icon={LineChart}>Equity curve</SectionHeading>
        <EquityCurve trades={tradeList} />
      </section>

      {exp.walk_forward && exp.walk_forward.length > 0 && (
        <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
          <SectionHeading icon={History}>Walk-forward consistency</SectionHeading>
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}
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
                    className="border-b last:border-0 hover:bg-[var(--tl-text-primary)]/[0.03]"
                    style={{ borderColor: BORDER_SOFT }}
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
        <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
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
        <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
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
                  style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}
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
                    className="border-b last:border-0 hover:bg-[var(--tl-text-primary)]/[0.03]"
                    style={{ borderColor: BORDER_SOFT }}
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
        <section className="rounded-2xl p-4 shadow-sm" style={cardStyle}>
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
