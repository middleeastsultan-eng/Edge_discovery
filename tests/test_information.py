"""Regression tests for trading_lab/information.py.

test_effect_size_sign_matches_direction_of_the_difference is a direct regression for
a real bug fixed this project: effect_size's sign was inverted (positive difference
reported as a negative effect_size), silently making real, positive edges look like
they pointed the wrong way.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_lab.information import benjamini_hochberg
from trading_lab.information import test_information as run_information_test


def _df_with_known_effect(n: int = 400, horizon: int = 5, shift: float = 0.01) -> tuple[pd.DataFrame, pd.Series]:
    """Builds a series where `mask` bars are deterministically followed by a bigger
    forward return than non-mask bars -- a known-positive effect.
    """
    rng = np.random.default_rng(0)
    idx = pd.date_range("2024-01-01", periods=n + horizon, freq="1h", tz="UTC")
    mask_raw = rng.random(n) > 0.5

    # Build close prices so the next `horizon`-bar return is bigger after mask=True bars.
    returns = rng.normal(0, 0.001, n + horizon)
    for i in range(n):
        if mask_raw[i]:
            returns[i + 1:i + 1 + horizon] += shift / horizon
    close = 100 * np.cumprod(1 + returns)

    df = pd.DataFrame({"close": close, "open": close, "high": close, "low": close}, index=idx)
    mask = pd.Series(False, index=idx)
    mask.iloc[:n] = mask_raw
    return df, mask


def test_effect_size_sign_matches_direction_of_the_difference():
    df, mask = _df_with_known_effect(shift=0.02)
    info = run_information_test(df, mask, horizon=5, min_observations=30)
    assert info is not None
    # Built so the condition predicts a HIGHER forward return -- difference and
    # effect_size must both be positive, and must agree with each other.
    assert info["difference"] > 0
    assert info["effect_size"] > 0


def test_effect_size_sign_flips_with_a_negative_effect():
    df, mask = _df_with_known_effect(shift=-0.02)
    info = run_information_test(df, mask, horizon=5, min_observations=30)
    assert info is not None
    assert info["difference"] < 0
    assert info["effect_size"] < 0


def test_too_few_observations_returns_none():
    df, mask = _df_with_known_effect(n=50)
    mask.iloc[:] = False
    mask.iloc[0] = True  # only 1 True observation, far under any reasonable min
    assert run_information_test(df, mask, horizon=5, min_observations=30) is None


def test_benjamini_hochberg_known_case():
    # Classic worked example: 5 p-values, fdr=0.05 -- threshold rank is where
    # p_(i) <= (i/n)*fdr holds for the largest such i (BH step-up procedure).
    p_values = [0.01, 0.02, 0.03, 0.04, 0.5]
    passes, q_values = benjamini_hochberg(p_values, fdr=0.05)
    # q-values must be monotonically non-decreasing when p-values are sorted ascending.
    order = np.argsort(p_values)
    sorted_q = np.array(q_values)[order]
    assert all(sorted_q[i] <= sorted_q[i + 1] + 1e-12 for i in range(len(sorted_q) - 1))
    # Every q-value must be >= its raw p-value (q is never more lenient than p).
    for p, q in zip(p_values, q_values):
        assert q >= p - 1e-12


def test_benjamini_hochberg_empty_input():
    assert benjamini_hochberg([]) == ([], [])
