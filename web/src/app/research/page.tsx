import { CheckCircle2 } from "lucide-react";
import { supabase, type ResearchRun, type Experiment } from "@/lib/supabase";
import {
  computeFunnelTotals,
  funnelStages,
  cumulativeSeries,
  weeklySurvivalRates,
  perAssetMatrix,
} from "@/lib/researchHealth";
import { CumulativeTrends } from "@/components/CumulativeTrends";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, STATUS_GOOD } from "@/lib/theme";

export const dynamic = "force-dynamic";

const cardStyle = { backgroundColor: SURFACE, border: `1px solid ${BORDER}` };

function formatPct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}

export default async function ResearchHealth() {
  const [{ data: runsData, error: runsError }, { data: expData, error: expError }] = await Promise.all([
    supabase.from("research_runs").select("*").order("created_at", { ascending: true }).limit(5000),
    supabase.from("experiments").select("*").order("created_at", { ascending: true }).limit(5000),
  ]);

  if (runsError || expError) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ color: "#d03b3b" }}>
        Failed to load research health data: {runsError?.message ?? expError?.message}
      </div>
    );
  }

  const runs = (runsData ?? []) as ResearchRun[];
  const experiments = (expData ?? []) as Experiment[];

  const totals = computeFunnelTotals(runs, experiments);
  const stages = funnelStages(totals);
  const cumulative = cumulativeSeries(runs, experiments);
  const weekly = weeklySurvivalRates(runs, experiments);
  const assetMatrix = perAssetMatrix(runs, experiments);

  const conversionX = totals.finalTestPasses > 0 ? Math.round(totals.hypothesesTested / totals.finalTestPasses) : null;

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold mb-1.5" style={{ color: TEXT_PRIMARY }}>
          Research Health
        </h1>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          A record of the search process itself, not just the strategies it produces — whether the
          system is finding edges or manufacturing false positives is a question about this page,
          not about any single experiment.
        </p>
      </div>

      {/* 1. Funnel totals */}
      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Funnel totals
        </h2>
        <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs" style={{ borderColor: BORDER, backgroundColor: "rgba(11,11,11,0.02)", color: TEXT_MUTED }}>
                <th className="px-4 py-3 font-medium">Stage</th>
                <th className="px-4 py-3 font-medium text-right">Count</th>
                <th className="px-4 py-3 font-medium text-right">% of previous stage</th>
              </tr>
            </thead>
            <tbody>
              {stages.map((s) => (
                <tr key={s.label} className="border-b last:border-0" style={{ borderColor: "rgba(11,11,11,0.06)" }}>
                  <td className="px-4 py-3" style={{ color: TEXT_SECONDARY }}>
                    {s.label}
                    {s.note && (
                      <span className="ml-1.5 text-[11px]" style={{ color: TEXT_MUTED, opacity: 0.8 }}>
                        ({s.note})
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: TEXT_PRIMARY }}>
                    {s.count.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_MUTED }}>
                    {s.pctOfPrevious === null ? "—" : formatPct(s.pctOfPrevious)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {conversionX && (
          <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
            Observed conversion rate: <span style={{ color: TEXT_SECONDARY }}>1 final-test pass per {conversionX.toLocaleString()} hypotheses tested.</span>{" "}
            This is a description of the pipeline&apos;s current output, not an estimate of the probability any given hypothesis is a real edge.
          </p>
        )}
      </section>

      {/* 2. Cumulative curves */}
      <section>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Cumulative progress
        </h2>
        <CumulativeTrends data={cumulative} />
      </section>

      {/* 3. Survival rates over time */}
      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Survival rates by week
        </h2>
        {weekly.length === 0 ? (
          <div className="text-sm" style={{ color: TEXT_MUTED }}>No research runs yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs" style={{ borderColor: BORDER, backgroundColor: "rgba(11,11,11,0.02)", color: TEXT_MUTED }}>
                  <th className="px-4 py-3 font-medium">Week of</th>
                  <th className="px-4 py-3 font-medium text-right">Hypotheses</th>
                  <th className="px-4 py-3 font-medium text-right">Level 1</th>
                  <th className="px-4 py-3 font-medium text-right">Validation</th>
                  <th className="px-4 py-3 font-medium text-right">Robustness</th>
                  <th className="px-4 py-3 font-medium text-right">Final test</th>
                </tr>
              </thead>
              <tbody>
                {weekly.map((w) => (
                  <tr key={w.weekStart} className="border-b last:border-0" style={{ borderColor: "rgba(11,11,11,0.06)" }}>
                    <td className="px-4 py-3 whitespace-nowrap" style={{ color: TEXT_SECONDARY }}>{w.weekStart}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{w.hypotheses.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{w.level1Pct === null ? "—" : formatPct(w.level1Pct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{formatPct(w.validationPct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{formatPct(w.robustPct)}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{formatPct(w.finalTestPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
          A sudden drop can mean feature-space exhaustion, a data/code bug, overly aggressive filtering,
          or a genuine regime change — this table flags that something changed, not what changed.
        </p>
      </section>

      {/* 5. Per-asset/timeframe matrix */}
      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Research streams by market
        </h2>
        {assetMatrix.length === 0 ? (
          <div className="text-sm" style={{ color: TEXT_MUTED }}>No research runs yet.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg" style={{ border: `1px solid ${BORDER}` }}>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs" style={{ borderColor: BORDER, backgroundColor: "rgba(11,11,11,0.02)", color: TEXT_MUTED }}>
                  <th className="px-4 py-3 font-medium">Market</th>
                  <th className="px-4 py-3 font-medium">TF</th>
                  <th className="px-4 py-3 font-medium text-right">Hypotheses</th>
                  <th className="px-4 py-3 font-medium text-right">Level 1</th>
                  <th className="px-4 py-3 font-medium text-right">Validation</th>
                  <th className="px-4 py-3 font-medium text-right">Robust</th>
                  <th className="px-4 py-3 font-medium text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                {assetMatrix.map((a) => (
                  <tr key={`${a.symbol}-${a.interval}`} className="border-b last:border-0" style={{ borderColor: "rgba(11,11,11,0.06)" }}>
                    <td className="px-4 py-3 font-medium" style={{ color: TEXT_PRIMARY }}>{a.symbol}</td>
                    <td className="px-4 py-3" style={{ color: TEXT_MUTED }}>{a.interval}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.hypotheses.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.level1 === null ? "—" : a.level1.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.validation.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.robust.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: a.finalTest > 0 ? STATUS_GOOD : TEXT_MUTED }}>
                      {a.finalTest.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs mt-3" style={{ color: TEXT_MUTED }}>
          Reveals whether results are broad-based or concentrated in one market/timeframe — concentration
          in a single stream is itself a reason for caution, not celebration.
        </p>
      </section>

      {/* 6. Research integrity panel */}
      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Research integrity
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-4 mb-4">
          {[
            "FDR correction (Benjamini-Hochberg)",
            "Economic-significance gating (cost-aware, not a fixed threshold)",
            "Chronological train/validation/test split",
            "Final test set locked until candidate frozen",
            "No look-ahead in features (NY-time aware)",
            "Profit concentration check",
            "Minimum trade count enforced",
            "NULL ≠ zero in the ledger (missing metrics never silently become 0)",
          ].map((item) => (
            <div key={item} className="flex items-center gap-1.5 text-xs" style={{ color: TEXT_SECONDARY }}>
              <CheckCircle2 size={13} style={{ color: STATUS_GOOD }} className="shrink-0" />
              {item}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <div style={{ color: TEXT_MUTED }}>Hypotheses tested</div>
            <div className="font-medium tabular-nums mt-0.5" style={{ color: TEXT_PRIMARY }}>{totals.hypothesesTested.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: TEXT_MUTED }}>Research runs</div>
            <div className="font-medium tabular-nums mt-0.5" style={{ color: TEXT_PRIMARY }}>{runs.length.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: TEXT_MUTED }}>Experiments saved</div>
            <div className="font-medium tabular-nums mt-0.5" style={{ color: TEXT_PRIMARY }}>{experiments.length.toLocaleString()}</div>
          </div>
          <div>
            <div style={{ color: TEXT_MUTED }}>Markets covered</div>
            <div className="font-medium tabular-nums mt-0.5" style={{ color: TEXT_PRIMARY }}>{new Set(runs.map((r) => r.symbol)).size}</div>
          </div>
        </div>
      </section>
    </div>
  );
}
