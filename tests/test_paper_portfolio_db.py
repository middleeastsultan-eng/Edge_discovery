"""Integration regression test for a real bug: get_unprocessed_forward_trades used
to filter by a single watermark shared across EVERY promoted pattern. If pattern B's
forward trade (for a LATER bar) got persisted and processed before pattern A's
forward trade (for an EARLIER bar) -- which can genuinely happen, since each
pattern's live checks run on independent schedules -- the shared watermark would
advance past pattern A's trade and skip it forever.

The fix made this an anti-join scoped to each pattern's own experiment_id, with no
cross-pattern dependency at all. This test proves that directly against a real
database: inserting a "later" paper_trades row for one experiment must have zero
effect on what counts as unprocessed for a completely different experiment.

Requires DATABASE_URL (skipped otherwise). Inserts throwaway experiments/trades and
always cleans them up in a finally block, even on failure.
"""
from __future__ import annotations

import os

import pandas as pd
import pytest

from trading_lab import db
from trading_lab.discovery import Clause

pytestmark = pytest.mark.skipif(not os.environ.get("DATABASE_URL"), reason="requires a live DATABASE_URL")


@pytest.fixture
def two_throwaway_experiments():
    ids = []
    try:
        for i in range(2):
            exp_id = db.save_experiment(
                symbol="TESTCOIN", interval="1h", start_date="2020-01-01", end_date="2020-01-02",
                rule=f"__pytest_watermark_regression_{i}", clauses=[Clause(feature="rsi_14", op=">", value=50)],
                discovery_stats={"n_trades": 0, "win_rate": 0, "expectancy_r": 0, "profit_factor": 0,
                                  "sharpe": 0, "max_drawdown_r": 0, "avg_win_r": 0, "avg_loss_r": 0},
            )
            ids.append(exp_id)
        yield ids
    finally:
        with db.get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM experiments WHERE id = ANY(%s)", (ids,))
            conn.commit()


def test_unprocessed_trades_are_isolated_per_pattern(two_throwaway_experiments):
    exp_a, exp_b = two_throwaway_experiments
    promoted_at = pd.Timestamp("2020-01-01", tz="UTC")

    early_trade = pd.DataFrame([{
        "entry_time": pd.Timestamp("2020-06-01", tz="UTC"), "exit_time": pd.Timestamp("2020-06-02", tz="UTC"),
        "entry_price": 100.0, "exit_price": 101.0, "exit_reason": "target", "r_multiple": 1.0, "bars_held": 5,
    }])
    late_trade = pd.DataFrame([{
        "entry_time": pd.Timestamp("2020-09-01", tz="UTC"), "exit_time": pd.Timestamp("2020-09-02", tz="UTC"),
        "entry_price": 100.0, "exit_price": 99.0, "exit_reason": "stop", "r_multiple": -1.0, "bars_held": 5,
    }])
    db.save_trades(exp_a, early_trade, "forward")
    db.save_trades(exp_b, late_trade, "forward")

    # Simulate pattern B's LATER trade getting fully processed into paper_trades
    # FIRST (the exact ordering that broke the old shared-watermark design).
    db.insert_paper_trade(exp_b, late_trade.iloc[0]["entry_time"], late_trade.iloc[0]["exit_time"], -1.0, 100.0, -100.0, 9900.0)

    # Pattern A's EARLIER trade must still show up as unprocessed -- its own
    # per-pattern anti-join has nothing to do with what happened to pattern B.
    unprocessed_a = db.get_unprocessed_forward_trades(exp_a, promoted_at)
    assert len(unprocessed_a) == 1
    assert pd.Timestamp(unprocessed_a.iloc[0]["entry_time"]) == early_trade.iloc[0]["entry_time"]

    # And pattern B's own trade, now that it has a matching paper_trades row, must
    # correctly show as already processed.
    unprocessed_b = db.get_unprocessed_forward_trades(exp_b, promoted_at)
    assert len(unprocessed_b) == 0
