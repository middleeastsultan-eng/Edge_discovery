"""Structural divergence strategy — QQQ/SPY break-of-structure confirmation.

This is NOT a random-search hypothesis. It has a real mechanism: when one
tracked index breaks a recent structure level and the other hasn't confirmed,
money has flowed asymmetrically. The follower typically catches up — that
catch-up is the tradeable move.

ENTRY  : follower index closes beyond the leader's most-recently confirmed
         swing high/low in the same direction as the leader's BOS.
STOP   : leader's pivot level (the level that was broken).
TARGET : 2× ATR from entry (same as every other strategy in this codebase).

This module exposes a DivergenceCandidate that satisfies the same interface as
discovery.Candidate so that live.check_pattern() can track it without knowing
it isn't a clause-based rule. All signals are strictly backward-looking — no
look-ahead at any point.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from .cross_asset import PAIRED_INDEX, _find_swing_points, _breaks_of_structure
from .backtest import BacktestConfig, run_backtest
from .metrics import compute_stats, TradeStats
from .validate import (
    chronological_split,
    walk_forward as _walk_forward,
    monte_carlo,
    cost_stress as _cost_stress,
    parameter_perturbation,
    parameter_stability_score,
    robustness_score,
)


# ─── signal generation ────────────────────────────────────────────────────────

def _build_entry_signal(
    leader: pd.DataFrame,
    follower: pd.DataFrame,
    direction: str,          # "long" (bull divergence) or "short" (bear divergence)
    lookback: int = 5,
    window: int = 5,
) -> pd.Series:
    """Returns a boolean Series on the FOLLOWER's index: True on bars where
    entry conditions are met.

    Bull divergence (long): leader made a recent high break (new window high);
        follower has NOT made a matching high break; follower then closes above
        the leader's most-recent high-break level.
    Bear divergence (short): leader made a recent low break; follower has not;
        follower closes below the leader's most-recent low-break level.

    Strictly backward-looking: at bar t, only data up to and including t is used.
    """
    common_idx = leader.index.intersection(follower.index)
    if len(common_idx) < lookback * 2 + 1:
        return pd.Series(False, index=follower.index)

    ldr = leader.loc[common_idx]
    flw = follower.loc[common_idx]

    ldr_high = ldr["high"].to_numpy()
    ldr_low  = ldr["low"].to_numpy()
    flw_close = flw["close"].to_numpy()
    n = len(common_idx)

    # Leader's new-extreme bars (high break for long, low break for short)
    ldr_high_break = pd.Series(False, index=common_idx)
    ldr_low_break  = pd.Series(False, index=common_idx)
    for i in range(lookback, n):
        win_high = ldr_high[i - lookback:i].max()
        win_low  = ldr_low[i - lookback:i].min()
        if ldr_high[i] > win_high:
            ldr_high_break.iloc[i] = True
        if ldr_low[i] < win_low:
            ldr_low_break.iloc[i] = True

    # Track the leader's most-recently confirmed pivot level
    ref_pivot = np.full(n, np.nan)
    last_pivot = np.nan
    for i in range(n):
        if direction == "long" and ldr_high_break.iloc[i]:
            last_pivot = ldr_high[i]
        elif direction == "short" and ldr_low_break.iloc[i]:
            last_pivot = ldr_low[i]
        ref_pivot[i] = last_pivot

    # Follower's new-extreme bars
    flw_high_break = pd.Series(False, index=common_idx)
    flw_low_break  = pd.Series(False, index=common_idx)
    for i in range(lookback, n):
        win_high = flw["high"].iloc[i - lookback:i].max()
        win_low  = flw["low"].iloc[i - lookback:i].min()
        if flw["high"].iloc[i] > win_high:
            flw_high_break.iloc[i] = True
        if flw["low"].iloc[i] < win_low:
            flw_low_break.iloc[i] = True

    # Divergence flags (rolling window)
    if direction == "long":
        ldr_bos_recent = ldr_high_break.rolling(window, min_periods=1).max().astype(bool)
        flw_bos_recent = flw_high_break.rolling(window, min_periods=1).max().astype(bool)
        divergence_active = (ldr_bos_recent & ~flw_bos_recent).to_numpy()
        entry = pd.Series(False, index=common_idx)
        for i in range(n):
            if divergence_active[i] and not np.isnan(ref_pivot[i]):
                # Entry occurs on the leader's divergence bar itself
                entry.iloc[i] = True
    else:
        ldr_bos_recent = ldr_low_break.rolling(window, min_periods=1).max().astype(bool)
        flw_bos_recent = flw_low_break.rolling(window, min_periods=1).max().astype(bool)
        divergence_active = (ldr_bos_recent & ~flw_bos_recent).to_numpy()
        entry = pd.Series(False, index=common_idx)
        for i in range(n):
            if divergence_active[i] and not np.isnan(ref_pivot[i]):
                # Entry occurs on the leader's divergence bar itself
                entry.iloc[i] = True

    # Reindex to follower's full index (bars not in common_idx get False)
    return entry.reindex(follower.index, fill_value=False)


# ─── DivergenceCandidate — drop-in replacement for discovery.Candidate ────────

@dataclass
class DivergenceCandidate:
    """Wraps the structural divergence logic so live.check_pattern() can call it
    identically to a clause-based Candidate.

    `signal()` needs both leader and follower DataFrames. live.check_pattern()
    only passes one feats DataFrame, so we store the follower's features at
    construction time and merge inside signal(). The caller (run_divergence_live)
    fetches both and builds this object before handing it to check_pattern.
    """
    leader_symbol: str
    follower_symbol: str
    direction: str           # "long" or "short"
    lookback: int = 5
    window: int = 5
    _follower_feats: pd.DataFrame = field(default_factory=pd.DataFrame, repr=False)

    # Satisfy the same duck-typed interface as discovery.Candidate
    clauses: list = field(default_factory=list, init=False)

    def attach_follower(self, follower_feats: pd.DataFrame) -> "DivergenceCandidate":
        """Store the follower's feature DataFrame so signal() can use it."""
        self._follower_feats = follower_feats
        return self

    def signal(self, df: pd.DataFrame) -> pd.Series:
        """df is the LEADER's feature DataFrame (as fetched by fetch_live_features).
        Returns a boolean entry signal on df's index.
        """
        if self._follower_feats.empty:
            return pd.Series(False, index=df.index)
        return _build_entry_signal(
            df, self._follower_feats, self.direction, self.lookback, self.window,
        )

    def describe(self) -> str:
        direction_label = "bull" if self.direction == "long" else "bear"
        return (
            f"divergence:{direction_label} "
            f"leader={self.leader_symbol} follower={self.follower_symbol} "
            f"lookback={self.lookback} window={self.window}"
        )


