#!/usr/bin/env python3
"""
check_top.py — query live-check results directly from the DB.

Usage:
    python check_top.py                    # latest snapshot for all tracked experiments
    python check_top.py --history 1738     # time-series history for one experiment
    python check_top.py --source stocks    # filter snapshot to one source
    python check_top.py --status promoted  # filter to promoted / tracking
    python check_top.py --recent 24        # experiments checked in the last N hours
    python check_top.py --divergence       # show divergence-strategy forward-validation rows
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()


def get_conn():
    url = os.environ.get("DATABASE_URL", "")
    if not url:
        sys.exit("DATABASE_URL not set — check your .env file")
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)


# ── helpers ──────────────────────────────────────────────────────────────────

def fmt_r(v) -> str:
    return f"{float(v):+.3f}R" if v is not None else "  n/a "


def fmt_dt(dt) -> str:
    if dt is None:
        return "never"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    mins = int(delta.total_seconds() / 60)
    if mins < 60:
        return f"{mins}m ago"
    if mins < 60 * 24:
        return f"{mins // 60}h {mins % 60}m ago"
    return f"{mins // 1440}d ago"


def status_icon(s: str) -> str:
    return "✅" if s == "promoted" else "⏳"


# ── queries ───────────────────────────────────────────────────────────────────

def show_snapshot(conn, source=None, status_filter=None, recent_hours=None):
    """Latest forward-validation snapshot joined to experiments."""
    where_clauses = []
    params = []

    if source:
        where_clauses.append("e.source = %s")
        params.append(source)
    if status_filter:
        where_clauses.append("fv.status = %s")
        params.append(status_filter)
    if recent_hours:
        where_clauses.append("fv.updated_at >= now() - interval '%s hours'")
        params.append(recent_hours)

    where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    query = f"""
        SELECT
            e.id              AS experiment_id,
            e.source,
            e.symbol,
            e.interval,
            e.rule,
            fv.status,
            fv.updated_at,
            fv.promoted_at,
            (fv.forward_stats->>'n_trades')::int       AS n_trades,
            (fv.forward_stats->>'expectancy_r')::float AS expectancy_r,
            (fv.forward_stats->>'lower_bound_r')::float AS lower_bound_r
        FROM forward_validation fv
        JOIN experiments e ON e.id = fv.experiment_id
        {where_sql}
        ORDER BY fv.status DESC, (fv.forward_stats->>'expectancy_r')::float DESC NULLS LAST
    """

    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = cur.fetchall()

    if not rows:
        print("No rows found.")
        return

    promoted = [r for r in rows if r["status"] == "promoted"]
    tracking = [r for r in rows if r["status"] != "promoted"]

    def print_section(title, section_rows):
        if not section_rows:
            return
        print(f"\n{'─' * 80}")
        print(f"  {title}  ({len(section_rows)} experiments)")
        print(f"{'─' * 80}")
        print(f"  {'ID':>6}  {'src':<8} {'sym':<8} {'interval':<8} {'n':>5}  {'exp_R':>8}  {'lb_R':>8}  {'updated':<14}  rule")
        print(f"  {'─'*6}  {'─'*8} {'─'*8} {'─'*8} {'─'*5}  {'─'*8}  {'─'*8}  {'─'*14}  {'─'*30}")
        for r in section_rows:
            rule_short = (r["rule"] or "")[:40]
            print(
                f"  {r['experiment_id']:>6}  {(r['source'] or ''):.<8} {(r['symbol'] or ''):.<8} "
                f"{(r['interval'] or ''):.<8} {(r['n_trades'] or 0):>5}  "
                f"{fmt_r(r['expectancy_r']):>8}  {fmt_r(r['lower_bound_r']):>8}  "
                f"{fmt_dt(r['updated_at']):<14}  {rule_short}"
            )

    print_section(f"{status_icon('promoted')} PROMOTED", promoted)
    print_section(f"{status_icon('tracking')} TRACKING", tracking)
    print(f"\n  Total: {len(rows)} experiments ({len(promoted)} promoted, {len(tracking)} tracking)")


def show_history(conn, experiment_id: int):
    """Full time-series history for one experiment."""
    with conn.cursor() as cur:
        # experiment metadata
        cur.execute(
            "SELECT source, symbol, interval, rule FROM experiments WHERE id = %s",
            (experiment_id,),
        )
        exp = cur.fetchone()
        if not exp:
            print(f"Experiment {experiment_id} not found.")
            return

        cur.execute(
            """
            SELECT checked_at, status, n_trades, expectancy_r, lower_bound_r
            FROM forward_validation_history
            WHERE experiment_id = %s
            ORDER BY checked_at ASC
            """,
            (experiment_id,),
        )
        rows = cur.fetchall()

    print(f"\n  Experiment {experiment_id}: {exp['source']} / {exp['symbol']} / {exp['interval']}")
    print(f"  Rule: {exp['rule']}")
    print(f"  {len(rows)} check(s) recorded\n")

    if not rows:
        print("  No history yet.")
        return

    print(f"  {'checked_at':<28}  {'status':<10}  {'n':>5}  {'exp_R':>8}  {'lb_R':>8}")
    print(f"  {'─'*28}  {'─'*10}  {'─'*5}  {'─'*8}  {'─'*8}")
    for r in rows:
        dt_str = r["checked_at"].strftime("%Y-%m-%d %H:%M:%S UTC") if r["checked_at"] else "?"
        icon = status_icon(r["status"])
        print(
            f"  {dt_str:<28}  {icon} {r['status']:<8}  {r['n_trades']:>5}  "
            f"{fmt_r(r['expectancy_r']):>8}  {fmt_r(r['lower_bound_r']):>8}"
        )


def show_recent_checks(conn, hours: int):
    """All check rows written in the last N hours — useful to see what a run actually did."""
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
                h.checked_at,
                h.experiment_id,
                e.source,
                e.symbol,
                e.interval,
                h.status,
                h.n_trades,
                h.expectancy_r,
                h.lower_bound_r
            FROM forward_validation_history h
            JOIN experiments e ON e.id = h.experiment_id
            WHERE h.checked_at >= now() - interval '1 hour' * %s
            ORDER BY h.checked_at DESC
            """,
            (hours,),
        )
        rows = cur.fetchall()

    if not rows:
        print(f"  No checks recorded in the last {hours}h.")
        return

    print(f"\n  {'─'*90}")
    print(f"  Checks in the last {hours}h  ({len(rows)} rows)")
    print(f"  {'─'*90}")
    print(f"  {'checked_at':<22}  {'ID':>6}  {'src':<8} {'sym':<8} {'int':<8} {'st':<10}  {'n':>5}  {'exp_R':>8}  {'lb_R':>8}")
    print(f"  {'─'*22}  {'─'*6}  {'─'*8} {'─'*8} {'─'*8} {'─'*10}  {'─'*5}  {'─'*8}  {'─'*8}")
    for r in rows:
        dt_str = r["checked_at"].strftime("%m-%d %H:%M") if r["checked_at"] else "?"
        icon = status_icon(r["status"])
        print(
            f"  {dt_str:<22}  {r['experiment_id']:>6}  {(r['source'] or ''):.<8} "
            f"{(r['symbol'] or ''):.<8} {(r['interval'] or ''):.<8} "
            f"{icon} {r['status']:<8}  {r['n_trades']:>5}  "
            f"{fmt_r(r['expectancy_r']):>8}  {fmt_r(r['lower_bound_r']):>8}"
        )


