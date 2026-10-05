import { ListOrdered, Target, TrendingUp, Scale, Activity, TrendingDown, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { StatTile } from "./StatTile";
import { formatNum, formatR, formatPct } from "@/lib/format";
import { TEXT_MUTED } from "@/lib/theme";
import type { TradeStats } from "@/lib/supabase";

export function StatsGrid({ stats }: { stats: TradeStats | null | undefined }) {
  if (!stats) {
    return <div className="text-sm" style={{ color: TEXT_MUTED }}>No trades in this split.</div>;
  }

  const expectancyTone = stats.expectancy_r > 0 ? "good" : stats.expectancy_r < 0 ? "bad" : "neutral";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatTile label="Trades" value={String(stats.n_trades)} icon={ListOrdered} />
      <StatTile label="Win rate" value={formatPct(stats.win_rate)} icon={Target} />
      <StatTile label="Expectancy" value={formatR(stats.expectancy_r)} tone={expectancyTone} icon={TrendingUp} />
      <StatTile label="Profit factor" value={formatNum(stats.profit_factor)} icon={Scale} />
      <StatTile label="Sharpe" value={formatNum(stats.sharpe)} icon={Activity} />
      <StatTile label="Max drawdown" value={formatR(stats.max_drawdown_r)} icon={TrendingDown} />
      <StatTile label="Avg win" value={formatR(stats.avg_win_r)} tone="good" icon={ArrowUpRight} />
      <StatTile label="Avg loss" value={formatR(stats.avg_loss_r)} tone="bad" icon={ArrowDownRight} />
    </div>
  );
}
