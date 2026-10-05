import { StatTile } from "./StatTile";
import { formatNum, formatR, formatPct } from "@/lib/format";
import type { TradeStats } from "@/lib/supabase";

export function StatsGrid({ stats }: { stats: TradeStats | null | undefined }) {
  if (!stats) {
    return <div className="text-sm text-[#898781]">No trades in this split.</div>;
  }

  const expectancyTone = stats.expectancy_r > 0 ? "good" : stats.expectancy_r < 0 ? "bad" : "neutral";

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatTile label="Trades" value={String(stats.n_trades)} />
      <StatTile label="Win rate" value={formatPct(stats.win_rate)} />
      <StatTile label="Expectancy" value={formatR(stats.expectancy_r)} tone={expectancyTone} />
      <StatTile label="Profit factor" value={formatNum(stats.profit_factor)} />
      <StatTile label="Sharpe" value={formatNum(stats.sharpe)} />
      <StatTile label="Max drawdown" value={formatR(stats.max_drawdown_r)} />
      <StatTile label="Avg win" value={formatR(stats.avg_win_r)} />
      <StatTile label="Avg loss" value={formatR(stats.avg_loss_r)} />
    </div>
  );
}
