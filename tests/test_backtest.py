"""Regression tests for trading_lab/backtest.py -- the core trade simulator.

Each test here corresponds to a real bug found and fixed in this codebase (either
this session or earlier in the project's history). The point of these tests isn't
coverage for its own sake -- it's making sure these EXACT mistakes can't silently
come back in a future edit without a test going red.
"""
from __future__ import annotations

import pandas as pd
import pytest

from trading_lab.backtest import BacktestConfig, run_backtest


def _flat_df(n: int, price: float = 100.0, atr: float = 1.0, freq: str = "1h") -> pd.DataFrame:
    idx = pd.date_range("2024-01-01", periods=n, freq=freq, tz="UTC")
    return pd.DataFrame(
        {"open": price, "high": price + 0.05, "low": price - 0.05, "close": price, "atr_14": atr},
        index=idx,
    )


def test_time_exit_timestamp_matches_actual_fill_bar():
    """Regression for a real bug: a time-exit's recorded exit_time used to point at
    the bar whose CLOSE triggered the decision, not the bar whose OPEN was actually
    used as the fill price (the fill itself was always priced correctly -- only the
    label was wrong). bars_held must also reflect the true holding period through
    the real fill bar.
    """
    df = _flat_df(60)
    signal = pd.Series(False, index=df.index)
    signal.iloc[0] = True  # fires once; price never moves, so this can only time-exit

    config = BacktestConfig(sl_atr=1.0, tp_atr=2.0, max_holding_bars=5)
    trades = run_backtest(df, signal, config)

    assert len(trades) == 1
    trade = trades.iloc[0]
    entry_idx = 1  # signal at bar 0 -> entry at bar 1's open
    last_bar = entry_idx + config.max_holding_bars  # = 6, the last bar checked for stop/target
    fill_bar = last_bar + 1  # the decision is only knowable once last_bar closes; fill is the NEXT bar's open

    assert trade["exit_reason"] == "time"
    assert trade["exit_time"] == df.index[fill_bar]
    assert trade["bars_held"] == fill_bar - entry_idx


def test_no_fabricated_exit_at_data_boundary():
    """Regression: when max_holding_bars would push the time-exit past the end of
    available data, there is no genuine next-bar price to fill at -- the trade must
    be silently dropped (not fabricated from a price that was never actually
    observed as a forward fill).
    """
    df = _flat_df(10)
    signal = pd.Series(False, index=df.index)
    signal.iloc[0] = True

    config = BacktestConfig(sl_atr=1.0, tp_atr=2.0, max_holding_bars=50)  # far exceeds available bars
    trades = run_backtest(df, signal, config)

    assert len(trades) == 0


def test_entry_is_next_bar_open_not_signal_bar():
    """No look-ahead: a signal observed as of bar i's close can only be acted on at
    bar i+1's open, never at bar i's own price.
    """
    n = 20
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    opens = [100.0 + i for i in range(n)]  # distinct, monotonic -- makes misalignment obvious
    df = pd.DataFrame(
        {"open": opens, "high": [o + 50 for o in opens], "low": [o - 50 for o in opens],
         "close": opens, "atr_14": 1.0},
        index=idx,
    )
    signal = pd.Series(False, index=idx)
    signal.iloc[3] = True

    trades = run_backtest(df, signal, BacktestConfig(sl_atr=1.0, tp_atr=2.0))
    assert len(trades) == 1
    assert trades.iloc[0]["entry_time"] == idx[4]


def test_entry_slippage_increases_buy_price():
    """Buying costs more with slippage -- entry_price must exceed the raw bar open."""
    df = _flat_df(10)
    signal = pd.Series(False, index=df.index)
    signal.iloc[0] = True
    config = BacktestConfig(slippage_bps=50.0, max_holding_bars=5)  # small enough to fit the test window
    trades = run_backtest(df, signal, config)
    assert len(trades) == 1
    assert trades.iloc[0]["entry_price"] > df["open"].iloc[1]


