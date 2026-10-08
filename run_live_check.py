"""One symbol/interval/source combo, one live-signal check. Mirrors run_scheduled.py's
shape (meant to be invoked by a GitHub Actions matrix, independent and stateless) but
runs much more often -- it doesn't search for new patterns, it only re-checks patterns
already scored well by the research pipeline (robustness_score.total >= TRACKING_MIN_SCORE)
against fresh market data.

Sends Telegram for two of the three things worth a ping: once, the moment a pattern's
status first flips to "promoted" (it just proved itself against real data), and every
time a promoted pattern has a new trade signal pending right now. Both are different
from run_scheduled.py's "new pattern found" message -- that one says "worth tracking,"
these say "this one's proven" and "trade this," respectively.

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

    tracked = db.get_proven_experiments(
        live.TRACKING_MIN_SCORE, symbol=args.symbol, interval=args.interval, source=args.source,
    )
    if tracked.empty:
        print(f"  no patterns above robustness={live.TRACKING_MIN_SCORE} for this combo yet -- nothing to check.")
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
    promotions_sent = 0
    for _, row in tracked.iterrows():
        experiment_row = row.to_dict()
        experiment_id = int(experiment_row["id"])

        prior = db.get_forward_validation(experiment_id)
        prior_status = prior["status"] if prior else "tracking"

        try:
            result = live.check_pattern(experiment_row, feats)
        except Exception:
            print(f"  experiment {experiment_id}: error during check, skipping:\n{traceback.format_exc()}")
            continue

        db.upsert_forward_validation(
            experiment_id, result.status, result.forward_stats.as_dict(),
            promoted_at=datetime.now(timezone.utc) if result.status == "promoted" else None,
        )
        db.record_forward_check(
            experiment_id, result.status, int(result.forward_stats.n_trades),
            float(result.forward_stats.expectancy_r), float(result.lower_bound_r),
        )

        print(
            f"  experiment {experiment_id} ({experiment_row['rule']}): "
            f"status={result.status} forward_trades={result.forward_stats.n_trades} "
            f"forward_expectancy={result.forward_stats.expectancy_r:.3f}R "
            f"new_trades={result.new_trade_count} pending={result.pending}"
        )

        if result.status == "promoted" and prior_status != "promoted":
            send_message(live.build_promotion_message(experiment_row, result.forward_stats))
            promotions_sent += 1
            print("    -> Telegram promotion notice sent (pattern just proved itself live)")

        if result.status == "promoted" and result.pending:
            levels = live.compute_trade_levels(feats)
            is_new = db.record_alert_if_new(
                experiment_id, result.bar_time,
                entry_price=levels["entry_price"], stop_price=levels["stop_price"], target_price=levels["target_price"],
            )
            if is_new:
                send_message(live.build_alert_message(experiment_row, feats, result.forward_stats))
                alerts_sent += 1
                print(f"    -> Telegram alert sent (signal bar {result.bar_time})")
            else:
                print(f"    -> already alerted for signal bar {result.bar_time}, skipping")

    print(f"\nDone. {len(tracked)} tracked pattern(s) checked, {promotions_sent} promotion(s), {alerts_sent} trade alert(s) sent.")


if __name__ == "__main__":
    main()
