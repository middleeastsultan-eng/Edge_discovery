"""Standalone check: did QQQ or SPY just break structure without the other confirming?

Independent of any discovered pattern's rule -- this is cross_asset.py's
detect_latest_divergence() applied directly to the two tracked indices' own recent
bars, answering "did this just happen" directly rather than only as an input feature
some discovered rule happens to reference.

Usage:
    python run_divergence_check.py --interval 5Min
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone

import pandas as pd

from trading_lab import db
from trading_lab.config import DASHBOARD_URL
from trading_lab.cross_asset import detect_latest_divergence
from trading_lab.live import _fetch_closed_bars, interval_to_timedelta
from trading_lab.telegram import send_message

_LOOKBACK_DAYS = 10


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--interval", default="5Min", help="Alpaca format, e.g. 1Min/5Min/30Min")
    args = parser.parse_args()

    print(f"[{datetime.now(timezone.utc).isoformat()}] structure divergence check ({args.interval})")

    bar_td = interval_to_timedelta(args.interval)
    now = pd.Timestamp.now(tz="UTC")
    start = (now - pd.Timedelta(days=_LOOKBACK_DAYS)).isoformat()
    end = now.isoformat()

    qqq = _fetch_closed_bars("QQQ", args.interval, "stocks", start, end, bar_td, now)
    spy = _fetch_closed_bars("SPY", args.interval, "stocks", start, end, bar_td, now)

    if qqq.empty or spy.empty:
        print("  no usable (closed) bars yet for one or both symbols -- skipping this pass.")
        return

    result = detect_latest_divergence(qqq, spy)
    if result is None:
        print("  no fresh divergence on the latest bar.")
        return

    is_new = db.record_divergence_alert_if_new(
        result["leader"], result["follower"], result["direction"], result["bar_time"],
    )
    print(
        f"  divergence: {result['leader']} broke structure ({result['direction']}), "
        f"{result['follower']} hasn't confirmed, at {result['bar_time']} "
        f"-- {'NEW' if is_new else 'already alerted'}"
    )

    if is_new:
        link = DASHBOARD_URL or ""
        arrow = "up" if result["direction"] == "bullish" else "down"
        send_message(
            f"Structure divergence -- {result['leader']} just broke {arrow} and {result['follower']} hasn't confirmed\n\n"
            f"Bar: {result['bar_time']}\n"
            f"A pro trader's read is this tends to precede a strong directional run -- "
            f"not yet a tested, scored pattern, just a live heads-up."
            + (f"\n\n{link}" if link else "")
        )
        print("    -> Telegram alert sent")


if __name__ == "__main__":
    main()
