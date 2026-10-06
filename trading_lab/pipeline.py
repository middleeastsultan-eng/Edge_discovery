"""The full research pipeline: fetch -> discover -> funnel -> validate -> score.

Shared by run_research.py (one detailed interactive run) and run_overnight.py /
run_scheduled.py (unattended runs with Telegram notification on anything that passes).

IMPORTANT: this does NOT just keep the single best-scoring discovery candidate.
Picking the #1 performer out of hundreds of random candidates and only then testing
it is itself a form of overfitting -- the candidate most likely to have benefited
from discovery-set noise is exactly the one that selection process favors. Instead:

    800 candidates (discovery)
          |
    keep top-K by discovery score
          |
    evaluate each on validation data (never touched before this point)
          |
    keep survivors: positive validation expectancy + enough trades
          |
    rank survivors by VALIDATION score (not test), keep a handful of finalists
          |
    each finalist gets the full validation suite: test set, walk-forward,
    cost stress, parameter perturbation, robustness score
          |
    finalists are reported as-is -- never cherry-picked by test performance
"""

from __future__ import annotations

import pandas as pd

from . import db
from .backtest import BacktestConfig
from .cross_asset import PAIRED_INDEX
from .data import get_candles
from .data_stocks import get_stock_candles
from .discovery import Candidate, Clause, search
from .features import build_features
from .live import TRACKING_MIN_SCORE
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


def _fetch_paired_index(symbol: str, interval: str, start: str, end: str, source: str) -> pd.DataFrame | None:
    """Fetches the OTHER tracked index's raw OHLCV for the cross-asset structure-
    divergence features (see cross_asset.py) -- QQQ's pair is SPY and vice versa. None
    if this symbol has no defined pair (anything other than QQQ/SPY) or isn't stocks.
    """
    other_symbol = PAIRED_INDEX.get(symbol)
    if other_symbol is None or source != "stocks":
        return None
    return get_stock_candles(other_symbol, interval, start, end)


