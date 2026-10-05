import { CheckCircle2 } from "lucide-react";
import { supabase, type ResearchRun, type Experiment, type AgentSettings } from "@/lib/supabase";
import {
  computeFunnelTotals,
  funnelStages,
  cumulativeSeries,
  weeklySurvivalRates,
  perAssetMatrix,
} from "@/lib/researchHealth";
import { CumulativeTrends } from "@/components/CumulativeTrends";
import { ComputeControl } from "@/components/ComputeControl";
import { FunnelChart } from "@/components/FunnelChart";
import { SurvivalTrend } from "@/components/SurvivalTrend";
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT, STATUS_GOOD, STATUS_CRITICAL, TABLE_HEADER_BG, CHART_BLUE, CHART_TEAL, tint } from "@/lib/theme";

export const dynamic = "force-dynamic";

const cardStyle = { backgroundColor: SURFACE, border: `1px solid ${BORDER}` };

export default async function ResearchHealth() {
  const [{ data: runsData, error: runsError }, { data: expData, error: expError }, { data: settingsData }] = await Promise.all([
    supabase.from("research_runs").select("*").order("created_at", { ascending: true }).limit(5000),
    supabase.from("experiments").select("*").order("created_at", { ascending: true }).limit(5000),
    supabase.from("local_agent_settings").select("max_workers, paused").eq("id", 1).single(),
  ]);

  if (runsError || expError) {
    return (
      <div className="rounded-lg px-4 py-3 text-sm" style={{ color: STATUS_CRITICAL }}>
        Failed to load research health data: {runsError?.message ?? expError?.message}
      </div>
    );
  }

  const runs = (runsData ?? []) as ResearchRun[];
  const experiments = (expData ?? []) as Experiment[];
  const agentSettings = (settingsData ?? { max_workers: 3, paused: false }) as AgentSettings;

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

      <ComputeControl settings={agentSettings} />

      {/* 1. Funnel totals */}
      <section className="rounded-xl p-4 shadow-sm" style={cardStyle}>
        <h2 className="text-sm font-medium mb-3" style={{ color: TEXT_SECONDARY }}>
          Funnel totals
        </h2>
        <FunnelChart stages={stages} />
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
        <SurvivalTrend data={weekly} />
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
                <tr className="border-b text-left text-xs" style={{ borderColor: BORDER, backgroundColor: TABLE_HEADER_BG, color: TEXT_MUTED }}>
                  <th className="px-4 py-3 font-medium">Market</th>
                  <th className="px-4 py-3 font-medium">TF</th>
                  <th className="px-4 py-3 font-medium">Funnel (hypotheses → validation)</th>
                  <th className="px-4 py-3 font-medium text-right">Hypotheses</th>
                  <th className="px-4 py-3 font-medium text-right">Level 1</th>
                  <th className="px-4 py-3 font-medium text-right">Validation</th>
                  <th className="px-4 py-3 font-medium text-right">Robust</th>
                  <th className="px-4 py-3 font-medium text-right">Final</th>
                </tr>
              </thead>
              <tbody>
                {assetMatrix.map((a) => {
                  const maxHyp = Math.max(...assetMatrix.map((x) => x.hypotheses), 1);
                  return (
                    <tr key={`${a.symbol}-${a.interval}`} className="border-b last:border-0" style={{ borderColor: BORDER_SOFT }}>
                      <td className="px-4 py-3 font-medium" style={{ color: TEXT_PRIMARY }}>{a.symbol}</td>
                      <td className="px-4 py-3" style={{ color: TEXT_MUTED }}>{a.interval}</td>
                      <td className="px-4 py-3">
                        <div className="relative h-2 w-28 rounded-full overflow-hidden" style={{ backgroundColor: tint(TEXT_MUTED, 12) }}>
                          <div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${(a.hypotheses / maxHyp) * 100}%`, backgroundColor: tint(CHART_BLUE, 40) }}
                          />
                          <div
                            className="absolute inset-y-0 left-0 rounded-full"
                            style={{ width: `${(a.validation / maxHyp) * 100}%`, backgroundColor: CHART_TEAL }}
                          />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.hypotheses.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.level1 === null ? "—" : a.level1.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.validation.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: TEXT_SECONDARY }}>{a.robust.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium" style={{ color: a.finalTest > 0 ? STATUS_GOOD : TEXT_MUTED }}>
                        {a.finalTest.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
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
