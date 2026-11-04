# bloodLink

bloodLink is a final-year B.Tech project. It is a Next.js web app on Supabase that searches live blood stock at Indian blood banks through the government eRaktKosh API, ranks nearby sources for an emergency request, and is growing into a donor network. Hospitals and blood banks register and are verified by admins. The reports and slides in `../documentation/` define the promised scope, but they disagree with the code and with each other.

**Path convention.** The app lives in `bloodlink/`. Every path in this file is relative to `bloodlink/` unless it starts with `../`. Run all npm commands from `bloodlink/`.

**How to use this file**
- This file is the single source of project guidance. It replaced the old AGENTS.md and ROADMAP.md.
- The other documents are in `docs/`:
  - `docs/deliverables.md` lists each suggestion, the reviewer's points and report 3's requests: what was asked, what was done, where, its status and its summary.
  - `docs/data_integrity.md` checks reviewer point 3 (data quality, freshness and failures) and records the faults found and fixed.
  - `docs/CODE_REFERENCE.md` describes every function and variable, file by file. Update it when you add, rename or remove one.
  - **`docs/plans.md` lists all planned work in order of priority:** each item's details, status, size and next step, and its plan file in `docs/PLANS/` where one exists. Begin a plan only when asked.
    - `docs/PLANS/plan_bank_locations.md`: place the banks location search can't see (#33, #34).
    - `docs/PLANS/plan_panels.md`: the admin, blood-bank, hospital and donor panels.
    - `docs/PLANS/plan_donor_network.md`: the peer-to-peer donor network.
    - `docs/PLANS/ML_system.md`: the ML system: the stock-out forecast in the app, suggesting active, eligible donors nearby, ranked by the donor network's score, and stock-out events an admin makes (drills for test accounts, and manual appeals a partner centre approves).
    - A finished plan's file is deleted, and its record moves to its topic's summary in `docs/SUMMARIES/`, or to "History" at the end of this file. The cloud collector's (#35) is in `docs/SUMMARIES/data_quality.md`.
  - **`docs/SUMMARIES/`** has one file per topic: a summary for the final report, then the full record. "The feature in full" says how it works now, and "Report 3's record" is the dated record of the work. The topics are the ranking, the ETA model, the ETA benchmark, the geospatial benchmark, data quality, testing and performance, and the ML models, with an index in its `README.md`. When a result changes, update its summary in the same change.
  - **Dated review:** `docs/verify_facts.md` checks every number and outside fact, as of 24 October, with status notes since.
  - **Outside the repo:** `../blood_data/README.md` catalogues the collected and outside datasets, with their validation results. `../documentation/sem 7 progress reports/report 2/` holds report 2 and its slides:
    - they add the ranking algorithm and worked examples, verification and admin, test results, and a Completed / In Progress / Planned table;
    - they correct report 1's claims about the stack and about features the app doesn't have;
    - they show the database schema: an entity-relationship diagram (slide 23, report Figure 3) and each table's contents, rules and access (slide 24, report Table 7).
- Paths that start with `../` are outside the repository, on the project laptop only. Cloud sessions don't have them.
- The known-issues list uses stable IDs, so a prompt can say "fix #20". When an issue is fixed, delete its entry and do not renumber the rest or reuse its ID. Add new findings with the next free ID, a severity and a tier.
- Facts marked *verified* were checked against the live eRaktKosh API or the live Supabase project on 2026-10-23, or on the date given.

## Workspace map

Edit only `bloodlink/`. Older copies of the app exist elsewhere in the workspace.

