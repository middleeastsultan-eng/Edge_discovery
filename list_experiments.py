"""List saved experiments from the database."""

import argparse

from trading_lab import db

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=20)
    args = parser.parse_args()

    df = db.list_experiments(args.limit)
    if df.empty:
        print("No experiments saved yet.")
    else:
        with __import__("pandas").option_context("display.max_colwidth", 60):
            print(df.to_string(index=False))
