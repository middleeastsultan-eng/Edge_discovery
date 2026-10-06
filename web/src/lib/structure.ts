// Break-of-structure (BOS) detection and cross-index divergence -- the specific pattern
// a pro trader flagged: when one index (QQQ/Nasdaq-100 or SPY/S&P 500) breaks past a
// recent swing point and the other does NOT confirm the same break around the same
// time, that divergence has reportedly preceded a strong directional "run." This is a
// visual/tracking tool for that observation, not yet wired into the discovery/backtest
// pipeline (which only ever looks at one symbol's own data today) -- that would be a
// separate, bigger step if it turns out to be worth testing formally.

import type { Candle } from "./candles";

export type SwingPoint = { time: number; price: number; kind: "high" | "low" };
export type BosEvent = { time: number; direction: "bullish" | "bearish" };
export type DivergenceEvent = {
  time: number;
  direction: "bullish" | "bearish";
  leader: "QQQ" | "SPY"; // which index broke structure
  follower: "QQQ" | "SPY"; // which index did NOT confirm
};

/** A bar is a confirmed swing high/low if its high/low is the most extreme within
 * `lookback` bars on both sides -- the standard fractal-pivot definition. Confirmation
 * is only known `lookback` bars later (can't know a pivot held until the bars after it
 * exist), which the caller must respect -- this returns pivots at the bar they occurred,
 * not the bar they became knowable.
 */
export function findSwingPoints(candles: Candle[], lookback: number = 5): SwingPoint[] {
  const points: SwingPoint[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isHigh = window.every((c) => c.high <= candles[i].high);
    const isLow = window.every((c) => c.low >= candles[i].low);
    if (isHigh) points.push({ time: candles[i].time, price: candles[i].high, kind: "high" });
    if (isLow) points.push({ time: candles[i].time, price: candles[i].low, kind: "low" });
  }
  return points;
}

/** Walks forward tracking the most recent confirmed swing high/low; a close beyond
 * that level is a break of structure. After a break, the reference point resets to the
 * new extreme, so a sustained move doesn't fire a BOS on every single subsequent bar.
 */
export function detectBreaksOfStructure(candles: Candle[], lookback: number = 5): BosEvent[] {
  const swings = findSwingPoints(candles, lookback);
  const swingByTime = new Map(swings.map((s) => [s.time, s]));

  const events: BosEvent[] = [];
  let refHigh: number | null = null;
  let refLow: number | null = null;
  // Once a break fires, suppress further same-direction breaks until a genuinely NEW
  // pivot confirms and becomes the reference -- without this, a close that keeps
  // climbing above an already-broken level re-fires on nearly every bar of a sustained
  // trend (confirmed directly: 39 "breaks" for what should be one breakout event).
  let brokeHighSinceLastPivot = false;
  let brokeLowSinceLastPivot = false;

  for (let i = lookback; i < candles.length; i++) {
    // A pivot at bar j only becomes known once `lookback` bars after it have closed --
    // only consider pivots at or before (i - lookback) as "confirmed" by bar i.
    const confirmable = candles[i - lookback];
    const pivot = swingByTime.get(confirmable.time);
    if (pivot?.kind === "high" && (refHigh === null || pivot.price > refHigh)) {
      refHigh = pivot.price;
      brokeHighSinceLastPivot = false;
    }
    if (pivot?.kind === "low" && (refLow === null || pivot.price < refLow)) {
      refLow = pivot.price;
      brokeLowSinceLastPivot = false;
    }

    const close = candles[i].close;
    if (refHigh !== null && close > refHigh && !brokeHighSinceLastPivot) {
      events.push({ time: candles[i].time, direction: "bullish" });
      brokeHighSinceLastPivot = true;
    }
    if (refLow !== null && close < refLow && !brokeLowSinceLastPivot) {
      events.push({ time: candles[i].time, direction: "bearish" });
      brokeLowSinceLastPivot = true;
    }
  }
  return events;
}

/** Pairs up QQQ's and SPY's BOS events: a QQQ (or SPY) break with no same-direction
 * break from the other index within `toleranceBars` bars is a divergence -- one index
 * moved enough to break structure, the other didn't confirm it.
 */
export function detectDivergences(
  qqqCandles: Candle[], spyCandles: Candle[], lookback: number = 5, toleranceBars: number = 3,
): DivergenceEvent[] {
  if (qqqCandles.length === 0 || spyCandles.length === 0) return [];

  const qqqBos = detectBreaksOfStructure(qqqCandles, lookback);
  const spyBos = detectBreaksOfStructure(spyCandles, lookback);

  const barSeconds = qqqCandles.length > 1 ? qqqCandles[1].time - qqqCandles[0].time : 60;
  const toleranceSeconds = toleranceBars * barSeconds;

  const hasConfirmation = (events: BosEvent[], time: number, direction: "bullish" | "bearish") =>
    events.some((e) => e.direction === direction && Math.abs(e.time - time) <= toleranceSeconds);

  const divergences: DivergenceEvent[] = [];
  for (const e of qqqBos) {
    if (!hasConfirmation(spyBos, e.time, e.direction)) {
      divergences.push({ time: e.time, direction: e.direction, leader: "QQQ", follower: "SPY" });
    }
  }
  for (const e of spyBos) {
    if (!hasConfirmation(qqqBos, e.time, e.direction)) {
      divergences.push({ time: e.time, direction: e.direction, leader: "SPY", follower: "QQQ" });
    }
  }
  return divergences.sort((a, b) => a.time - b.time);
}
