"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  createChart, CandlestickSeries, LineSeries, HistogramSeries, createSeriesMarkers, ColorType, LineStyle,
  type IChartApi, type ISeriesApi, type SeriesType, type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "@/lib/candles";
import type { ExperimentTrade, ClauseJson } from "@/lib/supabase";
import { detectDivergences, type DivergenceEvent } from "@/lib/structure";
import { computeFeatureSeries, evaluateSignal } from "@/lib/indicators";
import { DivergenceBandPrimitive } from "./chartPrimitives";
import { windowedRange } from "@/lib/chartWindow";
import { TEXT_MUTED, TEXT_SECONDARY, TEXT_PRIMARY, CHART_AMBER, CHART_BLUE, CHART_TEAL, SURFACE, BORDER, ACCENT } from "@/lib/theme";

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

// Normalizes ANY valid CSS color (hex, rgb, named) to rgba with a given alpha, by
// letting the browser's own canvas context do the color parsing -- far more robust
// than hand-rolling a hex parser for a string that's technically already normalized.
function withAlpha(color: string, alpha: number): string {
  if (typeof document === "undefined") return color;
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return color;
  ctx.fillStyle = color;
  const hex = ctx.fillStyle;
  if (!hex.startsWith("#") || hex.length !== 7) return color;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const TIMEFRAMES = [
  { label: "1m", interval: "1Min" },
  { label: "5m", interval: "5Min" },
  { label: "30m", interval: "30Min" },
  { label: "1D", interval: "1Day" },
];

const FOCUSED_OPACITY = 1;
const DIMMED_OPACITY = 0.22;
// Below this many pixels from a series' actual plotted value, the crosshair doesn't
// count as "on" that series -- hovering empty space between the two keeps both at full
// opacity instead of always force-picking a "closer" winner everywhere on the chart.
const HOVER_PROXIMITY_PX = 20;
// How many of the most recent bars count as "the present" for liveMode's default view
// (on first load and after an explicit timeframe switch) -- enough to read the recent
// shape without being zoomed out over the whole fetched window.
const PRESENT_WINDOW_BARS = 90;

type LatestTradeLevels = { entry: number; stop: number; target: number };

export function PatternChart({
  candles, trades, signal, latestTradeLevels, symbol, source, otherIndexCandles, otherIndexSymbol,
  divergenceEvents, chartStartIso, chartEndIso, interval, clauses, liveMode = false, liveRefreshSeconds = 60,
}: {
  candles: Candle[];
  trades: ExperimentTrade[];
  signal?: boolean[];
  latestTradeLevels?: LatestTradeLevels | null;
  symbol: string;
  source: string;
  otherIndexCandles?: Candle[];
  otherIndexSymbol?: "QQQ" | "SPY" | null;
  divergenceEvents?: DivergenceEvent[];
  chartStartIso?: string | null;
  chartEndIso?: string | null;
  interval: string;
  clauses: ClauseJson[];
  /** Auto-refreshes the chart on a timer, always sliding the window up to "now" --
   * for a standalone live-market view (the welcome page), not an experiment's fixed
   * historical span. */
  liveMode?: boolean;
  liveRefreshSeconds?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const primarySeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const otherSeriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const colorsRef = useRef({ good: "", bad: "", blue: "", teal: "" });
  // Visible time range captured right before a rebuild (toggle change, timeframe switch,
  // live auto-refresh) and restored after -- so flipping a checkbox never snaps the user
  // back out to fitContent(). Only the very first build (this stays null) fits all data.
  const savedRangeRef = useRef<{ from: UTCTimestamp; to: UTCTimestamp } | null>(null);

  const [showOtherIndex, setShowOtherIndex] = useState(true);
  const [showPrimaryIndex, setShowPrimaryIndex] = useState(true);
  const [showDivergence, setShowDivergence] = useState(true);
  const [chartStyle, setChartStyle] = useState<"candles" | "line">("candles");
  const [activeInterval, setActiveInterval] = useState(interval);
  const [loading, setLoading] = useState(false);

  const [liveCandles, setLiveCandles] = useState(candles);
  const [liveOtherCandles, setLiveOtherCandles] = useState(otherIndexCandles ?? []);
  const [liveDivergence, setLiveDivergence] = useState(divergenceEvents ?? []);
  const [liveSignal, setLiveSignal] = useState(signal);
  // What's actually being shown right now -- distinct from chartStartIso/chartEndIso
  // (the experiment's full validation+test span), since a finer timeframe narrows the
  // window. Always shown as a caption so "is this old data?" has a direct answer.
  const [shownRange, setShownRange] = useState<{ start: string; end: string } | null>(
    chartStartIso && chartEndIso ? { start: chartStartIso, end: chartEndIso } : null,
  );

  const isNativeInterval = activeInterval === interval;
  const hasOtherIndex = liveOtherCandles.length > 0 && !!otherIndexSymbol;
  const hasDivergence = liveDivergence.length > 0;

  // Shared by both the timeframe switcher and live auto-refresh: re-fetch both symbols
  // for [start, end] at `targetInterval`, recomputing divergence and the signal strip
  // at that resolution client-side -- a rule's "condition true" bars are timeframe-
  // specific, so showing them against the wrong-resolution candles would be wrong.
  const loadCandles = useCallback(async (targetInterval: string, start: Date, end: Date) => {
    const fetchOne = async (sym: string) => {
      const url = `/api/candles?symbol=${encodeURIComponent(sym)}&interval=${encodeURIComponent(targetInterval)}&source=${encodeURIComponent(source)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`;
      const res = await fetch(url);
      if (!res.ok) return [] as Candle[];
      const data = await res.json();
      return (data.candles ?? []) as Candle[];
    };

    const [newPrimary, newOther] = await Promise.all([
      fetchOne(symbol),
      otherIndexSymbol ? fetchOne(otherIndexSymbol) : Promise.resolve([] as Candle[]),
    ]);

    setLiveCandles(newPrimary);
    setLiveOtherCandles(newOther);
    setLiveDivergence(otherIndexSymbol && newOther.length > 0 ? detectDivergences(newPrimary, newOther) : []);

    const features = computeFeatureSeries(newPrimary, newOther);
    setLiveSignal(evaluateSignal(features, clauses));

    setActiveInterval(targetInterval);
    setShownRange({ start: start.toISOString(), end: end.toISOString() });
  }, [symbol, otherIndexSymbol, source, clauses]);

  // Timeframe switch: re-fetch both symbols at the new resolution. In liveMode there's
  // no fixed historical span to re-window (the welcome page's chart is always "recent
  // up to now"), so it just uses the same rolling-to-now window the auto-refresh does.
  // Otherwise, re-fetches over the experiment's own real-world date window. Trade
  // markers/price lines stay tied to the experiment's OWN native interval only --
  // they're real backtest fills, not something that exists "at" an arbitrary timeframe.
  const switchTimeframe = useCallback(async (newInterval: string) => {
    if (newInterval === activeInterval) return;
    if (!liveMode && (!chartStartIso || !chartEndIso)) return;
    setLoading(true);
    savedRangeRef.current = null; // a new resolution should land on "now," not wherever the old one was scrolled to
    try {
      const { start, end } = liveMode
        ? windowedRange(newInterval, new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), new Date())
        : windowedRange(newInterval, new Date(chartStartIso!), new Date(chartEndIso!));
      await loadCandles(newInterval, start, end);
    } finally {
      setLoading(false);
    }
  }, [activeInterval, chartStartIso, chartEndIso, liveMode, loadCandles]);

  // Live mode: re-fetch on an interval, always extending the window up to "now" --
  // for the welcome page's real-time chart, not tied to any one experiment's fixed
  // historical span. Silent (no loading spinner) so it doesn't flicker every refresh.
  useEffect(() => {
    if (!liveMode) return;
    const refresh = () => {
      const end = new Date();
      const { start } = windowedRange(activeInterval, new Date(end.getTime() - 60 * 24 * 60 * 60 * 1000), end);
      loadCandles(activeInterval, start, end);
    };
    refresh();
    const id = setInterval(refresh, liveRefreshSeconds * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveMode, activeInterval, loadCandles, liveRefreshSeconds]);

  // Hover-driven focus: dims whichever symbol's candles the mouse ISN'T over (or
  // isn't hovering the legend label for), applied imperatively via series refs --
  // deliberately NOT React state, so every mouse-move doesn't trigger a chart rebuild.
  //
  // Two real bugs fixed here after direct feedback:
  // 1. This used to run on EVERY crosshair-move event (i.e. every pixel the mouse
  //    crosses), calling .applyOptions() -- a real repaint -- dozens of times a second
  //    regardless of whether focus had actually changed. lastFocusRef skips the no-op
  //    calls, which was the dominant cause of the chart feeling heavy while hovering.
  // 2. Both series share one pane, and whichever was added SECOND always draws on top
  //    of the other regardless of opacity -- dimming the back series doesn't reveal the
  //    front one if the front one still paints fully opaque over it. setSeriesOrder()
  //    now brings the focused series to the front on each real focus change (cheap --
  //    just a draw-order index, not a series recreation) so dimming the other actually
  //    becomes visible instead of staying hidden underneath an opaque top layer.
  const lastFocusRef = useRef<"primary" | "other" | null | undefined>(undefined);
  const applyFocus = useCallback((focus: "primary" | "other" | null) => {
    if (focus === lastFocusRef.current) return;
    lastFocusRef.current = focus;

    const { good, bad, blue, teal } = colorsRef.current;
    const primaryOpacity = focus === "other" ? DIMMED_OPACITY : FOCUSED_OPACITY;
    const otherOpacity = focus === "primary" ? DIMMED_OPACITY : FOCUSED_OPACITY;
    if (chartStyle === "line") {
      primarySeriesRef.current?.applyOptions({ color: withAlpha(good, primaryOpacity) });
      otherSeriesRef.current?.applyOptions({ color: withAlpha(blue, otherOpacity) });
    } else {
      primarySeriesRef.current?.applyOptions({
        upColor: withAlpha(good, primaryOpacity), downColor: withAlpha(bad, primaryOpacity),
        wickUpColor: withAlpha(good, primaryOpacity), wickDownColor: withAlpha(bad, primaryOpacity),
      });
      otherSeriesRef.current?.applyOptions({
        upColor: withAlpha(blue, otherOpacity), downColor: withAlpha(teal, otherOpacity),
        wickUpColor: withAlpha(blue, otherOpacity), wickDownColor: withAlpha(teal, otherOpacity),
      });
    }

    if (focus === "primary") {
      primarySeriesRef.current?.setSeriesOrder(1);
      otherSeriesRef.current?.setSeriesOrder(0);
    } else if (focus === "other") {
      otherSeriesRef.current?.setSeriesOrder(1);
      primarySeriesRef.current?.setSeriesOrder(0);
    }
  }, [chartStyle]);

  useEffect(() => {
    if (!containerRef.current || liveCandles.length === 0) return;

    lastFocusRef.current = undefined; // new series instances below -- forget any prior hover state

    const good = resolveCssVar("var(--tl-status-good)", "#0ca30c");
    const bad = resolveCssVar("var(--tl-status-critical)", "#d03b3b");
    const gridline = resolveCssVar("var(--tl-gridline)", "#e1e0d9");
    const textMuted = resolveCssVar("var(--tl-text-muted)", "#898781");
    const amber = resolveCssVar(CHART_AMBER, "#c9a227");
    const blue = resolveCssVar(CHART_BLUE, "#3b82f6");
    const teal = resolveCssVar(CHART_TEAL, "#14b8a6");
    colorsRef.current = { good, bad, blue, teal };

    const showOther = hasOtherIndex && showOtherIndex;

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: textMuted },
      grid: { vertLines: { color: gridline }, horzLines: { color: gridline } },
      leftPriceScale: { visible: showOther },
      width: containerRef.current.clientWidth,
      height: 460,
      timeScale: { timeVisible: true, secondsVisible: false },
    });
    chartRef.current = chart;

    // Both series share PANE 1 so they visually overlap, each on its own price scale
    // (this symbol on the right, the paired index on the left) since their absolute
    // price levels aren't comparable -- only their shape/movement is. The signal strip
    // (added below) takes pane 0. chartStyle swaps the series TYPE (candles vs. a single
    // close-price line) but not this layout.
    let primarySeries: ISeriesApi<SeriesType> | null = null;
    if (showPrimaryIndex) {
      if (chartStyle === "line") {
        const s = chart.addSeries(LineSeries, { color: good, lineWidth: 2, priceScaleId: "right" }, 1);
        s.setData(liveCandles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
        primarySeries = s;
      } else {
        const s = chart.addSeries(
          CandlestickSeries,
          { upColor: good, downColor: bad, borderVisible: false, wickUpColor: good, wickDownColor: bad, priceScaleId: "right" },
          1,
        );
        s.setData(liveCandles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
        primarySeries = s;
      }
    }
    primarySeriesRef.current = primarySeries;

    let otherSeries: ISeriesApi<SeriesType> | null = null;
    if (showOther) {
      if (chartStyle === "line") {
        const s = chart.addSeries(LineSeries, { color: blue, lineWidth: 2, priceScaleId: "left" }, 1);
        s.setData(liveOtherCandles.map((c) => ({ time: c.time as UTCTimestamp, value: c.close })));
        otherSeries = s;
      } else {
        const s = chart.addSeries(
          CandlestickSeries,
          { upColor: blue, downColor: teal, borderVisible: false, wickUpColor: blue, wickDownColor: teal, priceScaleId: "left" },
          1,
        );
        s.setData(liveOtherCandles.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
        otherSeries = s;
      }
    }
    otherSeriesRef.current = otherSeries;

    // Trade markers + entry/stop/target price lines only make sense at the experiment's
    // own native interval -- a backtest fill doesn't "exist" at an arbitrary other
    // resolution the user switched to.
    if (primarySeries && isNativeInterval) {
      const tradeMarkers = trades.map((t) => ({
        time: Math.floor(new Date(t.entry_time).getTime() / 1000) as UTCTimestamp,
        position: (t.r_multiple > 0 ? "belowBar" : "aboveBar") as "belowBar" | "aboveBar",
        color: t.r_multiple > 0 ? good : bad,
        shape: (t.r_multiple > 0 ? "arrowUp" : "arrowDown") as "arrowUp" | "arrowDown",
        text: `${t.r_multiple > 0 ? "+" : ""}${t.r_multiple.toFixed(2)}R`,
      }));
      createSeriesMarkers(primarySeries, tradeMarkers.sort((a, b) => a.time - b.time));

      if (latestTradeLevels) {
        primarySeries.createPriceLine({ price: latestTradeLevels.entry, color: textMuted, lineWidth: 1, lineStyle: LineStyle.Dashed, title: "Entry" });
        primarySeries.createPriceLine({ price: latestTradeLevels.stop, color: bad, lineWidth: 1, lineStyle: LineStyle.Dashed, title: "Stop" });
        primarySeries.createPriceLine({ price: latestTradeLevels.target, color: good, lineWidth: 1, lineStyle: LineStyle.Dashed, title: "Target" });
      }
    }

    if (liveSignal && liveSignal.length === liveCandles.length) {
      const signalSeries = chart.addSeries(
        HistogramSeries,
        { color: amber, priceFormat: { type: "volume" }, baseLineVisible: false, priceLineVisible: false, lastValueVisible: false },
        0,
      );
      signalSeries.setData(
        liveCandles.map((c, i) => ({ time: c.time as UTCTimestamp, value: liveSignal![i] ? 1 : 0, color: liveSignal![i] ? amber : "transparent" }))
      );
    }

    // Translucent full-height band at every divergence bar -- a time-based highlight,
    // not tied to either series' price scale, so it's a pane primitive, not a series one.
    if (showDivergence && hasDivergence) {
      const barSeconds = liveCandles.length > 1 ? liveCandles[1].time - liveCandles[0].time : 60;
      const primitive = new DivergenceBandPrimitive(
        chart,
        () => liveDivergence.map((e) => e.time),
        () => withAlpha(amber, 0.16),
        () => {
          // Approximate a bar's pixel width from the visible time range and bar count.
          const visible = chart.timeScale().getVisibleRange();
          if (!visible || liveCandles.length < 2) return 6;
          const x0 = chart.timeScale().timeToCoordinate(visible.from as UTCTimestamp);
          const x1 = chart.timeScale().timeToCoordinate(visible.to as UTCTimestamp);
          const visibleBars = Math.max(1, Math.round((Number(visible.to) - Number(visible.from)) / barSeconds));
          return x0 !== null && x1 !== null ? Math.max(2, (x1 - x0) / visibleBars) : 6;
        },
      );
      chart.panes()[1]?.attachPrimitive(primitive);
    }

    const panes = chart.panes();
    if (panes.length >= 2) {
      panes[0].setStretchFactor(0.15);
      panes[1].setStretchFactor(0.85);
    }

    // Crosshair-based hover: dims whichever symbol's candles the cursor is actually
    // close to (within HOVER_PROXIMITY_PX). Hovering empty space between the two --
    // "in the direction of" the chart but not touching either series -- keeps both at
    // full opacity instead of always force-picking whichever is numerically nearer.
    const seriesValueY = (series: ISeriesApi<SeriesType> | null, data: unknown): number | null => {
      if (!series || !data || typeof data !== "object") return null;
      if ("close" in data) return series.priceToCoordinate((data as { close: number }).close);
      if ("value" in data) return series.priceToCoordinate((data as { value: number }).value);
      return null;
    };
    const handleCrosshairMove = (param: Parameters<Parameters<IChartApi["subscribeCrosshairMove"]>[0]>[0]) => {
      if (!param.point) { applyFocus(null); return; }
      const primaryData = primarySeries ? param.seriesData.get(primarySeries) : undefined;
      const otherData = otherSeries ? param.seriesData.get(otherSeries) : undefined;
      let primaryDist = Infinity;
      let otherDist = Infinity;
      const primaryY = seriesValueY(primarySeries, primaryData);
      if (primaryY !== null) primaryDist = Math.abs(primaryY - param.point.y);
      const otherY = seriesValueY(otherSeries, otherData);
      if (otherY !== null) otherDist = Math.abs(otherY - param.point.y);
      const minDist = Math.min(primaryDist, otherDist);
      if (minDist === Infinity || minDist > HOVER_PROXIMITY_PX) { applyFocus(null); return; }
      applyFocus(primaryDist <= otherDist ? "primary" : "other");
    };
    if (showOther) chart.subscribeCrosshairMove(handleCrosshairMove);

    // Preserve whatever the user was looking at across a toggle/style change or a
    // silent live auto-refresh (savedRangeRef set in the cleanup below). On a true first
    // mount there's nothing saved yet -- in liveMode, default to "the present" (the most
    // recent bars) rather than fitContent's zoomed-out view of the whole fetched window;
    // a timeframe switch clears savedRangeRef up front for the same reason (see
    // switchTimeframe) so picking a new resolution also lands on "now," not wherever the
    // old resolution happened to be scrolled to.
    if (savedRangeRef.current) {
      chart.timeScale().setVisibleRange(savedRangeRef.current);
    } else if (liveMode && liveCandles.length > PRESENT_WINDOW_BARS) {
      const from = liveCandles[liveCandles.length - PRESENT_WINDOW_BARS].time as UTCTimestamp;
      const to = liveCandles[liveCandles.length - 1].time as UTCTimestamp;
      chart.timeScale().setVisibleRange({ from, to });
    } else {
      chart.timeScale().fitContent();
    }

    const handleResize = () => {
      if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      if (showOther) chart.unsubscribeCrosshairMove(handleCrosshairMove);
      const visible = chart.timeScale().getVisibleRange();
      if (visible) savedRangeRef.current = visible as { from: UTCTimestamp; to: UTCTimestamp };
      chart.remove();
    };
  }, [
    liveCandles, liveOtherCandles, liveSignal, liveDivergence, trades, latestTradeLevels, symbol, otherIndexSymbol,
    hasOtherIndex, showOtherIndex, showPrimaryIndex, showDivergence, hasDivergence, isNativeInterval, applyFocus,
    chartStyle, liveMode,
  ]);

  if (liveCandles.length === 0) {
    return (
      <div className="text-sm" style={{ color: TEXT_MUTED }}>
        {liveMode ? "Loading live candles..." : "No candle data available for this pattern's date range."}
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-4 text-xs" style={{ color: TEXT_SECONDARY }}>
          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            onMouseEnter={() => applyFocus("primary")}
            onMouseLeave={() => applyFocus(null)}
          >
            <input type="checkbox" checked={showPrimaryIndex} onChange={(e) => setShowPrimaryIndex(e.target.checked)} />
            <span className="inline-flex gap-0.5" aria-hidden title="Up / down candle color for this symbol">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--tl-status-good)" }} />
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--tl-status-critical)" }} />
            </span>
            {symbol} candles
          </label>
          {hasOtherIndex && (
            <label
              className="flex items-center gap-1.5 cursor-pointer select-none"
              onMouseEnter={() => applyFocus("other")}
              onMouseLeave={() => applyFocus(null)}
            >
              <input type="checkbox" checked={showOtherIndex} onChange={(e) => setShowOtherIndex(e.target.checked)} />
              <span className="inline-flex gap-0.5" aria-hidden title="Up / down candle color for this symbol">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--tl-chart-blue)" }} />
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "var(--tl-chart-teal)" }} />
              </span>
              {otherIndexSymbol} candles ({otherIndexSymbol === "QQQ" ? "Nasdaq 100" : "S&P 500"})
            </label>
          )}
          {hasDivergence && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none" title="One index broke a recent swing high/low and the other didn't confirm it around the same time">
              <input type="checkbox" checked={showDivergence} onChange={(e) => setShowDivergence(e.target.checked)} />
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: "var(--tl-chart-amber)" }} />
              Structure divergence ({liveDivergence.length})
            </label>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs" style={{ color: TEXT_SECONDARY }}>
          <div className="flex items-center gap-1">
            {(["candles", "line"] as const).map((style) => (
              <button
                key={style}
                onClick={() => setChartStyle(style)}
                className="rounded-md px-2 py-1 transition-colors capitalize"
                style={
                  chartStyle === style
                    ? { backgroundColor: ACCENT, color: "#0b0b0b", fontWeight: 600 }
                    : { backgroundColor: SURFACE, border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }
                }
              >
                {style}
              </button>
            ))}
          </div>

        {(liveMode || (chartStartIso && chartEndIso)) && (
          <div className="flex items-center gap-1" style={{ color: TEXT_SECONDARY }}>
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.interval}
                onClick={() => switchTimeframe(tf.interval)}
                disabled={loading}
                className="rounded-md px-2 py-1 transition-colors disabled:opacity-50"
                style={
                  activeInterval === tf.interval
                    ? { backgroundColor: ACCENT, color: "#0b0b0b", fontWeight: 600 }
                    : { backgroundColor: SURFACE, border: `1px solid ${BORDER}`, color: TEXT_PRIMARY }
                }
              >
                {tf.label}
              </button>
            ))}
            {loading && <span style={{ color: TEXT_MUTED }}>loading...</span>}
          </div>
        )}
        </div>
      </div>
      {shownRange && (
        <p className="text-xs mb-2" style={{ color: TEXT_MUTED }}>
          {liveMode && (
            <span className="inline-flex items-center gap-1.5 mr-2">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: "var(--tl-status-good)" }} />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "var(--tl-status-good)" }} />
              </span>
              Live, updating every {liveRefreshSeconds}s
            </span>
          )}
          Showing {new Date(shownRange.start).toLocaleDateString()} &rarr; {new Date(shownRange.end).toLocaleDateString()}
          {!liveMode && (isNativeInterval ? " (full study window)" : ` (recent window at ${TIMEFRAMES.find((t) => t.interval === activeInterval)?.label ?? activeInterval} resolution)`)}
        </p>
      )}
      <div ref={containerRef} className="w-full" />
    </div>
  );
}
