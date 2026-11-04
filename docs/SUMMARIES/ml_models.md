# Summary: the stock-out forecast (AI/ML)

*As of 4 November 2026. The plan, decision rule and dates follow the summary, in [report 3's record](#report-3s-record) of point 5. The scripts and the latest results are in `../rough_work/ML/` (`SUMMARY.md`), outside git. Its place in the work queue is [`../plans.md`](../plans.md), item 4.*

**What was asked** (reviewer point 5): where AI/ML fits into bloodLink's core problem, which decision it improves, and what its input data, output and use by the matching engine would be. The reviewer offered blood-demand forecasting and donor-availability prediction as examples.

**The answer in brief.** ML predicts **stock-outs**: the chance that one bank's stock of one blood group of one component runs out within the next 24, 48 or 72 hours. That chance does two things:
- it lowers a bank's ranking score;
- it starts donor alerts before the bank runs short.

Seven models are shortlisted against five baselines. A walk-forward dry run on 10.8 days of bloodLink's own history gives an interim choice: **logistic regression, with the GBM classifier as the challenger.** It decides nothing. The backtest at about 8 weeks of history, in late December 2026, decides, with a rule fixed in advance.

| Status | |
|---|---|
| **Done** | The problem defined; inputs, outputs and use designed; seven models chosen; three early checks |
| **In progress** | History accumulating every 4.5 hours, around the clock, since 3 November |
| **Planned** | Labels and features (November); the backtest (late December); shadow mode in the app (January 2027) |

---

## What it predicts, and how the app uses it

- **The decision it improves:** whom to ask to donate, where and when. Today bloodLink can only react after stock has run out.
- **The unit:** one bank × one component × one group, for example "KEM Hospital, packed red cells, O−".
- **Output 1:** the probability of a stock-out within 24, 48 and 72 hours. Later, the same for falling under 2 days of supply.
- **Output 2:** the expected units 24 and 48 hours ahead, with a 10th to 90th percentile range.
- **In ranking:** a bank's coverage and surplus scores are multiplied by (1 − P), where P is its 24-hour chance of running out. A bank is marked "may run out soon" above a cut-off. The change must pass the ranking's sensitivity check first.
- **In donor alerts, the main use:** when the 48-hour chance passes a cut-off, eligible donors of that group near the bank are asked to give. The cut-off keeps false alerts under 1 per bank per week, and only enough donors are asked to cover the expected shortfall.
- **Safety:** the forecast only decides whom to ask to donate, never what a patient receives.

**Inputs:**
- the stock history bloodLink collects (since 23 October 2026);
- bank attributes;
- how fresh each value is;
- the calendar.

Donation camps were checked and add nothing to red-cell stock. True demand (units issued) would help most, but eRaktKosh keeps it behind a login.

## The models

| # | Model | Why it is on the list |
|---|---|---|
| 1 | Gradient-boosted trees, classifier | One model for all banks, as in the M5 forecasting competition |
| 2 | Logistic regression | The transparent benchmark; wins a tie |
| 3 | Discrete-time hazard model | One consistent answer for all three horizons |
| 4 | Gradient-boosted trees, quantile regression | The only global model that also gives output 2 |
| 5 | ETS (Holt-Winters), weekly season | The classical benchmark |
| 6 | Seasonal ARIMA (1,0,1)(0,1,1,7) | The ARIMA of report 1's slides, with the weekly term the data calls for |
| 7 | TSB | Made for series with many zeros, such as rare groups |

- **Five baselines** that every model must beat:
  - the last value carried forward;
  - the same time last week;
  - the weekday average;
  - days of supply under 2;
  - the stock-out rate at banks holding that many units.
- **Deferred:** LSTM, DeepAR, the Temporal Fusion Transformer and N-BEATS need 6 to 12 months of history. In the rehearsal LSTM trailed the trees, and its probabilities were worse than a constant guess. Prophet was dropped.

## Results so far, which decide nothing

**The walk-forward dry run, 4 November.** The history covers 23 October to 3 November: 879,673 cases at 3,638 banks. Each test day is scored only by models trained on what was known before it. At 48 hours there are 304,124 test cases, 17,520 of them stock-outs (5.8%).

| Model | PR-AUC at 48 h (90% interval) | Stock-outs caught at 1 false alert per bank per week | That cut-off set a day ahead: caught, false alerts |
|---|---|---|---|
| GBM classifier | **0.269** (0.253 to 0.286) | 15.3% | 14.5%, 1.09 |
| Hazard model, trees | 0.262 | 14.4% | 10.2%, 0.67 |
| Hazard model, logistic | 0.256 | 15.6% | 13.6%, 0.89 |
| **Logistic regression** | 0.255 (0.240 to 0.272) | **15.8%** | **15.1%, 0.98** |
| GBM quantiles | 0.237 | 14.1% | 14.0%, 1.00 |
| ETS, on 6-hour values | 0.153 | 0% | 13.0%, 1.58 |
| SARIMA, on 6-hour values | 0.150 | 4.3% | 4.2%, 0.94 |
| TSB | 0.120 | 7.0% | 6.3%, 0.79 |
| Best baseline: the rate at that many units | 0.183 | 9.8% | 6.9%, 0.65 |

**Why logistic regression is the interim choice:**
1. **The decision rule picks it.** No model reaches precision 0.5 with useful recall, so the rule falls back to PR-AUC. There the GBM classifier's lead, 1.4 points, is inside the rule's 2-point margin, so the simpler model wins.
2. **It is level on donor alerts.** It catches the most stock-outs within the false-alert limit, and its cut-off, set a day ahead, held at 0.98 false alerts per bank per week.
3. **It is the simplest to build and explain,** at 39% above the best baseline.
4. **One condition:** it predicts 25% more stock-outs than happen, so its probabilities are recalibrated before they feed ranking.

**Why the GBM classifier stays as the challenger:**
- it ranks stock-outs best on every test day;
- its probabilities are the best calibrated;
- with the recommended inputs its lead is exactly 2.0 points, so December could decide for it.

**What decided the inputs:**
- past drops to zero matter most, and history as a whole is worth 5.5 to 8.6 points of PR-AUC;
- weekday, whole blood, the hour and camps add nothing.

**The weak spot:** Rh− groups. The lift over each group's base rate is 2.2 to 3.1 for Rh− groups, against 4.6 to 11.5 for Rh+.

**Earlier checks, 26 October:**
- **A rehearsal on 20 years of Malaysian donations:** 192 events are too few to separate the top five models, and the rule's dry run picked logistic regression.
- **A pipeline test** on bloodLink's history: it worked end to end.

## The decision rule, fixed before the backtest

- **Horizon:** judge on a stock-out within 48 hours, the donor-alert horizon.
- **First test:** pick the best recall at precision 0.5, with at least 24 hours of median warning.
- **Fallback:** if no model reaches precision 0.5 with at least 10% recall, pick by PR-AUC.
- **Simplicity:** prefer the simpler model when the difference is under 2 points, or the leader wins in fewer than 80% of resamples.
- **Baseline:** every model must beat the best baseline by at least 10%.

**Two changes are waiting for the team's decision,** before December's test weeks are collected:
1. **add recall at 1 false alert per bank per week** as the rule's first test;
2. **report each group's PR-AUC with its lift.**

## Limits of the results so far

- **Two to six test days,** so the scores move more between days than the intervals show.
- **The inputs were chosen on the same days** the models were compared on. December's unseen weeks are the honest test.
- **No weekly or festival cycle yet.** Diwali, on 8 November, is the first festival in the history.
- **ETS and SARIMA ran in a stand-in form,** on 6-hour values, until two weeks of daily values exist.
- **Stock is self-reported,** and unit decreases mix use with corrections and expiry.

## What is left

| Phase | When | Work |
|---|---|---|
| 5.1 · Labels and features | November 2026 | One script that rebuilds the dataset from the raw history; the label rules unit-tested |
| 5.2 · Dry runs | Every 2 weeks from mid-November | The harness re-run on the growing history; ETS and SARIMA on daily values once possible |
| 5.3 · The backtest | Late December 2026, at about 8 weeks of history | Run once; the decision rule applied as written; a table per metric for the panel |
| 5.4 · Shadow mode | January 2027 | The chosen model scores every series at each 6-hourly grid time. Ranked search reads it behind a flag. Donor alerts are logged, not sent, for 2 weeks |
| 5.5 · Later | 2027 | Monthly retraining; output 1b; the deferred models |

**How it reaches the app:** [`../PLANS/ML_system.md`](../PLANS/ML_system.md) plans the deployment (scoring, daily calibration, a kill switch) and the donor suggestions. Suggestions go to active people nearby who are eligible to donate that day, ranked by the donor network's score. A trained donor-response model was left out (the plan's S7): at the pilot's size, most appeals have fewer people who pass the rules than one wave asks, so the order rarely matters. Admins can also raise a stock-out event by hand: a drill for test accounts, or a manual appeal a partner centre approves. Its phase 0 began on 4 November: the 19 inputs and the label rules are in `src/lib/stockoutFeatures.js`, and scoring, daily Platt calibration, the alert cut-off and the kill switch in `src/lib/stockoutModel.js`, whose Platt fit and PR-AUC match scikit-learn's. The Python dataset builder must match the JS inputs before any model is deployed.