def test_stop_hit_produces_negative_r_multiple():
    """A clean stop-out (price only ever falls) must price as a loss."""
    n = 10
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    df = pd.DataFrame(
        {"open": 100.0, "high": 100.0, "low": [100.0] + [90.0] * (n - 1), "close": 100.0, "atr_14": 1.0},
        index=idx,
    )
    signal = pd.Series(False, index=idx)
    signal.iloc[0] = True
    trades = run_backtest(df, signal, BacktestConfig(sl_atr=1.0, tp_atr=2.0, fee_bps=0, slippage_bps=0))
    assert len(trades) == 1
    assert trades.iloc[0]["exit_reason"] == "stop"
    assert trades.iloc[0]["r_multiple"] < 0


def test_target_hit_produces_positive_r_multiple():
    """A clean target hit (price only ever rises) must price as a win."""
    n = 10
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    df = pd.DataFrame(
        {"open": 100.0, "high": [100.0] + [110.0] * (n - 1), "low": 100.0, "close": 100.0, "atr_14": 1.0},
        index=idx,
    )
    signal = pd.Series(False, index=idx)
    signal.iloc[0] = True
    trades = run_backtest(df, signal, BacktestConfig(sl_atr=1.0, tp_atr=2.0, fee_bps=0, slippage_bps=0))
    assert len(trades) == 1
    assert trades.iloc[0]["exit_reason"] == "target"
    assert trades.iloc[0]["r_multiple"] > 0


def test_no_overlapping_trades():
    """Trades must never overlap -- the next scan always resumes strictly after the
    previous trade's exit fill bar.
    """
    n = 200
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    df = pd.DataFrame({"open": 100.0, "high": 100.5, "low": 99.5, "close": 100.0, "atr_14": 1.0}, index=idx)
    signal = pd.Series(True, index=idx)  # fires on every bar -- maximally stresses overlap handling

    trades = run_backtest(df, signal, BacktestConfig(max_holding_bars=5))
    entries = trades["entry_time"].tolist()
    exits = trades["exit_time"].tolist()
    for i in range(1, len(trades)):
        assert entries[i] > exits[i - 1], "a later trade entered before the previous one's recorded exit"


def test_short_stop_hit_produces_negative_r_multiple():
    """A short position where price only rises must hit the stop (above entry) and lose."""
    n = 10
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    df = pd.DataFrame(
        {"open": 100.0, "high": [100.0] + [110.0] * (n - 1), "low": 100.0, "close": 100.0, "atr_14": 1.0},
        index=idx,
    )
    signal = pd.Series(False, index=idx)
    signal.iloc[0] = True
    trades = run_backtest(df, signal, BacktestConfig(sl_atr=1.0, tp_atr=2.0, fee_bps=0, slippage_bps=0, direction="short"))
    assert len(trades) == 1
    assert trades.iloc[0]["exit_reason"] == "stop"
    assert trades.iloc[0]["r_multiple"] < 0


def test_short_target_hit_produces_positive_r_multiple():
    """A short position where price only falls must hit the target (below entry) and win."""
    n = 10
    idx = pd.date_range("2024-01-01", periods=n, freq="1h", tz="UTC")
    df = pd.DataFrame(
        {"open": 100.0, "high": 100.0, "low": [100.0] + [90.0] * (n - 1), "close": 100.0, "atr_14": 1.0},
        index=idx,
    )
    signal = pd.Series(False, index=idx)
    signal.iloc[0] = True
    trades = run_backtest(df, signal, BacktestConfig(sl_atr=1.0, tp_atr=2.0, fee_bps=0, slippage_bps=0, direction="short"))
    assert len(trades) == 1
    assert trades.iloc[0]["exit_reason"] == "target"
    assert trades.iloc[0]["r_multiple"] > 0


def test_short_entry_slippage_decreases_sell_price():
    """Shorting costs more with slippage -- entry_price must be below the raw bar open."""
    df = _flat_df(10)
    signal = pd.Series(False, index=df.index)
    signal.iloc[0] = True
    config = BacktestConfig(slippage_bps=50.0, max_holding_bars=5, direction="short")
    trades = run_backtest(df, signal, config)
    assert len(trades) == 1
    assert trades.iloc[0]["entry_price"] < df["open"].iloc[1]
