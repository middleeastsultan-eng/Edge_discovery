"""Feature engineering: turns raw OHLCV into the indicators hypotheses are built from.

Every feature here is computed using only past/current bar data (no look-ahead).
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .cross_asset import compute_divergence_features


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


def build_features(df: pd.DataFrame, other_df: pd.DataFrame | None = None) -> pd.DataFrame:
    """Given OHLCV with a DatetimeIndex, return df with added feature columns.

    other_df, if given, is the OHLCV of this platform's OTHER tracked index (QQQ's
    other_df is SPY's and vice versa, at the same symbol/interval/date range) -- used
    only for the cross-asset structure-divergence features (see cross_asset.py). When
    not given, those two columns are filled 0.0 (no known divergence) rather than NaN,
    so a caller that doesn't have a paired index's data doesn't lose every row to the
    dropna() below.
    """
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

    # NY local time, not raw UTC -- otherwise "hour" silently shifts by 1 across DST
    # transitions and session-time patterns (e.g. NY open/close) become unreliable.
    ny_index = out.index.tz_convert("America/New_York")
    out["hour"] = ny_index.hour
    out["dow"] = ny_index.dayofweek

    if other_df is not None:
        common_idx = out.index.intersection(other_df.index)
        divergence = compute_divergence_features(out.loc[common_idx], other_df.loc[common_idx])
        out = out.join(divergence)
        out[["bos_divergence_bullish", "bos_divergence_bearish"]] = (
            out[["bos_divergence_bullish", "bos_divergence_bearish"]].fillna(0.0)
        )
    else:
        out["bos_divergence_bullish"] = 0.0
        out["bos_divergence_bearish"] = 0.0

    return out.dropna()
