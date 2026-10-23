# bloodLink

bloodLink is a final-year B.Tech project. It is a Next.js web app on Supabase that searches live blood stock at Indian blood banks through the government eRaktKosh API, ranks nearby sources for an emergency request, and is growing into a donor network. Hospitals and blood banks register and are verified by admins. The reports and slides in `../documentation/` define the promised scope, but they disagree with the code and with each other (issue #32).

**Path convention.** The app lives in `bloodlink/`. Every path in this file is relative to `bloodlink/` unless it starts with `../`. Run all npm commands from `bloodlink/`.

**How to use this file**
- This file is the single source of project guidance. It replaced the old AGENTS.md and ROADMAP.md.
- Other documents at the workspace root:
  - `../report3.md` records report 3's decisions, measurements and the answer to each reviewer suggestion.
  - `../data_integrity.md` checks reviewer point 3 (data quality, freshness and failures) and records the faults found and fixed on 2026-10-24.
  - `../features.md` describes the features, including the ranking formulas and the reasons for their weights.
  - `../supabase_scheduler.md` is the approved plan to move the collector to Supabase (#35). It isn't started; begin only when asked.
- `../CODE_REFERENCE.md` describes every function and variable, file by file. Update it when you add, rename or remove one.
- The known-issues list uses stable IDs, so a prompt can say "fix #26". When an issue is fixed, delete its entry and do not renumber the rest or reuse its ID. Add new findings with the next free ID, a severity and a tier.
- Facts marked *verified* were checked against the live eRaktKosh API or the live Supabase project on 2026-10-23, or on the date given.

## Workspace map

Edit only `bloodlink/`. Older copies of the app exist elsewhere in the workspace.

| Folder | What it is |
|---|---|
| `bloodlink/` | **The active app.** Git repo, remote `github.com/dark756/bloodlink`. Supabase work is on branch `supabase-migration`; tag `mongodb-final` marks the last MongoDB version. |
| `supabase/migrations/` | Database schema, applied with `npm run db:migrate`. The only place schema changes go. |
| `scripts/` | `migrate.mjs`, `make-admin.mjs` and `snapshot.mjs` run with Node against `SUPABASE_DB_URL`. `measure-search.mjs` times a running server. `benchmark-geo.mjs` compares spatial search methods, and `ranking-sensitivity.mjs` tests the weights. `build-traffic-profiles.mjs` and `build-state-boundaries.mjs` rebuild the traffic and state-outline assets. |
| `tests/` | Vitest unit tests for the pure modules in `src/lib/` and the eRaktKosh client. |
| `archive/` | The old search page iterations, kept for reference. Not routable and not linted. |
| `../redundant_bloodlink/bloodlink/` | April 2026 prototype: Next + TypeScript, Supabase, Expo, FastAPI. Abandoned. |
| `../redundant_bloodlink/bloodlink_borade/bloodlink-main/` | A teammate's Sept 2026 Supabase fork with dashboard scaffolds, request flows and notification adapters. Reference only; much of it falls back to mock data. |
| `../redundant_bloodlink/` top-level files | data.gov.in download scripts and dumps. `all_gov_data.json` holds about 2,800 blood banks. |
| `../blood_data/` | Collected data, outside the repo. `eraktkosh/` holds the collector's archive: changed stock per day (`history/*.ndjson`), weekly directory copies, `sweeps.ndjson` and `collector.log`. Point 3.2 adds other datasets. |
| `../rough_work/` | eRaktKosh endpoint notes and the density-aware ring-search spec at the bottom of `blood links.txt`. |
| `../documentation/` | Sem 6 ESE report and slides, Sem 7 progress report 1 and slides, and the reviewer's feedback file `suggested changes after sem 7 report 1.txt`. |
| `../Research Papers/` | Literature-survey PDFs. |

## Stack and commands

- **Framework:** Next.js 16.2.4 with the App Router, plain JavaScript, React 19.2, Tailwind CSS 4. Read `node_modules/next/dist/docs/` before using Next APIs; start with `01-app/02-guides/upgrading/version-16.md`.
- **Backend:** Supabase project `lhosczocktoklmqqudgm`, region ap-northeast-1 (Tokyo), Postgres 17. Supabase Auth handles Google and email/password sign-in. The app uses `@supabase/ssr` and `@supabase/supabase-js` with the publishable key only.
- **Maps and data:** Leaflet 1.9 with react-leaflet 5, axios, eRaktKosh as the live stock source, OSRM for road routes, TomTom Traffic Index profiles for time-of-day congestion, Open-Meteo for current rain.

```bash
npm run dev                          # dev server on http://localhost:3000
npm run build                        # production build (Next 16 does not lint during build)
npm start                            # serve the build
npm run lint                         # ESLint 9; passes with zero errors and warnings
npm run format                       # Prettier 3: rewrite files in the house style
npm run format:check                 # Prettier: list files that need formatting
npm test                             # Vitest; 118 tests in tests/
npm run db:migrate                   # apply pending supabase/migrations/*.sql
node scripts/migrate.mjs --status    # list applied and pending migrations
npm run db:make-admin -- a@b.com     # make an existing account the first admin
npm run snapshot -- --all --archive ../blood_data/eraktkosh   # save every state's stock (hourly job)
npm run snapshot -- --directory --prune                       # save the directory, trim history (weekly job)
npm run measure -- --base http://localhost:3000 --runs 10     # search response times; add --concurrency 20. Start the server with TRUSTED_PROXY_HOPS=1
node scripts/benchmark-geo.mjs ../blood_data/eraktkosh/directory/<nearest json> [--postgis]   # spatial search benchmark
node scripts/ranking-sensitivity.mjs ../blood_data/measurements/ranking_sensitivity          # weights ±20%
node scripts/build-traffic-profiles.mjs  # rebuild assets/traffic_profiles.json from TomTom (yearly)
node scripts/build-state-boundaries.mjs  # rebuild assets/state_boundaries.json from geoBoundaries (if boundaries change)
```

## Environment

Variables live in `.env.local`, kept out of git by the `.env*` rule.

| Variable | Used by | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | all Supabase clients | Public. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all Supabase clients | Public by design; row-level security protects the data. |
| `SUPABASE_DB_URL` | `scripts/` only | Session-pooler connection string with the database password. Never use it in app code. |
| `NEXT_PUBLIC_API_URL` | `src/lib/eraktkosh.js` | Optional eRaktKosh base override ending in `/`. Inlined at build time. |
| `NEXT_PUBLIC_CARTO_API_KEY` | `src/app/components/BloodMap.js` | Map tiles. Public by design. |
| `ERAKTKOSH_SIMULATE`, `ERAKTKOSH_SIMULATE_STATES` | `src/lib/eraktkosh.js` | Failure drill: `down`, `slow` or `flaky`, and state codes that always fail. Only outside production, or with `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1` on a local build. Never set on a deployed server. |
| `OSRM_URL` | `src/lib/routing.js` | Optional OSRM server ending in `/`. Defaults to the public demo server (one request a second, no heavy use). Server-only, read at runtime. |
| `TRUSTED_PROXY_HOPS` | `src/lib/rateLimit.js` | How many trusted proxies in front of the app add to `X-Forwarded-For`; the client's IP is that many entries from the right. Defaults to 1 on Vercel (`VERCEL` is set) and 0 elsewhere. At 0 the header is ignored and all callers share one rate limit, because on a bare `next start` the client writes it. Set it to 1 for `npm run measure` and the sensitivity capture, which simulate many users. |

`MONGO_URI`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are still in the file but no longer read by the app. The Google pair is what goes into the Supabase dashboard.

### One-time Supabase dashboard setup

1. **Authentication > Providers > Google:** enable it and paste the Google client ID and secret.
2. **Google Cloud console, OAuth client:** add `https://lhosczocktoklmqqudgm.supabase.co/auth/v1/callback` as an authorized redirect URI.
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
| `/set-details` | `src/app/set-details/page.js` | signed in | Three-step profile form. Prefills when editing. |
| `/peer-to-peer` | `src/app/peer-to-peer/page.js` | complete profile | Profile, role badge and live donor eligibility. |
| `/organization` | `src/app/organization/page.js` | signed in | Apply to register a hospital or blood bank; see review status and notes. |
| `/admin`, `/admin/organizations`, `/admin/users`, `/admin/audit` | `src/app/admin/` | admin | Overview and review queue, all applications, user roles, audit log. |
| `GET /api/search` | `src/app/api/search/route.js` | anyone | Region search. Validated, cached eRaktKosh proxy. `X-Data-Source`, `X-Data-Fetched-At` and `X-Data-Upstream` headers say how fresh it is. |
| `GET /api/blood-search` | `src/app/api/blood-search/route.js` | anyone | Location search: nearest mode or ranked mode. |
| `GET /api/nearest` | `src/app/api/nearest/route.js` | anyone | Validated eRaktKosh `nearest` proxy. Unused by pages. |
| `GET`/`POST /api/details` | `src/app/api/details/route.js` | signed in | Read and save your own profile. |
| `GET`/`POST /api/organization` | `src/app/api/organization/route.js` | signed in | Your applications; submit a new one. |
| `POST /api/admin/organizations/review` | `src/app/api/admin/organizations/review/route.js` | admin | Approve, reject or suspend. |
| `POST /api/admin/users/role` | `src/app/api/admin/users/role/route.js` | admin | Grant or remove the admin role. |

`src/proxy.js` runs before every page request. It refreshes the Supabase session cookie with `getClaims()` and sends signed-out users from protected pages to `/login?next=`. It also sends incomplete profiles from `/peer-to-peer` to `/set-details` and non-admins away from `/admin`. Admin pages check the role again in `src/app/admin/layout.js`, and the database checks it a third time.

### Shared modules in `src/lib/`

| Module | What it does |
|---|---|
| `supabase/client.js`, `supabase/server.js` | Browser and server Supabase clients. The server client runs as the signed-in user. |
| `auth.js` | `getCurrentUser` (verified claims), `getCurrentProfile`, `requireUser`, `requireAdmin`, `safeNextPath`. |
| `constants.js` | States, districts, blood groups and components from `assets/district_data.json`. Codes are strings. |
| `eraktkosh.js` | Server-only eRaktKosh client built by `createEraktkoshClient`: parameter whitelist and aliases, validation, 5 min cache, per-state and service-wide circuits, retry, 8 s give-up, saved-copy fallback, failure simulator, `summarizeFreshness`. |
| `stock.js` | Parses `available_WithQty` with canonical group names, units per component (matched by name only), `exactGroupUnits`, `keepOnlyComponent`, `isDormant` (30 days), phone extraction, "updated N ago", `cleanText`. No imports, so scripts can use it. |
| `stockQuality.js` | Pure validator for eRaktKosh rows: unit range, group names, future dates, duplicates. Returns `{ rows, report }`. Used by the app and `scripts/snapshot.mjs`. |
| `stockStore.js` | Server-only reads of the saved copy (`bank_stock_latest`, `blood_banks`) with the publishable key, in eRaktKosh's own shapes. With a `componentId`, saved rows are cut to that component, as a live filtered answer is. |
| `geo.js` | `haversineMeters` and `isInIndia`. |
| `stateBounds.js` | `createStateChecker(boundaries)`: whether a bank's point lies in its own state (5 km margin), from `assets/state_boundaries.json`. `locationProblem` returns `missing`, `outside_india`, `wrong_state` or `null`. Pure; the caller passes the JSON in, so scripts can use it. |
| `rings.js` | Which search ring results come from: `nearestModeRing` and `rankedModeRing`. Dormant banks never decide the ring. |
| `compatibility.js` | Donor groups a recipient can receive, per component category. Not used by search since report 3 (exact group only); kept for donor matching. |
| `ranking.js` | Source scoring (ETA, coverage, surplus, freshness), urgency weights and the greedy response plan. |
| `traffic.js` | Pure travel-time model: traffic zone, congestion by India-time weekday, hour and month, rain factor, ETA. Reads `assets/traffic_profiles.json`. |
| `routing.js` | Server-only OSRM table client: road distance and free-flow time per bank, 24 h cache, one request a second on the public server. |
| `weather.js` | Server-only Open-Meteo client: current rain in mm/h, 15 min cache. |
| `eligibility.js` | Donor eligibility computed on every read. |
| `profile.js`, `organization.js` | Whitelist validators for the profile and organization forms. `trimText` and `PHONE_PATTERN` are shared from `profile.js`. |
| `format.js` | Display helpers: `formatDate`, `formatDateTime`, `hoursSince`, `formatTimeAgo`, `capitalize`, `getInitials`. |
| `profileStore.js` | Maps the page's `details` object to and from the `profiles` and `donor_screening` rows. |
| `rateLimit.js` | Per-IP in-memory rate limits for the search routes. The IP comes from `X-Forwarded-For` only behind trusted proxies (`TRUSTED_PROXY_HOPS`); otherwise all callers share one limit. |

### Location search and ranking

`GET /api/blood-search` takes `lat`, `lng`, optional `componentId` and `bloodGroupId`, and in ranked mode `units` (1 to 50) and `urgency` (`critical`, `urgent` or `routine`). The old `compatible` parameter is ignored.
1. One eRaktKosh `nearest` call with a 150 km radius returns the nearby banks. At the same time, Open-Meteo is asked for rain at the pin.
   - Banks whose point lies outside their own state (or India) are left out, because their distance is meaningless (`stateBounds.js`). The response's `misplacedBanks` says how many within the widest ring, and the page says so. Region search still lists them.
2. More than 10 banks within 15 km means an urban area, with rings of 5, 10, 15 and 25 km. Otherwise the area is rural, with rings of 20, 50, 100 and 150 km.
3. Stock is fetched once per state involved, in parallel, and joined on `String(hospitalCode)`. Alongside it, one OSRM table call routes every candidate bank.
4. **Nearest mode**, when the component or the group is missing, returns the smallest ring with an active (not dormant) bank holding matching stock, or, if every such bank is dormant, the smallest ring with any. Results are sorted by straight-line distance, and each bank has a road ETA.
5. **Ranked mode**, when both are given:
   - Only banks listing the exact blood group count (`exactGroupUnits`). Compatible substitutes are not used.
   - It grows the ring until the active banks inside it cover the units needed.
   - It scores each bank with `rankSources` and splits the request with `buildResponsePlan`.
6. Every result carries `roadDistanceM`, `etaMinutes` and `etaSource` (`road` or `estimate`). The response has a `travel` block: zone, city, India time, congestion %, label and rain.

Travel time in `src/lib/traffic.js` is free-flow time × (1 + congestion / 100) × rain factor.
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
- **Rain:** × 1.15 at 2.5 mm/h or more, × 1.3 at 7.6 mm/h or more.
- `report3.md` at the workspace root has the measurements and sources behind each number.

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

How the saved copy is collected:
- `scripts/snapshot.mjs` writes it, validated with `stockQuality.js`, as the `bloodlink_ingest` role.
- Full rows are uploaded only for banks whose update time changed; the others get a new `fetched_at`.
- Windows Task Scheduler on the project laptop runs it:
  - `\bloodLink\Stock snapshot (hourly)`: all states;
  - `\bloodLink\Directory snapshot and prune (weekly)`: Mondays.
- Both run `../blood_data/scripts/run_collector.ps1` through a hidden PowerShell.
  - It starts Node in its own hidden console, with `--log ../blood_data/eraktkosh/collector.log`. Two early runs were killed by a console signal after the first state; the cause is unknown.
  - The collector logs any such signal with the time and carries on after Ctrl+C.
  - Running outside the user's session (S4U) would need administrator rights.
- To remove both: `Unregister-ScheduledTask -TaskPath '\bloodLink\' -TaskName * -Confirm:$false`.

### Sign-in, profile and verification

1. Sign-in uses Supabase Auth: Google OAuth or email/password, with PKCE through `/auth/callback`.
2. A trigger on `auth.users` creates a `profiles` row with the name from the sign-in metadata.
3. `/set-details` posts to `/api/details`. The route validates with `sanitizeDetails`, then updates `profiles` and upserts `donor_screening`, as the user, through row-level security. If the person isn't a donor, their screening row is deleted.
4. A trigger keeps `is_profile_complete` in sync, so the proxy reads completeness straight from the database.
5. A user applies on `/organization`, which inserts a `pending` row in `organizations`. An admin approves it with `review_organization()`, which sets the applicant's role to `hospital` or `blood_bank` and writes `audit_log`. Rejecting or suspending removes that role.
6. Admin roles change only through `set_user_role()`, which refuses to remove the last admin. The first admin comes from `npm run db:make-admin`.

### Data model and security

Schema is in four migrations: `supabase/migrations/20261023000100_init.sql` (people and organizations), `20261023000200_stock_store.sql` (saved eRaktKosh data), `20261023000300_blood_bank_locations.sql` (PostGIS) and `20261024000100_wrong_state_locations.sql` (the `wrong_state` flag).

| Table | Contents | Who can read | Who can write |
|---|---|---|---|
| `profiles` | Personal details, `blood_group_code` (eRaktKosh code), `is_donor`, `role`, `organization_id` | Owner; admins | Owner, but only the personal columns. Role and completeness are never client-writable. |
| `donor_screening` | Last donation date and health answers | Owner only, not admins | Owner |
| `organizations` | Hospital and blood-bank applications with `status` | Applicant; admins | Applicant inserts as `pending` and may edit while pending; status changes only through `review_organization()` |
| `audit_log` | Admin actions | Admins | Database functions only |
| `blood_banks` | Directory from a nationwide `nearest` call: code, name, contact, state, district, coordinates, `location_quality` (`ok`, `shared`, `wrong_state`, `outside_india` or `missing`), and `location`, a generated PostGIS geography point with a GiST index, null for `wrong_state` and `outside_india` | Anyone | `bloodlink_ingest` only |
| `bank_stock_latest` | One validated eRaktKosh row per bank (`row` jsonb, same shape as live), `entry_at`, `fetched_at` | Anyone | `bloodlink_ingest` only |
| `stock_history` | Compact stock whenever a bank's update time changes; unique on bank and `entry_at`; pruned at 60 days | Anyone | `bloodlink_ingest` only |
| `upstream_calls` | One row per collector call: endpoint, state, ok, status, time, bytes, rows, failure kind, validation counts | Admins (`is_admin()`), plus the `upstream_stats` view | `bloodlink_ingest` only |

- **Row-level security** is on for every table. Grants are explicit and column-level, so the dashboard's "expose new tables" setting doesn't matter.
- **Constraints:** CHECK constraints and triggers enforce the same value rules as `src/lib/profile.js` and `src/lib/organization.js`, plus "no future dates".
- **Admin functions:** `is_admin()`, `review_organization()` and `set_user_role()` are `security definer` with an empty `search_path`. They raise SQLSTATE 42501, 22023 or P0002, which `src/app/api/admin/rpcError.js` maps to HTTP status codes.
- **No service-role key** exists in the app. Everything runs as the signed-in user, or with the publishable key for the public stock tables.
- **`bloodlink_ingest`** is a no-login role. The collector connects with `SUPABASE_DB_URL` and runs `set role bloodlink_ingest`, so its session can touch only the stock tables. `prune_stock_store()` is executable only by it.

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
- **Stock age.** The median is 9.7 h, and 6.3% of banks are older than 30 days.
- `district_data.json` uses eRaktKosh codes, not census codes; for example, 99 is Uttar Pradesh.
  - It is a copy of `POST master/all` with `{"hospitalCode":100}`, refreshed on 2026-10-23: 781 districts, with Markapuram, Polavaram and Tamulpur added and Majuli removed. Refresh it now and then.
- **Banks with automatic refresh.** `master/portal-refresh-hospitals` lists 452 banks whose stock eRaktKosh refreshes automatically. Their median stock age is 0.3 h, against 9.7 h for the rest.
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
- **Formatting.** Prettier 3, settings in `.prettierrc.json` (`printWidth` 100, otherwise defaults). Run `npm run format` before committing. `.prettierignore` skips the top-level `archive/`, `assets/`, `public/` and `supabase/` folders (anchored with `/`, so `src/lib/supabase/` is still formatted) and Markdown.
- **Naming.**
  - `camelCase` for variables and functions, `PascalCase` for components and their file names, `UPPER_SNAKE_CASE` for module-level constants.
  - `is`/`has`/`can` for booleans, `handleX` for event handlers, `onX` for callback props.
  - `snake_case` appears only in database columns and raw eRaktKosh fields. Normalized objects use camelCase, so `row.entrydate` becomes `entryDate`.
- **Styling.** Use the classes in `src/app/globals.css`: `page-wrap`, `card`, `btn btn-primary`, `badge badge-green`, `notice notice-warn` and the rest, plus Tailwind. The theme is light-only, with brand red `#d32f2f`.
- **Medical copy.** Label eligibility, compatibility and ranking output as informational. Blood banks do the real screening and cross-matching (issue #24).
- **Credits.** The search page must keep the OSRM / OpenStreetMap, TomTom, Open-Meteo and DataMeet / geoBoundaries credit line. The public OSRM and Open-Meteo services and the CC BY 2.5 IN state outlines require it.

## Verifying changes

- `npm run lint`, `npm run format:check`, `npm test` and `npm run build` must all pass.
- **Region search:** Goa (`stateCode` 30) has 5 banks, and district 585 narrows it to 3.
- **Location search:** Mumbai (19.0760, 72.8777) comes back `urban` with a 5 km ring and `travel.zone` `metro`. A ranked search there for O- red cells, `componentId=12&bloodGroupId=16&units=3&urgency=critical`, returns a plan, and every result's stock is O-Ve only. Starting the server with `OSRM_URL=http://127.0.0.1:9/` must still answer, with every bank's `etaSource` set to `estimate`.
- **Misplaced banks:** a ranked search in central Delhi (28.6139, 77.2090) lists only banks whose address is in Delhi, with `misplacedBanks` above 0.
- **Rate limit:** on a server without `TRUSTED_PROXY_HOPS`, 21 location searches in a minute, each with a new `X-Forwarded-For`, must end in a 429.
- **Security:** with a signed-in non-admin, the Data API must refuse `profiles.update({ role })` with 42501, and `/api/admin/*` must return 403. With the publishable key, the stock tables are readable, while `upstream_calls`, every insert or update, and `rpc/prune_stock_store` are refused with 42501.
- **Failure drill:** build, then start `next start` with `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1` and `ERAKTKOSH_SIMULATE=down`.
  - Every search must still answer, from `source: "saved"`.
  - A ranked search near Saifai (26.9608, 78.9621) for A+ red cells must not list bank 1702, which holds only plasma.
  - `slow` must serve the saved copy after 8 s.
  - `ERAKTKOSH_SIMULATE_STATES=27` must keep other states live, even after several Maharashtra failures in a minute.
  - Add `TRUSTED_PROXY_HOPS=1` when a script sends many searches.
  - `report3.md` and `../data_integrity.md` have the reference results.
- **Performance:** `npm run measure` against a fresh server started with `TRUSTED_PROXY_HOPS=1`; compare with the table in `report3.md`.
- **End to end:** on 2026-10-23, a throwaway script ran 47 checks against the live project. It seeded users directly into `auth.users`, signed them in, and exercised every flow and refusal, then deleted them. It is not in the repo because it writes to the auth schema of the live project; see issue #20.

## Known issues, prioritized

Each issue has an urgency tier and a severity tag. The list is sorted by tier, then severity.
- **Tiers:** P0 = fix now. P1 = the next few prompts. P2 = before big new features. P3 = later.
- **Severity:** Critical = data exposure or corruption. High = the core feature gives wrong answers or none, or a serious security risk. Medium = degraded behavior or a latent risk. Low = cleanup.

Fixed, IDs not to be reused: #1 to #17, #21, #22, and #36 to #41. #9 and #16 went away with the move to Supabase Auth and `src/proxy.js`. #36 to #41 were found and fixed on 2026-10-24; see `../data_integrity.md`.

### P0 · fix now

**#26 · High · Weak database password, shared in chat.**
- The Postgres password is short and guessable, and the session pooler is reachable from the internet.
- Reset it in Dashboard > Project Settings > Database. Then update `SUPABASE_DB_URL` in `.env.local` only.

**#25 · Medium · Google sign-in needs dashboard setup.**
- Google sign-in fails until the one-time setup above is done. Email/password sign-in works now.

### P1 · next

**#32 · Medium · The documents claim features the code doesn't have.**
- The Sem 7 slides list a greedy-knapsack planner, a chronic-care module and Firebase/OneSignal notifications. The progress report names an Express/MongoDB/JWT stack and a 4,487-record master directory. No kept dataset has 4,487 records; `../data_integrity.md` gives the dated counts to use instead.
- The reviewer asked for completed and planned work to be separated. Update the documents to match: the stack is Next.js on Supabase, and the ranking engine and response plan now exist.

**#27 · Medium · Default Supabase email is rate-limited.**
- Sign-up confirmation emails go through Supabase's built-in sender, which allows only a few emails per hour.
- Configure custom SMTP in Authentication > Emails before real users sign up.

### P2 · soon

**#20 · Medium · No CI and no committed end-to-end tests.**
- 118 unit tests run with `npm test`. Response times and the failure drill are measured by hand; see `report3.md` and `../data_integrity.md`.
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

**#28 · Low · Database region is far from users.**
- The project is in Tokyo, so every query from India adds noticeable latency. Measured: about 175 ms per round trip and 1.2 s to connect. The collector's first full upload took minutes because of it.
- Before real data accumulates, consider recreating the project in ap-south-1 (Mumbai) and re-running the migrations.

**#35 · Low · Collection runs only while the project laptop is on.**
- The hourly task needs this machine and a logged-in user, so the history will have gaps.
- Fix: `../supabase_scheduler.md`, approved on 2026-10-23, moves collection to Supabase: `pg_cron` plus an Edge Function, every 4.5 hours.
  - The laptop tasks are disabled at cutover and deleted after a 24-hour watch.
  - A weekly laptop task then keeps a local copy of the archive.
  - It isn't started; it begins with `npx supabase login` when asked.

### P3 · later

**#18 · Medium · Consent and account deletion.**
- Health answers are now owner-only and are deleted when someone stops being a donor.
- Before a public launch, India's Digital Personal Data Protection Act (2023) still calls for consent text, a privacy note and a self-service way to delete an account.

**#19 · Medium · Secrets in archive folders.**
- `../redundant_bloodlink/bloodlink/.env` and `.env.local` hold real-looking Supabase service-role, OpenRouter, SMS and data.gov.in keys.
- `../redundant_bloodlink/save_blood.js` and `something.js` hardcode a data.gov.in key.
- Revoke or rotate them, then delete them. Never copy the values anywhere.

**#24 · Medium · Screening thresholds are unverified.**
- `src/lib/eligibility.js` uses age 18 to 65, and a 90-day gap for men or 120 days otherwise. The form asks about a 6-month tattoo window and 50 kg.
- Check all of these against the current NBTC (National Blood Transfusion Council) guidelines.

**#29 · Low · Scripts skip TLS certificate checks.**
- `scripts/migrate.mjs`, `make-admin.mjs`, `snapshot.mjs` and `benchmark-geo.mjs` use `rejectUnauthorized: false`.
- Download the Supabase CA from Dashboard > Database > SSL and pass it as `ssl.ca`.

**#23 · Low · Housekeeping.**
- The default Next assets are still in `public/`.
- There is no `.gitattributes`.
- `.env.local` still holds the unused MongoDB and NextAuth values.

## Where to go next

1. **Finish the platform basics.** Rotate the database password (#26), do the Google setup (#25), set up custom SMTP (#27), align the documents (#32), and add CI (#20).
2. **Re-place the banks location search can't use:** the 679 without coordinates (#33) and the 206 in the wrong state (#34).
3. **Move collection off the laptop** with `../supabase_scheduler.md` (#35), when asked. Check that the first weekly directory run, on Monday 2026-10-26, logged its flags in `../blood_data/eraktkosh/collector.log`.
4. **Stock-out forecasting** (reviewer point 5).
   - Let history accumulate, and re-run `python -I blood_data/scripts/validate_history.py blood_data` from the workspace root now and then.
   - Once about 8 weeks exist, around late December 2026, compare the baselines, the statistical models and gradient-boosted trees by walk-forward backtest (`report3.md`, point 5).
5. **Build hospital and blood-bank dashboards.** Verified accounts get a role but no tools yet.
   - A blood bank links its eRaktKosh code, sees requests for its stock and confirms reservations.
   - A hospital creates emergency requests and sees ranked sources with the response plan.
6. **Build the donor network.**
   - Add donor location as a PostGIS `geography` point with a GiST index. The benchmark in `report3.md`, point 4, shows an index is 75 to 300 times faster than a scan at 100,000 points and more.
   - Add `blood_requests` and `donor_responses` tables with row-level security.
   - Match donors with the existing compatibility, eligibility and ranking modules, masking contact details until both sides accept.
   - Notifications: in-app first, then email, then SMS. The fork has MSG91, Fast2SMS and Twilio adapters.
7. **Routing and ETA.** Self-host OSRM (Docker, Geofabrik India extract) before real traffic, and calibrate the town and rural values against timed trips (see `report3.md`, point 4).
8. **Ship.** Deploy to Vercel, add consent and account deletion (#18), and build a PWA before any native mobile app.
