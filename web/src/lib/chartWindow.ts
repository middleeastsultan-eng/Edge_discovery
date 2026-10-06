// Shared between the server-side initial chart load (experiments/[id]/page.tsx) and the
// client-side timeframe switcher (PatternChart.tsx) so both apply the identical rule:
// a finer timeframe over the SAME wide date span an experiment's own (often much
// coarser) interval used would fetch and render an enormous number of candles --
// confirmed directly as the main cause of a real "the render is heavy" report, caused
// by switching to 1-minute over a multi-month trade span. 1-Day keeps the full original
// span since daily bars stay sparse even over years.
export const TIMEFRAME_WINDOW_DAYS: Record<string, number | null> = {
  "1Min": 10,
  "5Min": 30,
  "30Min": 120,
  "1Day": null, // null = no cap, use the full original window
};

/** Narrows [fullStart, fullEnd] to the most recent windowDays (if the interval has a
 * cap), anchored at fullEnd -- never widens beyond the original window.
 */
export function windowedRange(interval: string, fullStart: Date, fullEnd: Date): { start: Date; end: Date } {
  const windowDays = TIMEFRAME_WINDOW_DAYS[interval];
  if (windowDays === null || windowDays === undefined) return { start: fullStart, end: fullEnd };
  const cappedStart = new Date(fullEnd.getTime() - windowDays * 24 * 60 * 60 * 1000);
  return { start: new Date(Math.max(fullStart.getTime(), cappedStart.getTime())), end: fullEnd };
}
