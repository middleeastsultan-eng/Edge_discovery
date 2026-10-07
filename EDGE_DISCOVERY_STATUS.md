# Edge Discovery — Status & Next Steps

Written for discussion with another AI/advisor. Summarizes what exists, what the
numbers actually say, and the open question we're trying to think through next.
Nothing described as "built" here is being removed or paused — the question is
what to add alongside it.

## What we've built

A research pipeline (Python, `trading_lab/`) plus a Next.js dashboard
(`web/`), backed by Supabase/Postgres. Pieces:

- **`discovery.py`** — random search over feature/threshold combinations.
  Samples 2–3 "AND"-ed clauses (e.g. `volatility_pctile > 0.69 AND
  price_vs_ema200 < -0.016`) from a fixed set of 9 features: `price_vs_ema200`,
  `rsi_14`, `volatility_pctile`, `volume_ratio_20`, `return_5`, `return_20`,
  `hour`, and two cross-asset structure-divergence flags
  (`bos_divergence_bullish/bearish`, from `cross_asset.py`). Each candidate
  must clear an information gate (Mann-Whitney U vs. baseline, Benjamini-Hochberg
  FDR-corrected across the whole batch) and an economic gate (edge bigger than
  estimated round-trip cost) before it's even backtested.
- **`backtest.py`** — the actual strategy sim: fixed 1:2 ATR stop/target,
  long-only, fee + slippage costs.
- **`validate.py` / `pipeline.py`** — the rigor layer. Chronological
  discovery → validation → test split (test set never touched during search),
  finalists selected by *validation*-set score (not test, to avoid
  cherry-picking), walk-forward windows, 2x/3x cost stress, parameter-
  perturbation checks (is it fragile/noise-fit), bootstrap confidence bounds.
  Produces a 0–100 `robustness_score` with bands: **Strong ≥80, Promising ≥65,
  Weak ≥45, Reject <45**.
- **`live.py` + `run_live_check.py`** — forward/paper-trading verification,
  already fully wired: any experiment that scores **Strong (≥80)** automatically
  enters forward tracking, re-evaluates its *frozen* rule against fresh real
  bars, logs simulated trades, and re-decides promotion on every check (so a
  pattern that decays loses "promoted" status automatically, not just once).
  Needs ≥20 forward trades and a positive bootstrap lower-bound before
  promoting; sends Telegram alerts once promoted.
- **`paper_portfolio.py` + `run_paper_portfolio.py`** — a shared simulated
  account that allocates real position sizing (1% risk/trade, 10% max
  concurrent risk) across every *promoted* pattern's forward trades, so
  correlated patterns firing together show up as one combined bet, not
  independent wins.
- **`run_divergence_check.py`** — standalone QQQ/SPY structure-divergence
  alerting (Telegram), separate from the scored pipeline above — currently a
  live heads-up, not yet backtested as its own standalone hypothesis.
- **Dashboard (`web/`)** — Experiments list, Research Health, Live Signals,
  and a real-time Live Chart (QQQ/SPY overlay with divergence bands).

**The forward-tracking and paper-portfolio machinery is fully built and has
never fired** — not because it's missing, but because nothing has ever scored
≥80 to unlock it.

## Results so far (pulled live from the DB)

- 2,000 research runs → **5.87M hypotheses tested** → 86,508 cleared the
  discovery backtest gate → 21,894 reached the top-K funnel → 4,746 survived
  out-of-sample validation → 1,931 finalists → **730 got a full validation
  write-up** (most finalists die on the test-set min-trade gate before being
  saved).
- Of those 730: **504 Reject, 183 Weak, 43 Promising, 0 Strong.**
- Best candidate ever: QQQ 1Hour, `volatility_pctile > 0.69 AND
  price_vs_ema200 < -0.016 AND return_5 < 0.007`, score **78.7** — just under
  the 80.0 cutoff to enter forward tracking. It fails specifically on 2x/3x
  cost stress, not on raw profitability.
