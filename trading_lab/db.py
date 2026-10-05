"""Persistence layer: stores each research run's candidate + validation results in Postgres (Supabase)."""

from __future__ import annotations

import dataclasses
import json

import pandas as pd
import psycopg2
import psycopg2.extras

from .config import DATABASE_URL

SCHEMA = """
CREATE TABLE IF NOT EXISTS research_runs (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    source TEXT NOT NULL,
    seed INTEGER NOT NULL,
    hypotheses_tested INTEGER NOT NULL,
    level1_survivors INTEGER,
    statistically_interesting_count INTEGER,
    research_worthy_count INTEGER,
    discovery_survivors INTEGER NOT NULL,
    funnel_top_k INTEGER NOT NULL,
    validation_survivors INTEGER NOT NULL,
    finalists_count INTEGER NOT NULL
);

-- NULL means "not measured by this run" (predates a metric), distinct from a real zero.
-- Never backfill a NOT-NULL-DEFAULT-0 column here again -- that's exactly the mistake
-- being fixed below: it silently turned "unknown" into a false "zero" for old rows.
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS level1_survivors INTEGER;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS statistically_interesting_count INTEGER;
ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS research_worthy_count INTEGER;
ALTER TABLE research_runs ALTER COLUMN level1_survivors DROP NOT NULL;
ALTER TABLE research_runs ALTER COLUMN level1_survivors DROP DEFAULT;
-- level1_survivors must always be >= discovery_survivors (discovery survivors are a
-- subset that also cleared the backtest gate). Any row violating that is a leftover
-- false zero from before this metric existed -- restore it to "unknown."
UPDATE research_runs SET level1_survivors = NULL WHERE level1_survivors < discovery_survivors;

CREATE TABLE IF NOT EXISTS experiments (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    symbol TEXT NOT NULL,
    interval TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    rule TEXT NOT NULL,
    clauses JSONB NOT NULL,
    discovery_stats JSONB,
    validation_stats JSONB,
    test_stats JSONB,
    walk_forward JSONB,
    monte_carlo JSONB,
    cost_stress JSONB,
    parameter_stability JSONB,
    robustness_score JSONB,
    research_run_id INTEGER REFERENCES research_runs(id) ON DELETE SET NULL,
    information_test JSONB
);

ALTER TABLE experiments ADD COLUMN IF NOT EXISTS cost_stress JSONB;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS parameter_stability JSONB;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS robustness_score JSONB;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS research_run_id INTEGER REFERENCES research_runs(id) ON DELETE SET NULL;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS information_test JSONB;

-- Needed so the live-signal checker knows which data source (Binance vs Alpaca) to
-- query for a given experiment without a join -- research_runs.source existed, but was
-- never threaded onto the experiment row itself. Backfill from the linked run once.
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS source TEXT;
UPDATE experiments e SET source = rr.source
    FROM research_runs rr WHERE e.research_run_id = rr.id AND e.source IS NULL;
-- A handful of the earliest rows predate research_run_id entirely (no run to join to).
-- Their symbol is unambiguous in this codebase (BTCUSDT/ETHUSDT are only ever fetched
-- from Binance, SPY/QQQ only ever from Alpaca), so infer source directly as a fallback.
UPDATE experiments SET source = 'crypto' WHERE source IS NULL AND symbol IN ('BTCUSDT', 'ETHUSDT');
UPDATE experiments SET source = 'stocks' WHERE source IS NULL AND symbol IN ('SPY', 'QQQ');

CREATE TABLE IF NOT EXISTS experiment_trades (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    split TEXT NOT NULL,
    entry_time TIMESTAMPTZ NOT NULL,
    exit_time TIMESTAMPTZ NOT NULL,
    entry_price DOUBLE PRECISION NOT NULL,
    exit_price DOUBLE PRECISION NOT NULL,
    exit_reason TEXT NOT NULL,
    r_multiple DOUBLE PRECISION NOT NULL,
    bars_held INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiment_trades_experiment_id ON experiment_trades(experiment_id);

-- Continuous forward/paper-trading verdict for a proven (robustness_score=100) pattern.
-- Recomputed on every live check, not a one-way gate -- a promoted pattern whose live
-- performance degrades later gets demoted back to "tracking" automatically.
CREATE TABLE IF NOT EXISTS forward_validation (
    experiment_id INTEGER PRIMARY KEY REFERENCES experiments(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'tracking',
    forward_stats JSONB,
    promoted_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per entry signal we've already alerted on, so a pending signal that keeps
-- showing up in consecutive live checks (before the next bar closes) never double-fires.
CREATE TABLE IF NOT EXISTS forward_signal_alerts (
    id SERIAL PRIMARY KEY,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    bar_time TIMESTAMPTZ NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (experiment_id, bar_time)
);

-- Single-row remote control for the local multiprocessing research loop (run_overnight.py).
-- The dashboard writes here; the local script polls it once per round to decide how many
-- worker processes to run and whether to pause. id is always 1 -- not a history, a live knob.
CREATE TABLE IF NOT EXISTS local_agent_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    max_workers INTEGER NOT NULL DEFAULT 3,
    paused BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT local_agent_settings_single_row CHECK (id = 1)
);
INSERT INTO local_agent_settings (id, max_workers, paused) VALUES (1, 3, false) ON CONFLICT (id) DO NOTHING;

-- Supabase exposes every public-schema table over PostgREST; with RLS disabled, anyone
-- holding the project's anon/public API key can read or write these tables directly over
-- HTTP, bypassing this app entirely. Enabling RLS with zero policies locks out that
-- anon/public surface (default-deny) without affecting either real access path: this
-- app's psycopg2 connections use the table owner (bypasses RLS by default), and the web
-- dashboard's Supabase client uses the service_role key (always bypasses RLS).
ALTER TABLE research_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE experiment_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE local_agent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE forward_validation ENABLE ROW LEVEL SECURITY;
ALTER TABLE forward_signal_alerts ENABLE ROW LEVEL SECURITY;
"""


