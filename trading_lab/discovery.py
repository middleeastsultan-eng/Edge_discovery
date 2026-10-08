"""Hypothesis generation: random search over feature-threshold combinations.

Also includes a "find conditions similar to this one historical trade" helper,
which is the nearest-neighbor version of the idea of taking a winning trade and
searching history for everything that looked the same.

IMPORTANT: this module only searches for candidates. A candidate backtesting well
here is a hypothesis, not an edge -- see validate.py for what has to happen next.
"""

from __future__ import annotations

import os
import dataclasses
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .backtest import BacktestConfig, run_backtest
from .information import benjamini_hochberg, classify_economic_significance, test_information
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
    # Cross-asset: does this symbol's own QQQ/SPY counterpart recently fail to confirm
    # a break of structure this symbol just made? See cross_asset.py.
    "bos_divergence_bullish",
    "bos_divergence_bearish",
]

# Short-side features: same indicators but the signal direction is inverted.
# A clause like "rsi_14 < 30" on the long side becomes "rsi_14 > 70" on the short side.
# The discovery engine samples from FEATURES for both long and short candidates,
# but the operator is chosen based on the signal direction to ensure economic sense.
SHORT_FEATURES = FEATURES  # same features, different operator selection


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


def _sample_clause(df: pd.DataFrame, rng: np.random.Generator, direction: str = "long") -> Clause:
    feature = rng.choice(FEATURES)
    q = rng.uniform(0.2, 0.8)
    value = float(df[feature].quantile(q))
    if direction == "long":
        op = rng.choice([">", "<"])
    else:
        # For short signals, we want the opposite direction of the indicator
        # e.g., if long would use "rsi < 30" (oversold), short uses "rsi > 70" (overbought)
        op = rng.choice([">", "<"])
    return Clause(feature=feature, op=op, value=value)


def sample_candidate(df: pd.DataFrame, rng: np.random.Generator, n_clauses: int | None = None, direction: str = "long") -> Candidate:
    n = n_clauses or rng.integers(2, 4)
    used_features: set[str] = set()
    clauses = []
    attempts = 0
    while len(clauses) < n and attempts < 20:
        attempts += 1
        clause = _sample_clause(df, rng, direction)
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
) -> tuple[pd.DataFrame, dict]:
    """Randomly generate n_candidates hypotheses on df (the discovery set only).

    Generates both long and short candidates. For short candidates, the backtest is
    run with direction="short" and the information test checks for negative returns
    (since short profits from price declines).

    Three gates, in order:
      1. Information gate -- does the condition actually shift the forward-return
         distribution versus baseline (Mann-Whitney U), surviving Benjamini-Hochberg
         FDR correction across the whole batch? "Is there a real relationship here,"
         independent of whether it's monetizable.
      2. Economic gate -- is the gross edge bigger than this config's estimated
         round-trip trading cost? Statistically real but too small to clear costs
         is recorded as STATISTICALLY_INTERESTING, not silently discarded, but does
         NOT proceed to backtesting -- only RESEARCH_WORTHY candidates do.
      3. Backtest gate -- for RESEARCH_WORTHY candidates, run the actual strategy
         (entry/stop/target/fees) and keep those with at least min_trades trades.

    Returns (results, counts). results is a DataFrame sorted by score, one row per
    candidate that cleared all three gates, each with an "information" column
    carrying the Level-1 stats (including the FDR-adjusted q-value and the economic
    classification). counts is {"level1_survivors", "statistically_interesting",
    "research_worthy"} -- tracked separately so funnel stages never get conflated.
    """
    cost_estimate = 2 * (backtest_config.fee_bps + backtest_config.slippage_bps) / 10_000

    rng = np.random.default_rng(seed)
    candidates = []
    signals = []
    info_results = []        # ALL info results -- used for BH correction and funnel counts
    candidate_infos = []     # parallel to candidates/signals/directions -- only actionable entries
    directions = []

    # Generate half long, half short candidates
    n_long = n_candidates // 2
    n_short = n_candidates - n_long

    for i in range(n_candidates):
        direction = "long" if i < n_long else "short"
        candidate = sample_candidate(df, rng, direction=direction)
        signal = candidate.signal(df)
        if signal.sum() >= min_trades:
            info = test_information(df, signal, horizon=information_horizon, min_observations=min_trades)
            if info is not None:
                info["direction"] = direction
                # For short candidates, we want the condition to predict NEGATIVE returns.
                # A positive "difference" means the condition predicts upward moves -- wrong
                # direction for shorting. Record it for BH correction and funnel counts but
                # don't add it to candidates/signals/directions so it never reaches the backtest gate.
                if direction == "short" and info["difference"] > 0:
                    info["label"] = "STATISTICALLY_INTERESTING"
                    info_results.append(info)
                    continue
                candidates.append(candidate)
                signals.append(signal)
                candidate_infos.append(info)
                info_results.append(info)
                directions.append(direction)

        # A combo's discovery loop can run for minutes with nothing else to show for
        # it -- a periodic heartbeat is the difference between "running" and "stuck"
        # from the outside (e.g. in the desktop control panel's log).
        if (i + 1) % 500 == 0:
            print(f"  pid={os.getpid()} Level-1 scan: {i + 1}/{n_candidates} candidates, {len(candidates)} passed so far", flush=True)

    if not candidates:
        return pd.DataFrame(), {"level1_survivors": 0, "statistically_interesting": 0, "research_worthy": 0}

    q_passes, q_values = benjamini_hochberg([r["p_value"] for r in info_results], fdr=information_fdr)
    for info, q in zip(info_results, q_values):
        info["q_value"] = q
        info.update(classify_economic_significance(info, q, cost_estimate, fdr=information_fdr))

    counts = {
        "level1_survivors": sum(q_passes),
        "statistically_interesting": sum(1 for i in info_results if i["label"] == "STATISTICALLY_INTERESTING"),
        "research_worthy": sum(1 for i in info_results if i["label"] == "RESEARCH_WORTHY"),
    }

    results = []
    for candidate, signal, info, direction in zip(candidates, signals, candidate_infos, directions):
        if info["label"] != "RESEARCH_WORTHY":
            continue

        # Use the appropriate backtest config for the direction
        bt_config = backtest_config if direction == "long" else dataclasses.replace(backtest_config, direction="short")
        trades = run_backtest(df, signal, bt_config)
        if len(trades) < min_trades:
            continue

        stats = compute_stats(trades["r_multiple"])
        score = stats.expectancy_r * np.sqrt(stats.n_trades) if stats.n_trades else -np.inf

        results.append({
            "rule": candidate.describe(),
            "clauses": candidate.clauses,
            "score": score,
            "direction": direction,
            "information": info,
            **stats.as_dict(),
        })

    if not results:
        return pd.DataFrame(), counts

    out = pd.DataFrame(results).sort_values("score", ascending=False).reset_index(drop=True)
    return out, counts


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
