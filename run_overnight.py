"""Local cluster research loop: uses your CPU cores to search far more candidates per
combo than the GitHub Actions schedule can afford under its 15-minute job budget. Runs
indefinitely (until Ctrl+C) across BTC/ETH/SPY/QQQ, pinging Telegram only when a
finalist's robustness score clears the bar.

This complements the scheduled GitHub Actions workflow, it doesn't replace it -- GitHub
Actions is the only thing searching while your computer is off; this is the heavy-duty
supplement for while it's on. Both write to the same database, so results merge.

Worker count and pause/resume are controlled remotely: the dashboard's "Compute Control"
panel (/research) writes to the local_agent_settings table, and this script re-reads it
at the start of every round, so you can throttle CPU usage or pause from your phone
without touching the terminal this is running in. The --workers flag only applies if
that table can't be reached (e.g. offline).

Usage:
    python run_overnight.py                      # run until Ctrl+C, controlled from the dashboard
    python run_overnight.py --hours 8             # stop after 8 hours regardless
    python run_overnight.py --n-candidates 5000
"""

from __future__ import annotations

import argparse
import multiprocessing as mp
import os
import time
import traceback
from datetime import datetime, timedelta

from trading_lab import db
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


def _run_one_combo(task: tuple) -> dict:
    """Runs inside a worker process: its own DB connection (opened fresh per call,
    never inherited across the process fork/spawn), its own Telegram notification,
    its own print line -- the main process just tallies what comes back.
    """
    source, symbol, interval, start, end, n_candidates, seed = task
    tag = f"[{source}] {symbol} {interval}"
    print(f"[{datetime.now().strftime('%H:%M:%S')}] pid={os.getpid()} {tag} seed={seed} starting ({n_candidates} candidates) ...")

    try:
        summary = run_experiment(symbol, interval, start, end, n_candidates=n_candidates, seed=seed, source=source)
    except Exception:
        print(f"  {tag} error, skipping:\n{traceback.format_exc()}")
        return {"tag": tag, "finalists": 0, "passed": 0}

    print(
        f"[{datetime.now().strftime('%H:%M:%S')}] {tag}: {n_candidates} tested -> "
        f"{summary['research_worthy']} research-worthy -> {summary['discovery_survivors']} backtested -> "
        f"{summary['validation_survivors']} survived validation -> {len(summary['finalists'])} finalist(s)"
    )

    passed = 0
    for f in summary["finalists"]:
        score = f["robustness_score"]["total"]
        label = f["robustness_score"]["label"]
        ok = is_pass(f)
        print(f"    {tag} {f['rule']}  robustness={score} ({label})  pass={ok}")

        if ok:
            passed += 1
            link = f"{DASHBOARD_URL}/experiments/{f['experiment_id']}" if DASHBOARD_URL else ""
            send_message(
                f"Candidate survived validation ({symbol} {interval})\n\n"
                f"Rule: {f['rule']}\n"
                f"Robustness: {score}/100 ({label})\n"
                f"Validation expectancy: {f['validation_stats'].expectancy_r:.3f}R ({f['validation_stats'].n_trades} trades)\n"
                f"Test expectancy: {f['test_stats'].expectancy_r:.3f}R ({f['test_stats'].n_trades} trades)\n"
                + (f"\n{link}" if link else "")
            )

    return {"tag": tag, "finalists": len(summary["finalists"]), "passed": passed}


def _resolve_worker_count(fallback: int) -> tuple[int, bool]:
    """Read the live setting from the dashboard. Falls back to the CLI default if the
    database can't be reached (e.g. offline) rather than crashing the whole loop.
    """
    detected = os.cpu_count() or 2
    try:
        settings = db.get_agent_settings()
    except Exception:
        print("  (could not reach dashboard settings, using CLI default)")
        return max(1, min(fallback, detected)), False

    if settings["paused"]:
        return 0, True
    return max(1, min(settings["max_workers"], detected)), False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=None, help="stop after this many hours (default: run until Ctrl+C)")
    parser.add_argument("--n-candidates", type=int, default=3000, help="random hypotheses searched per combo per pass")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1), help="fallback worker count if the dashboard's setting can't be read")
    args = parser.parse_args()

    deadline = datetime.now() + timedelta(hours=args.hours) if args.hours else None
    deadline_str = deadline.strftime("%Y-%m-%d %H:%M") if deadline else "until stopped (Ctrl+C)"

    send_message(
        f"Local cluster research started.\n"
        f"{os.cpu_count()} CPU cores detected -- worker count and pause/resume are now controlled "
        f"from the dashboard's Compute Control panel.\n"
        f"Running {deadline_str}.\n"
        f"{args.n_candidates} candidates per combo per pass, {len(DEFAULT_COMBOS)} combos per round.\n"
        f"Will notify only on finalists whose robustness score clears the bar."
    )
    print(f"{os.cpu_count()} CPU cores detected. Worker count/pause controlled from the dashboard each round.")
    print("This complements the GitHub Actions schedule -- that keeps running independently while your PC is off.\n")

    rounds = 0
    tried = 0
    total_finalists = 0
    total_passed = 0

    try:
        while deadline is None or datetime.now() < deadline:
            workers, paused = _resolve_worker_count(args.workers)

            if paused:
                print(f"[{datetime.now().strftime('%H:%M:%S')}] Paused from the dashboard. Checking again in 60s ...")
                time.sleep(60)
                continue

            rounds += 1
            tasks = [
                (source, symbol, interval, start, end, args.n_candidates, rounds * 1000 + i)
                for i, (source, symbol, interval, start, end) in enumerate(DEFAULT_COMBOS)
            ]
            print(f"=== Round {rounds}: {len(tasks)} combos queued across {workers} worker(s) ===")

            with mp.Pool(processes=workers) as pool:
                for result in pool.imap_unordered(_run_one_combo, tasks):
                    tried += 1
                    total_finalists += result["finalists"]
                    total_passed += result["passed"]
                    if deadline and datetime.now() >= deadline:
                        break
    except KeyboardInterrupt:
        print("\nStopped by user.")

    send_message(f"Local cluster research finished.\n{rounds} round(s), {tried} combo-passes, {total_finalists} finalist(s), {total_passed} passed.")
    print(f"\nDone. {rounds} round(s), {tried} combo-passes, {total_finalists} finalists, {total_passed} passed.")


if __name__ == "__main__":
    main()
