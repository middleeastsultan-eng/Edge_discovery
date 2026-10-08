import { Wallet, ShieldCheck, TrendingDown, Activity, Bell, Zap, Trophy } from 'lucide-react';
import { supabase, type PaperAccount, type PaperTrade } from '@/lib/supabase';
import { formatUSD, formatPct, formatNum, formatDateTime } from '@/lib/format';
import { PaperEquityCurve } from '@/components/PaperEquityCurve';
import { StatTile } from '@/components/StatTile';
import { BannerBackground } from '@/components/BannerBackground';
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, BORDER_SOFT, STATUS_GOOD, STATUS_CRITICAL, ACCENT, tint } from '@/lib/theme';

export const dynamic = 'force-dynamic';

// Must match trading_lab/paper_portfolio.py's STARTING_EQUITY.
const STARTING_EQUITY = 10_000;

// Maps experiment_id -> { symbol, interval, rule }
const experimentCache = new Map<number, { symbol: string; interval: string; rule: string }>();

export default async function PaperTradingPage() {
  // Fetch trades + experiment metadata in parallel
  let paperTrades: PaperTrade[] = [];
  let paperAccount: PaperAccount = { equity: STARTING_EQUITY, watermark: null };

  try {
    const [tradesResult, accountResult] = await Promise.all([
      supabase.from('paper_trades').select('*').order('id', { ascending: true }),
      supabase.from('paper_account').select('equity, watermark').eq('id', 1).single(),
    ]);

    if (tradesResult.error) throw tradesResult.error;
    if (accountResult.error) throw accountResult.error;

    paperTrades = (tradesResult.data ?? []) as PaperTrade[];
    paperAccount = (accountResult.data ?? { equity: STARTING_EQUITY, watermark: null }) as PaperAccount;

    // Build experiment lookup for symbol/interval/rule
    const experimentIds = [...new Set(paperTrades.map((t) => t.experiment_id))];
    for (const eid of experimentIds) {
      const { data: expData } = await supabase
        .from('experiments')
        .select('symbol, interval, rule')
        .eq('id', eid)
        .single();
      if (expData) {
        experimentCache.set(eid, {
          symbol: expData.symbol,
          interval: expData.interval,
          rule: expData.rule,
        });
      }
    }
  } catch (err: any) {
    console.error('Failed to load paper trading data:', err);
  }

  // Calculate metrics
  const paperReturnPct = paperAccount.equity / STARTING_EQUITY - 1;
  const paperWinRate = paperTrades.length
    ? paperTrades.filter((t) => t.pnl_dollars > 0).length / paperTrades.length
    : null;

  const paperMaxDrawdown = paperTrades.reduce(
    (acc, t) => {
      const peak = Math.max(acc.peak, t.equity_after);
      return { peak, maxDd: Math.min(acc.maxDd, t.equity_after - peak) };
    },
    { peak: STARTING_EQUITY, maxDd: 0 },
  ).maxDd;

  const avgTradePnL = paperTrades.length
    ? paperTrades.reduce((sum, t) => sum + t.pnl_dollars, 0) / paperTrades.length
    : 0;

  const grossProfit = paperTrades.reduce(
    (sum, t) => sum + Math.max(0, t.pnl_dollars),
    0
  );
  const grossLoss = paperTrades.reduce(
    (sum, t) => sum + Math.max(0, -t.pnl_dollars),
    0
  );
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  // Helper to get experiment metadata
  const getExperiment = (eid: number) => {
    const cached = experimentCache.get(eid);
    if (cached) return cached;
    // Fallback: fetch on demand
    return supabase
      .from('experiments')
      .select('symbol, interval, rule')
      .eq('id', eid)
      .single()
      .then((r) => r.data ?? null);
  };

  return (
    <div className="space-y-8">
      <div
        className="relative overflow-hidden rounded-2xl px-6 py-10 sm:px-10 sm:py-14 shadow-sm animate-in fade-in duration-700"
        style={{ border: `1px solid ${BORDER}` }}
      >
        <BannerBackground query="trading floor screens paper trading portfolio" />
        <div className="flex items-center gap-2.5 mb-1.5">
          <span className="relative inline-flex h-2 w-2" aria-hidden>
            <span
              className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
              style={{ backgroundColor: STATUS_GOOD }}
            />
            <span className="relative inline-flex h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_GOOD }} />
          </span>
          <h1 className="text-2xl font-semibold" style={{ color: TEXT_PRIMARY }}>
            Paper Trading Portfolio
          </h1>
        </div>
        <p className="text-sm max-w-2xl" style={{ color: TEXT_MUTED }}>
          Simulated account taking every promoted pattern's signals, sized at 1% risk/trade with a 10% concurrent
          risk cap. Starting equity: {formatUSD(STARTING_EQUITY)}. What matters is the % return, drawdown, and
          whether trusting the whole basket together actually works -- correlated patterns firing together multiply
          risk, not edge.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Starting Equity" value={formatUSD(STARTING_EQUITY)} icon={Wallet} />
        <StatTile
          label="Current Equity"
          value={formatUSD(paperAccount.equity)}
          tone={paperAccount.equity > STARTING_EQUITY ? 'good' : paperAccount.equity < STARTING_EQUITY ? 'bad' : 'neutral'}
          icon={Wallet}
        />
        <StatTile
          label="Total Return"
          value={formatPct(paperReturnPct)}
          tone={paperReturnPct > 0 ? 'good' : paperReturnPct < 0 ? 'bad' : 'neutral'}
          icon={Zap}
        />
        <StatTile label="Total Trades" value={String(paperTrades.length)} icon={Activity} />
        <StatTile
          label="Max Drawdown"
          value={formatUSD(paperMaxDrawdown)}
          tone={paperMaxDrawdown < 0 ? 'bad' : 'neutral'}
          icon={TrendingDown}
        />
        <StatTile
          label="Win Rate"
          value={paperWinRate === null ? '—' : formatPct(paperWinRate)}
          tone={paperWinRate === null ? 'neutral' : paperWinRate > 0.5 ? 'good' : 'bad'}
          icon={ShieldCheck}
        />
        <StatTile
          label="Avg P&L / Trade"
          value={formatUSD(avgTradePnL)}
          tone={avgTradePnL > 0 ? 'good' : avgTradePnL < 0 ? 'bad' : 'neutral'}
          icon={Bell}
        />
        <StatTile
          label="Profit Factor"
          value={profitFactor.toFixed(2)}
          tone={profitFactor > 1.5 ? 'good' : profitFactor > 1 ? 'neutral' : 'bad'}
          icon={Trophy}
        />
      </div>

      {paperTrades.length === 0 ? (
        <div
          className="rounded-2xl px-4 py-10 text-center text-sm"
          style={{ border: `1px solid ${BORDER}`, backgroundColor: SURFACE, color: TEXT_MUTED }}
        >
          No paper trades yet -- the paper account only acts on promoted patterns, and none exist yet.
          Starting equity is {formatUSD(STARTING_EQUITY)} notional; what matters once trades start is the
          % return, drawdown, and whether trusting the whole basket together actually works.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl shadow-sm" style={{ border: `1px solid ${BORDER}` }}>
          <table className="w-full text-sm">
            <thead>
              <tr
                className="border-b text-left text-xs"
                style={{
                  borderColor: BORDER,
                  backgroundColor: 'var(--tl-table-header-bg)',
                  color: TEXT_MUTED,
                }}
              >
                <th className="px-4 py-3 font-medium">Symbol</th>
                <th className="px-4 py-3 font-medium">Rule</th>
                <th className="px-4 py-3 font-medium text-right">Entry</th>
                <th className="px-4 py-3 font-medium text-right">Exit</th>
                <th className="px-4 py-3 font-medium text-right">P&L ($)</th>
                <th className="px-4 py-3 font-medium text-right">P&L (%)</th>
                <th className="px-4 py-3 font-medium">Exit reason</th>
              </tr>
            </thead>
            <tbody>
              {paperTrades
                .slice()
                .reverse()
                .map((t) => {
                  const exp = experimentCache.get(t.experiment_id);
                  // If experiment metadata not cached, fetch it
                  let sym = '—', intr = '—', rule = '—';
                  if (exp) {
                    sym = exp.symbol;
                    intr = exp.interval;
                    rule = exp.rule;
                  }
                  return (
                    <tr
                      key={t.id}
                      className="border-b last:border-0 transition-colors hover:bg-[var(--tl-text-primary)]/[0.03]"
                      style={{ borderColor: BORDER_SOFT }}
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-medium" style={{ color: TEXT_PRIMARY }}>
                          {sym}
                        </span>
                        <span style={{ color: TEXT_MUTED, fontSize: '0.75em' }}>{intr}</span>
                      </td>
                      <td className="px-4 py-3 max-w-md" style={{ color: TEXT_SECONDARY, fontFamily: 'var(--font-geist-mono)' }}>
                        <span className="truncate text-xs" title={rule}>
                          {rule}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: TEXT_SECONDARY }}>
                        {formatDateTime(t.entry_time)}
                      </td>
                      <td className="px-4 py-3 text-xs" style={{ color: TEXT_SECONDARY }}>
                        {formatDateTime(t.exit_time)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: t.pnl_dollars >= 0 ? STATUS_GOOD : STATUS_CRITICAL }}>
                        {t.pnl_dollars >= 0 ? '+' : ''}{formatUSD(t.pnl_dollars)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: t.pnl_dollars >= 0 ? STATUS_GOOD : STATUS_CRITICAL }}>
                        {t.pnl_dollars >= 0 ? '+' : ''}{formatPct(t.pnl_dollars / STARTING_EQUITY)}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {paperTrades.length > 0 && (
        <div className="rounded-2xl p-4 shadow-sm" style={{ backgroundColor: SURFACE, border: `1px solid ${BORDER}` }}>
          <PaperEquityCurve trades={paperTrades} />
        </div>
      )}
    </div>
  );
}