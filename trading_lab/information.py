"""Level-1 research question: does this condition carry information about future
returns at all -- before we even consider turning it into a trading strategy with
stops, targets, position sizing, and fees (that's Level 2: discovery.py + backtest.py).

"Does this make money" and "does this contain information" are different questions.
A condition can shift the return distribution in a real, statistically detectable
way and still fail to be profitable after realistic costs -- and a condition that
looks profitable in one noisy backtest can easily carry zero real information.
Testing the distributional question first, on a large batch with proper multiple-
testing correction, filters out the second case before it ever reaches a backtest.

Statistical significance alone isn't the whole story: with enough observations, an
economically meaningless difference (+0.080% vs +0.084%) can produce a tiny p-value.
test_information() reports effect size (rank-biserial correlation) and the raw
magnitude of the difference so that's visible -- and classify_economic_significance()
turns it into a three-way verdict using an estimated transaction cost rather than one
universal effect-size cutoff, since what counts as "a big enough move" is specific to
the asset/timeframe's actual trading costs, not a constant.
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

    n_cond, n_base = len(conditional), len(baseline)
    if n_cond < min_observations or n_base < min_observations:
        return None

    u_stat, p_value = stats.mannwhitneyu(conditional, baseline, alternative="two-sided")
    # Rank-biserial correlation: -1..+1, 0 = no effect. Independent of sample size,
    # unlike the p-value, which is why both are reported rather than p-value alone.
    effect_size = 1 - (2 * u_stat) / (n_cond * n_base)

    cond_mean, base_mean = float(conditional.mean()), float(baseline.mean())

    return {
        "horizon": horizon,
        "n_condition": int(n_cond),
        "n_baseline": int(n_base),
        "conditional_mean_return": cond_mean,
        "baseline_mean_return": base_mean,
        "difference": cond_mean - base_mean,
        "conditional_median_return": float(conditional.median()),
        "baseline_median_return": float(baseline.median()),
        "conditional_p_positive": float((conditional > 0).mean()),
        "baseline_p_positive": float((baseline > 0).mean()),
        "effect_size": float(effect_size),
        "p_value": float(p_value),
    }


def classify_economic_significance(
    info: dict,
    q_value: float,
    cost_estimate: float,
    fdr: float = 0.10,
) -> dict:
    """Three-way verdict instead of pass/fail, per candidate:

      REJECTED                 -- no statistically credible relationship (q > fdr)
      STATISTICALLY_INTERESTING -- real signal, but too small to clear estimated
                                    round-trip trading costs
      RESEARCH_WORTHY           -- real signal AND large enough to plausibly survive
                                    costs -- only this tier proceeds to backtesting

    cost_estimate is a round-trip cost in the same units as `difference` (price-return
    fraction) -- 2*(fee+slippage) from the backtest config that will actually be used,
    NOT a fixed number shared across every asset/timeframe. A 0.10% move means something
    different on BTC 15m than on SPY 1h because the cost to capture it differs.

    The backtester here is long-only, so only a POSITIVE difference (condition predicts
    upward moves) is currently exploitable -- a strong negative difference is real
    information but gets held at STATISTICALLY_INTERESTING until short support exists.
    """
    gross_edge = info["difference"]
    net_edge = gross_edge - cost_estimate

    if q_value > fdr:
        label = "REJECTED"
    elif net_edge > 0:
        label = "RESEARCH_WORTHY"
    else:
        label = "STATISTICALLY_INTERESTING"

    return {"label": label, "gross_edge": gross_edge, "cost_estimate": cost_estimate, "net_edge": net_edge}


def benjamini_hochberg(p_values: list[float], fdr: float = 0.10) -> tuple[list[bool], list[float]]:
    """Benjamini-Hochberg FDR correction. Returns (passes, q_values) in the original
    input order -- q_values are the adjusted p-values, storable and comparable even
    for candidates that didn't survive, which raw per-candidate p-values obscure.

    With hundreds of candidates tested per run, a raw p<0.05 threshold would let
    roughly 5% through by chance alone regardless of whether any real information
    exists. This controls the expected false-discovery rate across the whole batch
    instead of treating each candidate's p-value in isolation.
    """
    n = len(p_values)
    if n == 0:
        return [], []

    p_arr = np.asarray(p_values, dtype=float)
    order = np.argsort(p_arr)
    sorted_p = p_arr[order]

    ranks = np.arange(1, n + 1)
    raw_q = sorted_p * n / ranks
    # Step-up: q_(i) = min over j>=i of raw_q_(j), enforced via a reverse cumulative min.
    q_sorted = np.minimum.accumulate(raw_q[::-1])[::-1]
    q_sorted = np.clip(q_sorted, 0, 1)

    q_values = np.empty(n)
    q_values[order] = q_sorted

    passes = (q_values <= fdr).tolist()
    return passes, q_values.tolist()
