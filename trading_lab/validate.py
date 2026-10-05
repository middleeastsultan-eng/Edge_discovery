"""Validation pipeline: chronological split, walk-forward consistency, Monte Carlo.

A candidate is a *hypothesis* until it passes all of these without being re-fit:
the rule is frozen (found on discovery data) and never changes once validation starts.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from .backtest import BacktestConfig, run_backtest
from .discovery import Candidate
from .metrics import TradeStats, compute_stats


def chronological_split(df: pd.DataFrame, train_frac: float = 0.6, val_frac: float = 0.2):
    """Split a time-indexed df into (discovery, validation, test) with no shuffling."""
    n = len(df)
    train_end = int(n * train_frac)
    val_end = int(n * (train_frac + val_frac))
    return df.iloc[:train_end], df.iloc[train_end:val_end], df.iloc[val_end:]


def evaluate_candidate(df: pd.DataFrame, candidate: Candidate, config: BacktestConfig = BacktestConfig()):
    signal = candidate.signal(df)
    trades = run_backtest(df, signal, config)
    stats = compute_stats(trades["r_multiple"]) if len(trades) else compute_stats([])
    return stats, trades


def walk_forward(
    df: pd.DataFrame,
    candidate: Candidate,
    n_windows: int = 6,
    config: BacktestConfig = BacktestConfig(),
) -> pd.DataFrame:
    """Evaluate the frozen candidate rule across n_windows consecutive, non-overlapping
    chronological slices. Looks for consistency, not for re-optimization -- the rule
    does not change between windows.
    """
    n = len(df)
    edges = np.linspace(0, n, n_windows + 1).astype(int)

    rows = []
    for w in range(n_windows):
        window = df.iloc[edges[w]:edges[w + 1]]
        if len(window) < 50:
            continue
        stats, trades = evaluate_candidate(window, candidate, config)
        rows.append({
            "window": w + 1,
            "start": window.index[0],
            "end": window.index[-1],
            **stats.as_dict(),
        })
    return pd.DataFrame(rows)


def monte_carlo(r_multiples: np.ndarray | pd.Series, n_sims: int = 5000, seed: int = 7) -> dict:
    """Bootstrap-resample the trade sequence (with replacement) to see the range of
    equity paths consistent with this edge, including tail-risk drawdowns.
    """
    r = np.asarray(r_multiples, dtype=float)
    n = len(r)
    if n == 0:
        return {}

    rng = np.random.default_rng(seed)
    finals = np.empty(n_sims)
    max_dds = np.empty(n_sims)

    for s in range(n_sims):
        sample = rng.choice(r, size=n, replace=True)
        equity = np.cumsum(sample)
        running_max = np.maximum.accumulate(equity)
        dd = (running_max - equity).max()
        finals[s] = equity[-1]
        max_dds[s] = dd

    return {
        "final_r_p5": float(np.percentile(finals, 5)),
        "final_r_p50": float(np.percentile(finals, 50)),
        "final_r_p95": float(np.percentile(finals, 95)),
        "max_drawdown_r_p50": float(np.percentile(max_dds, 50)),
        "max_drawdown_r_p95": float(np.percentile(max_dds, 95)),
        "prob_final_negative": float((finals < 0).mean()),
    }
