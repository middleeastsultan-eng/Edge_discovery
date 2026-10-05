"""Performance statistics computed from a list of trade R-multiples."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class TradeStats:
    n_trades: int
    win_rate: float
    expectancy_r: float
    profit_factor: float
    sharpe: float
    max_drawdown_r: float
    avg_win_r: float
    avg_loss_r: float

    def as_dict(self) -> dict:
        return self.__dict__.copy()


def compute_stats(r_multiples: np.ndarray | pd.Series) -> TradeStats:
    r = np.asarray(r_multiples, dtype=float)
    n = len(r)

    if n == 0:
        return TradeStats(0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)

    wins = r[r > 0]
    losses = r[r <= 0]

    win_rate = len(wins) / n
    avg_win = wins.mean() if len(wins) else 0.0
    avg_loss = losses.mean() if len(losses) else 0.0
    expectancy = r.mean()

    gross_profit = wins.sum()
    gross_loss = -losses.sum()
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else np.inf if gross_profit > 0 else 0.0

    sharpe = (r.mean() / r.std(ddof=1)) * np.sqrt(n) if n > 1 and r.std(ddof=1) > 0 else 0.0

    equity = np.cumsum(r)
    running_max = np.maximum.accumulate(equity)
    drawdown = running_max - equity
    max_dd = drawdown.max() if n else 0.0

    return TradeStats(
        n_trades=n,
        win_rate=round(win_rate, 4),
        expectancy_r=round(expectancy, 4),
        profit_factor=round(float(profit_factor), 4) if np.isfinite(profit_factor) else float("inf"),
        sharpe=round(float(sharpe), 4),
        max_drawdown_r=round(float(max_dd), 4),
        avg_win_r=round(float(avg_win), 4),
        avg_loss_r=round(float(avg_loss), 4),
    )
