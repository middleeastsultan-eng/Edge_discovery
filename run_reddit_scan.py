"""One global pass over trading subreddits: finds highly-upvoted posts describing a
strategy, has an LLM attempt to translate each into this system's rule language, and
runs anything translatable through the exact same validation suite discovered patterns
go through. Deliberately a single global job (not a per-symbol matrix) since Reddit
search isn't tied to a symbol/interval combo -- extracted strategies get tested across
all four tracked symbols at 1h (one representative, liquid timeframe; v1 doesn't try to
infer a specific symbol/timeframe from ambiguous post text).

Usage:
    python run_reddit_scan.py
"""

from __future__ import annotations

import sys
import traceback
from datetime import datetime, timezone

# Reddit post titles/bodies are arbitrary user text and often contain emoji or other
# characters Windows' default console encoding (cp1252) can't represent -- without this,
# a single such character in a post crashes the whole run on a print statement, after
# the DB write for that post already succeeded (confirmed: this exact crash happened
# during manual verification). GitHub Actions' Linux runners default to UTF-8 already,
# but this makes local Windows runs just as safe.
if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

from trading_lab import db, reddit_scan
from trading_lab.config import DASHBOARD_URL
from trading_lab.explain import describe_rule
from trading_lab.pipeline import is_novel_pass, is_pass, run_reddit_experiment
from trading_lab.telegram import send_message

# (source, symbol, interval, start, end) -- tests every testable strategy against the
# two tracked symbols (QQQ/SPY only -- crypto dropped, see research.yml) at 1h, same
# date ranges used elsewhere in the pipeline.
TARGETS = [
    ("stocks", "SPY", "1Hour", "2020-08-01", "2026-01-01"),
    ("stocks", "QQQ", "1Hour", "2020-08-01", "2026-01-01"),
]


def main():
    print(f"[{datetime.now(timezone.utc).isoformat()}] reddit scan")

    try:
        token = reddit_scan.get_access_token()
        posts = reddit_scan.search_strategies(token)
    except Exception:
        print(f"  error searching Reddit: {traceback.format_exc()}")
        raise

    print(f"  {len(posts)} post(s) found clearing score>={reddit_scan.MIN_SCORE}")

    new_posts = [p for p in posts if not db.reddit_post_seen(p["reddit_post_id"])]
    print(f"  {len(new_posts)} new (not already seen)")

    tested = 0
    passed = 0
    for post in new_posts:
        strategy_id = db.save_reddit_strategy(
            post["reddit_post_id"], post["subreddit"], post["title"], post["body"],
            post["author"], post["score"], post["num_comments"], post["url"],
            datetime.fromtimestamp(post["created_utc"], tz=timezone.utc),
        )
        if strategy_id is None:
            continue  # lost a race with another run inserting the same post

        try:
            extraction = reddit_scan.extract_strategy(post["title"], post["body"])
        except Exception:
            db.update_reddit_strategy_extraction(strategy_id, "error", traceback.format_exc()[:1000])
            print(f"  [{post['subreddit']}] \"{post['title'][:60]}\" -> extraction error")
            continue

        if not extraction["testable"]:
            db.update_reddit_strategy_extraction(strategy_id, "not_testable", extraction["reasoning"])
            print(f"  [{post['subreddit']}] \"{post['title'][:60]}\" -> not testable: {extraction['reasoning']}")
            continue

        db.update_reddit_strategy_extraction(strategy_id, "testable", extraction["reasoning"])
        print(f"  [{post['subreddit']}] \"{post['title'][:60]}\" -> testable, running against {len(TARGETS)} symbols")

        for source, symbol, interval, start, end in TARGETS:
            tested += 1
            try:
                finalist = run_reddit_experiment(
                    extraction["clauses"], symbol, interval, start, end, strategy_id, source=source,
                )
            except Exception:
                print(f"    {symbol} {interval}: error, skipping:\n{traceback.format_exc()}")
                continue

            if finalist is None:
                print(f"    {symbol} {interval}: did not clear the validation bar")
                continue

            score = finalist["robustness_score"]["total"]
            label = finalist["robustness_score"]["label"]
            ok = is_novel_pass(finalist, symbol, interval, source) if is_pass(finalist) else False
            print(f"    {symbol} {interval}: robustness={score} ({label}) notify={ok}")

            if not ok:
                continue
            passed += 1

            description = describe_rule(finalist["rule"], symbol, interval)
            if description:
                db.set_plain_english(finalist["experiment_id"], description)

            link = f"{DASHBOARD_URL}/experiments/{finalist['experiment_id']}" if DASHBOARD_URL else ""
            send_message(
                f"New pattern found via Reddit ({symbol} {interval})\n\n"
                f"Source: r/{post['subreddit']} -- {post['url']}\n"
                f"Rule: {finalist['rule']}\n"
                + (f"In plain English: {description}\n" if description else "")
                + f"Robustness: {score}/100 ({label})\n"
                f"Entering forward tracking against live data -- will only alert again "
                f"if it proves itself in real trading, not just backtest.\n"
                + (f"\n{link}" if link else "")
            )

    print(f"\nDone. {len(new_posts)} new post(s), {tested} symbol-test(s) run, {passed} notified.")


if __name__ == "__main__":
    main()
