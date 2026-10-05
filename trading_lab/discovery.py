"""Hypothesis generation: random search over feature-threshold combinations.

Also includes a "find conditions similar to this one historical trade" helper,
which is the nearest-neighbor version of the idea of taking a winning trade and
searching history for everything that looked the same.

IMPORTANT: this module only searches for candidates. A candidate backtesting well
here is a hypothesis, not an edge -- see validate.py for what has to happen next.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .backtest import BacktestConfig, run_backtest
from .information import benjamini_hochberg, test_information
from .metrics import compute_stats

# feature -> (low_quantile, high_quantile) bounds to sample thresholds from,
# so generated thresholds stay inside the range actually observed in the data.
FEATURES = [
    "price_vs_ema200",
    "rsi_14",
    "volatility_pctile",
    "volume_ratio_20",
    "return_5",
    "return_20",
    "hour",
]


@dataclass
class Clause:
    feature: str
    op: str   # ">" or "<"
    value: float

    def apply(self, df: pd.DataFrame) -> pd.Series:
        col = df[self.feature]
        return col > self.value if self.op == ">" else col < self.value


@dataclass
class Candidate:
    clauses: list = field(default_factory=list)

    def signal(self, df: pd.DataFrame) -> pd.Series:
        mask = pd.Series(True, index=df.index)
        for clause in self.clauses:
            mask &= clause.apply(df)
        return mask

    def describe(self) -> str:
        return " AND ".join(f"{c.feature} {c.op} {c.value:.4g}" for c in self.clauses)


def _sample_clause(df: pd.DataFrame, rng: np.random.Generator) -> Clause:
    feature = rng.choice(FEATURES)
    op = rng.choice([">", "<"])
    q = rng.uniform(0.2, 0.8)
    value = float(df[feature].quantile(q))
    return Clause(feature=feature, op=op, value=value)


def sample_candidate(df: pd.DataFrame, rng: np.random.Generator, n_clauses: int | None = None) -> Candidate:
    n = n_clauses or rng.integers(2, 4)
    used_features: set[str] = set()
    clauses = []
    attempts = 0
    while len(clauses) < n and attempts < 20:
        attempts += 1
        clause = _sample_clause(df, rng)
        if clause.feature in used_features:
            continue
        used_features.add(clause.feature)
        clauses.append(clause)
    return Candidate(clauses=clauses)


def search(
    df: pd.DataFrame,
    n_candidates: int = 2000,
    min_trades: int = 30,
    backtest_config: BacktestConfig = BacktestConfig(),
    seed: int = 42,
    information_horizon: int = 10,
    information_fdr: float = 0.10,
) -> tuple[pd.DataFrame, int]:
    """Randomly generate n_candidates hypotheses on df (the discovery set only).

    Two gates, in order:
      1. Information gate -- does the condition actually shift the forward-return
         distribution versus baseline (Mann-Whitney U), surviving Benjamini-Hochberg
         FDR correction across the whole batch? This is the "is there a real
         relationship here" question, independent of whether it's monetizable.
      2. Backtest gate -- for candidates that pass, run the actual strategy
         (entry/stop/target/fees) and keep those with at least min_trades trades.

    Returns (results, level1_survivor_count). results is a DataFrame sorted by
    score, one row per candidate that cleared both gates, each with an
    "information" column carrying the Level-1 stats including the FDR-adjusted
    q-value. level1_survivor_count is how many cleared gate 1 alone, regardless
    of whether they went on to clear the backtest gate too -- these are tracked
    separately so the funnel's stages don't get conflated into one number.
    """
    rng = np.random.default_rng(seed)
    candidates = []
    signals = []
    info_results = []

    for _ in range(n_candidates):
        candidate = sample_candidate(df, rng)
        signal = candidate.signal(df)
        if signal.sum() < min_trades:
            continue

        info = test_information(df, signal, horizon=information_horizon, min_observations=min_trades)
        if info is None:
            continue

        candidates.append(candidate)
        signals.append(signal)
        info_results.append(info)

    if not candidates:
        return pd.DataFrame(), 0

    survives, q_values = benjamini_hochberg([r["p_value"] for r in info_results], fdr=information_fdr)
    for info, q in zip(info_results, q_values):
        info["q_value"] = q
    level1_survivor_count = sum(survives)

    results = []
    for candidate, signal, info, keep in zip(candidates, signals, info_results, survives):
        if not keep:
            continue

        trades = run_backtest(df, signal, backtest_config)
        if len(trades) < min_trades:
            continue

        stats = compute_stats(trades["r_multiple"])
        score = stats.expectancy_r * np.sqrt(stats.n_trades) if stats.n_trades else -np.inf

        results.append({
            "rule": candidate.describe(),
            "clauses": candidate.clauses,
            "score": score,
            "information": info,
            **stats.as_dict(),
        })

    if not results:
        return pd.DataFrame(), level1_survivor_count

    out = pd.DataFrame(results).sort_values("score", ascending=False).reset_index(drop=True)
    return out, level1_survivor_count


def similar_to_reference(
    df: pd.DataFrame,
    reference_time,
    features: list[str] = FEATURES,
    tolerance: float = 0.15,
) -> pd.Series:
    """Boolean mask of bars whose feature vector is within `tolerance` (relative, per
    feature, scaled by that feature's historical std) of the bar at reference_time.

    This is the direct implementation of "take one winning trade, find 500 others
    that looked the same." It still needs to go through validate.py afterward.
    """
    ref = df.loc[reference_time, features]
    stds = df[features].std()

    diffs = (df[features] - ref).abs() / stds.replace(0, np.nan)
    within = (diffs <= tolerance).all(axis=1)
    return within
