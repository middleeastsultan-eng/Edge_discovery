"""Watches a handful of trading subreddits for highly-upvoted posts that describe a
mechanical strategy, and attempts to translate each one into this system's rule
language (see discovery.py's Candidate/Clause and the FEATURES list).

Honesty over coverage, by design: most real strategies traders describe reference
indicators that don't exist here yet (MACD, Bollinger Bands, moving-average crossovers,
multi-bar logic). extract_strategy() is instructed to say so plainly rather than force
an approximate mapping -- testing a mangled version of someone's idea and presenting the
result as if it reflects their actual strategy would be worse than not testing it at all.
"""

from __future__ import annotations

import html
import json

import requests
from openai import OpenAI

from .config import OPENROUTER_API_KEY, REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET
from .discovery import FEATURES

USER_AGENT = "EdgeDiscovery/1.0 (research tool; reads public posts only)"

SUBREDDITS = ["algotrading", "Daytrading", "thewallstreet", "options", "StockMarket"]
KEYWORDS = ["strategy", "backtest", "edge", "setup", "indicator"]
MIN_SCORE = 50

_EXPLAIN_MODEL = "openai/gpt-4o-mini"

_FEATURE_GLOSSARY = """
- price_vs_ema200: price's distance from its 200-period trend average (positive = above/uptrend, negative = below/downtrend)
- rsi_14: 14-period RSI, a 0-100 momentum gauge (below ~30 = oversold, above ~70 = overbought)
- volatility_pctile: how volatile recent price action is, as a percentile versus the last 500 bars
- volume_ratio_20: current bar's volume relative to its 20-bar average
- return_5: price return over the last 5 bars
- return_20: price return over the last 20 bars
- hour: hour of day, New York time
""".strip()


def get_access_token() -> str:
    """Reddit's client_credentials OAuth flow -- read-only access to public search/
    listing endpoints, no username/password needed since this only ever reads posts.
    """
    resp = requests.post(
        "https://www.reddit.com/api/v1/access_token",
        auth=(REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET),
        data={"grant_type": "client_credentials"},
        headers={"User-Agent": USER_AGENT},
        timeout=15,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


def search_strategies(token: str) -> list[dict]:
    """Searches every subreddit x keyword combo, keeps text posts (need real strategy
    prose, not a link/image) clearing MIN_SCORE, and dedupes across overlapping keyword
    matches (the same post often matches more than one keyword).
    """
    headers = {"Authorization": f"Bearer {token}", "User-Agent": USER_AGENT}
    seen: dict[str, dict] = {}

    for subreddit in SUBREDDITS:
        for keyword in KEYWORDS:
            resp = requests.get(
                f"https://oauth.reddit.com/r/{subreddit}/search",
                params={"q": keyword, "restrict_sr": 1, "sort": "top", "t": "month", "limit": 25},
                headers=headers,
                timeout=15,
            )
            if not resp.ok:
                continue
            for child in resp.json().get("data", {}).get("children", []):
                p = child["data"]
                if p["score"] < MIN_SCORE or not p.get("selftext"):
                    continue
                post_id = p["name"]  # Reddit's fullname, e.g. "t3_abc123" -- globally unique
                if post_id in seen:
                    continue
                seen[post_id] = {
                    "reddit_post_id": post_id,
                    "subreddit": subreddit,
                    "title": html.unescape(p["title"]),
                    "body": html.unescape(p["selftext"]),
                    "author": p.get("author"),
                    "score": int(p["score"]),
                    "num_comments": int(p["num_comments"]),
                    "url": f"https://reddit.com{p['permalink']}",
                    "created_utc": p["created_utc"],
                }

    return list(seen.values())


def extract_strategy(title: str, body: str) -> dict:
    """Asks an LLM whether a post describes a mechanical strategy expressible as
    AND-combined threshold conditions on ONLY the features this system actually has,
    and if so, what those conditions are. Returns a dict always containing "testable"
    (bool), "reasoning" (str), and "clauses" (list, empty if not testable).

    Fails closed: any error (bad JSON, API failure, unparseable response) returns
    testable=False with the error as the reason -- never raises, never fabricates.
    """
    if not OPENROUTER_API_KEY:
        return {"testable": False, "reasoning": "OPENROUTER_API_KEY not configured", "clauses": []}

    try:
        client = OpenAI(api_key=OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")
        resp = client.chat.completions.create(
            model=_EXPLAIN_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    f"A trader posted this on Reddit. Determine whether it describes a "
                    f"concrete, mechanical trading strategy that can be expressed ENTIRELY "
                    f"as AND-combined threshold conditions using ONLY the features listed "
                    f"below. Be conservative: if the strategy relies on an indicator, "
                    f"pattern, or concept not in this list (e.g. MACD, Bollinger Bands, "
                    f"moving-average crossovers, support/resistance, candlestick patterns, "
                    f"multi-timeframe logic), or if it's too vague to pin down specific "
                    f"thresholds, mark it NOT testable rather than approximating it -- "
                    f"testing a mangled version of someone's strategy is worse than not "
                    f"testing it.\n\n"
                    f"Available features:\n{_FEATURE_GLOSSARY}\n\n"
                    f"Title: {title}\n\nBody: {body}\n\n"
                    f'Respond with ONLY a JSON object: '
                    f'{{"testable": true|false, "reasoning": "one sentence either way", '
                    f'"clauses": [{{"feature": "...", "op": ">"|"<", "value": <number>}}, ...]}} '
                    f"(empty clauses list if not testable)."
                ),
            }],
            max_tokens=400,
            temperature=0.2,
            response_format={"type": "json_object"},
        )
        content = resp.choices[0].message.content
        if not content:
            return {"testable": False, "reasoning": "empty LLM response", "clauses": []}
        parsed = json.loads(content)
    except Exception as e:
        return {"testable": False, "reasoning": f"extraction error: {e}", "clauses": []}

    if not parsed.get("testable"):
        return {"testable": False, "reasoning": parsed.get("reasoning", "not testable"), "clauses": []}

    # Deterministic guard: reject any clause naming a feature that doesn't actually
    # exist, regardless of what the LLM claimed -- a second check against ground truth,
    # not just trusting the model's own judgment of what's in the glossary.
    clauses = parsed.get("clauses", [])
    valid_clauses = [
        c for c in clauses
        if c.get("feature") in FEATURES and c.get("op") in (">", "<") and isinstance(c.get("value"), (int, float))
    ]
    if not valid_clauses or len(valid_clauses) != len(clauses):
        return {
            "testable": False,
            "reasoning": f"LLM claimed testable but produced invalid/unknown-feature clauses: {clauses}",
            "clauses": [],
        }

    return {"testable": True, "reasoning": parsed.get("reasoning", ""), "clauses": valid_clauses}
