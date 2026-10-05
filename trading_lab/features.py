"""Feature engineering: turns raw OHLCV into the indicators hypotheses are built from.

Every feature here is computed using only past/current bar data (no look-ahead).
"""

from __future__ import annotations

import numpy as np
import pandas as pd


def _rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50)


def _atr(df: pd.DataFrame, period: int = 14) -> pd.Series:
    high, low, close = df["high"], df["low"], df["close"]
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1 / period, adjust=False).mean()


def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """Given OHLCV with a DatetimeIndex, return df with added feature columns."""
    out = df.copy()

    out["ema_50"] = out["close"].ewm(span=50, adjust=False).mean()
    out["ema_200"] = out["close"].ewm(span=200, adjust=False).mean()
    out["price_vs_ema200"] = (out["close"] - out["ema_200"]) / out["ema_200"]

    out["rsi_14"] = _rsi(out["close"], 14)

    out["atr_14"] = _atr(out, 14)
    out["atr_pct"] = out["atr_14"] / out["close"]

    returns = out["close"].pct_change()
    out["volatility_20"] = returns.rolling(20).std()
    out["volatility_pctile"] = out["volatility_20"].rolling(500, min_periods=50).rank(pct=True)

    out["volume_ratio_20"] = out["volume"] / out["volume"].rolling(20).mean()

    out["return_5"] = out["close"].pct_change(5)
    out["return_20"] = out["close"].pct_change(20)

    out["hour"] = out.index.hour
    out["dow"] = out.index.dayofweek

    return out.dropna()
