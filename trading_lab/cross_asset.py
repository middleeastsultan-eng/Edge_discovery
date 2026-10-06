"""Cross-asset structure divergence: does one tracked index (QQQ/SPY) break a recent
swing high/low while the other doesn't confirm it around the same time? A pro trader's
observation is that this tends to precede a strong directional run. Same swing-pivot /
break-of-structure logic as the web chart's visual markers (web/src/lib/structure.ts),
but strictly backward-looking here: a tradeable feature can only use what's already
happened by the current bar, never what the other index does in bars that haven't
closed yet. The chart's visual version deliberately looks both ways in time since it's
retrospective analysis of "where did this happen," not something a live signal could
actually act on -- this module is the feature-engineering version of that same idea.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# QQQ (Nasdaq 100 proxy) and SPY (S&P 500 proxy) are the only two symbols this
# platform tracks -- each one's "paired index" for cross-asset features is just
# the other.
PAIRED_INDEX = {"QQQ": "SPY", "SPY": "QQQ"}


def _find_swing_points(df: pd.DataFrame, lookback: int = 5) -> pd.Series:
    """Returns a Series indexed like df, with 'high'/'low'/None per bar -- a bar is a
    confirmed swing point if its high/low is the most extreme within `lookback` bars
    on both sides (the standard fractal-pivot definition).
    """
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    n = len(df)
    kind = np.full(n, None, dtype=object)
    for i in range(lookback, n - lookback):
        if high[i] >= high[i - lookback: i + lookback + 1].max():
            kind[i] = "high"
        if low[i] <= low[i - lookback: i + lookback + 1].min():
            kind[i] = "low" if kind[i] is None else kind[i]
    return pd.Series(kind, index=df.index)


def _breaks_of_structure(df: pd.DataFrame, lookback: int = 5) -> pd.DataFrame:
    """Boolean 'bull_bos'/'bear_bos' columns, indexed like df -- True on the bar a
    close breaks the most recent confirmed swing high/low. Suppresses re-firing on
    every subsequent bar of a sustained trend: a break only fires again once a
    genuinely new pivot confirms and becomes the reference (same fix applied to
    structure.ts's TypeScript version after it was found to over-fire ~39x on one
    real breakout before this guard existed).
    """
    swings = _find_swing_points(df, lookback)
    close = df["close"].to_numpy()
    high = df["high"].to_numpy()
    low = df["low"].to_numpy()
    n = len(df)

    bull = np.zeros(n, dtype=bool)
    bear = np.zeros(n, dtype=bool)
    ref_high: float | None = None
    ref_low: float | None = None
    broke_high = False
    broke_low = False

    for i in range(lookback, n):
        confirmable_idx = i - lookback
        kind = swings.iloc[confirmable_idx]
        if kind == "high" and (ref_high is None or high[confirmable_idx] > ref_high):
            ref_high = high[confirmable_idx]
            broke_high = False
        if kind == "low" and (ref_low is None or low[confirmable_idx] < ref_low):
            ref_low = low[confirmable_idx]
            broke_low = False

        if ref_high is not None and close[i] > ref_high and not broke_high:
            bull[i] = True
            broke_high = True
        if ref_low is not None and close[i] < ref_low and not broke_low:
            bear[i] = True
            broke_low = True

    return pd.DataFrame({"bull_bos": bull, "bear_bos": bear}, index=df.index)


def compute_divergence_features(
    df: pd.DataFrame, other_df: pd.DataFrame, lookback: int = 5, window: int = 5,
) -> pd.DataFrame:
    """Backward-looking only: at bar t, 1.0 if THIS symbol had a break of structure
    within the last `window` bars that the OTHER symbol did NOT also have in that same
    window -- never looks at what the other symbol does after bar t, so it's safe to
    use as a feature a live signal could actually act on in real time.

    `other_df` must already share df's index (same bar timestamps) -- the caller
    (build_features) is responsible for aligning them first.
    """
    this_bos = _breaks_of_structure(df, lookback)
    other_bos = _breaks_of_structure(other_df, lookback)

    this_bull_recent = this_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    this_bear_recent = this_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)
    other_bull_recent = other_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    other_bear_recent = other_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)

    return pd.DataFrame(
        {
            "bos_divergence_bullish": (this_bull_recent & ~other_bull_recent).astype(float),
            "bos_divergence_bearish": (this_bear_recent & ~other_bear_recent).astype(float),
        },
        index=df.index,
    )
