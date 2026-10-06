"""End-to-end regression test for trading_lab/pipeline.py's run_experiment, run
against synthetic data (via monkeypatching the data-fetch function) instead of a
real network call, so it's fast and deterministic while still exercising pipeline.py's
REAL code path -- unlike a test that calls validate.walk_forward() directly, this
would catch a regression where pipeline.py goes back to passing the full
discovery+val+test range into walk_forward instead of just val+test.

search() and evaluate_candidate() are stubbed to deterministically produce one
"finalist" candidate -- this isolates the test to the walk_forward WIRING specifically,
independent of whether random search happens to discover a real edge in synthetic
noise (which it usually won't, and shouldn't be expected to).
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from trading_lab import pipeline
from trading_lab.discovery import Clause
from trading_lab.metrics import TradeStats
from trading_lab.validate import chronological_split


def _synthetic_raw(n: int = 6000) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    idx = pd.date_range("2020-01-01", periods=n, freq="1h", tz="UTC")
    close = 100 + np.cumsum(rng.normal(0, 0.3, n))
    high = close + rng.uniform(0, 1, n)
    low = close - rng.uniform(0, 1, n)
    volume = rng.uniform(100, 1000, n)
    return pd.DataFrame({"open": close, "high": high, "low": low, "close": close, "volume": volume}, index=idx)


_FAKE_STATS_DICT = {
    "n_trades": 50, "win_rate": 0.6, "expectancy_r": 0.3, "profit_factor": 1.5,
    "sharpe": 1.0, "max_drawdown_r": 2.0, "avg_win_r": 1.0, "avg_loss_r": -0.5,
}


def _fake_search(discovery_df, n_candidates, min_trades, backtest_config, seed):
    clauses = [Clause(feature="volume_ratio_20", op=">", value=0.1)]  # true most of the time -- plenty of trades
    row = {"rule": "volume_ratio_20 > 0.1", "clauses": clauses, "score": 1.0, "information": {}, **_FAKE_STATS_DICT}
    counts = {"level1_survivors": 1, "statistically_interesting": 1, "research_worthy": 1}
    return pd.DataFrame([row]), counts


def _fake_evaluate_candidate(df, candidate, config):
    stats = TradeStats(**_FAKE_STATS_DICT)
    trades = pd.DataFrame({"r_multiple": [0.3] * 50})
    return stats, trades


def test_run_experiment_walk_forward_never_covers_the_discovery_range(monkeypatch):
    raw = _synthetic_raw()
    monkeypatch.setattr(pipeline, "get_candles", lambda symbol, interval, start, end: raw)
    monkeypatch.setattr(pipeline, "search", _fake_search)
    monkeypatch.setattr(pipeline, "evaluate_candidate", _fake_evaluate_candidate)

    result = pipeline.run_experiment(
        "SYNTH", "1h", "2020-01-01", "2020-12-31",
        n_candidates=10, discovery_min_trades=1, validation_min_trades=1, test_min_trades=1,
        funnel_top_k=10, max_finalists=3, seed=0, save=False,
    )

    assert len(result["finalists"]) == 1, "the stubbed search()/evaluate_candidate() should produce exactly one finalist"

    feats = pipeline.build_features(raw)
    discovery_df, _, _ = chronological_split(feats)
    discovery_end = discovery_df.index[-1]

    wf = result["finalists"][0]["walk_forward"]
    assert len(wf) > 0
    for _, row in wf.iterrows():
        assert row["start"] > discovery_end, (
            f"a walk-forward window started at {row['start']}, inside the discovery "
            f"range (ends {discovery_end}) -- walk_forward is leaking in-sample data"
        )
