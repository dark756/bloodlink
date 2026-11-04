# Model cards: the stock-out forecast

One card per model version, newest first, after Mitchell et al. (2019), as `docs/PLANS/ML_system.md` (A5) asks. Each card gives the data, the metrics by group, the known weak spots and the version's status. The artifact is in `ml/models/<id>.json` with its SHA-256 in `<id>.sha256`, and `ml/train.py` rebuilds it byte for byte from the same archive, `--until` and `--threshold`.

## `stockout-logit-t2-2026-11-04`

**Status: the model for the closed beta, to be published live** (`node scripts/setup-forecast.mjs --publish ml/models/stockout-logit-t2-2026-11-04.json --live`). Logistic regression was adopted on 4 November, after every check so far picked it (`../rough_work/ML-comparison/SUMMARY.md`). A later, independent comparison on more history can replace it through `model_versions`.

| | |
|---|---|
| **Question** | Will a bank's packed red cells of one blood group fall to **2 units or fewer** within 24, 48 or 72 hours, given more than 2 now? 48 h is the decision horizon. |
| **Model** | Logistic regression, one per horizon. Every row is used, unweighted. Inputs are standardized, with an L2 penalty, C = 1 (scikit-learn 1.9.1, lbfgs, 26 to 29 iterations). |
| **Inputs** | The 19 core inputs, built by `ml/dataset.py` and `src/lib/stockoutFeatures.js` alike: <ul><li>units, the bank's red cells, groups stocked and the group's share;</li><li>drops to zero, decreases and increases per day seen over 7 days, with days of supply and the bank's use;</li><li>the change over 24 h and 72 h;</li><li>updates in 24 h and per day, and hours since the last update;</li><li>auto-refresh, ownership, state, blood group and Rh negative.</li></ul>Counts and rates enter as log(1 + x), changes as signed logs, and categories as dummies: 63 terms per horizon. |
| **Training data** | bloodLink's own eRaktKosh history, 23 October to 4 November 2026: the laptop's hourly sweeps, then the cloud's 4.5-hourly ones. The data is cut at the last complete sweep, 2026-11-04 04:41 UTC. It holds 672,309 cases (bank × group × grid time, with more than 2 units) at 3,576 banks and 46 grid times. The models were fitted on every case whose outcome is known: 613,057 at 24 h, 554,242 at 48 h and 495,942 at 72 h. |
| **Labels** | The event is the group's units falling to 2 or fewer. Otherwise report 3's rules apply: <ul><li>a fall that was a cleared page is left out;</li><li>quick refills count;</li><li>dormant banks are left out.</li></ul>Collection gaps aren't censored (the plan's S14). |
| **Calibration and cut-off** | Each horizon starts with Platt parameters (a, b) and an alert cut-off, fitted on the latest complete test day, out of sample: <ul><li>24 h: (0.927, −0.254), P above 0.238;</li><li>48 h: (0.923, −0.351), P above 0.327;</li><li>72 h: (0.970, −0.299), P above 0.420.</li></ul>In the app, the daily job replaces them. |

**Backtest.** Each India day is scored by a model trained only on grid times whose outcome was known before that day, with an expanding window and a purge of one horizon. "Carried" means the app's daily routine: Platt scaling and the cut-off are set on the day H/24 + 1 days back and used unchanged on the test day.

| | 24 h | 48 h | 72 h |
|---|---|---|---|
| Test days | 28 Oct to 3 Nov (7) | 29 Oct to 2 Nov (5) | 30 Oct to 1 Nov (3) |
| Cases, rate of falling to 2 | 376,055, 4.4% | 259,520, 7.7% | 144,081, 10.4% |
| PR-AUC | **0.247** | **0.348** | **0.409** |
| PR-AUC by day | 0.203 to 0.272 | 0.325 to 0.376 | 0.400 to 0.424 |
| Best baseline (rate at that many units) | 0.146, beaten by 69% | 0.232, beaten by 50% | 0.294, beaten by 39% |
| Caught at 1 false alert per bank per week | 22.2% | 22.6% | 23.0% |
| Caught at 2 false alerts | 37.5% | 38.8% | 39.3% |
| Mean prediction ÷ observed rate, raw | 1.10 | 1.15 | 1.18 |
| Carried: days | 5 | 2 | none yet |
| Carried: calibration ratio after Platt | 1.04 | 1.07 | — |
| Carried: false alerts per bank per week, caught | 1.05, 22.8% | 0.96, 23.0% | — |

Predicting stock-outs (threshold 0) on the same data scored PR-AUC 0.251 at 48 h and caught 15.2% within the alert budget. The threshold comparison is in the plan's A1.

**Lift by group at 48 h** (PR-AUC ÷ the group's rate of falling to 2; 1 is chance):

| | O+ | B+ | A+ | AB+ | O− | B− | A− | AB− |
|---|---|---|---|---|---|---|---|---|
| Rate | 4.1% | 4.9% | 6.4% | 8.7% | 14.0% | 12.8% | 15.2% | 19.2% |
| Lift | 7.6 | 7.6 | 5.9 | 3.6 | 2.5 | 2.6 | 2.6 | 1.7 |

**What it leans on, at 48 h** (log-odds per standard deviation):
- units −2.48, by far the largest: the fewer units above 2, the higher the risk;
- refills per day +0.48: banks that restock often turn stock over fast;
- days of supply −0.25, and groups stocked −0.19;
- updates per day +0.15, and the 24 h change +0.13;
- of the categories, state spreads most (−4.3 to +2.4), widest where a state has few banks;
- ownership runs from Red Cross +0.15 to "other" −0.12;
- blood group moves the log-odds by at most 0.14, since units already carry it.

**Weak spots and limits**
- **The Rh− groups:** their lift is 1.7 to 2.6, against 3.6 to 7.6 for Rh+. Most banks hold 1 to 3 units of them, so many aren't forecast at all; search marks those "low now".
- **Banks at 2 units or fewer aren't forecast:** 28% of the cases with stock.
- **Over-prediction:** 15% too many falls at 48 h before calibration. The carried Platt scaling brought it to 1.07, on 2 days.
- **Little history:** 12.6 days, 3 to 7 test days per horizon, no weekly cycle seen twice, and no festival yet (Diwali is on 8 November). The inputs were chosen on these same days, and the threshold was chosen on them too.
- **Self-reported stock:** decreases mix issues with corrections and expiry.
- **Never for patient care.** It decides where to ask for donors and which bank to call first, never what a patient receives. Every mark says it is a forecast and to call the bank.

**Rebuild:** run this from `bloodlink/`, with `ml/requirements.txt` installed:

```
python -I ml/train.py ../blood_data/eraktkosh --until 2026-11-04T04:41:28.760Z --threshold 2
```

It writes the artifact, its `.sha256` and `tests/fixtures/stockout_week.json` in under a minute. The SHA-256 is `d6a480eae72760bd86e110d6cb9ce357b1cc1b4471925e28f88dcc6c1b5b298a`.

**Reference:** Mitchell, M. et al. (2019). Model cards for model reporting. *FAT\* '19*, 220–229. [arXiv:1810.03993](https://arxiv.org/abs/1810.03993).
