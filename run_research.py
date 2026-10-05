"""One detailed, interactive research run: fetch data -> discover candidates -> validate the best one.

Usage:
    python run_research.py --symbol BTCUSDT --interval 1h --start 2019-01-01 --end 2026-01-01
    python run_research.py --source stocks --symbol SPY --interval 15Min --start 2020-08-01 --end 2026-01-01

For unattended overnight searching across multiple assets with Telegram
notifications, use run_overnight.py instead.
"""

from __future__ import annotations

import argparse

from trading_lab.pipeline import run_experiment


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["crypto", "stocks"], default="crypto")
    parser.add_argument("--symbol", default="BTCUSDT", help="e.g. BTCUSDT (crypto) or SPY/QQQ (stocks)")
    parser.add_argument("--interval", default="1h", help="crypto: 15m/1h/4h/1d -- stocks: 15Min/1Hour/1Day (Alpaca format)")
    parser.add_argument("--start", default="2019-01-01", help="stocks: free Alpaca data starts ~2020-08")
    parser.add_argument("--end", default="2026-01-01")
    parser.add_argument("--n-candidates", type=int, default=3000)
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--top-k", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="skip writing results to the database")
    args = parser.parse_args()

    print(f"Running [{args.source}] {args.symbol} {args.interval} {args.start} -> {args.end}, {args.n_candidates} candidates ...")

    result = run_experiment(
        symbol=args.symbol,
        interval=args.interval,
        start=args.start,
        end=args.end,
        n_candidates=args.n_candidates,
        min_trades=args.min_trades,
        seed=args.seed,
        save=not args.no_save,
        source=args.source,
    )

    if result is None:
        print("No candidate produced enough trades. Try more candidates, a lower min-trades, or more data.")
        return

    discovery_results = result["discovery_results"]
    print(f"\nTop {args.top_k} candidates on DISCOVERY data (these numbers are expected to be optimistic):")
    print(discovery_results.head(args.top_k)[["rule", "n_trades", "win_rate", "expectancy_r", "profit_factor", "max_drawdown_r"]].to_string(index=False))

    print(f"\n=== Validating best candidate: {result['rule']} ===")
    print(f"\nValidation set: {result['validation_stats'].as_dict()}")
    print(f"Final out-of-sample test set: {result['test_stats'].as_dict()}")

    print("\nWalk-forward consistency across the full dataset:")
    wf = result["walk_forward"]
    print(wf[["window", "start", "end", "n_trades", "win_rate", "expectancy_r", "profit_factor"]].to_string(index=False))

    if result["monte_carlo"]:
        print("\nMonte Carlo (bootstrap resample of out-of-sample trades, 5000 sims):")
        for k, v in result["monte_carlo"].items():
            print(f"  {k}: {v:.4f}")

    print("\nCost stress test (fees + slippage multiplied up) on the final test set:")
    print(result["cost_stress"][["cost_multiplier", "n_trades", "expectancy_r", "profit_factor"]].to_string(index=False))

    print("\nParameter perturbation (nudging each threshold, on the discovery set):")
    pert = result["parameter_perturbation"]
    print(pert[["feature", "step_frac", "perturbed_value", "n_trades", "expectancy_r"]].to_string(index=False))
    print(f"  parameter stability score: {result['parameter_stability_score']:.2f} (fraction of perturbations that stayed profitable)")

    score = result["robustness_score"]
    print(f"\nRobustness score: {score['total']}/100")
    for k, v in score["components"].items():
        print(f"  {k}: {v}")
    if score["red_flags"]:
        print("  Red flags:")
        for flag in score["red_flags"]:
            print(f"    - {flag}")

    print("\nReminder: discovery-set numbers are optimistic by construction (this is what")
    print("the search was optimizing for). Trust the validation/test/walk-forward numbers,")
    print("and be suspicious of a candidate whose edge only shows up in one of these splits.")

    if result["experiment_id"]:
        print(f"\nSaved as experiment id {result['experiment_id']}")


if __name__ == "__main__":
    main()
