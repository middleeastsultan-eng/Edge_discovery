"""Single pass through all symbol/timeframe combos -- meant to be invoked on a
schedule (GitHub Actions cron, see .github/workflows/research.yml) so research
keeps happening even when your computer is off. Each invocation is independent
and stateless; the schedule is what provides the "keeps searching" behavior.

Notifies Telegram only for finalists whose robustness score clears the bar --
most passes through this script are expected to find nothing worth a message,
and most runs won't even produce a finalist (that's the funnel working).
"""

from __future__ import annotations

import time
import traceback
from datetime import datetime, timezone

from trading_lab.config import DASHBOARD_URL
from trading_lab.pipeline import is_pass, run_experiment
from trading_lab.telegram import send_message

# (source, symbol, interval, start, end)
COMBOS = [
    ("crypto", "BTCUSDT", "15m", "2019-01-01", "2026-01-01"),
    ("crypto", "BTCUSDT", "1h", "2019-01-01", "2026-01-01"),
    ("crypto", "ETHUSDT", "15m", "2019-01-01", "2026-01-01"),
    ("crypto", "ETHUSDT", "1h", "2019-01-01", "2026-01-01"),
    ("stocks", "SPY", "15Min", "2020-08-01", "2026-01-01"),
    ("stocks", "SPY", "1Hour", "2020-08-01", "2026-01-01"),
    ("stocks", "QQQ", "15Min", "2020-08-01", "2026-01-01"),
    ("stocks", "QQQ", "1Hour", "2020-08-01", "2026-01-01"),
]

N_CANDIDATES = 800


def main():
    base_seed = int(time.time())  # different every run, so repeated runs don't retread the same search
    total_finalists = 0

    for i, (source, symbol, interval, start, end) in enumerate(COMBOS):
        seed = base_seed + i
        print(f"[{datetime.now(timezone.utc).isoformat()}] [{source}] {symbol} {interval} seed={seed}")

        try:
            summary = run_experiment(symbol, interval, start, end, n_candidates=N_CANDIDATES, seed=seed, source=source)
        except Exception:
            print(f"  error, skipping: {traceback.format_exc()}")
            continue

        print(f"  {N_CANDIDATES} tested -> {summary['discovery_survivors']} met discovery minimum -> "
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

    print(f"\nDone. {total_finalists} candidate(s) passed across all combos this run.")


if __name__ == "__main__":
    main()
