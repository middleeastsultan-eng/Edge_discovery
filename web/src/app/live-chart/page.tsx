import { Activity, Zap } from "lucide-react";
import { supabase, type StructureDivergenceAlert } from "@/lib/supabase";
import { PatternChart } from "@/components/PatternChart";
import { BannerBackground } from "@/components/BannerBackground";
import { formatDateTime } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, STATUS_GOOD, STATUS_CRITICAL, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

// How fresh a divergence alert has to be to still show as a "just happened" banner,
// rather than just sitting in history -- this page refreshes its own chart every 60s,
// so anything within the last couple of checks is still "live."
const RECENT_ALERT_MINUTES = 30;

export default async function LiveChartPage() {
  const { data: alertData } = await supabase
    .from("structure_divergence_alerts")
    .select("*")
    .order("bar_time", { ascending: false })
    .limit(5);
  const alerts = (alertData ?? []) as StructureDivergenceAlert[];
  const latest = alerts[0];
  const latestIsRecent =
    latest && Date.now() - new Date(latest.sent_at).getTime() < RECENT_ALERT_MINUTES * 60 * 1000;

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
            Live Chart
          </h1>
        </div>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          QQQ (Nasdaq 100) and SPY (S&amp;P 500) real candles, overlapping, updating on their own --
          not tied to any one experiment. Hover either symbol&apos;s name or candles to bring it forward;
          the shaded bands mark a structure divergence between the two.
        </p>
      </div>

      {latestIsRecent && (() => {
        const accent = latest.direction === "bullish" ? STATUS_GOOD : STATUS_CRITICAL;
        return (
          <div
            className="flex items-start gap-3 rounded-2xl px-4 py-3.5 shadow-sm animate-in fade-in duration-500"
            style={{ backgroundColor: tint(accent, 10), border: `1px solid ${tint(accent, 25)}` }}
          >
            <Zap size={18} style={{ color: accent }} className="shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium" style={{ color: TEXT_PRIMARY }}>
                {latest.leader} just broke structure ({latest.direction}) -- {latest.follower} hasn&apos;t confirmed
              </p>
              <p className="text-xs mt-0.5" style={{ color: TEXT_MUTED }}>
                Bar {formatDateTime(latest.bar_time)} -- detected {formatDateTime(latest.sent_at)}. A pro trader&apos;s
                read is this tends to precede a strong directional run -- not yet a tested, scored pattern, just a live heads-up.
              </p>
            </div>
          </div>
        );
      })()}

      <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
        <PatternChart
          candles={[]}
          trades={[]}
          symbol="QQQ"
          source="stocks"
          otherIndexSymbol="SPY"
          interval="5Min"
          clauses={[]}
          liveMode
          liveRefreshSeconds={60}
        />
      </div>

      {alerts.length > 0 && (
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
            <Activity size={15} />
            Recent structure divergence detections
          </h2>
          <div className="rounded-2xl shadow-sm divide-y" style={{ border: `1px solid ${BORDER}` }}>
            {alerts.map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-center justify-between gap-4">
                <div className="text-sm" style={{ color: TEXT_PRIMARY, fontFamily: "var(--font-geist-mono)" }}>
                  {a.leader} broke structure ({a.direction}), {a.follower} didn&apos;t confirm
                </div>
                <div className="text-xs shrink-0" style={{ color: TEXT_MUTED }}>
                  {formatDateTime(a.bar_time)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
