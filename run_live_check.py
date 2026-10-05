"""One symbol/interval/source combo, one live-signal check. Mirrors run_scheduled.py's
shape (meant to be invoked by a GitHub Actions matrix, independent and stateless) but
runs much more often -- it doesn't search for new patterns, it only re-checks patterns
already proven by the research pipeline (robustness_score.total == 100) against fresh
market data.

Sends Telegram ONLY when a pattern that has ALSO proven itself in forward/paper trading
(not just backtest) has a trade signal pending right now. This is a different, more
urgent message than run_scheduled.py's "candidate survived validation" notification --
that one says "worth a look," this one says "trade this."

Usage:
    python run_live_check.py --source crypto --symbol BTCUSDT --interval 15m
"""

from __future__ import annotations

import argparse
import traceback
from datetime import datetime, timezone

from trading_lab import db, live
from trading_lab.telegram import send_message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=["crypto", "stocks"], required=True)
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--interval", required=True)
    args = parser.parse_args()

    print(f"[{datetime.now(timezone.utc).isoformat()}] [{args.source}] {args.symbol} {args.interval} live check")

    proven = db.get_proven_experiments(
        live.PROVEN_MIN_SCORE, symbol=args.symbol, interval=args.interval, source=args.source,
    )
    if proven.empty:
        print(f"  no proven (robustness={live.PROVEN_MIN_SCORE}) patterns for this combo yet -- nothing to check.")
        return

    try:
        feats = live.fetch_live_features(args.symbol, args.interval, args.source)
    except Exception:
        print(f"  error fetching live data: {traceback.format_exc()}")
        raise

    if feats.empty:
        print("  live data fetch returned no usable (closed) bars yet -- skipping this pass.")
        return

    alerts_sent = 0
    for _, row in proven.iterrows():
        experiment_row = row.to_dict()
        experiment_id = int(experiment_row["id"])

        try:
            result = live.check_pattern(experiment_row, feats)
        except Exception:
            print(f"  experiment {experiment_id}: error during check, skipping:\n{traceback.format_exc()}")
            continue

        db.upsert_forward_validation(
            experiment_id, result.status, result.forward_stats.as_dict(),
            promoted_at=datetime.now(timezone.utc) if result.status == "promoted" else None,
        )

        print(
            f"  experiment {experiment_id} ({experiment_row['rule']}): "
            f"status={result.status} forward_trades={result.forward_stats.n_trades} "
            f"forward_expectancy={result.forward_stats.expectancy_r:.3f}R "
            f"new_trades={result.new_trade_count} pending={result.pending}"
        )

        if result.status == "promoted" and result.pending:
            is_new = db.record_alert_if_new(experiment_id, result.bar_time)
            if is_new:
                send_message(live.build_alert_message(experiment_row, feats, result.forward_stats))
                alerts_sent += 1
                print(f"    -> Telegram alert sent (signal bar {result.bar_time})")
            else:
                print(f"    -> already alerted for signal bar {result.bar_time}, skipping")

    print(f"\nDone. {len(proven)} proven pattern(s) checked, {alerts_sent} alert(s) sent.")


if __name__ == "__main__":
    main()
