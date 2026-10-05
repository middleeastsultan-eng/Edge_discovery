"""Level-1 research question: does this condition carry information about future
returns at all -- before we even consider turning it into a trading strategy with
stops, targets, position sizing, and fees (that's Level 2: discovery.py + backtest.py).

"Does this make money" and "does this contain information" are different questions.
A condition can shift the return distribution in a real, statistically detectable
way and still fail to be profitable after realistic costs -- and a condition that
looks profitable in one noisy backtest can easily carry zero real information.
Testing the distributional question first, on a large batch with proper multiple-
testing correction, filters out the second case before it ever reaches a backtest.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats


def forward_return(df: pd.DataFrame, horizon: int = 10) -> pd.Series:
    """Close-to-close return over the next `horizon` bars. Used ONLY to test whether
    a condition carries information -- never fed back in as a feature for a trading
    rule, since it looks into the future by construction.
    """
    return df["close"].shift(-horizon) / df["close"] - 1


def test_information(
    df: pd.DataFrame,
    mask: pd.Series,
    horizon: int = 10,
    min_observations: int = 30,
) -> dict | None:
    """Compare the forward-return distribution when `mask` is True against the
    distribution over all observations (Mann-Whitney U, two-sided). Returns None
    if there isn't enough data on the condition side to test meaningfully.
    """
    fwd = forward_return(df, horizon)
    valid = fwd.notna()

    conditional = fwd[mask & valid]
    baseline = fwd[valid]

    if len(conditional) < min_observations or len(baseline) < min_observations:
        return None

    _, p_value = stats.mannwhitneyu(conditional, baseline, alternative="two-sided")

    return {
        "horizon": horizon,
        "n_condition": int(len(conditional)),
        "n_baseline": int(len(baseline)),
        "conditional_mean_return": float(conditional.mean()),
        "baseline_mean_return": float(baseline.mean()),
        "conditional_p_positive": float((conditional > 0).mean()),
        "baseline_p_positive": float((baseline > 0).mean()),
        "p_value": float(p_value),
    }


def benjamini_hochberg(p_values: list[float], fdr: float = 0.10) -> list[bool]:
    """Which p-values survive Benjamini-Hochberg FDR correction at the given rate.

    With hundreds of candidates tested per run, a raw p<0.05 threshold would let
    roughly 5% through by chance alone regardless of whether any real information
    exists. This controls the expected false-discovery rate across the whole batch
    instead of treating each candidate's p-value in isolation.
    """
    n = len(p_values)
    if n == 0:
        return []

    order = np.argsort(p_values)
    sorted_p = np.asarray(p_values)[order]
    thresholds = (np.arange(1, n + 1) / n) * fdr
    below = sorted_p <= thresholds

    if not below.any():
        return [False] * n

    cutoff_p = sorted_p[np.max(np.where(below)[0])]
    return [p <= cutoff_p for p in p_values]
