"""Regression tests for trading_lab/cross_asset.py -- the QQQ/SPY structure-divergence
feature. The no-look-ahead property here matters more than usual: unlike the chart's
visual version (web/src/lib/structure.ts), which deliberately looks both forward and
backward in time to show "where did this retrospectively happen," this module feeds a
feature a live signal could actually fire on -- any look-ahead here would be a feature
no real trade could ever have used.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_lab.cross_asset import compute_divergence_features, detect_latest_divergence


def _flat_df(n: int, price: float = 100.0, freq: str = "1h") -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=n, freq=freq, tz="UTC")
    return pd.DataFrame(
        {"open": price, "high": price + 0.1, "low": price - 0.1, "close": price, "volume": 1000.0}, index=idx,
    )


def _breakout_df(n: int, breakout_at: int, freq: str = "1h") -> pd.DataFrame:
    """Chops in a tight range, then breaks out hard upward at `breakout_at`."""
    idx = pd.date_range("2024-01-01", periods=n, freq=freq, tz="UTC")
    close = np.array([100 + np.sin(i) * 0.3 if i < breakout_at else 100 + (i - breakout_at) * 0.5 for i in range(n)])
    return pd.DataFrame(
        {"open": close, "high": close + 0.1, "low": close - 0.1, "close": close, "volume": 1000.0}, index=idx,
    )


def test_identical_series_never_diverge():
    df = _breakout_df(100, breakout_at=60)
    features = compute_divergence_features(df, df.copy())
    assert (features["bos_divergence_bullish"] == 0).all()
    assert (features["bos_divergence_bearish"] == 0).all()


def test_one_symbol_breaking_without_the_other_is_flagged():
    this_df = _breakout_df(100, breakout_at=60)
    other_df = _flat_df(100)  # never breaks out -- pure chop
    features = compute_divergence_features(this_df, other_df)
    assert features["bos_divergence_bullish"].sum() > 0, "expected at least one flagged bar after the breakout"


def test_divergence_feature_is_never_affected_by_future_bars():
    """The core no-look-ahead guarantee: altering the OTHER symbol's data after bar t
    must never change this feature's value AT bar t or earlier. If it did, the feature
    would be using information that hadn't happened yet relative to that bar -- exactly
    the kind of leak a live signal could never actually have acted on.
    """
    this_df = _breakout_df(200, breakout_at=60)
    other_df = _flat_df(200)

    features_original = compute_divergence_features(this_df, other_df)

    other_altered = other_df.copy()
    # Drastically change the OTHER symbol's last 50 bars (well after the breakout).
    other_altered.iloc[-50:, other_altered.columns.get_indexer(["open", "high", "low", "close"])] *= 5.0
    features_altered = compute_divergence_features(this_df, other_altered)

    # Everything up to 100 bars before the altered tail must be byte-identical.
    cutoff = len(this_df) - 50 - 20  # extra margin clear of the rolling window itself
    pd.testing.assert_series_equal(
        features_original["bos_divergence_bullish"].iloc[:cutoff],
        features_altered["bos_divergence_bullish"].iloc[:cutoff],
    )
    pd.testing.assert_series_equal(
        features_original["bos_divergence_bearish"].iloc[:cutoff],
        features_altered["bos_divergence_bearish"].iloc[:cutoff],
    )


def test_output_is_always_zero_or_one():
    this_df = _breakout_df(150, breakout_at=80)
    other_df = _flat_df(150)
    features = compute_divergence_features(this_df, other_df)
    assert features["bos_divergence_bullish"].isin([0.0, 1.0]).all()
    assert features["bos_divergence_bearish"].isin([0.0, 1.0]).all()


def test_detect_latest_divergence_finds_a_fresh_qqq_breakout():
    # QQQ breaks out right at the end of the series; SPY never does. The break-of-
    # structure event itself fires ~1 bar after the trend starts (confirmed directly),
    # so breakout_at=n-4 keeps the event comfortably inside the 5-bar recency window.
    n = 100
    qqq = _breakout_df(n, breakout_at=n - 4)
    spy = _flat_df(n)
    result = detect_latest_divergence(qqq, spy)
    assert result is not None
    assert result["leader"] == "QQQ"
    assert result["follower"] == "SPY"
    assert result["direction"] == "bullish"


def test_detect_latest_divergence_none_when_nothing_just_happened():
    n = 100
    qqq = _flat_df(n)
    spy = _flat_df(n)
    assert detect_latest_divergence(qqq, spy) is None


def test_detect_latest_divergence_none_when_old_breakout_has_scrolled_out_of_window():
    # QQQ broke out long ago (well outside the recency window) -- shouldn't still
    # read as "just happened."
    n = 150
    qqq = _breakout_df(n, breakout_at=20)
    spy = _flat_df(n)
    result = detect_latest_divergence(qqq, spy)
    assert result is None
