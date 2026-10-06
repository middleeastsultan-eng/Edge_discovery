"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers, ColorType, LineStyle,
  type IChartApi, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { ExperimentTrade } from "@/lib/supabase";
import type { DivergenceEvent } from "@/lib/structure";
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

export function PatternChart({
  candles, trades, signal, latestTradeLevels, symbol, otherIndexCandles, otherIndexSymbol, divergenceEvents,
}: {
  candles: Candle[];
  trades: ExperimentTrade[];
  signal?: boolean[];
  latestTradeLevels?: LatestTradeLevels | null;
  symbol: string;
  otherIndexCandles?: Candle[];
  otherIndexSymbol?: "QQQ" | "SPY" | null;
  divergenceEvents?: DivergenceEvent[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const [showOtherIndex, setShowOtherIndex] = useState(true);
  const [showDivergence, setShowDivergence] = useState(true);

  const hasOtherIndex = !!otherIndexCandles && otherIndexCandles.length > 0 && !!otherIndexSymbol;
  const hasDivergence = !!divergenceEvents && divergenceEvents.length > 0;

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const good = resolveCssVar("var(--tl-status-good)", "#0ca30c");
    const bad = resolveCssVar("var(--tl-status-critical)", "#d03b3b");
    const gridline = resolveCssVar("var(--tl-gridline)", "#e1e0d9");
    const textMuted = resolveCssVar("var(--tl-text-muted)", "#898781");
    const amber = resolveCssVar(CHART_AMBER, "#c9a227");
    const blue = resolveCssVar(CHART_BLUE, "#3b82f6");
    const teal = resolveCssVar(CHART_TEAL, "#14b8a6");

    const showOther = hasOtherIndex && showOtherIndex;
    const otherPaneIndex = 2; // pane 0 = signal strip, pane 1 = this symbol's candles

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: textMuted },
      grid: { vertLines: { color: gridline }, horzLines: { color: gridline } },
      width: containerRef.current.clientWidth,
      height: showOther ? 620 : 400,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // This symbol's candlesticks live in pane 1; the signal strip (added below) takes
    // pane 0, so it renders as a separate, shorter row parallel to and just above the
    // candles -- distinct from the trade markers, which only mark actual entries, not
    // every bar where the rule's raw condition held true.
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

    const tradeMarkers = trades.map((t) => ({
      time: Math.floor(new Date(t.entry_time).getTime() / 1000) as UTCTimestamp,
      position: (t.r_multiple > 0 ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
      color: t.r_multiple > 0 ? good : bad,
      shape: (t.r_multiple > 0 ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
      text: `${t.r_multiple > 0 ? "+" : ""}${t.r_multiple.toFixed(2)}R`,
    }));

    // Structure divergence markers: whichever index broke a swing high/low without the
    // other confirming it gets a circle marker ON THAT INDEX'S OWN candles -- this
    // symbol's pane shows markers for breaks THIS symbol led, the other index's pane
    // (below) shows markers for breaks IT led, so each pane's markers sit on the real
    // candles that actually broke structure instead of guessing which chart to put them on.
    const thisSymbolDivergenceMarkers =
      showDivergence && divergenceEvents
        ? divergenceEvents
            .filter((e) => e.leader === symbol)
            .map((e) => ({
              time: e.time as UTCTimestamp,
              position: (e.direction === "bullish" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
              color: amber,
              shape: "circle" as const,
              text: `${e.leader} broke structure, ${e.follower} didn't confirm`,
            }))
        : [];

    const markers = [...tradeMarkers, ...thisSymbolDivergenceMarkers].sort((a, b) => a.time - b.time);
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
    }

    // The paired index's own real candles in a third pane -- actual OHLC, not a
    // normalized line, so the same swing highs/lows a trader would eyeball on this
    // symbol's chart are directly visible on the other index's chart too (confirmed
    // directly: a normalized % line overlay sharing one pane was reported as confusing).
    if (showOther) {
      const otherSeries = chart.addSeries(
        CandlestickSeries,
        { upColor: blue, downColor: teal, borderVisible: false, wickUpColor: blue, wickDownColor: teal },
        otherPaneIndex,
      );
      otherSeries.setData(
        otherIndexCandles!.map((c) => ({
          time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close,
        }))
      );

      const otherDivergenceMarkers =
        showDivergence && divergenceEvents
          ? divergenceEvents
              .filter((e) => e.leader === otherIndexSymbol)
              .map((e) => ({
                time: e.time as UTCTimestamp,
                position: (e.direction === "bullish" ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
                color: amber,
                shape: "circle" as const,
                text: `${e.leader} broke structure, ${e.follower} didn't confirm`,
              }))
          : [];
      createSeriesMarkers(otherSeries, otherDivergenceMarkers);
    }

    const panes = chart.panes();
    if (showOther && panes.length >= 3) {
      panes[0].setStretchFactor(0.12);
      panes[1].setStretchFactor(0.55);
      panes[2].setStretchFactor(0.33);
    } else if (panes.length >= 2) {
      panes[0].setStretchFactor(0.15);
      panes[1].setStretchFactor(0.85);
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
  }, [candles, trades, signal, latestTradeLevels, symbol, otherIndexCandles, otherIndexSymbol, hasOtherIndex, showOtherIndex, divergenceEvents, showDivergence]);

  if (candles.length === 0) {
    return (
      <div className="text-sm" style={{ color: TEXT_MUTED }}>
        No candle data available for this pattern&apos;s date range.
      </div>
    );
  }

  return (
    <div>
      {(hasOtherIndex || hasDivergence) && (
        <div className="flex items-center gap-4 mb-2 text-xs" style={{ color: TEXT_SECONDARY }}>
          {hasOtherIndex && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={showOtherIndex} onChange={(e) => setShowOtherIndex(e.target.checked)} />
              {otherIndexSymbol} candles ({otherIndexSymbol === "QQQ" ? "Nasdaq 100" : "S&P 500"})
            </label>
          )}
          {hasDivergence && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none" title="One index broke a recent swing high/low and the other didn't confirm it around the same time">
              <input type="checkbox" checked={showDivergence} onChange={(e) => setShowDivergence(e.target.checked)} />
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--tl-chart-amber)" }} />
              Structure divergence ({divergenceEvents!.length})
            </label>
          )}
        </div>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
