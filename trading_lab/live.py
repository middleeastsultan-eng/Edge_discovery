"""Forward/paper-trading verification for patterns the backtest pipeline already
scored as "proven" (robustness_score.total == 100).

A 100 backtest score is a statement about the past. This module is the forward-looking
half of the loop: it re-evaluates the SAME frozen rule against fresh, real market data as
it arrives, tracks the trades it would actually have taken, and only recommends a pattern
for live alerting once its forward performance has itself held up -- not once, but on
every check, so a pattern that degrades later loses its "promoted" status automatically.

Nothing here re-fits or tunes a rule. A clause that passed discovery+validation+test is
frozen; this only asks "does reality still agree with it."
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import pandas as pd

from . import db
from .backtest import BacktestConfig, run_backtest
from .config import DASHBOARD_URL
from .data import fetch_klines
from .data_stocks import fetch_bars
from .discovery import Candidate, Clause
from .features import build_features
from .metrics import TradeStats, compute_stats

# A pattern needs this many forward (live/paper) trades before its forward stats mean
# anything -- below this, status stays "tracking" regardless of how good those few
# trades looked.
MIN_FORWARD_TRADES = 20

# Forward expectancy must retain at least this fraction of the backtested test-set
# expectancy to promote -- same "did it hold up out of sample" logic validate.py's
# robustness_score already applies to test-vs-discovery, applied here to live-vs-test.
RETENTION_MIN = 0.5

# How "proven" is defined for entry into forward tracking at all.
PROVEN_MIN_SCORE = 100.0

_LOOKBACK_BARS = 3000
_MIN_LOOKBACK_DAYS = 10
_MAX_LOOKBACK_DAYS = 400

_INTERVAL_RE = re.compile(r"^(\d+)\s*([a-zA-Z]+)$")
_UNIT_TO_TIMEDELTA = {
    "m": "minutes", "min": "minutes", "mins": "minutes", "minute": "minutes", "minutes": "minutes",
    "h": "hours", "hr": "hours", "hour": "hours", "hours": "hours",
    "d": "days", "day": "days", "days": "days",
    "w": "weeks", "week": "weeks", "weeks": "weeks",
}


def interval_to_timedelta(interval: str) -> pd.Timedelta:
    """Parses both Binance-style ("15m", "1h", "4h", "1d") and Alpaca-style
    ("15Min", "1Hour", "1Day") interval strings into a bar duration.
    """
    match = _INTERVAL_RE.match(interval.strip())
    if not match:
        raise ValueError(f"Unrecognized interval format: {interval!r}")
    n, unit = int(match.group(1)), match.group(2).lower()
    key = _UNIT_TO_TIMEDELTA.get(unit)
    if key is None:
        raise ValueError(f"Unrecognized interval unit {unit!r} in {interval!r}")
    return pd.Timedelta(**{key: n})


def fetch_live_features(symbol: str, interval: str, source: str) -> pd.DataFrame:
    """Fetches a recent rolling window up to now and builds features on it.

    Deliberately bypasses get_candles'/get_stock_candles' Parquet cache -- that cache
    is keyed by the start/end strings, which change every call here (we always want the
    freshest bar), so caching would just churn Parquet files on disk for no benefit, and
    an ISO timestamp with colons isn't even a valid Windows filename. We call the raw
    fetch functions directly instead.
    """
    bar_td = interval_to_timedelta(interval)
    lookback_days = (_LOOKBACK_BARS * bar_td) / pd.Timedelta(days=1)
    lookback_days = max(_MIN_LOOKBACK_DAYS, min(_MAX_LOOKBACK_DAYS, lookback_days))

    now = pd.Timestamp.now(tz="UTC")
    start = (now - pd.Timedelta(days=lookback_days)).isoformat()
    end = now.isoformat()

    raw = fetch_bars(symbol, interval, start, end) if source == "stocks" else fetch_klines(symbol, interval, start, end)
    if raw.empty:
        return raw

    # Drop the currently-forming bar -- its close hasn't happened yet, so evaluating a
    # clause against it would be reading an incomplete candle as if it were final.
    closes_at = raw.index + bar_td
    raw = raw[closes_at <= now]
    if raw.empty:
        return raw

    return build_features(raw)


def evaluate_promotion(forward_stats: TradeStats, test_expectancy_r: float) -> str:
    """Re-decided on every check -- this is what makes forward validation continuous
    rather than a one-time gate a pattern passes once and keeps forever.
    """
    if forward_stats.n_trades < MIN_FORWARD_TRADES:
        return "tracking"
    if forward_stats.expectancy_r <= 0:
        return "tracking"
    if test_expectancy_r > 0 and forward_stats.expectancy_r < RETENTION_MIN * test_expectancy_r:
        return "tracking"
    return "promoted"


@dataclass
class CheckResult:
    experiment_id: int
    pending: bool
    bar_time: pd.Timestamp | None
    forward_stats: TradeStats
    status: str
    new_trade_count: int


def check_pattern(experiment_row: dict, feats: pd.DataFrame, config: BacktestConfig = BacktestConfig()) -> CheckResult:
    """One live check for one proven pattern: re-evaluates its frozen rule against feats,
    persists any newly-closed forward trades, and recomputes its promotion status.

    Relies on run_backtest's own loop bound (`while i < n - 1`) to never evaluate the
    final bar -- so `signal.iloc[-1]` being True means "fired, but not yet actionable
    until the next bar opens," with zero risk of double-counting it once it does close
    and shows up in `trades` on a later call.
    """
    experiment_id = int(experiment_row["id"])

    if feats.empty:
        forward_stats = compute_stats([])
        return CheckResult(experiment_id, False, None, forward_stats, "tracking", 0)

    candidate = Candidate(clauses=[Clause(**c) for c in experiment_row["clauses"]])
    signal = candidate.signal(feats)
    trades = run_backtest(feats, signal, config)

    existing = db.get_trades(experiment_id, "forward")
    existing_entry_times = set(pd.to_datetime(existing["entry_time"], utc=True)) if len(existing) else set()
    new_trades = trades[~trades["entry_time"].isin(existing_entry_times)] if len(trades) else trades
    if len(new_trades):
        db.save_trades(experiment_id, new_trades, "forward")

    all_forward = db.get_trades(experiment_id, "forward")
    forward_stats = compute_stats(all_forward["r_multiple"]) if len(all_forward) else compute_stats([])

    test_stats = experiment_row.get("test_stats") or {}
    status = evaluate_promotion(forward_stats, float(test_stats.get("expectancy_r", 0.0)))

    pending = bool(signal.iloc[-1])
    bar_time = feats.index[-1]

    return CheckResult(experiment_id, pending, bar_time, forward_stats, status, len(new_trades))


def build_alert_message(experiment_row: dict, feats: pd.DataFrame, forward_stats: TradeStats,
                         config: BacktestConfig = BacktestConfig()) -> str:
    last = feats.iloc[-1]
    entry_ref = float(last["close"])
    atr = float(last["atr_14"])
    stop_price = entry_ref - config.sl_atr * atr
    target_price = entry_ref + config.tp_atr * atr
    expected_move_pct = (target_price - entry_ref) / entry_ref

    link = f"{DASHBOARD_URL}/experiments/{experiment_row['id']}" if DASHBOARD_URL else ""

    return (
        f"Trade signal -- {experiment_row['symbol']} {experiment_row['interval']}\n\n"
        f"Pattern: {experiment_row['rule']}\n"
        f"Forward track record: {forward_stats.n_trades} trades, "
        f"{forward_stats.win_rate:.0%} win rate, {forward_stats.expectancy_r:.3f}R expectancy\n\n"
        f"Entry: next bar open (~{entry_ref:.4g})\n"
        f"Stop: {stop_price:.4g}   Target: {target_price:.4g}\n"
        f"Expected move: {expected_move_pct:+.2%} ({config.tp_atr:.1f}R target / {config.sl_atr:.1f}R stop)"
        + (f"\n\n{link}" if link else "")
    )
