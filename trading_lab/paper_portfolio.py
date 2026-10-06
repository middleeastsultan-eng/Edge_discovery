"""A single simulated account that actually takes signals from promoted (forward-proven)
patterns, sized by real risk rules, so you can see how the combined book behaves before
it would matter with real capital.

Per-pattern forward tracking (trading_lab/live.py) already proves each rule individually.
This module doesn't re-simulate price action -- live.py's check_pattern() has already
produced the authoritative, cost-aware trades. This module's only job is capital
allocation across them: turning "pattern X's forward trades" into "what happened to one
shared account that trusted all promoted patterns at once." That matters because several
correlated patterns firing together isn't several independent edges, it's one bet
multiplied -- something no single pattern's backtest or forward stats can show you.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import db

RISK_PER_TRADE = 0.01       # fraction of current equity risked on each new trade
MAX_CONCURRENT_RISK = 0.10  # cap on total risk open across all simultaneous positions
STARTING_EQUITY = 10_000.0  # notional unit -- % return/drawdown/Sharpe are what matter


@dataclass
class ProcessResult:
    processed: int = 0
    skipped_for_exposure: int = 0
    equity_before: float = 0.0
    equity_after: float = 0.0
    locked_out: bool = False
    skipped_entries: list = field(default_factory=list)


def process_new_trades() -> ProcessResult:
    """Scans every currently-promoted pattern's forward trades since it was promoted
    (hindsight bias guard: a trade only counts once its pattern had ALREADY earned
    promotion) and since the account's watermark, merges them into one global
    chronological sequence, and allocates paper capital trade by trade.

    Holds a Postgres advisory lock for the whole call -- cheap insurance against two
    overlapping scheduled runs double-processing the same equity sequence. Correctness
    here relies on this running as a short-lived, one-shot process (as it does via
    run_paper_portfolio.py / GitHub Actions): the lock connection is deliberately never
    closed early, so OS process exit is what releases it. A long-running daemon reusing
    this function would need to explicitly close the lock connection instead.
    """
    lock_conn = db.get_connection()
    if not db.try_acquire_paper_portfolio_lock(lock_conn):
        return ProcessResult(locked_out=True)

    account = db.get_paper_account()
    equity = account["equity"]

    promoted = db.get_promoted_patterns_with_promotion_time()
    if promoted.empty:
        return ProcessResult(equity_before=equity, equity_after=equity)

    candidates = []
    for _, row in promoted.iterrows():
        experiment_id = int(row["experiment_id"])
        promoted_at = row["promoted_at"]
        # get_unprocessed_forward_trades already excludes anything with a matching
        # paper_trades row -- no separate "since last run" cursor needed per pattern,
        # and deliberately no shared cross-pattern cursor (see its docstring for why).
        trades = db.get_unprocessed_forward_trades(experiment_id, promoted_at)
        for _, t in trades.iterrows():
            candidates.append({
                "experiment_id": experiment_id,
                "entry_time": t["entry_time"],
                "exit_time": t["exit_time"],
                "r_multiple": float(t["r_multiple"]),
            })

    if not candidates:
        return ProcessResult(equity_before=equity, equity_after=equity)

    candidates.sort(key=lambda c: c["entry_time"])

    existing = db.list_paper_trades()
    open_positions = [
        {"entry_time": r["entry_time"], "exit_time": r["exit_time"], "risked_amount": r["risked_amount"]}
        for _, r in existing.iterrows()
    ]

    result = ProcessResult(equity_before=equity)
    # Purely informational now (e.g. "processed through" on the dashboard) -- no longer
    # used to decide what counts as unprocessed, see get_unprocessed_forward_trades.
    new_watermark = account["watermark"]

    for c in candidates:
        open_risk = sum(
            p["risked_amount"] for p in open_positions
            if p["entry_time"] <= c["entry_time"] < p["exit_time"]
        )
        risk_amount = equity * RISK_PER_TRADE

        if open_risk + risk_amount > equity * MAX_CONCURRENT_RISK:
            result.skipped_for_exposure += 1
            result.skipped_entries.append(c)
        else:
            pnl = c["r_multiple"] * risk_amount
            equity += pnl
            db.insert_paper_trade(
                c["experiment_id"], c["entry_time"], c["exit_time"],
                c["r_multiple"], risk_amount, pnl, equity,
            )
            open_positions.append({
                "entry_time": c["entry_time"], "exit_time": c["exit_time"], "risked_amount": risk_amount,
            })
            result.processed += 1

        new_watermark = c["entry_time"]

    db.upsert_paper_account(equity, new_watermark)
    result.equity_after = equity
    return result
