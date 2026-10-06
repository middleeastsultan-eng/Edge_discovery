// Ports the subset of trading_lab/features.py needed to evaluate a Candidate's signal
// (and its ATR, for trade-level price lines) in the browser's/server's chart data --
// a pure, self-contained computation so the chart can show "when was this rule's raw
// condition true," not just where trades were actually taken.
//
// Mirrors features.py's exact formulas (Wilder/EWM smoothing, adjust=False) so the
// signal computed here matches what the Python backtest/live pipeline would compute
// on the same candles. Only discovery.FEATURES' 7 features are ported, plus atr_14
// (used for stop/target price lines, not a rule feature itself) -- "dow" exists in
// features.py but no rule ever references it, so it's skipped.

import type { Candle } from "./candles";
import type { ClauseJson } from "./supabase";
import { computeDivergenceFeatureSeries } from "./structure";

export type FeatureRow = {
  time: number;
  price_vs_ema200?: number;
  rsi_14?: number;
  volatility_pctile?: number;
  volume_ratio_20?: number;
  return_5?: number;
  return_20?: number;
  hour?: number;
  atr_14?: number;
  bos_divergence_bullish?: number;
  bos_divergence_bearish?: number;
};

// EWM with adjust=False: out[i] = alpha*x[i] + (1-alpha)*out[i-1], out[0] = x[0].
function ewm(values: number[], alpha: number): number[] {
  const out: number[] = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = alpha * values[i] + (1 - alpha) * out[i - 1];
  }
  return out;
}

function ema(values: number[], span: number): number[] {
  return ewm(values, 2 / (span + 1));
}

function rsi14(closes: number[]): number[] {
  const alpha = 1 / 14;
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const delta = closes[i] - closes[i - 1];
    gains.push(Math.max(delta, 0));
    losses.push(Math.max(-delta, 0));
  }
  const avgGain = ewm(gains, alpha);
  const avgLoss = ewm(losses, alpha);
  return avgGain.map((g, i) => {
    const l = avgLoss[i];
    if (l === 0) return g === 0 ? 50 : 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  });
}

function atr14(candles: Candle[]): number[] {
  const alpha = 1 / 14;
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose));
  });
  return ewm(tr, alpha);
}

// Sample std (ddof=1, matching pandas' default) over a trailing window. Matches
// pandas' rolling().std() behavior of requiring the full window to be NaN-free
// (min_periods defaults to window size) -- a single NaN in the window (e.g. the
// first return, which has no prior close) yields undefined, not a numeric NaN.
function rollingStd(values: number[], window: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = window - 1; i < values.length; i++) {
    const slice = values.slice(i - window + 1, i + 1);
    if (slice.some((v) => Number.isNaN(v))) continue;
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (slice.length - 1);
    out[i] = Math.sqrt(variance);
  }
  return out;
}

// Direct port of pandas' `.rolling(window, min_periods=minPeriods).rank(pct=True)`:
// for each index, the fraction of the trailing (up to `window`, at least `minPeriods`)
// values that are <= the current value.
function rollingPercentileRank(
  values: (number | undefined)[], window: number, minPeriods: number,
): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = 0; i < values.length; i++) {
    if (values[i] === undefined) continue;
    const start = Math.max(0, i - window + 1);
    const windowVals = values.slice(start, i + 1).filter((v): v is number => v !== undefined);
    if (windowVals.length < minPeriods) continue;
    const current = values[i]!;
    const countLe = windowVals.filter((v) => v <= current).length;
    out[i] = countLe / windowVals.length;
  }
  return out;
}

function volumeRatio20(volumes: number[]): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(volumes.length).fill(undefined);
  for (let i = 19; i < volumes.length; i++) {
    const slice = volumes.slice(i - 19, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    out[i] = mean === 0 ? undefined : volumes[i] / mean;
  }
  return out;
}

function returnN(closes: number[], n: number): (number | undefined)[] {
  const out: (number | undefined)[] = new Array(closes.length).fill(undefined);
  for (let i = n; i < closes.length; i++) {
    out[i] = (closes[i] - closes[i - n]) / closes[i - n];
  }
  return out;
}

const nyHourFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York", hour: "numeric", hourCycle: "h23",
});

function nyHour(timeSeconds: number): number {
  return Number(nyHourFormatter.format(new Date(timeSeconds * 1000)));
}

/** Per-candle feature values needed to evaluate a rule's clauses, mirroring
 * trading_lab/features.py's build_features(). Early bars (inside the warmup window
 * for whichever feature needs the longest lookback) have that field left undefined,
 * matching the Python side's `.dropna()`.
 */
export function computeFeatureSeries(candles: Candle[], otherCandles?: Candle[]): FeatureRow[] {
  if (candles.length === 0) return [];

  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);

  const ema200 = ema(closes, 200);
  const rsi = rsi14(closes);
  const atr = atr14(candles);

  // volatility_20 = rolling std of simple returns; returns[0] is NaN (no prior bar).
  const returns = closes.map((c, i) => (i === 0 ? NaN : (c - closes[i - 1]) / closes[i - 1]));
  const vol20 = rollingStd(returns, 20);
  const volPctile = rollingPercentileRank(vol20, 500, 50);

  const volRatio = volumeRatio20(volumes);
  const ret5 = returnN(closes, 5);
  const ret20 = returnN(closes, 20);

  // Cross-asset structure divergence (QQQ<->SPY) -- backward-looking only, mirroring
  // trading_lab/cross_asset.py exactly so a rule using these lights up the chart's
  // gold signal strip at the same bars the real tradeable feature would be true.
  const divergence = otherCandles && otherCandles.length > 0
    ? computeDivergenceFeatureSeries(candles, otherCandles)
    : null;

  return candles.map((c, i) => ({
    time: c.time,
    price_vs_ema200: (c.close - ema200[i]) / ema200[i],
    rsi_14: rsi[i],
    volatility_pctile: volPctile[i],
    volume_ratio_20: volRatio[i],
    return_5: ret5[i],
    return_20: ret20[i],
    hour: nyHour(c.time),
    atr_14: atr[i],
    bos_divergence_bullish: divergence ? (divergence.bullish[i] ? 1 : 0) : 0,
    bos_divergence_bearish: divergence ? (divergence.bearish[i] ? 1 : 0) : 0,
  }));
}

/** Boolean per bar: whether every clause in the (frozen) rule held true, mirroring
 * trading_lab/discovery.py's Clause.apply/Candidate.signal. False (not just unknown)
 * wherever a referenced feature hasn't warmed up yet.
 */
export function evaluateSignal(features: FeatureRow[], clauses: ClauseJson[]): boolean[] {
  return features.map((row) =>
    clauses.every((clause) => {
      const value = row[clause.feature as keyof FeatureRow];
      if (value === undefined) return false;
      return clause.op === ">" ? value > clause.value : value < clause.value;
    }),
  );
}
