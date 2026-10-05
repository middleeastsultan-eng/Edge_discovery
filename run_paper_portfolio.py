"""One global pass over the paper-trading account. Deliberately separate from
run_live_check.py: that script runs once per symbol/interval/source combo (8 parallel
matrix jobs), but the paper ledger is a single global equity sequence shared across every
pattern and symbol -- running this from 8 concurrent jobs would race on the same number.
One job, no matrix, on its own schedule (see .github/workflows/paper_portfolio.yml).

Usage:
    python run_paper_portfolio.py
"""

from __future__ import annotations

import traceback
from datetime import datetime, timezone

from trading_lab import paper_portfolio


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] paper portfolio pass")

    try:
        result = paper_portfolio.process_new_trades()
    except Exception:
        print(f"  error: {traceback.format_exc()}")
        raise

    if result.locked_out:
        print("  another run is already in progress -- skipping this pass.")
        return

    return_pct = (result.equity_after / paper_portfolio.STARTING_EQUITY - 1) * 100
    print(
        f"  {result.processed} trade(s) processed, {result.skipped_for_exposure} skipped "
        f"(exceeded {paper_portfolio.MAX_CONCURRENT_RISK:.0%} concurrent-risk cap)"
    )
    print(f"  equity: {result.equity_before:.2f} -> {result.equity_after:.2f} ({return_pct:+.2f}% since inception)")


if __name__ == "__main__":
    main()
