"""Divergence event study: does QQQ/SPY structure divergence actually change the
distribution of forward returns?

This is Experiment 1 from the research plan: isolate structure-divergence as its own
hypothesis (not buried inside a random 2-3-clause combo) and measure it with proper
matched controls, before investing in wider search changes.

For every divergence event, we record:
  - direction (bullish/bearish)
  - which instrument led (QQQ or SPY)
  - magnitude of the break
  - distance between the two structures
  - time of day
  - ATR/volatility regime
  - subsequent 1/3/5/10/20-bar returns
  - MFE / MAE
  - whether the other instrument subsequently confirms
  - whether the divergence resolves by continuation or mean reversion

And crucially, compare against matched non-divergence events (same time-of-day,
similar volatility regime) rather than unconditional returns.

Usage:
    python run_divergence_event_study.py --interval 15Min --start 2020-01-01 --end 2024-12-31
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass, asdict
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from trading_lab.cross_asset import (
    _breaks_of_structure,
    _find_swing_points,
)
from trading_lab.data_stocks import get_stock_candles
from trading_lab.features import build_features


@dataclass
class DivergenceEvent:
    bar_time: pd.Timestamp
    leader: str          # "QQQ" or "SPY"
    direction: str       # "bullish" or "bearish"
    magnitude: float     # how far the leader broke its own structure (in ATR units)
    structure_distance: float  # distance between leader's break and follower's nearest structure
    hour: int
    volatility_regime: str  # "low", "normal", "high"
    atr: float
    # Forward outcomes
    return_1: float
    return_3: float
    return_5: float
    return_10: float
    return_20: float
    mfe: float           # max favorable excursion (in ATR units)
    mae: float           # max adverse excursion (in ATR units)
    resolved_as: str     # "continuation" or "mean_reversion"
    follower_confirmed: bool  # did the other index confirm within 5 bars?


def _volatility_regime(vol_pctile: float) -> str:
    if vol_pctile < 0.33:
        return "low"
    if vol_pctile > 0.66:
        return "high"
    return "normal"


def _detect_events(qqq_feats: pd.DataFrame, spy_feats: pd.DataFrame, window: int = 5) -> list[DivergenceEvent]:
    """Detect divergence events and record their forward outcomes.

    A divergence event fires on a bar where one index breaks structure (BOS) and the
    other does not, within the same `window`-bar lookback. We then track forward
    returns and resolution for a fixed horizon.
    """
    common_idx = qqq_feats.index.intersection(spy_feats.index)
    qqq = qqq_feats.loc[common_idx]
    spy = spy_feats.loc[common_idx]

    # Get BOS events for each
    qqq_bos = _breaks_of_structure(qqq)
    spy_bos = _breaks_of_structure(spy)

    # Rolling windows for "did BOS happen recently"
    qqq_bull_recent = qqq_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    qqq_bear_recent = qqq_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)
    spy_bull_recent = spy_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    spy_bear_recent = spy_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)

    # Pre-compute swing points once per symbol (not per bar)
    qqq_swings = _find_swing_points(qqq)
    spy_swings = _find_swing_points(spy)

    # Pre-compute numpy arrays for speed
    qqq_close = qqq["close"].to_numpy()
    qqq_high = qqq["high"].to_numpy()
    qqq_low = qqq["low"].to_numpy()
    qqq_atr = qqq["atr_14"].to_numpy()
    qqq_vol_pctile = qqq["volatility_pctile"].to_numpy()

    spy_close = spy["close"].to_numpy()
    spy_high = spy["high"].to_numpy()
    spy_low = spy["low"].to_numpy()
    spy_atr = spy["atr_14"].to_numpy()
    spy_vol_pctile = spy["volatility_pctile"].to_numpy()

    qqq_bull_arr = qqq_bull_recent.to_numpy()
    qqq_bear_arr = qqq_bear_recent.to_numpy()
    spy_bull_arr = spy_bull_recent.to_numpy()
    spy_bear_arr = spy_bear_recent.to_numpy()

    # Pre-compute swing high/low reference arrays
    qqq_swing_highs = (qqq_swings == "high").to_numpy()
    qqq_swing_lows = (qqq_swings == "low").to_numpy()
    spy_swing_highs = (spy_swings == "high").to_numpy()
    spy_swing_lows = (spy_swings == "low").to_numpy()

    events = []
    n = len(qqq)
    horizon = 20  # bars to track forward

    for i in range(n):
        bar_time = qqq.index[i]

        # Check for divergence
        if qqq_bull_arr[i] and not spy_bull_arr[i]:
            direction = "bullish"
            leader = "QQQ"
        elif qqq_bear_arr[i] and not spy_bear_arr[i]:
            direction = "bearish"
            leader = "QQQ"
        elif spy_bull_arr[i] and not qqq_bull_arr[i]:
            direction = "bullish"
            leader = "SPY"
        elif spy_bear_arr[i] and not qqq_bear_arr[i]:
            direction = "bearish"
            leader = "SPY"
        else:
            continue

        # Need enough forward bars
        if i + horizon >= n:
            continue

        # Select leader/follower arrays
        if leader == "QQQ":
            l_close, l_high, l_low, l_atr = qqq_close, qqq_high, qqq_low, qqq_atr
            l_vol = qqq_vol_pctile
            f_close, f_high, f_low = spy_close, spy_high, spy_low
            l_swing_highs, l_swing_lows = qqq_swing_highs, qqq_swing_lows
            f_swing_highs, f_swing_lows = spy_swing_highs, spy_swing_lows
            f_bull_arr, f_bear_arr = spy_bull_arr, spy_bear_arr
        else:
            l_close, l_high, l_low, l_atr = spy_close, spy_high, spy_low, spy_atr
            l_vol = spy_vol_pctile
            f_close, f_high, f_low = qqq_close, qqq_high, qqq_low
            l_swing_highs, l_swing_lows = spy_swing_highs, spy_swing_lows
            f_swing_highs, f_swing_lows = qqq_swing_highs, qqq_swing_lows
            f_bull_arr, f_bear_arr = qqq_bull_arr, qqq_bear_arr

        leader_close = l_close[i]
        leader_atr = l_atr[i]

        # Magnitude: how far leader's close broke its own structure (in ATR units)
        if direction == "bullish":
            swing_mask = l_swing_highs[:i]
            if not swing_mask.any():
                continue
            ref_high = l_high[:i][swing_mask][-1]
            magnitude = (leader_close - ref_high) / leader_atr if leader_atr > 0 else 0
        else:
            swing_mask = l_swing_lows[:i]
            if not swing_mask.any():
                continue
            ref_low = l_low[:i][swing_mask][-1]
            magnitude = (ref_low - leader_close) / leader_atr if leader_atr > 0 else 0

        # Structure distance: how far is the follower from its own structure?
        if direction == "bullish":
            f_swing_mask = f_swing_highs[:i]
            if f_swing_mask.any():
                f_ref = f_high[:i][f_swing_mask][-1]
                structure_distance = (f_ref - f_close[i]) / leader_atr if leader_atr > 0 else 0
            else:
                structure_distance = 0
        else:
            f_swing_mask = f_swing_lows[:i]
            if f_swing_mask.any():
                f_ref = f_low[:i][f_swing_mask][-1]
                structure_distance = (f_close[i] - f_ref) / leader_atr if leader_atr > 0 else 0
            else:
                structure_distance = 0

        # Volatility regime
        vol_regime = _volatility_regime(l_vol[i])

        # Forward returns (close-to-close)
        returns = {}
        for h in [1, 3, 5, 10, 20]:
            if i + h < n:
                returns[f"return_{h}"] = l_close[i + h] / leader_close - 1
            else:
                returns[f"return_{h}"] = np.nan

        # MFE / MAE in ATR units
        fwd_highs = l_high[i + 1 : i + horizon + 1]
        fwd_lows = l_low[i + 1 : i + horizon + 1]
        if direction == "bullish":
            mfe = (fwd_highs.max() - leader_close) / leader_atr if leader_atr > 0 else 0
            mae = (leader_close - fwd_lows.min()) / leader_atr if leader_atr > 0 else 0
        else:
            mfe = (leader_close - fwd_lows.min()) / leader_atr if leader_atr > 0 else 0
            mae = (fwd_highs.max() - leader_close) / leader_atr if leader_atr > 0 else 0

        # Resolution: did follower confirm within 5 bars?
        confirm_window = min(5, n - i - 1)
        if confirm_window > 0:
            if direction == "bullish":
                follower_confirmed = bool(f_bull_arr[i + 1 : i + 1 + confirm_window].any())
            else:
                follower_confirmed = bool(f_bear_arr[i + 1 : i + 1 + confirm_window].any())
        else:
            follower_confirmed = False

        # Resolution type: continuation vs mean reversion
        if direction == "bullish":
            f_swing_mask_recent = f_swing_highs[:i + 1]
            if f_swing_mask_recent.any():
                f_ref_high = f_high[:i + 1][f_swing_mask_recent][-1]
                resolved_as = "continuation" if leader_close > f_ref_high else "mean_reversion"
            else:
                resolved_as = "continuation"
        else:
            f_swing_mask_recent = f_swing_lows[:i + 1]
            if f_swing_mask_recent.any():
                f_ref_low = f_low[:i + 1][f_swing_mask_recent][-1]
                resolved_as = "continuation" if leader_close < f_ref_low else "mean_reversion"
            else:
                resolved_as = "continuation"

        events.append(DivergenceEvent(
            bar_time=bar_time,
            leader=leader,
            direction=direction,
            magnitude=magnitude,
            structure_distance=structure_distance,
            hour=bar_time.hour,
            volatility_regime=vol_regime,
            atr=leader_atr,
            return_1=returns["return_1"],
            return_3=returns["return_3"],
            return_5=returns["return_5"],
            return_10=returns["return_10"],
            return_20=returns["return_20"],
            mfe=mfe,
            mae=mae,
            resolved_as=resolved_as,
            follower_confirmed=follower_confirmed,
        ))

    return events


def _build_matched_controls(
    qqq_feats: pd.DataFrame, spy_feats: pd.DataFrame, events: list[DivergenceEvent], window: int = 5
) -> list[DivergenceEvent]:
    """For each divergence event, find a matched non-divergence bar with similar
    time-of-day and volatility regime, and record its forward outcomes the same way.
    """
    common_idx = qqq_feats.index.intersection(spy_feats.index)
    qqq = qqq_feats.loc[common_idx]
    spy = spy_feats.loc[common_idx]

    qqq_bos = _breaks_of_structure(qqq)
    spy_bos = _breaks_of_structure(spy)

    qqq_bull_recent = qqq_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    qqq_bear_recent = qqq_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)
    spy_bull_recent = spy_bos["bull_bos"].rolling(window, min_periods=1).max().astype(bool)
    spy_bear_recent = spy_bos["bear_bos"].rolling(window, min_periods=1).max().astype(bool)

    # Non-divergence mask: neither index has a recent BOS, or both have (confirmed)
    no_divergence = ~(qqq_bull_recent | qqq_bear_recent | spy_bull_recent | spy_bear_recent)

    controls = []
    n = len(qqq)
    horizon = 20

    # Pre-compute arrays
    qqq_close = qqq["close"].to_numpy()
    qqq_high = qqq["high"].to_numpy()
    qqq_low = qqq["low"].to_numpy()
    qqq_atr = qqq["atr_14"].to_numpy()
    qqq_vol_pctile = qqq["volatility_pctile"].to_numpy()
    qqq_hour = qqq.index.hour

    spy_close = spy["close"].to_numpy()
    spy_high = spy["high"].to_numpy()
    spy_low = spy["low"].to_numpy()
    spy_atr = spy["atr_14"].to_numpy()
    spy_vol_pctile = spy["volatility_pctile"].to_numpy()

    no_div_arr = no_divergence.to_numpy()

    # Pre-compute volatility regimes
    vol_regimes = np.array([_volatility_regime(v) for v in qqq_vol_pctile])

    for event in events:
        # Find bars with same hour and similar volatility regime, no divergence
        same_hour = qqq_hour == event.hour
        same_vol = vol_regimes == event.volatility_regime

        candidates = no_div_arr & same_hour & same_vol
        candidate_indices = np.where(candidates)[0]

        if len(candidate_indices) == 0:
            continue

        # Pick the closest match by ATR
        event_atr = event.atr
        candidate_atrs = qqq_atr[candidate_indices]
        closest_local = np.argmin(np.abs(candidate_atrs - event_atr))
        i = candidate_indices[closest_local]

        if i + horizon >= n:
            continue

        # Select leader/follower arrays
        if event.leader == "QQQ":
            l_close, l_high, l_low, l_atr = qqq_close, qqq_high, qqq_low, qqq_atr
        else:
            l_close, l_high, l_low, l_atr = spy_close, spy_high, spy_low, spy_atr

        leader_close = l_close[i]
        leader_atr = l_atr[i]

        returns = {}
        for h in [1, 3, 5, 10, 20]:
            if i + h < n:
                returns[f"return_{h}"] = l_close[i + h] / leader_close - 1
            else:
                returns[f"return_{h}"] = np.nan

        forward_highs = l_high[i + 1 : i + horizon + 1]
        forward_lows = l_low[i + 1 : i + horizon + 1]
        if event.direction == "bullish":
            mfe = (forward_highs.max() - leader_close) / leader_atr if leader_atr > 0 else 0
            mae = (leader_close - forward_lows.min()) / leader_atr if leader_atr > 0 else 0
        else:
            mfe = (leader_close - forward_lows.min()) / leader_atr if leader_atr > 0 else 0
            mae = (forward_highs.max() - leader_close) / leader_atr if leader_atr > 0 else 0

        controls.append(DivergenceEvent(
            bar_time=qqq.index[i],
            leader=event.leader,
            direction=event.direction,
            magnitude=0.0,  # no break for controls
            structure_distance=0.0,
            hour=qqq.index[i].hour,
            volatility_regime=event.volatility_regime,
            atr=leader_atr,
            return_1=returns["return_1"],
            return_3=returns["return_3"],
            return_5=returns["return_5"],
            return_10=returns["return_10"],
            return_20=returns["return_20"],
            mfe=mfe,
            mae=mae,
            resolved_as="none",
            follower_confirmed=False,
        ))

    return controls


def _summarize(events: list[DivergenceEvent], label: str) -> dict:
    """Compute summary statistics for a set of events."""
    if not events:
        return {"label": label, "n": 0}

    df = pd.DataFrame([asdict(e) for e in events])

    summary = {"label": label, "n": len(events)}
    for h in [1, 3, 5, 10, 20]:
        col = f"return_{h}"
        if col in df.columns:
            summary[f"mean_return_{h}"] = float(df[col].mean())
            summary[f"median_return_{h}"] = float(df[col].median())
            summary[f"p_positive_{h}"] = float((df[col] > 0).mean())

    summary["mean_mfe"] = float(df["mfe"].mean())
    summary["mean_mae"] = float(df["mae"].mean())
    summary["mean_magnitude"] = float(df["magnitude"].mean())

    # Breakdown by direction
    for direction in ["bullish", "bearish"]:
        subset = df[df["direction"] == direction]
        if len(subset) > 0:
            summary[f"{direction}_n"] = len(subset)
            summary[f"{direction}_mean_return_5"] = float(subset["return_5"].mean())
            summary[f"{direction}_mean_return_10"] = float(subset["return_10"].mean())
            summary[f"{direction}_p_positive_5"] = float((subset["return_5"] > 0).mean())

    # Breakdown by leader
    for leader in ["QQQ", "SPY"]:
        subset = df[df["leader"] == leader]
        if len(subset) > 0:
            summary[f"{leader}_n"] = len(subset)
            summary[f"{leader}_mean_return_5"] = float(subset["return_5"].mean())

    # Breakdown by volatility regime
    for regime in ["low", "normal", "high"]:
        subset = df[df["volatility_regime"] == regime]
        if len(subset) > 0:
            summary[f"vol_{regime}_n"] = len(subset)
            summary[f"vol_{regime}_mean_return_5"] = float(subset["return_5"].mean())

    # Resolution breakdown
    for res in ["continuation", "mean_reversion"]:
        subset = df[df["resolved_as"] == res]
        if len(subset) > 0:
            summary[f"resolved_{res}_n"] = len(subset)
            summary[f"resolved_{res}_mean_return_5"] = float(subset["return_5"].mean())

    summary["follower_confirmed_rate"] = float(df["follower_confirmed"].mean())

    return summary


def _mann_whitney_test(events: list[DivergenceEvent], controls: list[DivergenceEvent], horizon: int) -> dict:
    """Compare forward returns between divergence events and matched controls."""
    from scipy import stats

    event_returns = np.array([e.__dict__[f"return_{horizon}"] for e in events if not np.isnan(e.__dict__[f"return_{horizon}"])])
    control_returns = np.array([c.__dict__[f"return_{horizon}"] for c in controls if not np.isnan(c.__dict__[f"return_{horizon}"])])

    if len(event_returns) < 5 or len(control_returns) < 5:
        return {"horizon": horizon, "n_events": len(event_returns), "n_controls": len(control_returns), "testable": False}

    u_stat, p_value = stats.mannwhitneyu(event_returns, control_returns, alternative="two-sided")
    effect_size = (2 * u_stat) / (len(event_returns) * len(control_returns)) - 1

    return {
        "horizon": horizon,
        "n_events": len(event_returns),
        "n_controls": len(control_returns),
        "event_mean": float(event_returns.mean()),
        "control_mean": float(control_returns.mean()),
        "difference": float(event_returns.mean() - control_returns.mean()),
        "effect_size": float(effect_size),
        "p_value": float(p_value),
        "testable": True,
    }


def main():
    parser = argparse.ArgumentParser(description="Divergence event study")
    parser.add_argument("--interval", default="15Min", help="Alpaca format, e.g. 15Min/1Hour/1Day")
    parser.add_argument("--start", default="2020-01-01", help="Start date")
    parser.add_argument("--end", default="2024-12-31", help="End date")
    parser.add_argument("--window", type=int, default=5, help="BOS lookback window for divergence detection")
    parser.add_argument("--output", default="divergence_event_study_results.json", help="Output file for results")
    args = parser.parse_args()

    print(f"[{datetime.now(timezone.utc).isoformat()}] Divergence event study")
    print(f"  interval={args.interval}, start={args.start}, end={args.end}, window={args.window}")

    # Fetch data
    print("  fetching QQQ bars...")
    qqq_raw = get_stock_candles("QQQ", args.interval, args.start, args.end)
    print("  fetching SPY bars...")
    spy_raw = get_stock_candles("SPY", args.interval, args.start, args.end)

    if qqq_raw.empty or spy_raw.empty:
        print("  ERROR: no data fetched for one or both symbols")
        return

    print(f"  QQQ: {len(qqq_raw)} bars, SPY: {len(spy_raw)} bars")

    # Build features (includes divergence features)
    print("  building features...")
    qqq_feats = build_features(qqq_raw, spy_raw)
    spy_feats = build_features(spy_raw, qqq_raw)

    common_idx = qqq_feats.index.intersection(spy_feats.index)
    qqq_feats = qqq_feats.loc[common_idx]
    spy_feats = spy_feats.loc[common_idx]
    print(f"  aligned: {len(qqq_feats)} common bars")

    # Detect divergence events
    print("  detecting divergence events...")
    events = _detect_events(qqq_feats, spy_feats, window=args.window)
    print(f"  found {len(events)} divergence events")

    # Build matched controls
    print("  building matched controls...")
    controls = _build_matched_controls(qqq_feats, spy_feats, events, window=args.window)
    print(f"  built {len(controls)} matched controls")

    # Summarize
    event_summary = _summarize(events, "divergence_events")
    control_summary = _summarize(controls, "matched_controls")

    # Statistical tests
    tests = []
    for h in [1, 3, 5, 10, 20]:
        tests.append(_mann_whitney_test(events, controls, h))

    # Print results
    print("\n" + "=" * 80)
    print("DIVERGENCE EVENT STUDY RESULTS")
    print("=" * 80)

    print(f"\nTotal divergence events: {len(events)}")
    print(f"Total matched controls: {len(controls)}")

    print("\n--- Divergence Events Summary ---")
    for key, val in event_summary.items():
        if isinstance(val, float):
            print(f"  {key}: {val:.6f}")
        else:
            print(f"  {key}: {val}")

    print("\n--- Matched Controls Summary ---")
    for key, val in control_summary.items():
        if isinstance(val, float):
            print(f"  {key}: {val:.6f}")
        else:
            print(f"  {key}: {val}")

    print("\n--- Statistical Tests (Mann-Whitney U vs matched controls) ---")
    for t in tests:
        if t["testable"]:
            sig = "*" if t["p_value"] < 0.05 else ""
            print(f"  {t['horizon']}-bar: events={t['event_mean']:.6f} vs controls={t['control_mean']:.6f} "
                  f"diff={t['difference']:.6f} effect={t['effect_size']:.4f} p={t['p_value']:.4f} {sig}")
        else:
            print(f"  {t['horizon']}-bar: not enough data (events={t['n_events']}, controls={t['n_controls']})")

    # Save full results
    results = {
        "parameters": {
            "interval": args.interval,
            "start": args.start,
            "end": args.end,
            "window": args.window,
        },
        "event_summary": event_summary,
        "control_summary": control_summary,
        "statistical_tests": tests,
        "events": [asdict(e) for e in events],
        "controls": [asdict(c) for c in controls],
    }

    with open(args.output, "w") as f:
        json.dump(results, f, indent=2, default=str)
    print(f"\nFull results saved to {args.output}")


if __name__ == "__main__":
    main()