"""Historical OHLCV data fetch from Binance public REST API, cached to Parquet."""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import requests

BINANCE_KLINES_URL = "https://api.binance.com/api/v3/klines"
CACHE_DIR = Path(__file__).parent / "data_cache"

COLUMNS = [
    "open_time", "open", "high", "low", "close", "volume",
    "close_time", "quote_volume", "trades",
    "taker_buy_base", "taker_buy_quote", "ignore",
]


def _fetch_page(symbol: str, interval: str, start_ms: int, end_ms: int, limit: int = 1000) -> list:
    params = {
        "symbol": symbol,
        "interval": interval,
        "startTime": start_ms,
        "endTime": end_ms,
        "limit": limit,
    }
    resp = requests.get(BINANCE_KLINES_URL, params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_klines(symbol: str, interval: str, start: str, end: str) -> pd.DataFrame:
    """Fetch historical candles between start and end (inclusive), paginating as needed.

    symbol: e.g. "BTCUSDT"
    interval: e.g. "15m", "1h", "4h", "1d"
    start/end: ISO date strings, e.g. "2018-01-01"
    """
    start_ms = int(pd.Timestamp(start, tz="UTC").timestamp() * 1000)
    end_ms = int(pd.Timestamp(end, tz="UTC").timestamp() * 1000)

    rows = []
    cursor = start_ms
    while cursor < end_ms:
        page = _fetch_page(symbol, interval, cursor, end_ms)
        if not page:
            break
        rows.extend(page)
        last_open_time = page[-1][0]
        if last_open_time <= cursor:
            break
        cursor = last_open_time + 1
        if len(page) < 1000:
            break
        time.sleep(0.25)  # stay well under Binance's public rate limit

    if not rows:
        return pd.DataFrame(columns=COLUMNS)

    df = pd.DataFrame(rows, columns=COLUMNS)
    for col in ("open", "high", "low", "close", "volume", "quote_volume", "taker_buy_base", "taker_buy_quote"):
        df[col] = df[col].astype(float)
    df["open_time"] = pd.to_datetime(df["open_time"], unit="ms", utc=True)
    df["close_time"] = pd.to_datetime(df["close_time"], unit="ms", utc=True)
    df = df.set_index("open_time").sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df[["open", "high", "low", "close", "volume", "trades"]]


def get_candles(symbol: str, interval: str, start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Load candles from local Parquet cache, fetching from Binance if missing or refresh=True."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{symbol}_{interval}_{start}_{end}.parquet"

    if cache_path.exists() and not refresh:
        return pd.read_parquet(cache_path)

    df = fetch_klines(symbol, interval, start, end)
    df.to_parquet(cache_path)
    return df
