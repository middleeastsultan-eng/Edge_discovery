"""Live check for the structural divergence strategy.

Runs on a schedule (GitHub Actions, every 15 min). On each call it:

1. Fetches fresh QQQ + SPY bars from Alpaca.
2. Registers the divergence strategy as an experiment row if not already there
   (idempotent -- safe to call on every tick).
3. Runs live.check_pattern() on that experiment row, exactly like run_live_check.py
   does for clause-based patterns.
4. If the pattern is promoted and there's a live signal pending, records the alert
   and sends a Telegram message with entry/stop/target.
5. run_paper_portfolio.py (separate scheduled job) picks up any new forward trades
   automatically -- no changes needed there.

Usage:
    python run_divergence_live.py --interval 1Hour --start 2020-08-01 --end 2026-01-01
    python run_divergence_live.py --interval 15Min --start 2020-08-01 --end 2026-01-01
"""

from __future__ import annotations

import argparse
import traceback
from datetime import datetime, timezone

from trading_lab import db, live
from trading_lab.backtest import BacktestConfig
from trading_lab.data_stocks import get_stock_candles
from trading_lab.divergence_strategy import (
    DivergenceCandidate,
    validate_divergence_strategy,
)
from trading_lab.features import build_features
from trading_lab.live import (
    TRACKING_MIN_SCORE,
    build_alert_message,
    build_promotion_message,
    fetch_live_features,
)
from trading_lab.metrics import compute_stats
from trading_lab.telegram import send_message


# Both directions for each pair: bull divergence → long; bear divergence → short.
DIVERGENCE_CONFIGS = [
    # leader, follower, direction
    ("QQQ", "SPY", "long"),    # QQQ breaks up, SPY lags  → enter long SPY
    ("QQQ", "SPY", "short"),   # QQQ breaks down, SPY lags → enter short SPY
    ("SPY", "QQQ", "long"),    # SPY breaks up, QQQ lags  → enter long QQQ
    ("SPY", "QQQ", "short"),   # SPY breaks down, QQQ lags → enter short QQQ
]


