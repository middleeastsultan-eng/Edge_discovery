import Link from "next/link";
import { Radio, ShieldCheck, Activity, Bell, ArrowRight, Wallet, TrendingDown, Percent, Trophy } from "lucide-react";
import {
  supabase, type Experiment, type ForwardValidation, type ForwardValidationHistoryRow,
  type ForwardSignalAlert, type PaperAccount, type PaperTrade, type ExperimentTrade,
} from "@/lib/supabase";
import { computeRecurrence } from "@/lib/recurrence";
import { fetchAllRows } from "@/lib/fetchAll";
import { StatTile } from "@/components/StatTile";
import { BannerBackground } from "@/components/BannerBackground";
import { PaperEquityCurve } from "@/components/PaperEquityCurve";
import { ForwardStatusBadge, type ForwardStatus } from "@/components/ForwardStatusBadge";
import { formatDateTime, formatNum, formatPct, formatR, formatUSD } from "@/lib/format";
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT,
  STATUS_GOOD, STATUS_WARNING, STATUS_CRITICAL, TABLE_HEADER_BG, ACCENT, tint,
} from "@/lib/theme";

export const dynamic = "force-dynamic";

// Must match trading_lab/live.py's TRACKING_MIN_SCORE -- a pattern only enters forward
// tracking at all once its backtest robustness_score.total reaches this bar. Alerting
// is a separate, higher bar earned by live performance (see ForwardStatusBadge below).
const TRACKING_MIN_SCORE = 80;

// Must match trading_lab/paper_portfolio.py's STARTING_EQUITY.
const STARTING_EQUITY = 10_000;

type TrackedExperiment = Pick<Experiment, "id" | "created_at" | "symbol" | "interval" | "rule" | "plain_english" | "robustness_score">;

