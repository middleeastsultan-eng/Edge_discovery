"""Standalone runner for the QQQ/SPY divergence strategy.

Validates the structural divergence strategy against historical data and prints
the full validation report. Can be run locally or added to GitHub Actions.

Usage:
    python run_divergence.py --interval 1Hour --start 2020-08-01 --end 2026-01-01
"""

from __future__ import annotations

import argparse
import time
import traceback
from datetime import datetime, timezone

from trading_lab.config import DASHBOARD_URL
from trading_lab.data_stocks import get_stock_candles
from trading_lab.divergence_strategy import validate_divergence_strategy
from trading_lab.features import build_features
from trading_lab.telegram import send_message


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", required=True, help="Alpaca interval: 1Min, 5Min, 15Min, 30Min, 1Hour, 1Day")
    parser.add_argument("--start", required=True, help="Start date YYYY-MM-DD")
    parser.add_argument("--end", required=True, help="End date YYYY-MM-DD")
    parser.add_argument("--leader", choices=["QQQ", "SPY"], default="QQQ", help="Which index leads (the other follows)")
    parser.add_argument("--lookback", type=int, default=5, help="Swing pivot lookback")
    parser.add_argument("--window", type=int, default=5, help="Divergence confirmation window")
    parser.add_argument("--sl-atr", type=float, default=1.0, help="Stop loss ATR multiplier")
    parser.add_argument("--tp-atr", type=float, default=2.0, help="Take profit ATR multiplier")
    parser.add_argument("--max-holding-bars", type=int, default=48, help="Max holding period in bars")
    parser.add_argument("--notify", action="store_true", help="Send Telegram notification if score >= 80")
    args = parser.parse_args()

    leader = args.leader
    follower = "SPY" if leader == "QQQ" else "QQQ"
    instrument = f"{leader}/{follower}"

    seed = int(time.time())
    print(f"[{datetime.now(timezone.utc).isoformat()}] {instrument} {args.interval} seed={seed}")

    try:
        # Fetch raw data for both indices
        raw_leader = get_stock_candles(leader, args.interval, args.start, args.end)
        raw_follower = get_stock_candles(follower, args.interval, args.start, args.end)

        if raw_leader.empty or raw_follower.empty:
            print(f"Error: empty data for {leader} or {follower}")
            return

        # Build features (adds ATR, RSI, etc.)
        feats_leader = build_features(raw_leader, raw_follower)
        feats_follower = build_features(raw_follower, raw_leader)

        # Run validation
        result = validate_divergence_strategy(
            feats_leader,
            feats_follower,
            instrument,
            lookback=args.lookback,
            window=args.window,
            sl_atr=args.sl_atr,
            tp_atr=args.tp_atr,
            max_holding_bars=args.max_holding_bars,
        )

        print(f"\n=== Divergence Strategy: {instrument} {args.interval} ===")
        print(f"Discovery trades: {result['discovery_trades']}")
        print(f"Validation trades: {result['validation_trades']}")
        print(f"Test trades: {result['test_trades']}")

        ds = result['discovery_stats']
        vs = result['validation_stats']
        ts = result['test_stats']
        print(f"\nDiscovery:   {ds['n_trades']} trades, {ds['win_rate']:.1%} WR, {ds['expectancy_r']:.3f}R exp, {ds['profit_factor']:.2f} PF")
        print(f"Validation:  {vs['n_trades']} trades, {vs['win_rate']:.1%} WR, {vs['expectancy_r']:.3f}R exp, {vs['profit_factor']:.2f} PF")
        print(f"Test:        {ts['n_trades']} trades, {ts['win_rate']:.1%} WR, {ts['expectancy_r']:.3f}R exp, {ts['profit_factor']:.2f} PF")

        score = result['robustness_score']
        print(f"\nRobustness Score: {score['total']}/100 ({score['label']})")
        for k, v in score['components'].items():
            print(f"  {k}: {v}")
        if score.get('red_flags'):
            print("Red flags:")
            for rf in score['red_flags']:
                print(f"  - {rf}")

        # Send Telegram if requested and score is strong
        if args.notify and score['total'] >= 80:
            link = f"{DASHBOARD_URL}/experiments/divergence-{leader}-{follower}-{args.interval}" if DASHBOARD_URL else ""
            send_message(
                f"Divergence strategy cleared bar ({instrument} {args.interval})\n\n"
                f"Robustness: {score['total']}/100 ({score['label']})\n"
                f"Test: {ts['n_trades']} trades, {ts['win_rate']:.1%} WR, {ts['expectancy_r']:.3f}R exp\n\n"
                f"Structural edge: {leader} BOS divergence → {follower} confirmation.\n"
                f"{link}"
            )

    except Exception:
        print(f"Error:\n{traceback.format_exc()}")
        raise


if __name__ == "__main__":
    main()