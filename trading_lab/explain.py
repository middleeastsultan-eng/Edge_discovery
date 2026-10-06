"""Plain-English translation of a discovered rule, for dashboard/Telegram readability.

Pure translation layer -- never used in any scoring, filtering, or pattern-selection
logic. The only thing deciding whether a pattern is good is the deterministic math in
validate.py/live.py; this module exists purely so a human (trader or not) can read what
a rule means without parsing feature names and thresholds. If the API call fails for any
reason (no credits, network, bad key), callers get None and move on -- a readability
nicety must never break research or alerting.
"""

from __future__ import annotations

from openai import OpenAI

from .config import OPENROUTER_API_KEY

_MODEL = "openai/gpt-4o-mini"

_FEATURE_GLOSSARY = """
- price_vs_ema200: price's distance from its 200-period trend average (positive = above/uptrend, negative = below/downtrend)
- rsi_14: 14-period RSI, a 0-100 momentum gauge (below ~30 = oversold, above ~70 = overbought)
- volatility_pctile: how volatile recent price action is, as a percentile versus the last 500 bars (1.0 = most volatile in that window)
- volume_ratio_20: current bar's volume relative to its 20-bar average (above 1 = busier than usual, below 1 = quieter)
- return_5: price return over the last 5 bars
- return_20: price return over the last 20 bars
- hour: hour of day, New York time
- bos_divergence_bullish: this symbol (QQQ or SPY) recently broke above a recent swing high while its counterpart index did NOT -- a cross-asset divergence
- bos_divergence_bearish: same, but for breaking below a recent swing low
""".strip()


def describe_rule(rule: str, symbol: str, interval: str) -> str | None:
    """One plain-English sentence describing the market condition a rule looks for.
    Deliberately avoids "day"/"week" language -- a "period" is however long `interval`
    actually is (could be 15 minutes, 1 hour, 1 day, etc.), and the prompt is told that
    explicitly rather than left to guess from feature names alone.
    """
    if not OPENROUTER_API_KEY:
        return None
    try:
        client = OpenAI(api_key=OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")
        resp = client.chat.completions.create(
            model=_MODEL,
            messages=[{
                "role": "user",
                "content": (
                    f"Translate this trading rule into ONE plain-English sentence a trader "
                    f"would understand, describing the market condition it looks for. Each bar "
                    f"is one {interval} period on {symbol} -- say \"period\" or \"bar\", never "
                    f"\"day\", unless the interval actually is daily. Do not editorialize about "
                    f"whether it's a good trade, just describe the setup in natural trading "
                    f"language (e.g. \"oversold\", \"above its trend average\", \"quiet volume\").\n\n"
                    f"Rule: {rule}\n\n"
                    f"Feature glossary:\n{_FEATURE_GLOSSARY}"
                ),
            }],
            max_tokens=120,
            temperature=0.3,
        )
        text = resp.choices[0].message.content
        return text.strip() if text else None
    except Exception:
        return None
