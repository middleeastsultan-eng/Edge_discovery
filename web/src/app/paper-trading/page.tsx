'use client';

import { useEffect, useState } from 'react';
import { supabase, type PaperAccount, type PaperTrade } from '@/lib/supabase';
import { formatUSD, formatPct, formatNum } from '@/lib/format';
import { PaperEquityCurve } from '@/components/PaperEquityCurve';
import { StatTile } from '@/components/StatTile';
import { Wallet, ShieldCheck, TrendingDown, Activity, Bell, Zap, Trophy } from 'lucide-react';
import { BannerBackground } from '@/components/BannerBackground';
import { TEXT_PRIMARY, TEXT_SECONDARY, TEXT_MUTED, SURFACE, BORDER, STATUS_GOOD, STATUS_CRITICAL, tint } from '@/lib/theme';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function PaperTradingPage() {
  let paperTrades: PaperTrade[] = [];
  let paperAccount: PaperAccount = { id: 1, equity: 10_000, watermark: null };

  try {
    const [tradesResult, accountResult] = await Promise.all([
      supabase.from('paper_trades').select('*').order('id', { ascending: true }),
      supabase.from('paper_account').select('*').eq('id', 1).single(),
    ]);

    if (tradesResult.error) throw tradesResult.error;
    if (accountResult.error) throw accountResult.error;

    paperTrades = tradesResult.data ?? [];
    paperAccount = accountResult.data ?? { id: 1, equity: 10_000, watermark: null };
  } catch (err) {
    console.error('Failed to load paper trading data:', err);
    // Fallback to defaults
    paperAccount = { id: 1, equity: 10_000, watermark: null };
  }

  // Calculate metrics
  const startingEquity = 10_000;
  const paperReturnPct = paperAccount.equity / startingEquity - 1;
  const paperWinRate = paperTrades.length
    ? paperTrades.filter(t => t.pnl_dollars > 0).length / paperTrades.length
    : null;

  const paperMaxDrawdown = paperTrades.reduce(
    (acc, t) => {
      const peak = Math.max(acc.peak, t.equity_after);
      return { peak, maxDd: Math.min(acc.maxDd, t.equity_after - peak) };
    },
    { peak: startingEquity, maxDd: 0 },
  ).maxDd;

  // Calculate average trade P&L
  const avgTradePnL = paperTrades.length
    ? paperTrades.reduce((sum, t) => sum + t.pnl_dollars, 0) / paperTrades.length
    : 0;

  // Calculate profit factor (gross profit / gross loss)
  const grossProfit = paperTrades.reduce((sum, t) => sum + Math.max(0, t.pnl_dollars), 0);
  const grossLoss = paperTrades.reduce((sum, t) => sum + Math.max(0, -t.pnl_dollars), 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : 0;

  // Auto-refresh every 30 seconds to show new trades
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const tradesResult = await supabase
          .from('paper_trades')
          .select('*')
          .order('id', { ascending: true });

        if (!tradesResult.error && tradesResult.data) {
          paperTrades = tradesResult.data;

          // Update account equity if needed
          const accountResult = await supabase
            .from('paper_account')
            .select('*')
            .eq('id', 1)
            .single();

          if (!accountResult.error && accountResult.data) {
            paperAccount = accountResult.data;
          }
        }
      } catch (err) {
        console.warn('Failed to refresh paper trading data:', err);
      }
    }, 30_000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-800">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-3xl font-bold text-center">
              Paper Trading Portfolio
            </h1>
            <div className="flex items-center gap-4">
              <StatTile
                label="Total Trades"
                value={paperTrades.length.toString()}
                icon={Activity}
              />
              <StatTile
                label="Win Rate"
                value={paperWinRate === null ? '—' : formatPct(paperWinRate)}
                icon={ShieldCheck}
                tone={paperWinRate === null ? 'neutral' : paperWinRate > 0.5 ? 'good' : 'bad'}
              />
              <StatTile
                label="Profit Factor"
                value={profitFactor.toFixed(2)}
                icon={Trophy}
                tone={profitFactor > 1.5 ? 'good' : profitFactor > 1 ? 'neutral' : 'bad'}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatTile
              label="Starting Equity"
              value={formatUSD(startingEquity)}
              icon={Wallet}
            />
            <StatTile
              label="Current Equity"
              value={formatUSD(paperAccount.equity)}
              icon={Wallet}
              tone={paperAccount.equity > startingEquity ? 'good' : paperAccount.equity < startingEquity ? 'bad' : 'neutral'}
            />
            <StatTile
              label="Total Return"
              value={formatPct(paperReturnPct)}
              icon={Zap}
              tone={paperReturnPct > 0 ? 'good' : paperReturnPct < 0 ? 'bad' : 'neutral'}
            />
            <StatTile
              label="Max Drawdown"
              value={formatUSD(paperMaxDrawdown)}
              icon={TrendingDown}
              tone={paperMaxDrawdown < 0 ? 'bad' : 'neutral'}
            />
            <StatTile
              label="Avg P&L/Trade"
              value={formatUSD(avgTradePnL)}
              icon={Bell}
              tone={avgTradePnL > 0 ? 'good' : avgTradePnL < 0 ? 'bad' : 'neutral'}
            />
            <StatTile
              label="Gross Profit/Loss"
              value={`${formatUSD(grossProfit)} / ${formatUSD(grossLoss)}`}
              icon={Activity}
            />
          </div>
        </div>

        {/* Main Content */}
        <div className="grid gap-8">
          {/* Equity Curve */}
          <div className="col-span-1 lg:col-span-2">
            <div className="rounded-xl border border-[var(--border)] bg-white dark:bg-gray-800 shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold mb-4">
                  Equity Curve
                </h2>
                <PaperEquityCurve trades={paperTrades} />
              </div>
            </div>
          </div>

          {/* Recent Trades & Controls */}
          <div className="col-span-1 lg:col-span-2">
            <div className="rounded-xl border border-[var(--border)] bg-white dark:bg-gray-800 shadow-sm">
              <div className="p-6">
                <h2 className="text-xl font-semibold mb-4">
                  Recent Trades
                </h2>

                {paperTrades.length === 0 ? (
                  <div className="text-center py-12 text-muted">
                    <p className="mb-4">No paper trades yet.</p>
                    <p className="text-sm">
                      Trades will appear here once promoted patterns generate
                      signals in live trading and the paper account executes them.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {paperTrades
                      .slice()
                      .reverse()
                      .slice(0, 10)
                      .map((trade) => (
                        <div
                          key={trade.id}
                          className="p-3 rounded-lg border border-[var(--border-light)] bg-[var(--surface)]"
                        >
                          <div className="flex justify-between items-start mb-2">
                            <div className="flex-1 min-w-0">
                              <h3 className="font-medium text-sm">{trade.symbol} {trade.interval}</h3>
                              <p className="text-xs text-muted truncate">
                                {trade.rule}
                              </p>
                            </div>
                            <div className="text-right text-xs space-y-0.5">
                              <span className="font-medium">
                                {trade.pnl_dollars >= 0 ? '+' : ''}{formatUSD(trade.pnl_dollars)}
                              </span>
                              <span className="text-xs">
                                ({formatPct(trade.pnl_pct)})
                              </span>
                            </div>
                          </div>
                          <div className="flex justify-between text-xs text-muted">
                            <span>
                              Entry: {formatDateTime(trade.entry_time)}
                            </span>
                            <span>
                              Exit: {formatDateTime(trade.exit_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              {trade.exit_reason === 'target' && (
                                <span className="text-[var(--status-success)]">🎯 Target</span>
                              )}
                              {trade.exit_reason === 'stop' && (
                                <span className="text-[var(--status-error)]">🛑 Stop</span>
                              )}
                              {trade.exit_reason === 'time' && (
                                <span className="text-[var(--status-muted)]">⏰ Time</span>
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                )}

                {/* Controls */}
                {paperTrades.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-[var(--border-light)]">
                    <h3 className="text-lg font-semibold mb-3">Paper Account Controls</h3>
                    <div className="space-y-3">
                      <button
                        onClick={async () => {
                          if (window.confirm('Reset paper trading account to starting equity? This will clear all trade history.')) {
                            try {
                              await supabase.from('paper_trades').delete().neq('id', 0);
                              await supabase
                                .from('paper_account')
                                .update({ equity: 10_000, watermark: null })
                                .eq('id', 1);
                              window.location.reload();
                            } catch (err) {
                              alert('Failed to reset account: ' + err.message);
                            }
                          }
                        }}
                        className="w-full flex items-center justify-center px-4 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium rounded-lg border border-red-200"
                      >
                        Reset Paper Account
                      </button>

                      <button
                        onClick={async () => {
                          try {
                            const result = await supabase.rpc('calculate_paper_performance');
                            alert('Performance recalculated');
                          } catch (err) {
                            // Ignore if function doesn't exist
                          }
                        }}
                        className="w-full flex items-center justify-center px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 font-medium rounded-lg border border-blue-200"
                      >
                        Recalculate Performance
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="mt-12 rounded-xl border border-[var(--border)] bg-white dark:bg-gray-800">
          <div className="p-6">
            <h2 className="text-xl font-semibold mb-4">How Paper Trading Works</h2>
            <div className="space-y-4">
              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <span className="text-[var(--accent)]">1</span>
                </div>
                <div>
                  <h3 className="font-medium text-sm">Signal Generation</h3>
                  <p className="text-sm text-muted">
                    Patterns that score 80+/100 in backtesting enter forward tracking.
                    When they prove themselves in live data, they become "promoted"
                    and generate trade signals.
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <span className="text-[var(--accent)]">2</span>
                </div>
                <div>
                  <h3 className="font-medium text-sm">Trade Execution</h3>
                  <p className="text-sm text-muted">
                    The paper account automatically executes every signal from
                    promoted patterns using 1% risk per trade (fixed fractional
                    position sizing).
                  </p>
                </div>
              </div>

              <div className="flex items-start space-x-3">
                <div className="flex-shrink-0">
                  <span className="text-[var(--accent)]">3</span>
                </div>
                <div>
                  <h3 className="font-medium text-sm">Performance Tracking</h3>
                  <p className="text-sm text-muted">
                    All trades are recorded with P&L, win rate, drawdown, and other
                    metrics to evaluate the strategy's effectiveness before risking
                    real capital.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}