// How often does this pattern actually recur, and when might it fire next? Answers
// "how many times did this pass in live" with a real count, and "when is it coming"
// with an honest range derived from the actual gaps between past occurrences --
// not a guarantee, since market regimes shift and these gaps are often irregular,
// but a real, data-driven estimate rather than a guess.

export type RecurrenceStats = {
  occurrences: number;
  medianGapDays: number;
  p25GapDays: number;
  p75GapDays: number;
  lastOccurrence: Date;
  nextExpectedMedian: Date;
  nextExpectedWindow: [Date, Date];
};

function percentile(sortedValues: number[], p: number): number {
  const idx = Math.floor(p * (sortedValues.length - 1));
  return sortedValues[idx];
}

/** Needs at least 3 occurrences (2 gaps) to say anything meaningful about frequency --
 * a single gap can't distinguish "regular" from "a fluke."
 */
export function computeRecurrence(entryTimes: Date[]): RecurrenceStats | null {
  if (entryTimes.length < 3) return null;

  const sorted = [...entryTimes].sort((a, b) => a.getTime() - b.getTime());
  const gapsDays: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    gapsDays.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000);
  }
  gapsDays.sort((a, b) => a - b);

  const lastOccurrence = sorted[sorted.length - 1];
  const medianGapDays = percentile(gapsDays, 0.5);
  const p25GapDays = percentile(gapsDays, 0.25);
  const p75GapDays = percentile(gapsDays, 0.75);

  return {
    occurrences: sorted.length,
    medianGapDays,
    p25GapDays,
    p75GapDays,
    lastOccurrence,
    nextExpectedMedian: new Date(lastOccurrence.getTime() + medianGapDays * 86_400_000),
    nextExpectedWindow: [
      new Date(lastOccurrence.getTime() + p25GapDays * 86_400_000),
      new Date(lastOccurrence.getTime() + p75GapDays * 86_400_000),
    ],
  };
}
