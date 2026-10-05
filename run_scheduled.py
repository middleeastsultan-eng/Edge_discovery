"""One symbol/timeframe combo, one funnel pass. Meant to be invoked by the GitHub
Actions matrix in .github/workflows/research.yml -- each combo runs as its own
parallel job so a slow combo (more historical bars = slower backtests) can't eat
the time budget of the others. Independent and stateless; the schedule + matrix
together are what provide "keeps searching even with the computer off."

Notifies Telegram only for finalists whose robustness score clears the bar --
most invocations are expected to produce zero finalists, that's the funnel working.

Usage:
    python run_scheduled.py --source crypto --symbol BTCUSDT --interval 15m --start 2019-01-01 --end 2026-01-01
"""

from __future__ import annotations

import argparse
import time
import traceback
from datetime import datetime, timezone

from trading_lab import db
from trading_lab.config import DASHBOARD_URL
from trading_lab.explain import describe_rule
from trading_lab.pipeline import is_novel_pass, is_pass, run_experiment
from trading_lab.telegram import send_message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["crypto", "stocks"], required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--interval", required=True)
    parser.add_argument("--start", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--n-candidates", type=int, default=800)
    args = parser.parse_args()

    seed = int(time.time())  # different every run, so repeated runs don't retread the same search
    print(f"[{datetime.now(timezone.utc).isoformat()}] [{args.source}] {args.symbol} {args.interval} seed={seed}")

    try:
        summary = run_experiment(
            args.symbol, args.interval, args.start, args.end,
            n_candidates=args.n_candidates, seed=seed, source=args.source,
        )
    except Exception:
        print(f"error: {traceback.format_exc()}")
        raise

    print(f"{args.n_candidates} tested -> {summary['discovery_survivors']} met discovery minimum -> "
          f"{summary['validation_survivors']} survived validation -> {len(summary['finalists'])} finalist(s)")

    passed = 0
    for f in summary["finalists"]:
        score = f["robustness_score"]["total"]
        label = f["robustness_score"]["label"]
        passes = is_pass(f)
        is_ok = is_novel_pass(f, args.symbol, args.interval, args.source) if passes else False
        print(f"  {f['rule']}  robustness={score} ({label})  notify={is_ok}")

        if not passes:
            continue

        # Generate a plain-English translation only for genuinely new rules -- a
        # rediscovered duplicate reuses the earlier one instead of paying for another
        # API call (same rule, same description, every time).
        description = (
            describe_rule(f["rule"], args.symbol, args.interval) if is_ok
            else db.get_plain_english_for_rule(args.symbol, args.interval, args.source, f["rule"])
        )
        if description:
            db.set_plain_english(f["experiment_id"], description)

        if is_ok:
            passed += 1
            link = f"{DASHBOARD_URL}/experiments/{f['experiment_id']}" if DASHBOARD_URL else ""
            send_message(
                f"New pattern found ({args.symbol} {args.interval})\n\n"
                f"Rule: {f['rule']}\n"
                + (f"In plain English: {description}\n" if description else "")
                + f"Robustness: {score}/100 ({label})\n"
                f"Entering forward tracking against live data -- will only alert again "
                f"if it proves itself in real trading, not just backtest.\n"
                + (f"\n{link}" if link else "")
            )

    print(f"\nDone. {passed} candidate(s) passed.")


if __name__ == "__main__":
    main()
