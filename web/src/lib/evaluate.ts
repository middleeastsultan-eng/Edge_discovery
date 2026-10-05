import type { Experiment } from "./supabase";

export type Verdict = "pass" | "fail" | "insufficient";

/**
 * An experiment only "passes" if the edge found on discovery data survives
 * being re-tested on data it was never fit to. Discovery-set performance is
 * excluded on purpose -- that number is optimistic by construction.
 */
export function verdict(exp: Experiment): Verdict {
  const v = exp.validation_stats;
  const t = exp.test_stats;

  if (!v || !t || v.n_trades < 10 || t.n_trades < 10) return "insufficient";
  if (v.expectancy_r > 0 && t.expectancy_r > 0) return "pass";
  return "fail";
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  pass: "Survived validation",
  fail: "Failed validation",
  insufficient: "Not enough trades",
};
