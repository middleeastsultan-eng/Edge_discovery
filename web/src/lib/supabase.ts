import "server-only";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side only, never NEXT_PUBLIC_*)");
}

// Server-only client using the service role key. Never import this from a
// Client Component -- the key must never reach the browser bundle.
export const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

export type TradeStats = {
  n_trades: number;
  win_rate: number;
  expectancy_r: number;
  profit_factor: number;
  sharpe: number;
  max_drawdown_r: number;
  avg_win_r: number;
  avg_loss_r: number;
};

export type Experiment = {
  id: number;
  created_at: string;
  symbol: string;
  interval: string;
  start_date: string;
  end_date: string;
  rule: string;
  clauses: unknown;
  discovery_stats: TradeStats & { score?: number; rule?: string };
  validation_stats: TradeStats | null;
  test_stats: TradeStats | null;
  walk_forward: Array<{
    window: number;
    start: string;
    end: string;
  } & TradeStats> | null;
  monte_carlo: {
    final_r_p5: number;
    final_r_p50: number;
    final_r_p95: number;
    max_drawdown_r_p50: number;
    max_drawdown_r_p95: number;
    prob_final_negative: number;
  } | null;
  information_test: {
    horizon: number;
    n_condition: number;
    n_baseline: number;
    conditional_mean_return: number;
    baseline_mean_return: number;
    conditional_p_positive: number;
    baseline_p_positive: number;
    p_value: number;
  } | null;
  cost_stress: Array<{
    cost_multiplier: number;
  } & TradeStats> | null;
  parameter_stability: {
    score: number;
    perturbations: Array<{
      clause_index: number;
      feature: string;
      step_frac: number;
      perturbed_value: number;
    } & TradeStats>;
  } | null;
  robustness_score: {
    total: number;
    label: "Strong" | "Promising" | "Weak" | "Reject";
    components: {
      expectancy: number;
      oos_consistency: number;
      walk_forward_stability: number;
      parameter_stability: number;
      cost_sensitivity: number;
      sample_size: number;
      drawdown: number;
      overfitting_resistance: number;
      profit_concentration: number;
    };
    red_flags: string[];
  } | null;
};

export type ExperimentTrade = {
  id: number;
  experiment_id: number;
  split: string;
  entry_time: string;
  exit_time: string;
  entry_price: number;
  exit_price: number;
  exit_reason: string;
  r_multiple: number;
  bars_held: number;
};