def run_experiment(
    symbol: str,
    interval: str,
    start: str,
    end: str,
    n_candidates: int = 3000,
    discovery_min_trades: int = 100,
    validation_min_trades: int = 30,
    test_min_trades: int = 30,
    funnel_top_k: int = 30,
    max_finalists: int = 3,
    seed: int = 42,
    save: bool = True,
    source: str = "crypto",
) -> dict:
    """Run one full discovery-through-validation cycle.

    Returns a dict with "hypotheses_tested", funnel counts at each stage, and a
    "finalists" list (0 to max_finalists dicts, each with its own full validation
    results) -- there is no single "the" result anymore, by design.
    """
    if source == "stocks":
        raw = get_stock_candles(symbol, interval, start, end)
    else:
        raw = get_candles(symbol, interval, start, end)

    other_raw = _fetch_paired_index(symbol, interval, start, end, source)
    feats = build_features(raw, other_raw)
    discovery_df, val_df, test_df = chronological_split(feats)
    config = BacktestConfig()

    discovery_results, counts = search(
        discovery_df, n_candidates=n_candidates, min_trades=discovery_min_trades,
        backtest_config=config, seed=seed,
    )

    summary = {
        "hypotheses_tested": n_candidates,
        "level1_survivors": counts["level1_survivors"],
        "statistically_interesting": counts["statistically_interesting"],
        "research_worthy": counts["research_worthy"],
        "discovery_survivors": len(discovery_results),
        "funnel_top_k": 0,
        "validation_survivors": 0,
        "finalists": [],
    }

    if discovery_results.empty:
        if save:
            db.save_research_run(
                symbol, interval, source, seed, n_candidates,
                counts["level1_survivors"], counts["statistically_interesting"], counts["research_worthy"],
                0, 0, 0, 0,
            )
        return summary

    top_candidates = discovery_results.head(funnel_top_k)
    summary["funnel_top_k"] = len(top_candidates)

    # Validate every top-K candidate against data none of them were selected against.
    survivors = []
    for _, row in top_candidates.iterrows():
        cand_obj = Candidate(clauses=row["clauses"])
        val_stats, val_trades = evaluate_candidate(val_df, cand_obj, config)
        if val_stats.n_trades >= validation_min_trades and val_stats.expectancy_r > 0:
            survivors.append((row, cand_obj, val_stats, val_trades))

    summary["validation_survivors"] = len(survivors)

    # Rank by VALIDATION performance (not test) to pick finalists -- test is only
    # spent once, on whichever finalists validation already selected.
    survivors.sort(key=lambda s: s[2].expectancy_r, reverse=True)
    finalist_inputs = survivors[:max_finalists]

    research_run_id = None
    if save:
        research_run_id = db.save_research_run(
            symbol, interval, source, seed, n_candidates,
            counts["level1_survivors"], counts["statistically_interesting"], counts["research_worthy"],
            len(discovery_results), len(top_candidates), len(survivors), len(finalist_inputs),
        )

    for row, cand_obj, val_stats, val_trades in finalist_inputs:
        test_stats, test_trades = evaluate_candidate(test_df, cand_obj, config)
        if test_stats.n_trades < test_min_trades:
            continue

        discovery_stats = TradeStats(
            n_trades=int(row["n_trades"]),
            win_rate=float(row["win_rate"]),
            expectancy_r=float(row["expectancy_r"]),
            profit_factor=float(row["profit_factor"]),
            sharpe=float(row["sharpe"]),
            max_drawdown_r=float(row["max_drawdown_r"]),
            avg_win_r=float(row["avg_win_r"]),
            avg_loss_r=float(row["avg_loss_r"]),
        )

        # Out-of-sample only (validation+test, chronologically concatenated) -- walk_forward
        # exists specifically to check consistency across independent windows the rule
        # wasn't fit to. Running it over the full `feats` range (as this used to do) put
        # the discovery window's own fitting data inside several of the "consistency"
        # windows -- on a typical 60/20/20 split, 3 of 6 windows landed ENTIRELY inside
        # the discovery range (confirmed directly: windows 1-3 were 100% in-sample, window
        # 4 was 60% in-sample), where the rule is close to guaranteed to look good since
        # that's literally the data it was selected for. That silently inflated
        # walk_forward_stability -- one of robustness_score's components -- for every
        # candidate, the opposite of what the rest of the scoring scheme is careful about.
        oos_df = pd.concat([val_df, test_df])
        wf = walk_forward(oos_df, cand_obj, n_windows=6, config=config)
        mc = monte_carlo(test_trades["r_multiple"]) if len(test_trades) else None
        cs = cost_stress(test_df, cand_obj, config)
        pert = parameter_perturbation(discovery_df, cand_obj, config)
        stability = parameter_stability_score(pert)
        score = robustness_score(discovery_stats, val_stats, test_stats, wf, stability, cs, test_trades)

        experiment_id = None
        if save:
            experiment_id = db.save_experiment(
                symbol=symbol, interval=interval, start_date=start, end_date=end,
                rule=row["rule"], clauses=row["clauses"],
                discovery_stats=discovery_stats.as_dict(),
                validation_stats=val_stats.as_dict(),
                test_stats=test_stats.as_dict(),
                walk_forward=wf, monte_carlo=mc, cost_stress=cs,
                parameter_stability={"score": stability, "perturbations": pert.to_dict(orient="records")},
                robustness_score=score,
                research_run_id=research_run_id,
                information_test=row.get("information"),
                source=source,
            )
            db.save_trades(experiment_id, val_trades, "validation")
            db.save_trades(experiment_id, test_trades, "test")

        summary["finalists"].append({
            "experiment_id": experiment_id,
            "symbol": symbol,
            "interval": interval,
            "rule": row["rule"],
            "information_test": row.get("information"),
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
        })

    return summary


