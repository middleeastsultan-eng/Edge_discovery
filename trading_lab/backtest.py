"""Non-overlapping trade simulator with ATR-based stop/target, fees and slippage.

Supports both long and short positions. Deliberately simple (v0.1): one trade at a
time, fixed R-multiple exits, next-bar entry. This is the piece that must be
trustworthy before anything else matters.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class BacktestConfig:
    sl_atr: float = 1.0
    tp_atr: float = 2.0
    max_holding_bars: int = 48
    fee_bps: float = 4.0       # per side, in basis points of notional
    slippage_bps: float = 2.0  # per side, in basis points of notional
    direction: str = "long"    # "long" or "short"


def run_backtest(df: pd.DataFrame, entry_signal: pd.Series, config: BacktestConfig = BacktestConfig()) -> pd.DataFrame:
    """Simulate trades triggered by entry_signal against df's OHLC + atr_14 column.

    Supports both long and short positions via config.direction. For long positions,
    stop is below entry and target is above. For short positions, stop is above entry
    and target is below.

    Returns a DataFrame of closed trades: entry_time, exit_time, entry_price, exit_price,
    exit_reason, r_multiple, bars_held.
    """
    assert "atr_14" in df.columns, "df must include atr_14 (run build_features first)"
    assert config.direction in ("long", "short"), f"direction must be 'long' or 'short', got {config.direction!r}"

    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    atr = df["atr_14"].to_numpy()
    idx = df.index
    signal = entry_signal.reindex(df.index).fillna(False).to_numpy()

    n = len(df)
    fee_frac = config.fee_bps / 10_000
    slip_frac = config.slippage_bps / 10_000
    is_long = config.direction == "long"

    trades = []
    i = 0
    while i < n - 1:
        if not signal[i]:
            i += 1
            continue

        entry_idx = i + 1  # enter at next bar's open
        if entry_idx >= n:
            break

        raw_entry = opens[entry_idx]
        entry_atr = atr[i]

        if is_long:
            # Long: buy at open, stop below, target above
            entry_price = raw_entry * (1 + slip_frac)  # buying: slippage worsens fill
            stop_price = raw_entry - config.sl_atr * entry_atr
            target_price = raw_entry + config.tp_atr * entry_atr
        else:
            # Short: sell at open, stop above, target below
            entry_price = raw_entry * (1 - slip_frac)  # selling: slippage worsens fill
            stop_price = raw_entry + config.sl_atr * entry_atr
            target_price = raw_entry - config.tp_atr * entry_atr

        exit_price = None
        exit_reason = None
        exit_j = None

        last_bar = min(entry_idx + config.max_holding_bars, n - 1)
        for j in range(entry_idx, last_bar + 1):
            if is_long:
                if lows[j] <= stop_price:
                    exit_price = stop_price * (1 - slip_frac)
                    exit_reason = "stop"
                    exit_j = j
                    break
                if highs[j] >= target_price:
                    exit_price = target_price * (1 - slip_frac)
                    exit_reason = "target"
                    exit_j = j
                    break
            else:
                if highs[j] >= stop_price:
                    exit_price = stop_price * (1 + slip_frac)
                    exit_reason = "stop"
                    exit_j = j
                    break
                if lows[j] <= target_price:
                    exit_price = target_price * (1 + slip_frac)
                    exit_reason = "target"
                    exit_j = j
                    break

        if exit_price is None:
            if last_bar >= n - 1:
                # No bar exists after last_bar to use as a genuine exit fill -- we're at
                # the edge of the available data, so this position's true outcome (stop,
                # target, or a real time-exit) isn't knowable yet. Stop here rather than
                # fabricate a close with a price that isn't actually a forward fill;
                # there's nothing further the loop could correctly evaluate anyway.
                break
            # The decision to give up is only knowable once last_bar has fully closed
            # without hitting stop/target, so (same no-look-ahead reasoning as entries)
            # the fill happens at the FOLLOWING bar's open -- exit_j must point at that
            # bar, not last_bar itself, so exit_time/bars_held reflect when the position
            # actually closed rather than the bar that merely triggered the decision.
            exit_j = last_bar + 1
            if is_long:
                exit_price = opens[exit_j] * (1 - slip_frac)
            else:
                exit_price = opens[exit_j] * (1 + slip_frac)
            exit_reason = "time"

        # R-multiple: for longs, (exit - entry) / (entry - stop); for shorts, (entry - exit) / (stop - entry)
        # Both normalize to "how many times the risk did we make/lose"
        risk = config.sl_atr * entry_atr
        if is_long:
            gross_r = (exit_price - entry_price) / risk
        else:
            gross_r = (entry_price - exit_price) / risk
        fee_r = (fee_frac * 2) / (risk / raw_entry)
        r_multiple = gross_r - fee_r

        trades.append({
            "entry_time": idx[entry_idx],
            "exit_time": idx[exit_j],
            "entry_price": entry_price,
            "exit_price": exit_price,
            "exit_reason": exit_reason,
            "r_multiple": r_multiple,
            "bars_held": exit_j - entry_idx,
        })

        i = exit_j + 1  # no overlapping trades

    return pd.DataFrame(trades)
