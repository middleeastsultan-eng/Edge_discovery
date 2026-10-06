"""Historical OHLCV data fetch from Coinbase's public Exchange API, cached to Parquet.

Was Binance -- switched because api.binance.com returns HTTP 451 (geo-blocked) for
requests from US-based infrastructure, and GitHub Actions' hosted runners always run in
US Azure datacenters. Confirmed directly: a real research.yml run failed with exactly
that 451 for BTCUSDT/ETHUSDT while the Alpaca-sourced (SPY/QQQ) jobs in the same run
succeeded. Coinbase is US-domiciled and doesn't block this.

Also confirmed directly (not assumed) before building this: Kraken's public OHLC
endpoint -- the other obvious candidate -- silently ignores how far back `since` is and
always returns only the most recent ~720 candles, making it unusable for the multi-year
history discovery needs. Coinbase's candles endpoint genuinely supports historical date
ranges, verified by fetching real January 2019 data.

symbol/interval/start/end keep the exact same meaning as before (e.g. "BTCUSDT", "1h",
"2019-01-01") -- translated to Coinbase's product id and granularity internally, so
nothing else in the codebase needs to know the data source changed.
"""

from __future__ import annotations

import time
from pathlib import Path

import pandas as pd
import requests

COINBASE_CANDLES_URL = "https://api.exchange.coinbase.com/products/{product_id}/candles"
CACHE_DIR = Path(__file__).parent / "data_cache"

_SYMBOL_TO_PRODUCT = {"BTCUSDT": "BTC-USD", "ETHUSDT": "ETH-USD"}

# Coinbase's native granularities, in seconds. 30m and 4h aren't offered directly --
# those are built by resampling the next-finer native interval (_RESAMPLE_FROM).
_NATIVE_GRANULARITY_SECONDS = {"1m": 60, "5m": 300, "15m": 900, "1h": 3600, "1d": 86400}
_RESAMPLE_FROM = {"30m": ("15m", "30min"), "4h": ("1h", "4h")}

# Coinbase hard-errors ("Count of aggregations requested exceeds 300") past 300 periods
# per request, confirmed directly -- not a silent truncation, so this must stay exact.
_MAX_CANDLES_PER_REQUEST = 299

COLUMNS = ["open", "high", "low", "close", "volume", "trades"]


def _fetch_page(product_id: str, granularity_s: int, start: pd.Timestamp, end: pd.Timestamp) -> list:
    resp = requests.get(
        COINBASE_CANDLES_URL.format(product_id=product_id),
        params={"start": start.isoformat(), "end": end.isoformat(), "granularity": granularity_s},
        headers={"User-Agent": "EdgeDiscovery/1.0 (research tool)"},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()


def _resample_ohlcv(df: pd.DataFrame, rule: str) -> pd.DataFrame:
    agg = df.resample(rule).agg({
        "open": "first", "high": "max", "low": "min", "close": "last",
        "volume": "sum", "trades": "sum",
    })
    return agg.dropna(subset=["open"])


def _fetch_native(symbol: str, interval: str, start: str, end: str) -> pd.DataFrame:
    product_id = _SYMBOL_TO_PRODUCT.get(symbol, symbol)
    granularity_s = _NATIVE_GRANULARITY_SECONDS[interval]
    start_ts = pd.Timestamp(start, tz="UTC")
    end_ts = pd.Timestamp(end, tz="UTC")

    window = pd.Timedelta(seconds=granularity_s * _MAX_CANDLES_PER_REQUEST)
    rows = []
    cursor = start_ts
    while cursor < end_ts:
        chunk_end = min(cursor + window, end_ts)
        page = _fetch_page(product_id, granularity_s, cursor, chunk_end)
        rows.extend(page)
        cursor = chunk_end
        time.sleep(0.2)  # stay well under Coinbase's public rate limit (10 req/s)

    if not rows:
        return pd.DataFrame(columns=["open_time", *COLUMNS]).set_index("open_time")

    # Coinbase candle row shape: [time, low, high, open, close, volume] -- note the
    # low/high-before-open/close order, different from Binance's open-first layout.
    df = pd.DataFrame(rows, columns=["open_time", "low", "high", "open", "close", "volume"])
    df["trades"] = 0  # not provided by this endpoint; unused by build_features/discovery
    df["open_time"] = pd.to_datetime(df["open_time"], unit="s", utc=True)
    df = df.set_index("open_time").sort_index()
    df = df[~df.index.duplicated(keep="first")]
    return df[COLUMNS]


def fetch_klines(symbol: str, interval: str, start: str, end: str) -> pd.DataFrame:
    """Fetch historical candles between start and end (inclusive), paginating as needed.

    symbol: e.g. "BTCUSDT"
    interval: e.g. "15m", "1h", "4h", "1d"
    start/end: ISO date strings, e.g. "2018-01-01"
    """
    if interval in _RESAMPLE_FROM:
        native_interval, rule = _RESAMPLE_FROM[interval]
        native = _fetch_native(symbol, native_interval, start, end)
        return _resample_ohlcv(native, rule) if len(native) else native
    return _fetch_native(symbol, interval, start, end)


def get_candles(symbol: str, interval: str, start: str, end: str, refresh: bool = False) -> pd.DataFrame:
    """Load candles from local Parquet cache, fetching from Coinbase if missing or refresh=True."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cache_path = CACHE_DIR / f"{symbol}_{interval}_{start}_{end}.parquet"

    if cache_path.exists() and not refresh:
        return pd.read_parquet(cache_path)

    df = fetch_klines(symbol, interval, start, end)
    df.to_parquet(cache_path)
    return df
