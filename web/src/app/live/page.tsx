import Link from "next/link";
import { Radio, ShieldCheck, Activity, Bell, ArrowRight } from "lucide-react";
import { supabase, type Experiment, type ForwardValidation, type ForwardSignalAlert } from "@/lib/supabase";
import { StatTile } from "@/components/StatTile";
import { PageGlow } from "@/components/PageGlow";
import { formatDateTime, formatPct, formatR } from "@/lib/format";
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT,
  STATUS_GOOD, STATUS_WARNING, TABLE_HEADER_BG, ACCENT, tint,
} from "@/lib/theme";

export const dynamic = "force-dynamic";

// Must match trading_lab/live.py's PROVEN_MIN_SCORE -- a pattern only enters forward
// tracking at all once its backtest robustness_score.total reaches this bar.
const PROVEN_MIN_SCORE = 100;

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
  const [{ data: expData, error: expError }, { data: fvData }, { data: alertData }] = await Promise.all([
    supabase
      .from("experiments")
      .select("id, created_at, symbol, interval, rule, robustness_score")
      .order("id", { ascending: false }),
    supabase.from("forward_validation").select("*"),
    supabase.from("forward_signal_alerts").select("*").order("sent_at", { ascending: false }).limit(20),
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

  const proven = experiments.filter((e) => (e.robustness_score?.total ?? 0) >= PROVEN_MIN_SCORE);
  const promotedCount = proven.filter((e) => forwardByExperiment.get(e.id)?.status === "promoted").length;
  const trackingCount = proven.length - promotedCount;

  const alerts = (alertData ?? []) as ForwardSignalAlert[];

  return (
    <div className="space-y-8">
      <div className="relative">
        <PageGlow />
        <h1 className="text-2xl font-semibold mb-1.5" style={{ color: TEXT_PRIMARY }}>
          Live Signals
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          A {PROVEN_MIN_SCORE}/100 robustness score only proves a pattern worked historically. These are the
          patterns that cleared that bar and are now being continuously re-checked against real market data
          as it arrives -- Telegram only fires once a pattern&apos;s forward/paper performance holds up too,
          not from backtest alone.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label={`Proven (score = ${PROVEN_MIN_SCORE})`} value={String(proven.length)} icon={ShieldCheck} />
        <StatTile
          label="Promoted (live alerts active)"
          value={String(promotedCount)}
          tone={promotedCount > 0 ? "good" : "neutral"}
          icon={Radio}
        />
        <StatTile label="Still forward-tracking" value={String(trackingCount)} icon={Activity} />
        <StatTile label="Alerts sent (recent)" value={String(alerts.length)} icon={Bell} />
      </div>

      {proven.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No pattern has reached a {PROVEN_MIN_SCORE}/100 robustness score yet -- that bar is intentionally
          strict. Once one does, it will appear here and forward tracking begins automatically.
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
              {proven.map((exp) => {
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
