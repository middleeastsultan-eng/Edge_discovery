"""One detailed, interactive research run: fetch data -> discover -> funnel -> validate.

Usage:
    python run_research.py --symbol BTCUSDT --interval 1h --start 2019-01-01 --end 2026-01-01
    python run_research.py --source stocks --symbol SPY --interval 15Min --start 2020-08-01 --end 2026-01-01

For unattended searching across multiple assets with Telegram notifications,
use run_overnight.py or run_scheduled.py instead.
"""

from __future__ import annotations

import argparse

from trading_lab.pipeline import run_experiment


def print_finalist(f: dict) -> None:
    print(f"\n{'=' * 70}")
    print(f"{f['symbol']} {f['interval']}  —  {f['rule']}")
    print(f"{'=' * 70}")

    info = f.get("information_test")
    if info:
        print(f"\nLevel-1 information test (forward {info['horizon']}-bar return, condition vs baseline):")
        print(f"  conditional: mean={info['conditional_mean_return']:.4%}  P(positive)={info['conditional_p_positive']:.1%}  n={info['n_condition']}")
        print(f"  baseline:    mean={info['baseline_mean_return']:.4%}  P(positive)={info['baseline_p_positive']:.1%}  n={info['n_baseline']}")
        print(f"  p-value: {info['p_value']:.4g} (FDR-corrected across the batch)")

    print(f"\nDiscovery:  {f['discovery_stats'].as_dict()}")
    print(f"Validation: {f['validation_stats'].as_dict()}")
    print(f"Test:       {f['test_stats'].as_dict()}")

    print("\nWalk-forward consistency:")
    wf = f["walk_forward"]
    print(wf[["window", "start", "end", "n_trades", "win_rate", "expectancy_r", "profit_factor"]].to_string(index=False))

    if f["monte_carlo"]:
        print("\nMonte Carlo (bootstrap resample of test trades, 5000 sims):")
        for k, v in f["monte_carlo"].items():
            print(f"  {k}: {v:.4f}")

    print("\nCost stress (fees + slippage multiplied up, on test set):")
    print(f["cost_stress"][["cost_multiplier", "n_trades", "expectancy_r", "profit_factor"]].to_string(index=False))

    print("\nParameter perturbation (on discovery set):")
    pert = f["parameter_perturbation"]
    print(pert[["feature", "step_frac", "perturbed_value", "n_trades", "expectancy_r"]].to_string(index=False))
    print(f"  parameter stability score: {f['parameter_stability_score']:.2f}")

    score = f["robustness_score"]
    print(f"\nRobustness score: {score['total']}/100  ({score['label']})")
    for k, v in score["components"].items():
        print(f"  {k}: {v}")
    if score["red_flags"]:
        print("  Red flags:")
        for flag in score["red_flags"]:
            print(f"    - {flag}")

    if f["experiment_id"]:
        print(f"\nSaved as experiment id {f['experiment_id']}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["crypto", "stocks"], default="crypto")
    parser.add_argument("--symbol", default="BTCUSDT", help="e.g. BTCUSDT (crypto) or SPY/QQQ (stocks)")
    parser.add_argument("--interval", default="1h", help="crypto: 15m/1h/4h/1d -- stocks: 15Min/1Hour/1Day (Alpaca format)")
    parser.add_argument("--start", default="2019-01-01", help="stocks: free Alpaca data starts ~2020-08")
    parser.add_argument("--end", default="2026-01-01")
    parser.add_argument("--n-candidates", type=int, default=3000)
    parser.add_argument("--discovery-min-trades", type=int, default=100)
    parser.add_argument("--validation-min-trades", type=int, default=30)
    parser.add_argument("--test-min-trades", type=int, default=30)
    parser.add_argument("--funnel-top-k", type=int, default=30, help="how many discovery survivors advance to validation")
    parser.add_argument("--max-finalists", type=int, default=3, help="how many validation survivors reach the final test")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--no-save", action="store_true", help="skip writing results to the database")
    args = parser.parse_args()

    print(f"Running [{args.source}] {args.symbol} {args.interval} {args.start} -> {args.end}, {args.n_candidates} candidates ...")

    summary = run_experiment(
        symbol=args.symbol,
        interval=args.interval,
        start=args.start,
        end=args.end,
        n_candidates=args.n_candidates,
        discovery_min_trades=args.discovery_min_trades,
        validation_min_trades=args.validation_min_trades,
        test_min_trades=args.test_min_trades,
        funnel_top_k=args.funnel_top_k,
        max_finalists=args.max_finalists,
        seed=args.seed,
        save=not args.no_save,
        source=args.source,
    )

    print(f"\n{args.n_candidates} hypotheses tested -> {summary['level1_survivors']} passed the Level-1 information "
          f"filter -> {summary['discovery_survivors']} met discovery trade minimum -> top {summary['funnel_top_k']} "
          f"entered the funnel -> {summary['validation_survivors']} survived validation -> "
          f"{len(summary['finalists'])} finalist(s) reached the final test.")

    if not summary["finalists"]:
        print("\nNo finalist made it through the whole pipeline this run. That's the normal/expected outcome")
        print("most of the time -- it means nothing this run survived independent validation, not that")
        print("something is broken.")
        return

    for f in summary["finalists"]:
        print_finalist(f)

    print("\nReminder: discovery-set numbers are optimistic by construction. Trust validation/test/walk-forward,")
    print("and be suspicious of a finalist whose edge only shows up in one of these splits.")


if __name__ == "__main__":
    main()
