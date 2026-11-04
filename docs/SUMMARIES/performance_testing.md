# Summary: testing and performance

*As of 4 November 2026. The full record follows the summary: [the unit tests in full](#the-feature-in-full), then [report 3's record](#report-3s-record) of point 4 (test levels and results). Point 3.1's failure drill is in [`data_quality.md`](data_quality.md#results). The measurements are in `../blood_data/measurements/`, outside git.*

**What was asked** (reviewer point 4): "The final evaluation would be stronger with measurable results covering functional testing, search/API response time, load testing, notification performance, and failure scenarios."

**The answer in brief.** Everything that is built has been measured, apart from heavier load:
- **248 unit tests** pass, plus the forecast's 16 Python tests and the ETA benchmark's 46;
- **searches answer in milliseconds** once warm, and within about 1.5 s on a first call to eRaktKosh;
- **20 users at once** cause no failures;
- **every failure mode drilled still answered** with results.

Integration and end-to-end suites with CI are planned (#20). Notifications aren't built, so their tests are designed but not run.

## At a glance

| Area | Status | Result |
|---|---|---|
| Unit tests | **Done** | 248 tests in 18 files, all passing (4 November), plus the forecast's 16 Python tests in `ml/tests/` and the ETA benchmark's 46 in `../rough_work/eta_benchmarks/` |
| Integration tests of the API routes | **Planned** (#20) | The eRaktKosh client can already be swapped for a fake |
| End-to-end tests | **Partly done** | 47 checks ran once, on 23 October, but aren't kept. A Playwright suite is planned (#20) |
| Security | **Done by hand** | The publishable key reads only public tables. Writes and private tables return 42501. An automated suite is planned |
| Search and API response time | **Done** (23 October) | Below |
| Load | **Done** at 20 users at once | 0 of 560 requests failed |
| Page load | **Done** (26 October) | Median 7.7 to 11.0 ms for `/`, `/privacy` and `/search`, signed out |
| Failure scenarios | **Done** (drill on 23 October, re-run on 24 October) | Every search answered |
| Road routing | **Done** (4 November) | 200 of 200 uncached OSRM calls succeeded, p95 217 ms |
| Database round trip | **Done** (3 November) | About 10 ms from the laptop to Mumbai, against 175 ms to Tokyo |
| Geospatial search | **Done** | [`geospatial_benchmark.md`](geospatial_benchmark.md) |
| Ranking weights | **Done** | [`ranking_algorithm.md`](ranking_algorithm.md), "How the weights hold up" |
| ETA accuracy | **Google half done;** timed trips planned | [`eta_benchmark.md`](eta_benchmark.md) |
| Notification performance | **Planned,** with the feature | Designed below |
| Automatic runs (CI) | **Planned** (#20) | |
| Heavier load, and a deployed server | **Not touched** | |

## Unit tests

Vitest. `npm test` runs 248 tests, all passing on 4 November. Lint, the format check and the production build pass too.

| File | Tests | Covers |
|---|---|---|
| `stockout-model.test.js` | 28 | The stock-out forecast's scorer: the artifact's checks, scoring with reasons, Platt calibration and average precision matching scikit-learn, the alert cut-off, the metrics, the kill switch, the shadow exit and the overdue rule |
| `stock-eligibility-profile.test.js` | 22 | Stock parsing, donor eligibility to NBTC's 2017 rules, the profile validator |
| `eraktkosh-client.test.js` | 21 | Every step of the fallback chain, the per-state circuits, the saved copy |
| `ranking.test.js` | 20 | Scores, weights and the response plan |
| `bank-locations.test.js` | 20 | Corrected bank positions in location search (moving, adding, the radius, which position wins, the switch), and the placement script's helpers: names, distinctive words, PIN codes, addresses, result tests, centroid traps and the acceptance rule |
| `traffic.test.js` | 19 | Zones, rush hour, weekday against Sunday, monsoon, rain, the fallback |
| `stockout-features.test.js` | 19 | The stock-out forecast's 19 inputs and its label rules: horizons, the low-stock threshold, quick refills, cleared pages, the Bombay groups, the end of the data and gaps |
| `collector.test.js` | 19 | The cloud collector: changed rows, failed and rolled-back states, its time budget, the four batches, the directory run, the auto-refresh list and the superseding of location fixes, run records and the secret |
| `compatibility.test.js` | 13 | Donor-recipient compatibility per component |
| `routing.test.js` | 11 | OSRM, Open-Meteo and Nominatim parsing, caching and failures |
| `forecast-jobs.test.js` | 10 | The forecast's scoring and daily jobs on the parity week: the same cases and probabilities as scikit-learn through the history query's window, the daily calibration, labels, metrics and kill switch, skipped and failed runs |
| `stock-quality.test.js` | 10 | Every validation rule |
| `state-bounds.test.js` | 7 | The wrong-state check |
| `stockout-parity.test.js` | 6 | The forecast's parity test on a real week (`tests/fixtures/stockout_week.json`): the same cases, inputs and labels as `ml/dataset.py`, and scikit-learn's probabilities to 6 decimal places |
| `rings.test.js` | 6 | Ring choice, with dormant banks ignored |
| `forecast-marks.test.js` | 8 | The forecast in search: what is forecast, reading `forecast_marks()`, the marks, the ranking factor, admins' events, who may see suggestions, and their order |
| `auth.test.js` | 5 | Safe redirect paths |
| `rate-limit.test.js` | 4 | Per-IP limits and trusted proxies |

The ETA benchmark's own tests moved with it on 4 November: `eta-metrics.test.js` (24), `eta-rubric.test.js` (12) and `eta-google.test.js` (10), 46 in all, in `../rough_work/eta_benchmarks/tests/`. Run them there with `npx vitest run`.

The forecast's Python side has 16 tests in `ml/tests/`, run with `python -I -m pytest ml/tests`: the dataset builder on the JS tests' cases and the threshold, the cut-off, Platt scaling, and the artifact scoring as scikit-learn does.

## Response time and load

`npm run measure`, against a production build on the project laptop, with eRaktKosh live, on 23 October:

| Scenario | First request after start | Then: median, p95 (10 runs) | 20 users at once: median, p95 (100 requests) |
|---|---|---|---|
| Region, Goa (5 banks) | 368 ms, live | 4 ms, 5 ms | 17 ms, 30 ms |
| Region, Uttar Pradesh (678 banks) | 8,038 ms, saved copy (eRaktKosh took about 12 s) | 13 ms, 4,387 ms (one request joined a call in flight) | 77 ms, 143 ms |
| Location, Mumbai, red cells | 1,429 ms, live | 4 ms, 8 ms | 21 ms, 40 ms |
| Ranked, Mumbai, O− × 3, critical | 541 ms | 2 ms, 4 ms | 17 ms, 33 ms |
| Ranked, rural Barmer, O+ × 2, urgent | 690 ms, live | 2 ms, 5 ms | 15 ms, 28 ms |

- **None of 560 requests failed:** 55 one after another and 505 at once.
- **The slowest first search is eRaktKosh's,** not bloodLink's. Uttar Pradesh takes about 12 s at source, so the app serves its saved copy after 8 s.

## Failure scenarios

Each mode was run on a fresh production server with `ERAKTKOSH_SIMULATE`. Every search answered with HTTP 200 and results.

| Mode | Result |
|---|---|
| eRaktKosh **down** | Answered from the saved copy in 0.35 to 4.6 s. The Mumbai ranked plan still covered 3 of 3 units |
| eRaktKosh **slow** (+12 s a call) | The saved copy arrived after the 8-second give-up: 8 to 11 s |
| **Flaky** (half the calls fail) | The retry hid every failure: 0.3 to 1.7 s, live |
| **One state blocked** (Maharashtra) | Mumbai came from the saved copy; Goa, Tamil Nadu and Gujarat stayed live |
| **OSRM down** | Every bank fell back to a straight-line estimate; the search still answered |

The re-run on 24 October found two faults the first drill missed, and both were fixed:
- **#37:** the saved copy could count the wrong component;
- **#38:** one failing state opened a circuit shared by every state.

## Notification performance (designed, not run)

The app sends no notifications yet. These are the tests for when it does (`../PLANS/plan_donor_network.md`):

| Measure | How | Target |
|---|---|---|
| Time from request to delivery, per channel | Timestamps when queued, sent and delivered | In-app under 2 s; SMS under 30 s, at the 95th percentile |
| Throughput | 10,000 messages against a fake provider, then the providers' test modes | 10,000 within 5 minutes |
| Failure handling | The provider errors or times out | Retried with back-off, never sent twice, logged |
| Correctness | Unit tests on who is told | Only eligible donors; nobody asked again within the cooldown; opt-outs respected |

## What is left

- **Integration tests** (#20): each API route with eRaktKosh faked, covering:
  - nearest, ranked and saved-copy modes;
  - the 400s for bad input and the 429 after 20 requests;
  - the freshness block.
- **End-to-end tests** (#20): Playwright against a local Supabase with seeded users, covering the three searches, sign-in, the profile form, an organisation application and admin approval.
- **CI** (#20): lint, the format check, the tests and the build on every push.
- **Heavier load, and a deployed server** (not touched). Everything so far ran on one laptop. A deployed server has cold starts and a cache per instance. A large load test also needs self-hosted OSRM, because the public server takes one request a second.
- **Notification tests,** with the donor network.

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Unit tests
Files: `tests/`

There are 248 Vitest tests. Run them with `npm test`.
- `ranking.test.js` (20 tests): the weights, each score, exact-group matching, the worked scenarios, urgency changing the first choice, and the response plan.
- `eraktkosh-client.test.js` (21 tests): the eRaktKosh client's cache, saved copy, retries, per-state and service-wide circuits, freshness summary with stock and directory ages kept apart, shared calls, and the pin rounded to 3 decimals.
- `traffic.test.js` (19 tests): the travel-time model. It covers India time, traffic zones, congestion by time, day, season and density, rain, the travel estimate, and that the model scripts load gives the app's answers.
- `stock-eligibility-profile.test.js` (22 tests): stock parsing, components matched by name only, cutting saved rows to one component, the district an eRaktKosh address names, eligibility with NBTC's 2017 limits, and profile and organization validation, including real calendar dates and India's "today".
- `compatibility.test.js` (13 tests): the rules for each component, Rh, and Bombay blood.
- `stock-quality.test.js` (10 tests): the eRaktKosh row validator: group names, row checks and dormant stock.
- `routing.test.js` (11 tests): OSRM route parsing and requests, Open-Meteo rain, and Nominatim place names with their cache.
- `state-bounds.test.js` (7 tests): whether a bank lies in its own state, the border margin, and points that are missing or outside India.
- `rings.test.js` (6 tests): ring choice in both modes, with dormant banks never deciding it.
- `rate-limit.test.js` (4 tests): `X-Forwarded-For` is trusted only behind configured proxies.
- `auth.test.js` (5 tests): sign-in redirects stay on the site, and the admin routes' database errors map to the right HTTP status.
- `eta-metrics.test.js` (24 tests), `eta-rubric.test.js` (12 tests) and `eta-google.test.js` (10 tests): the ETA benchmark's error, ranking and week-trend measures and its statistics; the rubric's anchors and decision rule; and the Google client's requests, answers, cache and free-allowance guard. They moved with the benchmark to `../rough_work/eta_benchmarks/tests/` on 4 November, and run there with `npx vitest run`.
- `collector.test.js` (19 tests): the shared collector. Changed rows are uploaded in full and the rest only re-stamped; a failed state is logged, or rolled back unarchived, and the batch goes on; the time budget skips what it can't start; the four batches cover the 36 states once; the directory flags wrong-state banks; the auto-refresh list is saved after the directory, and last week's values are kept when the list fails or is empty; a machine location fix is superseded once eRaktKosh's own point is within 2 km, one further away is logged, and nothing happens before the fixes table exists; the repeat guard; the function's secret and request checks; and the overdue warning.
- `bank-locations.test.js` (20 tests): corrected bank positions. A wrong-state bank is moved and a missing one added within the radius; eRaktKosh's usable point beats a machine fix, and a confirmed fix beats it; unusable rows are dropped; the switch. And the placement script's helpers: search names, distinctive words, PIN codes, address cleaning and parts, Nominatim result tests, the viewbox, centroid traps, the accuracy statistics and the acceptance rule.
- `stockout-features.test.js` (19 tests): the stock-out forecast's inputs. The grid, the series rebuild, the cleared-page rule, the 19 inputs on a hand-worked series, the low-stock threshold, the Bombay groups in the bank's totals, the label rules (horizons, quick refills, cleared pages, the end of the data and gaps) and `findGaps`.
- `stockout-parity.test.js` (6 tests): the forecast's parity test on a real week (`tests/fixtures/stockout_week.json`): the same cases, inputs and labels as `ml/dataset.py`, and scikit-learn's probabilities to 6 decimal places.
- `forecast-jobs.test.js` (10 tests): the forecast's scoring and daily jobs on the parity week: the same cases and probabilities as scikit-learn through the history query's window, the daily calibration, labels, metrics and kill switch, and skipped and failed runs.
- `forecast-marks.test.js` (8 tests): the forecast in search: what is forecast, reading `forecast_marks()`, the marks, the ranking factor, admins' events, who may see suggestions, and their order.
- `stockout-model.test.js` (28 tests): the stock-out forecast's scorer. The artifact's checks and scoring, the reasons, parity with scikit-learn (Platt to 6 decimal places, average precision to 12), the cut-off at 1 false alert per bank per week, the metrics, the kill switch, the shadow exit and the overdue rule.

Separately, a one-off script ran 47 end-to-end checks against the live database. It is not kept in the repo.

## Report 3's record

### Point 4: how testing and performance measurement are done

> *Request:* include a section on how testing can be done, as in point 4 of the suggestions. The reviewer asked for measurable results covering functional testing, search and API response time, load testing, notification performance and failure scenarios.

#### Plan

1. **Lay out the test levels:** unit, integration, end-to-end, security, performance and failure. For each, say what exists today, how to run it, and what to add.
2. **Measure what can be measured now,** so the section has numbers rather than only methods:
   - response time and load: done in 3.1;
   - the failure drill: done in 3.1;
   - **a geospatial benchmark** (new, the reviewer's point 2): linear scan, the ring search, a grid, a k-d tree, an R-tree and PostGIS GiST, at 4,328 real banks and synthetic sets up to 500,000. It measures time, candidates evaluated and build cost, and checks that every method returns the same banks;
   - **ranking sensitivity** (new, the reviewer's point 1): change each weight by ±20% and measure how stable the top choice and the order stay.
3. **Define tests for parts not yet built:** notifications, and ETA accuracy against timed trips.

#### Test levels

| Level | What it proves | Tool | Status today | How to run | What to add |
|---|---|---|---|---|---|
| **Unit** | Each pure module gives the right answer, including edge cases | Vitest | **125 tests, all passing.** By file: ranking 20, eRaktKosh client 19, stock and profile 17, traffic 16, compatibility 13, stock quality 10, routing 8, state bounds 7, rings 6, auth 5, rate limit 4 | `npm test` | Keep one test per bug fixed |
| **Integration (API routes)** | A route turns a request into the right response, status code and headers | Vitest, calling the route's `GET(new Request(url))` with `vi.mock("@/lib/eraktkosh")` returning fixed rows | Not yet. The client is injectable (`createEraktkoshClient`), so it is ready to mock | `npm test` | `/api/blood-search` in nearest, ranked and saved-copy modes; 400s for bad input; 429 after 20 requests; the `freshness` block |
| **End-to-end** | Real user journeys in a browser | Playwright against `next start`, with a **local** Supabase (`supabase start`, then `npm run db:migrate` on it) and seeded users | A one-off script ran 47 checks on 2026-10-23 but isn't kept, because it wrote to the live project (#20) | `npx playwright test` | Search by region, location and ranked; sign-up and sign-in; the profile form; apply as an organisation; admin approval |
| **Security** | Row-level security and grants refuse what they should | `curl` or supabase-js with the publishable key, and with a signed-in non-admin | Checked by hand for every table, with results in 3.1 and the earlier 47 checks | `CLAUDE.md` › Verifying changes | Make it a suite against local Supabase, run in CI |
| **Performance** | Response time, load and the scalability of spatial search | `npm run measure`, `scripts/benchmark-geo.mjs`, `scripts/ranking-sensitivity.mjs` | **Measured**; results below | Below. Start the server with `TRUSTED_PROXY_HOPS=1`, so each simulated user gets its own rate limit | A nightly smoke run that warns if the 95th percentile rises by 50% |
| **Failure** | Each eRaktKosh failure still gives a usable answer | `ERAKTKOSH_SIMULATE`, `ERAKTKOSH_SIMULATE_STATES` | **Drilled in all four modes**; see 3.1. Re-run on 24 October after fixes #37 and #38 | 3.1 › Failure drill | Run it before every demo |
| **Data quality** | Incoming data still fits the rules | `blood_data/scripts/validate_*.py`; the `quality` counts in `upstream_calls` | Run on 2026-10-23 and re-checked on 24 October; see 3.2 and `docs/data_integrity.md` | `python -I blood_data/scripts/validate_history.py blood_data` | A weekly run that warns on new label spellings or below 95% success |
| **CI** | Nothing merges broken | GitHub Actions | Not yet (#20) | — | Lint, format check, test and build on every push |

#### Results

**Response time and load**, production build, eRaktKosh live, from 3.1:
- Warm searches answer in 2 to 14 ms at the median.
- With 20 simultaneous users, the 95th percentile stays at 143 ms or below.
- None of 560 requests failed.
- The slowest cold search is Uttar Pradesh: 8.0 s, served from the saved copy because eRaktKosh itself takes about 12 s for that state.
- The full tables are in 3.1, and the raw files in `blood_data/measurements/response_times/`.

**Failure scenarios**, from 3.1:
- With eRaktKosh down, slow, flaky, or with one state blocked, every search still returned results.
- When down, answers came from the saved copy in 0.35 to 4.6 s.
- When slow, the saved copy arrived after the 8-second give-up, and location search took 11 s.
- The raw files are in `blood_data/measurements/failure_drill/`.

#### Tests to add for parts not built yet

**Notifications** (planned: in-app, then email, then SMS):

| Measure | How | Target |
|---|---|---|
| Time from request to delivery, per channel | Timestamps when queued, sent and delivered (provider webhook) | In-app under 2 s; SMS under 30 s at the 95th percentile |
| Throughput | Queue 10,000 messages against a fake provider, then the providers' test modes (MSG91 and Twilio test credentials) | 10,000 within 5 minutes |
| Failure handling | Make the provider return 500s or time out | Retried with back-off, never sent twice, failures logged |
| Correctness | Unit tests for who is told, using the compatibility and eligibility modules: only eligible donors, nobody already asked within the cooldown, opt-outs respected | 100% of the rules covered |

**Forecast quality** is defined in point 5.
