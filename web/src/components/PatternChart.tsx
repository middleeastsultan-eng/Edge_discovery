"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, LineSeries, createSeriesMarkers, ColorType, LineStyle,
  type IChartApi, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { ExperimentTrade } from "@/lib/supabase";
import { TEXT_MUTED, TEXT_SECONDARY, CHART_AMBER, CHART_BLUE, CHART_TEAL } from "@/lib/theme";

// Canvas (what lightweight-charts renders to) doesn't understand CSS custom property
// references like "var(--tl-status-good)" -- fillStyle/strokeStyle need a literal
// resolved color. Reading getComputedStyle at mount time gets the actual value for
// whichever theme (light/dark) is active right now.
function resolveCssVar(varExpr: string, fallback: string): string {
  const match = varExpr.match(/var\((--[\w-]+)\)/);
  if (!match || typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
  return value || fallback;
}

type LatestTradeLevels = { entry: number; stop: number; target: number };
type PercentPoint = { time: number; value: number };

export function PatternChart({
  candles, trades, signal, latestTradeLevels, qqqSeries, spySeries,
}: {
  candles: Candle[];
  trades: ExperimentTrade[];
  signal?: boolean[];
  latestTradeLevels?: LatestTradeLevels | null;
  qqqSeries?: PercentPoint[];
  spySeries?: PercentPoint[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [showQQQ, setShowQQQ] = useState(true);
  const [showSPY, setShowSPY] = useState(true);

  const hasQQQ = !!qqqSeries && qqqSeries.length > 0;
  const hasSPY = !!spySeries && spySeries.length > 0;

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const good = resolveCssVar("var(--tl-status-good)", "#0ca30c");
    const bad = resolveCssVar("var(--tl-status-critical)", "#d03b3b");
    const gridline = resolveCssVar("var(--tl-gridline)", "#e1e0d9");
    const textMuted = resolveCssVar("var(--tl-text-muted)", "#898781");
    const amber = resolveCssVar(CHART_AMBER, "#c9a227");
    const blue = resolveCssVar(CHART_BLUE, "#3b82f6");
    const teal = resolveCssVar(CHART_TEAL, "#14b8a6");

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: textMuted },
      grid: { vertLines: { color: gridline }, horzLines: { color: gridline } },
      width: containerRef.current.clientWidth,
      height: 400,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Main candlesticks live in pane 1; the signal strip (added below) takes pane 0,
    // so it renders as a separate, shorter row parallel to and just above the candles --
    // distinct from the trade markers, which only mark actual entries, not every bar
    // where the rule's raw condition held true.
    const series = chart.addSeries(
      CandlestickSeries,
      { upColor: good, downColor: bad, borderVisible: false, wickUpColor: good, wickDownColor: bad },
      1,
    );
    series.setData(
      candles.map((c) => ({
        time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
      }))
    );

    const markers = trades
      .map((t) => ({
        time: Math.floor(new Date(t.entry_time).getTime() / 1000) as UTCTimestamp,
        position: (t.r_multiple > 0 ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color: t.r_multiple > 0 ? good : bad,
        shape: (t.r_multiple > 0 ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
        text: `${t.r_multiple > 0 ? "+" : ""}${t.r_multiple.toFixed(2)}R`,
      }))
      .sort((a, b) => a.time - b.time);
    createSeriesMarkers(series, markers);

    if (latestTradeLevels) {
      series.createPriceLine({
        price: latestTradeLevels.entry, color: textMuted, lineWidth: 1,
        lineStyle: LineStyle.Dashed, title: "Entry",
      });
      series.createPriceLine({
        price: latestTradeLevels.stop, color: bad, lineWidth: 1,
        lineStyle: LineStyle.Dashed, title: "Stop",
      });
      series.createPriceLine({
        price: latestTradeLevels.target, color: good, lineWidth: 1,
        lineStyle: LineStyle.Dashed, title: "Target",
      });
    }

    if (signal && signal.length === candles.length) {
      const signalSeries = chart.addSeries(
        HistogramSeries,
        { color: amber, priceFormat: { type: "volume" }, baseLineVisible: false, priceLineVisible: false, lastValueVisible: false },
        0,
      );
      signalSeries.setData(
        candles.map((c, i) => ({
          time: c.time as UTCTimestamp, value: signal[i] ? 1 : 0, color: signal[i] ? amber : "transparent",
        }))
      );
      const panes = chart.panes();
      if (panes.length >= 2) {
        panes[0].setStretchFactor(0.15);
        panes[1].setStretchFactor(0.85);
      }
    }

    // Index overlay: Nasdaq 100 (QQQ) / S&P 500 (SPY), normalized to % change so they're
    // directly comparable to each other and to this pattern's own candles regardless of
    // price scale. Shares the candlestick pane (so they visually "overlap" it, as asked
    // for) but gets its own right-side price scale -- a few percent of movement would be
    // an invisible sliver against real price values on the same axis.
    if (hasQQQ && showQQQ) {
      const qqq = chart.addSeries(
        LineSeries,
        { color: blue, lineWidth: 2, priceScaleId: "index-overlay", title: "QQQ %", lastValueVisible: false, priceLineVisible: false },
        1,
      );
      qqq.setData(qqqSeries!.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }
    if (hasSPY && showSPY) {
      const spy = chart.addSeries(
        LineSeries,
        { color: teal, lineWidth: 2, priceScaleId: "index-overlay", title: "SPY %", lastValueVisible: false, priceLineVisible: false },
        1,
      );
      spy.setData(spySeries!.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })));
    }

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, trades, signal, latestTradeLevels, qqqSeries, spySeries, showQQQ, showSPY, hasQQQ, hasSPY]);

  if (candles.length === 0) {
    return (
      <div className="text-sm" style={{ color: TEXT_MUTED }}>
        No candle data available for this pattern&apos;s date range.
      </div>
    );
  }

  return (
    <div>
      {(hasQQQ || hasSPY) && (
        <div className="flex items-center gap-4 mb-2 text-xs" style={{ color: TEXT_SECONDARY }}>
          {hasQQQ && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showQQQ} onChange={(e) => setShowQQQ(e.target.checked)} />
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: "var(--tl-chart-blue)" }} />
              QQQ (Nasdaq 100)
            </label>
          )}
          {hasSPY && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showSPY} onChange={(e) => setShowSPY(e.target.checked)} />
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: "var(--tl-chart-teal)" }} />
              SPY (S&amp;P 500)
            </label>
          )}
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
