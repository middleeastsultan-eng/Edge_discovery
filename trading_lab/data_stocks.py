"""Historical stock/ETF bars from Alpaca's Market Data API, cached to Parquet.

Used for SPY/QQQ (the free-tier-accessible proxies for SPX/NDX) since Binance only
has crypto. Same output schema as trading_lab.data.get_candles() so the rest of the
pipeline (features, backtest, discovery, validate) doesn't care which source it came from.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd
import requests

from .config import ALPACA_API_KEY, ALPACA_API_SECRET

ALPACA_DATA_URL = "https://data.alpaca.markets/v2/stocks"
CACHE_DIR = Path(__file__).parent / "data_cache"


def _headers() -> dict:
    if not ALPACA_API_KEY or not ALPACA_API_SECRET:
        raise RuntimeError("ALPACA_API_KEY and ALPACA_API_SECRET must be set in .env")
    return {"APCA-API-KEY-ID": ALPACA_API_KEY, "APCA-API-SECRET-KEY": ALPACA_API_SECRET}


def fetch_bars(symbol: str, timeframe: str, start: str, end: str, feed: str = "iex") -> pd.DataFrame:
    """Fetch historical bars, paginating through Alpaca's page_token cursor.

    symbol: e.g. "SPY", "QQQ"
    timeframe: Alpaca format, e.g. "15Min", "1Hour", "1Day"
    start/end: ISO date strings, e.g. "2018-01-01"
    feed: "iex" (free tier) or "sip" (paid, consolidated)
    """
    url = f"{ALPACA_DATA_URL}/{symbol}/bars"
    params = {
        "timeframe": timeframe,
        "start": pd.Timestamp(start, tz="UTC").isoformat(),
        "end": pd.Timestamp(end, tz="UTC").isoformat(),
        "limit": 10000,
        "feed": feed,
        "adjustment": "all",
    }

    rows = []
    page_token = None
    while True:
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(url, headers=_headers(), params=params, timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        bars = payload.get("bars") or []
        rows.extend(bars)
        page_token = payload.get("next_page_token")
        if not page_token:
            break

    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume", "trades"])

    df = pd.DataFrame(rows)
    df["t"] = pd.to_datetime(df["t"], utc=True)
    df = df.set_index("t").sort_index()
    df = df[~df.index.duplicated(keep="first")]
    df = df.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume", "n": "trades"})
    return df[["open", "high", "low", "close", "volume", "trades"]]


def get_stock_candles(symbol: str, timeframe: str, start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Load bars from local Parquet cache, fetching from Alpaca if missing or refresh=True."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"alpaca_{symbol}_{timeframe}_{start}_{end}.parquet"

    if cache_path.exists() and not refresh:
        return pd.read_parquet(cache_path)

    df = fetch_bars(symbol, timeframe, start, end)
    df.to_parquet(cache_path)
    return df