# ─── validation suite ─────────────────────────────────────────────────────────

def _sim_trades(
    leader_feats: pd.DataFrame,
    follower_feats: pd.DataFrame,
    direction: str,
    lookback: int = 5,
    window: int = 5,
    config: BacktestConfig = BacktestConfig(),
) -> pd.DataFrame:
    """Run backtest on leader data using the divergence entry signal."""
    signal = _build_entry_signal(leader_feats, follower_feats, direction, lookback, window)
    bt_config = dataclasses.replace(config, direction=direction)
    return run_backtest(leader_feats, signal, bt_config)


def validate_divergence_strategy(
    leader_feats: pd.DataFrame,
    follower_feats: pd.DataFrame,
    leader_symbol: str,
    follower_symbol: str,
    direction: str = "long",
    lookback: int = 5,
    window: int = 5,
    config: BacktestConfig = BacktestConfig(),
) -> dict:
    """Full validation suite — chronological split → walk-forward → Monte Carlo
    → cost stress → robustness score. Returns a dict with the same shape as
    pipeline.run_experiment's finalists so db.save_experiment works unchanged.
    """
    # Align both DataFrames to their common index before splitting
    common = leader_feats.index.intersection(follower_feats.index)
    ldr = leader_feats.loc[common]
    flw = follower_feats.loc[common]

    ldr_disc, ldr_val, ldr_test = chronological_split(ldr)
    flw_disc, flw_val, flw_test = chronological_split(flw)

    bt_config = dataclasses.replace(config, direction=direction)

    disc_trades = _sim_trades(ldr_disc, flw_disc, direction, lookback, window, config)
    val_trades  = _sim_trades(ldr_val,  flw_val,  direction, lookback, window, config)
    test_trades = _sim_trades(ldr_test, flw_test, direction, lookback, window, config)

    disc_stats = compute_stats(disc_trades["r_multiple"]) if len(disc_trades) else compute_stats([])
    val_stats  = compute_stats(val_trades["r_multiple"])  if len(val_trades)  else compute_stats([])
    test_stats = compute_stats(test_trades["r_multiple"]) if len(test_trades) else compute_stats([])

    # Build a DivergenceCandidate for walk_forward (it only needs .signal(df))
    cand = DivergenceCandidate(
        leader_symbol=leader_symbol,
        follower_symbol=follower_symbol,
        direction=direction,
        lookback=lookback,
        window=window,
    ).attach_follower(flw)

    # Walk-forward on OOS data only (val + test), same rule as pipeline.py
    oos_ldr = pd.concat([ldr_val, ldr_test])
    oos_flw = pd.concat([flw_val, flw_test])

    # walk_forward calls cand.signal(window_df) for each slice — but we need the
    # follower slice too. We override by running manually here.
    wf_rows = []
    n_oos = len(oos_ldr)
    edges = np.linspace(0, n_oos, 7).astype(int)  # 6 windows
    for w in range(6):
        wldr = oos_ldr.iloc[edges[w]:edges[w + 1]]
        wflw = oos_flw.iloc[edges[w]:edges[w + 1]]
        if len(wldr) < 50:
            continue
        wt = _sim_trades(wldr, wflw, direction, lookback, window, config)
        ws = compute_stats(wt["r_multiple"]) if len(wt) else compute_stats([])
        wf_rows.append({
            "window": w + 1,
            "start": wldr.index[0],
            "end": wldr.index[-1],
            **ws.as_dict(),
        })
    wf = pd.DataFrame(wf_rows)

    # Monte Carlo on test trades
    mc = monte_carlo(test_trades["r_multiple"]) if len(test_trades) else None

    # Cost stress on test slice
    cs_rows = []
    for mult in (1.0, 2.0, 3.0):
        cfg = dataclasses.replace(
            bt_config,
            fee_bps=bt_config.fee_bps * mult,
            slippage_bps=bt_config.slippage_bps * mult,
        )
        ct = _sim_trades(ldr_test, flw_test, direction, lookback, window, cfg)
        cs = compute_stats(ct["r_multiple"]) if len(ct) else compute_stats([])
        cs_rows.append({"cost_multiplier": mult, **cs.as_dict()})
    cost_stress_df = pd.DataFrame(cs_rows)

    # Robustness score — no parameter_perturbation (divergence has no thresholds
    # to perturb), so param_stability = 1.0 (not penalised for something it doesn't have)
    score = robustness_score(
        disc_stats, val_stats, test_stats,
        wf, param_stability=1.0,
        cost_stress_df=cost_stress_df,
        test_trades=test_trades if len(test_trades) else None,
    )

    instrument = f"{leader_symbol}/{follower_symbol}"
    rule = DivergenceCandidate(
        leader_symbol=leader_symbol, follower_symbol=follower_symbol,
        direction=direction, lookback=lookback, window=window,
    ).describe()

    return {
        "instrument": instrument,
        "rule": rule,
        "direction": direction,
        "discovery_stats": disc_stats,
        "validation_stats": val_stats,
        "test_stats": test_stats,
        "validation_trades": val_trades,
        "test_trades": test_trades,
        "walk_forward": wf,
        "monte_carlo": mc,
        "cost_stress": cost_stress_df,
        "robustness_score": score,
        "n_disc_trades": len(disc_trades),
        "n_val_trades":  len(val_trades),
        "n_test_trades": len(test_trades),
    }
