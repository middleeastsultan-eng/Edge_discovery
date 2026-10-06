"""Regression tests for trading_lab/validate.py."""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_lab.backtest import BacktestConfig
from trading_lab.discovery import Candidate, Clause
from trading_lab.validate import bootstrap_mean_lower_bound, chronological_split, walk_forward


def _trending_df(n: int = 3000) -> pd.DataFrame:
    rng = np.random.default_rng(1)
    idx = pd.date_range("2020-01-01", periods=n, freq="1h", tz="UTC")
    close = 100 + np.cumsum(rng.normal(0.01, 0.3, n))
    return pd.DataFrame(
        {"open": close, "high": close + 0.5, "low": close - 0.5, "close": close,
         "atr_14": 1.0, "volume_ratio_20": rng.uniform(0.5, 1.5, n)},
        index=idx,
    )


def test_walk_forward_on_oos_only_never_touches_discovery_range():
    """Regression for a real bug: walk_forward used to be called on the FULL
    discovery+val+test range in pipeline.py, so several of its 'consistency'
    windows landed entirely inside the data the rule was fit to (confirmed
    directly: 3 of 6 windows were 100% in-sample on a real run). The fix is in
    pipeline.py (restricting the input to val+test only) -- this test locks in
    the *contract* walk_forward's caller must uphold: every window's dates must
    fall at or after the validation split boundary.
    """
    df = _trending_df()
    discovery_df, val_df, test_df = chronological_split(df)
    oos_df = pd.concat([val_df, test_df])

    candidate = Candidate(clauses=[Clause(feature="volume_ratio_20", op=">", value=0.5)])
    wf = walk_forward(oos_df, candidate, n_windows=6, config=BacktestConfig())

    discovery_end = discovery_df.index[-1]
    assert len(wf) > 0
    for _, row in wf.iterrows():
        assert row["start"] > discovery_end, "a walk-forward window started inside the discovery range"


def test_bootstrap_lower_bound_is_never_above_the_raw_mean():
    """The lower confidence bound must always be <= the raw sample mean -- that's
    the whole point of it being a LOWER bound.
    """
    rng = np.random.default_rng(2)
    r = rng.normal(0.1, 1.0, 50)
    lower = bootstrap_mean_lower_bound(r, confidence=0.90)
    assert lower <= r.mean() + 1e-9


def test_bootstrap_lower_bound_tightens_with_more_consistent_data():
    """A tight, consistently-positive sample should produce a lower bound close to
    its mean; a noisy sample with the same mean should produce a much lower (wider)
    bound. This is what makes promotion harder for thin/noisy track records instead
    of just counting trades.
    """
    consistent = np.full(50, 0.2)  # zero variance -- bound should equal the mean exactly
    noisy = np.concatenate([np.full(25, 5.0), np.full(25, -4.6)])  # same mean (0.2), huge variance

    bound_consistent = bootstrap_mean_lower_bound(consistent, confidence=0.90)
    bound_noisy = bootstrap_mean_lower_bound(noisy, confidence=0.90)

    assert bound_consistent == pytest.approx(0.2, abs=1e-9)
    assert bound_noisy < bound_consistent


def test_bootstrap_lower_bound_empty_input():
    assert bootstrap_mean_lower_bound(np.array([])) == float("-inf")
