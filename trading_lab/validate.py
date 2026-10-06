"""Validation pipeline: chronological split, walk-forward consistency, Monte Carlo.

A candidate is a *hypothesis* until it passes all of these without being re-fit:
the rule is frozen (found on discovery data) and never changes once validation starts.
"""

from __future__ import annotations

import dataclasses

import numpy as np
import pandas as pd

from .backtest import BacktestConfig, run_backtest
from .discovery import Candidate, Clause
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


def bootstrap_mean_lower_bound(
    r_multiples: np.ndarray | pd.Series, confidence: float = 0.90, n_sims: int = 5000, seed: int = 7
) -> float:
    """One-sided bootstrap confidence bound on the true mean expectancy: resample the
    trade sequence (with replacement) n_sims times, take each resample's mean, and
    return the (1-confidence) percentile of that distribution of means.

    If this is > 0, there's `confidence` probability the true mean expectancy is
    positive -- a strictly stronger bar than checking the raw sample mean (this bound
    is always <= the raw mean), since it also accounts for how much the mean varies
    across resamples. Thin or inconsistent samples produce a wide spread of resampled
    means and a lower (often negative) bound, so this is already the right, data-driven
    way to require "enough trades, consistently enough" instead of a second trade-count
    threshold. Same resampling idea as monte_carlo() above, applied to the mean instead
    of the cumulative equity path.
    """
    r = np.asarray(r_multiples, dtype=float)
    n = len(r)
    if n == 0:
        return -np.inf

    rng = np.random.default_rng(seed)
    means = np.array([rng.choice(r, size=n, replace=True).mean() for _ in range(n_sims)])
    return float(np.percentile(means, (1 - confidence) * 100))


def cost_stress(
    df: pd.DataFrame,
    candidate: Candidate,
    base_config: BacktestConfig = BacktestConfig(),
    multipliers: tuple[float, ...] = (1.0, 2.0, 3.0),
) -> pd.DataFrame:
    """Re-run the frozen candidate with fees and slippage multiplied up, to see how much
    of the edge is a transaction-cost artifact rather than real signal.
    """
    signal = candidate.signal(df)
    rows = []
    for mult in multipliers:
        config = dataclasses.replace(
            base_config,
            fee_bps=base_config.fee_bps * mult,
            slippage_bps=base_config.slippage_bps * mult,
        )
        trades = run_backtest(df, signal, config)
        stats = compute_stats(trades["r_multiple"]) if len(trades) else compute_stats([])
        rows.append({"cost_multiplier": mult, **stats.as_dict()})
    return pd.DataFrame(rows)


def parameter_perturbation(
    df: pd.DataFrame,
    candidate: Candidate,
    config: BacktestConfig = BacktestConfig(),
    step_fracs: tuple[float, ...] = (-0.10, -0.05, 0.05, 0.10),
) -> pd.DataFrame:
    """Nudge each clause's threshold by +/- a fraction of that feature's std and re-run.

    A real edge tends to occupy a region of parameter space, not a single exact value.
    If expectancy collapses the moment a threshold moves slightly, the original value
    was probably fit to noise in the discovery set rather than a real relationship.
    Run this on the SAME data the candidate was discovered on -- it's asking whether
    that data supports a region or just one lucky point, not testing generalization
    (validation/test already do that separately).
    """
    rows = []
    for i, clause in enumerate(candidate.clauses):
        scale = df[clause.feature].std()
        for frac in step_fracs:
            perturbed_clauses = list(candidate.clauses)
            perturbed_clauses[i] = Clause(
                feature=clause.feature, op=clause.op, value=clause.value + frac * scale
            )
            perturbed = Candidate(clauses=perturbed_clauses)
            signal = perturbed.signal(df)
            trades = run_backtest(df, signal, config)
            stats = compute_stats(trades["r_multiple"]) if len(trades) else compute_stats([])
            rows.append({
                "clause_index": i,
                "feature": clause.feature,
                "step_frac": frac,
                "perturbed_value": perturbed_clauses[i].value,
                **stats.as_dict(),
            })
    return pd.DataFrame(rows)


def parameter_stability_score(perturbation_df: pd.DataFrame, min_trades: int = 10) -> float:
    """Fraction of perturbations (with enough trades to be meaningful) that kept a
    positive expectancy. 1.0 = fully stable region, 0.0 = every nudge broke it.
    """
    usable = perturbation_df[perturbation_df["n_trades"] >= min_trades]
    if usable.empty:
        return 0.0
    return float((usable["expectancy_r"] > 0).mean())


def profit_concentration(r_multiples: np.ndarray | pd.Series, top_n: int = 5) -> float:
    """Fraction of total winning R contributed by the biggest top_n winning trades.
    High concentration means the edge's apparent profitability hinges on a handful
    of lucky trades rather than a broad, repeatable effect. Returns 0.0 if there are
    no winning trades to concentrate.
    """
    r = np.asarray(r_multiples, dtype=float)
    wins = r[r > 0]
    if len(wins) == 0:
        return 0.0
    total = wins.sum()
    if total <= 0:
        return 0.0
    top = np.sort(wins)[-top_n:]
    return float(top.sum() / total)


