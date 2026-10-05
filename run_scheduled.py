"""Single pass through all symbol/timeframe combos -- meant to be invoked on a
schedule (GitHub Actions cron, see .github/workflows/research.yml) so research
keeps happening even when your computer is off. Each invocation is independent
and stateless; the schedule is what provides the "keeps searching" behavior.

Notifies Telegram only when a candidate survives validation -- most passes
through this script are expected to find nothing worth a message.
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
MIN_TRADES = 30
MIN_ROBUSTNESS = 55.0


def main():
    base_seed = int(time.time())  # different every run, so repeated runs don't retread the same search
    found = 0

    for i, (source, symbol, interval, start, end) in enumerate(COMBOS):
        seed = base_seed + i
        print(f"[{datetime.now(timezone.utc).isoformat()}] [{source}] {symbol} {interval} seed={seed}")

        try:
            result = run_experiment(
                symbol, interval, start, end,
                n_candidates=N_CANDIDATES, min_trades=MIN_TRADES, seed=seed, source=source,
            )
        except Exception:
            print(f"  error, skipping: {traceback.format_exc()}")
            continue

        if result is None:
            print("  no candidate produced enough trades")
            continue

        score = result["robustness_score"]["total"]
        passed = is_pass(result)
        print(f"  {result['rule']}  robustness={score}  pass={passed}")

        if passed and score >= MIN_ROBUSTNESS:
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

    print(f"\nDone. {found} candidate(s) passed this run.")


if __name__ == "__main__":
    main()
