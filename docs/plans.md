# Plans

All the planned work for bloodLink, in order of priority: what each item involves, where it stands, how big it is and its next step. An item with its own plan file links to it in `PLANS/`.

- Links are relative to `docs/`. Code paths are relative to `bloodlink/` unless they start with `../`. Issue numbers are the stable IDs in `CLAUDE.md`.
- Begin a plan only when asked. When one is added, finished or dropped, update this list and "Where to go next" in `CLAUDE.md`. A finished plan's file is deleted, and its record moves to `report3.md` or `features.md`.
- **How the order was set:** deadlines first (the forecast's December backtest needs unbroken history and decisions made in advance), then what blocks what, then value for effort. Sizes are rough, for one developer who knows the codebase.

**At a glance, on 3 November 2026**

| # | Item | Plan | Status | Size | Next step |
|---|---|---|---|---|---|
| 1 | [Push the work committed on 3 November](#1--push-the-work-committed-on-3-november) | — | Committed, not pushed | Minutes | Your go-ahead |
| 2 | [Finish moving collection off the laptop](#2--finish-moving-collection-off-the-laptop-35) (#35) | Done; the record is in `report3.md`, point 3.1 | Cut over; the first cloud sweep passed | Minutes, spread over a week | Delete the laptop tasks after 16:05 on 4 November |
| 3 | [Finish the move to Mumbai](#3--finish-the-move-to-mumbai-28) (#28) | — | Moved; Tokyo still running | 30 minutes | Pause Tokyo |
| 4 | [Stock-out forecasting](#4--stock-out-forecasting-reviewer-point-5) | `report3.md`, point 5 | Models chosen; an early walk-forward dry run done | Ongoing, to January | Three decisions; phase 5.1 |
| 5 | [Write to eRaktKosh's team](#5--write-to-eraktkoshs-team) | — | Not started | An hour, then a long wait | Draft the letter |
| 6 | [Route tests and CI](#6--route-tests-and-ci-20) (#20) | — | Not started | 1 to 2 days | Record the fixtures |
| 7 | [Bank locations](#7--bank-locations-33-34) (#33, #34) | [`PLANS/plan_bank_locations.md`](PLANS/plan_bank_locations.md) | Not started | 3 to 4 days | Phase 0 |
| 8 | [ETA comparison](#8--eta-comparison) | [`PLANS/plan_eta_comparison.md`](PLANS/plan_eta_comparison.md) | Not started | About a week, plus trips | Phase 0 |
| 9 | [Deployment readiness](#9--deployment-readiness) | — | Partly done | 1 to 2 days | The Vercel project |
| 10 | [Panels](#10--panels) | [`PLANS/plan_panels.md`](PLANS/plan_panels.md) | Not started | Phases A to C, about a month | Phase A |
| 11 | [Threat model](#11--threat-model) | — | Not started | Half a day | Write the page |
| 12 | [Donor network](#12--donor-network) | [`PLANS/plan_donor_network.md`](PLANS/plan_donor_network.md) | Not started | Phases 0 to 2, about a month, plus the legal review | Phase 0's prerequisites |
| 13 | [Usability study](#13--usability-study) | — | Not started | 2 to 3 days | Needs the deployed demo (9) |
| 14 | [Accessibility and language](#14--accessibility-and-language) | — | Not started | 2 to 4 days | The contrast fix |

---

## 1 · Push the work committed on 3 November

- **Where it is.** Everything since `b55dbfa` (26 October, 02:37) was committed on 3 November on `supabase-migration`, GitHub's default branch: the later fixes of 26 October (consent, the privacy page and account deletion among them), the move to Mumbai, the cloud collector and the documents. It isn't pushed, so GitHub's copy still stops at `b55dbfa`.
- **Why first.** The `collect-stock` function deployed in Supabase runs code GitHub doesn't have yet, so losing the laptop would lose its source.
- **What.** `git push`.
- **Needs:** your go-ahead.

## 2 · Finish moving collection off the laptop (#35)

- **Done on 3 November.** Supabase `pg_cron` and the `collect-stock` Edge Function in Mumbai sweep all 36 states every 4.5 hours, around the clock, and every change is archived in the Storage bucket `stock-archive`, the laptop's history included. The first cloud sweep, at 16:05, passed every check: four batches 2 minutes apart, 36 of 36 states, and all 63 changed rows archived and synced to the laptop.
- **The plan file** (`PLANS/supabase_scheduler.md`) is folded into `report3.md`, point 3.1, "Collection moved to Supabase": the design, the interval measurement, the decisions, cost and risks. How to run, change and roll it back is in `CLAUDE.md`.
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
  3. Delete Tokyo from about 10 November, since the free plan keeps no backups, then remove its callback URL from the Google Cloud console.
  4. Tidy `.env.local`: `SUPABASE_MUMBAI_PWD` is unused, and the `MUMBAI_*` lines repeat the active ones.

## 4 · Stock-out forecasting (reviewer point 5)

- **The plan** is `report3.md`, point 5, with no separate file: the question (will a bank's group of a component run out within 24, 48 or 72 h), the seven shortlisted models and why, the checks, how they are compared, the decision rule fixed in advance, the label rules, how the prediction feeds ranking and donor alerts, and phases 5.0 to 5.5 with dates. The scripts and results are in `../rough_work/ML/`, outside git; the latest summary is `../rough_work/ML/SUMMARY.md`.
- **Where it stands.**
  - Phase 5.0, choosing and rehearsing the models, was done on 26 October.
  - **An early walk-forward dry run on 3 November**, on 10.8 days of history, ran five of the seven models; ETS and SARIMA need two weeks of daily values. At 48 h the GBM classifier (PR-AUC 0.262), the hazard model (0.256) and logistic regression (0.254) are within 0.008 of each other, about 40% above the best baseline (0.183). None reaches precision 0.5 with useful recall (the best has 4.7%), so the rule falls back to PR-AUC, and its dry run picks logistic regression. At a cut-off that sends as many alerts as there are stock-outs, the best models raise about 2.3 false alerts per bank per week, against the limit of 1. It decides nothing.
- **Decisions waiting for you,** from the dry run:
  1. **Add recall at 1 false alert per bank per week** to the decision rule, next to recall at precision 0.5. The false-alert limit is what decides donor alerts. It has to be agreed before the December test weeks are collected, so within the next week or two, to keep the rule fixed in advance.
  2. **Refresh the camps download:** 180 eRaktKosh calls, one second apart, as on 23 October, so that camps in the last and next 7 days can be inputs. These calls are outside the collector.
  3. **Report each group's PR-AUC with its lift** over that group's base rate, so the Rh− groups' weakness is visible.
- **Next, by date:**
  - **November, phase 5.1:** one script that rebuilds the labels and features from the raw history, built the way `walk_forward_check.py` works (stock rebuilt at the banks' own update times, the cleared-page rule, the 6-hourly India-time grid), so the laptop's gaps and the cloud's 4.5-hour sweeps give the same rows. Unit tests pin the label rules.
  - **8 November:** Diwali, the first festival in the history.
  - **From mid-November, every 2 weeks, phase 5.2:** rerun the harness without `--until`, checking only that it runs and the numbers are sane. Add ETS and SARIMA once two weeks of daily values exist, refitted weekly. Run `npm run archive:sync` first, since the laptop's copy can be a week behind the cloud.
  - **Late December, phase 5.3:** the backtest, at about 8 weeks of history, run once, with the decision rule applied as written, and presented to the panel.
  - **January 2027, phase 5.4:** the chosen model scores every series after each sweep; ranked search reads it behind a flag, and donor alerts are logged, not sent, for 2 weeks. **2027, phase 5.5:** monthly retraining, the earlier warning (output 1b), and the deferred models.
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
- **What it involves.** Placing the up to 885 stocked banks location search can't see: 679 with no coordinates and 206 in the wrong state. Positions come from eRaktKosh's other calls, data.gov.in, Nominatim and PIN codes, and are accepted only at a measured accuracy. They live in their own table, so the weekly directory run can't overwrite them, are reviewed on an admin page, and are merged into every location search, with a before-and-after count for the report.
- **Phases 0 to 7,** 3 to 4 days, plus 2 to 4 hours of review with a teammate. 15 placements from data.gov.in are ready to load.
- **Since the plan was written,** the weekly directory run is `collectDirectory()` in `src/lib/collector.js`, run by the cloud. The supersede step goes there, and needs `node scripts/setup-cloud-collector.mjs --deploy-only` after the change.

## 8 · ETA comparison

- **Plan:** [`PLANS/plan_eta_comparison.md`](PLANS/plan_eta_comparison.md).
- **What it involves.** A rubric and test bench for travel-time methods: straight line, OSRM, OSRM with the traffic model, a calibrated version, and paid services. They are scored against timed trips, with Google's traffic-aware predictions as the reference for the week's pattern, and the result calibrates the town and rural values.
- **Phases 0 to 6.** Phases 0 to 2 (the bench, the rubric committed before any data, and the Google trend test) fit in November. The timed trips (phase 4) need two weekends and the team's cars, so late December. Google's billing tier and current terms are still to be confirmed.
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

## 13 · Usability study

- 5 to 8 participants, ideally hospital staff or medical students, on four tasks: a region search, a ranked search and reading its plan, interpreting a freshness banner, and applying as an organization.
- Measure task success, time on task and the System Usability Scale questionnaire.
- **Why:** reviewer point 4 asked for measurable results, and this adds the one kind the project lacks, from real users. Best run on the deployed demo (item 9), after the contrast fix in item 14.

## 14 · Accessibility and language

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
| 9 to 22 November | 2: the first weekly run (9 November). 3: deleting Tokyo (from 10 November). 4: phase 5.1. 6. 7. 8: phases 0 to 2 |
| From mid-November, every 2 weeks | 4: phase 5.2, with ETS and SARIMA once two weeks of daily values exist |
| 23 November to 20 December | 9. 10: phases A to C. 11. 12: phases 0 and 1. 13. 14 |
| Late December | 4: phase 5.3, the backtest. 12: phase 2, in shadow mode. 8: the timed trips |
| January 2027 | 4: phase 5.4, shadow mode. The write-up and the viva rehearsal. 12: phase 3, only with a partner centre |

## Done, for the record

- **The cloud collector** (#35), 3 November: `PLANS/supabase_scheduler.md`, carried out and folded into `report3.md`, point 3.1. Item 2 lists what's left.
- **The move to Mumbai** (#28), 3 November. Item 3 lists what's left.
- **The review of 24 October** of the code, docs and plans. Its findings #42 to #55, and #56 to #60 from the review that checked it, were fixed on 26 October (`features.md`, section 2). Of its next moves, the repository's layout, the small bugs and the region are done; the others are items 5, 6, 9, 11, 13 and 14 here, and its corrections to the plans are in the plan files.
- **Phase 5.0 of the forecast,** 26 October: the shortlist, the Malaysia rehearsal and the plumbing test.