| Folder | What it is |
|---|---|
| `bloodlink/` | **The active app.** Git repo, remote `github.com/dark756/bloodlink`. The default branch, `supabase-migration`, holds the Supabase app. `master` holds the last MongoDB version, which tag `mongodb-final` also marks. |
| `supabase/migrations/` | Database schema, applied with `npm run db:migrate`. The only place schema changes go. |
| `supabase/functions/` | Edge Functions: `collect-stock`, the cloud collector (#35). It imports `src/lib/` and `assets/` directly. |
| `scripts/` | `migrate.mjs`, `make-admin.mjs` and `snapshot.mjs` run with Node against `SUPABASE_DB_URL`. `copy-project.mjs` copies every table into the new Mumbai project (#28); delete it once Tokyo is deleted. The cloud collector's scripts (#35): `check-cloud-collector.mjs` (its SQL, rolled back), `setup-cloud-collector.mjs` (secret, Vault, deploy, schedule), `upload-archive.mjs` and `sync-archive.mjs` (the archive bucket). `measure-search.mjs` times a running server. `benchmark-geo.mjs` compares spatial search methods, and `ranking-sensitivity.mjs` tests the weights. `build-traffic-profiles.mjs` and `build-state-boundaries.mjs` rebuild the traffic and state-outline assets. |
| `tests/` | Vitest unit tests for the pure modules in `src/lib/` and the eRaktKosh client. |
| `../redundant_bloodlink/bloodlink/` | April 2026 prototype: Next + TypeScript, Supabase, Expo, FastAPI. Abandoned. |
| `../redundant_bloodlink/bloodlink-borade/` | A teammate's Sept 2026 Supabase fork with dashboard scaffolds, request flows and notification adapters. Reference only; much of it falls back to mock data. |
| `../redundant_bloodlink/` top-level files | data.gov.in download scripts and dumps. `all_gov_data.json` holds about 2,800 blood banks. |
| `../blood_data/` | Collected data, outside the repo. `eraktkosh/` holds the laptop's copy of the collector's archive: changed stock (`history/*.ndjson`), weekly directory copies, `sweeps.ndjson`, `collector.log` (the laptop collector) and `sync.log` (the weekly sync). `scripts/` holds the Python checks, the Task Scheduler wrappers and the saved task definitions; `measurements/` the measured results. Point 3.2 adds other datasets. |
| `../rough_work/` | eRaktKosh endpoint notes and the density-aware ring-search spec at the bottom of `blood links.txt`. `ML/` holds the forecasting checks, with a `README.md` and the latest results in `SUMMARY.md`. `eta_benchmarks/` holds the ETA benchmark: its scripts, metrics, rubric and 46 tests, its data and runs in `data/`, and its documents, `README.md` (files, how to run it, code reference), `BENCHMARK.md` (the design and results) and `PLAN.md` (the steps left). Its `node_modules` is a junction to `bloodlink/node_modules`. It imports the app's `src/lib/trafficModel.js`, so it tests the code the app runs. |
| `../documentation/` | Sem 6 ESE report and slides, Sem 7 progress report 1 and slides, and the reviewer's feedback file `suggested changes after sem 7 report 1.txt`. |
| `../Research Papers/` | Literature-survey PDFs. |

## Stack and commands

- **Framework:** Next.js 16.2.4 with the App Router, plain JavaScript, React 19.2, Tailwind CSS 4. Read `node_modules/next/dist/docs/` before using Next APIs; start with `01-app/02-guides/upgrading/version-16.md`.
- **Backend:** Supabase project `zbjhdbleraucksutjdfs`, region ap-south-1 (Mumbai), Postgres 17. It replaced the Tokyo project `lhosczocktoklmqqudgm` on 2026-11-03 (#28). Supabase Auth handles Google and email/password sign-in. The app uses `@supabase/ssr` and `@supabase/supabase-js` with the publishable key only.
- **Maps and data:** Leaflet 1.9 with react-leaflet 5, axios, eRaktKosh as the live stock source, OSRM for road routes, TomTom Traffic Index profiles for time-of-day congestion, Open-Meteo for current rain.

```bash
npm run dev                          # dev server on http://localhost:3000
npm run build                        # production build (Next 16 does not lint during build)
npm start                            # serve the build
npm run lint                         # ESLint 9; passes with zero errors and warnings
npm run format                       # Prettier 3: rewrite files in the house style
npm run format:check                 # Prettier: list files that need formatting
npm test                             # Vitest; 153 tests in tests/ (the ETA bench's 46: npx vitest run in ../rough_work/eta_benchmarks/)
npm run db:migrate                   # apply pending supabase/migrations/*.sql
node scripts/migrate.mjs --status    # list applied and pending migrations
npm run db:make-admin -- a@b.com     # make an existing account the first admin
npm run snapshot -- --all --archive ../blood_data/eraktkosh   # a sweep from the laptop, by hand only: the cloud collects
npm run snapshot -- --directory --prune                       # the directory and the prune, from the laptop
node scripts/check-cloud-collector.mjs   # check the cloud collector's SQL in a rolled-back transaction
node scripts/setup-cloud-collector.mjs [--deploy-only | --schedule | --unschedule]   # cloud collector setup
npm run archive:upload [-- --check | --from-db YYYY-MM-DD]   # laptop archive into the bucket; compare per day
npm run archive:sync                 # download the cloud archive into ../blood_data/eraktkosh/
npm run measure -- --base http://localhost:3000 --runs 10     # search response times; add --concurrency 20. Start the server with TRUSTED_PROXY_HOPS=1
node scripts/benchmark-geo.mjs ../blood_data/eraktkosh/directory/<nearest json> [--postgis]   # spatial search benchmark
node scripts/ranking-sensitivity.mjs ../blood_data/measurements/ranking_sensitivity          # weights ±20%
node ../rough_work/eta_benchmarks/eta-sample.mjs [--week YYYY-MM-DD]   # pick the 40 pairs and the week Google times (calls nothing)
node ../rough_work/eta_benchmarks/eta-google.mjs [--plan]   # ask Google for the sample, within the free cap; --purge deletes its answers
node ../rough_work/eta_benchmarks/eta-bench.mjs --google [--dry-run]   # score the ETA methods against Google; --dry-run: M3 stands in
node ../rough_work/eta_benchmarks/eta-bench.mjs <trips.ndjson> --sets ../blood_data/measurements/ranking_sensitivity   # against timed trips
node ../rough_work/eta_benchmarks/eta-bench.mjs --ops   # OSRM latency and reliability, 200 uncached calls
node scripts/build-traffic-profiles.mjs  # rebuild assets/traffic_profiles.json from TomTom (yearly)
node scripts/build-state-boundaries.mjs  # rebuild assets/state_boundaries.json from geoBoundaries (if boundaries change)
```

## Environment

Variables live in `.env.local`, kept out of git by the `.env*` rule. `.env.example`, which is committed, lists them all with placeholders.

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all Supabase clients | Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all Supabase clients | Public by design; row-level security protects the data. |
| `SUPABASE_DB_URL` | `scripts/` only | Session-pooler connection string with the database password. Never use it in app code. |
| `SUPABASE_SECRET_KEY` | `scripts/upload-archive.mjs`, `scripts/sync-archive.mjs` | A secret key (Dashboard > Project Settings > API Keys), used only for the private `stock-archive` bucket. It bypasses row-level security, so never use it in app code. |
| `NEXT_PUBLIC_API_URL` | `src/lib/eraktkosh.js` | Optional eRaktKosh base override ending in `/`. Inlined at build time. |
| `NEXT_PUBLIC_CARTO_API_KEY` | `src/app/components/BloodMap.js` | Map tiles. Public by design. |
| `NEXT_PUBLIC_CONTACT_EMAIL` | `src/lib/privacy.js` | The address `/privacy` gives for privacy questions and requests. Unset, the page points to the GitHub repository instead. Inlined at build time. |
| `ERAKTKOSH_SIMULATE`, `ERAKTKOSH_SIMULATE_STATES` | `src/lib/eraktkosh.js` | Failure drill: `down`, `slow` or `flaky`, and state codes that always fail. Only outside production, or with `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1` on a local build. Never set on a deployed server. |
| `GOOGLE_ROUTES_API_KEY` | `../rough_work/eta_benchmarks/eta-google.mjs` only | A Google Cloud key restricted to the Routes API, for the ETA bench's reference. The project needs billing enabled; the script stays within the free cap (5,000 elements a month, 35,000 when billed in India). Never use it in app code: Google's terms bar its results on the app's map. |
| `OSRM_URL` | `src/lib/routing.js` | Optional OSRM server ending in `/`. Defaults to the public demo server (one request a second, no heavy use). Server-only, read at runtime. |
| `TRUSTED_PROXY_HOPS` | `src/lib/rateLimit.js` | How many trusted proxies in front of the app add to `X-Forwarded-For`; the client's IP is that many entries from the right. Defaults to 1 on Vercel (`VERCEL` is set) and 0 elsewhere. At 0 the header is ignored and all callers share one rate limit, because on a bare `next start` the client writes it. Set it to 1 for `npm run measure` and the sensitivity capture, which simulate many users. |

`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are kept in the file for reference; the app doesn't read them. They are what goes into the Supabase dashboard.

### One-time Supabase dashboard setup

1. **Authentication > Providers > Google:** enable it and paste the Google client ID and secret.
2. **Google Cloud console, OAuth client:** add `https://zbjhdbleraucksutjdfs.supabase.co/auth/v1/callback` as an authorized redirect URI.
3. **Authentication > URL Configuration:** set Site URL to the app's URL, and add `http://localhost:3000/auth/callback` plus the production `/auth/callback` URL to the redirect allow list.
4. After you first sign in, run `npm run db:make-admin -- <your email>`.

## How it works

### Pages and routes

| Route | File | Who | Purpose |
|---|---|---|---|
| `/` | `src/app/page.js` | anyone | Landing page. |
| `/search` | `src/app/search/page.js` | anyone | Region search, location search, and ranked search with a response plan. |
| `/login` | `src/app/login/page.js`, `LoginForm.js` | signed out | Google or email/password sign-in and sign-up. |
| `/auth/callback` | `src/app/auth/callback/route.js` | anyone | Completes Google sign-in and email confirmation links. |
| `/set-details` | `src/app/set-details/page.js` | signed in | Profile form: personal and blood details, plus donor screening for donors. Prefills when editing. Saving needs agreement to the current privacy note. |
| `/peer-to-peer` | `src/app/peer-to-peer/page.js` | complete profile | Profile, role badge and live donor eligibility. |
| `/organization` | `src/app/organization/page.js` | signed in | Apply to register a hospital or blood bank; see review status and notes. |
| `/account` | `src/app/account/page.js`, `DeleteAccountCard.js` | signed in | Whether you agreed to the current privacy note, and deleting your account. Reached from your name in the header. |
| `/privacy` | `src/app/privacy/page.js` | anyone | The privacy note: what is stored and why, which outside services receive what, how long, and your rights. Linked from the footer. |
| `/admin`, `/admin/organizations`, `/admin/users`, `/admin/audit` | `src/app/admin/` | admin | Overview and review queue, all applications, user roles, audit log. |
| `GET /api/search` | `src/app/api/search/route.js` | anyone | Region search. Validated, cached eRaktKosh proxy. `X-Data-Source`, `X-Data-Fetched-At` and `X-Data-Upstream` headers say how fresh it is. |
| `GET /api/blood-search` | `src/app/api/blood-search/route.js` | anyone | Location search: nearest mode or ranked mode. |
| `GET /api/nearest` | `src/app/api/nearest/route.js` | anyone | Validated eRaktKosh `nearest` proxy. Unused by pages. |
| `GET /api/reverse-geocode` | `src/app/api/reverse-geocode/route.js` | anyone | The place name under the map pin, from Nominatim through the server. 30 a minute per IP. |
| `DELETE /api/account` | `src/app/api/account/route.js` | signed in | Delete your own account with `delete_my_account()`, then clear the session cookies. |
| `GET`/`POST /api/details` | `src/app/api/details/route.js` | signed in | Read and save your own profile. |
| `GET`/`POST /api/organization` | `src/app/api/organization/route.js` | signed in | Your applications; submit a new one. |
| `POST /api/admin/organizations/review` | `src/app/api/admin/organizations/review/route.js` | admin | Approve, reject or suspend. |
| `POST /api/admin/users/role` | `src/app/api/admin/users/role/route.js` | admin | Grant or remove the admin role. |

`src/proxy.js` runs before every page request. It refreshes the Supabase session cookie with `getClaims()` and sends signed-out users from protected pages to `/login?next=`, and signed-in users from `/login` to the page `next` names (checked by `safeNextPath`). It also sends incomplete profiles from `/peer-to-peer` to `/set-details` and non-admins away from `/admin`. Admin pages check the role again in `src/app/admin/layout.js`, and the database checks it a third time.

### Shared modules in `src/lib/`

| Module | What it does |
|---|---|
| `supabase/client.js`, `supabase/server.js` | Browser and server Supabase clients. The server client runs as the signed-in user. |
| `auth.js` | `getCurrentUser` (verified claims), `getCurrentProfile`, `requireUser`, `requireAdmin`, `safeNextPath` (same-site paths only; refuses `//`, backslashes and control characters). |
| `constants.js` | States, districts, blood groups and components from `assets/district_data.json`. Codes are strings. |
| `eraktkosh.js` | Server-only eRaktKosh client built by `createEraktkoshClient`: parameter whitelist and aliases, validation, 5 min cache, per-state and service-wide circuits, retry, 8 s give-up, saved-copy fallback, failure simulator, `summarizeFreshness`. |
| `stock.js` | Parses `available_WithQty` with canonical group names, units per component (matched by name only), `exactGroupUnits`, `keepOnlyComponent`, `isDormant` (30 days), phone extraction, "updated N ago", `cleanText`, and `districtFromAddress` (the district an eRaktKosh address ends with). No imports, so scripts can use it. |
| `stockQuality.js` | Pure validator for eRaktKosh rows: unit range, group names, future dates, duplicates. Returns `{ rows, report }`. Used by the app and the collector. |
| `collector.js` | The eRaktKosh collector, shared by `scripts/snapshot.mjs` and the `collect-stock` Edge Function: fetch a state, validate, upload changed rows, refresh fetch times, add history, log the call, and record the run in `collector_runs`. The caller passes in the database session, `fetch` and the archive. Also the four cloud batches, the function's secret and request checks, and the admin overview's overdue rule. |
| `stockStore.js` | Server-only reads of the saved copy (`bank_stock_latest`, `blood_banks`) with the publishable key, in eRaktKosh's own shapes. Each state's rows are downloaded once per 10 minutes and cut to the district and component in memory, as a live filtered answer is. A bank without a directory row gets its district from its address. The saved directory keeps misplaced banks, as eRaktKosh's answer does, so the route counts them in both cases. |
| `geo.js` | `haversineMeters`, `isInIndia`, and `roundPinCoordinate`, which rounds a user's pin to 3 decimals (about 110 m). |
| `geocoding.js` | Server-only Nominatim client: the place name for a rounded pin, one request a second, cached for a week. |
| `privacy.js` | `PRIVACY_VERSION`, the privacy note's date that people agree to; `CONTACT_EMAIL`; `hasAgreedToPrivacy`. |
| `stateBounds.js` | `createStateChecker(boundaries)`: whether a bank's point lies in its own state (5 km margin), from `assets/state_boundaries.json`. `locationProblem` returns `missing`, `outside_india`, `wrong_state` or `null`. Pure; the caller passes the JSON in, so scripts can use it. |
| `rings.js` | Which search ring results come from: `nearestModeRing` and `rankedModeRing`. Dormant banks never decide the ring. |
| `compatibility.js` | Donor groups a recipient can receive, per component category. Not used by search since report 3 (exact group only); kept for donor matching. |
| `ranking.js` | Source scoring (ETA, coverage, surplus, freshness), urgency weights and the greedy response plan. |
| `trafficModel.js` | Pure travel-time model: traffic zone, congestion by India-time weekday, hour and month, rain factor, ETA. `createTrafficModel(profiles)` takes the profiles as an argument, so Node scripts can load it. |
| `traffic.js` | The model bound to `assets/traffic_profiles.json`, with the exports the app uses. |
| `routing.js` | Server-only OSRM table client: road distance and free-flow time per bank, 24 h cache, one request a second on the public server. |
| `weather.js` | Server-only Open-Meteo client: current rain in mm/h, 15 min cache. |
| `eligibility.js` | Donor eligibility computed on every read, following NBTC's 2017 donor-selection guidelines: clauses 2 to 4 (age, with 60 the limit for a first donation; weight; gap), 15 to 17 (birth, abortion, breastfeeding) and 47 (tattoos and the like). |
| `profile.js`, `organization.js` | Whitelist validators for the profile and organization forms. Dates must be real calendar dates, and "today" is India's date. `trimText` and `PHONE_PATTERN` are shared from `profile.js`. |
| `format.js` | Display helpers: `formatDate`, `formatDateTime`, `hoursSince`, `formatTimeAgo`, `capitalize`, `getInitials`. |
| `profileStore.js` | Maps the page's `details` object to and from the `profiles` and `donor_screening` rows. |
| `rateLimit.js` | Per-IP in-memory rate limits for the search routes. The IP comes from `X-Forwarded-For` only behind trusted proxies (`TRUSTED_PROXY_HOPS`); otherwise all callers share one limit. |

### Location search and ranking

`GET /api/blood-search` takes `lat` and `lng`, rounded to 3 decimals by the page and again by `parseCoordinates`, optional `componentId` and `bloodGroupId`, and in ranked mode `units` (1 to 50) and `urgency` (`critical`, `urgent` or `routine`). The old `compatible` parameter is ignored.
1. One eRaktKosh `nearest` call with a 150 km radius returns the nearby banks. At the same time, Open-Meteo is asked for rain at the pin.
   - Banks whose point lies outside their own state (or India) are left out, because their distance is meaningless (`stateBounds.js`). The response's `misplacedBanks` says how many within the widest ring, from live or saved data alike, and the page says so. Region search still lists them.
2. More than 10 banks within 15 km means an urban area, with rings of 5, 10, 15 and 25 km. Otherwise the area is rural, with rings of 20, 50, 100 and 150 km.
3. Stock is fetched once per state involved, in parallel, and joined on `String(hospitalCode)`. Alongside it, one OSRM table call routes every candidate bank.
4. **Nearest mode**, when the component or the group is missing, returns the smallest ring with an active (not dormant) bank holding matching stock, or, if every such bank is dormant, the smallest ring with any. Results are sorted by straight-line distance, and each bank has a road ETA.
5. **Ranked mode**, when both are given:
   - Only banks listing the exact blood group count (`exactGroupUnits`). Compatible substitutes are not used.
   - It grows the ring until the active banks inside it cover the units needed.
   - It scores each bank with `rankSources` and splits the request with `buildResponsePlan`.
6. Every result carries `roadDistanceM`, `etaMinutes` and `etaSource` (`road` or `estimate`). The response has a `travel` block: zone, city, India time, congestion %, label and rain.

Travel time in `src/lib/trafficModel.js` is free-flow time × (1 + congestion / 100) × rain factor.
- **Free-flow time:** the slower of two times, OSRM's and road distance at the zone's measured free-flow speed.
  - OSRM's car profile assumes about 65 km/h through Mumbai, while TomTom measures 33.7 km/h.
  - Without a route, road distance is straight-line × 1.34, the median over 94 Mumbai bank trips.
- **Zone:** inside one of TomTom's 10 Indian metros (with a 10 km margin), that city's own profile is used. Elsewhere, bank density within 15 km picks a scale on the Indian average profile:

  | Zone | Banks within 15 km | Congestion scale | Free-flow speed |
  |---|---|---|---|
  | city | 11 or more | 0.89 | Indian average |
  | town | 3 to 10 | 0.73 | halfway to highway speed |
  | rural | 0 to 2 | 0.29 | highway speed |

- **Congestion:** the zone's weekday-hour value in India time, interpolated to the minute, times the month's seasonal factor. The monsoon months run about 10% higher.
- **Rain:** × 1.15 at 2.5 mm/h or more, × 1.3 at 7.6 mm/h or more (the American Meteorological Society's moderate and heavy rates).
- `docs/SUMMARIES/eta_model.md` has the measurements and sources behind each number.
- **This method is M3 in the ETA bench** (`docs/SUMMARIES/eta_benchmark.md`). The bench also scores:
  - M0, the original straight line × 1.4 at 25 or 45 km/h;
  - M1, this model on a straight line × 1.34, which is the fallback;
  - M2, raw OSRM.
- **How M3 compared.** Against Google's traffic-aware predictions for 3,360 trips (4 November), M3 was 24.9% off on average, against 32.8% to 47% for the others, and picked Google's first bank in 81% of searches. Rural trips come out 28% too quick, from the highway base speed.
- **M3 is the chosen method:** 65.0 of 100 on the bench's rubric, against 56.3 for M1, with OSRM's p95 at 217 ms and 200 of 200 calls answered. This is provisional until the team agrees the rubric (phase 1). Change `routing.js` or `traffic.js` only through the bench.
- **Calibration** of the town and rural values comes from timed trips only, never from Google's numbers (Google's terms; the benchmark's E10). The steps left are in `docs/SUMMARIES/eta_benchmark.md`, "The plan to finish it".

Scoring in `src/lib/ranking.js` counts exact-group stock only:
- **ETA:** `100 · e^(−minutes / τ)`, with τ = 30, 45 or 60 minutes for critical, urgent and routine.
- **Coverage:** `100 · min(1, units / units needed)`.
- **Surplus:** `100 · (1 − e^(−spare / units needed))`, where spare is the units beyond the request.
  - One request's worth spare scores 63; two score 86.
  - Surplus is a buffer against stock that changed since the last update, and against the patient needing more.
- **Freshness:** 100 if updated within 6 hours, falling linearly to 0 at 72 hours. 30 when there is no update time.

Weights by urgency. Spare stock is rewarded most when critical.

| Urgency | ETA | Coverage | Surplus | Freshness |
|---|---|---|---|---|
| critical | 0.45 | 0.15 | 0.20 | 0.20 |
| urgent | 0.35 | 0.25 | 0.15 | 0.25 |
| routine | 0.25 | 0.35 | 0.05 | 0.35 |

- Each ranked bank carries three plain-language `reasons`: travel, stock and freshness.
- The plan takes units from banks in rank order and reports any shortfall.
- `tests/ranking.test.js` holds the worked scenarios, including the reviewer's requested examples.

### Stale data, failures and the stock store

Each eRaktKosh lookup takes the first step that has data:
1. The memory cache, under 5 minutes old. Source `cache`.
2. The circuit. Each state's stock lookups, and `nearest`, have their own: after 3 failures within a minute, that lookup skips eRaktKosh for 2 minutes, then one request tests it. A service-wide circuit does the same for every lookup, but only when the failures come from at least two of them. One broken state therefore never cuts the others off.
3. A live call, with one quick retry on network errors and 5xx answers.
   - Source `live`.
   - Concurrent searches share one call in flight.
   - If a backup exists, the client gives up after 8 s and serves it, while the call finishes in the background. When `nearest` was already slow, it gives up after 3 s instead.
4. The older memory copy. Source `memory`.
5. The copy saved in Supabase. Source `saved`. With a `componentId`, it is cut to that component, as a live filtered answer would be. An empty list is a real answer.
   - Each state's rows are downloaded once per 10 minutes per server, and every component, group and district lookup is cut from them in memory.
   - Banks with no directory row get their district from the end of their address, which names it the way `district_data.json` does. On 2026-10-26 this matched the known district for all 4,048 banks that have one.
6. A clear error, with a Retry button on the page.

What the user sees:
- `/api/blood-search` returns `freshness`.
  - `source`, `fetchedAt` and `oldestFetchedAt` describe the stock only.
  - `locationsSource` and `locationsFetchedAt` describe the `nearest` answer. The saved directory behind it is refreshed weekly, so its age is kept apart.
  - `upstream` (`ok`, `degraded` or `down`) covers both, and `failedStates` lists states by name.
  - `stale` and `partial` are kept for older clients.
- Each bank carries `checkedAt` and `isDormant`.
- The page shows a yellow banner when the oldest saved stock is under 24 h old and a red one when it is older. Each bank shows two ages, "Bank updated 3 h ago · checked 12 min ago".
- Dormant banks (stock not updated for 30 days) are listed with a red badge but never decide the ring and are left out of the plan.

How the saved copy is collected, in Supabase since 2026-11-03 (#35; the design, measurements and decisions are in `docs/SUMMARIES/data_quality.md`:
- **Every 4.5 hours.** Four `pg_cron` jobs, `collector-batch-1` to `-4`, tick every 30 minutes (5, 7, 9 and 11 minutes past the hour and the half hour). `collector_tick` starts a sweep once 4.5 hours have passed and posts each batch of 9 states, 2 minutes apart, to the `collect-stock` Edge Function through `pg_net`, pinned to `ap-south-1`.
- The function runs `src/lib/collector.js` as `bloodlink_ingest`, validated with `stockQuality.js`, one state a second. Full rows are uploaded only for banks whose update time changed; the others get a new `fetched_at`. It refuses a job that started in the last 50 minutes, whichever runner ran it.
- `collector-weekly`, Monday 03:20 India time, saves the directory, runs the prune and trims `pg_cron`'s run log.
- **The archive.** Every change goes, gzipped, to the private Storage bucket `stock-archive`, with each batch's summary and the weekly directory. The laptop's history up to the cutover is there too: every day matched the database (`npm run archive:upload -- --check`). The prune deletes a day of `stock_history` only once the archive holds all of it.
- **Monitoring.** Each job is a row in `collector_runs`. The admin overview shows the last sweep and turns red after the interval plus 2 hours.
- **Commands** (`node scripts/setup-cloud-collector.mjs …`): `--unschedule` stops it, `--schedule ['6 hours']` starts it or changes the interval, `--deploy-only` redeploys after a change to `collector.js` or the function, and no flag rotates the secret.
- **The laptop's copy.** `\bloodLink\Archive sync (weekly)`, Sundays at 21:00, runs `../blood_data/scripts/run_sync.ps1` (`npm run archive:sync`). It catches up about 10 minutes after the laptop is next on, never calls eRaktKosh, and logs to `../blood_data/eraktkosh/sync.log`. `../blood_data/scripts/register_sync_task.ps1` re-creates it. Run the sync by hand before training or testing a model.
- **The old laptop collector** is disabled: `\bloodLink\Stock snapshot (hourly)` and `\bloodLink\Directory snapshot and prune (weekly)`, which ran `scripts/snapshot.mjs` through `../blood_data/scripts/run_collector.ps1` in a hidden console.
  - `scripts/snapshot.mjs` still works by hand and records its runs as `laptop`. Never run a sweep on top of the cloud's: collection stays at hourly or less.
  - Their definitions are saved in `../blood_data/scripts/tasks/`. To roll back: `--unschedule`, then `Enable-ScheduledTask -TaskPath '\bloodLink\' -TaskName 'Stock snapshot (hourly)','Directory snapshot and prune (weekly)'`. Once deleted, each comes back with `Register-ScheduledTask -TaskPath '\bloodLink\' -TaskName '<name>' -Xml (Get-Content -Raw ../blood_data/scripts/tasks/<file>.xml)`.

### Sign-in, profile and verification

1. Sign-in uses Supabase Auth: Google OAuth or email/password, with PKCE through `/auth/callback`.
   - The header learns who is signed in in the browser (`onAuthStateChange`), and reads the name and role from `profiles` on each page change. The root layout reads no cookies, so pages that don't read the session on the server are prerendered.
2. A trigger on `auth.users` creates a `profiles` row with the name from the sign-in metadata.
3. `/set-details` posts to `/api/details`. The route validates with `sanitizeDetails`, then updates `profiles` and upserts `donor_screening`, as the user, through row-level security. If the person isn't a donor, their screening row is deleted.
   - A save needs agreement to the current privacy note. The form shows a tick box until `profiles.privacy_version` equals `PRIVACY_VERSION`, and the route refuses a save without it.
   - The route stores the version; a trigger stamps `privacy_accepted_at` from the database clock, so no client can set the time.
4. A trigger keeps `is_profile_complete` in sync, so the proxy reads completeness straight from the database.
5. A user applies on `/organization`, which inserts a `pending` row in `organizations`. An admin approves it with `review_organization()`, which links the applicant to the organization, sets their role to `hospital` or `blood_bank`, and writes `audit_log`. Rejecting or suspending removes both. An applicant who is an admin keeps the admin role, but is still linked, so `set_user_role()` can give them the organization's role if the admin role is removed.
6. Admin roles change only through `set_user_role()`, which refuses to remove the last admin. The first admin comes from `npm run db:make-admin`.
7. Anyone signed in can delete their account on `/account`. `delete_my_account()` deletes the auth user, which cascades to the profile, the screening answers and the person's organization applications. Audit entries stay, with no actor. The last admin is refused.

### Data model and security

Schema is in eight migrations in `supabase/migrations/`, all applied to the live project:
- `20261023000100_init.sql`: people and organizations;
- `20261023000200_stock_store.sql`: saved eRaktKosh data;
- `20261023000300_blood_bank_locations.sql`: PostGIS;
- `20261024000100_wrong_state_locations.sql`: the `wrong_state` flag;
- `20261026000100_ingest_prune_grant.sql`: lets the collector's prune read `upstream_calls.called_at` (#56);
- `20261026000200_review_and_india_dates.sql`: India's date in the "no future dates" triggers (#46), and the admin case in `review_organization()` (#42);
- `20261026000300_privacy_consent_and_account_deletion.sql`: agreement to the privacy note on `profiles`, and `delete_my_account()` (#18);
- `20261103000100_cloud_collector.sql`: `pg_cron` and `pg_net`, `collector_sweeps` and `collector_runs`, the private `stock-archive` bucket, the tick and scheduling functions, and a prune that deletes a day of history only once the archive holds it (#35). It schedules nothing.

| Table | Contents | Who can read | Who can write |
|---|---|---|---|
| `profiles` | Personal details, `blood_group_code` (eRaktKosh code), `is_donor`, `role`, `organization_id`, `privacy_version` and `privacy_accepted_at` | Owner; admins | Owner, but only the personal columns and `privacy_version`. Role, completeness and `privacy_accepted_at` are never client-writable. |
| `donor_screening` | Last donation date and health answers | Owner only, not admins | Owner |
| `organizations` | Hospital and blood-bank applications with `status` | Applicant; admins | Applicant inserts as `pending` and may edit while pending; status changes only through `review_organization()` |
| `audit_log` | Admin actions | Admins | Database functions only |
| `blood_banks` | Directory from a nationwide `nearest` call: code, name, contact, state, district, coordinates, `location_quality` (`ok`, `shared`, `wrong_state`, `outside_india` or `missing`), and `location`, a generated PostGIS geography point with a GiST index, null for `wrong_state` and `outside_india` | Anyone | `bloodlink_ingest` only |
| `bank_stock_latest` | One validated eRaktKosh row per bank (`row` jsonb, same shape as live), `entry_at`, `fetched_at` | Anyone | `bloodlink_ingest` only |
| `stock_history` | Compact stock whenever a bank's update time changes; unique on bank and `entry_at`; pruned at 60 days | Anyone | `bloodlink_ingest` only |
| `upstream_calls` | One row per collector call: endpoint, state, ok, status, time, bytes, rows, failure kind, validation counts | Admins (`is_admin()`), plus the `upstream_stats` view | `bloodlink_ingest` only |
| `collector_sweeps` | One row per cloud sweep: start time, interval, batches sent | Admins | The tick functions only |
| `collector_runs` | One row per collector job (cloud or laptop): batch, times, states saved, failed and skipped, rows changed, and the archive file with its UTC day and line count | Admins | `bloodlink_ingest` only |

- **Row-level security** is on for every table. Grants are explicit and column-level, so the dashboard's "expose new tables" setting doesn't matter.
- **Constraints:** CHECK constraints and triggers enforce the same value rules as `src/lib/profile.js` and `src/lib/organization.js`, plus "no future dates", judged by India's date.
- **Admin functions:** `is_admin()`, `review_organization()` and `set_user_role()` are `security definer` with an empty `search_path`. They raise SQLSTATE 42501, 22023 or P0002, which `src/app/api/admin/rpcError.js` maps to HTTP status codes.
- **Account deletion:** `delete_my_account()` is `security definer` too, and deletes only the caller's own auth user. Every foreign key to `profiles` must cascade or set null, so a deletion is never blocked.
- **No service-role or secret key** exists in the app. Everything runs as the signed-in user, or with the publishable key for the public stock tables. A secret key is used only for the private `stock-archive` bucket: by the `collect-stock` Edge Function, from the environment Supabase gives it, and by the two archive scripts.
- **`bloodlink_ingest`** is a no-login role. The collector connects with `SUPABASE_DB_URL` and runs `set role bloodlink_ingest`, so its session can touch only the stock tables. `prune_stock_store()` is executable only by it, and runs with its rights.
  - On `upstream_calls` it may insert and delete, and read only `called_at`, which the prune's `DELETE … WHERE` needs.
  - Postgres requires SELECT on every column an `UPDATE` or `DELETE` reads in its `WHERE`, so a new job role needs those grants too.

## eRaktKosh API reference

- **Base URL:** `https://eraktkosh.mohfw.gov.in/eraktkoshPortal/eraktkosh/`. Public, no key. Requests send `User-Agent: Mozilla/5.0`.
- **Parameter names are case-sensitive** (*verified*): `stateCode`, `districtId`, `componentId`, `bloodGroupId`. The aliases `districtCode` and `ComponentId` are silently ignored upstream, and `src/lib/eraktkosh.js` maps them.

| Endpoint | Params | Returns |
|---|---|---|
| `blood-availability` | `stateCode` (required), `districtId`, `componentId`, `bloodGroupId` | Banks with `hospitalCode` (string), `hospitalname`, `hospitaladd`, `hospitalcontact`, `entrydate` (Indian time), and `components[name].available_WithQty` text such as `"O-Ve : 3, A+Ve : 86"`. |
| `bloodbank/nearest` | `latitude`, `longitude`, `radius` (m) | Banks with `hospitalCode` (number), `latitude`, `longitude`, `stateCode` (number), `phone`, and `dist` in straight-line meters. |
| `bloodbanks` | `stateCode` | `hospitalCode`, `hospitalName`, `mobileNo`, per `../rough_work/info.txt`. |

Quirks, *verified*:
- **Filters mostly don't remove banks.** `bloodGroupId` doesn't: banks without matching stock come back with an empty `available_WithQty`. `componentId` drops banks that don't list that component at all (Mizoram: 9 banks unfiltered, 8 with `componentId=12`, checked 2026-10-24). A filtered response lists only the requested component, under its `componentList` name.
- **Size and speed.**
  - All 36 states hold 4,707 banks, 9.5 MB, and take 87 s back to back.
  - Large states are slow: Uttar Pradesh took 12.4 s for 1.4 MB.
  - Responses are not compressed.
- **Names sometimes end with stray commas,** so use `cleanText`.
- **Group labels vary.** 1,694 entries are written "O +ve". `parseQuantities` normalises them to the canonical names.
- **Counts can be implausible.** 30 group entries list over 2,000 units, up to 15,280. The validator drops them.
- **`nearest` and `blood-availability` cover different banks.**
  - A nationwide `nearest` call returns 4,328 banks.
  - 679 stocked banks (432 blood banks and 247 storage units) have no coordinates there; see #33.
- **`nearest` coordinates are often wrong.** On 2026-10-24, 206 banks sat outside their own state, 2 outside India and 518 on points shared with other banks; see #34. Central Delhi is the worst: 36 of the 51 banks within 5 km of Connaught Place belong to other states, such as Punjab, Kerala and Tamil Nadu.
- **Fields with no clear use.**
  - `offline` is "1" for 98.7% of banks. The 59 banks with "0" are much staler (median 104 h).
  - `moderateStock` is always "0".
  - `stockSource` (0 to 3) is unexplained.
- **Stock age depends on the time of day.** 73% of banks make their latest update between 07:00 and 12:00 India time.
  - The median age was 9.7 h on the evening of 2026-10-23, and 3.3 h at 10:47 on 2026-10-24.
  - 6.3% of banks are older than 30 days at any hour.
- `district_data.json` uses eRaktKosh codes, not census codes; for example, 99 is Uttar Pradesh.
  - It is a copy of `POST master/all` with `{"hospitalCode":100}`, refreshed on 2026-10-23: 781 districts. Markapuram, Polavaram and Tamulpur were added, and a duplicate Majuli entry (code 746) removed; Majuli is still listed as 713. Refresh it now and then.
- **Banks with automatic refresh.** `master/portal-refresh-hospitals` lists 452 banks whose stock eRaktKosh refreshes in batches at fixed times, not continuously.
  - At 18:30 on 2026-10-23, minutes after a batch, their median stock age was 0.3 h, against 9.7 h for the rest.
  - At 10:47 the next morning it was 4.6 h, against 3.2 h.
- **Other calls.** `camps/details?stateCode&districtCode=-1&startDate&endDate` returns donation camps, past and future. The monthly stock and issue reports (`MonthlyCollection/*`) need a blood-bank login.

Blood-group codes: A+ 11, A- 12, B+ 13, B- 14, O+ 15, O- 16, AB+ 17, AB- 18, Bombay Oh+ 22, Bombay Oh- 23. Components include Whole Blood 11, PRBC (packed red blood cells) 12 and FFP (fresh frozen plasma) 13; see `componentList`.

## Conventions and gotchas

- **Supabase clients.** Create a server client per request with `createClient()` from `src/lib/supabase/server.js`. Identify users with `getCurrentUser()`, which uses `getClaims()`, never `getSession()`. Never add a service-role key to app code; if an operation needs to bypass row-level security, write a `security definer` database function that checks the caller.
- **Schema changes.** Add a new timestamped file in `supabase/migrations/` and run `npm run db:migrate`. Never edit an applied migration. A new client-writable column needs a matching column `grant` and, if it is validated, a CHECK constraint and an update to the JS validator.
- **Identity.** Never take a user id or email from a request body or query string.
- **Validation.** Client input goes through a whitelist validator. Anything forwarded to eRaktKosh goes through the parsers in `src/lib/eraktkosh.js`.
- **axios throws on non-2xx.** Use `try/catch/finally` and show `err.response.data.error` in a `notice-error`. Don't use `alert()`.
- **Derived state.** Compute values such as `districtsFor(stateCode)` during render. The React Compiler lint rules reject a direct `setState` in an effect body and reading `ref.current` during render.
- **Leaflet.** Load `src/app/components/BloodMap.js` only through `dynamic(..., { ssr: false })`. Build Leaflet objects with a lazy `useState` initializer, and keep the stable `key` on `MapContainer`.
- **Per-process state.** Rate limits and the eRaktKosh cache live in server memory, so each serverless instance has its own.
- **Formatting.** Prettier 3, settings in `.prettierrc.json` (`printWidth` 100, otherwise defaults). Run `npm run format` before committing. `.prettierignore` skips the top-level `assets/`, `public/` and `supabase/` folders (anchored with `/`, so `src/lib/supabase/` is still formatted) and Markdown.
- **Naming.**
  - `camelCase` for variables and functions, `PascalCase` for components and their file names, `UPPER_SNAKE_CASE` for module-level constants.
  - `is`/`has`/`can` for booleans, `handleX` for event handlers, `onX` for callback props.
  - `snake_case` appears only in database columns and raw eRaktKosh fields. Normalized objects use camelCase, so `row.entrydate` becomes `entryDate`.
- **Styling.** Use the classes in `src/app/globals.css`: `page-wrap`, `card`, `btn btn-primary`, `badge badge-green`, `notice notice-warn` and the rest, plus Tailwind. The theme is light-only, with brand red `#d32f2f`.
- **Medical copy.** Label eligibility, compatibility and ranking output as informational. Blood banks do the real screening and cross-matching; their medical officer makes the final call. Screening questions and thresholds follow NBTC's 2017 guidelines, cited by clause in `src/lib/eligibility.js`.
- **Static pages.** Keep the root layout free of cookies and other per-request reads; the header reads the session in the browser. `npm run build` must list `/`, `/privacy`, `/search`, `/peer-to-peer`, `/set-details` and `/organization` as static (○).
- **Credits.** The search page must keep the OSRM / OpenStreetMap, TomTom, Open-Meteo and DataMeet / geoBoundaries credit line. The public OSRM and Open-Meteo services and the CC BY 2.5 IN state outlines require it.
- **Privacy.** A user's pin leaves the browser only through `roundPinCoordinate`, and outside services are called by the server; the browser talks only to the app, Supabase and CARTO. A new outside service or a new kind of personal data goes on `/privacy`, and a changed note gets a new `PRIVACY_VERSION`.
- **Security headers.** `next.config.mjs` sends them on every response. The full Content-Security-Policy is report-only, so violations show in the browser console; add any new browser-side origin to it.

## Verifying changes

- `npm run lint`, `npm run format:check`, `npm test` and `npm run build` must all pass.
- **Region search:** Goa (`stateCode` 30) has 5 banks, and district 585 narrows it to 3.
- **Location search:** Mumbai (19.0760, 72.8777) comes back `urban` with a 5 km ring and `travel.zone` `metro`. A ranked search there for O- red cells, `componentId=12&bloodGroupId=16&units=3&urgency=critical`, returns a plan, and every result's stock is O-Ve only. Starting the server with `OSRM_URL=http://127.0.0.1:9/` must still answer, with every bank's `etaSource` set to `estimate`.
- **Misplaced banks:** a ranked search in central Delhi (28.6139, 77.2090) lists only banks whose address is in Delhi, with `misplacedBanks` above 0.
- **Rate limit:** on a server without `TRUSTED_PROXY_HOPS`, 21 location searches in a minute, each with a new `X-Forwarded-For`, must end in a 429.
- **Security:** with a signed-in non-admin, the Data API must refuse `profiles.update({ role })` and `profiles.update({ privacy_accepted_at })` with 42501, and `/api/admin/*` must return 403. With the publishable key, the stock tables are readable, while `upstream_calls`, every insert or update, and `rpc/prune_stock_store` are refused with 42501.
  - Every response carries the headers from `next.config.mjs`.
  - Signed out, `/account` redirects to `/login`, and `DELETE /api/account` returns 401.
- **Place names:** `/api/reverse-geocode?lat=15.4909&lng=73.8278` answers `Panaji`, and asking again for the same rounded point is served from the cache.
- **Failure drill:** build, then start `next start` with `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1` and `ERAKTKOSH_SIMULATE=down`.
  - Every search must still answer, from `source: "saved"`.
  - A ranked search near Saifai (26.9608, 78.9621) for A+ red cells must not list bank 1702, which holds only plasma.
  - A ranked search in central Delhi must still report `misplacedBanks` above 0.
  - A region search for Rohtak, Haryana (`stateCode=96&districtId=82`) must list bank 96121, which has no directory row.
  - `slow` must serve the saved copy after 8 s.
  - `ERAKTKOSH_SIMULATE_STATES=27` must keep other states live, even after several Maharashtra failures in a minute.
  - Add `TRUSTED_PROXY_HOPS=1` when a script sends many searches.
  - `docs/SUMMARIES/data_quality.md` (point 3.1, Results) and `docs/data_integrity.md` have the reference results.
- **Collector:** `npm run snapshot -- --prune --log ../blood_data/eraktkosh/collector.log` must log a `pruned:` line, and `npm run snapshot -- --states 999` must stop with "Unknown state code" before any call. Neither calls eRaktKosh. The cloud runs the deployed copy of `collector.js`: after changing it or the function, run `node scripts/setup-cloud-collector.mjs --deploy-only`, then check the next sweep's four `collector_runs` rows. A laptop prune counts toward the repeat guard, so don't run one in the 50 minutes before the Monday 03:20 job.
- **Cloud collector:** `node scripts/check-cloud-collector.mjs` must pass all its checks (it rolls everything back), and `npx deno@2.5.6 check --no-lock --node-modules-dir=none supabase/functions/collect-stock/index.ts` must report no errors.
- **Performance:** `npm run measure` against a fresh server started with `TRUSTED_PROXY_HOPS=1`; compare with the table in `docs/SUMMARIES/performance_testing.md`.
- **Schema changes:** run a new migration and its checks inside one transaction that is rolled back before applying it. On 2026-10-26, `delete_my_account()` and the consent trigger were checked that way with a throwaway user.
- **End to end:** on 2026-10-23, a throwaway script ran 47 checks against the live project. It seeded users directly into `auth.users`, signed them in, and exercised every flow and refusal, then deleted them. It is not in the repo because it writes to the auth schema of the live project; see issue #20.

## Known issues, prioritized

Each issue has an urgency tier and a severity tag. The list is sorted by tier, then severity.
- **Tiers:** P0 = fix now. P1 = the next few prompts. P2 = before big new features. P3 = later.
- **Severity:** Critical = data exposure or corruption. High = the core feature gives wrong answers or none, or a serious security risk. Medium = degraded behavior or a latent risk. Low = cleanup.

Fixed, IDs not to be reused: #1 to #18, #21 to #25, and #36 to #60.
- #9 and #16 went away with the move to Supabase Auth and `src/proxy.js`.
- #36 to #41 were found and fixed on 2026-10-24; see `docs/data_integrity.md`.
- #42 to #55 come from the code, docs and plans review of 2026-10-24, and #56 to #60 from the review that followed it. The ones listed above were fixed on 2026-10-26, as were #18, #23, #24 and #25.
- #24's thresholds were checked on 2026-10-26 against the official text of NBTC's 2017 guidelines, as the Union of India filed it in the Supreme Court (WP (C) 275 of 2021, Annexure A5); NACO's own server wasn't reachable. The four mismatches F1 to F4 in `docs/verify_facts.md` are fixed, and abortion (clause 16) was added.
- Dropped on 2026-10-26 without a fix, IDs not to be reused: #19 (keys in the archive folders), #26 (rotating the database password) and #32 (documents that claim features the code lacks).
- #49 closed on 2026-11-03: the Mumbai project signs sessions with its ES256 (P-256) key, so `getClaims()` verifies them locally.
- #27, custom SMTP for sign-up email, moved to `docs/PLANS/plan_panels.md` as foundation item F8.
- #30 and #31 were retired without a record. Don't reuse them either.

### P0 · fix now

None open.

### P1 · next

**#28 · Low · Finish the move to Mumbai.**
- The project moved from Tokyo to ap-south-1 (Mumbai) on 2026-11-03. Tokyo cost about 175 ms per round trip and 1.2 s to connect; Mumbai measured 10 ms and 113 ms from the laptop.
  - `scripts/copy-project.mjs` applied all eight migrations and copied every table in 77 s, every count matching (48,500 history rows).
  - `.env.local` points at Mumbai, and the Tokyo lines are gone. Use the session pooler (`aws-0-ap-south-1.pooler.supabase.com`, user `postgres.<ref>`): the direct `db.<ref>.supabase.co` address is IPv6-only and doesn't resolve here.
  - Checked on Mumbai: `check-cloud-collector.mjs`, the Data API's refusals, a prune, the failure drill's saved-copy searches (Goa 5 and 3, Rohtak listing 96121), and Google enabled in `/auth/v1/settings`. Accounts and roles were copied; people sign in again.
- Left:
  1. Sign in once with Google at `/login`, to check the whole round trip.
  2. Pause the Tokyo project. On 2026-11-03 it held nothing Mumbai lacks: the same counts in every table, its last write the 14:05 sweep before the copy, and no Storage files, Vault secrets or functions.
  3. Delete Tokyo from about 2026-11-10, since the free plan keeps no backups, then remove its callback URL from the Google Cloud console and delete `scripts/copy-project.mjs`, which only the move needed.
  4. Tidy `.env.local`: `SUPABASE_MUMBAI_PWD` is unused, and the `MUMBAI_*` lines repeat the active ones.

**#35 · Low · Finish moving collection off the laptop.**
- Cut over on 2026-11-03 (`docs/SUMMARIES/data_quality.md`: the laptop's tasks were disabled after its 15:05 sweep, its archive was uploaded and matched the database day by day, and the cloud schedule began at 15:36. The first cloud sweep, at 16:05, passed every check: four batches 2 minutes apart, 36 to 42 s each, 36 of 36 states, and all 63 changed rows archived and synced to the laptop.
- Left:
  1. Watch the first 24 hours, to 16:05 on 2026-11-04: the sweeps at 20:35, 01:05, 05:35, 10:05 and 14:35, each with four `collector_runs` rows of 9 states.
  2. Then delete the two laptop tasks, by name so the sync task stays: `Unregister-ScheduledTask -TaskPath '\bloodLink\' -TaskName 'Stock snapshot (hourly)','Directory snapshot and prune (weekly)' -Confirm:$false`.
  3. Test the sync's catch-up once: set its trigger a few minutes ahead, shut the laptop down across it, and check `sync.log` about 10 minutes after signing in.
  4. Check the sync's first scheduled run, Sunday 2026-11-08 at 21:00, and the first weekly directory and prune, Monday 2026-11-09 at 03:20.
- It is on the forecast's critical path: the late-December backtest needs history collected without gaps.

### P2 · soon

**#20 · Medium · No CI and no committed end-to-end tests.**
- 153 unit tests run with `npm test`; the ETA bench's 46 run with `npx vitest run` in `../rough_work/eta_benchmarks/`. Response times and the failure drill are measured by hand; see `docs/SUMMARIES/performance_testing.md` and `docs/data_integrity.md`.
- Add a GitHub Actions job for lint, test and build.
- Add an end-to-end suite that runs against a local or staging Supabase project, never production.

**#33 · Medium · 679 stocked banks have no coordinates.**
- eRaktKosh's `nearest` omits them, so location search can't see 14% of stocked banks (432 blood banks and 247 storage units).
- Region search still lists them.
- 15 can be placed confidently from data.gov.in (`../blood_data/crosswalk/coordinates_for_unlocated_banks.csv`). For the rest, try eRaktKosh's `bloodbanks?stateCode=` call or geocode addresses with Nominatim, then add them to `blood_banks`.

**#34 · Medium · eRaktKosh coordinates are unreliable for 726 banks.**
- On 2026-10-24, 206 banks sat outside their own state, 2 outside India, and 518 on points shared with other banks, probably district defaults. All are flagged in `blood_banks.location_quality`.
- Location search leaves out `wrong_state` and `outside_india` banks, so, like #33, it can't find them until they are re-placed; region search still lists them. Distances to `shared` banks may be off by a few km.
- Re-place them the way #33 suggests (data.gov.in, then geocoding addresses), then clear the flag. The 30 banks within 5 km of their own state are kept as border cases.
- 6 pairs of eRaktKosh codes look like one bank listed twice (`../blood_data/crosswalk/eraktkosh_possible_duplicates.csv`), for example "Vardaan Charitable Blood Centre" and "VARDAAN BLOOD CENTRE".

### P3 · later

**#29 · Low · Scripts skip TLS certificate checks.**
- `scripts/migrate.mjs`, `make-admin.mjs`, `snapshot.mjs`, `benchmark-geo.mjs` and `copy-project.mjs` use `rejectUnauthorized: false`.
- Download the Supabase CA from Dashboard > Database > SSL and pass it as `ssl.ca`.

**#61 · Low · Some foreign-key columns have no index.** A potential issue, not yet a problem.
- `profiles.organization_id`, `organizations.reviewed_by` and `audit_log.actor_id` have none. `organizations.applicant_id` has only the partial unique index on open applications, which neither its cascade nor `GET /api/organization` (every status) can use.
- So `delete_my_account()` scans `organizations` and `audit_log`, and each application it deletes scans `profiles`. At today's row counts this costs nothing.
- Fix: one migration with a plain index on each of the four columns. Add `collector_runs.sweep_id` too if sweeps are ever pruned.
- Found on 2026-11-03 while checking an outside list of suggestions. The rest of that list was about the abandoned prototype in `../redundant_bloodlink/bloodlink/`, and the app already handles the points that held.

## Where to go next

`docs/plans.md` has every item in order of priority, with its details. The first ones:
1. **Push `supabase-migration`,** when asked. Everything since 2026-10-26 (the privacy and consent work, the move to Mumbai and the cloud collector) was committed on 2026-11-03 but not pushed, and the deployed `collect-stock` function runs code GitHub doesn't have yet.
2. **Finish moving collection off the laptop** (#35): the 24-hour watch, then deleting the laptop tasks. Collection has run in Supabase since 2026-11-03.
3. **Finish the move to Mumbai** (#28): one Google sign-in, then retiring Tokyo.
4. **Stock-out forecasting** (reviewer point 5). The subplan, the seven models and the decision rule are in `docs/SUMMARIES/ml_models.md`; the scripts are in `../rough_work/ML/`, outside git.
   - **Interim choice: logistic regression, with the GBM classifier as the challenger** (the walk-forward dry run of 2026-11-04, all seven models, 10.8 days of history).
     - The GBM classifier ranks best (PR-AUC 0.269 at 48 h, against 0.255), but its 1.4-point lead is inside the decision rule's 2-point margin, so the rule picks the simpler model.
     - With recall at 1 false alert per bank per week as the first test, logistic regression leads (15.8% against 15.3%), and its cut-off, set a day ahead, held at 0.98 false alerts.
     - The GBM classifier stays in the December backtest: its lead is 2.0 points with the chosen inputs, so the rule as written could still pick it.
     - ETS, SARIMA and TSB fall below the best baseline (0.183). Recalibrate logistic regression before its probabilities feed ranking: it predicts 25% more stock-outs than happen.
     - The reasons are in `docs/SUMMARIES/ml_models.md`, and the tables, input tests and sources in `../rough_work/ML/SUMMARY.md`. It decides nothing; the December backtest does.
   - Two suggestions wait for approval (`docs/plans.md`, item 4): the alert budget in the decision rule, before the December test weeks are collected, and per-group lift. Camps were checked and left out.
   - Run `npm run archive:sync` before any model run, since `../blood_data/eraktkosh/` can be a week behind the cloud. Then `python -I blood_data/scripts/validate_history.py blood_data` from the workspace root (the folder above `bloodlink/`).
   - Next is phase 5.1 in November: the labels and the 19 core inputs the dry run chose. ETS and SARIMA run on 6-hour values now, and switch to daily values with a weekly season once two weeks exist. Around late December 2026, at about 8 weeks of history, run the walk-forward backtest once and apply the decision rule as written.
5. **Write to eRaktKosh's team** about the misplaced banks, and ask for the monthly issue data.
6. **CI and route tests** (#20).
7. Then bank locations (#33, #34; `docs/PLANS/plan_bank_locations.md`), the ETA bench (`docs/SUMMARIES/eta_benchmark.md`: the Google and operational runs are done, and M3 wins with 65.0; next purging Google's answers by 3 December, the team's agreement of the rubric, and the timed trips), deployment readiness, the panels (`docs/PLANS/plan_panels.md`), the donor network (`docs/PLANS/plan_donor_network.md`), and the ML system, the forecast in the app with donor suggestions (`docs/PLANS/ML_system.md`: its groundwork runs beside phases 5.1 and 5.2, the forecast's shadow mode in January 2027, and the suggestions after the donor network's phase 2).

Details to keep for the later items:
- **Donor network.** Donor location as a PostGIS `geography` point with a GiST index: the benchmark in `docs/SUMMARIES/geospatial_benchmark.md` shows an index is 75 to 300 times faster than a scan at 100,000 points and more. `blood_requests` and `request_responses` tables with row-level security. Matching with the existing compatibility, eligibility and ranking modules, with contact details masked until both sides accept. Notifications in-app first, then email, then SMS; the fork has MSG91, Fast2SMS and Twilio adapters.
- **Routing.** Self-host OSRM (Docker, Geofabrik India extract) before real traffic, and calibrate the town and rural values against timed trips.
- **Ship.** Custom SMTP (`docs/PLANS/plan_panels.md`, F8), `NEXT_PUBLIC_CONTACT_EMAIL`, the project guide's reading of `/privacy`, and the Content-Security-Policy enforced once it reports nothing. Then deploy to Vercel's Mumbai region (`bom1`), and build a PWA before any native mobile app.

## History: what changed since the original app

*Moved here word for word on 4 November 2026 from `docs/features.md` ("What changed in bloodLink") and `docs/report3.md`, when both were folded into `docs/SUMMARIES/`. Each topic's details are in its summary, and `docs/deliverables.md` says what each suggestion asked, what was done and where. This keeps the rest: the rounds of work, the features outside the reviewer's points, the bug fixes, the move to Supabase and report 3's dated notes.*

### The rounds of work

This lists everything added or changed on top of the original app, the version tagged `mongodb-final`. The work came in three rounds:

1. **Bug fixes and cleanup.** This is commit `fdb2b2a` on `master`.
2. **The move from MongoDB and NextAuth to Supabase.** This is on branch `supabase-migration`, committed on 24 October as `5af73b9`. It has been GitHub's default branch since 26 October.
3. **New features:** the ranking engine, the response plan, compatibility, and verification with admin tools. These are in the same commit.

Paths are relative to `bloodlink/`. Everything listed here passes `npm run lint`, `npm test` and `npm run build`.

**Report 3 update (2026-10-23).** A fourth round changed the ranking engine:
- It now counts the exact blood group only, with no compatible substitutes.
- It scores spare stock, weighted most when critical.
- ETA comes from OSRM road routes, adjusted for time of day, day of week, season, area density and rain.

The ranking section (now in `docs/SUMMARIES/ranking_algorithm.md`) is up to date with report 3. Where the rest of this list disagrees, report 3's record in `docs/SUMMARIES/` is the current record of what changed and why.

**Data checks (2026-10-24).** An independent re-check of the data found and fixed six faults, #36 to #41. They are listed under [Found in the 24 October data checks](docs/SUMMARIES/data_quality.md#found-in-the-24-october-data-checks), and `docs/data_integrity.md` has the details.

**Review fixes (2026-10-26).** Thirteen faults found in the reviews of 24 and 25 October were fixed. They are listed under [Found in the reviews of 24 and 25 October](#found-in-the-reviews-of-24-and-25-october). There are now 125 tests.

**Cloud collection (2026-11-03).** The database moved from Tokyo to Mumbai (#28), and stock collection moved off the laptop to Supabase (#35): see [Stock collected in Supabase, every 4.5 hours](docs/SUMMARIES/data_quality.md#stock-collected-in-supabase-every-45-hours). It was committed on 3 November. There are now 150 tests.

**ETA benchmark (2026-11-04).** The travel-time method, M3 in the benchmark, was checked against Google's traffic-aware predictions. It came out closest of the four methods compared, and the benchmark's rubric keeps it: see [Travel times by road, for the hour you search](docs/SUMMARIES/eta_model.md#travel-times-by-road-for-the-hour-you-search). There are now 199 tests.

**Forecast dry run (2026-11-04).** All seven stock-out models were compared on 10.8 days of history. The interim choice is logistic regression, with the GBM classifier as the challenger. It isn't in the app yet: see [Not done yet](docs/deliverables.md#what-is-not-done-yet).

### Report 3's opening notes

This report records every decision and step taken on 2026-10-23 to answer the reviewer's feedback in `documentation/suggested changes after sem 7 report 1.txt`. Each section has a plan, the decisions with their evidence, the steps taken, and how the result was checked.

- **Code paths** are relative to `bloodlink/` unless they start with `../`.
- **Where the work is.** Branch `supabase-migration`, GitHub's default branch since 26 October. Report 3's work was committed on 24 October as `5af73b9`, on top of `798fe73`, and the review fixes on 26 October. The later fixes of 26 October and the work of 3 November were committed on 3 November.
- **Order of work.** The points are worked in the order they were asked, not by number: 2, 1, 3.1, 3.2, 4, 5.
- **Follow-up on 2026-10-24.** `docs/data_integrity.md` re-checks point 3 independently and records six faults it found and fixed (#36 to #41). The counts and results here that it changed have been updated, and each point says where.
- **Reviews of 24 and 25 October.** A review of the code, docs and plans, whose next moves are now in `docs/plans.md`, and `docs/verify_facts.md`, which checked every number and outside fact. Thirteen of the faults they and a follow-up review found were fixed on 26 October; `CLAUDE.md` lists them and the ones still open. Where they corrected a figure or a source here, the text has been updated.
- **Point 5 on 2026-10-26.** The shortlist of seven models, two low-fidelity checks and the subplan were added. The check scripts are in `../rough_work/ML/`, outside git.
- **3 November.** The database moved to Mumbai (#28), collection moved to Supabase ([point 3.1](docs/SUMMARIES/data_quality.md#collection-moved-to-supabase-3-november)), and point 5 gained an early [walk-forward dry run](docs/SUMMARIES/ml_models.md#the-walk-forward-dry-run-4-november).
- **4 November.** Point 2's travel-time design, called M3 in the ETA benchmark, was [checked against Google's traffic-aware predictions](docs/SUMMARIES/eta_benchmark.md#checked-against-google-4-november) and compared with three other methods. It is the closest, and the benchmark's rubric keeps it.
- **4 November, point 5.** The [walk-forward dry run](docs/SUMMARIES/ml_models.md#the-walk-forward-dry-run-4-november) now covers all seven models, with each input and design detail tested. It gives an interim choice: logistic regression, with the GBM classifier as the challenger. The December backtest decides.

### Features outside the reviewer's points

#### Hospital and blood-bank verification
Files: `src/app/organization/`, `src/app/api/organization/`, `src/lib/organization.js`

- Any signed-in user can apply on `/organization` to register a hospital or a blood bank. The application includes the name, registration number, address, contact and an optional eRaktKosh code.
- The application stays **Pending** until an admin reviews it. The applicant sees its status and the admin's note.
- If the admin **approves** it, the user's role becomes Hospital or Blood bank, and a badge appears on their profile.
- If the admin **rejects** or **suspends** it, the role goes back to User. A rejected applicant can apply again.
- An applicant who is already an admin keeps the admin role, but is still linked to the organization, so removing the admin role later leaves them its role.

#### Admin dashboard
Files: `src/app/admin/`, `src/app/api/admin/`

The Admin pages are only visible to admins.
- **Overview:** counts, plus the queue of pending applications with Approve, Reject and Suspend buttons and a note field. It also shows the eRaktKosh collection card for the last 24 hours (success rate, response times, each state's last good fetch, worst first) and the collector's last sweep, in red once none has finished within the interval plus 2 hours.
- **Organizations:** every application, filterable by status.
- **Users:** search users by name or email, filter by role, and grant or remove admin rights. The database refuses to remove the last admin.
- **Audit log:** every admin action, with who did it and when.

Run `npm run db:make-admin -- <email>` to make the first admin.

#### Email/password sign-in
File: `src/app/login/`

Besides Google, you can now sign up and sign in with an email and password. New accounts confirm their address by email.

#### Privacy note, consent and account deletion
Files: `src/app/privacy/page.js`, `src/app/account/`, `src/lib/privacy.js`

India's Digital Personal Data Protection Act, 2023 asks for a notice, specific consent, and a way to withdraw it and have your data erased (#18).
- **`/privacy`** says what bloodLink stores and why, who can see it, which outside services receive what, how long it is kept, and how to use your rights. The footer links to it.
- **Consent.** Saving your details needs a tick against the current version of the note. The database records the version and stamps the time itself. When the note changes, its version date changes and the form asks again.
- **Account deletion.** `/account`, reached from your name in the header, deletes your account, profile, health answers and organization applications at once. The last admin can't delete theirs.

#### Less of your location leaves your browser
Files: `src/lib/geo.js`, `src/lib/geocoding.js`, `src/app/api/reverse-geocode/route.js`

A search pin is personal data: it shows where someone needs blood (#52).
- The pin is rounded to 3 decimals, about 110 m, in the browser and again on the server, so eRaktKosh, OSRM and Nominatim never get more.
- The place name under the map now comes from bloodLink's server. It asks Nominatim at most once a second and remembers each point for a week, so the app's total traffic stays within Nominatim's policy. Browsers no longer contact Nominatim at all.

#### Security headers
File: `next.config.mjs`

Every response now tells the browser not to let other sites frame bloodLink, to send only the site's address as the referrer, to let only bloodLink's own pages ask for your location, and not to guess file types (#51). A full Content-Security-Policy is reported in the browser console rather than enforced, until it has been checked on every page.

#### Live donor eligibility
File: `src/lib/eligibility.js`

Eligibility used to be a yes/no value saved when the form was submitted, so it never changed. It is now worked out each time the profile is viewed, from:
- age: 18 to 65, but at most 60 for a first donation
- the gap since the last donation: 90 days for men, 120 days otherwise
- the health answers: a tattoo, piercing or acupuncture in the last 12 months; pregnancy, breastfeeding, a birth in the last 12 months, or an abortion or miscarriage in the last 6; weight under 45 kg; medication; and the listed infections

`/peer-to-peer` shows the result, and, if you're deferred, the next date you can donate. The rules and the form's questions follow the National Blood Transfusion Council's 2017 donor-selection guidelines, clauses 2 to 4, 15 to 17 and 47. They were checked against the official text on 26 October, which fixed four mismatches (#24).

#### Better search results
Files: `src/lib/stock.js`, `src/app/search/page.js`

Each result card now shows:
- stock as unit counts per group
- a tap-to-call phone number
- a **Directions** link to Google Maps
- two ages: when the bank updated its stock and when bloodLink last checked it, for example "Bank updated 3 h ago · checked 12 min ago"

### Bug fixes

The first four groups are in commit `fdb2b2a`. The 23 and 24 October fixes are in `5af73b9`, on `supabase-migration`. The fixes from the 24 and 25 October reviews were committed on 26 October, on the same branch, and the later ones of that day on 3 November.

#### Security
- **Anyone could overwrite anyone's profile.** `/api/details` trusted the email address sent in the request. It now takes your identity from your sign-in session only.
- **Personal data in logs.** The same route printed phone numbers and health answers to the logs. It no longer does.
- **Open proxy.** The search routes forwarded any query string to eRaktKosh. They now accept only known parameters and are rate-limited per IP address.
- **Unvalidated form input.** The profile form now goes through a whitelist validator (`src/lib/profile.js`): phone format, no future dates, a valid state and district.

#### Search
- **Filters were silently ignored.** The app sent `districtCode` and `ComponentId`, but eRaktKosh only accepts `districtId` and `componentId`, and it is case-sensitive. District and component filters now work. For example, North Goa returns 3 banks instead of all 5.
- **Banks with no stock were listed.** eRaktKosh returns every bank whatever you filter for. Results are now filtered on real stock.
- **The search could freeze.** A failed request left the page loading forever. Errors now show a red notice, and the buttons work again.
- **The location button stayed disabled.** After a denied location permission, picking a point on the map now enables the search.
- **Old results stayed on screen.** A new search now replaces them, so "No results" shows correctly.
- **Slow and repeated requests.** Requests to eRaktKosh now time out after 25 s, results are cached for 5 min, and if eRaktKosh is down the app shows the last good result, marked as stale.
- **Too many map lookups.** The address lookup (Nominatim) fired on every map click, against its usage policy. It now waits until you stop clicking.

#### Profile form
- Editing your details now **prefills** the form instead of wiping your profile.
- The form now ends on a success state for non-donors too, instead of a blank step.
- Signing out mid-form is handled properly.

#### Code health
- Three copies of the search page (v1, v2, v3) became one `/search` page. The old copies were deleted on 4 November and remain in git history, for example `git show d3fa97d:archive/search-v1/page.js`.
- The lookup tables (states, districts, groups, components) were copied into five files. They now come from one place, `src/lib/constants.js`.
- `npm run lint` went from 9 errors to none.
- Leaflet's CSS no longer loads twice, and the map icons no longer come from a CDN.
- The default Next.js icons are gone from `public/`, `.gitattributes` keeps line endings LF on every system, and the committed `.env.example` lists every variable (#23).

#### Found in the 23 October cross-check
- **Two files were never formatted.** `.prettierignore` listed `supabase/`, which also matched `src/lib/supabase/`. The entries are now anchored to the app folder, and both Supabase client files are formatted.

The fixes found in the 24 October data checks (#36 to #41) are in `docs/SUMMARIES/data_quality.md`, under "Found in the 24 October data checks".

#### Found in the reviews of 24 and 25 October
#42 to #55 were found in the code, docs and plans review of 24 October; #56 to #60 in the review that checked it. All were fixed on 26 October. The ones left open are in `CLAUDE.md`.
- **#56 · The weekly prune could never run.** `prune_stock_store()` runs as the collector's role, which couldn't read `upstream_calls.called_at` in its `DELETE … WHERE`, so every prune failed with "permission denied" and nothing was trimmed. A migration grants that one column.
- **#57 · Collector failures were invisible.** The Task Scheduler wrapper dropped Node's exit code, so every run looked successful, and an error at the top of the collector bypassed its log. Both now report the failure.
- **#58 · An open redirect after email sign-in.** `/login?next=/%09/evil.com` passed the check, and browsers drop the tab, which leaves `//evil.com`. `safeNextPath` now refuses control characters and anything that resolves to another site.
- **#59 · Impossible dates were accepted.** JavaScript rolls "2026-02-30" over to 2 March, so it passed the check and then failed in the database with a vague error. Dates must now be real calendar dates.
- **#60 · One state's save error stopped the rest of the sweep.** It is now logged, and the sweep goes on.
- **#46 · "Today" was the UTC date.** Between midnight and 05:30 India time, a date of birth or donation of today was refused as being in the future, in the form and in the database. Both now use India's date.
- **#47 · The profile form preselected "male".** A donor who skipped the field got the 90-day gap instead of 120. Gender must now be chosen.
- **#42 · An admin's approved organization wasn't linked to them.** If they later lost the admin role, they became a plain user. They are now linked, and keep the admin role.
- **#43 · Re-approving an old application gave a server error** when the same person had another open one. It now says why (409).
- **#44 · The misplaced-bank count read 0 during an outage,** because the saved directory had already dropped those banks. It now keeps them, so the route counts them as it does for live data.
- **#53 · A signed-in user opening `/login?next=…` went to the home page.** They now go to `next`.
- **#48 · The home page promised direct contact with donors,** which the donor-network plan rules out. It now says donors are asked to give at a blood centre.
- **#55 · The documents disagreed with the repository.** They now live in `docs/`, point at one copy of each other, and say what is committed.
- **#45 · A district search during an outage missed banks with no coordinates.** Their saved rows had no district. It now comes from the end of the bank's address, which eRaktKosh writes as "…, district, state". That matched the known district for all 4,048 saved banks that have one, and places 674 of the 683 that had none; the other 9 have no address.
- **#50 · The saved copy was downloaded again for every filter.** Each state's rows are now downloaded once per 10 minutes and cut to the district, component and group in memory.
- **#51 and #52,** the security headers and the rounded pin, are described in section 1.
- **#54 · The `mongodb-final` tag** is now on GitHub.
- **#49 · Every page waited on a profile query.** The root layout read the session and the profile for the header, so no page could be prerendered, and a signed-in user's every page waited on a database round trip (a median 206 ms from the laptop to Tokyo). The header now reads the user in the browser. Six pages are prerendered, and signed out, the home page's median response went from 16.9 ms to 11.0 ms.
- **#24 · Donor screening differed from the national guidelines.** Checked against the official text of NBTC's 2017 guidelines: a first donation only up to 60, at least 45 kg rather than 50, 12 months after a tattoo, piercing or acupuncture rather than 6, and a new deferral after a birth (12 months) or an abortion (6 months).

### The move to Supabase

The app used MongoDB with NextAuth. It now uses **Supabase**, a hosted Postgres database with built-in sign-in.
- **Sign-in:** Supabase Auth handles Google and email/password. `src/proxy.js` keeps you signed in and guards pages, replacing the old `middleware.js`.
- **Database:**
  - The schema is a set of SQL files in `supabase/migrations/`, applied with `npm run db:migrate`.
  - Four tables for people and organizations: `profiles`, `donor_screening`, `organizations` and `audit_log`.
  - Four for saved eRaktKosh data, filled by the collector, which runs in Supabase every 4.5 hours: `blood_banks`, `bank_stock_latest`, `stock_history` and `upstream_calls`. Two more record the collector's own sweeps and runs: `collector_sweeps` and `collector_runs`.
- **Security in the database itself:**
  - Each user can read and edit only their own rows.
  - Users can never change their own role.
  - Health answers are visible only to their owner, not even to admins.
  - Admin actions run through checked database functions.
  - The app holds no master key. Everything runs as the signed-in user, or with the public key for the public stock tables.
- **Removed:** `src/lib/db.js`, the NextAuth route and `SessionWrapper.js`.
- **Region:** Mumbai (ap-south-1), the nearest to the app's users, since 2026-11-03 (#28). `scripts/copy-project.mjs` moved everything from Tokyo. A round trip from the laptop takes about 10 ms, against 175 ms to Tokyo.

### Report 3's status notes, by date

> **Status update, 26 October 2026 (later).** Consent, a privacy note and account deletion (#18) are now done, with security headers (#51) and a search pin rounded to about 110 m before it reaches any outside service (#52). Donor eligibility now follows NBTC's 2017 guidelines, checked against the official text (#24), and pages no longer wait on a profile query (#49). The database is moving from Tokyo to Mumbai (#28). There are 135 unit tests.

> **Status update, 3 November 2026.** The database moved from Tokyo to Mumbai (#28), and collection moved off the laptop to Supabase (#35, [point 3.1](docs/SUMMARIES/data_quality.md#collection-moved-to-supabase-3-november)): `pg_cron` and an Edge Function sweep all 36 states every 4.5 hours, around the clock, through the same `bloodlink_ingest` role. Measured on the laptop's hourly sweeps, 4.5 hours misses 4.9% of the updates hourly sweeps see, most of them values replaced within 10 minutes. Every change is archived, gzipped, in Supabase Storage, including all the laptop collected since 23 October, and a weekly task keeps a copy on the laptop. An early [walk-forward dry run](docs/SUMMARIES/ml_models.md#the-walk-forward-dry-run-4-november) of the forecast picks logistic regression, deciding nothing. There are 150 unit tests.

> **Status update, 4 November 2026.** The ETA benchmark is built, and its Google half has run. The travel-time design (M3) is 24.9% off Google's traffic-aware predictions on average, the closest of four methods, and it picks Google's first bank in 81% of searches ([point 2](docs/SUMMARIES/eta_benchmark.md#checked-against-google-4-november)). With latency, reliability, cost and effort weighed in, the rubric keeps it as the app's method, pending the team's agreement of the rubric. Rural base speed is the weak spot. Calibration from timed trips is still **Planned**. There are 199 unit tests.
>
> The forecast's [dry run](docs/SUMMARIES/ml_models.md#the-walk-forward-dry-run-4-november) now covers all seven models, with each input tested. Its interim choice is logistic regression, with the GBM classifier as the challenger: the GBM classifier ranks best (PR-AUC 0.269 at 48 h against 0.255), but its lead is inside the decision rule's 2-point margin, and the two tie on donor alerts. ETS, SARIMA and TSB fall below the best baseline. The December backtest decides.

> The spatial-indexing ambiguity the reviewer pointed out is now resolved. Search uses eRaktKosh's own `nearest` call, or a linear scan over the saved directory when that is down. The benchmark shows that is right at 4,328 banks. A PostGIS GiST index exists on `blood_banks.location`, but search doesn't use it yet. It is planned for the donor network, where the benchmark shows it is needed.
