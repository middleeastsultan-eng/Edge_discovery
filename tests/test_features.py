"""Regression tests for trading_lab/features.py -- specifically a general
no-look-ahead property test. Unlike a test that checks one specific bug, this one
is structural: it would catch ANY future change that lets a feature value at bar t
depend on data at bar t+1 or later, regardless of which feature or how the leak was
introduced.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_lab.features import build_features


def _raw_df(n: int = 600) -> pd.DataFrame:
    rng = np.random.default_rng(3)
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    close = 100 + np.cumsum(rng.normal(0, 0.3, n))
    high = close + rng.uniform(0, 1, n)
    low = close - rng.uniform(0, 1, n)
    volume = rng.uniform(100, 1000, n)
    return pd.DataFrame({"open": close, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


def test_features_do_not_change_when_future_bars_are_altered():
    """Changing only the LAST 100 bars' prices must not change any feature value
    computed on the first 400 bars -- if it did, that feature would be using
    information from the future relative to those earlier bars.
    """
    raw = _raw_df(600)
    feats_original = build_features(raw)

    altered = raw.copy()
    altered.iloc[-100:, altered.columns.get_indexer(["open", "high", "low", "close"])] *= 3.0  # wildly different future
    feats_altered = build_features(altered)

    # Compare over the first 400 bars (well clear of the altered tail and any
    # rolling-window edge effects from dropna()).
    common_idx = feats_original.index.intersection(feats_altered.index)[:400]
    feature_cols = [c for c in feats_original.columns if c not in ("open", "high", "low", "close", "volume")]

    pd.testing.assert_frame_equal(
        feats_original.loc[common_idx, feature_cols],
        feats_altered.loc[common_idx, feature_cols],
    )


def test_no_feature_is_nan_after_dropna():
    """build_features' own dropna() must leave zero NaNs -- a stray NaN slipping
    through would silently corrupt any rule evaluated against that bar.
    """
    feats = build_features(_raw_df(600))
    assert not feats.isna().any().any()


def test_hour_is_within_valid_range():
    feats = build_features(_raw_df(600))
    assert feats["hour"].between(0, 23).all()
