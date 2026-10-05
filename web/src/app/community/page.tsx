import Link from "next/link";
import { ArrowUpRight, MessageSquare, ExternalLink } from "lucide-react";
import { supabase, type RedditStrategy, type Experiment } from "@/lib/supabase";
import { StatTile } from "@/components/StatTile";
import { getHeroImage } from "@/lib/pexels";
import { formatDateTime, formatNum } from "@/lib/format";
import {
  TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT,
  STATUS_GOOD, STATUS_WARNING, STATUS_CRITICAL, TABLE_HEADER_BG, ACCENT, tint,
} from "@/lib/theme";

export const dynamic = "force-dynamic";

type Status = RedditStrategy["extraction_status"];

function StatusBadge({ status }: { status: Status }) {
  const style = {
    testable: { color: STATUS_GOOD, icon: "✓", label: "Tested" },
    not_testable: { color: TEXT_MUTED, icon: "·", label: "Not testable" },
    pending: { color: STATUS_WARNING, icon: "·", label: "Pending" },
    error: { color: STATUS_CRITICAL, icon: "✕", label: "Error" },
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

export default async function CommunityPage() {
  const [headerImage, { data: strategyData, error }, { data: expData }] = await Promise.all([
    getHeroImage("online community discussion forum"),
    supabase.from("reddit_strategies").select("*").order("fetched_at", { ascending: false }).limit(100),
    supabase.from("experiments").select("id, symbol, interval, robustness_score, reddit_strategy_id").eq("origin", "reddit"),
  ]);

  if (error) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ border: `1px solid ${BORDER}`, color: TEXT_MUTED }}>
        Failed to load: {error.message}
      </div>
    );
  }

  const strategies = (strategyData ?? []) as RedditStrategy[];
  const experiments = (expData ?? []) as Pick<Experiment, "id" | "symbol" | "interval" | "robustness_score" | "reddit_strategy_id">[];
  const experimentsByStrategy = new Map<number, typeof experiments>();
  for (const exp of experiments) {
    if (exp.reddit_strategy_id == null) continue;
    const list = experimentsByStrategy.get(exp.reddit_strategy_id) ?? [];
    list.push(exp);
    experimentsByStrategy.set(exp.reddit_strategy_id, list);
  }

  const testable = strategies.filter((s) => s.extraction_status === "testable").length;
  const notTestable = strategies.filter((s) => s.extraction_status === "not_testable").length;

  return (
    <div className="space-y-8">
      <div
        className="relative overflow-hidden rounded-2xl px-6 py-10 sm:px-10 sm:py-14 shadow-sm animate-in fade-in duration-700"
        style={{ border: `1px solid ${BORDER}` }}
      >
        {headerImage && (
          <>
            <div
              aria-hidden
              className="absolute inset-0 -z-20 animate-ken-burns"
              style={{ backgroundImage: `url(${headerImage})`, backgroundSize: "cover", backgroundPosition: "center" }}
            />
            <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundColor: "color-mix(in srgb, var(--tl-page) 80%, transparent)" }} />
          </>
        )}
        <span
          className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide"
          style={{ backgroundColor: tint(ACCENT, 15), color: ACCENT }}
        >
          FROM REDDIT
        </span>
        <h1 className="text-2xl font-semibold mt-3 mb-1.5" style={{ color: TEXT_PRIMARY }}>
          Community
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          Highly-upvoted strategy posts from trading subreddits. An LLM attempts to translate each into
          this system&apos;s rule language — most won&apos;t fit yet (no MACD, Bollinger Bands, or
          moving-average crossovers exist here), and that&apos;s reported honestly rather than
          approximated. Anything translatable runs through the exact same validation suite as every
          other discovered pattern.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <StatTile label="Posts collected" value={String(strategies.length)} icon={MessageSquare} />
        <StatTile label="Testable" value={String(testable)} tone={testable > 0 ? "good" : "neutral"} icon={ArrowUpRight} />
        <StatTile label="Not testable (reported honestly)" value={String(notTestable)} icon={MessageSquare} />
      </div>

      {strategies.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No posts collected yet — the Reddit scan runs every 6 hours.
        </div>
      ) : (
        <div className="rounded-2xl shadow-sm divide-y" style={{ border: `1px solid ${BORDER}`, borderColor: BORDER }}>
          {strategies.map((s) => {
            const results = experimentsByStrategy.get(s.id) ?? [];
            return (
              <div key={s.id} className="px-4 py-4" style={{ borderColor: BORDER_SOFT }}>
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-sm font-medium transition-colors hover:text-[var(--tl-accent)]"
                      style={{ color: TEXT_PRIMARY }}
                    >
                      {s.title}
                      <ExternalLink size={12} style={{ color: TEXT_MUTED }} />
                    </a>
                    <div className="text-xs mt-1" style={{ color: TEXT_MUTED }}>
                      r/{s.subreddit} · {s.score} upvotes · {s.num_comments} comments · {formatDateTime(s.fetched_at)}
                    </div>
                  </div>
                  <StatusBadge status={s.extraction_status} />
                </div>

                {s.extraction_notes && (
                  <p className="text-xs mt-2" style={{ color: TEXT_SECONDARY }}>
                    {s.extraction_notes}
                  </p>
                )}

                {results.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {results.map((exp) => (
                      <Link
                        key={exp.id}
                        href={`/experiments/${exp.id}`}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors hover:text-[var(--tl-accent)]"
                        style={{ backgroundColor: tint(TEXT_MUTED, 8), color: TEXT_SECONDARY }}
                      >
                        {exp.symbol} {exp.interval} — robustness {formatNum(exp.robustness_score?.total, 1)}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
