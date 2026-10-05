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
    level1_survivors INTEGER NOT NULL DEFAULT 0,
    discovery_survivors INTEGER NOT NULL,
    funnel_top_k INTEGER NOT NULL,
    validation_survivors INTEGER NOT NULL,
    finalists_count INTEGER NOT NULL
);

ALTER TABLE research_runs ADD COLUMN IF NOT EXISTS level1_survivors INTEGER NOT NULL DEFAULT 0;

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
    level1_survivors: int,
    discovery_survivors: int,
    funnel_top_k: int,
    validation_survivors: int,
    finalists_count: int,
) -> int:
    """Log one discovery pass for the hypothesis ledger -- recorded regardless of
    outcome, so 'how many hypotheses have we tested total' is a real, queryable number.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO research_runs
                    (symbol, interval, source, seed, hypotheses_tested, level1_survivors,
                     discovery_survivors, funnel_top_k, validation_survivors, finalists_count)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (symbol, interval, source, seed, hypotheses_tested, level1_survivors,
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
) -> int:
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO experiments
                    (symbol, interval, start_date, end_date, rule, clauses,
                     discovery_stats, validation_stats, test_stats, walk_forward, monte_carlo,
                     cost_stress, parameter_stability, robustness_score, research_run_id, information_test)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    symbol, interval, start_date, end_date, rule,
                    _clauses_to_json(clauses),
                    json.dumps(discovery_stats),
                    json.dumps(validation_stats) if validation_stats else None,
                    json.dumps(test_stats) if test_stats else None,
                    _df_to_json(walk_forward),
                    json.dumps(monte_carlo) if monte_carlo else None,
                    _df_to_json(cost_stress),
                    json.dumps(parameter_stability) if parameter_stability else None,
                    json.dumps(robustness_score) if robustness_score else None,
                    research_run_id,
                    json.dumps(information_test) if information_test else None,
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
