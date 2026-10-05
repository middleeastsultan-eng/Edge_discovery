// Aggregation logic for the Research Health dashboard. Pure functions over the raw
// research_runs + experiments rows, computed in-memory in the server component.
// Fine at current data volumes (hundreds of rows); move to SQL views/RPCs once the
// ledger grows into the tens of thousands of rows and this becomes a bottleneck.

import type { ResearchRun, Experiment } from "./supabase";

const PASS_THRESHOLD = 55;

function isFinalTestPass(e: Experiment): boolean {
  return (e.robustness_score?.total ?? 0) >= PASS_THRESHOLD;
}

function sumBy<T>(arr: T[], fn: (x: T) => number): number {
  return arr.reduce((acc, x) => acc + fn(x), 0);
}

export type FunnelTotals = {
  hypothesesTested: number;
  level1Survivors: number;
  discoverySurvivors: number;
  validationSurvivors: number;
  robustFinalists: number;
  finalTestPasses: number;
};

export function computeFunnelTotals(runs: ResearchRun[], experiments: Experiment[]): FunnelTotals {
  return {
    hypothesesTested: sumBy(runs, (r) => r.hypotheses_tested),
    level1Survivors: sumBy(runs, (r) => r.level1_survivors),
    discoverySurvivors: sumBy(runs, (r) => r.discovery_survivors),
    validationSurvivors: sumBy(runs, (r) => r.validation_survivors),
    robustFinalists: sumBy(runs, (r) => r.finalists_count),
    finalTestPasses: experiments.filter(isFinalTestPass).length,
  };
}

export type FunnelStage = { label: string; count: number; pctOfPrevious: number | null };

export function funnelStages(t: FunnelTotals): FunnelStage[] {
  const raw = [
    { label: "Hypotheses tested", count: t.hypothesesTested },
    { label: "Level-1 signals", count: t.level1Survivors },
    { label: "Discovery survivors", count: t.discoverySurvivors },
    { label: "Validation survivors", count: t.validationSurvivors },
    { label: "Robust finalists", count: t.robustFinalists },
    { label: "Final-test passes", count: t.finalTestPasses },
  ];
  return raw.map((s, i) => ({
    ...s,
    pctOfPrevious: i === 0 ? null : raw[i - 1].count > 0 ? s.count / raw[i - 1].count : 0,
  }));
}

export type CumulativePoint = { date: string; hypotheses: number; level1: number; validation: number; finalTest: number };

export function cumulativeSeries(runs: ResearchRun[], experiments: Experiment[]): CumulativePoint[] {
  type Event = { date: string; hyp: number; l1: number; val: number; ft: number };
  const events: Event[] = [];

  for (const r of runs) {
    events.push({ date: r.created_at, hyp: r.hypotheses_tested, l1: r.level1_survivors, val: r.validation_survivors, ft: 0 });
  }
  for (const e of experiments) {
    if (isFinalTestPass(e)) {
      events.push({ date: e.created_at, hyp: 0, l1: 0, val: 0, ft: 1 });
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date));

  let hyp = 0, l1 = 0, val = 0, ft = 0;
  return events.map((ev) => {
    hyp += ev.hyp;
    l1 += ev.l1;
    val += ev.val;
    ft += ev.ft;
    return { date: ev.date, hypotheses: hyp, level1: l1, validation: val, finalTest: ft };
  });
}

export type WeeklySurvival = {
  weekStart: string;
  hypotheses: number;
  level1Pct: number;
  validationPct: number;
  robustPct: number;
  finalTestPct: number;
};

function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

export function weeklySurvivalRates(runs: ResearchRun[], experiments: Experiment[]): WeeklySurvival[] {
  const byWeek = new Map<string, { hyp: number; l1: number; disc: number; val: number; robust: number }>();

  for (const r of runs) {
    const week = startOfWeek(r.created_at);
    const cur = byWeek.get(week) ?? { hyp: 0, l1: 0, disc: 0, val: 0, robust: 0 };
    cur.hyp += r.hypotheses_tested;
    cur.l1 += r.level1_survivors;
    cur.disc += r.discovery_survivors;
    cur.val += r.validation_survivors;
    cur.robust += r.finalists_count;
    byWeek.set(week, cur);
  }

  const passesByWeek = new Map<string, number>();
  for (const e of experiments) {
    if (isFinalTestPass(e)) {
      const week = startOfWeek(e.created_at);
      passesByWeek.set(week, (passesByWeek.get(week) ?? 0) + 1);
    }
  }

  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, v]) => ({
      weekStart: week,
      hypotheses: v.hyp,
      level1Pct: v.hyp > 0 ? v.l1 / v.hyp : 0,
      validationPct: v.disc > 0 ? v.val / v.disc : 0,
      robustPct: v.val > 0 ? v.robust / v.val : 0,
      finalTestPct: v.robust > 0 ? (passesByWeek.get(week) ?? 0) / v.robust : 0,
    }));
}

export type AssetRow = {
  symbol: string;
  interval: string;
  hypotheses: number;
  level1: number;
  validation: number;
  robust: number;
  finalTest: number;
};

export function perAssetMatrix(runs: ResearchRun[], experiments: Experiment[]): AssetRow[] {
  const byKey = new Map<string, AssetRow>();

  for (const r of runs) {
    const key = `${r.symbol}|${r.interval}`;
    const cur = byKey.get(key) ?? { symbol: r.symbol, interval: r.interval, hypotheses: 0, level1: 0, validation: 0, robust: 0, finalTest: 0 };
    cur.hypotheses += r.hypotheses_tested;
    cur.level1 += r.level1_survivors;
    cur.validation += r.validation_survivors;
    cur.robust += r.finalists_count;
    byKey.set(key, cur);
  }

  for (const e of experiments) {
    if (isFinalTestPass(e)) {
      const key = `${e.symbol}|${e.interval}`;
      const cur = byKey.get(key);
      if (cur) cur.finalTest += 1;
    }
  }

  return Array.from(byKey.values()).sort((a, b) => b.hypotheses - a.hypotheses);
}
