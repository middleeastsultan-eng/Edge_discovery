"""Overnight research loop: repeatedly searches for edges across assets/timeframes and
pings Telegram only when a finalist's robustness score clears the bar.

Leave this running in a terminal on a machine that stays on -- there's no cloud worker
yet, so it only searches while your computer is awake and this process is alive. For
research that continues even with your computer off, use the scheduled GitHub Actions
workflow (.github/workflows/research.yml, driven by run_scheduled.py) instead.

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

# (source, symbol, interval, start, end) -- each source has its own valid date range:
# Binance has full crypto history; Alpaca's free IEX feed only goes back to ~2020-08.
DEFAULT_COMBOS = [
    ("crypto", "BTCUSDT", "15m", "2019-01-01", "2026-01-01"),
    ("crypto", "BTCUSDT", "1h", "2019-01-01", "2026-01-01"),
    ("crypto", "BTCUSDT", "4h", "2019-01-01", "2026-01-01"),
    ("crypto", "ETHUSDT", "15m", "2019-01-01", "2026-01-01"),
    ("crypto", "ETHUSDT", "1h", "2019-01-01", "2026-01-01"),
    ("crypto", "ETHUSDT", "4h", "2019-01-01", "2026-01-01"),
    ("stocks", "SPY", "15Min", "2020-08-01", "2026-01-01"),
    ("stocks", "SPY", "1Hour", "2020-08-01", "2026-01-01"),
    ("stocks", "QQQ", "15Min", "2020-08-01", "2026-01-01"),
    ("stocks", "QQQ", "1Hour", "2020-08-01", "2026-01-01"),
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=8.0, help="how long to keep searching")
    parser.add_argument("--n-candidates", type=int, default=2000, help="random hypotheses searched per combo per pass")
    args = parser.parse_args()

    deadline = datetime.now() + timedelta(hours=args.hours)
    send_message(
        f"Overnight research started.\n"
        f"Running until {deadline.strftime('%Y-%m-%d %H:%M')} ({args.hours}h).\n"
        f"Assets: BTC, ETH, SPY, QQQ across multiple timeframes.\n"
        f"Will notify only on finalists whose robustness score clears the bar."
    )

    tried = 0
    total_finalists = 0
    seed = 0

    try:
        while datetime.now() < deadline:
            for source, symbol, interval, start, end in DEFAULT_COMBOS:
                if datetime.now() >= deadline:
                    break

                tried += 1
                seed += 1
                print(f"\n[{datetime.now().strftime('%H:%M:%S')}] #{tried} Searching [{source}] {symbol} {interval} (seed {seed}) ...")

                try:
                    summary = run_experiment(symbol, interval, start, end, n_candidates=args.n_candidates, seed=seed, source=source)
                except Exception:
                    print(f"  error, skipping: {traceback.format_exc()}")
                    continue

                print(f"  {args.n_candidates} tested -> {summary['discovery_survivors']} met discovery minimum -> "
                      f"{summary['validation_survivors']} survived validation -> {len(summary['finalists'])} finalist(s)")

                for f in summary["finalists"]:
                    score = f["robustness_score"]["total"]
                    label = f["robustness_score"]["label"]
                    passed = is_pass(f)
                    print(f"    {f['rule']}  robustness={score} ({label})  pass={passed}")

                    if passed:
                        total_finalists += 1
                        link = f"{DASHBOARD_URL}/experiments/{f['experiment_id']}" if DASHBOARD_URL else ""
                        send_message(
                            f"Candidate survived validation ({symbol} {interval})\n\n"
                            f"Rule: {f['rule']}\n"
                            f"Robustness: {score}/100 ({label})\n"
                            f"Validation expectancy: {f['validation_stats'].expectancy_r:.3f}R ({f['validation_stats'].n_trades} trades)\n"
                            f"Test expectancy: {f['test_stats'].expectancy_r:.3f}R ({f['test_stats'].n_trades} trades)\n"
                            + (f"\n{link}" if link else "")
                        )
    except KeyboardInterrupt:
        print("\nStopped by user.")

    send_message(f"Overnight research finished.\n{tried} combo-passes run, {total_finalists} candidate(s) passed.")
    print(f"\nDone. {tried} combo-passes, {total_finalists} passed.")


if __name__ == "__main__":
    main()