def get_connection():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL is not set in .env")
    return psycopg2.connect(DATABASE_URL)


def init_schema() -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(SCHEMA)
        conn.commit()


def _json_safe(obj):
    """Postgres's jsonb parser only accepts strict JSON, but Python's json.dumps emits
    the non-standard literal `Infinity` for an infinite float (e.g. TradeStats.profit_factor
    when there are zero losing trades) -- that insert fails with InvalidTextRepresentation.
    Recursively swap inf/-inf/nan for None (-> JSON null) before dumping.
    """
    if isinstance(obj, float):
        return None if (obj != obj or obj in (float("inf"), float("-inf"))) else obj
    if isinstance(obj, dict):
        return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_json_safe(v) for v in obj]
    return obj


def _clauses_to_json(clauses) -> str:
    return json.dumps([dataclasses.asdict(c) for c in clauses])


def _df_to_json(df: pd.DataFrame | None) -> str | None:
    if df is None or not len(df):
        return None
    return df.to_json(orient="records", date_format="iso")


def save_research_run(
    symbol: str,
    interval: str,
    source: str,
    seed: int,
    hypotheses_tested: int,
    level1_survivors: int | None,
    statistically_interesting_count: int | None,
    research_worthy_count: int | None,
    discovery_survivors: int,
    funnel_top_k: int,
    validation_survivors: int,
    finalists_count: int,
) -> int:
    """Log one discovery pass for the hypothesis ledger -- recorded regardless of
    outcome, so 'how many hypotheses have we tested total' is a real, queryable number.
    Pass None for a metric a given run doesn't measure -- never a false zero.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO research_runs
                    (symbol, interval, source, seed, hypotheses_tested, level1_survivors,
                     statistically_interesting_count, research_worthy_count,
                     discovery_survivors, funnel_top_k, validation_survivors, finalists_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (symbol, interval, source, seed, hypotheses_tested, level1_survivors,
                 statistically_interesting_count, research_worthy_count,
                 discovery_survivors, funnel_top_k, validation_survivors, finalists_count),
            )
            run_id = cur.fetchone()[0]
        conn.commit()
    return run_id


def save_experiment(
    symbol: str,
    interval: str,
    start_date: str,
    end_date: str,
    rule: str,
    clauses,
    discovery_stats: dict,
    validation_stats: dict | None = None,
    test_stats: dict | None = None,
    walk_forward: pd.DataFrame | None = None,
    monte_carlo: dict | None = None,
    cost_stress: pd.DataFrame | None = None,
    parameter_stability: dict | None = None,
    robustness_score: dict | None = None,
    research_run_id: int | None = None,
    information_test: dict | None = None,
    source: str | None = None,
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO experiments
                    (symbol, interval, start_date, end_date, rule, clauses,
                     discovery_stats, validation_stats, test_stats, walk_forward, monte_carlo,
                     cost_stress, parameter_stability, robustness_score, research_run_id, information_test, source)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    symbol, interval, start_date, end_date, rule,
                    _clauses_to_json(clauses),
                    json.dumps(_json_safe(discovery_stats)),
                    json.dumps(_json_safe(validation_stats)) if validation_stats else None,
                    json.dumps(_json_safe(test_stats)) if test_stats else None,
                    _df_to_json(walk_forward),
                    json.dumps(_json_safe(monte_carlo)) if monte_carlo else None,
                    _df_to_json(cost_stress),
                    json.dumps(_json_safe(parameter_stability)) if parameter_stability else None,
                    json.dumps(_json_safe(robustness_score)) if robustness_score else None,
                    research_run_id,
                    json.dumps(information_test) if information_test else None,
                    source,
                ),
            )
            experiment_id = cur.fetchone()[0]
        conn.commit()
    return experiment_id


def total_hypotheses_tested() -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COALESCE(SUM(hypotheses_tested), 0) FROM research_runs")
            return int(cur.fetchone()[0])


def get_agent_settings() -> dict:
    """Read the live remote-control settings for the local multiprocessing loop."""
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT max_workers, paused FROM local_agent_settings WHERE id = 1")
            row = cur.fetchone()
            if row is None:
                return {"max_workers": 3, "paused": False}
            return {"max_workers": row[0], "paused": row[1]}


def set_agent_settings(max_workers: int, paused: bool) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO local_agent_settings (id, max_workers, paused, updated_at)
                VALUES (1, %s, %s, now())
                ON CONFLICT (id) DO UPDATE SET max_workers = %s, paused = %s, updated_at = now()
                """,
                (max_workers, paused, max_workers, paused),
            )
        conn.commit()


