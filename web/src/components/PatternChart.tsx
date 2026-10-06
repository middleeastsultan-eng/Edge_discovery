"use client";

import { useEffect, useRef } from "react";
import {
  createChart, CandlestickSeries, createSeriesMarkers, ColorType,
  type IChartApi, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { ExperimentTrade } from "@/lib/supabase";
import { TEXT_MUTED } from "@/lib/theme";

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

export function PatternChart({ candles, trades }: { candles: Candle[]; trades: ExperimentTrade[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current || candles.length === 0) return;

    const good = resolveCssVar("var(--tl-status-good)", "#0ca30c");
    const bad = resolveCssVar("var(--tl-status-critical)", "#d03b3b");
    const gridline = resolveCssVar("var(--tl-gridline)", "#e1e0d9");
    const textMuted = resolveCssVar("var(--tl-text-muted)", "#898781");

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: textMuted },
      grid: { vertLines: { color: gridline }, horzLines: { color: gridline } },
      width: containerRef.current.clientWidth,
      height: 400,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    const series = chart.addSeries(CandlestickSeries, {
      upColor: good, downColor: bad, borderVisible: false,
      wickUpColor: good, wickDownColor: bad,
    });
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

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      chart.remove();
    };
  }, [candles, trades]);

  if (candles.length === 0) {
    return (
      <div className="text-sm" style={{ color: TEXT_MUTED }}>
        No candle data available for this pattern&apos;s date range.
      </div>
    );
  }

  return <div ref={containerRef} className="w-full" />;
}