def run_reddit_experiment(
    clauses: list,
    symbol: str,
    interval: str,
    start: str,
    end: str,
    reddit_strategy_id: int,
    validation_min_trades: int = 30,
    test_min_trades: int = 30,
    save: bool = True,
    source: str = "crypto",
) -> dict | None:
    """Runs an already-built candidate (translated from a Reddit post by
    reddit_scan.extract_strategy, not found by random search) through the exact same
    validation suite run_experiment() gives a discovery finalist -- chronological split,
    walk-forward, cost stress, parameter perturbation, robustness score. The only
    difference is there's no search step and no "discovery set" the rule was found on;
    the first chronological slice is evaluated the same way anyway so robustness_score's
    degradation check (test retained vs. discovery) still has a baseline to compare
    against, on equal footing with how discovery candidates are scored.

    Returns None (doesn't save) if the rule doesn't clear the trade-count bar on
    validation or test data -- a Reddit-sourced rule gets no free pass research
    candidates don't get either.
    """
    if source == "stocks":
        raw = get_stock_candles(symbol, interval, start, end)
    else:
        raw = get_candles(symbol, interval, start, end)

    other_raw = _fetch_paired_index(symbol, interval, start, end, source)
    feats = build_features(raw, other_raw)
    discovery_df, val_df, test_df = chronological_split(feats)
    config = BacktestConfig()
    # clauses arrives as plain dicts (reddit_scan.extract_strategy's JSON output) --
    # Candidate.signal() and db.save_experiment's clause serialization both require
    # real Clause dataclass instances, not dicts.
    clause_objs = [Clause(**c) if isinstance(c, dict) else c for c in clauses]
    cand_obj = Candidate(clauses=clause_objs)

    discovery_stats, _ = evaluate_candidate(discovery_df, cand_obj, config)
    val_stats, val_trades = evaluate_candidate(val_df, cand_obj, config)
    if val_stats.n_trades < validation_min_trades or val_stats.expectancy_r <= 0:
        return None

    test_stats, test_trades = evaluate_candidate(test_df, cand_obj, config)
    if test_stats.n_trades < test_min_trades:
        return None

    rule = cand_obj.describe()
    oos_df = pd.concat([val_df, test_df])
    wf = walk_forward(oos_df, cand_obj, n_windows=6, config=config)
    mc = monte_carlo(test_trades["r_multiple"]) if len(test_trades) else None
    cs = cost_stress(test_df, cand_obj, config)
    pert = parameter_perturbation(discovery_df, cand_obj, config)
    stability = parameter_stability_score(pert)
    score = robustness_score(discovery_stats, val_stats, test_stats, wf, stability, cs, test_trades)

    experiment_id = None
    if save:
        experiment_id = db.save_experiment(
            symbol=symbol, interval=interval, start_date=start, end_date=end,
            rule=rule, clauses=clause_objs,
            discovery_stats=discovery_stats.as_dict(),
            validation_stats=val_stats.as_dict(),
            test_stats=test_stats.as_dict(),
            walk_forward=wf, monte_carlo=mc, cost_stress=cs,
            parameter_stability={"score": stability, "perturbations": pert.to_dict(orient="records")},
            robustness_score=score,
            source=source,
            origin="reddit",
            reddit_strategy_id=reddit_strategy_id,
        )
        db.save_trades(experiment_id, val_trades, "validation")
        db.save_trades(experiment_id, test_trades, "test")

    return {
        "experiment_id": experiment_id,
        "symbol": symbol,
        "interval": interval,
        "rule": rule,
        "validation_stats": val_stats,
        "test_stats": test_stats,
        "robustness_score": score,
    }


def is_pass(finalist: dict) -> bool:
    """A finalist already satisfies the trade-count/sign bar by construction
    (that's what the funnel selects for) -- "pass" here means the robustness score
    clears the same bar that admits a pattern into forward tracking
    (trading_lab.live.TRACKING_MIN_SCORE). One threshold for both "worth tracking
    live" and "worth telling the user about."
    """
    return finalist["robustness_score"]["total"] >= TRACKING_MIN_SCORE


def is_novel_pass(finalist: dict, symbol: str, interval: str, source: str) -> bool:
    """is_pass(), plus: skip if an earlier experiment already found this exact rule
    and already cleared the bar. The random search frequently rediscovers
    near-identical rules across passes -- without this, each rediscovery would ping
    Telegram again for what's effectively the same pattern, exactly the kind of
    repetitive noise worth cutting.
    """
    if not is_pass(finalist):
        return False
    return not db.rule_already_cleared_bar(
        symbol, interval, source, finalist["rule"], TRACKING_MIN_SCORE, finalist["experiment_id"],
    )
