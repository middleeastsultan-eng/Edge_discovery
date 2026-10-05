"""Overnight research loop: repeatedly searches for edges across assets/timeframes and
pings Telegram only when a candidate actually survives validation.

Leave this running in a terminal on a machine that stays on -- there's no cloud worker
yet, so it only searches while your computer is awake and this process is alive.

Usage:
    python run_overnight.py --hours 8
"""

from __future__ import annotations

import argparse
import traceback
from datetime import datetime, timedelta

from trading_lab.config import DASHBOARD_URL
from trading_lab.pipeline import is_pass, run_experiment
from trading_lab.telegram import send_message

DEFAULT_COMBOS = [
    ("BTCUSDT", "15m"),
    ("BTCUSDT", "1h"),
    ("BTCUSDT", "4h"),
    ("ETHUSDT", "15m"),
    ("ETHUSDT", "1h"),
    ("ETHUSDT", "4h"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=8.0, help="how long to keep searching")
    parser.add_argument("--start", default="2019-01-01")
    parser.add_argument("--end", default="2026-01-01")
    parser.add_argument("--n-candidates", type=int, default=2000, help="random hypotheses searched per run")
    parser.add_argument("--min-trades", type=int, default=30)
    parser.add_argument("--min-robustness", type=float, default=55.0, help="minimum score to notify about")
    args = parser.parse_args()

    deadline = datetime.now() + timedelta(hours=args.hours)
    send_message(
        f"Overnight research started.\n"
        f"Running until {deadline.strftime('%Y-%m-%d %H:%M')} ({args.hours}h).\n"
        f"Will notify only if something survives validation (robustness >= {args.min_robustness})."
    )

    tried = 0
    found = 0
    seed = 0

    try:
        while datetime.now() < deadline:
            for symbol, interval in DEFAULT_COMBOS:
                if datetime.now() >= deadline:
                    break

                tried += 1
                seed += 1
                print(f"\n[{datetime.now().strftime('%H:%M:%S')}] #{tried} Searching {symbol} {interval} (seed {seed}) ...")

                try:
                    result = run_experiment(
                        symbol,
                        interval,
                        args.start,
                        args.end,
                        n_candidates=args.n_candidates,
                        min_trades=args.min_trades,
                        seed=seed,
                    )
                except Exception:
                    print(f"  error, skipping: {traceback.format_exc()}")
                    continue

                if result is None:
                    print("  no candidate produced enough trades")
                    continue

                score = result["robustness_score"]["total"]
                passed = is_pass(result)
                print(f"  {result['rule']}")
                print(f"  robustness={score}  pass={passed}  val_exp={result['validation_stats'].expectancy_r:.3f}R  test_exp={result['test_stats'].expectancy_r:.3f}R")

                if passed and score >= args.min_robustness:
                    found += 1
                    link = f"{DASHBOARD_URL}/experiments/{result['experiment_id']}" if DASHBOARD_URL else ""
                    send_message(
                        f"Candidate survived validation ({symbol} {interval})\n\n"
                        f"Rule: {result['rule']}\n"
                        f"Robustness score: {score}/100\n"
                        f"Validation expectancy: {result['validation_stats'].expectancy_r:.3f}R\n"
                        f"Test expectancy: {result['test_stats'].expectancy_r:.3f}R\n"
                        f"Test trades: {result['test_stats'].n_trades}\n"
                        + (f"\n{link}" if link else "")
                    )
    except KeyboardInterrupt:
        print("\nStopped by user.")

    send_message(f"Overnight research finished.\n{tried} searches run, {found} candidate(s) survived validation.")
    print(f"\nDone. {tried} searches, {found} passed.")


if __name__ == "__main__":
    main()
