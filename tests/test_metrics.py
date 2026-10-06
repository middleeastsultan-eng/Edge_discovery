"""Regression tests for trading_lab/metrics.py's compute_stats -- hand-computed
expected values, so a future refactor can't silently change the formulas.
"""
from __future__ import annotations

import numpy as np
import pytest

from trading_lab.metrics import compute_stats


def test_empty_input_returns_zeroed_stats():
    stats = compute_stats([])
    assert stats.n_trades == 0
    assert stats.expectancy_r == 0.0
    assert stats.profit_factor == 0.0


def test_known_values():
    # 3 wins of +1R, 2 losses of -1R -- hand-computable by inspection.
    r = [1.0, 1.0, 1.0, -1.0, -1.0]
    stats = compute_stats(r)
    assert stats.n_trades == 5
    assert stats.win_rate == pytest.approx(0.6)
    assert stats.expectancy_r == pytest.approx(0.2)  # (3 - 2) / 5
    assert stats.profit_factor == pytest.approx(3 / 2)
    assert stats.avg_win_r == pytest.approx(1.0)
    assert stats.avg_loss_r == pytest.approx(-1.0)


def test_profit_factor_infinite_with_zero_losses():
    stats = compute_stats([1.0, 2.0, 0.5])
    assert stats.profit_factor == float("inf")


def test_profit_factor_zero_with_zero_wins():
    stats = compute_stats([-1.0, -2.0])
    assert stats.profit_factor == 0.0


def test_max_drawdown_uses_chronological_order():
    """Drawdown is path-dependent -- compute_stats trusts its input is already in
    chronological order (callers must sort). A win-then-loss sequence and a
    loss-then-win sequence have the same final equity but different drawdowns.
    """
    win_then_loss = compute_stats([2.0, -1.0])
    loss_then_win = compute_stats([-1.0, 2.0])
    # win_then_loss: equity path [2, 1], peak 2, trough 1 -> drawdown 1.
    # loss_then_win: equity path [-1, 1], peak 1 (at the end) -> drawdown 0 (never below start... actually
    # peak tracks running max: running_max=[-1,1], drawdown=[0,0] -> max_dd 0.
    assert win_then_loss.max_drawdown_r == pytest.approx(1.0)
    assert loss_then_win.max_drawdown_r == pytest.approx(0.0)