def score_label(total: float) -> str:
    """Qualitative band instead of treating e.g. 73.4/100 as a precise measurement.
    'Validated' is deliberately not a backtest-stage label -- reserved for candidates
    that have also survived forward paper trading, which this score alone can't claim.
    """
    if total >= 80:
        return "Strong"
    if total >= 65:
        return "Promising"
    if total >= 45:
        return "Weak"
    return "Reject"


def _clamp(x: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, x))


def robustness_score(
    discovery_stats: TradeStats,
    validation_stats: TradeStats,
    test_stats: TradeStats,
    walk_forward_df: pd.DataFrame,
    param_stability: float,
    cost_stress_df: pd.DataFrame,
    test_trades: pd.DataFrame | None = None,
) -> dict:
    """Composite 0-100 score across the dimensions that distinguish a real edge from
    an overfit one. Components are shown individually -- the total is a summary, not
    proof of profitability.
    """
    red_flags: list[str] = []

    # 1. Out-of-sample expectancy, scaled so 0R=50, +0.3R=100, -0.3R=0.
    expectancy_score = _clamp(50 + (test_stats.expectancy_r / 0.3) * 50)

    # 2. Does the edge hold in both independent splits?
    val_ok = validation_stats.n_trades >= 10 and validation_stats.expectancy_r > 0
    test_ok = test_stats.n_trades >= 10 and test_stats.expectancy_r > 0
    oos_consistency_score = 100.0 if (val_ok and test_ok) else 50.0 if (val_ok or test_ok) else 0.0
    if not val_ok:
        red_flags.append("Validation set expectancy is not positive (or has too few trades)")
    if not test_ok:
        red_flags.append("Final test set expectancy is not positive (or has too few trades)")

    # 3. Walk-forward consistency.
    if walk_forward_df is not None and len(walk_forward_df):
        usable_windows = walk_forward_df[walk_forward_df["n_trades"] >= 5]
        wf_score = 100.0 * (usable_windows["expectancy_r"] > 0).mean() if len(usable_windows) else 0.0
        if wf_score < 50:
            red_flags.append("Less than half of walk-forward windows were profitable")
    else:
        wf_score = 0.0

    # 4. Parameter stability.
    param_score = param_stability * 100
    if param_score < 50:
        red_flags.append("Edge breaks down under small parameter perturbations (possible noise fit)")

    # 5. Cost sensitivity -- does it survive 2x/3x realistic fees and slippage?
    if cost_stress_df is not None and len(cost_stress_df):
        by_mult = cost_stress_df.set_index("cost_multiplier")["expectancy_r"]
        if by_mult.get(3.0, -1) > 0:
            cost_score = 100.0
        elif by_mult.get(2.0, -1) > 0:
            cost_score = 60.0
            red_flags.append("Edge does not survive 3x transaction costs")
        elif by_mult.get(1.0, -1) > 0:
            cost_score = 30.0
            red_flags.append("Edge does not survive 2x transaction costs")
        else:
            cost_score = 0.0
            red_flags.append("Edge is not profitable even at base transaction costs")
    else:
        cost_score = 0.0

    # 6. Sample size.
    total_oos_trades = validation_stats.n_trades + test_stats.n_trades
    sample_score = _clamp(100 * total_oos_trades / 100)
    if total_oos_trades < 30:
        red_flags.append(f"Only {total_oos_trades} combined validation+test trades -- thin sample")

    # 7. Drawdown (in R).
    drawdown_score = _clamp(100 - test_stats.max_drawdown_r * 10)

    # 8. Degradation from discovery to out-of-sample (the overfitting tell).
    if discovery_stats.expectancy_r > 0:
        retained = test_stats.expectancy_r / discovery_stats.expectancy_r
        if retained >= 0.5:
            degradation_score = 100.0
        elif retained > 0:
            degradation_score = 50.0
        else:
            degradation_score = 0.0
    else:
        degradation_score = 0.0
    if discovery_stats.expectancy_r > 0 and test_stats.expectancy_r < discovery_stats.expectancy_r * 0.5:
        red_flags.append("Test expectancy is less than half of discovery expectancy -- likely overfitting")

    # 9. Profit concentration -- is this a broad effect or a handful of lucky trades?
    concentration = profit_concentration(test_trades["r_multiple"]) if test_trades is not None and len(test_trades) else 1.0
    concentration_score = _clamp(100 * (1 - concentration))
    if concentration > 0.5:
        red_flags.append(f"Top 5 winning test trades account for {concentration * 100:.0f}% of total profit -- fragile")

    components = {
        "expectancy": round(expectancy_score, 1),
        "oos_consistency": round(oos_consistency_score, 1),
        "walk_forward_stability": round(wf_score, 1),
        "parameter_stability": round(param_score, 1),
        "cost_sensitivity": round(cost_score, 1),
        "sample_size": round(sample_score, 1),
        "drawdown": round(drawdown_score, 1),
        "overfitting_resistance": round(degradation_score, 1),
        "profit_concentration": round(concentration_score, 1),
    }
    total = round(sum(components.values()) / len(components), 1)

    return {"total": total, "label": score_label(total), "components": components, "red_flags": red_flags}