**Not touched:** blood-demand forecasting. It needs eRaktKosh's monthly issue reports, which require a login.

---

## Report 3's record

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Point 5: which ML approaches to compare

> *Request:* based on the data collected in point 3, suggest which ML models, approaches and strategies could work best. We are to compare two or three, or more, and present the findings before going ahead with the best one.

This also answers the reviewer's point 5: where AI/ML fits in BloodLink, what decision it improves, what goes in, what comes out, and how the matching and response engine uses it.

The shortlist, two low-fidelity checks and the subplan were added on 2026-10-26, and a walk-forward dry run of all seven models, with an interim choice, on 3 and 4 November. The scripts are in `../rough_work/ML/`, outside git, with a README and a summary, `SUMMARY.md`.

> **Note, 4 November 2026: model R was dropped.** The donor-response model R below (the candidates table, "Who" under "How the prediction feeds the engine", and phase 5.5) is no longer planned. Donors are ranked by the donor network's score, from each person's own record of answering and turning up. At the pilot's size, most appeals have fewer people who pass the rules than one wave asks, so a trained ranking would change little. See [`../PLANS/ML_system.md`](../PLANS/ML_system.md), decision S7.

#### The problem, stated precisely

Report 2 set the use case: *"ML stock-out forecasting: periodic stock snapshots per bank, component and blood group, giving the probability of a stock-out in the next 24–72 hours, used to lower that bank's score."*

- **The decision it improves:** *whom to ask to donate, where, and when.* Today bloodLink reacts after stock has run out. The forecast lets it ask donors of the right group to give at a particular bank before that bank runs short, and lets ranked search prefer banks that are not about to run out.
- **Unit of prediction:** one bank × one component × one blood group, for example "KEM Hospital, packed red cells, O-".
- **Output 1, report 2's:** the probability that this stock runs out (reaches zero) within the next H hours, with H = 24, 48 and 72.
- **Output 1b, an earlier warning, later:** the same probability for falling below its threshold (defined below). It needs each bank's typical daily use, which only the history can give.
- **Output 2, for planning:** the expected units at t + 24 h and t + 48 h, with a range (10th and 90th percentiles).
- **What "below threshold" means.** The first snapshot shows a fixed level can't work: 86.6% of banks holding red cells are at or below 5 units of O-, against 19.5% for O+. The threshold therefore has to be relative:
  - **Days of supply** (units ÷ typical daily use) below 2. This mirrors the NHS Blood and Transplant amber alert at under 2 days and Canadian guidance of 4 to 6 days for red cells.
  - Typical daily use is estimated from the bank's own unit decreases in `stock_history`, because eRaktKosh publishes no issue data.
  - Where a bank has too little history, the fallback is below the bank's own 20th percentile for that group.

