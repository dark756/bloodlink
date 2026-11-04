# Plans

All the planned work for bloodLink, in order of priority: what each item involves, where it stands, how big it is and its next step. An item with its own plan file links to it in `PLANS/`.

- Links are relative to `docs/`. Code paths are relative to `bloodlink/` unless they start with `../`. Issue numbers are the stable IDs in `CLAUDE.md`.
- Begin a plan only when asked. When one is added, finished or dropped, update this list and "Where to go next" in `CLAUDE.md`. A finished plan's file is deleted, and its record moves to its topic's summary in `SUMMARIES/`, or to "History" in `CLAUDE.md`.
- **How the order was set:** deadlines first (the forecast's December backtest needs unbroken history and decisions made in advance), then what blocks what, then value for effort. Sizes are rough, for one developer who knows the codebase.

**At a glance, on 4 November 2026**

| # | Item | Plan | Status | Size | Next step |
|---|---|---|---|---|---|
| 1 | [Push the work committed on 3 November](#1--push-the-work-committed-on-3-november) | — | Committed, not pushed | Minutes | Your go-ahead |
| 2 | [Finish moving collection off the laptop](#2--finish-moving-collection-off-the-laptop-35) (#35) | Done; the record is in `SUMMARIES/data_quality.md` | Cut over; the first cloud sweep passed | Minutes, spread over a week | Delete the laptop tasks after 16:05 on 4 November |
| 3 | [Finish the move to Mumbai](#3--finish-the-move-to-mumbai-28) (#28) | — | Moved; Tokyo still running | 30 minutes | Pause Tokyo |
| 4 | [Stock-out forecasting](#4--stock-out-forecasting-reviewer-point-5) | `SUMMARIES/ml_models.md` | Logistic regression adopted 4 November, predicting 2 units or fewer; phase 5.1 done | Ongoing: a comparison on more history in December | Phase 5.2 from mid-November |
| 5 | [Write to eRaktKosh's team](#5--write-to-eraktkoshs-team) | — | Not started | An hour, then a long wait | Draft the letter |
| 6 | [Route tests and CI](#6--route-tests-and-ci-20) (#20) | — | Not started | 1 to 2 days | Record the fixtures |
| 7 | [Bank locations](#7--bank-locations-33-34) (#33, #34) | [`PLANS/plan_bank_locations.md`](PLANS/plan_bank_locations.md) | In progress: 140 positions in search, 81 waiting for review | About an hour of review | You: review the 81 waiting positions on `/admin/locations` |
| 8 | [ETA comparison](#8--eta-comparison) | `docs/SUMMARIES/eta_benchmark.md` | Google and operational runs done: M3 is 24.9% off Google and wins with 65.0 of 100 | The team's hour for phase 1, then the timed trips | Purge Google's answers by 3 December |
| 9 | [Deployment readiness](#9--deployment-readiness) | — | Partly done | 1 to 2 days | The Vercel project |
| 10 | [Panels](#10--panels) | [`PLANS/plan_panels.md`](PLANS/plan_panels.md) | Not started | Phases A to C, about a month | Phase A |
| 11 | [Threat model](#11--threat-model) | — | Not started | Half a day | Write the page |
| 12 | [Donor network](#12--donor-network) | [`PLANS/plan_donor_network.md`](PLANS/plan_donor_network.md) | Not started | Phases 0 to 2, about a month, plus the legal review | Phase 0's prerequisites |
| 13 | [The ML system: forecast in the app and donor suggestions](#13--the-ml-system-forecast-in-the-app-and-donor-suggestions) | [`PLANS/ML_system.md`](PLANS/ML_system.md) | Part A live in the closed beta since 4 November. In-app suggestions to eligible donors and admins' stock-out events built, waiting for their migration | Messages, waves and partner centres with item 12 | Apply `20261105000200_admin_events.sql` |
| 14 | [Usability study](#14--usability-study) | — | Not started | 2 to 3 days | Needs the deployed demo (9) |
| 15 | [Accessibility and language](#15--accessibility-and-language) | — | Not started | 2 to 4 days | The contrast fix |

---

## 1 · Push the work committed on 3 November

- **Where it is.** Everything since `b55dbfa` (26 October, 02:37) was committed on 3 November on `supabase-migration`, GitHub's default branch: the later fixes of 26 October (consent, the privacy page and account deletion among them), the move to Mumbai, the cloud collector and the documents. It isn't pushed, so GitHub's copy still stops at `b55dbfa`.
- **Why first.** The `collect-stock` function deployed in Supabase runs code GitHub doesn't have yet, so losing the laptop would lose its source.
- **What.** `git push`.
- **Needs:** your go-ahead.

## 2 · Finish moving collection off the laptop (#35)

- **Done on 3 November.** Supabase `pg_cron` and the `collect-stock` Edge Function in Mumbai sweep all 36 states every 4.5 hours, around the clock, and every change is archived in the Storage bucket `stock-archive`, the laptop's history included. The first cloud sweep, at 16:05, passed every check: four batches 2 minutes apart, 36 of 36 states, and all 63 changed rows archived and synced to the laptop.
- **The plan file** (`PLANS/supabase_scheduler.md`) is folded into `SUMMARIES/data_quality.md`, "Collection moved to Supabase": the design, the interval measurement, the decisions, cost and risks. How to run, change and roll it back is in `CLAUDE.md`.
- **Left:**
  1. **The 24-hour watch, to 16:05 on 4 November:** the sweeps at 20:35, 01:05, 05:35, 10:05 and 14:35, each with four `collector_runs` rows of 9 states. The admin overview shows the last one.
  2. **Then delete the two laptop tasks,** by name so the sync task stays: `Unregister-ScheduledTask -TaskPath '\bloodLink\' -TaskName 'Stock snapshot (hourly)','Directory snapshot and prune (weekly)' -Confirm:$false`. Their definitions stay in `../blood_data/scripts/tasks/`.
  3. **Test the sync's catch-up once:** set its trigger a few minutes ahead, shut the laptop down across it, and check `../blood_data/eraktkosh/sync.log` about 10 minutes after signing in. This needs you at the laptop.
  4. **Check the first scheduled runs:** the sync on Sunday 8 November at 21:00 (a line in `sync.log`), and the weekly directory and prune on Monday 9 November at 03:20 (a `directory` and a `prune` row in `collector_runs`, without errors).

## 3 · Finish the move to Mumbai (#28)

- **Done on 3 November.** The project is in ap-south-1, with every table copied and checked, Google sign-in enabled, and `.env.local` pointing at Mumbai without the Tokyo lines.
- **Left:**
  1. Sign in once with Google at `/login`, to check the whole round trip.
  2. Pause the Tokyo project now. It holds nothing Mumbai lacks.
  3. Delete Tokyo from about 10 November, since the free plan keeps no backups, then remove its callback URL from the Google Cloud console and delete `scripts/copy-project.mjs`, which only the move needed.
  4. Tidy `.env.local`: `SUPABASE_MUMBAI_PWD` is unused, and the `MUMBAI_*` lines repeat the active ones.

## 4 · Stock-out forecasting (reviewer point 5)

- **The plan** is `SUMMARIES/ml_models.md`, with no separate file: the question (will a bank's group of a component run out within 24, 48 or 72 h), the seven shortlisted models and why, the checks, how they are compared, the decision rule fixed in advance, the label rules, how the prediction feeds ranking and donor alerts, and phases 5.0 to 5.5 with dates. The scripts and results are in `../rough_work/ML-comparison/`, outside git; the latest summary is `../rough_work/ML-comparison/SUMMARY.md`.
- **Where it stands.**
  - Phase 5.0, choosing and rehearsing the models, was done on 26 October.
  - **The walk-forward dry run of 4 November**, on 10.8 days of history, ran all seven models, with ETS and SARIMA in a stand-in form on 6-hour values, and tested each input and design detail in turn.
  - **Logistic regression, adopted on 4 November.** At 48 h the GBM classifier ranked best in the dry run (PR-AUC 0.269 against 0.255), but by 1.4 points, inside the rule's 2-point margin, and the two tied on donor alerts. ETS, SARIMA and TSB fell below the best baseline (0.183). Further testing on more history goes on apart from the app; a better model can replace it later through `model_versions`.
- **Decided on 4 November:**
  1. **The model is logistic regression,** as above. The December comparison doesn't gate it.
  2. **Each group's PR-AUC is reported with its lift** over that group's base rate, in training and in the daily metrics, so the Rh− groups' weakness is visible.
  3. **It predicts low stock, not only stock-outs:** a group falling to 2 units or fewer. At 48 h that catches 22.6% of falls within the alert budget, against 15.2% for stock-outs (`PLANS/ML_system.md`, A1 and S13). Collection gaps aren't censored in the labels (S14).
- **Camps are left out.** Checked on 4 November with the data already on disk, before any download: they don't show up in red-cell stock, so no camps download is needed.
- **Next, by date:**
  - **Phase 5.1, done on 4 November:** `ml/dataset.py` rebuilds the labels and the 19 inputs from the raw history the way `walk_forward_check.py` works: stock rebuilt at the banks' own update times, the cleared-page rule, and the 6-hourly India-time grid. So the laptop's gaps and the cloud's 4.5-hour sweeps give the same rows. Its inputs are exactly `src/lib/stockoutFeatures.js`'s. 16 unit tests pin the label rules and inputs, and the parity test checks them against the JS on a real week.
  - **8 November:** Diwali, the first festival in the history.
  - **From mid-November, every 2 weeks, phase 5.2:** rerun the harness without `--until`, checking only that it runs and the numbers are sane. Switch ETS and SARIMA to daily values with a weekly season once two weeks exist, refitted weekly. Run `npm run archive:sync` first, since the laptop's copy can be a week behind the cloud.
  - **Late December, phase 5.3:** the seven models compared again at about 8 weeks of history, on unseen weeks, at the same threshold, and presented to the panel. A better model replaces logistic regression through `model_versions`.
  - **Phase 5.4, brought forward to 4 November:** the model scores every series at each 6-hourly grid time in the closed beta, with no shadow period; item 13 has the details. **2027, phase 5.5:** monthly retraining, the earlier warning (output 1b), and the deferred models.
- **Depends on** unbroken collection (item 2). The monthly issue data asked for in item 5 would raise every model's ceiling.

## 5 · Write to eRaktKosh's team

- **What.** One letter from the department to the eRaktKosh team at NBTC or MoHFW:
  - report the 206 wrong-state and 2 outside-India banks, with the evidence in `data_integrity.md`;
  - ask for access to the `MonthlyCollection` stock and issue reports, which hold real demand and need a blood-bank login.
- **Why early.** A fix at the source helps every eRaktKosh user, and bloodLink's weekly directory run would then supersede its own fixes (`PLANS/plan_bank_locations.md`, decision L6). A reply takes time. No record shows it was sent.
- **Needs** the project guide or the department to send it.

## 6 · Route tests and CI (#20)

- Record one real `nearest` and `blood-availability` answer each for Mumbai, central Delhi and Saifai into `tests/fixtures/`. That is a handful of eRaktKosh calls, done once.
- Test `/api/blood-search` with `vi.mock("@/lib/eraktkosh")` serving them: ring choice, the misplaced count, exact-group filtering, the plan, the saved-copy mode and the 400s. It is the app's most complex route, and it has no tests.
- Add a GitHub Actions job: `npm ci`, lint, the format check, the tests and a build with placeholder public variables. It needs no secrets.
- Later, an end-to-end suite against a local or staging Supabase project, never production.

## 7 · Bank locations (#33, #34)

- **Plan:** [`PLANS/plan_bank_locations.md`](PLANS/plan_bank_locations.md).
- **What it involves.** Placing the 892 stocked banks location search can't see (4 November): 699 with no coordinates, and 193 in the wrong state or outside India. Positions come from data.gov.in, Nominatim and PIN codes, and are accepted only at a measured accuracy. They live in their own table, so the weekly directory run can't overwrite them, are reviewed on an admin page, and are merged into every location search, with a before-and-after count for the report.
- **Done on 4 November** (the plan's "Progress" section has the detail):
  - the fixes table, applied, with 221 positions loaded;
  - `scripts/place-banks.mjs`, with its control and target runs;
  - the search merge, behind `BANK_LOCATION_FIXES`;
  - `/admin/locations`;
  - the supersede step in `collectDirectory()`, deployed to the cloud collector.
- **Where it stands:**
  - 140 positions are in search: 15 from data.gov.in, 115 by name and 10 by address.
  - Location search sees 4,004 of 4,756 stocked banks, up from 3,864.
  - In the control run, the name match was accurate when right (median 40 m), but 2 of its 53 positions were same-named hospitals more than 10 km away.
- **Left:**
  1. Review the 81 waiting positions on `/admin/locations` with a teammate (about an hour).
  2. Check the weekly directory run on Monday 9 November.
  3. Measure again after the review with `node scripts/location-coverage.mjs --snapshot <baseline snapshot> --placements db`.

## 8 · ETA comparison

- **The benchmark:** `docs/SUMMARIES/eta_benchmark.md`. **The steps left, with dates:** `docs/SUMMARIES/eta_benchmark.md`, "The plan to finish it". **The summary:** [`SUMMARIES/eta_benchmark.md`](SUMMARIES/eta_benchmark.md).
- **What it involves.** A rubric and test bench for travel-time methods: straight line, OSRM, OSRM with the traffic model, a calibrated version, and paid services. They are scored against timed trips, with Google's traffic-aware predictions as the reference for the week's pattern, and the result calibrates the town and rural values.
- **Phases 0 to 6.** Phases 0, 2 and 3 (the bench, and the Google run with the trend test) are done, and phase 1 (the rubric) waits for the team. The timed trips (phase 4) need two weekends and the team's cars, so late December. Google's free cap is confirmed at 5,000 elements a month; whether the guide read Google's current terms isn't recorded.
- **Phase 0 is built** (3 November): `../rough_work/eta_benchmarks/eta-bench.mjs` and `../rough_work/eta_benchmarks/eta-methods.mjs`, with `src/lib/trafficModel.js`, `etaMetrics.js` and `etaRubric.js`. In the dry run on the 52 saved captures, M3 reproduced 246 of its 250 captured ETAs exactly, and the trend test scored M3 1 and the time-blind methods 0, as built.
- **Google is the benchmark** (4 November): `../rough_work/eta_benchmarks/eta-sample.mjs` picked 40 hospital-to-bank pairs, 10 per zone (metro, city, town, rural) across 8 or 9 states each, timed every 2 hours on all 7 days of the week of 9 November, plus the saved candidate sets at three Wednesday times. That is 4,107 elements, within the 5,000 free a month, and `../rough_work/eta_benchmarks/eta-google.mjs` refuses to pass 95% of the cap. The dry run with M3 standing in for Google passed.
- **The Google run, 4 November:** 4,107 elements, free. Against Google, today's model (M3) is 24.9% off on average (metro 20%, city 23.5%, town 28%, rural 28% and 28% too quick), against 32.8% to 47% for the other methods. It picks Google's first bank in 81% of searches, and follows Google's week closely in the metros. Rural base speed is the weak spot.
- **The operational run, 4 November:** 200 uncached calls to the public OSRM server, all answered, p95 217 ms. On the rubric, M3 scores 65.0 of 100, M1 56.3, M0 55.0 and M2 45.0, so the app keeps M3. The lead holds with each weight moved by ±20%.
- **Next,** from the completion plan:
  - the key's quota and budget alert, and the guide's reading of Google's terms, by 8 November;
  - the rubric agreed, by 13 November;
  - `--rescore`, then the purge, on 30 November (deadline 3 December);
  - the tools for the timed trips, by 4 December;
  - the trips themselves, 12 to 20 December;
  - M5 and the decision, by 11 January 2027.
- **Phase 1 needs the team:** confirm the benchmark's "How the bench reads the rubric" and the judged scores, and agree the rules for the timed trips (step 2 of the completion plan). Then set `RUBRIC_AGREED_ON` and commit. The Google results were seen first, so record that the rubric is unchanged since, or mark any change as made after them.
- Self-host OSRM (Docker, Geofabrik's India extract) before real traffic.

## 9 · Deployment readiness

- **Done:** the security headers (#51), `.env.example`, pages that don't wait on a profile query (#49), place names fetched through the server with a cache, and the database region (Mumbai, #28).
- **Left:**
  - the Vercel project in its Mumbai region (`bom1`), next to the database, with the environment variables;
  - `error.js` and `not-found.js`, so a crash shows a helpful page with the emergency advice rather than a blank one;
  - `/api/health`, reporting eRaktKosh's circuit state, the saved copy's age and the last sweep in `collector_runs`, for an uptime monitor and the viva demo;
  - `engines` in `package.json`: Next 16 needs Node 20.9 or later, and the scripts use `process.loadEnvFile`;
  - custom SMTP (`PLANS/plan_panels.md`, F8), `NEXT_PUBLIC_CONTACT_EMAIL`, the project guide's reading of `/privacy`, and the Content-Security-Policy enforced once it reports nothing;
  - a hosted or self-hosted geocoder before a public launch: Nominatim allows geocoding triggered by users only while their number is moderate;
  - a PWA before any native app.

## 10 · Panels

- **Plan:** [`PLANS/plan_panels.md`](PLANS/plan_panels.md).
- **What it involves.** What the admin, blood-bank, hospital and donor panels could do, each feature marked Must, Should or Could, and the foundation they share (F1 to F8): organization members, an organization profile with a confirmed location, a verified eRaktKosh link, a panel shell, a notifications inbox, two-factor sign-in, private document storage, and a custom email sender (#27, moved there).
- **Roadmap in six phases.** A, the foundation (1.5 weeks); B, banks see themselves (1 week); C, hospitals act (1.5 weeks). Those three, about a month, are a credible "completed" set for the next review. D is the donor network (item 12), and E and F are "planned".
- **Notes.** `/admin/locations` is the same page as item 7's review page, so build it once. The "collector alerts" feature can read `collector_runs`, which exists now. Account deletion is already self-service on `/account`, with an audit row; the plan's privacy-request queue is only for data exports.

## 11 · Threat model

- One page:
  - **assets:** health answers, donor areas, roles, the database password and the archive's secret key;
  - **who might attack:** curious users, fake requesters, scrapers, a leaked key;
  - **controls in place:** row-level security, `security definer` functions, the rate limit, no secret key in the app, and the collector's secret and repeat guard;
  - **gaps:** two-factor sign-in (item 10, F6) and the scripts' certificate checks (#29).
- **Why before the donor network:** its legal and safety review starts from it, and reviewers value it.

## 12 · Donor network

- **Plan:** [`PLANS/plan_donor_network.md`](PLANS/plan_donor_network.md).
- **What it involves.** Requests anchored to a licensed blood centre; consent and approximate donor areas; matching in the database in waves; notifications in-app first and by SMS last; privacy and abuse safeguards; and simulation and shadow mode before a pilot.
- **Rollout in six phases.** For the final review, phases 0 to 2 are realistic: the prerequisites, donors only, then requests matched in shadow mode without messaging anyone. That is about a month, plus the legal review. Phase 3, a live pilot, only with a partner blood centre.
- **Needs:** from the panels plan, F1 (members), F6 (two-factor) and F8 (the email sender); a partner blood centre and hospital; the project guide's sign-off on the legal frame. Its cloud jobs reuse the collector's pattern (below).

## 13 · The ML system: forecast in the app and donor suggestions

- **Plan:** [`PLANS/ML_system.md`](PLANS/ML_system.md). One ML model, the forecast, which says where and when blood will run short; donor suggestions and admin-made events act on it.
- **Part A, the forecast in the app:**
  - the model the December backtest picks (interim: logistic regression), trained in Python from an `ml/` folder in the repository and exported as JSON;
  - scored at each 6-hourly grid time by an Edge Function on the collector's pattern, with a parity test between the Python and JS inputs;
  - calibrated and given its alert cut-off daily, with a kill switch on drift;
  - shown behind flags: a "may run out soon" mark, then the (1 − P) factor in ranking.
- **Part B, donor suggestions:**
  - a forecast appeal at a partner centre that opts in and approves each one;
  - sent only to people who opted in, were active recently and are eligible today. Eligibility covers the date gap, no staff check pending, screening answers confirmed within 90 days and age on the day, and is checked three times;
  - only to people nearby and rested;
  - ranked by the donor network's score, from each person's own record of answering and turning up. A trained model of who comes was left out: at the pilot's size, most appeals have fewer people who pass the rules than one wave asks.
- **Part C, events an admin makes** on `/admin/events`:
  - a drill, at any bank, reaches only test accounts and says "Drill", for demonstrations and end-to-end checks;
  - a manual appeal, for a shortage the forecast missed, reaches real people only at a partner centre that approves it;
  - neither is ever shown as the forecast, and both are audited.
- **Phases 0 to 5.**
  - 0 to 3, Part A, were built on 4 November for the closed beta, with shadow mode skipped at the project's request, since the beta isn't public.
  - Drills of the mark (Part C) wait for test accounts and `/admin/events`; manual appeals need a partner centre.
  - 4 and 5, the suggestions, need item 12's phases 2 and 3 and a partner centre.
- **Needs:** item 12 (consent, donor areas, `donor_status` and its eligibility parity test, the outbox); item 10's F1, F3, F5, F6 and F8; the project guide's sign-off on proactive suggestions.
- **Part A in the beta** (4 November; the plan's "Part A in the beta" has the details):
  - the model: `ml/dataset.py`, the Python twin of the inputs and labels, and `ml/train.py`, which trained `stockout-logit-t2-2026-11-04`. At 48 h, walking forward, it scores PR-AUC 0.348 and catches 22.6% of falls to 2 units at 1 false alert per bank per week. Its model card is `ml/MODEL_CARDS.md`, and the parity test passes on a real week;
  - in the cloud: the `score-stock` Edge Function, with `src/lib/forecastJobs.js`, scoring every 6 hours, and the daily labels, Platt scaling, cut-off, metrics, kill switch and prune. The two migrations, `20261104000100_stockout_forecast.sql` and `20261104000200_forecast_live.sql`, and `scripts/setup-forecast.mjs` set it up. A rolled-back dry run on the live project passed (`scripts/check-forecast-live.mjs`);
  - in the app: the "may run low within 48 h" and "low now" marks and the ranking factor in ranked location search, and the admin overview's card with the flags' switches;
  - live since 4 November: the two forecast migrations applied, `score-stock` scoring every 6 hours, the mark and the ranking factor on;
  - built since: suggestions on "My profile" for a complete donor profile eligible today, within 15 km or in their district (behind `forecast_appeals`); admins' stock-out events on `/admin/events`, real, for 24, 48 or 72 hours, ending by themselves or with "End now" (behind `admin_events`); the marks in region search; and the sensitivity check rerun with the ranking factor (it moves the first choice in 8% of urgent and 17% of routine searches);
  - left: apply `20261105000200_admin_events.sql` (`npm run db:migrate`, after `node scripts/check-admin-events.mjs`), then turn on the two flags; decide whether the ranking factor stays at full strength.

## 14 · Usability study

- 5 to 8 participants, ideally hospital staff or medical students, on four tasks: a region search, a ranked search and reading its plan, interpreting a freshness banner, and applying as an organization.
- Measure task success, time on task and the System Usability Scale questionnaire.
- **Why:** reviewer point 4 asked for measurable results, and this adds the one kind the project lacks, from real users. Best run on the deployed demo (item 9), after the contrast fix in item 15.

## 15 · Accessibility and language

- **Contrast:** the `#999` credit line on the search page (`src/app/search/page.js`) is 2.8:1 on white, under WCAG AA's 4.5:1. A minute's fix; do it before the study.
- **Map and keyboard:** the map works only by clicking or tapping. Add a place-search box with a search button as the alternative; Nominatim allows a search the user submits, not autocomplete as they type.
- **Hindi:** the search page first, then one regional language for the pilot city. Emergency users shouldn't need English.
- **A low-end phone on a slow network:** test with throttling, since the map tiles and Leaflet dominate the page weight.

---

## Across the plans

- **One pattern for cloud jobs,** built for the collector in `supabase/migrations/20261103000100_cloud_collector.sql`: a `pg_cron` tick with a due check, the function's URL and secret in Vault, one no-login role per job (`bloodlink_ingest` now, `bloodlink_notifier` for the donor network), and a row per run that the admin overview reads. Items 7 and 12 reuse it.
- **After any change to `src/lib/collector.js` or the function,** redeploy with `node scripts/setup-cloud-collector.mjs --deploy-only`. The cloud runs the deployed copy, not the working tree.
- **New migrations** must sort after `20261103000100`.
- **Small open issues tied to no plan:** #29 (the scripts' certificate checks) and #61 (foreign-key indexes), in `CLAUDE.md`.
- **Together this is more than a semester's work** for a small team, hence the order and the dates below.

## Dates

| When | Work |
|---|---|
| This week, to 8 November | 1. 2: the watch, then deleting the laptop tasks on 4 November. 3: pausing Tokyo. 4: the three decisions. 5: the letter |
| 9 to 22 November | 2: the first weekly run (9 November). 3: deleting Tokyo (from 10 November). 4: phase 5.1. 13: phase 0 begins. 6. 7. 8: phases 0 to 2 |
| From mid-November, every 2 weeks | 4: phase 5.2, with ETS and SARIMA once two weeks of daily values exist |
| 23 November to 20 December | 9. 10: phases A to C. 11. 12: phases 0 and 1. 13: phase 0. 14. 15 |
| Late December | 4: phase 5.3, the backtest, which is 13's phase 1. 12: phase 2, in shadow mode. 8: the timed trips |
| January 2027 | 4: phase 5.4, shadow mode, which is 13's phase 2. The write-up and the viva rehearsal. 12: phase 3, only with a partner centre |
| February 2027 onward | 13: phase 3, the forecast shown; then phases 4 to 6, the suggestions, with 12's phases 2 and 3 |

## Done, for the record

- **The cloud collector** (#35), 3 November: `PLANS/supabase_scheduler.md`, carried out and folded into `SUMMARIES/data_quality.md`. Item 2 lists what's left.
- **The move to Mumbai** (#28), 3 November. Item 3 lists what's left.
- **The review of 24 October** of the code, docs and plans. Its findings #42 to #55, and #56 to #60 from the review that checked it, were fixed on 26 October (`CLAUDE.md`, "History", "Bug fixes"). Of its next moves, the repository's layout, the small bugs and the region are done; the others are items 5, 6, 9, 11, 14 and 15 here, and its corrections to the plans are in the plan files.
- **Phase 5.0 of the forecast,** 26 October: the shortlist, the Malaysia rehearsal and the plumbing test.
