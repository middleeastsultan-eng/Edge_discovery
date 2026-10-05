"""The full research pipeline as one reusable call: fetch -> discover -> validate -> score.

Shared by run_research.py (one detailed interactive run) and run_overnight.py
(many unattended runs with Telegram notification on anything that passes).
"""

from __future__ import annotations

from . import db
from .backtest import BacktestConfig
from .data import get_candles
from .data_stocks import get_stock_candles
from .discovery import Candidate, search
from .features import build_features
from .metrics import TradeStats
from .validate import (
    chronological_split,
    cost_stress,
    evaluate_candidate,
    monte_carlo,
    parameter_perturbation,
    parameter_stability_score,
    robustness_score,
    walk_forward,
)


def run_experiment(
    symbol: str,
    interval: str,
    start: str,
    end: str,
    n_candidates: int = 3000,
    min_trades: int = 30,
    seed: int = 42,
    save: bool = True,
    source: str = "crypto",
) -> dict | None:
    """Run one full discovery + validation cycle. Returns None if no candidate
    produced enough trades, otherwise a dict with every stage's results.

    source: "crypto" (Binance, interval like "1h") or "stocks" (Alpaca SPY/QQQ,
    interval like "15Min" -- Alpaca's own timeframe format).
    """
    if source == "stocks":
        raw = get_stock_candles(symbol, interval, start, end)
    else:
        raw = get_candles(symbol, interval, start, end)
    feats = build_features(raw)
    discovery_df, val_df, test_df = chronological_split(feats)
    config = BacktestConfig()

    results = search(discovery_df, n_candidates=n_candidates, min_trades=min_trades, backtest_config=config, seed=seed)
    if results.empty:
        return None

    best = results.iloc[0]
    clauses = best["clauses"]
    cand_obj = Candidate(clauses=clauses)
    discovery_stats = TradeStats(
        n_trades=int(best["n_trades"]),
        win_rate=float(best["win_rate"]),
        expectancy_r=float(best["expectancy_r"]),
        profit_factor=float(best["profit_factor"]),
        sharpe=float(best["sharpe"]),
        max_drawdown_r=float(best["max_drawdown_r"]),
        avg_win_r=float(best["avg_win_r"]),
        avg_loss_r=float(best["avg_loss_r"]),
    )

    val_stats, val_trades = evaluate_candidate(val_df, cand_obj, config)
    test_stats, test_trades = evaluate_candidate(test_df, cand_obj, config)
    wf = walk_forward(feats, cand_obj, n_windows=6, config=config)
    mc = monte_carlo(test_trades["r_multiple"]) if len(test_trades) else None
    cs = cost_stress(test_df, cand_obj, config)
    pert = parameter_perturbation(discovery_df, cand_obj, config)
    stability = parameter_stability_score(pert)
    score = robustness_score(discovery_stats, val_stats, test_stats, wf, stability, cs)

    experiment_id = None
    if save:
        experiment_id = db.save_experiment(
            symbol=symbol,
            interval=interval,
            start_date=start,
            end_date=end,
            rule=best["rule"],
            clauses=clauses,
            discovery_stats=discovery_stats.as_dict(),
            validation_stats=val_stats.as_dict(),
            test_stats=test_stats.as_dict(),
            walk_forward=wf,
            monte_carlo=mc,
            cost_stress=cs,
            parameter_stability={"score": stability, "perturbations": pert.to_dict(orient="records")},
            robustness_score=score,
        )
        db.save_trades(experiment_id, val_trades, "validation")
        db.save_trades(experiment_id, test_trades, "test")

    return {
        "experiment_id": experiment_id,
        "symbol": symbol,
        "interval": interval,
        "rule": best["rule"],
        "discovery_results": results,
        "discovery_stats": discovery_stats,
        "validation_stats": val_stats,
        "validation_trades": val_trades,
        "test_stats": test_stats,
        "test_trades": test_trades,
        "walk_forward": wf,
        "monte_carlo": mc,
        "cost_stress": cs,
        "parameter_stability_score": stability,
        "parameter_perturbation": pert,
        "robustness_score": score,
    }


def is_pass(result: dict) -> bool:
    """Same bar the dashboard uses: both independent splits need >=10 trades and positive expectancy."""
    v, t = result["validation_stats"], result["test_stats"]
    return v.n_trades >= 10 and v.expectancy_r > 0 and t.n_trades >= 10 and t.expectancy_r > 0
