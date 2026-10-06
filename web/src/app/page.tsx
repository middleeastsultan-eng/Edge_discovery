import Link from "next/link";
import { ArrowRight, FlaskConical, Radio, Wallet, ShieldCheck } from "lucide-react";
import { supabase, type Experiment, type ForwardValidation, type PaperAccount } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/fetchAll";
import { StatTile } from "@/components/StatTile";
import { getHeroImage } from "@/lib/pexels";
import { formatPct, formatUSD } from "@/lib/format";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, ACCENT, ACCENT_FOREGROUND, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

// Must match trading_lab/live.py's TRACKING_MIN_SCORE.
const TRACKING_MIN_SCORE = 80;
const STARTING_EQUITY = 10_000;

const CTAS = [
  { href: "/experiments", label: "Browse Experiments", icon: FlaskConical, primary: true },
  { href: "/live", label: "Live Signals", icon: Radio, primary: false },
  { href: "/research", label: "Research Health", icon: ShieldCheck, primary: false },
];

export default async function WelcomePage() {
  const [heroImage, experiments, forwardStatuses, { data: paperAccountData }] = await Promise.all([
    getHeroImage("stock market data screen"),
    // Full table, not a capped page -- "Total experiments" must reflect the real count,
    // not however many fit under PostgREST's 1000-row default (see fetchAll.ts).
    fetchAllRows<Pick<Experiment, "id" | "robustness_score">>((from, to) =>
      supabase.from("experiments").select("id, robustness_score").order("id", { ascending: true }).range(from, to),
    ),
    fetchAllRows<Pick<ForwardValidation, "status">>((from, to) =>
      supabase.from("forward_validation").select("experiment_id, status").order("experiment_id", { ascending: true }).range(from, to),
    ),
    supabase.from("paper_account").select("equity").eq("id", 1).single(),
  ]);

  const tracked = experiments.filter((e) => (e.robustness_score?.total ?? 0) >= TRACKING_MIN_SCORE);
  const promotedCount = forwardStatuses.filter((fv) => fv.status === "promoted").length;
  const paperAccount = (paperAccountData ?? { equity: STARTING_EQUITY }) as Pick<PaperAccount, "equity">;
  const paperReturnPct = paperAccount.equity / STARTING_EQUITY - 1;

  return (
    <div className="space-y-10">
      <div
        className="relative overflow-hidden rounded-3xl px-6 py-16 sm:px-12 sm:py-24 shadow-sm"
        style={{ border: `1px solid ${BORDER}` }}
      >
        <div
          aria-hidden
          className={heroImage ? "absolute inset-0 -z-20 animate-ken-burns" : "absolute inset-0 -z-20"}
          style={
            heroImage
              ? { backgroundImage: `url(${heroImage})`, backgroundSize: "cover", backgroundPosition: "center" }
              : { background: `radial-gradient(ellipse at top left, ${tint(ACCENT, 25)}, transparent 60%)`, backgroundColor: "var(--tl-page)" }
          }
        />
        <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: "color-mix(in srgb, var(--tl-page) 78%, transparent)" }} />

        <div className="relative max-w-2xl animate-in fade-in slide-in-from-bottom-4 duration-700">
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide"
            style={{ backgroundColor: ACCENT, color: ACCENT_FOREGROUND }}
          >
            EDGE DISCOVERY
          </span>
          <h1 className="mt-4 text-3xl sm:text-4xl font-semibold leading-tight" style={{ color: TEXT_PRIMARY }}>
            Find real trading edges — and prove it before risking a cent.
          </h1>
          <p className="mt-4 text-base" style={{ color: TEXT_SECONDARY }}>
            A backtest score only proves a pattern worked historically. This platform discovers candidate
            patterns, validates them against data they&apos;ve never seen, then continuously re-checks the
            survivors against live market data — trust is earned by real performance, not inherited from
            the backtest.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            {CTAS.map(({ href, label, icon: Icon, primary }) => (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all hover:-translate-y-0.5 hover:shadow-md"
                style={
                  primary
                    ? { backgroundColor: ACCENT, color: ACCENT_FOREGROUND }
                    : { backgroundColor: SURFACE, color: TEXT_PRIMARY, border: `1px solid ${BORDER}` }
                }
              >
                <Icon size={15} />
                {label}
                <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 animate-in fade-in slide-in-from-bottom-2 duration-700 delay-150 fill-mode-both">
        <StatTile label="Total experiments" value={String(experiments.length)} icon={FlaskConical} />
        <StatTile label={`Tracked (score ≥ ${TRACKING_MIN_SCORE})`} value={String(tracked.length)} icon={ShieldCheck} />
        <StatTile
          label="Promoted (live-proven)"
          value={String(promotedCount)}
          tone={promotedCount > 0 ? "good" : "neutral"}
          icon={Radio}
        />
        <StatTile
          label="Paper portfolio return"
          value={formatPct(paperReturnPct)}
          tone={paperReturnPct > 0 ? "good" : paperReturnPct < 0 ? "bad" : "neutral"}
          icon={Wallet}
        />
      </div>

      <p className="text-xs text-center" style={{ color: TEXT_MUTED }}>
        Paper account: {formatUSD(paperAccount.equity)} notional, started at {formatUSD(STARTING_EQUITY)}.
      </p>
    </div>
  );
}
