"""End-to-end research run: fetch data -> discover candidates -> validate the best one.

Usage:
    python run_research.py --symbol BTCUSDT --interval 1h --start 2019-01-01 --end 2026-01-01
"""

from __future__ import annotations

import argparse

from trading_lab import db
from trading_lab.backtest import BacktestConfig
from trading_lab.data import get_candles
from trading_lab.discovery import search
from trading_lab.features import build_features
from trading_lab.validate import chronological_split, evaluate_candidate, monte_carlo, walk_forward


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="BTCUSDT")
    parser.add_argument("--interval", default="1h")
    parser.add_argument("--start", default="2019-01-01")
    parser.add_argument("--end", default="2026-01-01")
    parser.add_argument("--n-candidates", type=int, default=3000)
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--no-save", action="store_true", help="skip writing results to the database")
    args = parser.parse_args()

    print(f"Fetching {args.symbol} {args.interval} candles {args.start} -> {args.end} ...")
    raw = get_candles(args.symbol, args.interval, args.start, args.end)
    print(f"  {len(raw)} candles fetched/cached.")

    print("Building features ...")
    feats = build_features(raw)

    print("Splitting chronologically into discovery / validation / test ...")
    discovery_df, val_df, test_df = chronological_split(feats)
    print(f"  discovery={len(discovery_df)}  validation={len(val_df)}  test={len(test_df)}")

    config = BacktestConfig()

    print(f"Searching {args.n_candidates} random hypotheses on the discovery set only ...")
    results = search(discovery_df, n_candidates=args.n_candidates, min_trades=args.min_trades, backtest_config=config)

    if results.empty:
        print("No candidate produced enough trades. Try more candidates, a lower min-trades, or more data.")
        return

    print(f"\nTop {args.top_k} candidates on DISCOVERY data (these numbers are expected to be optimistic):")
    print(results.head(args.top_k)[["rule", "n_trades", "win_rate", "expectancy_r", "profit_factor", "max_drawdown_r"]].to_string(index=False))

    best = results.iloc[0]
    candidate = best["clauses"]
    from trading_lab.discovery import Candidate
    cand_obj = Candidate(clauses=candidate)

    print(f"\n=== Validating best candidate: {best['rule']} ===")

    val_stats, val_trades = evaluate_candidate(val_df, cand_obj, config)
    print(f"\nValidation set: {val_stats.as_dict()}")

    test_stats, test_trades = evaluate_candidate(test_df, cand_obj, config)
    print(f"Final out-of-sample test set: {test_stats.as_dict()}")

    print("\nWalk-forward consistency across the full dataset:")
    wf = walk_forward(feats, cand_obj, n_windows=6, config=config)
    print(wf[["window", "start", "end", "n_trades", "win_rate", "expectancy_r", "profit_factor"]].to_string(index=False))

    if len(test_trades):
        print("\nMonte Carlo (bootstrap resample of out-of-sample trades, 5000 sims):")
        mc = monte_carlo(test_trades["r_multiple"])
        for k, v in mc.items():
            print(f"  {k}: {v:.4f}")

    print("\nReminder: discovery-set numbers are optimistic by construction (this is what")
    print("the search was optimizing for). Trust the validation/test/walk-forward numbers,")
    print("and be suspicious of a candidate whose edge only shows up in one of these splits.")

    if not args.no_save:
        print("\nSaving experiment to database ...")
        mc = monte_carlo(test_trades["r_multiple"]) if len(test_trades) else None
        experiment_id = db.save_experiment(
            symbol=args.symbol,
            interval=args.interval,
            start_date=args.start,
            end_date=args.end,
            rule=best["rule"],
            clauses=candidate,
            discovery_stats=best.drop(["rule", "clauses"]).to_dict(),
            validation_stats=val_stats.as_dict(),
            test_stats=test_stats.as_dict(),
            walk_forward=wf,
            monte_carlo=mc,
        )
        db.save_trades(experiment_id, val_trades, "validation")
        db.save_trades(experiment_id, test_trades, "test")
        print(f"  saved as experiment id {experiment_id}")


if __name__ == "__main__":
    main()