def _run_one_config(
    leader_symbol: str,
    follower_symbol: str,
    direction: str,
    interval: str,
    start: str,
    end: str,
) -> None:
    tag = f"{leader_symbol}/{follower_symbol} {direction} {interval}"
    print(f"  [{tag}] checking ...")

    # ── 1. Fetch historical data for validation (used only on first registration) ──
    try:
        raw_leader   = get_stock_candles(leader_symbol,   interval, start, end)
        raw_follower = get_stock_candles(follower_symbol, interval, start, end)
        if raw_leader.empty or raw_follower.empty:
            print(f"  [{tag}] empty historical data, skipping")
            return
        feats_leader   = build_features(raw_leader,   raw_follower)
        feats_follower = build_features(raw_follower, raw_leader)
    except Exception:
        print(f"  [{tag}] error fetching historical data:\n{traceback.format_exc()}")
        return

    # ── 2. Register (or retrieve) the experiment row ──────────────────────────────
    cand = DivergenceCandidate(
        leader_symbol=leader_symbol,
        follower_symbol=follower_symbol,
        direction=direction,
    )
    rule = cand.describe()

    # Check if already registered so we can skip expensive validation
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT id, robustness_score
                   FROM experiments
                   WHERE symbol = %s AND interval = %s AND source = 'stocks'
                     AND rule = %s AND origin = 'divergence'
                   LIMIT 1""",
                (leader_symbol, interval, rule),
            )
            existing = cur.fetchone()

    if existing is not None:
        experiment_id = int(existing[0])
        print(f"  [{tag}] already registered as experiment {experiment_id}")
    else:
        # First time: run the full validation suite and persist it
        print(f"  [{tag}] first run — validating against historical data ...")
        try:
            result = validate_divergence_strategy(
                feats_leader, feats_follower,
                leader_symbol=leader_symbol,
                follower_symbol=follower_symbol,
                direction=direction,
            )
        except Exception:
            print(f"  [{tag}] validation error:\n{traceback.format_exc()}")
            return

        score  = result["robustness_score"]
        disc   = result["discovery_stats"]
        val    = result["validation_stats"]
        test   = result["test_stats"]
        print(
            f"  [{tag}] disc={disc.n_trades}t exp={disc.expectancy_r:.3f}R | "
            f"val={val.n_trades}t exp={val.expectancy_r:.3f}R | "
            f"test={test.n_trades}t exp={test.expectancy_r:.3f}R | "
            f"score={score['total']}/100 ({score['label']})"
        )

        # Save historical trades so forward tracking has a baseline
        experiment_id = db.upsert_divergence_experiment(
            leader_symbol=leader_symbol,
            follower_symbol=follower_symbol,
            interval=interval,
            start_date=start,
            end_date=end,
            direction=direction,
            rule=rule,
            discovery_stats=result["discovery_stats"].as_dict(),
            validation_stats=result["validation_stats"].as_dict(),
            test_stats=result["test_stats"].as_dict(),
            walk_forward=result["walk_forward"],
            monte_carlo=result["monte_carlo"],
            cost_stress=result["cost_stress"],
            robustness_score=result["robustness_score"],
            source="stocks",
        )
        db.save_trades(experiment_id, result["validation_trades"], "validation")
        db.save_trades(experiment_id, result["test_trades"], "test")
        print(f"  [{tag}] registered as experiment {experiment_id}")

        if score["total"] < TRACKING_MIN_SCORE:
            print(
                f"  [{tag}] score {score['total']} < {TRACKING_MIN_SCORE} — "
                f"not yet eligible for forward tracking"
            )
            return

    # ── 3. Fetch live (real-time) features for LEADER ─────────────────────────────
    try:
        live_leader_feats = fetch_live_features(leader_symbol, interval, "stocks")
    except Exception:
        print(f"  [{tag}] error fetching live leader data:\n{traceback.format_exc()}")
        return

    if live_leader_feats.empty:
        print(f"  [{tag}] no closed bars available yet")
        return

    # Fetch live FOLLOWER features and attach to candidate so signal() works
    try:
        live_follower_feats = fetch_live_features(follower_symbol, interval, "stocks")
    except Exception:
        print(f"  [{tag}] error fetching live follower data:\n{traceback.format_exc()}")
        return

    cand_live = DivergenceCandidate(
        leader_symbol=leader_symbol,
        follower_symbol=follower_symbol,
        direction=direction,
    ).attach_follower(live_follower_feats)

    # ── 4. Build a minimal experiment_row dict (what check_pattern expects) ───────
    with db.get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id, symbol, interval, source, rule, clauses, test_stats, "
                "robustness_score, plain_english, direction "
                "FROM experiments WHERE id = %s",
                (experiment_id,),
            )
            row = cur.fetchone()
            if row is None:
                print(f"  [{tag}] experiment {experiment_id} vanished from DB — skipping")
                return
            cols = [d[0] for d in cur.description]
    experiment_row = dict(zip(cols, row))
    # Inject the live candidate so check_pattern uses it
    experiment_row["_candidate_override"] = cand_live

    # ── 5. check_pattern ─────────────────────────────────────────────────────────
    prior = db.get_forward_validation(experiment_id)
    prior_status = prior["status"] if prior else "tracking"

    try:
        check_result = live.check_pattern(experiment_row, live_leader_feats)
    except Exception:
        print(f"  [{tag}] check_pattern error:\n{traceback.format_exc()}")
        return

    db.upsert_forward_validation(
        experiment_id, check_result.status, check_result.forward_stats.as_dict(),
        promoted_at=datetime.now(timezone.utc) if check_result.status == "promoted" else None,
    )
    db.record_forward_check(
        experiment_id, check_result.status,
        int(check_result.forward_stats.n_trades),
        float(check_result.forward_stats.expectancy_r),
        float(check_result.lower_bound_r),
    )

    print(
        f"  [{tag}] experiment={experiment_id} status={check_result.status} "
        f"fwd_trades={check_result.forward_stats.n_trades} "
        f"fwd_exp={check_result.forward_stats.expectancy_r:.3f}R "
        f"new_trades={check_result.new_trade_count} pending={check_result.pending}"
    )

    # ── 6. Telegram: promotion notice ────────────────────────────────────────────
    if check_result.status == "promoted" and prior_status != "promoted":
        send_message(build_promotion_message(experiment_row, check_result.forward_stats))
        print(f"    → Telegram: promotion notice sent")

    # ── 7. Telegram: trade alert ─────────────────────────────────────────────────
    if check_result.status == "promoted" and check_result.pending:
        bt_config = BacktestConfig(direction=direction)
        levels = live.compute_trade_levels(live_leader_feats, bt_config)
        is_new = db.record_alert_if_new(
            experiment_id, check_result.bar_time,
            entry_price=levels["entry_price"],
            stop_price=levels["stop_price"],
            target_price=levels["target_price"],
        )
        if is_new:
            send_message(build_alert_message(experiment_row, live_leader_feats,
                                             check_result.forward_stats, bt_config))
            print(f"    → Telegram: trade alert sent (bar {check_result.bar_time})")
        else:
            print(f"    → already alerted for bar {check_result.bar_time}, skipping")

    # ── 8. Divergence-specific alerts (deduplicated by leader/direction/bar) ────
    if check_result.pending:
        is_new_div = db.record_divergence_alert_if_new(
            leader_symbol, follower_symbol, direction, check_result.bar_time,
        )
        if is_new_div:
            send_message(
                f"Divergence signal -- {leader_symbol} {direction} divergence from {follower_symbol} at {check_result.bar_time}\n"
                f"Leader: {leader_symbol}, Follower: {follower_symbol}, Direction: {direction}\n"
                f"Pattern: {instrument}\n"
                f"Bar time: {check_result.bar_time}\n"
                f"This is a structural divergence that may lead to a trade signal."
            )
            print(f"    → Telegram: divergence alert sent (bar {check_result.bar_time})")
        else:
            print(f"    → already alerted for divergence bar {check_result.bar_time}, skipping")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval",  required=True,
                        help="Alpaca interval: 1Min 5Min 15Min 30Min 1Hour 1Day")
    parser.add_argument("--start",     required=True, help="Historical start YYYY-MM-DD")
    parser.add_argument("--end",       required=True, help="Historical end   YYYY-MM-DD")
    parser.add_argument("--leader",    default=None,
                        help="Limit to one leader symbol (QQQ or SPY); default: both")
    parser.add_argument("--direction", default=None,
                        choices=["long", "short"],
                        help="Limit to one direction; default: both")
    args = parser.parse_args()

    configs = [
        (l, f, d) for l, f, d in DIVERGENCE_CONFIGS
        if (args.leader    is None or l == args.leader)
        and (args.direction is None or d == args.direction)
    ]

    print(
        f"[{datetime.now(timezone.utc).isoformat()}] "
        f"divergence live check — {args.interval} — {len(configs)} config(s)"
    )

    for leader, follower, direction in configs:
        _run_one_config(leader, follower, direction, args.interval, args.start, args.end)

    print("Done.")


if __name__ == "__main__":
    main()
