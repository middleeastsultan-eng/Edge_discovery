import "server-only";

// Historical OHLC candles for the pattern chart, mirroring trading_lab/data.py's
// Coinbase fetch and trading_lab/data_stocks.py's Alpaca fetch in TypeScript -- kept
// separate rather than bridging to Python, since this is a simple, fixed-date-range,
// read-only historical fetch with no need to touch the research/live pipeline at all.

export type Candle = { time: number; open: number; high: number; low: number; close: number };

const SYMBOL_TO_COINBASE_PRODUCT: Record<string, string> = { BTCUSDT: "BTC-USD", ETHUSDT: "ETH-USD" };

// Coinbase's native granularities, in seconds. 30m and 4h aren't offered directly --
// resampled from 15m/1h, same as the Python side.
const COINBASE_NATIVE_SECONDS: Record<string, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400 };
const COINBASE_RESAMPLE_FROM: Record<string, { native: string; bucketSeconds: number }> = {
  "30m": { native: "15m", bucketSeconds: 1800 },
  "4h": { native: "1h", bucketSeconds: 14400 },
};
const COINBASE_MAX_CANDLES_PER_REQUEST = 299;

async function fetchCoinbasePage(productId: string, granularitySeconds: number, start: Date, end: Date): Promise<number[][]> {
  const url = new URL(`https://api.exchange.coinbase.com/products/${productId}/candles`);
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  url.searchParams.set("granularity", String(granularitySeconds));
  // Cached for 30 days: this is a fixed historical start/end window, so the exact same
  // URL (the cache key) only ever describes data that already happened and never
  // changes -- without this, every page view re-fetches years of candles from scratch
  // (confirmed during testing: ~36s for one experiment's chart on a cold cache).
  const res = await fetch(url, {
    headers: { "User-Agent": "EdgeDiscovery/1.0 (dashboard chart)" },
    next: { revalidate: 2592000 },
  });
  if (!res.ok) return [];
  return res.json();
}

async function fetchCoinbaseNative(symbol: string, interval: string, start: Date, end: Date): Promise<Candle[]> {
  const productId = SYMBOL_TO_COINBASE_PRODUCT[symbol] ?? symbol;
  const granularitySeconds = COINBASE_NATIVE_SECONDS[interval];
  const windowMs = granularitySeconds * COINBASE_MAX_CANDLES_PER_REQUEST * 1000;

  const rows: number[][] = [];
  let cursor = start.getTime();
  const endMs = end.getTime();
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + windowMs, endMs);
    const page = await fetchCoinbasePage(productId, granularitySeconds, new Date(cursor), new Date(chunkEnd));
    rows.push(...page);
    cursor = chunkEnd;
    await new Promise((r) => setTimeout(r, 200)); // stay well under Coinbase's public rate limit
  }

  // Coinbase candle row shape: [time, low, high, open, close, volume]
  const candles = rows.map((r) => ({ time: r[0], low: r[1], high: r[2], open: r[3], close: r[4] }));
  candles.sort((a, b) => a.time - b.time);
  return candles;
}

function resampleCandles(candles: Candle[], bucketSeconds: number): Candle[] {
  const buckets = new Map<number, Candle[]>();
  for (const c of candles) {
    const bucketTime = Math.floor(c.time / bucketSeconds) * bucketSeconds;
    const list = buckets.get(bucketTime) ?? [];
    list.push(c);
    buckets.set(bucketTime, list);
  }
  return Array.from(buckets.entries())
    .map(([time, group]) => ({
      time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
    }))
    .sort((a, b) => a.time - b.time);
}

async function fetchCoinbaseCandles(symbol: string, interval: string, start: Date, end: Date): Promise<Candle[]> {
  const resample = COINBASE_RESAMPLE_FROM[interval];
  if (resample) {
    const native = await fetchCoinbaseNative(symbol, resample.native, start, end);
    return resampleCandles(native, resample.bucketSeconds);
  }
  return fetchCoinbaseNative(symbol, interval, start, end);
}

// Alpaca timeframe strings ("15Min", "1Hour", "1Day" etc.) are already native to its
// API -- no resampling needed, unlike Coinbase.
async function fetchAlpacaCandles(symbol: string, interval: string, start: Date, end: Date): Promise<Candle[]> {
  const apiKey = process.env.ALPACA_API_KEY;
  const apiSecret = process.env.ALPACA_API_SECRET;
  if (!apiKey || !apiSecret) return [];

  const rows: Candle[] = [];
  let pageToken: string | undefined;
  do {
    const url = new URL(`https://data.alpaca.markets/v2/stocks/${symbol}/bars`);
    url.searchParams.set("timeframe", interval);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("limit", "10000");
    url.searchParams.set("feed", "iex");
    url.searchParams.set("adjustment", "all");
    if (pageToken) url.searchParams.set("page_token", pageToken);

    const res = await fetch(url, {
      headers: { "APCA-API-KEY-ID": apiKey, "APCA-API-SECRET-KEY": apiSecret },
      next: { revalidate: 2592000 }, // same fixed-historical-range reasoning as the Coinbase path
    });
    if (!res.ok) break;
    const data = await res.json();
    for (const bar of data.bars ?? []) {
      rows.push({ time: Math.floor(new Date(bar.t).getTime() / 1000), open: bar.o, high: bar.h, low: bar.l, close: bar.c });
    }
    pageToken = data.next_page_token;
  } while (pageToken);

  rows.sort((a, b) => a.time - b.time);
  return rows;
}

/** Historical candles for symbol/interval between start and end (inclusive), sourced
 * from Coinbase (crypto) or Alpaca (stocks) depending on `source`. Cached per the
 * Next.js fetch cache -- a historical range that already happened never changes.
 */
export async function getCandles(symbol: string, interval: string, source: string, start: Date, end: Date): Promise<Candle[]> {
  return source === "stocks"
    ? fetchAlpacaCandles(symbol, interval, start, end)
    : fetchCoinbaseCandles(symbol, interval, start, end);
}
