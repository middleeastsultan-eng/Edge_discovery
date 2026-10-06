import { NextResponse } from "next/server";
import { getCandles } from "@/lib/candles";

// Lets the chart's timeframe selector re-fetch candles client-side without a full page
// reload -- getCandles() itself is server-only (Alpaca/Coinbase credentials), so a
// client component can't call it directly; this is the thin server boundary for it.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval");
  const source = searchParams.get("source");
  const start = searchParams.get("start");
  const end = searchParams.get("end");

  if (!symbol || !interval || !source || !start || !end) {
    return NextResponse.json({ error: "symbol, interval, source, start, end are all required" }, { status: 400 });
  }

  const candles = await getCandles(symbol, interval, source, new Date(start), new Date(end));
  return NextResponse.json({ candles });
}