export default async function LivePage() {
  let experiments: TrackedExperiment[];
  let forwardValidations: ForwardValidation[];
  let paperTrades: PaperTrade[];
  try {
    [experiments, forwardValidations, paperTrades] = await Promise.all([
      // Every tracked/promoted-pattern stat on this page derives from this list, so it
      // must be the complete table, not whatever fits under PostgREST's 1000-row cap --
      // see fetchAll.ts.
      fetchAllRows<TrackedExperiment>((from, to) =>
        supabase
          .from("experiments")
          .select("id, created_at, symbol, interval, rule, plain_english, robustness_score")
          .order("id", { ascending: false })
          .range(from, to),
      ),
      fetchAllRows<ForwardValidation>((from, to) =>
        supabase.from("forward_validation").select("*").order("experiment_id", { ascending: true }).range(from, to),
      ),
      fetchAllRows<PaperTrade>((from, to) =>
        supabase.from("paper_trades").select("*").order("id", { ascending: true }).range(from, to),
      ),
    ]);
  } catch (err) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ border: `1px solid ${BORDER}`, color: TEXT_MUTED }}>
        Failed to load: {err instanceof Error ? err.message : String(err)}
      </div>
    );
  }

  const { data: alertData } = await supabase
    .from("forward_signal_alerts")
    .select("*")
    .order("sent_at", { ascending: false })
    .limit(20);
  const { data: paperAccountData } = await supabase.from("paper_account").select("equity, watermark").eq("id", 1).single();

  const experimentById = new Map(experiments.map((e) => [e.id, e]));
  const forwardByExperiment = new Map(forwardValidations.map((fv) => [fv.experiment_id, fv]));

  const tracked = experiments.filter((e) => (e.robustness_score?.total ?? 0) >= TRACKING_MIN_SCORE);
  const promoted = tracked.filter((e) => forwardByExperiment.get(e.id)?.status === "promoted");
  const promotedCount = promoted.length;
  const trackingCount = tracked.length - promotedCount;

  // Survival history for currently-promoted patterns only -- "which ones survive the
  // most" is only meaningful for patterns that got promoted at all.
  const history = promoted.length
    ? await fetchAllRows<ForwardValidationHistoryRow>((from, to) =>
        supabase
          .from("forward_validation_history")
          .select("*")
          .in("experiment_id", promoted.map((e) => e.id))
          .order("checked_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];
  const historyByExperiment = new Map<number, ForwardValidationHistoryRow[]>();
  for (const row of history) {
    const list = historyByExperiment.get(row.experiment_id) ?? [];
    list.push(row);
    historyByExperiment.set(row.experiment_id, list);
  }

  // Forward trade timestamps for promoted patterns -- "how many times has this actually
  // fired live" and "how often does it recur" both come straight from these real entries,
  // not a guess.
  const forwardTradeData = promoted.length
    ? await fetchAllRows<Pick<ExperimentTrade, "id" | "experiment_id" | "entry_time">>((from, to) =>
        supabase
          .from("experiment_trades")
          .select("id, experiment_id, entry_time")
          .eq("split", "forward")
          .in("experiment_id", promoted.map((e) => e.id))
          .order("id", { ascending: true })
          .range(from, to),
      )
    : [];
  const forwardEntriesByExperiment = new Map<number, Date[]>();
  for (const row of forwardTradeData) {
    const list = forwardEntriesByExperiment.get(row.experiment_id) ?? [];
    list.push(new Date(row.entry_time));
    forwardEntriesByExperiment.set(row.experiment_id, list);
  }

  const survivalLeaderboard = promoted
    .map((exp) => {
      const fv = forwardByExperiment.get(exp.id);
      const rows = historyByExperiment.get(exp.id) ?? [];
      // Demotions: count every promoted -> tracking transition found in chronological order.
      let demotions = 0;
      for (let i = 1; i < rows.length; i++) {
        if (rows[i - 1].status === "promoted" && rows[i].status === "tracking") demotions++;
      }
      const latest = rows[rows.length - 1];
      const promotedAt = fv?.promoted_at ? new Date(fv.promoted_at) : null;
      const daysPromoted = promotedAt ? (Date.now() - promotedAt.getTime()) / 86_400_000 : null;
      const recurrence = computeRecurrence(forwardEntriesByExperiment.get(exp.id) ?? []);
      return { exp, fv, latest, demotions, daysPromoted, recurrence };
    })
    .sort((a, b) => (b.daysPromoted ?? 0) - (a.daysPromoted ?? 0));

  const alerts = (alertData ?? []) as ForwardSignalAlert[];

  const paperAccount = (paperAccountData ?? { equity: STARTING_EQUITY, watermark: null }) as PaperAccount;
  const paperReturnPct = paperAccount.equity / STARTING_EQUITY - 1;
  const paperWinRate = paperTrades.length ? paperTrades.filter((t) => t.pnl_dollars > 0).length / paperTrades.length : null;
  const paperMaxDrawdown = paperTrades.reduce(
    (acc, t) => {
      const peak = Math.max(acc.peak, t.equity_after);
      return { peak, maxDd: Math.min(acc.maxDd, t.equity_after - peak) };
    },
    { peak: STARTING_EQUITY, maxDd: 0 },
  ).maxDd;

  return (
    <div className="space-y-8">
      <div
        className="relative overflow-hidden rounded-2xl px-6 py-10 sm:px-10 sm:py-14 shadow-sm animate-in fade-in duration-700"
        style={{ border: `1px solid ${BORDER}` }}
      >
        <BannerBackground query="trading floor screens live market data" />
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="relative inline-flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: STATUS_GOOD }} />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_GOOD }} />
          </span>
          <h1 className="text-2xl font-semibold" style={{ color: TEXT_PRIMARY }}>
            Live Signals
          </h1>
        </div>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          A backtest score only proves a pattern worked historically. Anything scoring {TRACKING_MIN_SCORE}+
          gets a real-world shot: continuously re-checked against live market data, with trust earned by
          live performance, not inherited from the backtest -- Telegram only fires once a pattern&apos;s
          forward/paper trades have themselves proven positive, regardless of how high its backtest score was.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={`Tracked (score ≥ ${TRACKING_MIN_SCORE})`} value={String(tracked.length)} icon={ShieldCheck} />
        <StatTile
          label="Promoted (live alerts active)"
          value={String(promotedCount)}
          tone={promotedCount > 0 ? "good" : "neutral"}
          icon={Radio}
        />
        <StatTile label="Still forward-tracking" value={String(trackingCount)} icon={Activity} />
        <StatTile label="Alerts sent (recent)" value={String(alerts.length)} icon={Bell} />
      </div>

      {tracked.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No pattern has reached a {TRACKING_MIN_SCORE}/100 robustness score yet. Once one does, it will
          appear here and forward tracking begins automatically.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b text-left text-xs"
                style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}
              >
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium text-right">Forward trades</th>
                <th className="px-4 py-3 font-medium text-right">Forward win rate</th>
                <th className="px-4 py-3 font-medium text-right">Forward expectancy</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {tracked.map((exp) => {
                const fv = forwardByExperiment.get(exp.id);
                const stats = fv?.forward_stats;
                const status: ForwardStatus = fv ? fv.status : "not checked yet";
                return (
                  <tr
                    key={exp.id}
                    className="group border-b last:border-0 transition-colors hover:bg-[var(--tl-text-primary)]/[0.03]"
                    style={{ borderColor: BORDER_SOFT }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium" style={{ color: TEXT_PRIMARY }}>{exp.symbol}</span>{" "}
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
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {stats ? stats.n_trades : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {stats ? formatPct(stats.win_rate) : "—"}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: !stats ? TEXT_MUTED : stats.expectancy_r > 0 ? STATUS_GOOD : undefined }}
                    >
                      {stats ? formatR(stats.expectancy_r) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <ForwardStatusBadge status={status} />
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

      {promoted.length > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
            <Trophy size={15} style={{ color: ACCENT }} />
            Promoted patterns -- survival leaderboard
            <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
              (longest-surviving first; a demotion means forward performance later dropped back below the bar)
            </span>
          </h2>
          <div className="overflow-x-auto rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr
                  className="border-b text-left text-xs"
                  style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}
                >
                  <th className="px-4 py-3 font-medium">Symbol</th>
                  <th className="px-4 py-3 font-medium">Rule</th>
                  <th className="px-4 py-3 font-medium text-right">Days promoted</th>
                  <th className="px-4 py-3 font-medium text-right">Demotions</th>
                  <th className="px-4 py-3 font-medium text-right">Live occurrences</th>
                  <th className="px-4 py-3 font-medium text-right">Recurs every</th>
                  <th className="px-4 py-3 font-medium text-right">Bootstrap lower bound</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {survivalLeaderboard.map(({ exp, latest, demotions, daysPromoted, recurrence }) => (
                  <tr
                    key={exp.id}
                    className="group border-b last:border-0 transition-colors hover:bg-[var(--tl-text-primary)]/[0.03]"
                    style={{ borderColor: BORDER_SOFT }}
                  >
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium" style={{ color: TEXT_PRIMARY }}>{exp.symbol}</span>{" "}
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
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {daysPromoted === null ? "—" : daysPromoted.toFixed(1)}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: demotions > 0 ? STATUS_WARNING : TEXT_SECONDARY }}
                    >
                      {demotions}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>
                      {latest ? latest.n_trades : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }} title={
                      recurrence
                        ? `Based on ${recurrence.occurrences} live occurrences. Next expected roughly ${recurrence.nextExpectedWindow[0].toLocaleDateString()} - ${recurrence.nextExpectedWindow[1].toLocaleDateString()}.`
                        : "Not enough live occurrences yet to estimate frequency (need at least 3)."
                    }>
                      {recurrence ? `~${recurrence.medianGapDays.toFixed(1)}d` : "—"}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums"
                      style={{ color: !latest ? TEXT_MUTED : latest.lower_bound_r > 0 ? STATUS_GOOD : STATUS_CRITICAL }}
                    >
                      {latest ? formatR(latest.lower_bound_r) : "—"}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          <Wallet size={15} style={{ color: ACCENT }} />
          Paper portfolio
          <span className="font-normal normal-case" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
            (one simulated account taking every promoted pattern&apos;s signals, sized at 1% risk/trade)
          </span>
        </h2>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <StatTile label="Equity" value={formatUSD(paperAccount.equity)} icon={Wallet} />
          <StatTile
            label="Return since inception"
            value={formatPct(paperReturnPct)}
            tone={paperReturnPct > 0 ? "good" : paperReturnPct < 0 ? "bad" : "neutral"}
            icon={Percent}
          />
          <StatTile label="Max drawdown" value={formatUSD(paperMaxDrawdown)} tone={paperMaxDrawdown < 0 ? "bad" : "neutral"} icon={TrendingDown} />
          <StatTile label="Win rate" value={paperWinRate === null ? "—" : formatPct(paperWinRate)} icon={ShieldCheck} />
        </div>

        {paperTrades.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-10 text-center text-sm"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
          >
            No paper trades yet -- the paper account only acts on promoted patterns, and none exist yet.
            Starting equity is {formatUSD(STARTING_EQUITY)} notional; what matters once trades start is the
            % return, drawdown, and whether trusting the whole basket together actually works.
          </div>
        ) : (
          <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
            <PaperEquityCurve trades={paperTrades} />
          </div>
        )}
      </div>

      <div>
        <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          <Bell size={15} style={{ color: ACCENT }} />
          Recent trade-signal alerts
        </h2>
        {alerts.length === 0 ? (
          <div
            className="rounded-2xl px-4 py-6 text-center text-sm"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
          >
            No alerts sent yet -- Telegram only fires once a promoted pattern has a live entry signal pending.
          </div>
        ) : (
          <div className="rounded-2xl shadow-sm divide-y" style={{ border: `1px solid ${BORDER}`, borderColor: BORDER }}>
            {alerts.map((alert) => {
              const exp = experimentById.get(alert.experiment_id);
              const hasLevels = alert.entry_price != null && alert.stop_price != null && alert.target_price != null;
              return (
                <div key={alert.id} className="px-4 py-3" style={{ borderColor: BORDER_SOFT }}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-sm truncate" style={{ color: TEXT_PRIMARY, fontFamily: "var(--font-geist-mono)" }}>
                        {exp ? `${exp.symbol} ${exp.interval} -- ${exp.rule}` : `Experiment ${alert.experiment_id}`}
                      </div>
                      <div className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                        Signal bar {formatDateTime(alert.bar_time)} -- sent {formatDateTime(alert.sent_at)}
                      </div>
                    </div>
                    {exp && (
                      <Link href={`/experiments/${exp.id}`} className="shrink-0">
                        <ArrowRight size={15} style={{ color: TEXT_MUTED }} />
                      </Link>
                    )}
                  </div>
                  {hasLevels && (
                    <div className="flex items-center gap-4 mt-2.5 text-xs">
                      <div className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: tint(TEXT_MUTED, 8) }}>
                        <span style={{ color: TEXT_MUTED }}>Entry </span>
                        <span className="font-medium tabular-nums" style={{ color: TEXT_PRIMARY }}>{formatNum(alert.entry_price, 4)}</span>
                      </div>
                      <div className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: tint(STATUS_CRITICAL, 10) }}>
                        <span style={{ color: TEXT_MUTED }}>Stop </span>
                        <span className="font-medium tabular-nums" style={{ color: STATUS_CRITICAL }}>{formatNum(alert.stop_price, 4)}</span>
                      </div>
                      <div className="rounded-lg px-2.5 py-1.5" style={{ backgroundColor: tint(STATUS_GOOD, 10) }}>
                        <span style={{ color: TEXT_MUTED }}>Target </span>
                        <span className="font-medium tabular-nums" style={{ color: STATUS_GOOD }}>{formatNum(alert.target_price, 4)}</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