def show_divergence(conn):
    """Forward-validation rows for divergence-strategy experiments."""
    with conn.cursor() as cur:
        # divergence experiments are identified by having 'divergence' or 'leader' in their rule
        cur.execute(
            """
            SELECT
                e.id,
                e.source,
                e.symbol,
                e.interval,
                e.rule,
                fv.status,
                fv.updated_at,
                (fv.forward_stats->>'n_trades')::int        AS n_trades,
                (fv.forward_stats->>'expectancy_r')::float  AS expectancy_r,
                (fv.forward_stats->>'lower_bound_r')::float AS lower_bound_r
            FROM forward_validation fv
            JOIN experiments e ON e.id = fv.experiment_id
            WHERE e.rule ILIKE '%divergen%' OR e.rule ILIKE '%leader%'
            ORDER BY fv.status DESC, expectancy_r DESC NULLS LAST
            """,
        )
        rows = cur.fetchall()

    if not rows:
        # fallback: show the most recently updated rows (divergence runs may use generic rules)
        print("  No experiments with 'divergence'/'leader' in rule name found.")
        print("  Showing the 10 most recently updated forward-validation rows instead:\n")
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    e.id, e.source, e.symbol, e.interval, e.rule,
                    fv.status, fv.updated_at,
                    (fv.forward_stats->>'n_trades')::int        AS n_trades,
                    (fv.forward_stats->>'expectancy_r')::float  AS expectancy_r,
                    (fv.forward_stats->>'lower_bound_r')::float AS lower_bound_r
                FROM forward_validation fv
                JOIN experiments e ON e.id = fv.experiment_id
                ORDER BY fv.updated_at DESC
                LIMIT 10
                """
            )
            rows = cur.fetchall()

    print(f"\n  {'─'*90}")
    print(f"  Divergence / recent forward-validation  ({len(rows)} rows)")
    print(f"  {'─'*90}")
    print(f"  {'ID':>6}  {'src':<8} {'sym':<8} {'int':<8} {'st':<10}  {'n':>5}  {'exp_R':>8}  {'lb_R':>8}  {'updated':<14}  rule")
    print(f"  {'─'*6}  {'─'*8} {'─'*8} {'─'*8} {'─'*10}  {'─'*5}  {'─'*8}  {'─'*8}  {'─'*14}  {'─'*35}")
    for r in rows:
        icon = status_icon(r["status"])
        rule_short = (r["rule"] or "")[:40]
        print(
            f"  {r['id']:>6}  {(r['source'] or ''):.<8} {(r['symbol'] or ''):.<8} "
            f"{(r['interval'] or ''):.<8} {icon} {r['status']:<8}  "
            f"{(r['n_trades'] or 0):>5}  {fmt_r(r['expectancy_r']):>8}  "
            f"{fmt_r(r['lower_bound_r']):>8}  {fmt_dt(r['updated_at']):<14}  {rule_short}"
        )


# ── main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Query live-check results from the DB")
    parser.add_argument("--history", type=int, metavar="EXPERIMENT_ID",
                        help="Show full check history for one experiment ID")
    parser.add_argument("--source", metavar="SOURCE",
                        help="Filter snapshot to a source (e.g. stocks, crypto)")
    parser.add_argument("--status", metavar="STATUS", choices=["promoted", "tracking"],
                        help="Filter snapshot to promoted or tracking experiments")
    parser.add_argument("--recent", type=int, metavar="HOURS",
                        help="Show all check rows written in the last N hours")
    parser.add_argument("--divergence", action="store_true",
                        help="Show divergence-strategy forward-validation rows")
    args = parser.parse_args()

    conn = get_conn()
    try:
        if args.history:
            show_history(conn, args.history)
        elif args.recent:
            show_recent_checks(conn, args.recent)
        elif args.divergence:
            show_divergence(conn)
        else:
            show_snapshot(conn, source=args.source, status_filter=args.status)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