- `forward_validation` table: **empty**. Nothing has ever been paper-traded
  automatically, because nothing has cleared 80.

**Why things fail** (red flags across the 730 saved experiments):
1. Test-set expectancy not positive — 563 (77%)
2. Not profitable even at base transaction costs — 563 (same cohort)
3. Breaks down under small parameter perturbations (noise-fit signature) — 443 (61%)
4. Fewer than half of walk-forward windows profitable — 270 (37%)
5. Test expectancy < half of discovery expectancy (overfitting tell) — 237 (32%)
6. Survives base costs but fails 2x/3x cost stress specifically — 167

## What we think this means

The validation engine itself looks sound, not broken — it's chronologically
honest, FDR-corrected, adversarial to itself (a leak was found and explicitly
fixed in `pipeline.py`), and it's *supposed* to be hard to pass. The 0 "Strong"
results read as "the gate is appropriately skeptical," not "the gate is
miscalibrated."

The actual limiting factor looks like **candidate generation**, not
validation: a random search over 7 scalar indicators + 2 divergence flags,
long-only, fixed stop/target, on two of the most heavily-arbitraged,
TA-mined instruments that exist (QQQ/SPY hourly). 7 of the top 10 scored
rules found so far are near-duplicates of "high volatility + afternoon hour."
That reads as the search circling one small pocket of a narrow, already-picked-
over space — not proof there's no edge to find.

Separately, we talked through the "if we brute-force long enough, won't we
eventually find something" question: no — more random draws from the same
small, fixed feature set over the same price history increases the odds of a
statistically-lucky false positive (multiple-testing problem) without adding
real information. The FDR-corrected gate exists specifically to catch this.
Raising the ceiling requires genuinely new, independent information sources,
not more combinations of the same 9 features.

## What prompted this: the structure-divergence idea

The live dashboard already detects and alerts on QQQ/SPY structure
divergence (one index breaks a swing high/low, the other doesn't confirm it)
on the theory that this tends to precede a directional run. This is a
theory-driven hypothesis (lead-lag between correlated, highly liquid indices
is a documented phenomenon), not blind data-mining — which makes it a
different, arguably better-justified kind of candidate than a random
threshold combo. It's already a *feature* inside the random search
(`bos_divergence_bullish/bearish`), but has never been isolated and tested on
its own as "divergence fires → what happens next, statistically, with
nothing else required." The dashboard's own copy currently says as much:
*"not yet a tested, scored pattern, just a live heads-up."*

## Open question / what we want to build next

Not trying to replace anything above — trying to figure out what to add.
Candidates discussed so far, roughly in order of how cheap/fast they'd be to
try against what already exists:

1. **Backtest structure-divergence as its own standalone hypothesis** through
   the existing `validate.py`/`pipeline.py` machinery (not buried inside a
   random 2-3-clause combo) — cheapest way to find out if the intuition is
   real before investing further.
2. **Widen candidate generation**: add short-side signals (currently
   long-only, which halves the addressable edge space outright), make
   stop/target searchable instead of fixed 1:2 ATR (several near-misses fail
   *only* cost-stress), and/or widen the feature set beyond 9 scalars
   (multi-timeframe, order flow/sentiment via the existing
   `reddit_scan.py`, regime-conditioning).
3. **Let near-misses (70–80 score) into a lighter forward-tracking tier**
   instead of a hard 80.0 wall, so a candidate like the 78.7 one actually
   gets a real-world test instead of being silently discarded.
4. **Pivot part of the search toward less-arbitraged ground**: cross-sectional
   ranking across more tickers, less liquid/less TA-mined instruments, or
   genuinely new data sources rather than more combinations of the same
   price-derived indicators on QQQ/SPY.

Looking for a second opinion on sequencing/priority among these, and whether
there's a category of approach missing entirely from this list.