def save_trades(experiment_id: int, trades: pd.DataFrame, split: str) -> None:
    if trades.empty:
        return
    rows = [
        (
            experiment_id, split,
            row.entry_time.to_pydatetime(), row.exit_time.to_pydatetime(),
            float(row.entry_price), float(row.exit_price),
            row.exit_reason, float(row.r_multiple), int(row.bars_held),
        )
        for row in trades.itertuples()
    ]
    with get_connection() as conn:
        with conn.cursor() as cur:
            psycopg2.extras.execute_values(
                cur,
                """
                INSERT INTO experiment_trades
                    (experiment_id, split, entry_time, exit_time, entry_price, exit_price, exit_reason, r_multiple, bars_held)
                VALUES %s
                """,
                rows,
            )
        conn.commit()


def list_experiments(limit: int = 20) -> pd.DataFrame:
    with get_connection() as conn:
        return pd.read_sql(
            "SELECT id, created_at, symbol, interval, rule, discovery_stats, validation_stats, test_stats "
            "FROM experiments ORDER BY created_at DESC LIMIT %(limit)s",
            conn, params={"limit": limit},
        )


def get_proven_experiments(min_score: float = 100.0, symbol: str | None = None,
                            interval: str | None = None, source: str | None = None) -> pd.DataFrame:
    """Experiments whose robustness_score.total clears min_score -- the backward-looking
    gate. Optionally narrowed to one symbol/interval/source combo (the live checker runs
    once per combo, mirroring run_scheduled.py).
    """
    query = (
        "SELECT id, symbol, interval, source, rule, clauses, test_stats, robustness_score "
        "FROM experiments WHERE (robustness_score->>'total')::float >= %(min_score)s"
    )
    params: dict = {"min_score": min_score}
    if symbol is not None:
        query += " AND symbol = %(symbol)s"
        params["symbol"] = symbol
    if interval is not None:
        query += " AND interval = %(interval)s"
        params["interval"] = interval
    if source is not None:
        query += " AND source = %(source)s"
        params["source"] = source
    with get_connection() as conn:
        return pd.read_sql(query, conn, params=params)


def get_trades(experiment_id: int, split: str) -> pd.DataFrame:
    with get_connection() as conn:
        return pd.read_sql(
            "SELECT entry_time, exit_time, entry_price, exit_price, exit_reason, r_multiple, bars_held "
            "FROM experiment_trades WHERE experiment_id = %(experiment_id)s AND split = %(split)s "
            "ORDER BY entry_time",
            conn, params={"experiment_id": experiment_id, "split": split},
        )


def get_forward_validation(experiment_id: int) -> dict | None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT status, forward_stats, promoted_at FROM forward_validation WHERE experiment_id = %s",
                (experiment_id,),
            )
            row = cur.fetchone()
            if row is None:
                return None
            return {"status": row[0], "forward_stats": row[1], "promoted_at": row[2]}


def upsert_forward_validation(experiment_id: int, status: str, forward_stats: dict,
                               promoted_at=None) -> None:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forward_validation (experiment_id, status, forward_stats, promoted_at, updated_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (experiment_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    forward_stats = EXCLUDED.forward_stats,
                    promoted_at = COALESCE(forward_validation.promoted_at, EXCLUDED.promoted_at),
                    updated_at = now()
                """,
                (experiment_id, status, json.dumps(_json_safe(forward_stats)), promoted_at),
            )
        conn.commit()


def record_alert_if_new(experiment_id: int, bar_time) -> bool:
    """Returns True (and logs it) only the first time this exact signal bar is seen --
    the UNIQUE constraint on (experiment_id, bar_time) is what makes this safe to call
    on every live check without ever double-alerting the same pending entry.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO forward_signal_alerts (experiment_id, bar_time)
                VALUES (%s, %s)
                ON CONFLICT (experiment_id, bar_time) DO NOTHING
                RETURNING id
                """,
                (experiment_id, bar_time),
            )
            is_new = cur.fetchone() is not None
        conn.commit()
    return is_new
