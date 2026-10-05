import Link from "next/link";
import { Radio, ShieldCheck, Activity, Bell, ArrowRight, Wallet, TrendingDown, Percent } from "lucide-react";
import { supabase, type Experiment, type ForwardValidation, type ForwardSignalAlert, type PaperAccount, type PaperTrade } from "@/lib/supabase";
import { StatTile } from "@/components/StatTile";
import { PageGlow } from "@/components/PageGlow";
import { PaperEquityCurve } from "@/components/PaperEquityCurve";
import { formatDateTime, formatPct, formatR, formatUSD } from "@/lib/format";
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT,
  STATUS_GOOD, STATUS_WARNING, TABLE_HEADER_BG, ACCENT, tint,
} from "@/lib/theme";

export const dynamic = "force-dynamic";

// Must match trading_lab/live.py's TRACKING_MIN_SCORE -- a pattern only enters forward
// tracking at all once its backtest robustness_score.total reaches this bar. Alerting
// is a separate, higher bar earned by live performance (see ForwardStatusBadge below).
const TRACKING_MIN_SCORE = 80;

// Must match trading_lab/paper_portfolio.py's STARTING_EQUITY.
const STARTING_EQUITY = 10_000;

type ForwardStatus = "promoted" | "tracking" | "not checked yet";

function ForwardStatusBadge({ status }: { status: ForwardStatus }) {
  const style = {
    promoted: { color: STATUS_GOOD, icon: "✓", label: "Promoted -- live alerts active" },
    tracking: { color: STATUS_WARNING, icon: "·", label: "Forward tracking" },
    "not checked yet": { color: TEXT_MUTED, icon: "·", label: "Not checked yet" },
  }[status];

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium whitespace-nowrap"
      style={{ color: style.color, borderColor: tint(style.color, 25), backgroundColor: tint(style.color, 10) }}
    >
      <span aria-hidden>{style.icon}</span>
      {style.label}
    </span>
  );
}

export default async function LivePage() {
  const [{ data: expData, error: expError }, { data: fvData }, { data: alertData }, { data: paperAccountData }, { data: paperTradeData }] = await Promise.all([
    supabase
      .from("experiments")
      .select("id, created_at, symbol, interval, rule, robustness_score")
      .order("id", { ascending: false }),
    supabase.from("forward_validation").select("*"),
    supabase.from("forward_signal_alerts").select("*").order("sent_at", { ascending: false }).limit(20),
    supabase.from("paper_account").select("equity, watermark").eq("id", 1).single(),
    supabase.from("paper_trades").select("*").order("entry_time", { ascending: true }),
  ]);

  if (expError) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ border: `1px solid ${BORDER}`, color: TEXT_MUTED }}>
        Failed to load: {expError.message}
      </div>
    );
  }

  const experiments = (expData ?? []) as Pick<Experiment, "id" | "created_at" | "symbol" | "interval" | "rule" | "robustness_score">[];
  const experimentById = new Map(experiments.map((e) => [e.id, e]));

  const forwardByExperiment = new Map((fvData ?? []).map((fv) => [fv.experiment_id, fv as ForwardValidation]));

  const tracked = experiments.filter((e) => (e.robustness_score?.total ?? 0) >= TRACKING_MIN_SCORE);
  const promotedCount = tracked.filter((e) => forwardByExperiment.get(e.id)?.status === "promoted").length;
  const trackingCount = tracked.length - promotedCount;

  const alerts = (alertData ?? []) as ForwardSignalAlert[];

  const paperAccount = (paperAccountData ?? { equity: STARTING_EQUITY, watermark: null }) as PaperAccount;
  const paperTrades = (paperTradeData ?? []) as PaperTrade[];
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
      <div className="relative">
        <PageGlow />
        <h1 className="text-2xl font-semibold mb-1.5" style={{ color: TEXT_PRIMARY }}>
          Live Signals
        </h1>
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
                    <td className="px-4 py-3 max-w-md truncate" style={{ color: TEXT_SECONDARY }} title={exp.rule}>
                      <Link
                        href={`/experiments/${exp.id}`}
                        className="transition-colors hover:text-[var(--tl-accent)]"
                        style={{ fontFamily: "var(--font-geist-mono)" }}
                      >
                        {exp.rule}
                      </Link>
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
              return (
                <div key={alert.id} className="flex items-center justify-between gap-4 px-4 py-3" style={{ borderColor: BORDER_SOFT }}>
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
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
