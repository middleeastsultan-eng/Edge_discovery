"""Long-only, non-overlapping trade simulator with ATR-based stop/target, fees and slippage.

Deliberately simple (v0.1): one trade at a time, fixed R-multiple exits, next-bar entry.
This is the piece that must be trustworthy before anything else matters.
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


def run_backtest(df: pd.DataFrame, entry_signal: pd.Series, config: BacktestConfig = BacktestConfig()) -> pd.DataFrame:
    """Simulate long trades triggered by entry_signal against df's OHLC + atr_14 column.

    Returns a DataFrame of closed trades: entry_time, exit_time, entry_price, exit_price,
    exit_reason, r_multiple, bars_held.
    """
    assert "atr_14" in df.columns, "df must include atr_14 (run build_features first)"

    opens = df["open"].to_numpy()
    highs = df["high"].to_numpy()
    lows = df["low"].to_numpy()
    atr = df["atr_14"].to_numpy()
    idx = df.index
    signal = entry_signal.reindex(df.index).fillna(False).to_numpy()

    n = len(df)
    fee_frac = config.fee_bps / 10_000
    slip_frac = config.slippage_bps / 10_000

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
        entry_price = raw_entry * (1 + slip_frac)  # buying: slippage worsens fill
        entry_atr = atr[i]
        stop_price = raw_entry - config.sl_atr * entry_atr
        target_price = raw_entry + config.tp_atr * entry_atr

        exit_price = None
        exit_reason = None
        exit_j = None

        last_bar = min(entry_idx + config.max_holding_bars, n - 1)
        for j in range(entry_idx, last_bar + 1):
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

        if exit_price is None:
            exit_j = last_bar
            exit_price = opens[min(exit_j + 1, n - 1)] * (1 - slip_frac)
            exit_reason = "time"

        gross_r = (exit_price - raw_entry) / (config.sl_atr * entry_atr)
        fee_r = (fee_frac * 2) / ((config.sl_atr * entry_atr) / raw_entry)
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