#### What the collected data can support

| Need | Source (point 3) | Ready? |
|---|---|---|
| Stock over time, per bank, component and group | `stock_history`, plus `blood_data/eraktkosh/history/`, hourly since 2026-10-23 | **Growing.** Weekly patterns need about 8 weeks, and festivals need a year. The 412 auto-refresh banks are refreshed in batches at fixed times, which may make them the cleanest series; the history will show. |
| Supply events | 80,757 camps, 78.9% linked to a bank | Yes: a year of history, with September and June peaks |
| Calendar effects | Malaysia's 20-year series as a proxy: weekday explains 65% of daily variation; the Hari Raya week drops to 36–55% | Method yes. India's own effects (Diwali, Holi, Eid, exams, summer) need an Indian holiday calendar, easy to add |
| Demand drivers | NCVBDC dengue by state and year; monsoon season (rain and seasonal factors already exist in point 2's model) | Yearly only; monthly would need IDSP weekly reports |
| Bank attributes | Directory, data.gov.in crosswalk (licence, 24×7), type (blood bank or storage unit), auto-refresh flag | Yes |
| Donor response | UCI (748 donors: recency, frequency, time). bloodLink's own donor profiles later | Method yes; real data later |
| True demand (units issued) | eRaktKosh `MonthlyCollection/*` | **No: it needs a login.** Ask NBTC or MoHFW for access. It would raise every model's ceiling. |

#### Findings that shape the choice

1. **Strong weekly and yearly cycles.** In Malaysia, autocorrelation is 0.69 at 7 days and 0.62 at 364 days but only 0.08 day to day. Sunday runs 1.71× the mean and Friday 0.63×. Any model must know the weekday and the festival calendar, and the camp data agrees (24% of camps on Sundays). Plain ARIMA without seasonal terms would miss this.
2. **Festivals move.** The deepest dip each year is the Hari Raya week, which falls on different dates every year (April 2023, April 2024, March–April 2025, March 2026). A month-of-year feature can't capture that; a holiday-calendar feature can.
3. **Rare groups are intermittent.** Negative groups are mostly 0 to 5 units at a bank, and 12% of Malaysian state-days have no AB donations at all. Models built for smooth series overreact here. Intermittent-demand methods, or direct classification of "will it run short?", suit them better.
4. **Thousands of short series, not a few long ones.** With 4,707 banks × up to 14 components × 8 groups and only weeks of history each, a single **global** model trained across all banks will beat one model per series. This was the clear lesson of the M5 forecasting competition, where global gradient-boosted trees won.
5. **Data comes in events, not on a clock.** A bank's stock changes only when the bank updates it. Hourly sweeps give the observation times; between updates the value carries forward. Features must say how stale the value is (the existing freshness score), or the model will trust old numbers.
6. **Supply shocks are known in advance.** Camps are registered close to their date, about 1 to 2 weeks ahead, so they help short horizons.

#### Choosing the models

**Criteria.** A model makes the shortlist if it:
1. answers report 2's question, a stock-out probability for 24 to 72 hours, either directly or from a forecast with a range;
2. learns from weeks of history, not years, across about 30,000 short red-cell series (about 3,700 banks × 8 groups), and more once other components are added;
3. copes with zero-heavy rare groups (finding 3);
4. can use the calendar, camps and freshness (findings 1, 2, 5 and 6);
5. can be explained to the panel and run after every sweep on a laptop or a free cloud tier;
6. covers what the slides promised, ARIMA and LSTM, or the report says why not.

**Three ways to get the probability.** The shortlist covers all three, so the backtest also shows which way suits the data.
- **Direct:** a classifier learns "did it run out within H hours?" from past cases.
- **Time to event:** a hazard model learns the chance of running out in each 6-hour step. The 24, 48 and 72 h answers come from one model, so they can't contradict each other, and cases that never ran out count correctly (censoring).
- **Forecast, then threshold:** forecast the units with a range, and read off the chance that they reach zero.

**The shortlist: seven models.**

| # | Model | Route | Fitted | Gives | Why it is on the list |
|---|---|---|---|---|---|
| 1 | **Gradient-boosted trees, classifier** (LightGBM, or scikit-learn's `HistGradientBoosting`) | Direct | One model for all series | P(stock-out) at 24, 48 and 72 h | The expected winner (finding 4, M5). Uses every feature at once, learns new banks from similar ones, and SHAP explains each prediction |
| 2 | **Logistic regression** | Direct | One model | The same | The transparent benchmark: readable coefficients and usually well-calibrated probabilities. If it ties with model 1, the simplicity rule picks it |
| 3 | **Discrete-time hazard model:** logistic regression on 6-hour steps, trees later | Time to event | One model | P(stock-out) by 24, 48 and 72 h, and the expected hours until it runs out | One consistent answer for all three horizons; handles censoring; gives alerts their "may run out within about N hours" |
| 4 | **Gradient-boosted trees, quantile regression** | Forecast, then threshold | One model | Units at t + 24, 48 and 72 h with the 10th to 90th percentiles; P(stock-out) from the lowest level in the window | The only global model that also gives output 2, and the units that ranking needs later |
| 5 | **ETS (Holt-Winters) with a weekly season** | Forecast, then threshold | One per series | Daily units, with simulated paths | The classical benchmark a reviewer expects, with the weekly cycle (finding 1) |
| 6 | **Seasonal ARIMA (1,0,1)(0,1,1,7)** | Forecast, then threshold | One per series | Daily units, with intervals | The slides' ARIMA, with the weekly seasonal term finding 1 calls for |
| 7 | **TSB (Teunter–Syntetos–Babai)** | Forecast, then threshold | One per series | Daily use for zero-heavy series | Made for intermittent series such as the rare groups (finding 3). Unlike Croston's method, it lowers its estimate when a series goes quiet |

- **Models 5 to 7 work on daily series:** the stock at 12:00 India time each day, after most banks' morning updates. TSB models daily use (unit decreases), which is zero on most days for a rare group. P(stock-out) is the share of simulated paths that reach zero.
- **Baselines, not counted, which every model must beat:** the last value carried forward; the same time last week; the weekday average; days of supply under 2, from the 14-day average decrease; and the stock-out rate of banks holding that many units of that group.

**Considered and not shortlisted.**

| Candidate | Verdict | Why |
|---|---|---|
| Croston's method, SBA | Covered by model 7 | They never lower their estimate while a series has no use, so they overstate use at banks that go quiet |
| Cox proportional hazards | Covered by model 3 | Stock is seen only at sweeps, so time is already discrete, with many ties |
| Random forest | Covered by model 1 | The same inputs; usually less accurate than boosting on tables like these, and its probabilities need the same calibration |
| Poisson or negative-binomial regression on daily use | Later | The demand half of forecast-then-threshold, once each bank's daily use can be estimated |
| Prophet | Dropped | One model per series, built for long business series with yearly cycles; weak on short, zero-heavy ones |
| LSTM (in the slides) | Deferred | Needs months of history and tuning. Rehearsed on Malaysia below |
| DeepAR, Temporal Fusion Transformer, N-BEATS | Deferred | Need 6 to 12 months of history and much tuning: risky on a final-year timeline |
| Pretrained forecasting models, such as Chronos or TimesFM | Deferred | Need no training, but are heavy to run on 30,000 series after every sweep, and hard to explain. Worth one zero-shot check once the backtest harness exists |
| **Donor-response model R:** logistic regression, then trees, on recency, frequency, time since first donation, distance and past responses (UCI-style, with that dataset's duplicates and its redundant "Monetary" column dropped) | Separate use case | It decides whom to ask, not where stock runs out. Built with notifications, once real responses exist |

#### Early results, at low fidelity

Two quick checks, run on 26 October in `../rough_work/ML/`, test the pipelines and give a first, rough ranking. **Neither decides anything:** the walk-forward backtest on bloodLink's own history does, in late December.

**Check 1: a rehearsal on Malaysia's donations.**
- **Why Malaysia:** bloodLink's history is days old, while Malaysia's Ministry of Health publishes 20 years of daily donations by state and blood group. They are donations (supply), not stock, so the check ranks methods on a long, real series. It says nothing about accuracy in India.
- **Task:** the closest supply-side version of report 2's question. At each forecast date, will the next 3 days bring at most half the donations usual for those weekdays? "Usual" is the mean of the last 8 same weekdays, known on the day. Every model except the classifiers also forecasts the 3-day total.
- **Data:** 52 series (13 states × 4 groups) at 52 fortnightly forecast dates, October 2024 to October 2026: 2,704 cases with 192 events (7.1%). Per-series models were refitted at every date on the last 3 years, with 1,000 seeded simulated paths each. Global models were retrained every 12 weeks (the LSTM every 24) on the last 6 years, using only what was known by then.
- **Models:** six of the seven (the hazard model needs stock that runs down), two baselines and a small LSTM (one layer of 32 units over a 56-day window).

| Model | PR-AUC (90% interval) | GBM classifier beats it | Recall at precision 0.5 | Brier | MASE, 3-day total |
|---|---|---|---|---|---|
| 1 · GBM classifier | **0.247** (0.185–0.321) | — | **0.115** | 0.0611 | — |
| 5 · ETS | 0.234 (0.175–0.312) | 70% | 0.109 | 0.0653 | 0.642 |
| 6 · SARIMA | 0.234 (0.181–0.302) | 72% | 0.016 | 0.0647 | **0.629** |
| 2 · Logistic regression | 0.228 (0.170–0.309) | 78% | 0.057 | 0.0625 | — |
| 4 · GBM quantiles | 0.228 (0.171–0.306) | 89% | 0.083 | **0.0610** | 0.638 |
| LSTM, deferred | 0.210 (0.167–0.272) | 88% | 0.016 | 0.0680 | 0.662 |
| 7 · TSB | 0.193 (0.147–0.251) | 99% | 0.021 | 0.0644 | 0.834 |
| Baseline: weekday average | 0.185 (0.147–0.230) | 96% | 0 | 0.0621 | 0.700 |
| Baseline: same days last week | 0.090 (0.071–0.112) | 100% | 0 | 0.1254 | 0.893 |

The intervals and the "beats it" shares come from 1,000 resamples of whole forecast dates, since the 52 series move together on a date. A constant forecast at the base rate scores Brier 0.0660.

- **The GBM classifier leads,** as expected, on PR-AUC and recall at precision 0.5, and the two tree models share the best Brier score. But it beats ETS, SARIMA and logistic regression on PR-AUC in only 70% to 78% of resamples. Recall at precision 0.5 is noisier still: the classifier's own interval runs from 0.016 to 0.243, and it beats ETS and logistic regression in only 51% and 56% of resamples. 192 events are too few to separate the top five.
- **The decision rule, dry-run on these results, picks logistic regression.** The trees lead on recall, but not reliably: the GBM classifier beats logistic regression in 56% of resamples, under the 80% the rule asks for. So the simplest model that clears the baseline margin wins, and logistic regression's PR-AUC is 23% above the weekday average's. That is the rule doing its job on a small sample. bloodLink's backtest will have about 4,000 events a week (check 2), not 192 in all.
- **The weekday average is a strong baseline for the 3-day total.** Only SARIMA beats its MASE by the 10% margin, and only just (0.629 against 0.700). ETS (0.642) and GBM quantiles (0.638) fall short.
- **Per-series probabilities need calibrating.** ETS and SARIMA rank cases about as well as the trees, but their Brier scores (0.065) barely beat a constant forecast's 0.066, while the trees reach 0.061.
- **Simulated probabilities need a fixed seed.** With 300 unseeded paths, two runs gave ETS a PR-AUC of 0.237 and 0.212. The rehearsal now uses 1,000 seeded paths.
- **TSB is cheap but weak here,** even on the 505 intermittent cases (PR-AUC 0.262, against the GBM classifier's 0.331). Malaysia's state totals are far less sparse than one bank's rare group, so the backtest decides.
- **The LSTM trails the trees overall** (PR-AUC 0.210, MASE 0.662), and its Brier score (0.068) is worse than a constant forecast's. Deferring it holds.
- **Cost.** On one core, fitting one 8-week daily series and simulating 300 paths took about 0.16 s for ETS and 0.32 s for SARIMA, so refitting all 30,000 red-cell series takes about 1.3 and 2.6 hours of CPU. One global model with 300 trees scored 30,000 rows in 0.55 s.

**Check 2: the pipeline on bloodLink's own history.**
- **Data:** red-cell stock from 13:26 UTC on 23 October to 02:37 UTC on 26 October. 25 full sweeps have a full 24 hours after them, giving 542,593 cases of a bank, group and time with stock above zero, at 3,742 banks.
- **Event:** a stock-out within 24 h, in 15,556 cases (2.9%).
- **Method:** five models, cross-validated in 5 folds grouped by bank, so no bank is on both sides. The folds share the same hours, so this shows whether the state at one time separates the banks that run out from the rest. It is not a forecast test. The per-series models need weeks of history, so they aren't in it.

| | O+ | B+ | A+ | AB+ | B- | O- | A- | AB- |
|---|---|---|---|---|---|---|---|---|
| Stock-out within 24 h | 1.2% | 1.3% | 2.1% | 2.7% | 4.6% | 4.2% | 4.3% | 6.2% |
| Median units held | 23 | 21 | 13 | 6 | 3 | 2 | 2 | 1 |

| Model | PR-AUC | Brier |
|---|---|---|
| Baseline: the overall rate | 0.028 | 0.0278 |
| Baseline: the rate at banks holding that many units | 0.082 | 0.0267 |
| 2 · Logistic regression | 0.114 | 0.0265 |
| 3 · Hazard model, four 6-hour steps | 0.114 | 0.0265 |
| 1 · GBM classifier | 0.117 | 0.0269 |

- **The pipeline works end to end:** snapshots rebuilt from change events, labels, features, a split by bank, and models 1 to 3 fitted, the hazard model included.
- **Rare groups run out three to five times as often as O+ and B+,** because banks hold so few units of them. The backtest reports every group separately.
- **The state at one time tells part of the story.** The units held lift PR-AUC from 0.028 to 0.082, and the bank's activity, group, state and freshness lift it to about 0.115, four times the base rate. The three models are within 0.003 of each other, which a test this short can't separate. The trees' Brier score is a little worse than logistic regression's: their probabilities need calibrating too.
- **No model reaches precision 0.5.** A single snapshot can't say which banks will run out. What it lacks is each bank's rate of use, which only weeks of history show. Hence the fallback in the decision rule.
- **Labels need rules.** Of the 1,502 drops to zero seen so far, 11.4% came with the bank's whole red-cell stock at zero, and 5.4% with no stock of anything. In 24 of the 44 updates that cleared every red-cell group, the bank had held 10 or more units just before: more like a cleared page than real use. And 13.7% of the drops were back above zero within 24 h. The label rules in the subplan handle both.
- **The backtest will have far more events:** about 600 drops to zero a day, so about 4,000 in each test week.

#### The walk-forward dry run (4 November)

A run of the walk-forward test on bloodLink's own history, held early as a phase 5.2 dry run, with all seven models and with each input and design detail tested in turn. **It decides nothing:** the backtest at about 8 weeks, in late December, does, with the decision rule applied once as written. It gives an interim choice, so that phase 5.1 builds the right dataset.
- The full tables, the input tests, each input's reason and weight, and the sources behind them are in `../rough_work/ML/SUMMARY.md`.
- The scripts: `walk_forward_check.py` (the models), `series_models.py` (ETS and SARIMA), `feature_tests.py` (inputs and design details), `input_weights.py` (what each input weighs) and `camps_check.py`.

**The test.**
- **Data:** 10.8 days of the laptop's hourly collection, 23 October 13:26 to 3 November 07:37 UTC, fixed with `--until` so a rerun gives the same tables. 879,673 rows of a bank, group and forecast time with red cells in stock, at 3,638 banks, at 43 forecast times on the 6-hourly India-time grid of phase 5.1.
- **Gaps:** each bank's stock is rebuilt at the bank's own update times, not when the collector saw them, so a night the laptop was off loses only an update a later one in the same gap replaced. Of 8,161 drops to zero, 1.2% were refilled within 6 h, the kind a gap could hide.
- **Labels:** the rules under "The subplan" below, in full.
- **Split:** walk forward one India day at a time, with a purge. Models train on every forecast time whose outcome was known before the test day began; at 48 h that is 4 test days, 304,124 cases and 17,520 stock-outs (5.8%) at 3,561 banks. The hazard model trains on the latest days too, with open cases censored at the day's start.
- **Uncertainty:** 90% intervals from 1,000 resamples of whole banks, the same draws for every model. With too few test days to resample days, as the plan intends, the per-day spread is the larger uncertainty.
- **All seven models ran.** ETS and SARIMA run in a stand-in form until each series has two full weeks of daily values:
  - each series' units at the four 6-hour grid times, with a daily season of 4 steps in place of the weekly one;
  - P(stock-out) from 300 seeded simulated paths, and a refit once a week, as planned;
  - SARIMA (1,0,1)(0,1,1,4) with stationarity and invertibility enforced. Without them, as in the Malaysia rehearsal, a third of these short series got explosive estimates.

**At 48 h, the decision horizon.** Each model takes its better encoding on these days: the logistic models take past drops to zero and updates as 7-day counts, the trees as rates per day seen.

| Model | PR-AUC (90% interval) | Recall at 1 false alert per bank per week* | Recall at precision 0.5 | Mean prediction ÷ observed rate | Brier |
|---|---|---|---|---|---|
| 1 · GBM classifier | **0.269** (0.253–0.286) | 0.153 | **0.052** | **1.08** | **0.0474** |
| 3 · Hazard model, on trees | 0.262 (0.246–0.278) | 0.144 | 0.038 | 1.17 | 0.0483 |
| 3 · Hazard model, logistic | 0.256 (0.241–0.272) | 0.156 | 0.029 | 1.22 | 0.0484 |
| 2 · Logistic regression | 0.255 (0.240–0.272) | **0.158** | 0.033 | 1.25 | 0.0485 |
| 4 · GBM quantiles | 0.237 (0.225–0.251) | 0.141 | 0.005 | 1.35 | 0.0487 |
| 5 · ETS, stand-in | 0.153 (0.145–0.162) | 0 | 0 | 1.95 | 0.0872 |
| 6 · SARIMA, stand-in | 0.150 (0.143–0.159) | 0.043 | 0 | 2.00 | 0.0861 |
| 7 · TSB | 0.120 (0.113–0.128) | 0.070 | 0 | 1.28 | 0.0664 |
| Baseline: rate at that many units | 0.183 (0.176–0.193) | 0.098 | 0 | 1.01 | 0.0496 |
| Baseline: days of supply | 0.121 (0.113–0.130) | 0.083 | 0 | — | — |
| Baseline: overall rate | 0.057 | 0 | 0 | 0.98 | 0.0543 |

\* The share of stock-out cases flagged at the lowest cut-off that keeps false alerts at or under 1 per bank per week, the limit set under "How the prediction feeds the engine". At most one false alert counts per bank, group and day.

**The interim choice: logistic regression, with the GBM classifier as the challenger.**
- **Why logistic regression:**
  - **The rule as written picks it.** No model reaches precision 0.5 with at least 10% recall (the best has 5.2%), so the rule falls back to PR-AUC. The GBM classifier leads by 1.4 points, inside the 2-point margin, so the simpler model wins. It is 39% above the best baseline, past the 10% required.
  - **The rule with the alert budget as its first test picks it too** (suggestion 1 below): it leads, at 15.8% of stock-outs against 15.3%.
  - **On donor alerts the leaders tie.** Logistic regression, the hazard model and the GBM classifier all catch 15% to 16% of stock-out cases at 1 false alert per bank per week, and about 26% at 2. The 0.5-point spread is smaller than the intervals.
  - **Its alert cut-off holds when set in advance.** Set on an earlier day and used on the next, it gave 0.98 false alerts per bank per week; the GBM classifier's gave 1.09.
  - **It is the simplest to build and to explain to the panel:** readable coefficients, and every fit over all horizons in under a minute.
- **Why the GBM classifier stays in the backtest:**
  - It ranks stock-outs best at 24 and 48 h, on every test day and in 99% of resamples.
  - Its probabilities are the closest to the observed rate: 8% too high, against 25% for logistic regression.
  - With the inputs chosen for phase 5.1, its lead is exactly 2.0 points. If December shows more than 2 points and it wins in at least 80% of resamples, the rule as written picks it.
  - It uses the same inputs, and a fit takes about 7 seconds.
- **Why not the others:**
  - **ETS, SARIMA and TSB** are below the best baseline at every horizon. The per-series models see only 17 to 40 values each, stock moves in jumps they don't model, and they can't learn from other banks.
  - **GBM quantiles** trail the leaders. They are kept only if a units range is wanted (output 2, below).
  - **The hazard model on trees** is best only at 72 h (0.323), costs more than the GBM classifier, and its carried cut-off under-alerted.
- **One condition:** recalibrate logistic regression's probabilities (Platt scaling on the latest day whose outcomes are known) before they feed ranking's (1 − P), since it predicts 25% more stock-outs than happen.

**Inputs and design details.** Each was left out or changed in turn and the walk forward rerun (`feature_tests.py`). Each input's weight inside the fitted models was read off too (`input_weights.py`).
- **History is most of the signal.** With only today's stock, every model falls 5.5 to 8.6 points, to about the baseline.
- **Past drops to zero are the single most useful input.** Leaving them out costs every model 1.1 to 1.2 points, on every test day.
- **Inside the models, today's units weigh most:** shuffling them costs both models about 19 points. State, refills, groups stocked and past drops to zero follow, at 1 to 6 points.
- **The GBM classifier's lead** comes from inputs the logistic models can't use as well. Leaving out update rhythm, bank type, blood group or state costs it 0.5 to 0.8 points each.
- **Weekday, whole blood and hour add nothing yet.** Weekday is retested at 4 weeks, when each weekday has been seen more than once or twice.
- **Camps don't show up in red-cell stock.** Banks with a camp added no more red cells in the next 72 h than other banks (−10.9 units, 90% interval −35.9 to +10.9), so camps are left out, and no new download was made (suggestion 2 below). The camp-to-bank crosswalk also linked 6,096 camps that name no bank to 6 banks with blank names; `camps_check.py` skips them, and `../blood_data/` is unchanged.
- **Design details chosen:**
  - past drops to zero and updates as rates per day seen;
  - a 7-day lookback (3 days is 1 point worse);
  - an expanding training window, and logistic regression on every row;
  - the hazard model's time-of-day term;
  - cleared pages left out, as the label rules say.

**Other results.**
- **24 h and 72 h.** At 24 h the GBM classifier leads on all 6 days (0.184 against 0.168 for logistic regression). At 72 h, on 2 test days, the hazard model on trees leads (0.323), and the GBM classifier, the hazard model and logistic regression tie (0.315 to 0.316).
- **By group and bank type.** Rh− groups run out 3 to 5 times as often and are harder to predict: the GBM classifier's PR-AUC is 4.6 to 11.5 times the base rate for Rh+ groups, and 2.2 to 3.1 times for Rh−. Auto-refresh banks are much more predictable (0.43 against 0.23).
- **Units at t + 24 h and t + 48 h (output 2).** GBM quantiles beat "no change" on MASE by only 1 to 2%, short of the 10% margin, but cut pinball loss by 11 to 13%: the range is where the model adds something. TSB, ETS and SARIMA are worse than no change.
- **Cost:** 47 minutes for the whole test on the laptop, 18 of them for ETS and SARIMA on 11 cores, within phase 5.2's hour.
- **Against the two checks of 26 October,** the pattern holds: the GBM classifier leads narrowly, logistic regression is close, and the rule picks the simpler one. In the Malaysia rehearsal, on 20 years of daily data, ETS and SARIMA came within 1.3 points of the leader; on short 6-hour series they fall below the baseline.

**What it can't say yet.**
- **Two to six test days,** with one more day enough to reorder the top three.
- **Inputs were chosen on the same days the models are compared on,** which flatters the choice a little.
- **ETS and SARIMA ran only in their stand-in form.**
- **No weekly or festival cycle yet.** Diwali, on 8 November, will be the first.
- **Alert cut-offs:** the recall columns choose their cut-off on test labels, as the metric is defined. Set in advance on an earlier day, the cut-off held on 1 day at 48 h and 4 days at 24 h.
- **Warning time doesn't separate the models:** every model's median warning is 36 to 44 h at 48 h, so the lead-time bar of 24 h doesn't decide anything.

**What follows from it.**
- **Kept as planned:**
  - the backtest in late December, run once, with the rule as written;
  - phase 5.1 built the way `walk_forward_check.py` works (stock rebuilt at the banks' own update times, the cleared-page rule, the 6-hourly grid), so the laptop's gaps and the cloud's 4.5-hour sweeps give the same rows;
  - ETS and SARIMA in report 3's form, daily values with a weekly season, once two weeks exist;
  - TSB, as it costs nothing.
- **Phase 5.1 builds the 19 core inputs:**
  - units of the group, the bank's total red cells, groups stocked and the group's share;
  - past drops to zero per day seen over 7 days, and the change over 24 h and 72 h;
  - decreases and increases per day, days of supply and the bank's total use;
  - updates in 24 h, updates per day and hours since the last update;
  - auto-refresh, ownership, state, blood group and Rh negative.
- **The three suggestions:**
  1. **Waiting for approval** (listed in `docs/plans.md`): add recall at 1 false alert per bank per week to the decision rule, as its first test. It has to be agreed before the December test weeks are collected, so the rule stays fixed in advance. Here it picks the same model.
  2. **Done:** camps were checked with the data already on disk before any download, found not to show up in red-cell stock, and left out.
  3. **Waiting for approval:** report each group's PR-AUC with its lift over that group's base rate.

#### How to compare them

1. **Rehearse on Malaysia.** Done on 26 October, at low fidelity (above). The rehearsal asks about a 3-day shortfall instead of forecasting 7 days of donations, as first planned, so that it tests a 24–72 h probability, as report 2 asks.
2. **Backtest on bloodLink's own history once about 8 weeks exist**, around late December 2026:
   - **Split:** walk forward. Train on weeks 1 to k, test week k + 1, repeat. Never shuffle randomly, because that would leak the future.
   - **Classification metrics** (will it run out?), at 24, 48 and 72 h:
     - PR-AUC, which suits rare events better than ROC-AUC;
     - recall at precision 0.5 (at most one false alarm per true one);
     - Brier score and a calibration plot;
     - **lead time:** hours of warning before the actual drop;
     - **false alerts per bank per week,** which drives donor fatigue.
   - **Forecast metrics,** for models 4 to 7 and the baselines: MASE (scale-free, and handles near-zero series), pinball loss at the 10th, 50th and 90th percentiles, WAPE.
   - **Uncertainty:** a 90% interval for every metric, from resampling whole days, since banks move together on a day. The rehearsal shows why: with 192 events, most models' intervals overlap. bloodLink's history will hold far more events (check 2).
   - **Calibration:** every model's probabilities are calibrated on the last held-out week before scoring, since the rehearsal's per-series models ranked well but were poorly calibrated.
   - **Reproducible:** every simulation and model uses a fixed seed, so a rerun gives the same table.
   - **Breakdowns:** by blood group (rare against common), by bank type, by auto-refresh, and by state.
3. **Decision rule, agreed before looking at results.** The horizon, the fallback and the resampling test were added on 26 October, after the low-fidelity checks and before any backtest.
   - Judge on report 2's event, a stock-out, at 48 h: the donor-alert horizon.
   - Pick the model with the best recall at precision 0.5 and at least 24 h of median lead time.
   - If no model reaches precision 0.5 with a recall of at least 10%, pick by PR-AUC instead. The early checks suggest this may happen.
   - Prefer the simpler model when the difference is within 2 percentage points, or when the leader beats it on that metric in fewer than 80% of the resamples. From simplest: logistic regression, the hazard model, TSB, ETS, SARIMA, the GBM classifier, GBM quantiles.
   - Any model must beat the best baseline by at least 10% on PR-AUC, and models 4 to 7 also on MASE.
4. **Present to the panel:** one table per metric, and a few example banks with forecast against actual, before building the winning model into the app.

#### How the prediction feeds the engine

- **Ranking (point 1): report 2's "used to lower that bank's score".**
  - **First version:** multiply the bank's coverage and surplus scores by (1 − P), where P is its probability of running out of the group asked for within 24 h. A planned request, such as surgery the next day, uses P at 48 or 72 h.
  - Mark a bank "may run out soon" when P passes the alert cut-off.
  - **Later,** with a units forecast (models 4 to 7): score coverage and surplus on the units predicted for the time you would arrive, not on stock as last posted.
  - The new factor goes through point 4's sensitivity check before it ships.
- **Donor alerts (the main use).**
  - **Trigger:** P(stock-out within 48 h) passes a cut-off, set from the backtest to keep false alerts under 1 per bank per week. Output 1b moves alerts earlier once it exists.
  - **Who:** eligible donors of that group near the bank, chosen with the existing eligibility module, the exact group (point 1) and the road ETA (point 2), and ranked by the response model R.
  - **How many:** enough to cover the expected shortfall at the expected response rate.
- **Public "donate here" list:** banks and groups with high risk in the next 72 h, shown on the donor page.
- **Camp planning for blood-bank accounts:** which weeks and groups the bank usually runs short on, using its own history and the camp effect.

#### Risks and limits, stated up front

- **Self-reported stock.** eRaktKosh stock is what banks type in; 6.3% haven't updated in 30 days. Dormant banks are excluded from training, and freshness is a feature.
- **Zeros that aren't stock-outs.** A bank that clears its page reads as running out of every group at once. The label rules (phase 5.1) leave these out, and the backtest reports the result both ways.
- **No true demand yet.** Unit decreases mix issues with corrections and expiry. The monthly issue reports would fix that (access request).
- **Gaps in collection.** Until 3 November the laptop collected only while it was on (#35); since then the cloud sweeps every 4.5 hours, around the clock. Stock is rebuilt at the banks' own update times, so a gap loses only an update that a later one replaced, and missing hours are never filled in silently.
- **Donor fatigue and fairness.** False alarms cost donor goodwill, which is why the false-alert rate is a selection metric, not an afterthought.
- **Medical safety.** The forecast decides whom to ask to donate, never what a patient receives. Blood banks still do all screening and cross-matching.

#### The subplan, with dates

| Phase | When | Work | Done when |
|---|---|---|---|
| **5.0 · Choose and rehearse** | 26 October 2026: **done** | The criteria, the longlist and the seven models; the Malaysia rehearsal and the plumbing test, in `../rough_work/ML/` | This section |
| **5.1 · Labels and features** | November 2026 | Build the dataset from `stock_history`, or the local archive: every bank × component × group at 00:00, 06:00, 12:00 and 18:00 India time, carrying the last value forward. This grid gives the same rows from the laptop's hourly sweeps and the cloud's 4.5-hourly ones. Write down the label rules below. Add the 19 core inputs the [dry run](#the-walk-forward-dry-run-4-november) chose: stock now, past drops to zero, recent change, use and refills with days of supply, the bank's update rhythm and freshness, bank type, auto-refresh, state and blood group. Retest weekday at 4 weeks, and add the Indian holiday calendar and Open-Meteo rain once the history spans a festival and rainy days. Camps are left out: they don't show up in red-cell stock | One script rebuilds the same dataset from the raw history, identically each time, and unit tests pin the label rules |
| **5.2 · Dry runs of the harness** | Every 2 weeks from mid-November; the first on 3 and 4 November ([above](#the-walk-forward-dry-run-4-november)) | Run the baselines and all seven models through the walk-forward harness on the history so far. Check only that it runs and the numbers are sane, not which model leads | The harness runs end to end in under an hour on the laptop |
| **5.3 · The backtest** | Late December 2026, at about 8 weeks | Run it once and apply the decision rule as written | A table per metric with intervals, the chosen model and example banks, presented to the panel |
| **5.4 · Scoring and shadow mode** | January 2027 | The chosen model scores every series at each 6-hourly grid time, the grid it was trained on, and the probabilities are stored with the model's version. How it is deployed, and how suggestions to eligible donors follow, is in `docs/PLANS/ML_system.md`. Ranked search reads them behind a flag. Donor alerts are logged, not sent, for 2 weeks | Calibration and false alerts per bank per week measured on live data |
| **5.5 · Later** | 2027 | Retrain monthly and watch for calibration drift. Output 1b once daily use is reliable. The LSTM, TFT and a pretrained model once 6 to 12 months exist. Model R once notifications collect responses | — |

**Label rules (phase 5.1), fixed before the backtest:**
- **Stock-out:** the units of that component and group reach zero within (t, t + H], given more than zero at t. Cases already at zero at t aren't scored.
- **A whole component cleared at once:** when every group of a component falls from 10 or more units in total to zero in one update, the bank is treated as not reporting, and the case is left out. Using that much of every group between two updates is far less likely than a cleared page. A small bank using its last few units still counts as a stock-out.
- **Quick refills still count.** A zero refilled within hours was real for anyone who arrived then. Their share is reported.
- **Dormant banks,** with no update in 30 days (point 3.1), are left out.
- **Censoring:** a case whose window runs past the end of the data, or into a collection gap (#35), is dropped for that horizon. The hazard model keeps it up to the gap.
