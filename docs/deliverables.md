# Deliverables: what was asked, what was done, and where

*As of 4 November 2026. This file replaces `docs/report3.md` and `docs/features.md`, which were folded into [`SUMMARIES/`](SUMMARIES/README.md) on 4 November, word for word. Each topic's file there starts with a summary, followed by "The feature in full" (how it works now, from the feature list) and "Report 3's record" (the dated record of the work). Material that belongs to no topic is in `CLAUDE.md`, under "History": the rounds of work, the other features, the bug fixes, the move to Supabase, and report 3's dated notes.*

**Where the suggestions came from:**
- **The reviewer's feedback** on Sem 7 progress report 1, six points: `../documentation/suggested changes after sem 7 report 1.txt`.
- **Report 3's requests,** which set its points 1, 2, 3.1, 3.2, 4 and 5. They were worked in the order they were asked, 2, 1, 3.1, 3.2, 4, 5, from 23 October 2026.

| Status | Meaning |
|---|---|
| **Done** | Built or written, checked, and the evidence recorded |
| **In progress** | Started, with dated next steps |
| **Planned** | A written plan or test design exists, but nothing is built |
| **Not touched** | No work and no plan yet |
| **Dropped** | Decided not to do |

**Contents**
1. [At a glance](#at-a-glance)
2. [Each deliverable](#each-deliverable)
3. [Where report 3 and the feature list went](#where-report-3-and-the-feature-list-went)
4. [The whole system](#the-whole-system)
5. [What is not done yet](#what-is-not-done-yet)
6. [Not covered by any point yet](#not-covered-by-any-point-yet)
7. [Other records](#other-records)

---

## At a glance

| # | Deliverable | Asked by | Status | Summary | What is left |
|---|---|---|---|---|---|
| 1 | The ranking algorithm | Reviewer point 1; report 3, point 1 | **Done** | [`ranking_algorithm.md`](SUMMARIES/ranking_algorithm.md) | Reliability from the stock-out forecast (planned); the ETA against timed trips (planned); an expert review of the weights (not touched) |
| 2 | Road routing and a time-aware ETA | Report 3, point 2 (the ETA in reviewer point 1) | **Done.** Calibration from timed trips is planned | [`eta_model.md`](SUMMARIES/eta_model.md) | The rural and town values from timed trips; self-hosted OSRM before real traffic |
| 3 | The ETA benchmark | Report 3, point 4 (ETA accuracy); reviewer points 1 and 4 | **In progress:** the Google half is done; the timed trips are planned | [`eta_benchmark.md`](SUMMARIES/eta_benchmark.md) | The rubric agreed; Google's answers purged by 3 December; 30 to 60 timed trips in December; M5 in January 2027 |
| 4 | The geospatial benchmark | Reviewer point 2; report 3, point 4 | **Done** | [`geospatial_benchmark.md`](SUMMARIES/geospatial_benchmark.md) | Using the index for donor search (planned) |
| 5 | Data quality and freshness | Reviewer point 3; report 3, points 3.1 and 3.2 | **Done, with known gaps** | [`data_quality.md`](SUMMARIES/data_quality.md) | Placing the banks location search can't see (#33, #34, in progress: 140 placed, 81 waiting for review, 671 not found); 6 likely duplicates (not touched); monthly issue data (not touched) |
| 6 | Testing and performance | Reviewer point 4; report 3, point 4 | **Done for everything built** | [`performance_testing.md`](SUMMARIES/performance_testing.md) | Integration, end-to-end and CI (#20, planned); notification tests (planned, with the feature); heavier load and a deployed server (not touched) |
| 7 | Where AI/ML fits | Reviewer point 5; report 3, point 5 | **In progress** | [`ml_models.md`](SUMMARIES/ml_models.md) | Labels and features (November); the backtest (late December); shadow mode (January 2027) |
| 8 | Separate completed from planned work | Reviewer point 6 | **Done** | This file | Report 1 and its slides still claim features the code lacks (#32, dropped) |

---

## Each deliverable

### 1 · The ranking algorithm

**Asked.**
- **Reviewer point 1:** "Clearly define how blood sources will be ranked based on compatibility, distance, ETA, and reliability. I would suggest implementing some sort of scoring methodology and weightage should be explained with suitable examples or test scenarios."
- **Report 3, point 1:** "make sure that stock overflow is rewarded more in critical and urgent situations. Remove the compatibility feature from the engine's calculations, and list a hospital as a match only if it has the exact blood type required."

**Done.**
- **Four scores:** ETA, coverage, surplus and freshness, combined with urgency weights.
- **Matching** by the exact blood group only.
- **Spare stock** is rewarded most when critical.
- **The ETA** comes from road routes and traffic.
- **A response plan** takes units from banks in rank order and reports any shortfall.
- **Decisions** D1.1 to D1.5.
- **A worked example** (59.8 against 56.9), and a live Mumbai example.
- **20 unit tests.**
- **The sensitivity check:** the first choice is unchanged in 92% to 98% of ±20% weight changes, with Kendall's τ about 0.98.

**Where:**
- the code: `src/lib/ranking.js`, `src/lib/stock.js` and `src/lib/compatibility.js` (kept for donor matching);
- the tests: `tests/ranking.test.js` and `tests/compatibility.test.js`;
- the sensitivity script: `scripts/ranking-sensitivity.mjs`, with its results in `../blood_data/measurements/ranking_sensitivity/`.

**Summary:** [`SUMMARIES/ranking_algorithm.md`](SUMMARIES/ranking_algorithm.md). Report 3's points 1 and 4 (ranking sensitivity) are in its [record](SUMMARIES/ranking_algorithm.md#report-3s-record).

**Status: Done.** Left:
- reliability beyond freshness, through the stock-out forecast from January 2027, and through blood banks confirming reservations;
- the ETA against timed trips;
- an expert review of the weights (not touched).

### 2 · Road routing and a time-aware ETA

**Asked** (report 3, point 2): "implement OSRM and make sure that ETA depends on time of day, population density, estimated rush-hour slowdowns, and whatever else is relevant." It is how reviewer point 1's "ETA" is computed.

**Done:**
- OSRM road routes, one table call per search, with a 24-hour cache and the public server's rules kept;
- free-flow speeds and weekday-hour congestion from the TomTom Traffic Index 2025;
- zones by bank density, so city, town and rural areas are scaled;
- a seasonal factor, and live rain from Open-Meteo;
- a straight-line fallback at × 1.34;
- decisions D2.1 to D2.6;
- the measurements taken before designing: OSRM's 0.7 s, the 1.34 detour factor from 94 trips, OSRM's 65 km/h, TomTom's 33.7 km/h for Mumbai, and bank density against population (r = 0.70).

**Where:**
- the model: `src/lib/trafficModel.js`, `src/lib/traffic.js`, `src/lib/routing.js` and `src/lib/weather.js`;
- the profiles: `assets/traffic_profiles.json`, built by `scripts/build-traffic-profiles.mjs`;
- the tests: `tests/traffic.test.js` and `tests/routing.test.js`.

**Summary:** [`SUMMARIES/eta_model.md`](SUMMARIES/eta_model.md), with report 3's point 2 in its [record](SUMMARIES/eta_model.md#report-3s-record).

**Status: Done.** Left:
- the rural free-flow speed and the town congestion scale, set from timed trips;
- self-hosted OSRM before real traffic.

### 3 · The ETA benchmark

**Asked.** Report 3, point 4 planned ETA accuracy against timed trips, with a target under 25% in every zone. Reviewer point 4 asks for measurable results.

**Done:**
- a bench, a written rubric (not yet agreed by the team), and adapters for four methods and six ablations;
- Google's traffic-aware predictions for 3,360 trips (4,107 elements, free);
- 200 latency calls to OSRM.

The app's method, M3, is 24.9% off Google, the closest of four, and it wins on the rubric with 65.0 of 100.

**Where:**
- the bench: `../rough_work/eta_benchmarks/eta-bench.mjs`, `eta-methods.mjs`, `eta-sample.mjs`, `eta-google.mjs` and `eta-data.mjs`;
- the metrics and rubric: `../rough_work/eta_benchmarks/etaMetrics.js` and `etaRubric.js`;
- their tests, in `../rough_work/eta_benchmarks/tests/`;
- the runs, in `../rough_work/eta_benchmarks/data/`;
- the design and every result: `docs/SUMMARIES/eta_benchmark.md`;
- the steps left: `docs/SUMMARIES/eta_benchmark.md`, "The plan to finish it".

**Summary:** [`SUMMARIES/eta_benchmark.md`](SUMMARIES/eta_benchmark.md).

**Status: In progress.** Left:
- the team agrees the rubric, by 13 November;
- Google's answers are purged, by 3 December;
- 30 to 60 timed trips, 12 to 20 December;
- M5 and the decision, by 11 January 2027.

### 4 · The geospatial benchmark

**Asked** (reviewer point 2): "Since the project uses Haversine and Expanding Ring Search, and plans to introduce spatial indexing, it would be valuable to compare these approaches quantitatively using different dataset sizes. Metrics such as search time, number of candidates evaluated, and scalability can provide stronger evidence of the proposed approach."

**Done:**
- **Six methods:** a linear scan, the app's rings, a grid, a k-d tree, an R-tree and PostGIS GiST.
- **Five sizes,** from 4,328 real banks up to 500,000 points.
- **Measured:** time, candidates evaluated and build cost, with every answer checked against the linear scan.
- **The result:** a linear scan takes about 0.1 ms today, while an index is 75 to 300 times faster at 100,000 points and more.
- **The index exists:** a PostGIS column and GiST index on `blood_banks.location`.

**Where:**
- the script: `scripts/benchmark-geo.mjs`;
- the results: `../blood_data/measurements/geo_benchmark_memory.json` and `geo_benchmark_postgis.json`;
- the index: migration `20261023000300_blood_bank_locations.sql`;
- the ring search: `src/lib/rings.js`.

**Summary:** [`SUMMARIES/geospatial_benchmark.md`](SUMMARIES/geospatial_benchmark.md).

**Status: Done.** Left: using the index for donor search (planned, `PLANS/plan_donor_network.md`).

### 5 · Data quality and freshness

**Asked.**
- **Reviewer point 3:** "As the system relies on eRaktKosh and data.gov.in, the report should explain how the approximately 4,487 records are standardized, validated, deduplicated, and refreshed. The handling of stale data and API failures should also be demonstrated. Also try to search other datasets also."
- **Report 3, point 3.1:** "execute `IMMEDIATE_NEXT_STEP.MD`, and make sure a system can load the API results at a reasonable refresh rate. This is for data collection only at this stage, not deployment: hourly or less often."
- **Report 3, point 3.2:** "look into the downloaded eRaktKosh results in `rough_work/`, write and run code to call the API again, and look into data validation and duplicates. Search the web for other sources of similar data that could train the model in the slides: trends in a hospital's stock falling below a threshold, so donors and users can be told to donate before it does. Only find and validate data; don't build the model yet. Store it in `blood_data/`."

**Done:**
- **One validator:** labels, ranges, dates and duplicates.
- **Collection:** hourly from the laptop from 23 October, then every 4.5 hours in Supabase since 3 November, archived in Storage.
- **Stale data and failures:** a saved fallback, two ages per bank, dormant banks, and a failure drill.
- **Matching:** across sources, with coordinates checked against state outlines.
- **Other datasets:** six found and validated, plus the state outlines.
- **Decisions:** D3.1 to D3.8 (point 3.1), D3.2.1 to D3.2.5 (point 3.2), and the collector's decisions of 23 October.
- **An independent re-check** found and fixed six faults (#36 to #41).

**Where:**
- the code: `src/lib/stockQuality.js`, `eraktkosh.js`, `stateBounds.js`, `collector.js` and `supabase/functions/collect-stock/`;
- the data: `../blood_data/` (`README.md`, `quality/`, `crosswalk/`);
- the re-check: [`data_integrity.md`](data_integrity.md).

**Summary:** [`SUMMARIES/data_quality.md`](SUMMARIES/data_quality.md), with report 3's points 3.1 and 3.2 in its [record](SUMMARIES/data_quality.md#report-3s-record).

**Status: Done, with known gaps.** Left:
- placing the 699 unlocated banks (#33) and re-placing the 193 in the wrong state or outside India (#34): **in progress** in `PLANS/plan_bank_locations.md`. Built: a fixes table, the search merge, `/admin/locations` and `scripts/place-banks.mjs`. 140 corrected positions are in search (15 from data.gov.in, 115 by name and 10 by address), so location search sees 4,004 of 4,756 stocked banks, up from 3,864. 81 positions wait for review;
- the 6 likely duplicate pairs (not touched);
- monthly issue data, which needs a login (not touched);
- refreshing the data.gov.in directory, which needs our own key (not touched).

### 6 · Testing and performance

**Asked.**
- **Reviewer point 4:** "The final evaluation would be stronger with measurable results covering functional testing, search/API response time, load testing, notification performance, and failure scenarios."
- **Report 3, point 4:** "include a section on how testing can be done, as in point 4 of the suggestions."

**Done:**
- a test-level plan: unit, integration, end-to-end, security, performance, failure, data quality and CI;
- 248 unit tests, all passing, plus the forecast's 16 Python tests in `ml/tests/` and the ETA benchmark's 46 in `../rough_work/eta_benchmarks/`;
- response times, and 20 users at once with 0 of 560 requests failing;
- page load;
- the failure drill;
- OSRM latency;
- the geospatial benchmark and the ranking sensitivity check;
- notification tests designed for when the feature exists.

**Where:**
- the tests: `tests/`, run with `npm test`;
- the response-time script: `scripts/measure-search.mjs` (`npm run measure`);
- the measurements: `../blood_data/measurements/`.

**Summary:** [`SUMMARIES/performance_testing.md`](SUMMARIES/performance_testing.md), with report 3's point 4 in its [record](SUMMARIES/performance_testing.md#report-3s-record). The failure drill's full record is in [`data_quality.md`](SUMMARIES/data_quality.md#results).

**Status: Done for everything built.** Left:
- integration and end-to-end suites, and CI (#20, planned);
- notification tests, with the feature (planned);
- load beyond 20 users, and on a deployed server (not touched).

### 7 · Where AI/ML fits

**Asked.**
- **Reviewer point 5:** "Clarifying where AI/ML fits into the core BloodLink problem and what specific decision or functionality it will improve? For example, will it be used for blood-demand forecasting, donor-availability prediction, or another aspect of the system? The expected input data, prediction output, and how the prediction will be utilized by the existing matching/response engine should be clearly defined."
- **Report 3, point 5:** "based on the data collected in point 3, suggest which ML models, approaches and strategies could work best. We are to compare two or three, or more, and present the findings before going ahead with the best one."

**Done:**
- **The prediction:** the probability of a stock-out within 24 to 72 hours, per bank × component × group. It lowers the bank's ranking score and starts donor alerts.
- **The models:** seven shortlisted against five baselines, for a walk-forward backtest with a decision rule fixed in advance.
- **Checks so far:** a rehearsal on Malaysian data, a plumbing test, and a walk-forward dry run of all seven models.
- **The interim choice:** logistic regression, with the GBM classifier as the challenger. The GBM classifier's 1.4-point lead is inside the rule's 2-point margin, and the two tie on donor alerts.

**Where:**
- the scripts and results: `../rough_work/ML-comparison/` (`SUMMARY.md`), outside git;
- the plan for the app: [`PLANS/ML_system.md`](PLANS/ML_system.md), the stock-out forecast in the app, suggesting active, eligible donors nearby, ranked by the donor network's score, and stock-out events an admin makes;
- its phase 0, started on 4 November:
  - `src/lib/stockoutFeatures.js` (the 19 inputs and the label rules) and `src/lib/stockoutModel.js` (scoring, daily calibration, the alert cut-off, the metrics and the kill switch, matching scikit-learn);
  - `ml/`, the Python side: the dataset builder `ml/dataset.py`, and the model it trained, `stockout-logit-t2-2026-11-04`: logistic regression predicting a fall to 2 units or fewer, PR-AUC 0.348 at 48 h walking forward (`ml/MODEL_CARDS.md`). The parity test checks it against the JS on a real week (`tests/stockout-parity.test.js`);
  - for the closed beta: the `score-stock` Edge Function (`src/lib/forecastJobs.js`), scoring every 6 hours with daily calibration and a kill switch; the "may run low" mark and the ranking factor in ranked search; and the admin overview's card. A rolled-back dry run passed on the live project (`scripts/check-forecast-live.mjs`);
  - suggestions on "My profile" for eligible donors within 15 km, and admins' stock-out events on `/admin/events`, real, for 24 to 72 hours; built, waiting for `supabase/migrations/20261105000200_admin_events.sql`;
  - the migrations `supabase/migrations/20261104000100_stockout_forecast.sql` and `20261104000200_forecast_live.sql`, not yet applied.

**Summary:** [`SUMMARIES/ml_models.md`](SUMMARIES/ml_models.md), with report 3's point 5 in its [record](SUMMARIES/ml_models.md#report-3s-record).

**Status: In progress.** History has been collected since 23 October, every 4.5 hours in Supabase since 3 November. Left:
- labels and features, in November;
- the backtest, in late December 2026;
- shadow mode, in January 2027.

Blood-demand forecasting is not touched: it needs issue data behind a login.

### 8 · Separate completed from planned work

**Asked** (reviewer point 6): "Clearly categorizing features as Completed, In Progress, or Planned will make the project status more precise and easier to evaluate." The reviewer's example was spatial indexing, described as both built and planned.

**Done:**
- this file, and [the whole system's status](#the-whole-system);
- the issue list in `CLAUDE.md`, with stable IDs;
- spatial indexing, stated plainly in [`geospatial_benchmark.md`](SUMMARIES/geospatial_benchmark.md#the-status-of-spatial-indexing-stated-plainly).

The ambiguity is resolved:
- search uses eRaktKosh's own `nearest` call, or a linear scan of the saved directory when that is down, which the benchmark shows is right at 4,328 banks;
- a PostGIS GiST index exists on `blood_banks.location`, but search doesn't use it;
- it is planned for the donor network, where the benchmark shows it is needed.

**Status: Done.** Correcting report 1 and its slides was dropped (#32), so the final report should take its counts and status from these files.

---

## Where report 3 and the feature list went

| Part | Decisions | Now in |
|---|---|---|
| Report 3's opening notes and dated status updates | — | `CLAUDE.md`, "History" |
| Point 1: the ranking engine | D1.1 to D1.5 | [`ranking_algorithm.md`](SUMMARIES/ranking_algorithm.md#point-1-ranking-engine-exact-group-only-rewarding-spare-stock) |
| Point 2: road routing and a time-aware ETA | D2.1 to D2.6 | [`eta_model.md`](SUMMARIES/eta_model.md#point-2-road-routing-osrm-and-a-time-aware-eta) |
| Point 2: checked against Google | — | [`eta_benchmark.md`](SUMMARIES/eta_benchmark.md#checked-against-google-4-november) |
| Point 3.1: stale data, failures and collection, with the move to Supabase | D3.1 to D3.8; the collector's decisions | [`data_quality.md`](SUMMARIES/data_quality.md#point-31-stale-data-eraktkosh-failures-and-hourly-collection) |
| Point 3.2: re-collecting, validating and de-duplicating; other datasets | D3.2.1 to D3.2.5 | [`data_quality.md`](SUMMARIES/data_quality.md#point-32-re-collecting-validating-and-de-duplicating-the-data-other-datasets) |
| Point 4: test levels, results, tests to add | — | [`performance_testing.md`](SUMMARIES/performance_testing.md#point-4-how-testing-and-performance-measurement-are-done) |
| Point 4: the geospatial benchmark | — | [`geospatial_benchmark.md`](SUMMARIES/geospatial_benchmark.md#point-4-the-geospatial-search-benchmark) |
| Point 4: ranking sensitivity | — | [`ranking_algorithm.md`](SUMMARIES/ranking_algorithm.md#point-4-ranking-sensitivity) |
| Point 4: the ETA accuracy test | — | [`eta_benchmark.md`](SUMMARIES/eta_benchmark.md#point-4-the-eta-accuracy-test) |
| Point 5: the ML approaches | — | [`ml_models.md`](SUMMARIES/ml_models.md#point-5-which-ml-approaches-to-compare) |
| Reviewer suggestions, one by one; the whole system | — | This file |
| Features: ranked search, compatibility | — | [`ranking_algorithm.md`](SUMMARIES/ranking_algorithm.md#the-feature-in-full) |
| Features: travel times by road | — | [`eta_model.md`](SUMMARIES/eta_model.md#the-feature-in-full) |
| Features: how well it does (the ETA benchmark) | — | [`eta_benchmark.md`](SUMMARIES/eta_benchmark.md#the-feature-in-full) |
| Features: density-aware ring search | — | [`geospatial_benchmark.md`](SUMMARIES/geospatial_benchmark.md#the-feature-in-full) |
| Features: stock collected in Supabase; the 24 October data-check fixes (#36 to #41) | — | [`data_quality.md`](SUMMARIES/data_quality.md#the-feature-in-full) |
| Features: unit tests | — | [`performance_testing.md`](SUMMARIES/performance_testing.md#the-feature-in-full) |
| Features: the rounds of work, verification, admin, sign-in, privacy, location, security headers, donor eligibility, search results, the other bug fixes, the move to Supabase, the documents | — | `CLAUDE.md`, "History" and the documents list |
| Features: not done yet | — | [What is not done yet](#what-is-not-done-yet) |

Report 3's text keeps its own cross-references, such as "see 3.1" or "D2.4". The table above says where each now is.

---

## The whole system

| Status | Items |
|---|---|
| **Completed** | **Search:** region, location and ranked search; exact-group ranking with the surplus score, and the response plan; road ETA by time of day, density, season and rain, checked against Google. **Data:** eRaktKosh validation, per-state circuits, retry, give-up and saved-copy fallback; the stock store, with collection every 4.5 hours in Supabase and history archived in Storage; dormant banks, freshness banners and two ages; the state-outline check on bank coordinates; PostGIS locations; the database in Mumbai. **Accounts:** Supabase sign-in, profiles and donor eligibility to NBTC's 2017 guidelines; organisation verification and admin tools, with the collection-health card; consent, a privacy page and account deletion; security headers; the search pin rounded to about 110 m. **Evidence:** 248 unit tests, plus the forecast's 16 Python tests and the ETA benchmark's 46, response-time and load measurements, the failure drill, the geospatial benchmark, the ranking sensitivity check and the ETA benchmark's Google half. |
| **In progress** | Stock history, accumulating every 4.5 hours. The stock-out forecast: seven models shortlisted and rehearsed, and a walk-forward dry run of all seven done, with an interim choice of logistic regression (the GBM classifier as the challenger). The backtest waits for 8 weeks of history. The forecast in the app: logistic regression predicting low stock (2 units or fewer), its scoring job, daily calibration, kill switch, search mark, ranking factor and admin card, built for the closed beta; it goes live once its two migrations are applied. The ETA benchmark: the rubric's agreement, then timed trips in December. Placing the stocked banks location search can't see (#33, #34): 140 corrected positions in search, 81 waiting for review. |
| **Planned** | Reviewing the duplicate codes (#34). ETA calibration from timed trips (M5), and self-hosted OSRM. Stock-out forecasting in the app, and donor suggestions (`PLANS/ML_system.md`). The donor network: locations, requests, notifications. Hospital and blood-bank dashboards, and the admin and donor panels. Integration and end-to-end tests with CI (#20). Deployment: the ingest login, `after()` saves. |
| **Not touched** | Notification delivery of any kind. Load beyond 20 users, and on a deployed server. An expert review of the ranking weights. A blood bank's track record as a reliability score. Merging the 6 likely duplicate banks. Monthly issue data. Deployment to Vercel. |

---

## What is not done yet

- **Hospital and blood-bank roles have no tools yet.** Verified accounts get a badge but no dashboard (`PLANS/plan_panels.md`).
- **Before a public launch:** a custom email sender (`PLANS/plan_panels.md`, F8), a contact address on `/privacy`, the project guide's reading of the privacy note, and enforcing the Content-Security-Policy. All are tracked in `CLAUDE.md`.
- **ETA calibration from timed trips.** The benchmark against Google is done ([`eta_benchmark.md`](SUMMARIES/eta_benchmark.md)). Not done yet:
  - the 30 to 60 timed trips;
  - the model recalibrated on them (M5), starting with the rural free-flow speed;
  - the team's agreement of the rubric.

  Self-hosted OSRM (M7) is planned before real traffic.
- **Banks location search can't place.** On 4 November, 699 stocked banks had no coordinates (#33), and 193 that eRaktKosh puts in the wrong state or outside India were left out (#34). Region search lists them all. Since 4 November, 140 of them are placed from corrected positions (`PLANS/plan_bank_locations.md`), so location search sees 4,004 of 4,756 stocked banks; 81 more positions wait for review, and 671 banks have none yet.
- **Not built:**
  - donor matching and requests;
  - notifications;
  - stock forecasting. The history is collecting, and the walk-forward dry run of all seven models (4 November) gives an interim choice: **logistic regression, with the GBM classifier as the challenger**:
    - The GBM classifier ranks stock-outs best (PR-AUC 0.269 at 48 h, against 0.255), but its lead is inside the decision rule's 2-point margin, so the rule picks the simpler model.
    - On donor alerts the two tie: about 16% of stock-outs caught at 1 false alert per bank per week.
    - Logistic regression is the simplest to build and explain. ETS, SARIMA and TSB fall below the best baseline.
    - The December backtest decides. The models, checks, reasons and subplan are in [`ml_models.md`](SUMMARIES/ml_models.md), and the tables in `../rough_work/ML-comparison/SUMMARY.md`.

  These are planned in `PLANS/plan_donor_network.md`, `PLANS/plan_panels.md` and `PLANS/ML_system.md`, and ordered in [`plans.md`](plans.md).

---

## Not covered by any point yet

- **Notifications.** The reviewer credits "notification services" as part of the foundation, but the app sends none. The final report should list them as planned. They are designed in `PLANS/plan_donor_network.md`: in-app first, then web push and email, then SMS for critical requests only.
- **Report 1's claims.** Report 1 and its slides claim features the code lacks. Fixing them was dropped (#32), so the final report should take its counts and status from these files.
- **The donor network's legal frame** is only partly researched. Still missing: the DPDP Rules of 2025, the IT intermediary rules, liability, ethics approval for a pilot, and DLT registration for SMS.

---

## Other records

| What | Where |
|---|---|
| Known issues, with stable IDs; the history of the work | `CLAUDE.md` |
| All planned work, in order | [`plans.md`](plans.md), with the plan files in `PLANS/` |
| An independent re-check of the data (reviewer point 3) | [`data_integrity.md`](data_integrity.md) |
| Every number and outside fact, checked on 24 October | [`verify_facts.md`](verify_facts.md) |
| Every function and variable | [`CODE_REFERENCE.md`](CODE_REFERENCE.md) |
| The reviewer's points split into numbered deliverables (1.1 to 6.4), as of 31 October and 3 November | `../documentation/deliverables.md`, outside git |
| The datasets, with their validation | `../blood_data/README.md`, outside git |
| The forecast's scripts and latest results | `../rough_work/ML-comparison/SUMMARY.md`, outside git |
