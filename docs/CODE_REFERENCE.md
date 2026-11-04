# bloodLink code reference

This lists every function, component, constant and variable in the app, file by file, with one line on what each one is or does.

- Paths are relative to `bloodlink/`.
- **The ETA bench** (its scripts, `etaMetrics.js`, `etaRubric.js` and their tests) is in `../rough_work/eta_benchmarks/`, outside git, since 4 November. Its `README.md` lists its functions in the same form. It imports the app's own modules, such as `src/lib/trafficModel.js` below.
- **Kinds:** *function*, *component* (a React component), *hook*, *constant* (a fixed module-level value), *variable*, *state* (a React `useState` value and its setter), *class*, *handler* (a route handler such as `GET`).
- **Inside** says where a name is declared: *module* means the top level of the file; otherwise it is the function the name lives in.
- Callback parameters such as `(bank) => …` are named after the item they hold, so they aren't listed.
- The names in [Common names](#common-names) mean the same thing in every file and aren't repeated per file.

**Contents**
1. [Naming and formatting](#naming-and-formatting)
2. [Common names](#common-names)
3. [Data shapes](#data-shapes)
4. [Shared modules, `src/lib/`](#shared-modules-srclib)
5. [Proxy, `src/proxy.js`](#proxy-srcproxyjs)
6. [API routes, `src/app/api/` and `src/app/auth/`](#api-routes)
7. [Pages and components, `src/app/`](#pages-and-components)
8. [Admin pages, `src/app/admin/`](#admin-pages-srcappadmin)
9. [Tests, `tests/`](#tests)
10. [Scripts and config files](#scripts-and-config-files)
11. [Edge Functions, `supabase/functions/`](#edge-functions-supabasefunctions)
12. [Database, `supabase/migrations/`](#database)

---

## Naming and formatting

| Style | Used for | Examples |
|---|---|---|
| `camelCase` | variables, functions, object fields | `unitsNeeded`, `rankSources`, `entryDate` |
| `PascalCase` | React components and their files; classes | `BloodMap` in `BloodMap.js`, `UpstreamError` |
| `UPPER_SNAKE_CASE` | fixed module-level values | `MAX_UNITS`, `PHONE_PATTERN`, `ORGANIZATION_KINDS` |
| `is` / `has` / `can` prefix | true/false values | `isSaving`, `hasCoords`, `canRank` |
| `handle` prefix | event handlers inside a component | `handleSubmit`, `handleUseMyLocation` |
| `on` prefix | callback props passed to a component | `onCoordsChange`, `onMapClick` |
| `snake_case` | only database columns and raw eRaktKosh fields | `full_name`, `blood_group_code`, `entrydate` |
| `kebab-case` | URL paths and CSS classes | `/set-details`, `notice-warn` |

- Database rows keep their `snake_case` column names in JavaScript, because that is what Supabase returns.
- Raw eRaktKosh fields keep eRaktKosh's own spelling (`hospitalname`, `available_WithQty`). Once a row is normalized, its fields are `camelCase`: `row.entrydate` becomes `entryDate`.
- Code is formatted by Prettier 3: 2-space indents, double quotes, semicolons, trailing commas, lines up to 100 characters. The settings are in `.prettierrc.json`.
  - `npm run format` rewrites files, and `npm run format:check` reports any that need it.
  - `.prettierignore` skips the top-level `assets/`, `public/` and `supabase/` folders, plus Markdown files. The entries start with `/` so that `src/lib/supabase/` is still formatted.

## Common names

| Name | Meaning wherever it appears |
|---|---|
| `supabase` | The Supabase client for this request. It acts as the signed-in user, so row-level security applies. |
| `data`, `error` | The result and the error returned by a Supabase or axios call. |
| `err` | A caught error. Pages use `err` because `error` is already their error-message state. |
| `request` | The incoming HTTP request, in route handlers and the proxy. |
| `response` | An HTTP response. In API routes it is the ready-made 401/403 response from `requireUser` or `requireAdmin`. |
| `searchParams` | The URL's query parameters. |
| `params` | Query parameters being built or forwarded. In server pages, the awaited `searchParams` prop. |
| `body` | The parsed JSON body of a POST request. |
| `user` | The signed-in user, `{ id, email, name, avatarUrl }`, from `getCurrentUser`. |
| `profile` | A `profiles` row with `snake_case` columns. On `/peer-to-peer` it is the whole `/api/details` response. |
| `router` | The Next.js router from `useRouter()`, used for `push` and `refresh`. |
| `event` | The browser event passed to an event handler. |
| `isCancelled` | Set when an effect is cleaned up, so a late response doesn't update a page that has gone away. |
| `setSomething` | The setter that comes with the React state `something`. |
| `a`, `b` | The two items being compared in a `.sort()` callback. |
| `sum` | The running total in a `.reduce()` callback. |
| `metadata` | A page's title and description for the browser tab, read by Next.js. |
| `GET`, `POST` | The route handler for that HTTP method. |

## Data shapes

**`details`:** the profile object passed between `/set-details`, `/api/details` and `/peer-to-peer`. It is built by `sanitizeDetails`, and `profileStore.js` maps it to and from the `profiles` and `donor_screening` tables.

| Field | What it holds |
|---|---|
| `fullName`, `dob`, `gender`, `phone` | Name, date of birth (`YYYY-MM-DD`), `male`/`female`/`other`, and phone number. |
| `stateCode`, `districtCode` | eRaktKosh state and district codes, as strings. |
| `emergencyContact` | `{ name, phone }` of the emergency contact. |
| `bloodGroupId` | eRaktKosh blood-group code, for example `"16"` for O-. |
| `isDonor` | Whether the person is willing to donate. |
| `donorDetails` | Only for donors; otherwise `null`. Holds `lastDonationDate`, `donationCamp`, `recentTattoo`, `pregnant`, `underweight`, `onMedication`, `medicationDetails` and `hasDisease`. |

**Bank result:** one blood bank in search results, from `normalizeAvailabilityRow` or `toBankResult`.

| Field | What it holds |
|---|---|
| `hospitalCode` | eRaktKosh's id for the bank, as a string. |
| `name`, `address`, `phone`, `type` | Cleaned display details. |
| `entryDate` | When the bank last updated its stock: `"YYYY-MM-DD HH:mm:ss"` in Indian time. |
| `stock` | `{ components: [{ component, units: [{ group, units }], total }], totalUnits }`. |
| `latitude`, `longitude`, `distanceM` | Location and straight-line distance in meters. Location search only. |
| `roadDistanceM`, `etaMinutes`, `etaSource` | Road distance from OSRM (`null` without a route), minutes at this hour, and `"road"` or `"estimate"`. Added by `estimateTravel`. Location search only. |
| `checkedAt`, `isDormant` | When bloodLink fetched the bank's stock, and whether the bank hasn't updated it for 30 days. |
| `units`, `groupName` | Units of the exact blood group asked for, and its name. Ranked search only. |
| `score`, `rank`, `breakdown`, `reasons` | Added by `rankSources`. `breakdown` holds the four part scores (`eta`, `coverage`, `surplus`, `freshness`), and `reasons` holds three sentences. |

**Response plan:** `{ steps, unitsNeeded, unitsCovered, shortfall }`, from `buildResponsePlan`. Each step is `{ hospitalCode, name, phone, etaMinutes, units }`: how many units to take from that bank.

**Freshness block:** the `freshness` field of a location-search response, from `summarizeFreshness`: `{ source, fetchedAt, oldestFetchedAt, upstream, failedStates, locationsSource, locationsFetchedAt }`.
- `source`, `fetchedAt` and `oldestFetchedAt` describe the stock lookups only. `source` is the worst one used: `live`, `cache`, `memory` or `saved`.
- `locationsSource` and `locationsFetchedAt` describe the `nearest` lookup, whose saved copy is refreshed only weekly.
- `upstream` is `ok`, `degraded` or `down`, over both.
- Region search sends the same facts as `X-Data-Source`, `X-Data-Fetched-At` and `X-Data-Upstream` headers.

**`misplacedBanks`:** a location-search response field: how many banks within the widest ring were left out because eRaktKosh places them outside their own state.

**Travel block:** the `travel` field of a location-search response, from `trafficConditions` plus counts: `{ zone, city, localTime, congestionPercent, label, rainMmPerHour, rainFactor, roadRoutes, estimated, routingDegraded }`.

---

## Shared modules, `src/lib/`

### `src/lib/constants.js`
Lookup tables from `assets/district_data.json`. Codes are always strings.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `districtData` | import | module | The contents of `assets/district_data.json`: states, districts, blood groups and components. |
| `compareByNumericCode(a, b)` | function | module | Sort comparator that orders lookup rows by their numeric code. |
| `STATES` | constant | module | Every state and union territory, each with its districts. |
| `BLOOD_GROUPS` | constant | module | `[{ code, name }]` for all blood groups, sorted by code. |
| `COMPONENTS` | constant | module | `[{ code, name, shortName }]` for all blood components, sorted by code. |
| `findState(stateCode)` | function | module | The state object for a code, or `null`. |
| `districtsFor(stateCode)` | function | module | A state's districts, or `[]`. |
| `getStateName(stateCode)` | function | module | A state's name, or `null`. |
| `getDistrictName(stateCode, districtCode)` | function | module | A district's name, or `null`. |
| `getBloodGroupName(code)` | function | module | A blood group's name, such as `"O-Ve"`, or `null`. |
| `getComponentName(code)` | function | module | A component's name, such as `"Packed Red Blood Cells"`, or `null`. |

### `src/lib/eraktkosh.js`
Server-only eRaktKosh client. It validates parameters and rows, caches answers, and falls back to the copy in memory or the copy saved in Supabase when eRaktKosh is slow or down. Every answer is `{ data, source, fetchedAt, stale, upstream }`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BASE_URL` | constant | module | eRaktKosh API address. `NEXT_PUBLIC_API_URL` overrides it. |
| `TIMEOUT_MS` | constant | module | 25 s; the longest wait for eRaktKosh. |
| `BACKUP_GIVE_UP_MS` | constant | module | 8 s; when a backup exists, the client serves it after this long. |
| `CACHE_TTL_MS` | constant | module | 5 min; how long a cached answer counts as fresh. |
| `MAX_CACHE_ENTRIES` | constant | module | 300; past this, the oldest cached answer is dropped. |
| `CIRCUIT` | constant | module | 3 failures within 60 s open a circuit for 120 s. `serviceMinCircuits` (2): the service-wide circuit needs failures from at least that many circuits. |
| `SLOW_SIMULATION_MS` | constant | module | 12 s; the delay `ERAKTKOSH_SIMULATE=slow` adds. |
| `MAX_NEAREST_RADIUS_M` | constant | module | 200 km; the largest radius `/api/nearest` accepts. |
| `FAILURE_KINDS` | constant | module | `timeout`, `network`, `http`, `shape` and `circuit`. |
| `UpstreamError` | class | module | Error thrown when eRaktKosh fails and no copy exists. `kind` is one of `FAILURE_KINDS`. |
| `classifyError(error)` | function | module | Which failure kind an error is. |
| `isRetryable(error)` | function | module | Network errors and 5xx answers get one quick retry. |
| `createEraktkoshClient({ http, savedStore, now, simulate, simulateStates, cache, timeoutMs, backupGiveUpMs, slowSimulationMs, retryDelayMs })` | function | module | Builds a client with everything passed in, so tests can fake the network, the saved copy and the clock. Returns `{ fetchAvailability, fetchNearest }`. |
| `newCircuit()` | function | `createEraktkoshClient` | A closed circuit: `{ recentFailures, openUntil, isProbing }`. `recentFailures` holds `{ time, circuitKey }`. |
| `service` | variable | `createEraktkoshClient` | The service-wide circuit. It opens only when recent failures come from at least two circuits. |
| `circuits`, `circuitFor(circuitKey)` | variable | `createEraktkoshClient` | One circuit per state's stock lookups and one for `nearest`, created on first use. |
| `callsInFlight` | variable | `createEraktkoshClient` | Live calls in progress by cache key, so concurrent searches share one. |
| `circuitState(circuit)` | function | `createEraktkoshClient` | `"closed"`, `"open"`, or `"probe"` once the open period is over and no request is testing eRaktKosh. |
| `isCircuitOpen(circuitKey)` | function | `createEraktkoshClient` | Whether to skip eRaktKosh: either the service or this lookup's circuit is open. After an open period, one request may test it. |
| `ownCircuit`, `serviceState`, `ownState` | variable | `isCircuitOpen` | This lookup's circuit, and the two circuits' states. |
| `closeCircuit(circuit)` | function | `createEraktkoshClient` | Clears a circuit's failures and closes it. |
| `recordSuccess(circuitKey)` | function | `createEraktkoshClient` | Closes the service circuit and this one: any answer shows eRaktKosh is up. |
| `recordFailure(circuitKey)` | function | `createEraktkoshClient` | Counts a failure in this circuit and the service one, and opens each when its rule is met. |
| `time`, `isRecent`, `failingCircuits`, `minCircuits` | variable | `recordFailure` | The failure time, the 60 s window test, the circuits the recent failures came from, and how many are needed to open. |
| `requestOnce(path, params)` | function | `createEraktkoshClient` | One GET, with the simulator, the shape check and validation of stock rows. |
| `response` | variable | `requestOnce` | The axios response. |
| `requestLive(path, params, circuitKey)` | function | `createEraktkoshClient` | `requestOnce` plus one retry; updates the circuits; throws an `UpstreamError`. |
| `remember(cacheKey, data)` | function | `createEraktkoshClient` | Stores an answer in the cache. |
| `entry` | variable | `remember` | `{ data, fetchedAt }`. |
| `answer(entry, source, upstream)` | function | `createEraktkoshClient` | The answer object for a cache entry or saved copy. |
| `loadSaved(loader, params)` | function | `createEraktkoshClient` | The saved copy, or `null`. Never rejects. An empty list is a real answer. |
| `saved` | variable | `loadSaved` | What the saved store returned. |
| `lookup(path, params, savedLoader, giveUpMs)` | function | `createEraktkoshClient` | The fallback chain: cache, circuit, live call with give-up, memory copy, saved copy, error. |
| `cacheKey`, `cachedEntry` | variable | `lookup` | Path plus query string, and the cached answer for it. |
| `circuitKey` | variable | `lookup` | `"blood-availability:<state>"`, or `"bloodbank/nearest"`: which circuit this lookup uses. |
| `savedPromise`, `backupAnswer(upstream)` | variable | `lookup` | The saved-copy lookup, and the best backup answer. |
| `liveCall`, `giveUp`, `giveUpTimer`, `first`, `backup` | variable | `lookup` | The live call (possibly shared), the give-up timer, whichever finished first, and the backup served. |
| `SIMULATE_MODES` | constant | module | `down`, `slow` and `flaky`. |
| `canSimulate` | constant | module | True outside production, or with `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1`. |
| `simulateMode`, `simulateStates` | constant | module | `ERAKTKOSH_SIMULATE`, and the state codes in `ERAKTKOSH_SIMULATE_STATES`. |
| `defaultClient` | constant | module | The app's client, with the Supabase saved store. Kept on `globalThis` so it survives hot reloads. |
| `getFirstParam(searchParams, ...names)` | function | module | The first non-empty value among several accepted parameter names. This is how aliases such as `districtCode` are handled. |
| `name`, `value` | variable | `getFirstParam` | The parameter name being tried, and its value. |
| `parseStockFilters(searchParams)` | function | module | Validates `componentId` and `bloodGroupId`. Returns `{ filters }` or `{ error }`. |
| `componentId`, `bloodGroupId` | variable | `parseStockFilters` | The requested component and blood-group codes. |
| `filters` | variable | `parseStockFilters` | The validated filters to forward. |
| `parseAvailabilityQuery(searchParams)` | function | module | Validates a region search. Returns `{ params }` for eRaktKosh, or `{ error }`. |
| `stateCode`, `state` | variable | `parseAvailabilityQuery` | The requested state code, and its state object. |
| `districtId` | variable | `parseAvailabilityQuery` | The requested district code, checked against the state. |
| `parseCoordinates(searchParams, latName, lngName)` | function | module | Validates latitude and longitude and rounds them to 3 decimals, about 110 m, with `roundPinCoordinate`. eRaktKosh, OSRM and Nominatim get no more of a user's position. |
| `rawLat`, `rawLng` | variable | `parseCoordinates` | The coordinates as received, as text. |
| `lat`, `lng` | variable | `parseCoordinates` | The coordinates as numbers. |
| `parseNearestQuery(searchParams)` | function | module | Validates coordinates plus a radius for `/api/nearest`. |
| `coords` | variable | `parseNearestQuery` | The parsed coordinates, or `{ error }`. |
| `radius` | variable | `parseNearestQuery` | The requested radius in meters. |
| `fetchAvailability(params, options)` | function | module | Stock for a state from `blood-availability`, through the default client. `options.giveUpMs` shortens the give-up. |
| `fetchNearest(params)` | function | module | Banks around a point from `bloodbank/nearest`, through the default client. |
| `SOURCE_ORDER`, `UPSTREAM_ORDER` | constant | module | Best to worst: `live`, `cache`, `memory`, `saved`; and `ok`, `degraded`, `down`. |
| `summarizeFreshness(stockAnswers, failedStateNames, { locationAnswer })` | function | module | One [freshness block](#data-shapes) for a search: the stock's worst source and its newest and oldest fetch times, the worst upstream state, the failed states, and the `nearest` answer's source and time kept apart. |
| `worst(values, order)`, `toIso(time)` | variable | `summarizeFreshness` | The worst value by an order, and a time as ISO text or `null`. |
| `ageAnswers`, `fetchedTimes`, `upstreams` | variable | `summarizeFreshness` | The answers whose ages count (the stock, or the location answer when there is no stock), their fetch times, and every upstream state. |

### `src/lib/stock.js`
Pure helpers for eRaktKosh stock rows; safe in the browser and on the server.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GROUP_NAMES` | constant | module | The 10 canonical blood-group names, as in `assets/district_data.json`. |
| `DORMANT_DAYS` | constant | module | 30; stock older than this is dormant. |
| `GROUP_NAMES_BY_KEY` | constant | module | Canonical names keyed by their upper-case, space-free form. |
| `normalizeGroupName(label)` | function | module | `"O +ve"` → `"O+Ve"`; `null` for an unknown group. |
| `parseQuantities(text)` | function | module | Turns `"O-Ve : 3, A +ve : 86"` into `[{ group, units }]`, with canonical group names. |
| `summarizeStock(bank, { componentName, bloodGroupName })` | function | module | The bank's stock that matches the filters: `{ components, totalUnits }`. A component counts only when its name matches. |
| `components` | variable | `summarizeStock`, `unitsForComponent` | The bank's `components` object from eRaktKosh. |
| `componentNames` | variable | `summarizeStock` | The component names being considered. |
| `wantedComponent` | variable | `summarizeStock`, `unitsForComponent`, `keepOnlyComponent` | The requested component name, lower-cased for matching. |
| `matchingComponents` | variable | `summarizeStock` | `[{ component, units, total }]` for components with stock left after filtering. |
| `units` | variable | `summarizeStock` | Non-zero group quantities for one component. |
| `wantedGroup` | variable | `summarizeStock` | The requested blood-group name, lower-cased for matching. |
| `unitsForComponent(bank, componentName)` | function | module | Non-zero units per blood group for one component, or `[]` when the bank doesn't list it. |
| `componentKey` | variable | `unitsForComponent`, `keepOnlyComponent` | The component's name exactly as eRaktKosh spells it. |
| `keepOnlyComponent(rows, componentName)` | function | module | Rows cut down to one component, the shape of a live answer filtered by `componentId`: banks without it are dropped. Used for the saved copy. |
| `exactGroupUnits(bank, componentName, bloodGroupName)` | function | module | Units of exactly one blood group for one component, or 0. Ranked search lists a bank only when this is above 0. |
| `wantedGroup` | variable | `exactGroupUnits` | The requested group name, lower-cased for matching. |
| `extractPhone(contactText)` | function | module | The phone number in eRaktKosh's contact text, or `null`. |
| `match` | variable | `extractPhone` | The regular-expression match for the phone number. |
| `parseEntryDate(entryDate)` | function | module | eRaktKosh's `"YYYY-MM-DD HH:mm:ss"` in Indian time, as a `Date`, or `null`. |
| `isDormant(entryDate, now)` | function | module | Whether the stock is more than 30 days old. |
| `date` | variable | `parseEntryDate`, `formatUpdatedAgo` | The parsed update time. |
| `formatUpdatedAgo(entryDate, now)` | function | module | Text such as `"updated 3 h ago"`. |
| `minutes`, `hours` | variable | `formatUpdatedAgo` | How long ago the bank updated its stock. |
| `cleanText(value)` | function | module | Trims text and removes stray trailing commas. |
| `toNameKey(text)` | function | module | Lower case, with every run of characters other than letters and digits as one space, for comparing place names. |
| `districtFromAddress(address, stateName, districts)` | function | module | The code of the district an eRaktKosh address ends with (`"…, <district>, <state>"`), or `null` when the last part isn't the state or the one before isn't one of its districts. Gave the known district for all 4,048 saved banks that have one on 2026-10-26. |
| `parts`, `district` | variable | `districtFromAddress` | The address's comma-separated parts as name keys, and the matching district. |
| `normalizeAvailabilityRow(row, filters)` | function | module | Turns one eRaktKosh row into a [bank result](#data-shapes) for display. |

### `src/lib/stockQuality.js`
Pure validator for eRaktKosh `blood-availability` rows, used by the app and by `scripts/snapshot.mjs`. Rows keep eRaktKosh's own shape.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `MAX_UNITS_PER_GROUP` | constant | module | 2,000; larger unit counts are dropped. |
| `FUTURE_TOLERANCE_MS` | constant | module | 10 min; an update time further in the future becomes unknown. |
| `emptyQualityReport()` | function | module | A report with every count at 0. |
| `mergeQualityReports(reports)` | function | module | Adds reports together, for a whole sweep. |
| `total` | variable | `mergeQualityReports` | The running totals. |
| `cleanQuantities(text, report)` | function | module | Rewrites one `available_WithQty` text with canonical names, dropping bad entries and counting each change. |
| `kept`, `entry`, `match`, `groupName`, `units` | variable | `cleanQuantities` | The entries kept, the one being read, its parts, its canonical group, and its count. |
| `cleanRow(row, now, report)` | function | module | One row with cleaned names, a checked update time and cleaned quantities. |
| `cleaned`, `updatedAt` | variable | `cleanRow` | The cleaned copy, and the parsed update time. |
| `updateTime(row)` | function | module | A row's update time in milliseconds, for keeping the newer duplicate. |
| `validateAvailabilityRows(rows, { now })` | function | module | Cleans a response. Returns `{ rows, report }`. |
| `report`, `rowsByCode`, `existing`, `cleanedRows` | variable | `validateAvailabilityRows` | The counts, rows by bank code, a duplicate already seen, and the result. |

### `src/lib/collector.js`
The eRaktKosh collector, shared by `scripts/snapshot.mjs` on the laptop and the `collect-stock` Edge Function. The caller passes in a database session already switched to `bloodlink_ingest`, `fetch`, the two asset files and an optional archive, so the module runs in Node and Deno alike. It also holds the pure checks the function and the admin overview use. Its JSDoc types are for Deno, which type-checks the function against it.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BASE_URL`, `TIMEOUT_MS`, `STATE_GAP_MS`, `BATCH_SIZE` | constant | module | eRaktKosh address, 60 s timeout, 1 s between states, 400 rows per insert. |
| `DIRECTORY_QUERY` | constant | module | One `nearest` call from central India with a 5,000 km radius. |
| `AUTO_REFRESH_ENDPOINT` | constant | module | `master/portal-refresh-hospitals`: the banks eRaktKosh refreshes automatically, as a list of codes. |
| `ARCHIVE_VERSION` | constant | module | 1: the format version each archive line carries as `v`. Lines without one are version 1. |
| `REPEAT_GUARD_MINUTES` | constant | module | 50: the Edge Function refuses a job that already started this recently. |
| `STATE_BATCHES` | constant | module | The four batches of a cloud sweep, 9 state codes each, split by measured time. |
| `OVERDUE_GRACE_HOURS`, `DEFAULT_SWEEP_HOURS` | constant | module | 2 and 4.5: collection counts as overdue after the sweep interval plus 2 hours. |
| `intervalHours(interval)` | function | module | Hours in a Postgres interval as PostgREST returns it (`"04:30:00"`, `"1 day 02:00:00"`), or `null`. |
| `collectionOverdue(lastFinishedAt, sweepInterval, now)` | function | module | `{ isOverdue, hoursSince, limitHours }` for the admin overview. |
| `REQUEST_KEYS` | constant | module | The fields a function call may carry. |
| `parseCollectorRequest(body)` | function | module | `{ batch, sweepId, directory, prune }` from `{ batch: 1–4, sweep }` or `{ directory: true, prune: true }`, or `{ error }`. |
| `isCollectorSecret(given, expected)` | function | module | Compares the `x-collector-secret` header with the function's secret in constant time. A missing or short (under 32 characters) configured secret refuses everything. |
| `difference` | variable | `isCollectorSecret` | The OR of every character difference, and of the lengths. |
| `digitsOrNull`, `toIsoOrNull` | function | module | A digits-only value or `null`; an eRaktKosh time as ISO UTC. |
| `createCollector({ db, fetch, districtData, stateBoundaries, archive, runner, recordRuns, clock, sleep, log, logError })` | function | module | The collector. `archive` has `history(lines)`, `sweep(summary)` and `directory(data, seenAt)`, each optional. `runner` is `edge` or `laptop`. With `recordRuns` false, nothing is written to `collector_runs`. |
| `stateNames`, `componentShortNames` | constant | `createCollector` | State names by code, and component short names by full name. |
| `nowIso()` | function | `createCollector` | The clock's time as ISO. |
| `callEraktkosh(endpoint, params, timeoutMs)` | function | `createCollector` | One GET: `{ ok, data, status, durationMs, bytes, failureKind }`. |
| `insertRows(table, columns, rows, conflictClause, casts)` | function | `createCollector` | Multi-row inserts in batches. |
| `batch`, `values`, `tuples`, `placeholders`, `cast` | variable | `insertRows` | One batch of rows, its query values, the `($1, $2, …)` groups, one row's placeholders, and a column's type cast. |
| `logCall(endpoint, stateCode, call, rowCount, quality)` | function | `createCollector` | Writes one `upstream_calls` row. |
| `compactStock(row)` | function | `createCollector` | `{ "PRBC": { "O+Ve": 74 } }`: the copy kept in `stock_history`. |
| `startRun({ job, batch, sweepId, guardMinutes })` | function | `createCollector` | Inserts the job's `collector_runs` row and returns `{ id }`. With `guardMinutes`, it first takes an advisory lock and returns `null` if the same job and batch started that recently. |
| `finishRun(run, outcome)` | function | `createCollector` | Fills in the finish time, state counts, rows, archive file, `archive_day`, lines archived, result and error. |
| `collectDirectory()` | function | `createCollector` | Saves the nationwide directory, flagging `missing`, `outside_india`, `wrong_state` (outside its own state, from `locationProblem`) and `shared` locations, then runs `collectAutoRefresh`. Returns `{ isSuccess, banks, qualityCounts, autoRefresh }`, or `{ isSuccess: false, error }`. |
| `collectAutoRefresh()` | function | `createCollector` | Sets `blood_banks.auto_refresh` from the auto-refresh list: true for the banks on it, false for the rest, writing only rows that change. A failed call, or a list with no valid code, keeps last week's values and logs the failure. Returns `{ isSuccess, banks }` or `{ isSuccess: false, error }`. |
| `codes`, `failed` | variable | `collectAutoRefresh` | The list's valid codes, without repeats, and the call as logged when it failed. |
| `stateChecker`, `pointCounts`, `pointKey`, `seenAt`, `banksByCode`, `locationQuality`, `qualityCounts` | variable | `collectDirectory` | The state-outline checker, banks per coordinate point, its key, the run time, rows by code, one bank's flag, and flag totals. |
| `collectStates(stateCodes, { stopStartingAt, callDeadlineAt })` | function | `createCollector` | Saves each state: validates, uploads changed rows in full, updates the fetch time of the rest, and adds history. A state whose call or save fails is logged and skipped, and the sweep goes on. No state starts after `stopStartingAt`, and no call waits past `callDeadlineAt`; states not started are reported as skipped. Returns `{ isSuccess, statesSaved, statesFailed, statesSkipped, rowsChanged, sweep }`. |
| `districtByCode`, `sweep`, `okCount`, `failedCount`, `rowsChanged`, `skippedCodes` | variable | `collectStates` | District per bank from the directory, the sweep summary, and the counts. |
| `timeoutMs`, `previousEntry`, `isChanged`, `changedRows`, `unchangedCodes`, `latestRows`, `historyRows` | variable | `collectStates` | This call's timeout, saved update times, the change test, and the rows to write. |
| `prune()` | function | `createCollector` | Runs `prune_stock_store()` and logs its report. |

### `src/lib/stockStore.js`
Server-only reads of the copy `scripts/snapshot.mjs` saves, with the publishable key and no session.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | constant | module | The public project URL and publishable key. |
| `PAGE_SIZE` | constant | module | 1,000; the Data API's row limit per request. |
| `DIRECTORY_TTL_MS` | constant | module | 1 h; how long the directory stays in memory. |
| `STATE_ROWS_TTL_MS` | constant | module | 10 min; how long a state's saved rows stay in memory. |
| `publicClient` | variable | module | The Supabase client, created on first use. |
| `getPublicClient()` | function | module | That client, or `null` without the environment variables. |
| `selectAllRows(buildQuery)` | function | module | Every row of a query, a page at a time. |
| `rows` | variable | `selectAllRows` | The rows read so far. |
| `stateRowsCache` | variable | module | State code → `{ rowsPromise, loadedAt }`. The promise is kept, so lookups made during a download share it. Kept on `globalThis`. |
| `loadStateRows(supabase, stateCode)` | function | module | A state's saved rows as `[{ row, districtId, fetchedAt }]`, downloaded once per 10 minutes. `districtId` is the directory's, or `districtFromAddress` for banks with no directory row. Expired entries are dropped first, and a failed download isn't kept. |
| `now`, `cached`, `state`, `rowsPromise` | variable | `loadStateRows` | The time, the cache entry, the state's object from `constants.js`, and the download. |
| `loadSavedAvailability({ stateCode, districtId, componentId })` | function | module | Saved rows for a state or district, cut from the state's cached rows in memory, with the oldest fetch time. With a `componentId`, cut down to that component by `keepOnlyComponent`. `null` when no row matches. |
| `stateRows`, `rows` | variable | `loadSavedAvailability` | The state's cached rows, and the ones in the district asked for. |
| `savedRows`, `componentName` | variable | `loadSavedAvailability` | The eRaktKosh rows, and the requested component's name. |
| `supabase` | variable | `loadSavedAvailability`, `loadSavedNearest` | The public client. |
| `directoryCache` | variable | module | `{ banks, loadedAt }`. Kept on `globalThis`. |
| `loadDirectory(supabase)` | function | module | The saved directory, without banks that have no coordinates. Banks flagged `wrong_state` or `outside_india` are kept, as eRaktKosh's own answer keeps them, so `/api/blood-search` leaves them out and counts them as misplaced, in saved mode as in live mode. |
| `banks` | variable | `loadDirectory`, `loadSavedNearest` | The directory rows. |
| `loadSavedNearest({ latitude, longitude, radius })` | function | module | Saved banks within a radius, in eRaktKosh's `nearest` shape, with straight-line distances. |
| `origin`, `data` | variable | `loadSavedNearest` | The search point, and the banks found. |

### `src/lib/geo.js`
Pure distance helpers.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `EARTH_RADIUS_M` | constant | module | 6,371 km in meters. |
| `toRadians(degrees)` | function | module | Degrees to radians. |
| `PIN_DECIMALS` | constant | module | 3; the decimals kept from a user's pin, about 110 m. |
| `roundPinCoordinate(value)` | function | module | A latitude or longitude rounded to `PIN_DECIMALS`. Used by the search page and the map before the pin leaves the browser, and by `parseCoordinates` on the server. |
| `haversineMeters(from, to)` | function | module | Straight-line distance between two `{ latitude, longitude }` points. |
| `dLat`, `dLon`, `a` | variable | `haversineMeters` | The differences in radians, and the haversine term. |
| `INDIA_BOUNDS` | constant | module | Latitude 6 to 37.5 and longitude 68 to 97.5. |
| `isInIndia({ latitude, longitude })` | function | module | Whether a point lies inside those bounds. |

### `src/lib/geocoding.js`
Server-only Nominatim client for the place name under the map pin. The browser never contacts Nominatim; failures return `null`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `NOMINATIM_URL` | constant | module | The public reverse-geocoding endpoint. |
| `TIMEOUT_MS` | constant | module | 5 s. |
| `REQUEST_GAP_MS` | constant | module | 1 s; Nominatim's limit for the whole app. |
| `MAX_QUEUE_WAIT_MS` | constant | module | 3 s; past this wait for a slot, the lookup gives up and the page shows coordinates. |
| `CACHE_TTL_MS`, `MAX_CACHE_ENTRIES` | constant | module | A week, and 5,000 points. |
| `USER_AGENT` | constant | module | Names bloodLink and its repository, as Nominatim's policy asks. |
| `placeCache`, `requestClock` | variable | module | Names by rounded point, and the next free request slot. Kept on `globalThis`. |
| `parsePlaceLabel(body)` | function | module | The first of city, city district, town, village, county and state that Nominatim gives, else the first part of the display name, else `null`. |
| `address` | variable | `parsePlaceLabel` | Nominatim's address parts. |
| `waitForSlot(minGapMs)` | function | module | Reserves the next request slot one gap after the last, or throws if the wait would pass `MAX_QUEUE_WAIT_MS`. |
| `now`, `slotAt` | variable | `waitForSlot` | The time, and the reserved slot. |
| `reverseGeocode({ latitude, longitude }, { http, minGapMs })` | function | module | The place name for a pin `parseCoordinates` has already rounded: from the cache, else one Nominatim request. `http` and `minGapMs` let tests fake the network. |
| `cacheKey`, `cached`, `response`, `label` | variable | `reverseGeocode` | The rounded point as text, its cache entry, Nominatim's answer, and the name. |

### `src/lib/privacy.js`
The privacy note's version and contact. Pure; safe in the browser.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `PRIVACY_VERSION` | constant | module | `"2026-11-03"`, when the note began saying the data is kept in Mumbai; the version of `/privacy` that people agree to. Change it when the note changes, and the details form asks everyone again. |
| `CONTACT_EMAIL` | constant | module | `NEXT_PUBLIC_CONTACT_EMAIL`, or `null`. |
| `hasAgreedToPrivacy(privacyVersion)` | function | module | Whether a profile's `privacy_version` is the current one. |

### `src/lib/stateBounds.js`
Pure check that a bank's coordinates fall in its own state, from the outlines in `assets/state_boundaries.json`. The caller passes the JSON in, so the Node scripts can use it too.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `STATE_MARGIN_KM` | constant | module | 5 km; a point this close to its state's outline still counts as inside, for border cases and the outline simplification. |
| `KM_PER_DEGREE_LAT`, `KM_PER_DEGREE_LON_AT_EQUATOR` | constant | module | 110.57 km and 111.32 km. |
| `MAX_CACHE_ENTRIES` | constant | module | 10,000; past this, the oldest cached answer is dropped. |
| `isInsideRing(lon, lat, ring)` | function | module | Ray casting: whether a point is inside one ring. |
| `x1`, `y1`, `x2`, `y2` | variable | `isInsideRing` | The ends of the edge being tested. |
| `isInsidePolygon(lon, lat, [outerRing, ...holes])` | function | module | Inside the outer ring and in none of the holes. |
| `distanceToRingKm(lon, lat, ring)` | function | module | Shortest distance from the point to a ring's edges, on a flat projection centred on the point. |
| `kmPerDegreeLon`, `toKm` | variable | `distanceToRingKm` | km per degree of longitude there, and a vertex in km from the point. |
| `ax`, `ay`, `bx`, `by`, `dx`, `dy`, `lengthSquared`, `t` | variable | `distanceToRingKm` | One edge in km, its direction and length, and the nearest point's position along it. |
| `createStateChecker(boundaries, { marginKm })` | function | module | Returns `{ distanceOutsideStateKm, locationProblem }` for those outlines. |
| `problemCache` | variable | `createStateChecker` | Answers by state and point, since bank positions repeat across searches. |
| `distanceOutsideStateKm({ latitude, longitude }, stateCode)` | function | `createStateChecker` | 0 inside the state, else km to its outline; `null` when the state has no outline. |
| `state`, `lat`, `lon` | variable | `distanceOutsideStateKm`, `locationProblem` | The state's outline, and the point as numbers. |
| `isFarOutsideBox({ latitude, longitude }, stateCode)` | function | `createStateChecker` | Whether the point is beyond the state's bounding box plus the margin, which settles most far-off points without measuring. |
| `west`, `south`, `east`, `north`, `latMargin`, `lonMargin` | variable | `isFarOutsideBox` | The box, and the margin in degrees. |
| `locationProblem({ latitude, longitude, stateCode })` | function | `createStateChecker` | `"missing"`, `"outside_india"`, `"wrong_state"`, or `null` when the position can be used. |
| `cacheKey`, `point`, `isWrongState`, `problem` | variable | `locationProblem` | The cache key, the point, whether it is beyond the margin, and the answer. |

### `src/lib/rings.js`
Pure choice of the search ring for `/api/blood-search`. Dormant banks are listed but never decide the ring.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `smallestRingWith(rings, banks, isWanted)` | function | module | The smallest ring holding a bank that passes the test, or `null`. |
| `nearestModeRing(rings, stockedBanks)` | function | module | The smallest ring with an active stocked bank; if all are dormant, the smallest with any; `null` with none. |
| `rankedModeRing(rings, usableBanks, unitsNeeded)` | function | module | The smallest ring whose active banks hold the units needed, else the widest; `null` with no bank. |
| `activeUnitsWithin(radiusM)` | function | `rankedModeRing` | Units held by active banks inside a radius. |

### `src/lib/compatibility.js`
Which blood groups a patient can receive, for each type of component. Informational only. Since report 3 the search uses exact groups only, so nothing in the app imports this module; it is kept, with its tests, for donor matching. The rules are conservative: they never allow the emergency substitutions transfusion services sometimes make.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `MEDICAL_DISCLAIMER` | constant | module | Warning that compatibility is informational and needs cross-matching. Exported but not used yet. |
| `COMPONENT_CATEGORIES` | constant | module | Component code → `whole_blood`, `red_cells`, `plasma` or `platelets`. |
| `RED_CELL_DONORS` | constant | module | Patient ABO group → donor ABO groups whose red cells it can receive. |
| `PLASMA_DONORS` | constant | module | Patient ABO group → donor ABO groups whose plasma it can receive. Also used for platelets. |
| `componentCategory(componentCode)` | function | module | A component's category, or `null`. |
| `parseGroupName(name)` | function | module | Turns `"O-Ve"` into `{ abo: "O", rh: "-" }`. Bombay is `"Oh"`. |
| `match`, `abo` | variable | `parseGroupName` | The regular-expression match, and the normalized ABO group. |
| `groupCodeForName(name)` | function | module | A blood-group code from its name. Exported but not used yet. |
| `wantedName` | variable | `groupCodeForName` | The name being looked up, lower-cased. |
| `isRhCompatible(recipientRh, donorRh, category)` | function | module | Whether the Rh types work for this category. Plasma ignores Rh. |
| `isAboCompatible(recipientAbo, donorAbo, category)` | function | module | Whether the ABO groups work, including the Bombay rule. |
| `isRecipientBombay`, `isDonorBombay` | variable | `isAboCompatible` | Whether either side is Bombay (Oh). |
| `donorGroupsFor(recipientCode, componentCode, { exactOnly })` | function | module | Groups a patient can receive, exact group first: `[{ code, name, exact }]`. |
| `recipient` | variable | `donorGroupsFor` | The patient's blood-group row. |
| `category` | variable | `donorGroupsFor` | The component's category. |
| `recipientGroup`, `donorGroup` | variable | `donorGroupsFor` | The parsed ABO and Rh of the patient and of each candidate group. |
| `describeCompatibility(recipientCode, componentCode)` | function | module | The component, its category and the accepted group names. Exported but not used yet. |
| `groups` | variable | `describeCompatibility` | The accepted donor groups. |

### `src/lib/ranking.js`
Emergency ranking for exact-group stock: four scores per bank, urgency weights, plain-language reasons, and the response plan.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `URGENCY_LEVELS` | constant | module | `["critical", "urgent", "routine"]`. |
| `WEIGHTS` | constant | module | Weights of the ETA, coverage, surplus and freshness scores for each urgency level. Each set adds up to 1; surplus is weighted most when critical. |
| `ETA_DECAY_MINUTES` | constant | module | τ for the ETA score: 30, 45 or 60 minutes. |
| `FRESHNESS` | constant | module | Freshness rule: full score within 6 h, zero at 72 h, 30 when the update time is unknown. |
| `MS_PER_HOUR` | constant | module | Milliseconds in an hour. |
| `roundToTenth(value)` | function | module | Rounds to one decimal place. |
| `unitWord(count)` | function | module | `"unit"` or `"units"`. |
| `etaScore(minutes, urgency)` | function | module | `100 · e^(−minutes/τ)`: falls as travel time grows, faster when urgent. |
| `tau` | variable | `etaScore` | τ, the decay time for this urgency, in minutes. |
| `coverageScore(units, unitsNeeded)` | function | module | `100 · min(1, units / units needed)`. |
| `surplusScore(units, unitsNeeded)` | function | module | `100 · (1 − e^(−spare / units needed))`: rewards units beyond the request, with diminishing returns. |
| `spareUnits` | variable | `surplusScore`, `describeStock` | Units beyond the request; 0 when the bank is short. |
| `freshnessScore(entryDate, now)` | function | module | 0–100 by how recently the bank updated its stock. |
| `updatedAt`, `hours` | variable | `freshnessScore`, `hoursSinceUpdate` | The update time, and its age in hours. |
| `hoursSinceUpdate(entryDate, now)` | function | module | Hours since the stock update, or `null`. |
| `formatAge(hours)` | function | module | Text such as `"45 min"`, `"5 h"` or `"3 days"`. |
| `describeEta(source, trafficLabel)` | function | module | `"About 18 min by road at this hour (rush-hour traffic)"`, or the estimated version. |
| `condition` | variable | `describeEta` | The traffic label in brackets, or nothing. |
| `describeStock(source, unitsNeeded)` | function | module | `"6 O-Ve units listed: covers the 3 needed, with 3 to spare"`, or how short the bank is. |
| `listed` | variable | `describeStock` | The "N group units listed" part. |
| `buildReasons(source, freshness, unitsNeeded, now, trafficLabel)` | function | module | The three reason sentences shown under a ranked bank: travel, stock, freshness. |
| `reasons` | variable | `buildReasons`, `rankSources` | The list of reason sentences. |
| `age` | variable | `buildReasons` | How old the stock data is, as text. |
| `rankSources(sources, { urgency, unitsNeeded, now, trafficLabel, weights })` | function | module | Drops banks without exact-group units, scores the rest and sorts them by score, then by ETA. `weights` overrides the urgency's weights, for sensitivity analysis. |
| `weights` | variable | `rankSources` | The weight set for the chosen urgency. |
| `breakdown` | variable | `rankSources` | The four part scores: ETA, coverage, surplus, freshness. |
| `score` | variable | `rankSources` | The weighted total, 0–100. |
| `buildResponsePlan(rankedSources, unitsNeeded)` | function | module | Takes units from banks in rank order until the request is covered. |
| `unitsRemaining` | variable | `buildResponsePlan` | Units still to find. |
| `steps` | variable | `buildResponsePlan` | One plan step per bank used. |
| `units` | variable | `buildResponsePlan` | Units taken from the current bank. |
| `shortfall` | variable | `buildResponsePlan` | Units that couldn't be found. 0 when the plan covers everything. |

### `src/lib/trafficModel.js`
Pure travel-time model: ETA = free-flow time × (1 + congestion / 100) × rain factor. The TomTom profiles are passed in rather than imported, so plain Node can load it; the app reaches it through `src/lib/traffic.js`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `DETOUR_FACTOR` | constant | module | 1.34; road distance ÷ straight-line distance, the median of 94 Mumbai bank trips. Used when there is no route. |
| `METRO_MARGIN_KM` | constant | module | 10 km; how far outside a TomTom metro's box its own profile still applies. |
| `ZONE_MIN_BANKS` | constant | module | Banks within 15 km that make a city (11) or a town (3). |
| `ZONE_SCALE` | constant | module | Share of the Indian average congestion: metro 1, city 0.89, town 0.73, rural 0.29. City and town come from TomTom's within-country fit, which gives about 0.88 and 0.74; rural is an assumption. |
| `RAIN` | constant | module | Moderate rain from 2.5 mm/h adds 15%; heavy rain from 7.6 mm/h adds 30%. The bands are the American Meteorological Society's rain rates. |
| `IST_OFFSET_MS` | constant | module | India's +5:30 offset, in milliseconds. |
| `KM_PER_DEGREE` | constant | module | 111.32 km per degree of latitude. |
| `DAY_NAMES` | constant | module | `"Sun"` to `"Sat"`. |
| `roundToTenth(value)` | function | module | Rounds to one decimal place. |
| `hasRoute(leg)` | function | module | Whether OSRM gave the leg both a distance and a time. |
| `indiaClock(now)` | function | module | `{ day, hour, minute, month }` on India's clock; day 0 is Sunday. |
| `shifted` | variable | `indiaClock` | The time moved by +5:30, read with UTC getters. |
| `formatIndiaTime(now)` | function | module | `"Fri 6:05 pm"`. |
| `hour12` | variable | `formatIndiaTime` | The hour on a 12-hour clock. |
| `congestionPercent(zone, now)` | function | module | % extra travel time now: the weekday-hour value interpolated to the minute, times the month's factor and the zone's scale. |
| `nextDay`, `nextHour`, `thisHourValue`, `nextHourValue`, `hourValue` | variable | `congestionPercent` | The two hourly values around now, and the value between them. |
| `rainFactor(rainMmPerHour)` | function | module | 1, 1.15 or 1.3. |
| `describeCongestion(congestion)` | function | module | `"light"`, `"moderate"`, `"heavy"` or `"rush-hour traffic"`. |
| `trafficConditions(zone, { now, rainMmPerHour })` | function | module | Conditions shared by every bank in one search: zone, city, India time, congestion, label, rain. |
| `congestion` | variable | `trafficConditions` | This search's congestion %. |
| `createTrafficModel(profiles, { detourFactor, zoneScale })` | function | module | The model for one profile file: `{ findMetro, trafficZone, travelMinutes, estimateTravel }`. `detourFactor` and `zoneScale` default to `DETOUR_FACTOR` and `ZONE_SCALE`; only the ETA bench changes them. |
| `findMetro(latitude, longitude)` | function | `createTrafficModel` | The TomTom metro whose box (plus margin) contains the point, nearest centre first, or `null`. |
| `latMargin`, `lonMargin` | variable | `findMetro` | The 10 km margin in degrees. |
| `squaredDistance(city)` | function | `findMetro` | Rough distance to a city centre, for choosing between overlapping boxes. |
| `trafficZone({ latitude, longitude }, banksWithin15Km)` | function | `createTrafficModel` | The zone for a search: `{ kind, name, freeFlowKmh, scale, weekHour, seasonal }`. |
| `metro`, `india`, `kind` | variable | `trafficZone` | The matched metro, the India average profile, and `"metro"`, `"city"`, `"town"` or `"rural"`. |
| `freeFlowKmh` | variable | `trafficZone` | Free-flow speed per zone kind: city streets, halfway for towns, highway for rural. |
| `travelMinutes({ straightLineM, leg }, zone, conditions)` | function | `createTrafficModel` | One bank's minutes before rounding. |
| `roadKm`, `routeMinutes`, `freeFlowMinutes` | variable | `travelMinutes` | Road km, OSRM minutes, and the slower free-flow time. |
| `estimateTravel(trip, zone, conditions)` | function | `createTrafficModel` | `{ etaMinutes, roadDistanceM, etaSource }` for one bank: `travelMinutes` rounded, at least 1. |

### `src/lib/traffic.js`
The model from `trafficModel.js`, bound to the TomTom profiles. This is what the app imports; safe in the browser and on the server.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `trafficProfiles` | import | module | `assets/traffic_profiles.json`: TomTom weekday-hour congestion for 10 Indian metros plus an India average. |
| `DETOUR_FACTOR`, `METRO_MARGIN_KM`, `RAIN`, `ZONE_MIN_BANKS`, `ZONE_SCALE`, `congestionPercent`, `describeCongestion`, `formatIndiaTime`, `indiaClock`, `rainFactor`, `trafficConditions` | re-export | module | Passed on from `trafficModel.js` unchanged. |
| `findMetro`, `trafficZone`, `estimateTravel` | function | module | `createTrafficModel(trafficProfiles)`'s functions. |

### `src/lib/routing.js`
Server-only OSRM table client. Failures never throw; a failed leg is `null`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `OSRM_URL` | constant | module | The OSRM server. `OSRM_URL` overrides the public demo server. |
| `IS_PUBLIC_SERVER` | constant | module | Whether the demo server is in use, which turns on the one-request-a-second spacing. |
| `TIMEOUT_MS` | constant | module | 6 s. |
| `MAX_DESTINATIONS_PER_CALL` | constant | module | 250 banks per table call. |
| `PUBLIC_SERVER_GAP_MS` | constant | module | 1 s between calls to the demo server. |
| `MAX_QUEUE_WAIT_MS` | constant | module | 3 s; a search that would wait longer for its slot estimates instead. |
| `CACHE_TTL_MS`, `MAX_CACHE_ENTRIES` | constant | module | 24 h, and 20,000 user-to-bank pairs. |
| `USER_AGENT` | constant | module | The honest User-Agent the demo server requires. |
| `legCache` | variable | module | Map from "origin\|bank" to `{ leg, cachedAt }`. Kept on `globalThis`. |
| `requestClock` | variable | module | `{ nextSlotAt }`: when the next demo-server call may start. Kept on `globalThis`. |
| `pointKey({ latitude, longitude })` | function | module | `"longitude,latitude"` to 5 decimals, as OSRM wants. |
| `hasValidPoint({ latitude, longitude })` | function | module | Whether a bank has usable coordinates (not missing, not 0,0). |
| `waitForSlot(minGapMs)` | function | module | Waits for the next request slot, or throws if the queue is too long. |
| `slotAt` | variable | `waitForSlot` | This call's reserved start time. |
| `parseTable(body, destinationCount)` | function | module | OSRM table JSON → one `{ distanceM, durationS }` or `null` per destination. Throws on errors and on the wrong shape. |
| `durations`, `distances` | variable | `parseTable` | The source's row of each matrix. |
| `cacheLeg(key, leg)` | function | module | Stores a leg and drops the oldest past the limit. |
| `fetchRoadLegs(origin, destinations, { http, minGapMs })` | function | module | `{ legs, failed }`: cached legs first, then table calls for the rest, in chunks. |
| `originKey`, `legs`, `missingIndexes`, `failed` | variable | `fetchRoadLegs` | The origin's key, the legs being filled, which ones still need OSRM, and whether any call failed. |
| `chunk`, `coordinates`, `chunkLegs` | variable | `fetchRoadLegs` | One call's banks, its coordinate list, and its answers. |

### `src/lib/weather.js`
Server-only Open-Meteo client, used only to slow travel estimates in rain.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `WEATHER_URL` | constant | module | Open-Meteo's forecast endpoint. |
| `TIMEOUT_MS` | constant | module | 2.5 s. |
| `CACHE_TTL_MS`, `MAX_CACHE_ENTRIES` | constant | module | 15 min, and 2,000 cells. |
| `rainCache` | variable | module | Map from a 0.1° cell to `{ rainMmPerHour, cachedAt }`. Kept on `globalThis`. |
| `parseRainRate(body)` | function | module | Rain in the last interval, as mm per hour, or `null`. |
| `precipitationMm`, `intervalS` | variable | `parseRainRate` | Rain in the interval, and the interval's length. |
| `fetchRainMmPerHour({ latitude, longitude }, { http })` | function | module | Current rain at a point, or `null` on any failure. |
| `cellLat`, `cellLon`, `cacheKey`, `cached` | variable | `fetchRainMmPerHour` | The 0.1° cell, its cache key and any cached answer. |

### `src/lib/eligibility.js`
Donor eligibility, worked out every time it is read, from NBTC's 2017 donor-selection guidelines (NACO letter S-12016/5/2016, 11 October 2017), cited by clause in the file. Informational only; the blood bank's medical officer decides.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ELIGIBILITY_RULES` | constant | module | Age 18–65, with 60 the limit for a first donation (clause 2); at least 45 kg (clause 3); a gap of 90 days (men) or 120 days (others) between whole-blood donations (clause 4). |
| `MS_PER_DAY` | constant | module | Milliseconds in a day. |
| `toDate(value)` | function | module | A `Date` from a value, or `null`. |
| `date` | variable | `toDate` | The parsed date. |
| `calculateAge(dob, now)` | function | module | Age in whole years on the given day. |
| `birthDate` | variable | `calculateAge` | The date of birth as a `Date`. |
| `age` | variable | `calculateAge`, `evaluateEligibility` | Age in years. |
| `isBeforeBirthday` | variable | `calculateAge` | Whether this year's birthday is still to come. |
| `evaluateEligibility(details, now)` | function | module | Returns `{ status, eligible, reasons, nextEligibleDate }`. `status` is `not-donor`, `eligible`, `review` or `deferred`. Defers for age, a first donation over 60 (no last donation recorded), the gap, a tattoo or similar procedure in 12 months (clause 47), pregnancy, breastfeeding, a birth in 12 months or an abortion in 6 (clauses 15 to 17), weight under 45 kg, and a listed infection; medication alone means `review`. |
| `donorDetails` | variable | `evaluateEligibility` | The donor's screening answers. |
| `reasons` | variable | `evaluateEligibility` | Why the person can't donate now, or needs a check. |
| `nextEligibleDate` | variable | `evaluateEligibility` | The first date they can donate again, as `YYYY-MM-DD`. |
| `lastDonation` | variable | `evaluateEligibility` | The last donation date as a `Date`, or `null` for a first-time donor. |
| `minGapDays` | variable | `evaluateEligibility` | The required gap for this person: 90 or 120 days. |
| `daysSinceDonation` | variable | `evaluateEligibility` | Days since the last donation. |
| `status` | variable | `evaluateEligibility` | The overall result. |

### `src/lib/profile.js`
Validates the profile form; anything not listed is dropped.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `PHONE_PATTERN` | constant | module | Allowed phone format: an optional `+`, then 7–20 digits, spaces or dashes. The database checks the same pattern. |
| `DATE_PATTERN` | constant | module | `YYYY-MM-DD`. |
| `GENDERS` | constant | module | `["male", "female", "other"]`. |
| `IST_OFFSET_MS` | constant | module | India's +5:30 offset, in milliseconds. |
| `indiaToday(now)` | function | module | Today's date in India as `YYYY-MM-DD`. Between midnight and 05:30 it is a day ahead of UTC's. |
| `trimText(value, maxLength)` | function | module | Trims text and cuts it to a maximum length. Anything that isn't a string becomes `""`. |
| `parsePastDate(value, today)` | function | module | A real calendar date on or before today, `null` if empty, or `false` if invalid (such as 30 February) or in the future. |
| `date` | variable | `parsePastDate` | The value read as a UTC date, used to check it round-trips to the same text. |
| `sanitizeDetails(input, now)` | function | module | Validates and cleans a [`details`](#data-shapes) object. Returns `{ errors, details }`. |
| `fields` | variable | `sanitizeDetails` | The submitted form, or `{}` if it wasn't an object. |
| `today` | variable | `sanitizeDetails` | Today's date in India as `YYYY-MM-DD`. |
| `errors` | variable | `sanitizeDetails` | The error messages found. |
| `fullName`, `dob`, `gender`, `phone` | variable | `sanitizeDetails` | The cleaned personal fields. |
| `state`, `districtCode` | variable | `sanitizeDetails` | The state object, and the district code checked against it. |
| `emergencyName`, `emergencyPhone` | variable | `sanitizeDetails` | The cleaned emergency contact. |
| `bloodGroupId` | variable | `sanitizeDetails` | The blood-group code, checked against `BLOOD_GROUPS`. |
| `isDonor` | variable | `sanitizeDetails` | Whether the person is a donor. |
| `donorDetails` | variable | `sanitizeDetails` | The cleaned screening answers, or `null`. |
| `donorInput` | variable | `sanitizeDetails` | The submitted screening answers. |
| `lastDonationDate`, `onMedication` | variable | `sanitizeDetails` | The checked donation date, and the medication flag. |

### `src/lib/profileStore.js`
Converts between the page's `details` object (camelCase) and the database rows (snake_case).

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `rowsToDetails(profile, screening)` | function | module | Turns a `profiles` row and a `donor_screening` row into a `details` object. |
| `detailsToRows(details)` | function | module | Turns a validated `details` object into `{ profile, screening }` rows. |
| `profile`, `screening` | variable | `detailsToRows` | The rows to write. `screening` is `null` for non-donors. |
| `donorDetails` | variable | `detailsToRows` | The screening answers being converted. |

### `src/lib/organization.js`
Hospital and blood-bank applications.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ORGANIZATION_KINDS` | constant | module | `hospital` → "Hospital", `blood_bank` → "Blood bank". |
| `ORGANIZATION_STATUS_LABELS` | constant | module | What each status is called on screen, such as `pending` → "Waiting for review". |
| `ORGANIZATION_STATUS_BADGE_CLASSES` | constant | module | The badge colour class for each status. |
| `ERAKTKOSH_CODE_PATTERN` | constant | module | An eRaktKosh code: 1–10 digits. |
| `sanitizeOrganization(input)` | function | module | Validates an application. Returns `{ errors, row }`, with `row` ready to insert. |
| `fields`, `errors` | variable | `sanitizeOrganization` | The submitted form, and the error messages found. |
| `kind`, `name`, `registrationNumber`, `eraktkoshCode` | variable | `sanitizeOrganization` | The cleaned organization fields. |
| `state`, `districtCode`, `address`, `phone` | variable | `sanitizeOrganization` | The cleaned location and contact fields. |

### `src/lib/format.js`
Display helpers shared by the pages.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `DATE_OPTIONS` | constant | module | Date style "23 Oct 2026". |
| `DATE_TIME_OPTIONS` | constant | module | Date and time style "23 Oct 2026, 04:30 pm". |
| `formatDate(value)` | function | module | A date in Indian format. `"-"` when empty. |
| `formatDateTime(value)` | function | module | A timestamp in Indian format. `"-"` when empty. |
| `date` | variable | `formatDate`, `formatDateTime` | The parsed value. |
| `hoursSince(value, now)` | function | module | Hours since a timestamp, or `null`. |
| `time` | variable | `hoursSince` | The timestamp in milliseconds. |
| `formatTimeAgo(value, now)` | function | module | `"40 min ago"`, `"3 h ago"` or `"2 days ago"`; `null` when empty. |
| `capitalize(value)` | function | module | Capitalizes the first letter, as in `"male"` → `"Male"`. |
| `getInitials(name)` | function | module | `"Asha Rao"` → `"AR"`, for the avatar placeholder. |

### `src/lib/auth.js`
Server-side identity helpers.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `getCurrentUser(supabase)` | function | module | The verified signed-in user, `{ id, email, name, avatarUrl }`, or `null`. It uses `getClaims()`. |
| `claims` | variable | `getCurrentUser` | The verified token claims. |
| `metadata` | variable | `getCurrentUser` | Name and avatar from the sign-in provider. |
| `getCurrentProfile(supabase, userId)` | function | module | The user's `profiles` row, with role and completeness. |
| `jsonError(message, status)` | function | module | A JSON `{ error }` response with that HTTP status. |
| `requireUser(supabase)` | function | module | `{ user }` if signed in; otherwise `{ response }` with a 401. |
| `requireAdmin(supabase)` | function | module | `{ user, profile }` for an admin; otherwise a 401 or 403 `{ response }`. |
| `profile` | variable | `requireAdmin` | The caller's profile, used to check the role. |
| `REDIRECT_BASE` | constant | module | A dummy origin that `safeNextPath` resolves paths against. |
| `safeNextPath(value, fallback)` | function | module | Allows only same-site redirect paths, which blocks open redirects. It refuses `//`, backslashes, control characters (URL parsers drop tabs and newlines, so `"/<tab>/evil.com"` would become `"//evil.com"`) and anything that resolves to another site, and returns the normalized path, query and hash. |
| `url` | variable | `safeNextPath` | The value resolved against `REDIRECT_BASE`. |

### `src/lib/rateLimit.js`
Per-IP request limits, kept in server memory. The IP is read from `X-Forwarded-For` only behind trusted proxies; otherwise every caller shares one limit, because the client could write the header.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `MAX_BUCKETS` | constant | module | 5,000; above this, expired counters are cleared out. |
| `TRUSTED_PROXY_HOPS` | constant | module | `TRUSTED_PROXY_HOPS` from the environment; else 1 on Vercel and 0 elsewhere. |
| `buckets` | variable | module | Map from "route:IP" (or "route:shared") to recent request times. Kept on `globalThis`. |
| `getClientIp(request, proxyHops)` | function | module | The entry `proxyHops` from the right of `X-Forwarded-For`, or `null` when no proxy is trusted or the header is empty. |
| `forwardedFor` | variable | `getClientIp` | The header's addresses, in order. |
| `checkRateLimit(request, { key, limit, windowMs, proxyHops, now })` | function | module | Returns `{ ok: true }`, or `{ ok: false, retryAfter }` when the limit is reached. `proxyHops` and `now` default to the environment and the clock; tests pass them. |
| `bucketKey` | variable | `checkRateLimit` | This route and IP, or this route's shared bucket. |
| `recentHits` | variable | `checkRateLimit` | This caller's requests inside the window. |
| `existingKey`, `hitTimes` | variable | `checkRateLimit` | One stored counter and its times, while expired ones are cleared out. |
| `tooManyRequests(rateLimitResult)` | function | module | A 429 response with a `Retry-After` header. |

### `src/lib/stockoutFeatures.js`
The stock-out forecast's inputs and labels (`docs/PLANS/ML_system.md`, A2 and A4). Pure, with one import (`./stock.js`), so the Edge Function, scripts and tests build the same rows. A case is one bank × component × group at a grid time: 00:00, 06:00, 12:00 or 18:00 India time. Stock is rebuilt at the bank's own update times, carrying the last value forward. The Python dataset builder must give the same inputs (the parity test); the module's comments list each choice the summaries leave open.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `HOUR_MS`, `DAY_MS` | constant | module | An hour and a day in ms. |
| `INDIA_OFFSET_MS`, `GRID_STEP_MS` | constant | module | UTC+05:30, and the grid's 6 hours. |
| `HORIZONS_H` | constant | module | `[24, 48, 72]`: the forecast's horizons, the order of every probability and label array. |
| `LOOKBACK_DAYS`, `MIN_DAYS_SEEN` | constant | module | 7 days of lookback; rates "per day seen" divide by at least 1 day. |
| `DAYS_OF_SUPPLY_CAP` | constant | module | 30: days of supply when nothing was used, and its cap. |
| `CLEARED_PAGE_MIN_UNITS` | constant | module | 10: a whole component falling from this many to zero in one update is a cleared page. |
| `DEFAULT_COMPONENT`, `FORECAST_GROUPS` | constant | module | `PRBC`, and the 8 ABO and Rh groups (no Bombay groups). |
| `DEFAULT_GAP_HOURS` | constant | module | 6.5: sweeps further apart than this leave a gap that drops a case's window. |
| `INPUT_NAMES`, `CATEGORICAL_INPUTS` | constant | module | The 19 inputs in order, and the three that are categories (`ownership`, `stateCode`, `bloodGroup`). |
| `toMs(time)` | function | module | A time as ms, from ms or an ISO string. |
| `isGridTime(time)`, `latestGridTime(time)`, `gridTimesBetween(from, to)` | function | module | Whether a time is on the grid; the last grid time at or before it; every grid time in a range, both ends included. |
| `seriesFromHistory(rows)` | function | module | `stock_history` rows or archive lines → Map of bank code → `[{ at, stock }]`, sorted, one per update time. |
| `byBank`, `series` | variable | `seriesFromHistory` | Updates by bank and time, then the sorted lists. |
| `groupUnits(stock, component, group)`, `componentUnits(stock, component)` | function | module | Units of one group, and of a whole component; anything missing is 0. |
| `isClearedPage(previousStock, stock, component)` | function | module | Whether an update cleared a component from 10 units or more to zero. |
| `indexAt(events, time)` | function | module | Binary search: the last event at or before a time, or −1. |
| `ownershipOf(hospitalType)` | function | module | `blood_banks.hospital_type` as `govt`, `private`, `charitable`, `red_cross` or `other`. |
| `isRhNegative(group)` | function | module | Whether a group name ends in `-Ve`. |
| `buildInputs({ events, bank, group, asOf, component })` | function | module | The 19 inputs for one case, or `null` when it isn't scored (no update yet, no stock, or a dormant bank). |
| `current`, `latest`, `units`, `bankUnits`, `groupsStocked`, `windowStart`, `daysSeen` | variable | `buildInputs` | The latest event at `asOf`, its stock, the lookback's start, and the days the rates divide by. |
| `zeroDrops`, `decreases`, `increases`, `bankUse`, `updates`, `updates24h`, `isCleared` | variable | `buildInputs` | The lookback's counts, and whether the page stood cleared after the previous update. |
| `isClearStep`, `isRestoreStep`, `before`, `after` | variable | `buildInputs` | One step: a cleared page, the update that ends one, and the group's units either side. |
| `unitsBefore(hours)`, `units24h`, `units72h` | variable | `buildInputs` | The group's units that long before, or `null`. |
| `buildCases({ series, banks, asOf, component, groups })` | function | module | Every scored case at one grid time: `[{ hospitalCode, group, asOf, inputs }]`. |
| `findGaps(sweepTimes, maxGapHours)` | function | module | Pairs of consecutive sweeps further apart than the limit, as `[start, end]`. |
| `labelCase({ events, group, asOf, dataEnd, component, horizons, gaps })` | function | module | The label rules: per horizon, `true` if the group reaches zero within it, `null` if a cleared page comes first or the window runs past the data or into a gap, else `false`. `null` overall when the case isn't scored. |
| `firstZero` | variable | `labelCase` | When the group first reaches zero after `asOf`, and whether that was a cleared page. |

### `src/lib/stockoutModel.js`
Applies the forecast's exported JSON artifact and holds the daily jobs' maths (A2 to A4, A7). Pure. The artifact's format is described at the top of the file: per horizon, an intercept, terms (an input, a transform, mean, scale and coefficient, or a dummy's level) and Platt parameters.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ARTIFACT_FORMAT`, `TRANSFORMS` | constant | module | `bloodlink-stockout/1`; `identity`, `log1p`, `slog` (signed log) and `dummy`. |
| `KILL_FALSE_ALERTS`, `KILL_FALSE_ALERT_DAYS`, `CALIBRATION_RANGE`, `KILL_FAILED_RUNS` | constant | module | The kill switch: above 1.5 false alerts per bank per week for 3 days, a calibration ratio outside 0.8 to 1.25, or the last 2 runs failed. *Assumptions.* |
| `SHADOW_FALSE_ALERTS`, `SHADOW_CLEAN_DAYS` | constant | module | Shadow mode's exit: at most 1.2 false alerts, and no failed run for 7 days. |
| `ALERT_BUDGET` | constant | module | 1 false alert per bank per week, the cut-off's limit. |
| `FORECAST_OVERDUE_HOURS`, `RUN_STALE_MINUTES` | constant | module | 7: the admin overview's limit since the last finished scoring run; 30: a run that never finished counts as failed after this long. |
| `FORECAST_FLAGS` | constant | module | The flags the kill switch turns off; `admin_events` isn't one. |
| `sigmoid(x)`, `logit(p)` | function | module | The logistic function, computed stably, and its inverse. |
| `isFiniteNumber(value)` | function | module | Whether a value is a finite number. |
| `validateArtifact(artifact)` | function | module | `{ artifact }` or `{ error }`: the format, a logistic kind, a short id, and every horizon's intercept, Platt parameters and terms (known inputs, known transforms, dummies for categories, a positive scale). |
| `withCalibration(artifact, plattByHorizon)` | function | module | A copy with some horizons' Platt parameters replaced: the daily calibration. |
| `termValue(term, inputs)` | function | module | One term's value: 1 or 0 for a dummy, else (transform(input) − mean) ÷ scale. Throws on a missing number. |
| `horizonLogit(horizon, inputs)` | function | module | The logit and each term's contribution (coefficient × value). |
| `scoreCase(artifact, inputs, { reasonHorizon, reasonCount })` | function | module | `{ logits, pRaw, p, reasons }` in `HORIZONS_H` order; `p` is calibrated, and `reasons` explain the 48-hour risk. |
| `topReasons(contributions, inputs, count)` | function | module | The inputs with the largest positive contributions, summed per input, each with `text`. |
| `plural(count, word)`, `round1(value)`, `round2(value)` | function | module | Wording and rounding helpers. |
| `describeInput(input, inputs)` | function | module | One input as a plain-language reason, such as "only 2 units left". |
| `fitPlatt(scores, labels, { maxIterations })` | function | module | Platt scaling by Newton's method with a backtracking line search (Lin, Lin and Weng, 2007), with Platt's smoothed targets: `{ a, b, iterations, isConverged }`, for `sigmoid(a · logit + b)`. scikit-learn's A and B are −a and −b. |
| `targets`, `A`, `B`, `objective`, `value`, `h11`, `h22`, `h21`, `g1`, `g2`, `dA`, `dB`, `gd`, `step` | variable | `fitPlatt` | The smoothed targets, Platt's parameters, the loss, the Hessian and gradient, the Newton step and the line search. |
| `indiaDay(time)` | function | module | India's date of a time, `YYYY-MM-DD`. |
| `caseKey(entry)`, `bankDays(cases)` | function | module | Bank, group and day as one key; the number of banks and days among cases. |
| `alertMetrics(cases, cutOff)` | function | module | `{ falseAlerts, falseAlertsPerBankWeek, recall }` for alerts above the cut-off, one false alert at most per bank, group and day. |
| `chooseCutOff(cases, { budget })` | function | module | The lowest cut-off whose false alerts fit the budget: `{ cutOff, allowedFalseAlerts, … }`. 0 when every negative fits. |
| `highestNegative`, `allowed`, `sorted` | variable | `chooseCutOff` | Each key's highest negative score, the false alerts allowed, and those scores from the top. |
| `averagePrecision(scores, labels)` | function | module | PR-AUC as scikit-learn's `average_precision_score`, ties included; `null` without a positive. |
| `calibrationRatio(probabilities, labels)` | function | module | Mean prediction ÷ observed rate; `null` without a positive. |
| `forecastMetrics(cases, cutOff)` | function | module | One day's `forecast_daily_metrics` for one horizon: cases, positives, PR-AUC, calibration ratio, the cut-off, recall and false alerts at it, and lift by group. |
| `isFailedRun(run, now)` | function | module | A `forecast_runs` row with an error, or unfinished after 30 minutes. |
| `inRange(value, range)` | function | module | Whether a value lies in a closed range. |
| `evaluateKillSwitch({ metrics, runs, now })` | function | module | `{ shouldStop, reasons }` from one horizon's daily metrics (oldest first) and the scoring runs (newest first). |
| `evaluateShadowExit({ metrics, runs, isParityPassed, now })` | function | module | `{ canExit, blockers }`: A7's four conditions. |
| `forecastOverdue(lastFinishedAt, now)` | function | module | `{ isOverdue, hoursSince, limitHours }` for the admin overview. |

### `src/lib/supabase/client.js` and `src/lib/supabase/server.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `createClient()` | function | `client.js` | Browser Supabase client. The session lives in cookies. |
| `createClient()` | function | `server.js` | Server Supabase client for route handlers and server components. It runs as the signed-in user. |
| `cookieStore` | variable | `server.js` › `createClient` | Next.js request cookies, read and written by Supabase. |
| `getAll()`, `setAll(cookiesToSet)` | function | `server.js` › `createClient` | The cookie adapter Supabase calls to read and refresh the session. |

---

## Proxy, `src/proxy.js`
Runs before every page request.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `PROTECTED_PATHS` | constant | module | Pages that need sign-in: `/peer-to-peer`, `/set-details`, `/organization`, `/account`, `/admin`. |
| `isUnderPath(pathname, basePath)` | function | module | Whether a path is that path or below it. `/admin` matches `/admin/users`. |
| `proxy(request)` | function | module | Refreshes the session, then sends people to `/login`, `/set-details` or `/` as needed, and a signed-in user on `/login` to the page its `?next=` names, checked by `safeNextPath`. |
| `response` | variable | `proxy` | The pass-through response that carries refreshed cookies. |
| `getAll()`, `setAll(cookiesToSet, headers)` | function | `proxy` | The cookie adapter Supabase calls. |
| `userId` | variable | `proxy` | The signed-in user's id, or `null`. |
| `pathname`, `search` | variable | `proxy` | The requested path and query string. |
| `redirectTo(path)` | function | `proxy` | A redirect that keeps the refreshed session cookies. |
| `redirect` | variable | `redirectTo` | The redirect response being built. |
| `needsProfile` | variable | `proxy` | Whether this page needs the role or profile completeness. |
| `config` | constant | module | `matcher`: which requests the proxy runs on. API routes and static files are skipped. |

---

## API routes

### `src/app/api/search/route.js`: region search

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GET(request)` | handler | module | Stock for every bank in a state, or in one district. Up to 60 searches per minute per IP. |
| `rateLimitResult` | variable | `GET` | The rate-limit check. |
| `stale` | variable | `GET` | True when eRaktKosh failed and cached data was served. Sent back as the `X-Data-Stale` header. |

### `src/app/api/nearest/route.js`: banks around a point (not used by the pages)

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GET(request)` | handler | module | Banks within a radius of a point. Up to 60 per minute per IP. |
| `rateLimitResult`, `stale` | variable | `GET` | As in `/api/search`. |

### `src/app/api/reverse-geocode/route.js`: the place name under the map pin

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GET(request)` | handler | module | `{ label }` for `lat` and `lng`, rounded by `parseCoordinates` and named by `reverseGeocode`. `label` is `null` when Nominatim has no name or fails. Up to 30 per minute per IP; 400 for a bad pin. |
| `rateLimitResult`, `coords` | variable | `GET` | The rate-limit check, and the rounded pin or `{ error }`. |

### `src/app/api/blood-search/route.js`: location search and ranked search

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `DENSITY_RADIUS_M` | constant | module | 15 km; the area counted to decide urban or rural. |
| `DENSE_AREA_MIN_BANKS` | constant | module | 10; more banks than this within 15 km means urban. |
| `RINGS_M` | constant | module | Search rings: urban 5/10/15/25 km, rural 20/50/100/150 km. |
| `SEARCH_RADIUS_M` | constant | module | 150 km; the radius of the single `nearest` call. |
| `MAX_UNITS` | constant | module | 50; the most units one request can ask for. |
| `SLOW_UPSTREAM_GIVE_UP_MS` | constant | module | 3 s; how long stock lookups wait for eRaktKosh once `nearest` was slow or down. |
| `UPSTREAM_ERROR_MESSAGE` | constant | module | The message shown when eRaktKosh doesn't respond. |
| `stateBoundaries` | import | module | `assets/state_boundaries.json`, the state outlines. |
| `stateChecker` | constant | module | `createStateChecker(stateBoundaries)`, used to leave out banks placed outside their own state. |
| `parseRankingOptions(searchParams)` | function | module | Validates `units` and `urgency`. |
| `units`, `urgency` | variable | `parseRankingOptions` | Units needed, and the urgency level. |
| `loadInventory(candidateBanks, params, options)` | function | module | Stock for every state the banks are in, fetched in parallel. Returns `{ inventory, answers, failedStateNames }`. |
| `stateCodes` | variable | `loadInventory` | The distinct states to fetch. |
| `lookups` | variable | `loadInventory` | The settled result of each state fetch. |
| `inventory` | variable | `loadInventory` | Map from `hospitalCode` to `{ stockRow, checkedAt }`: the bank's eRaktKosh row and when it was fetched. |
| `answers`, `failedStateNames` | variable | `loadInventory` | The lookups that answered, and the names of states that couldn't be checked. |
| `inventoryResult`, `inventoryEntry` | variable | `GET` | `loadInventory`'s result, and one bank's entry in it. |
| `inventoryOptions` | variable | `GET` | `{ giveUpMs }` when `nearest` was slow or down, so stock lookups wait less. |
| `freshnessFields(inventoryResult)` | function | `GET` | The `freshness` block, with the `nearest` answer passed as `locationAnswer`, plus `stale` and `partial` for older clients. |
| `loadRoadLegs(origin, candidateBanks)` | function | module | OSRM legs for every candidate bank, keyed by `hospitalCode`: `{ legsByCode, failed }`. |
| `legs`, `failed`, `legsByCode` | variable | `loadRoadLegs`, `loadTravel` | The legs in bank order, whether any OSRM call failed, and the legs by bank code. |
| `toBankResult(nearbyBank, { stockRow, checkedAt }, stock, now)` | function | module | One [bank result](#data-shapes): location from `nearest`, details and stock from `blood-availability`, `checkedAt` and `isDormant`. |
| `GET(request)` | handler | module | Location search. Nearest mode without component and group; ranked mode with both. Up to 20 per minute per IP. |
| `rateLimitResult` | variable | `GET` | The rate-limit check. |
| `coords` | variable | `GET` | The validated pin position. |
| `filters` | variable | `GET` | The validated component and blood group. |
| `rankingOptions` | variable | `GET` | Units and urgency. |
| `isRankedMode` | variable | `GET` | True when both a component and a blood group were chosen. |
| `componentName`, `bloodGroupName` | variable | `GET` | Display names of the filters, used to match eRaktKosh's labels. |
| `now` | variable | `GET` | The request time, used for traffic and freshness. |
| `rainPromise` | variable | `GET` | The Open-Meteo lookup, started first. It never rejects. |
| `nearestResponse` | variable | `GET` | eRaktKosh's banks within 150 km. |
| `reachableBanks` | variable | `GET` | Those with a distance. |
| `misplacedBanks` | variable | `GET` | Those whose point is outside their own state or India, left out. How many lie within the widest ring is returned as `misplacedBanks`. |
| `nearbyBanks` | variable | `GET` | The rest, sorted by distance. |
| `banksWithinDensityRadius` | variable | `GET` | How many banks are within 15 km. Returned as `density`, and used to pick the traffic zone. |
| `area` | variable | `GET` | `"urban"` or `"rural"`. |
| `rings` | variable | `GET` | The ring radii for this area. |
| `maxRadiusM` | variable | `GET` | The largest ring. |
| `candidateBanks` | variable | `GET` | Banks inside the largest ring. |
| `countBanksWithin(radiusM)` | function | `GET` | How many candidate banks lie within a radius. Returned as `banksChecked`. |
| `zone` | variable | `GET` | The traffic zone from `trafficZone`. |
| `roadLegsPromise` | variable | `GET` | The OSRM lookup, started alongside the stock lookups. |
| `loadTravel()` | function | `GET` | Waits for OSRM and the weather, then returns `{ conditions, withTravel, isRoutingDegraded }`. |
| `rainMmPerHour`, `conditions` | variable | `loadTravel` | The current rain, and this search's traffic conditions. |
| `withTravel(bank)` | function | `loadTravel` | Adds `etaMinutes`, `roadDistanceM` and `etaSource` to a bank. |
| `describeTravel(conditions, banks, isRoutingDegraded)` | function | `GET` | The [travel block](#data-shapes): conditions plus how many banks were road-routed. |
| `sharedFields` | variable | `GET` | Response fields both modes return. |
| `travel` | variable | `GET` | The result of `loadTravel()`. |
| `stockedBanks` | variable | `GET` | Nearest mode: banks with matching stock. |
| `nearbyBank`, `stockRow` | variable | `GET` | One bank from `nearest`, and its stock row. |
| `stock` | variable | `GET` | That bank's matching stock. |
| `ringRadiusM` | variable | `GET` | The ring the results come from, from `nearestModeRing` (the first ring with an active stocked bank) or `rankedModeRing` (the first whose active banks cover the units). |
| `results` | variable | `GET` | Nearest mode: the stocked banks inside that ring. |
| `usableBanks` | variable | `GET` | Ranked mode: banks holding the exact blood group. |
| `units` | variable | `GET` | One bank's units of the exact group. |
| `banksInRing` | variable | `GET` | Usable banks inside the chosen ring. |
| `rankedBanks` | variable | `GET` | `banksInRing` scored and sorted by `rankSources`. |
| `plan` | variable | `GET` | The response plan from `buildResponsePlan`. |
| `status` | variable | `GET` | 502 when eRaktKosh failed, 500 for anything else. |

### `src/app/api/details/route.js`: the signed-in user's profile

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GET()` | handler | module | Returns email, name, avatar, role, `details` (when complete), `draft`, eligibility, and `hasAgreedToPrivacy` for the current privacy note. |
| `screening` | variable | `GET` | The user's `donor_screening` row. |
| `draft` | variable | `GET` | Whatever is saved so far, used to prefill the form. |
| `details` | variable | `GET`, `POST` | The complete, validated profile. |
| `POST(request)` | handler | module | Validates and saves the profile. Refuses (400) unless the person agreed to the current privacy note before or ticks it now (`acceptPrivacy: true`), which stores `privacy_version`. Deletes the screening answers when the person isn't a donor. |
| `errors` | variable | `POST` | Validation errors from `sanitizeDetails`. |
| `isAgreeing` | variable | `POST` | Whether this save carries the privacy tick. |
| `current`, `currentError` | variable | `POST` | The profile's stored `privacy_version`, read when there is no tick. |
| `rows` | variable | `POST` | `{ profile, screening }` rows from `detailsToRows`. |
| `updated`, `profileError` | variable | `POST` | The profile update's result and error. |
| `screeningResult` | variable | `POST` | Result of saving or deleting the screening answers. |

### `src/app/api/organization/route.js`: the user's own applications

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ORGANIZATION_COLUMNS` | constant | module | The columns sent back for an application. |
| `GET()` | handler | module | The user's applications, newest first. |
| `POST(request)` | handler | module | Submits a new application as `pending`. Returns 409 if one is already open. |
| `row`, `errors` | variable | `POST` | The validated row and any validation errors. |

### `src/app/api/account/route.js`: delete your own account

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `DELETE()` | handler | module | Signed in only (401 otherwise). Calls `delete_my_account()`, then clears the session cookies with a local sign-out. The last admin gets a 400 with the reason. |

### `src/app/api/admin/rpcError.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `rpcErrorResponse(error)` | function | module | Turns an error from an admin database function or `delete_my_account()` into HTTP 403, 400, 404, 409 or 500. 409 is the one-open-application index (23505), hit when an old application is approved while the same person has another open one. |

### `src/app/api/admin/organizations/review/route.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `DECISIONS` | constant | module | `["approved", "rejected", "suspended"]`. |
| `UUID_PATTERN` | constant | module | The format of a database id. |
| `POST(request)` | handler | module | Admin only. Approves, rejects or suspends an application through `review_organization()`. |
| `organizationId`, `decision`, `note` | variable | `POST` | Which application, what to do, and an optional note to the applicant. |

### `src/app/api/admin/users/role/route.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ASSIGNABLE_ROLES` | constant | module | Roles an admin can set here: `user` and `admin`. |
| `UUID_PATTERN` | constant | module | The format of a database id. |
| `POST(request)` | handler | module | Admin only. Grants or removes the admin role through `set_user_role()`. |

### `src/app/auth/callback/route.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `GET(request)` | handler | module | Completes Google sign-in or an email confirmation, then redirects. |
| `nextPath` | variable | `GET` | Where to go afterwards, checked by `safeNextPath`. |
| `origin` | variable | `GET` | The site's own address. |
| `code` | variable | `GET` | The sign-in code from Google sign-in or a confirmation link. |
| `tokenHash`, `otpType` | variable | `GET` | The token and its type from an email confirmation link. |

---

## Pages and components

### `src/app/layout.js`: root layout

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `geistSans`, `geistMono` | constant | module | The site's fonts. |
| `metadata` | constant | module | The default page title and description that Next.js puts in `<head>`. |
| `RootLayout({ children })` | component | module | The page frame: header, main content, and a footer with the emergency notice and a link to `/privacy`. It reads no cookies, so pages that don't read them either are prerendered (#49). |

### `src/app/page.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `HomePage()` | component | module | Landing page with links to search and to the donor network. |

### `src/app/components/Header.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `Header()` | component | module | Top navigation bar, with sign-out. It finds the signed-in user in the browser, so the root layout needn't (#49). The avatar and name link to `/account`. Nothing shows on the right until the session is known, so a signed-in user never sees "Sign in" flash. |
| `pathname` | variable | `Header` | The current path; the profile is read again when it changes. |
| `sessionUser` | state | `Header` | The browser session's user from `onAuthStateChange`: `undefined` until the first event, `null` when signed out. |
| `profile` | state | `Header` | `{ userId, fullName, role }` from `profiles`, read on each page change, so a saved name or a new role shows without a reload. |
| `isSigningOut` | state | `Header` | True while sign-out is running. |
| `userId`, `metadata`, `ownProfile` | variable | `Header` | The session's user id, its sign-in metadata (name and picture from Google), and `profile` when it belongs to that user. |
| `user` | variable | `Header` | `{ name, avatarUrl, role }` to show, or `null`. The name prefers the profile, then the sign-in metadata, then the email. |
| `initials` | variable | `Header` | Shown when the user has no avatar picture. |
| `handleSignOut()` | function | `Header` | Signs out, then reloads the home page. |

### `src/app/components/BloodMap.js`: the map on `/search`
Only loaded through `next/dynamic` with `ssr: false`, because Leaflet needs the browser.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `CARTO_API_KEY` | constant | module | Key for the CARTO map tiles. Without it, the map shows a watermark. |
| `TILE_URL` | constant | module | The map-tile address. |
| `TILE_ATTRIBUTION` | constant | module | The OpenStreetMap and CARTO credit line. |
| `GEOCODE_DELAY_MS` | constant | module | 800 ms; how long the pin must be still before its place name is looked up, so a burst of clicks sends one lookup. |
| `INDIA_CENTER` | constant | module | Where the map starts. |
| `toCoordsKey({ lat, lng })` | function | module | A text key for a pin position, used to match a place name to its pin. |
| `formatCoords({ lat, lng })` | function | module | `"19.0760, 72.8777"`. |
| `createPinIcon()` | function | module | The red pin marker. |
| `MapClickHandler({ onMapClick })` | component | module | Reports map clicks; it must sit inside `MapContainer`. |
| `BloodMap({ coords, onCoordsChange })` | component | module | The map with a click-to-pin marker, a "Use My Location" button and the pin's place name. |
| `mapKey` | state | `BloodMap` | A unique key per mount, which avoids Leaflet's "container reused" error. |
| `pinIcon` | state | `BloodMap` | The marker icon, created once. |
| `geocodedPlace` | state | `BloodMap` | `{ coordsKey, label }`: the last place name found for a pin. |
| `isGeocoding` | state | `BloodMap` | True while the place name is being looked up. |
| `isLocating` | state | `BloodMap` | True while waiting for the browser's location. |
| `gpsError` | state | `BloodMap` | Why the browser's location failed. |
| `coordsKey`, `controller`, `timer` | variable | `BloodMap` (effect) | The pin's key, a way to cancel the lookup, and the delay timer. The lookup asks `/api/reverse-geocode` with the pin rounded by `roundPinCoordinate`; the browser never contacts Nominatim. |
| `handleMapClick(nextCoords)` | function | `BloodMap` | Moves the pin to a clicked point. |
| `handleUseMyLocation()` | function | `BloodMap` | Asks the browser for its location and moves the pin there. |
| `hasPlaceLabel` | variable | `BloodMap` | Whether a place name is known for the current pin. |
| `pinLabel` | variable | `BloodMap` | The place name, or the coordinates when none is known. |

### `src/app/search/page.js`: `/search`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `MAX_UNITS` | constant | module | 50; the largest "Units needed" value. |
| `SAVED_COPY_WARNING_HOURS` | constant | module | 24; a saved copy older than this gets a red warning. |
| `MapPlaceholder()` | component | module | Shown while the map loads. |
| `BloodMap` | component | module | The map, loaded only in the browser. |
| `getErrorMessage(err)` | function | module | The server's error message, or a connection message. |
| `formatKm(meters)` | function | module | Kilometres with one decimal under 10 km. |
| `km` | variable | `formatKm` | The distance in km. |
| `describeFilters(componentId, bloodGroupId)` | function | module | Text such as `"O-Ve Packed Red Blood Cells"`, or `"any blood stock"`. |
| `parts` | variable | `describeFilters` | The chosen group and component names. |
| `StockBadges({ stock })` | component | module | Green badges with units per group. |
| `RankingDetails({ bank })` | component | module | Rank, score, ETA and the three reasons for a ranked bank. |
| `PlanCard({ plan, label })` | component | module | The suggested response plan, plus a shortfall warning and how ranking works. |
| `describeDistance(bank)` | function | module | `"6.2 km by road · about 24 min now"`, or the straight-line distance when there is no route. |
| `eta` | variable | `describeDistance` | The estimated-time text for a bank without a road route. |
| `TravelNote({ travel })` | component | module | What the travel times are based on: road routes or not, whose traffic, the India time, congestion and rain. |
| `place`, `basis` | variable | `TravelNote` | "Mumbai traffic" or "typical town-area traffic", and "road routes" or "straight-line distance". |
| `BankItem({ bank })` | component | module | One result: name, address, distance and ETA, stock, call link and directions. |
| `updatedAgo`, `checkedAgo` | variable | `BankItem` | How long ago the bank updated its stock, and how long ago bloodLink checked it. |
| `hasCoords` | variable | `BankItem` | Whether the bank has a location, needed for the directions link. |
| `describeResults(result)` | function | module | The heading above the results, which depends on the kind of search. |
| `stockedCount` | variable | `describeResults` | How many banks have matching stock. |
| `FreshnessBanner({ freshness })` | component | module | Nothing when the stock is live. Yellow when the oldest saved stock is under 24 h old, red when older, and the states that couldn't be checked. |
| `isBackup`, `savedAgo`, `savedHours`, `reason`, `failedStates` | variable | `FreshnessBanner` | Whether a memory or saved stock copy was used, the oldest one's age as text and in hours, why, and the failed states. |
| `SearchResults({ result })` | component | module | The freshness banner, the plan, the result list, and a note when banks placed outside their own state were left out. |
| `mode`, `banks`, `meta`, `label` | variable | `SearchResults` | Kind of search, the banks, the full API response, and the filter text. |
| `SearchPage()` | component | module | The search form, the map and the results. |
| `componentId`, `bloodGroupId` | state | `SearchPage` | The chosen component and blood group. |
| `stateCode`, `districtCode` | state | `SearchPage` | The chosen state and district, for region search. |
| `coords` | state | `SearchPage` | The pin position, for location search. |
| `activeSearch` | state | `SearchPage` | `"region"`, `"location"` or `null`: the search currently running. |
| `lastSearch` | state | `SearchPage` | The last kind of search, which the Retry button runs again. |
| `error` | state | `SearchPage` | Error message to show. |
| `result` | state | `SearchPage` | The last search result. |
| `unitsNeeded`, `urgency` | state | `SearchPage` | Ranked-search options. |
| `districts` | variable | `SearchPage` | Districts of the chosen state. |
| `canRank` | variable | `SearchPage` | True when both a component and a group are chosen. |
| `isSearching` | variable | `SearchPage` | True while a search runs, which disables both buttons. |
| `buildFilterParams()` | function | `SearchPage` | Query parameters for the chosen component and group. |
| `startSearch(mode)` | function | `SearchPage` | Clears the old result and error, and marks the search as running. |
| `handleRegionSearch()` | function | `SearchPage` | Runs a state or district search through `/api/search`. |
| `stockFilters` | variable | `handleRegionSearch` | Component and group names to match. |
| `fetchedAt` | variable | `handleRegionSearch` | When bloodLink fetched the data, from `X-Data-Fetched-At`. |
| `banks` | variable | `handleRegionSearch` | Normalized results with `checkedAt` and `isDormant`, best-stocked first. |
| `handleLocationSearch()` | function | `SearchPage` | Runs a nearest or ranked search through `/api/blood-search`, with the pin rounded by `roundPinCoordinate`. |

### `src/app/login/page.js` and `src/app/login/LoginForm.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `metadata` | constant | `page.js` | The page title, "Sign in · Bloodlink". |
| `LoginPage({ searchParams })` | component | `page.js` | Reads `?next=` and `?error=`, then shows the form. |
| `nextPath` | variable | `LoginPage` | Where to go after signing in. |
| `callbackFailed` | variable | `LoginPage` | Whether a sign-in link just failed. |
| `buildCallbackUrl(path)` | function | `LoginForm.js` | The `/auth/callback` address Supabase returns to. |
| `LoginForm({ nextPath, callbackFailed })` | component | `LoginForm.js` | Google button plus email/password sign-in and sign-up, with a note that accounts are for people aged 18 or over and a link to the privacy note. |
| `mode` | state | `LoginForm` | `"signin"` or `"signup"`. |
| `fullName`, `email`, `password` | state | `LoginForm` | The form's fields. |
| `isBusy` | state | `LoginForm` | True while a request runs. |
| `error`, `message` | state | `LoginForm` | Error and information messages. |
| `isSignIn` | variable | `LoginForm` | Whether the form is in sign-in mode. |
| `handleGoogleSignIn()` | function | `LoginForm` | Starts Google sign-in. |
| `oauthError` | variable | `handleGoogleSignIn` | Why Google sign-in couldn't start. |
| `handleSubmit(event)` | function | `LoginForm` | Signs in or signs up with email and password. |
| `signInError`, `signUpError` | variable | `handleSubmit` | Why sign-in or sign-up failed. |
| `handleToggleMode()` | function | `LoginForm` | Switches between sign-in and sign-up. |

### `src/app/set-details/page.js`: the profile form, in two steps or three for donors

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `EMPTY_FORM` | constant | module | Blank values for every field. No gender is preselected, since it sets the donation gap. |
| `PERSONAL_STEP`, `BLOOD_STEP`, `SCREENING_STEP` | constant | module | Step numbers 0, 1 and 2. The screening step is for donors only. |
| `formFromDetails(details)` | function | module | Flattens a saved `details` object into the form's fields. |
| `donorDetails` | variable | `formFromDetails` | The saved screening answers. |
| `detailsFromForm(form)` | function | module | Builds the nested `details` object the API expects. |
| `FormField({ label, htmlFor, children })` | component | module | A label above an input. |
| `CheckboxRow({ checked, onChange, children })` | component | module | A checkbox with its question. |
| `PrivacyConsentRow({ checked, onChange })` | component | module | The privacy tick box ("I'm 18 or older, I've read the privacy note, and I agree…"), shown on the step that saves until the person has agreed to the current note. The link opens `/privacy` in a new tab, so the form keeps its answers. |
| `StepIndicator({ stepCount, currentStep })` | component | module | The numbered dots and lines at the top of the form. |
| `stepIndexes`, `isDone`, `isLast`, `dotClass` | variable | `StepIndicator` | The step numbers, whether a step is finished or last, and the dot's style. |
| `SetDetailsPage()` | component | module | The profile form. It prefills when editing. |
| `form` | state | `SetDetailsPage` | Every field's current value. |
| `currentStep` | state | `SetDetailsPage` | Which step is showing. |
| `isProfileLoaded` | state | `SetDetailsPage` | False until the saved profile has loaded. |
| `isEditing` | state | `SetDetailsPage` | True when a complete profile already exists. |
| `isSaving` | state | `SetDetailsPage` | True while saving. |
| `error` | state | `SetDetailsPage` | Error message to show. |
| `needsPrivacyConsent` | state | `SetDetailsPage` | Whether to show the privacy tick box. True until `/api/details` says the person agreed to the current note. |
| `isPrivacyAccepted` | state | `SetDetailsPage` | Whether the box is ticked. |
| `handleFieldChange(fieldName)` | function | `SetDetailsPage` | Returns the change handler that copies one input into `form`. |
| `value` | variable | `handleFieldChange` | The input's value, or the checkbox's state. |
| `districts` | variable | `SetDetailsPage` | Districts of the chosen state. |
| `eligibility` | variable | `SetDetailsPage` | Live eligibility for the answers so far. |
| `stepCount` | variable | `SetDetailsPage` | 3 for donors, 2 for everyone else. |
| `isWaitingForConsent` | variable | `SetDetailsPage` | True while the box is needed but not ticked; it disables the save button. |
| `handleSubmit()` | function | `SetDetailsPage` | Saves through `/api/details`, with `acceptPrivacy` when the box was ticked, then opens `/peer-to-peer`. |
| `handlePersonalStepSubmit(event)` | function | `SetDetailsPage` | Checks step 1's required fields, gender included, then moves on. |
| `handleBloodStepSubmit(event)` | function | `SetDetailsPage` | Checks the blood group, then moves on or saves. |

### `src/app/peer-to-peer/page.js`: "My profile"

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ROLE_LABELS` | constant | module | Badge text for hospital, blood-bank and admin accounts. |
| `DetailRow({ label, children })` | component | module | One label-and-value row of the profile tables. |
| `EligibilityBadge({ eligibility })` | component | module | "Yes", "Needs a staff check" or "Not right now". |
| `PeerToPeerPage()` | component | module | The user's profile, role badge and eligibility. |
| `profile` | state | `PeerToPeerPage` | The `/api/details` response. `undefined` while loading, `null` on failure. |
| `loadError` | state | `PeerToPeerPage` | Message shown when loading failed. |
| `details`, `eligibility` | variable | `PeerToPeerPage` | Parts of that response. |
| `displayName` | variable | `PeerToPeerPage` | The profile name, falling back to the sign-in name or the email. |
| `initials` | variable | `PeerToPeerPage` | Shown when there is no avatar. |

### `src/app/account/page.js` and `DeleteAccountCard.js`: "Your account"
Every signed-in person can reach it, whatever their profile's state, so anyone can delete their account.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `metadata` | constant | `page.js` | The page title, "Your account · Bloodlink". |
| `AccountPage()` | component | `page.js` | Server component: the email, whether and when the person agreed to the current privacy note, links to `/privacy` and `/set-details`, and the delete card. Sends a signed-out visitor to `/login?next=/account`. |
| `supabase`, `user`, `profile` | variable | `AccountPage` | The server client, the signed-in user, and their `role`, `privacy_version` and `privacy_accepted_at`. |
| `CONFIRM_WORD` | constant | `DeleteAccountCard.js` | `"DELETE"`; the word to type before the button works. |
| `DeleteAccountCard({ isAdmin })` | component | `DeleteAccountCard.js` | Explains what goes, asks for the confirm word, then calls `DELETE /api/account` and opens the home page. Admins are reminded that the last admin can't delete their account. |
| `isConfirming`, `confirmText`, `isDeleting`, `error` | state | `DeleteAccountCard` | Whether the confirm step shows, the typed word, whether the request is running, and its error. |
| `handleDelete(event)`, `handleCancel()` | function | `DeleteAccountCard` | Deletes the account, then signs the browser's session out locally so the header updates; closes the confirm step. |

### `src/app/privacy/page.js`: the privacy note

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `metadata` | constant | module | The page title, "Privacy note · Bloodlink". |
| `STORED_DATA` | constant | module | Rows of the "What bloodLink stores" table: `{ what, why, who }`. |
| `OUTSIDE_SERVICES` | constant | module | Rows of the "Who else receives data" table: `{ service, gets, why }`. Add a row for any new outside service. |
| `Section({ title, children })` | component | module | One card of the note. |
| `PrivacyPage()` | component | module | The note: what is stored, what isn't, who receives what, how long, your rights, and changes. Shows `PRIVACY_VERSION` as its date. |
| `contact` | variable | `PrivacyPage` | A mail link to `CONTACT_EMAIL`, or the GitHub page when it isn't set. |

### `src/app/organization/page.js`: apply as a hospital or blood bank

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `EMPTY_FORM` | constant | module | Blank application fields. |
| `ApplicationCard({ application })` | component | module | One of the user's applications, with its status and the reviewer's note. |
| `OrganizationPage()` | component | module | The user's applications, plus the form when none is open. |
| `applications` | state | `OrganizationPage` | The user's applications. `undefined` while loading. |
| `form` | state | `OrganizationPage` | The application form's fields. |
| `isSubmitting` | state | `OrganizationPage` | True while submitting. |
| `error` | state | `OrganizationPage` | Error message to show. |
| `handleFieldChange(fieldName)` | function | `OrganizationPage` | Returns the change handler that copies one input into `form`. |
| `districts` | variable | `OrganizationPage` | Districts of the chosen state. |
| `openApplication` | variable | `OrganizationPage` | A pending or approved application. While one exists, the form is hidden. |
| `handleSubmit(event)` | function | `OrganizationPage` | Submits the application and adds it to the list. |

---

## Admin pages, `src/app/admin/`

### `src/app/admin/layout.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `metadata` | constant | module | The page title, "Admin · Bloodlink". |
| `TABS` | constant | module | The admin navigation links. |
| `AdminLayout({ children })` | component | module | Shows admin pages only to admins, with the tab bar. |

### `src/app/admin/page.js`: Overview

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `COUNT_ONLY` | constant | module | Query options that return a row count instead of rows. |
| `countRows(query)` | function | module | Runs a count query and returns the number. |
| `StatCard({ label, value, href })` | component | module | One number tile, optionally a link. |
| `card` | variable | `StatCard` | The tile's content. |
| `CollectionHealthCard({ stats })` | component | module | eRaktKosh health over the last 24 hours from `upstream_stats`: totals, then the 8 worst-served states. |
| `rows`, `totalCalls`, `okCalls`, `stateRows` | variable | `CollectionHealthCard` | The view's rows, call totals, and the states sorted by oldest good fetch. |
| `LastSweepLine({ lastRun, lastSweep })` | component | module | The last finished stock run, cloud or laptop, and a red warning when none has finished within the sweep interval plus 2 hours. Shows nothing while `collector_runs` doesn't exist. |
| `run`, `interval`, `isOverdue`, `hoursSince`, `limitHours` | variable | `LastSweepLine` | The run, the latest sweep's interval, and `collectionOverdue`'s answer. |
| `AdminOverviewPage()` | component | module | Counts, the review queue, the last sweep, collection health and recent activity. |
| `userCount`, `completeProfileCount`, `donorCount`, `adminCount` | variable | `AdminOverviewPage` | Account totals. |
| `pendingCount`, `approvedCount` | variable | `AdminOverviewPage` | Pending and verified organizations. |
| `pendingApplications` | variable | `AdminOverviewPage` | Up to 20 applications waiting for review. |
| `recentAuditEntries`, `auditEntries` | variable | `AdminOverviewPage` | The 8 latest audit-log entries: the query result, and its rows. |
| `collectionStats` | variable | `AdminOverviewPage` | The `upstream_stats` query result. |
| `lastRun`, `lastSweep` | variable | `AdminOverviewPage` | The latest finished stock run in `collector_runs`, and the latest row of `collector_sweeps`. |

### `src/app/admin/AdminActions.js`: buttons used on admin pages

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `useAdminAction()` | hook | module | Posts to an admin API route and refreshes the page, tracking busy state and errors. |
| `isBusy`, `error` | state | `useAdminAction` | Whether the request is running, and its error. |
| `runAction(url, body)` | function | `useAdminAction` | Sends the request. |
| `decisionsFor(status)` | function | module | Buttons for an application's status, as `[decision, label, buttonClass]`. |
| `OrganizationActions({ organizationId, status })` | component | module | Note box plus Approve, Reject or Suspend buttons. |
| `note` | state | `OrganizationActions` | The note to the applicant. |
| `submitDecision(decision)` | function | `OrganizationActions` | Sends the chosen decision. |
| `RoleActions({ userId, role, isSelf })` | component | module | "Make admin" or "Remove admin", with a confirmation. |
| `nextRole`, `label` | variable | `RoleActions` | The role to switch to, and the button text. |
| `handleClick()` | function | `RoleActions` | Asks for confirmation, then changes the role. |

### `src/app/admin/OrganizationCard.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ORGANIZATION_SELECT` | constant | module | Application columns, plus the applicant's and reviewer's names. |
| `OrganizationCard({ organization })` | component | module | One application, with its review buttons. |
| `location` | variable | `OrganizationCard` | "District, State". |

### `src/app/admin/organizations/page.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `STATUS_FILTERS` | constant | module | The status tabs: all, pending, approved, rejected, suspended. |
| `AdminOrganizationsPage({ searchParams })` | component | module | Every application, filtered by status. |
| `status`, `query` | variable | `AdminOrganizationsPage` | The chosen filter, and the database query. |

### `src/app/admin/users/page.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ROLES`, `ROLE_LABELS` | constant | module | Every role, and what each is called on screen. |
| `sanitizeSearchText(value)` | function | module | Keeps only characters that are safe in a database filter. |
| `AdminUsersPage({ searchParams })` | component | module | Search users by name or email, filter by role, change admin rights. |
| `searchText`, `role` | variable | `AdminUsersPage` | The search box and role filter (`?q=` and `?role=`). |
| `currentUser` | variable | `AdminUsersPage` | The admin viewing the page, so their own row says "Remove my admin role". |
| `query` | variable | `AdminUsersPage` | The database query. |

### `src/app/admin/audit/page.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `describeAuditEntry(entry)` | function | module | One line of context for an entry, such as "City Blood Centre (blood_bank), was pending". |
| `details` | variable | `describeAuditEntry` | The details the database stored with the entry. |
| `describeActor(entry)` | function | module | Who acted: the admin's email, "system" for the first-admin script, or "a deleted account". |
| `AdminAuditPage()` | component | module | The 200 latest admin actions. |

---

## Tests

### `tests/ranking.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `MS_PER_HOUR`, `IST_OFFSET_MS` | constant | module | One hour, and India's +5:30 offset, in milliseconds. |
| `NOW` | constant | module | Fixed test clock: 23 Oct 2026, 12:00 India time. |
| `hoursBefore(hours)` | function | module | An eRaktKosh-style update time some hours before `NOW`. |
| `indiaWallClock` | variable | `hoursBefore` | That time on an Indian clock. |
| `makeBank(hospitalCode, etaMinutes, units, updatedHoursAgo)` | function | module | A test bank holding O-Ve, some minutes away by road. |
| `rank(banks, urgency, unitsNeeded)` | function | module | `rankSources` at the fixed clock. |
| `weights` | variable | first test | One urgency level's weight set. |
| `stockRow` | constant | exact-group tests | A sample eRaktKosh row with O-, A+ and O+ red cells. |
| `nearBank`, `farBank` | constant | critical scenario | Bank A: 10 min, 1 unit, fresh. Bank B: 40 min, 6 units, 30 h old. |
| `exactBank`, `spareBank` | constant | spare-stock scenario | 15 min each; exactly 3 units against 9. |
| `margin(urgency)` | function | spare-stock scenario | How many points the spare bank leads by at an urgency. |
| `closeExact`, `fartherSpare` | constant | spare-stock scenario | 10 min with exactly 2 units, against 22 min with 4. |
| `closeBank`, `idealBank` | constant | trade-off scenario | 7 min, 1 unit, stale; against 101 min, 5 units, fresh. |
| `ranked`, `plan` | variable | each test | The ranked banks and the plan being checked. |

### `tests/traffic.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `at(localDateTime)` | function | module | A `Date` for an India-time wall clock. |
| `FRIDAY_6PM`, `FRIDAY_3AM` | constant | module | Rush hour and night on Friday 23 Oct 2026. |
| `MUMBAI`, `NASHIK` | constant | module | A point inside a TomTom metro, and one outside all of them. |
| `mumbaiProfile`, `mumbaiZone` | constant | module | Mumbai's entry in the profile file, and its zone. |
| `MUMBAI_TO_CSMT` | constant | module | A real OSRM leg: 14.2 km, 869.6 s. |
| `fridayNight`, `fridayRush` | constant | travel tests | Traffic conditions at 3 am and 6 pm. |
| `model`, `noRoute` | constant | factory tests | `createTrafficModel` on the real profiles, checked against the app's exports, and a trip with no OSRM leg. |
| `minutes` | constant | factory tests | Minutes before rounding, which must round to `estimateTravel`'s answer. |
| `tested` | constant | factory tests | A model with a 1.58 detour factor and a town scale of 0.5. |

### `tests/routing.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `table(durations, distances)` | function | module | An OSRM table answer with the source in front. |
| `fakeHttp(...answers)` | function | module | A stand-in for axios that answers from a list and records each URL. Also used for the Nominatim tests. |
| `point` | constant | cache test | A rounded pin near Panaji; each Nominatim test uses its own point, because the cache is shared. |

### `tests/eraktkosh-client.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ROW` | constant | module | A sample eRaktKosh row with a stray comma and an "O +ve" label. |
| `SAVED` | constant | module | A saved copy, as the saved store returns it. |
| `makeClock(start)` | function | module | A clock the tests move by hand: `{ now, advance }`. |
| `scriptedHttp(...steps)` | function | module | A stand-in for axios; each GET runs the next step and is recorded. |
| `answers`, `httpError`, `networkError`, `timeoutError`, `answersAfter` | function | module | Steps: an answer, an HTTP error, a refused connection, a timeout, a slow answer. |
| `wait(ms)` | function | module | A pause. |
| `makeClient(http, options)` | function | module | A client with no retry delay and a 50 ms give-up. |
| `goa` | constant | module | `{ stateCode: "30" }`. |
| `callsWhenOpened` | variable | circuit tests | eRaktKosh calls made before a circuit opened, to show later lookups skip it. |
| `at(iso)` | function | freshness tests | An ISO time in milliseconds. |
| `query` | constant | pin-precision test | A pin given to 6 decimals, which `parseCoordinates` must round to 3. |

### `tests/state-bounds.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `square(west, south, size)` | function | module | A square ring, for test outlines. |
| `TEST_BOUNDARIES` | constant | module | Two 1° test states side by side, the second with a hole. |
| `testChecker`, `realChecker` | constant | module | Checkers for the test squares and for `assets/state_boundaries.json`. |
| `outside`, `justOver` | variable | test-square tests | A distance outside a state, and a point about 3 km over a border. |

### `tests/rings.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `URBAN_RINGS` | constant | module | 5, 10, 15 and 25 km. |
| `bank(distanceKm, units, isDormant)` | function | module | A test bank. |
| `banks` | constant | ranked test | Four banks, one dormant. |

### `tests/rate-limit.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `requestFrom(forwardedFor)` | function | module | A request with that `X-Forwarded-For`, or none. |
| `options` | constant | rate-limit tests | A limit of 2 a minute at a fixed time. |
| `results` | variable | rate-limit tests | Three requests' results, from three different claimed addresses. |

### `tests/auth.test.js`
`safeNextPath` keeps same-site paths with their query and hash, and refuses other sites, backslashes, tabs and newlines. `rpcErrorResponse` maps 23505 to 409 and keeps the admin functions' own codes.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `value` | variable | loops | One redirect value to try. |
| `response` | variable | `rpcErrorResponse` test | The 409 response. |

### `tests/stock-quality.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `NOW` | constant | module | Fixed test clock: 23 Oct 2026, 12:00 India time. |
| `row(hospitalCode, entrydate, quantities, extra)` | function | module | A test eRaktKosh row with stray commas. |
| `quantitiesOf(cleanedRow)` | function | module | A row's cleaned red-cell quantities text. |
| `one`, `two` | constant | report test | Two reports to add together. |

### `tests/collector.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `NOW` | constant | module | Fixed test clock: 3 Nov 2026, 12:00 India time. |
| `stockRow(hospitalCode, entrydate, quantities)` | function | module | A test eRaktKosh row with red-cell stock. |
| `fakeDb({ previous, directory, recentRun, failOn })` | function | module | A stand-in for the pg session: records every statement, answers the collector's reads, and throws on statements matching `failOn`. |
| `queries`, `statements(pattern)` | variable | `fakeDb` | Every statement sent, and those matching a pattern. |
| `fakeFetch(answers)` | function | module | A stand-in for `fetch`, answering by `stateCode` (or `nearest` for the directory, `refresh` for the auto-refresh list) with rows, an HTTP status or a network error. |
| `makeCollector(options)` | function | module | A collector over the fakes, with the archive, errors and called URLs captured. |
| `archived`, `errors`, `urls` | variable | `makeCollector` | What it archived, logged as errors, and fetched. |
| `SECRET` | constant | request-checks tests | A 40-character test secret. |

### `tests/stockout-features.test.js`
The grid, the series rebuild, the cleared-page rule, the 19 inputs on a hand-worked series, the label rules (horizons, quick refills, cleared pages, the end of the data and gaps) and `findGaps`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `HOUR`, `DAY`, `T` | constant | module | An hour and a day in ms, and 12:00 India time on 4 November 2026, a grid time. |
| `event(offsetMs, groups)` | function | module | One update at `T` plus the offset, with that red-cell stock (none when omitted). |
| `events`, `bank` | constant | the inputs tests | A bank's series over 10 days, and its attributes. |
| `before`, `label(later, options)` | variable | the labels tests | The update before `T`, and `labelCase` with later updates added. |

### `tests/stockout-model.test.js`
The artifact's checks and scoring, the reasons, parity with scikit-learn (`tests/fixtures/stockout_sklearn.json`: Platt to 6 decimal places, average precision to 12), the cut-off, the metrics, the kill switch, the shadow exit and the overdue rule.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `HOUR`, `NOW` | constant | module | An hour in ms, and the test clock. |
| `horizon(intercept, platt)`, `artifact`, `inputs` | function, constant | module | A small artifact with five terms, and one case's inputs. |
| `sklearn` | constant | module | The fixture: seeded scores and labels, scikit-learn's Platt parameters and calibrated values, and its average precision. |
| `cases` | constant | the cut-off tests | 14 banks on one day, two of them stock-outs, and a second negative case for one key. |
| `day(falseAlertsPerBankWeek, calibrationRatio)`, `run(hoursAgo, error, finished)` | function | the kill-switch tests | A daily metrics row, and a `forecast_runs` row. |

### `tests/compatibility.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `donorGroupNames(recipientCode, componentCode, options)` | function | module | Names of the groups a patient can receive, to compare against expected lists. |

### `tests/stock-eligibility-profile.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `NOW` | constant | module | Fixed test clock. |
| `bank` | constant | stock tests | A sample eRaktKosh stock row with three components. |
| `plasmaOnlyBank` | constant | stock tests | Saifai (1702), which lists only plasma: a saved row that must never count as red cells. |
| `rows` | variable | `keepOnlyComponent` test | Rows cut down to red cells. |
| `makeDonor(overrides, donorDetails)` | function | eligibility tests | A test donor's `details`. |
| `result` | variable | eligibility test | One eligibility result. |
| `firstTime`, `reasons` | variable | NBTC 2017 tests | A 63-year-old with no recorded donation, and the reasons for three ticked screening answers. |
| `validProfile` | constant | profile tests | A valid form submission, plus a forbidden `role` field. |
| `rows`, `roundTrip` | variable | profile test | Database rows, and the `details` read back from them. |
| `afterMidnightInIndia` | constant | India-date test | 01:30 on 24 October in India, still 23 October in UTC. |
| `withDonation(lastDonationDate)` | function | India-date test | `validProfile` with that last donation date. |
| `validApplication` | constant | organization tests | A valid blood-bank application. |
| `maharashtra`, `westBengal` | constant | district tests | Those states' objects from `constants.js`. |
| `fromAddress(address, state)` | function | district tests | `districtFromAddress` with the state's name and districts. |

---

## Scripts and config files

### `scripts/migrate.mjs`: `npm run db:migrate`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `databaseUrl` | constant | module | `SUPABASE_DB_URL` from `.env.local`. |
| `migrationsDir`, `migrationFiles` | constant | module | `supabase/migrations/`, and its `.sql` files in order. |
| `client` | constant | module | The Postgres connection. |
| `rows`, `appliedVersions` | variable | module | Migrations already recorded as applied. |
| `fileName`, `version`, `nameParts` | variable | loops | One migration file, its timestamp, and its name. |
| `sql` | variable | loop | That file's SQL. |
| `appliedCount` | variable | module | How many migrations this run applied. |

### `scripts/make-admin.mjs`: `npm run db:make-admin -- <email>`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `databaseUrl`, `email` | constant | module | Connection string, and the account to promote. |
| `client` | constant | module | The Postgres connection. |
| `rows`, `admin` | variable | module | The updated profile, and its id and email. |

### `scripts/copy-project.mjs`: the move to Mumbai (#28)
Copies every table from the project in `SUPABASE_DB_URL`, which it only reads, into the project in `MUMBAI_SUPABASE_DB_URL`. Prints project refs, table names and counts, never a connection string.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `sourceUrl`, `targetUrl` | constant | module | The two connection strings. The script stops if either is missing or both name one project. |
| `projectRef(url)` | function | module | The project ref from the pooler user name `postgres.<ref>`. |
| `TABLES` | constant | module | `[table, primary key, "update" or "skip"]` in copy order: `auth.users` first, since its trigger makes the profile rows; organizations before profiles, which point at them. |
| `PAGE_SIZE` | constant | module | 500 rows per page. |
| `quote(name)` | function | module | A quoted column name. |
| `connect(url)` | function | module | An open Postgres client. |
| `countRows(client, table)` | function | module | A table's row count. |
| `insertableColumns(client, table)` | function | module | `[{ name, isIdentity }]` for columns that aren't generated, in table order. |
| `copyTable(source, target, tableSpec)` | function | module | Copies one table a page at a time, as JSON (`json_agg`, then `json_populate_recordset`), with the columns both projects have. Existing rows are updated or skipped. The app's own triggers are off while a public table is copied, so `updated_at` and the consent time keep their values. Identity sequences are moved past the copied ids. |
| `sourceNames`, `columns`, `columnList`, `hasIdentity`, `keyList`, `updates`, `conflictClause`, `isPublic`, `page` | variable | `copyTable` | The source's columns, the shared ones, their SQL list, whether one is an identity, the key list, the update list, the `on conflict` clause, whether the app owns the table, and one page of rows. |
| `compareCounts(source, target)` | function | module | Prints each table's count in both projects; true when all match. |
| `isCheckOnly` | constant | module | `--check`: compare counts and change nothing. |
| `migration` | constant | module | The result of running `migrate.mjs` with `SUPABASE_DB_URL` set to the new project. |
| `source`, `target` | constant | module | The two connections. The source reads inside one repeatable-read, read-only transaction, so the copy is one consistent snapshot; the target writes inside one transaction, committed only when every count matches. |

### `scripts/snapshot.mjs`: the laptop collector, run by hand, `npm run snapshot`
The Node wrapper around `src/lib/collector.js`: flags, the log file, a pg connection as `bloodlink_ingest`, and the local archive. Runs are recorded in `collector_runs` when that table exists.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `args`, `argValue(name)` | variable | module | The command-line arguments, and the value after a flag. |
| `isDirectoryRun`, `isAllStates`, `requestedStates`, `archiveDir`, `shouldPrune`, `logFile` | constant | module | What this run does, and the `--log` file, if any. |
| `write(text)` | function | module | With `--log`: appends a line to the log file. `console.log` and `console.error` are pointed at it. |
| `signal` | variable | module | Each of SIGINT, SIGBREAK, SIGHUP and SIGTERM. The handler logs it with the time, carries on after Ctrl+C and Ctrl+Break, and exits after a close or terminate. |
| `databaseUrl` | constant | module | `SUPABASE_DB_URL` from `.env.local`. |
| `districtData`, `knownStateCodes`, `stateCodes` | constant | module | The lookup file, every state code, and the states to save. An unknown code stops the run before any call. |
| `appendArchive(fileName, lines)` | function | module | Appends JSON lines to a file in the archive folder. |
| `localArchive` | constant | module | With `--archive`: changed rows to `history/<UTC day>.ndjson`, one line per sweep to `sweeps.ndjson`, and the directory answer to `directory/<UTC day>.json`. |
| `client`, `isSuccess` | variable | module | The Postgres connection, and the exit status. An error from connecting onwards is logged as `fatal: …` and makes the exit status 1, which `../blood_data/scripts/run_collector.ps1` passes on to Task Scheduler. |
| `collector` | constant | module | `createCollector` with runner `laptop`. The state outlines are read only for `--directory`. |
| `runJob(job, work)` | function | module | Records a job (`directory`, `stock` or `prune`) in `collector_runs`, runs it, and records its outcome or error. |
| `run`, `outcome` | variable | `runJob` | The job's row, and what it returned. |

### `scripts/check-cloud-collector.mjs`: checks the cloud collector's SQL
Runs on the project in `SUPABASE_DB_URL` inside one transaction that is always rolled back. Applies the `*_cloud_collector.sql` migration first if the project lacks it. No tick runs, so `pg_net` is never called.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `migrationFile` | constant | module | The cloud collector migration's file name. |
| `check(name, isOk, detail)` | function | module | Prints one result and counts failures. |
| `one(sql, params)` | function | module | The first row of a query. |
| `errorCode(sql, params)` | function | module | Runs a statement in a savepoint and returns the SQLSTATE it raised, or `null`. |
| `due(batch, interval)` | function | module | `collector_due`'s answer. |
| `moveLastSweep(ago)` | function | module | Moves the newest sweep's start into the past, since `now()` is fixed inside the transaction. |
| `first`, `second`, `jobs`, `tick`, `pruned`, `left`, `bucket` | variable | module | The values each check reads. |

### `scripts/check-forecast-schema.mjs`: checks the forecast's schema
Runs on the project in `SUPABASE_DB_URL` inside one transaction that is always rolled back. Applies the `*_stockout_forecast.sql` migration first if the project lacks it. Writes nothing to the auth schema: the admin checks borrow an existing admin's id, and are skipped when there is none.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `migrationFile`, `isLocal` | constant | module | The migration's file name, and whether the database is on this machine (no TLS), for testing the script itself. |
| `check`, `one`, `errorCode` | function | module | As in `check-cloud-collector.mjs`. |
| `asUser(userId)` | function | module | Switches to `authenticated` with that user's claims, as the Data API would. |
| `GRID`, `forecastRow(asOf, p)`, `model(id, status)` | constant, function | module | 12:00 India time a day ago, and inserts of a forecast and of a model version. |
| `flags`, `stopped`, `after`, `admin`, `bucket` | variable | module | The values each check reads. |

### `ml/make_parity_fixtures.py`: scikit-learn's reference values
Writes `tests/fixtures/stockout_sklearn.json`: four seeded cases (over-confident, rare, scores beyond 30, ties) with scikit-learn's Platt parameters (`_sigmoid_calibration`, what `CalibratedClassifierCV(method="sigmoid")` calls), calibrated values at probe scores, and `average_precision_score`. Inputs are rounded to 6 decimals first so JS and Python fit the same numbers. Run `python -I ml/make_parity_fixtures.py` from `bloodlink/` with `ml/requirements.txt` installed; the output is the same every run.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `OUT` | constant | module | The fixture's path. |
| `case(name, scores, labels, probe)` | function | module | One fixture case. |
| `main()` | function | module | Draws the four cases with seed 20261104 and writes the file with the library versions. |

### `scripts/setup-cloud-collector.mjs`: sets up, deploys, schedules
With no flag: a new random secret, stored as the function secret `COLLECTOR_SECRET` and in Vault as `collector_secret`, with the function's URL as `collector_url`; then deploys `collect-stock` with JWT verification off. Re-running rotates the secret. `--deploy-only` redeploys; `--schedule [interval] [--region r | --no-region]` and `--unschedule` run the scheduling functions.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `SUPABASE_CLI`, `args`, `argValue(name)` | constant | module | The pinned CLI, the arguments, and the value after a flag. |
| `databaseUrl`, `ref`, `publicHost`, `functionUrl` | constant | module | The connection string, the project ref, the public URL's host (which must match), and the function's URL. |
| `supabase(cliArgs)`, `deploy()` | function | module | Runs the CLI against the project; deploys `collect-stock` with `--use-api --no-verify-jwt`. |
| `client` | constant | module | The Postgres connection, as `postgres`, for Vault and the scheduling functions. |
| `interval`, `region`, `scheduled`, `removed`, `secret`, `existing` | variable | module | The values each mode uses. |

### `scripts/sync-archive.mjs`: the laptop's copy of the cloud archive, `npm run archive:sync`
Downloads `stock-archive` into `../blood_data/eraktkosh/` in the laptop's own layout, so the history readers need no change. Fetches only what the laptop lacks, writes each file under a temporary name and renames it, waits up to 10 minutes for the network, and logs each run to `sync.log`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BUCKET`, `PAGE_SIZE`, `NETWORK_WAIT_MS`, `RETRY_EVERY_MS` | constant | module | The bucket, 1,000 entries per listing page, 10 minutes of waiting for the network, a try every 30 s. |
| `SWEEP_SETTLED_MS` | constant | module | 15 minutes: a sweep whose newest batch is older than this is complete and is merged. |
| `archiveDir`, `logFile`, `writeLog(text)` | constant | module | The archive folder (`--dir`), `sync.log`, and a function that prints a line and appends it there. |
| `bucket` | constant | module | The Storage bucket, with `SUPABASE_SECRET_KEY`. |
| `listAll(prefix)`, `files(entries)`, `folders(entries)` | function | module | Every entry under a folder, page by page; its files; its sub-folders. |
| `download(objectPath)`, `writeAtomic(target, text)`, `lineCount(text)` | function | module | An object's text, unzipped; a write through a `.part` file and a rename; non-empty lines. |
| `listRootWhenOnline()` | function | module | The bucket's top level, retried until the network is up or 10 minutes pass. |
| `counts`, `newestDay` | variable | module | What this run fetched, and the newest UTC day held. |
| `remoteHistory` | variable | module | `[object path, local file]` for every history file: `history/D/NAME.ndjson.gz` maps to `history/D_NAME.ndjson`, and `history/D.ndjson.gz` to `history/D.ndjson`. |
| `mergedSources`, `newSummaries`, `sweepsById`, `settledLines` | variable | module | Batch summaries already in `sweeps.ndjson` (from each line's `sources`), the new ones, the new ones by sweep, and one line per settled sweep with its batches' states joined. |

### `scripts/upload-archive.mjs`: the laptop's archive into the bucket, `npm run archive:upload`
Uploads each local `history/D.ndjson`, `sweeps.ndjson` and the weekly directory files, replacing what is there, and records each day's lines as an `upload` run so the prune counts them. `--check` compares, per UTC day, database rows with archived and local lines. `--from-db D` archives a day straight from `stock_history`, as `history/D/db.ndjson.gz`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BUCKET`, `DAY_FILE`, `DIRECTORY_FILE` | constant | module | The bucket, and the names of a laptop day file and a directory file. |
| `args`, `argValue(name)`, `archiveDir`, `isCheckOnly`, `dbDay` | constant | module | The arguments and the mode. |
| `lineCount(text)` | function | module | Non-empty lines. |
| `localDays` | constant | module | Local day files by UTC date. |
| `client`, `bucket` | constant | module | The Postgres connection as `bloodlink_ingest`, and the Storage bucket (absent with `--check`). |
| `upload(objectPath, text)` | function | module | Uploads, gzipped when the path ends in `.gz`, replacing any existing file. |
| `recordUpload(objectPath, day, lines)` | function | module | Inserts or replaces the file's `upload` row in `collector_runs`. |
| `rows`, `shortDays`, `text`, `objectPath` | variable | module | The values each mode uses. |

### `scripts/measure-search.mjs`: response times, `npm run measure`
Point it at a server started with `TRUSTED_PROXY_HOPS=1`, so each simulated user's `X-Forwarded-For` gets its own rate limit.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `args`, `argValue(name, fallback)` | variable | module | The command-line arguments, and the value after a flag. |
| `baseUrl`, `runs`, `concurrency`, `outFile` | constant | module | The server, requests per scenario, how many at once, and an optional JSON output. |
| `SCENARIOS` | constant | module | Region Goa and Uttar Pradesh; location Mumbai; ranked Mumbai and rural Barmer. |
| `percentile(sorted, fraction)` | function | module | A percentile of sorted times. |
| `userNumber` | variable | module | Gives each simulated user its own `X-Forwarded-For`. |
| `timedRequest(path)` | function | module | One timed request: `{ ms, status, source }`. |
| `results`, `first`, `samples`, `times`, `result` | variable | module | Per-scenario measurements. |

### `scripts/benchmark-geo.mjs`: spatial search benchmark
Compares radius searches in memory and in PostGIS at growing dataset sizes, checking every method against the linear scan.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `args`, `argValue(name, fallback)` | variable | module | The command-line arguments, and the value after a flag. |
| `directoryFile`, `sizes`, `queryCount`, `usePostgis`, `skipMemory`, `outFile` | constant | module | The input directory, the dataset sizes, queries per test, whether to time PostGIS, whether to skip memory tests, and the output file. |
| `RADII_M` | constant | module | 15 km and 150 km. |
| `EARTH_RADIUS_M` | constant | module | 6,371 km in meters, as in `src/lib/geo.js`. |
| `RINGS_M` | constant | module | The app's urban and rural rings. |
| `makeRandom(seed)` | function | module | A small seeded random generator, so synthetic data repeats exactly. |
| `realBanks` | constant | module | The directory's banks inside India. |
| `makeDataset(size)` | function | module | The real banks, then jittered copies up to `size`. |
| `makeQueries()` | function | module | Query points near real banks. |
| `linearSearch(points, query, radiusM, counter)` | function | module | Haversine against every bank. |
| `ringSearch(points, query, radiusM, counter)` | function | module | The app's density check and rings over a linear scan. |
| `buildGrid(points, cellDegrees)`, `gridSearch(grid, query, radiusM, counter)` | function | module | 0.25° buckets, and a search over the buckets a radius touches. |
| `toUnitVector({ latitude, longitude })` | function | module | A point as a 3-D unit vector. |
| `buildKdTree(points)`, `kdSearch(tree, query, radiusM, counter)` | function | module | A k-d tree on unit vectors, searched with a chord-distance bound. |
| `buildRTree(points, nodeSize)`, `rtreeSearch(root, query, radiusM, counter)` | function | module | A packed (Sort-Tile-Recursive) R-tree, searched with a bounding box. |
| `METERS_PER_DEGREE`, `searchSpans(query, radiusM)` | function | module | Degrees a radius can reach, using the circle's edge nearest the pole. |
| `percentile`, `round`, `byDistanceThenId`, `sameIds` | function | module | Statistics and the result comparison, which tolerates ties on shared points. |
| `queries`, `results` | constant | module | The query points and every measurement. |
| `explainTime(table, query, radius)` | function | PostGIS block | Server execution time of one `ST_DWithin` query from `EXPLAIN ANALYZE`. |

### `scripts/ranking-sensitivity.mjs`: weight sensitivity

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `args` | constant | main block | The command-line arguments: `--capture <url> <dir>`, or a folder to analyse. The block runs only when the script is called directly, not when the ETA bench imports `PLACES`. |
| `PLACES`, `GROUPS`, `FACTORS` | constant | module | 13 places (exported), 4 blood groups, and the ±20% factors. |
| `capture(baseUrl, outDir)` | function | module | Saves one ranked search per place and group, with the place's `origin`, from a running server, which needs `TRUSTED_PROXY_HOPS=1`. |
| `perturbed(weights, name, factor)` | function | module | One weight scaled, with all of them rescaled to add up to 1. |
| `kendallTau(orderA, orderB)` | function | module | Kendall's τ between two orders of the same banks: 1 for the same order, 0 for unrelated. The ETA bench has its own copy in `etaMetrics.js`. |
| `analyse(dir)` | function | module | Re-ranks every saved set with each change (Kendall's τ) and writes `sensitivity_report.json`. |
| `sets`, `summary`, `urgencyFlips`, `report` | variable | `analyse` | The candidate sets, results per urgency, how often critical and routine disagree, and the output. |

### `scripts/build-traffic-profiles.mjs`: rebuilds the traffic profiles
Downloads the 10 TomTom Traffic Index city pages for India, 2 s apart, and writes `assets/traffic_profiles.json`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `CITY_KEYS` | constant | module | TomTom's ids for the 10 Indian cities it measures. |
| `PAGE_URL(key)` | function | module | A city page's address. |
| `OUTPUT_PATH` | constant | module | `assets/traffic_profiles.json`. |
| `DAYS` | constant | module | Weekday names in `getUTCDay()` order, Sunday first. |
| `REQUEST_GAP_MS` | constant | module | 2 s between page downloads. |
| `sleep`, `round1`, `round3`, `mean` | function | module | Small helpers. |
| `unescapeHtml(text)` | function | module | Undoes the HTML escaping of the page's embedded data. |
| `decodeProps(value)` | function | module | Unwraps Astro's `[0, value]` / `[1, [...]]` serialisation. |
| `findCityProps(html)` | function | module | The traffic data of the page's city map component. |
| `toCityProfile(props)` | function | module | One city's box, speeds, 7 × 24 congestion grid, peaks and seasonal factors. |
| `congestionByTime`, `weekHour`, `baseCongestion` | variable | `toCityProfile` | `"MONDAY-9"` → congestion, the grid, and the yearly level. |
| `toIndiaProfile(cities)` | function | module | The average Indian profile: each city's grid divided by its own level, averaged, and scaled to the average level. |
| `withHighways` | variable | `toIndiaProfile` | Cities that report highway figures. |
| `cities`, `profiles` | variable | module | The built city profiles, and the file contents. |

### `scripts/build-state-boundaries.mjs`: rebuilds the state outlines
Downloads geoBoundaries' India state outlines (DataMeet, CC BY 2.5 IN), matches them to eRaktKosh state codes by name, simplifies them to about 1 km and writes `assets/state_boundaries.json`.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `SOURCE_URL` | constant | module | The geoBoundaries IND ADM1 file, pinned to one release. |
| `OUTPUT_PATH`, `DISTRICT_DATA_PATH` | constant | module | `assets/state_boundaries.json`, and the lookup file with eRaktKosh's state names. |
| `TOLERANCE_DEGREES` | constant | module | 0.01°, about 1.1 km: the simplification tolerance. |
| `round3(value)` | function | module | Rounds to 3 decimals, about 100 m. |
| `normalizeName(name)` | function | module | A state name without accents, case or punctuation, for matching. |
| `distanceToLine(p, a, b)` | function | module | Distance from a point to a segment, in degrees. |
| `simplifyRing(ring)` | function | module | Douglas-Peucker without recursion. A ring too small to survive becomes its bounding box. |
| `keep`, `stack`, `farthestIndex`, `farthestDistance`, `simplified` | variable | `simplifyRing` | Points kept, segments left to check, the farthest point and its distance, and the result. |
| `lons`, `lats`, `west`, `east`, `south`, `north` | variable | `simplifyRing` | A collapsed ring's coordinates, and the bounding box that replaces it. |
| `districtData`, `stateCodesByName` | constant | module | The lookup file, and state codes by normalised name. |
| `geojson`, `states`, `pointCount`, `missing`, `boundaries` | variable | module | The download, outlines by state code, points kept, states without an outline, and the file contents. |
| `feature`, `name`, `stateCode`, `polygons`, `points` | variable | loop | One state's outline, its name and eRaktKosh code, its polygons, and all their points. |

### Config files

| Name | Kind | File | What it is / does |
|---|---|---|---|
| `nextConfig` | constant | `next.config.mjs` | Allows Google profile pictures, sends `securityHeaders` on every response, and redirects the old `/search/v1`–`v3` URLs to `/search`. |
| `isDevelopment`, `supabaseOrigin` | constant | `next.config.mjs` | Whether this is `next dev` (React needs `eval` there), and the Supabase project's origin for `connect-src`. |
| `contentSecurityPolicy` | constant | `next.config.mjs` | The full policy: only the app itself, Supabase and CARTO tiles, inline scripts and styles (Next.js uses no nonces here), no plugins, no framing. Sent report-only. |
| `securityHeaders` | constant | `next.config.mjs` | `frame-ancestors 'none'` and `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (location for bloodLink only, no camera or microphone), `X-Content-Type-Options: nosniff`, and the report-only policy. |
| (rules) | config | `.gitattributes` | `* text=auto eol=lf`: text files are stored and checked out with LF line endings on every system. |
| (template) | config | `.env.example` | Every environment variable with a placeholder. Committed, through `!.env.example` in `.gitignore`. |
| (default export) | config | `vitest.config.mjs` | Test settings, plus the `@` alias for `src/`. |
| `eslintConfig` | constant | `eslint.config.mjs` | Next.js lint rules, with eslint-config-next's default ignores. |
| `config` | constant | `postcss.config.mjs` | Loads Tailwind. |
| (settings) | config | `.prettierrc.json` | `printWidth: 100`; everything else uses Prettier's defaults. |
| (paths) | config | `.prettierignore` | Folders and files Prettier skips. |
| (data) | asset | `assets/traffic_profiles.json` | TomTom congestion profiles for 10 Indian metros plus an India average, built by `scripts/build-traffic-profiles.mjs`. Read by `src/lib/traffic.js` and by the ETA bench, `../rough_work/eta_benchmarks/eta-methods.mjs`. |
| (data) | asset | `assets/state_boundaries.json` | Simplified outlines of the 36 states and union territories, keyed by eRaktKosh state code, with bounding boxes and the CC BY 2.5 IN credit. Built by `scripts/build-state-boundaries.mjs`; read by `/api/blood-search` and by the collector's directory run (`src/lib/collector.js`, on the laptop and in the Edge Function) through `src/lib/stateBounds.js`. |

---

## Edge Functions, `supabase/functions/`

TypeScript for Supabase's Deno runtime. They import `src/lib/` and `assets/` directly, which the CLI's `--use-api` deploy bundles. Prettier skips `/supabase/`; type-check them with `npx deno@2.5.6 check --no-lock --node-modules-dir=none supabase/functions/collect-stock/index.ts`.

### `supabase/functions/collect-stock/index.ts`: the cloud collector
Called by the cron jobs with `x-collector-secret`. Deployed with JWT verification off, so the secret is the only way in.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BUCKET` | constant | module | `stock-archive`. |
| `STOP_STARTING_MS`, `CALL_DEADLINE_MS` | constant | module | 110 s and 135 s of the free plan's 150: no state starts after the first, and no eRaktKosh call waits past the second. |
| `respond(status, body)` | function | module | A JSON response. |
| `gzip(text)` | function | module | Gzipped bytes, with `CompressionStream`. |
| `archiveBucket()` | function | module | The Storage bucket, with the `default` key from `SUPABASE_SECRET_KEYS`. Used for nothing but uploads. |
| `upload(path, body, contentType, upsert)` | function | module | One upload; throws on failure. |
| `stampName(time, batch)` | function | module | `2026-11-10/0535-b1`: the UTC day, start time and batch, which name the batch's files. |
| (handler) | handler | module | Checks the method and the secret, parses the body, connects with `SUPABASE_DB_URL` and runs `set role bloodlink_ingest`, then runs the batch, the directory (whose answer includes `autoRefresh`) or the prune, each recorded in `collector_runs` and refused (409) if it ran within 50 minutes. A batch uploads its changed rows to `history/<name>.ndjson.gz` and its summary to `sweeps/<name>.json`; the directory uploads `directory/<day>.json.gz`. |
| `receivedAt`, `job`, `historyLines`, `directoryAnswer`, `client`, `finishOnError` | variable | handler | When the call came in (the time budget starts there), the parsed request, what the archive hooks buffered, the Postgres connection, and the hook that records a fatal error against the job in progress. |
| `collector`, `results`, `status`, `refuse(name)` | variable | handler | The shared collector with runner `edge`, the answer, its HTTP status, and a helper for a refused job. |
| `run`, `outcome`, `name`, `archived`, `errors`, `summary` | variable | handler | One job's row and outcome, the file name, the archive fields for `finishRun`, upload errors, and the batch summary. |

---

## Database

Schema is in `supabase/migrations/20261023000100_init.sql`, `20261023000200_stock_store.sql`, `20261023000300_blood_bank_locations.sql`, `20261024000100_wrong_state_locations.sql`, `20261026000100_ingest_prune_grant.sql`, `20261026000200_review_and_india_dates.sql`, `20261026000300_privacy_consent_and_account_deletion.sql`, `20261103000100_cloud_collector.sql` and `20261104000100_stockout_forecast.sql`. All but the last are applied to the live project (Mumbai, since 2026-11-03), so changes go in a new migration file, never into an applied one. The last is not applied yet; until it is, it may still be edited. SQL uses `snake_case`. Function parameters start with `p_` and local variables with `v_`.

### Tables and columns

| Table | Column | What it holds |
|---|---|---|
| `profiles` | `id` | The user's id, the same as `auth.users.id`. |
| | `email`, `full_name`, `dob`, `gender`, `phone` | Personal details. |
| | `state_code`, `district_code` | eRaktKosh state and district codes. |
| | `emergency_name`, `emergency_phone` | Emergency contact. |
| | `blood_group_code` | eRaktKosh blood-group code. |
| | `is_donor` | Willing to donate. |
| | `is_profile_complete` | Set by a trigger when the required fields are filled. Clients can't write it. |
| | `role` | `user`, `hospital`, `blood_bank` or `admin`. Changed only by database functions. |
| | `organization_id` | The approved organization behind a hospital or blood-bank role. |
| | `privacy_version` | The date of the privacy note the person agreed to, as `YYYY-MM-DD`. The owner may write it; `/api/details` writes `PRIVACY_VERSION`. |
| | `privacy_accepted_at` | When they agreed. Set by the trigger from the database clock; clients can't write it. |
| | `created_at`, `updated_at` | Timestamps. |
| `donor_screening` | `user_id` | The donor; one row per person. |
| | `last_donation_date`, `donation_camp` | Last donation, and where it happened. |
| | `recent_tattoo`, `pregnant`, `underweight`, `on_medication`, `medication_details`, `has_disease` | Health answers. Only their owner can read them. As the form asks them: a tattoo, piercing, acupuncture or other invasive cosmetic procedure in 12 months, by the donor or their partner; pregnancy, breastfeeding, a birth in 12 months, or an abortion or miscarriage in 6; under 45 kg; current medication and which; and HIV, hepatitis, malaria or syphilis. |
| | `updated_at` | Timestamp. |
| `organizations` | `id`, `kind` | Application id; `hospital` or `blood_bank`. |
| | `name`, `registration_number`, `eraktkosh_code` | Who the organization is. |
| | `state_code`, `district_code`, `address`, `phone` | Where it is. |
| | `status` | `pending`, `approved`, `rejected` or `suspended`. |
| | `applicant_id` | Who applied. |
| | `review_note`, `reviewed_by`, `reviewed_at` | The last admin review. |
| | `created_at`, `updated_at` | Timestamps. |
| `audit_log` | `id`, `actor_id` | Entry number, and the admin who acted. `actor_id` is null for scripts, and for an admin who has since deleted their account. |
| | `action` | Such as `organization.approved` or `user.role_changed`. |
| | `target_type`, `target_id` | What was acted on. |
| | `details` | Extra facts, such as the previous status or a note. |
| | `created_at` | When it happened. |
| `blood_banks` | `hospital_code` | eRaktKosh's bank id. |
| | `name`, `address`, `phone`, `email` | Contact details from `nearest`. |
| | `state_code`, `district_id` | eRaktKosh state and district codes. |
| | `latitude`, `longitude`, `location_quality` | Position, flagged `ok`, `shared` (same point as another bank), `wrong_state` (outside its own state), `outside_india` or `missing`. |
| | `location` | A PostGIS `geography(Point, 4326)` generated from latitude and longitude. Null for missing, wrong-state or outside-India positions. |
| | `bank_type`, `hospital_type`, `stock_source`, `camp_source` | eRaktKosh's own fields. |
| | `auto_refresh` | Whether eRaktKosh refreshes the bank's stock automatically, from the weekly directory run; null until the first one. A forecast input. |
| | `first_seen_at`, `last_seen_at` | When the directory first and last listed the bank. |
| `bank_stock_latest` | `hospital_code`, `state_code`, `district_id` | The bank, its state, and its district from `blood_banks`. |
| | `row` | The validated eRaktKosh row, the same shape as a live one. |
| | `entry_at`, `fetched_at` | When the bank updated its stock, and when bloodLink fetched it. |
| `stock_history` | `hospital_code`, `entry_at` | The key: one row per bank per stock update. |
| | `fetched_at`, `state_code` | When it was fetched, and the state. |
| | `stock` | Compact stock: component short name → group → units. |
| `upstream_calls` | `id`, `called_at`, `caller` | Call number, time, and `collector` (or later `app`). |
| | `endpoint`, `state_code` | Which eRaktKosh call. |
| | `ok`, `http_status`, `duration_ms`, `bytes`, `rows`, `failure_kind` | How it went. |
| | `quality` | The validation counts for that response. |
| `collector_sweeps` | `id`, `started_at` | One cloud sweep, started by `collector_tick(1)`. |
| | `sweep_interval` | The interval it was started under; at least 1 hour. |
| | `posted_batches` | The batches `collector_tick` has sent for it. |
| `collector_runs` | `id`, `job`, `batch`, `sweep_id`, `runner` | One collector job: `stock` (a cloud batch 1–4, or the laptop's states), `directory`, `prune` or `upload` (laptop history put into the archive); `edge` or `laptop`. |
| | `started_at`, `finished_at` | When it started, and when it finished; null while running or after a crash. |
| | `states_saved`, `states_failed`, `states_skipped`, `rows_changed` | How the states went, and history rows written. |
| | `archive_path`, `archive_day`, `rows_archived` | The `stock-archive` file it wrote, the UTC day its lines belong to, and how many. Only Storage files count; laptop runs leave them empty. |
| | `result`, `error` | The directory's flags or the prune's report, and any error. |
| `feature_flags` | `name` | `forecast_badge`, `forecast_ranking`, `forecast_appeals` or `admin_events`. |
| | `is_enabled`, `disabled_reason` | On or off (all start off), and why the kill switch turned it off. |
| | `updated_by`, `updated_at` | The admin who last changed it (null for the kill switch), and when. |
| `model_versions` | `id`, `kind` | Such as `stockout-logit-2027-01-04`; `logistic` or `gbm`. |
| | `artifact_path`, `artifact_sha256` | The artifact in the `ml-models` bucket, and its SHA-256. |
| | `trained_from`, `trained_to`, `evaluation` | The training dates, and the promotion rule's metrics. |
| | `status`, `created_at` | `shadow`, `live` (at most one) or `retired`. |
| `stock_forecasts` | `hospital_code`, `component_id`, `blood_group_code`, `as_of`, `model_version` | The key: one bank, component and group (eRaktKosh codes) at one grid time, by one model. |
| | `p_raw`, `p` | P(stock-out) at 24, 48 and 72 h, raw and calibrated, each in 0 to 1. |
| | `reasons` | The top three inputs pushing the 48-hour risk up, in words. |
| `forecast_outcomes` | `hospital_code`, `component_id`, `blood_group_code`, `as_of` | The case. |
| | `stockout` | What happened at 24, 48 and 72 h; null where the label rules leave it out. |
| | `had_appeal`, `labelled_at` | Whether an approved appeal covered the window (reported apart), and when it was labelled. |
| `forecast_runs` | `id`, `job`, `as_of`, `model_version` | One `score` run at a grid time, or one `daily` run of outcomes and calibration. |
| | `started_at`, `finished_at`, `rows_scored`, `result`, `error` | How it went; the daily run's cut-offs and kill-switch decision. |
| `forecast_daily_metrics` | `day`, `horizon_h`, `model_version` | The key. |
| | `cases`, `positives`, `pr_auc`, `calibration_ratio`, `platt_a`, `platt_b`, `cut_off`, `recall_at_cut_off`, `false_alerts_per_bank_week`, `lift_by_group` | That day's calibration, cut-off and metrics. |

### Functions and triggers

| Name | Kind | What it does |
|---|---|---|
| `set_updated_at()` | trigger function | Stamps `updated_at` on `organizations`. |
| `profiles_before_write()` | trigger function | Rejects a date of birth after today's date in India, and sets `is_profile_complete` and `updated_at`. When `privacy_version` changes, it stamps `privacy_accepted_at` with the current time, or clears it. |
| `donor_screening_before_write()` | trigger function | Rejects a donation date after today's date in India, and sets `updated_at`. |
| `handle_new_user()` | trigger function | Creates a `profiles` row for every new sign-up. |
| `handle_user_email_change()` | trigger function | Copies an email change into `profiles`. |
| `is_admin()` | function | Whether the caller is an admin. Used by the security policies. |
| `review_organization(p_organization_id, p_decision, p_note)` | function | Admin only. Approves, rejects or suspends an application, links or unlinks the applicant's `organization_id` and sets or removes their role (an admin keeps the admin role), and writes the audit log. |
| `v_org` | variable | Inside `review_organization`: the application being reviewed. |
| `set_user_role(p_user_id, p_role)` | function | Admin only. Grants or removes admin, refuses to remove the last admin, and writes the audit log. |
| `v_old_role` | variable | Inside `set_user_role`: the user's role before the change. |
| `delete_my_account()` | function | Signed-in users only. Deletes the caller's own auth user, which cascades to their profile, screening answers and organization applications; audit entries keep their rows with no actor. Refuses the only admin (22023), and raises P0002 when there is no such user. |
| `v_role` | variable | Inside `delete_my_account`: the caller's role. |
| `prune_stock_store(p_history_days, p_call_days)` | function | `bloodlink_ingest` only, with that role's rights. Deletes history older than 60 days, but only for UTC days whose rows the Storage archive holds in full (the `rows_archived` recorded for the day cover every row of it), and call logs older than 90. Returns `history_deleted`, `calls_deleted` and `history_days_kept`, each short day with its rows and archived lines. Reading `upstream_calls.called_at` in its `WHERE` needs the column grant added on 26 October. |
| `v_cutoff`, `v_last_day`, `v_kept`, `v_kept_days`, `v_history`, `v_calls` | variable | Inside `prune_stock_store`: the cutoff, its UTC day, the short days as JSON and as dates, and rows deleted from each table. |
| `collector_due(p_batch, p_interval)` | function | `postgres` only (security definer). Whether a batch is due, recording it if so; returns the sweep's id or null. Batch 1 starts a sweep once the last began `p_interval` less 5 minutes ago; batches 2 to 4 follow only a sweep that began in the last 10 minutes, once each. Refuses a batch outside 1–4 or an interval under 1 hour (22023). |
| `v_sweep` | variable | Inside `collector_due`: the latest sweep. |
| `collector_post(p_body, p_region)` | function | `postgres` only. Posts to the function with `pg_net`, with the URL and secret from Vault, `x-region` when given, and a 150 s timeout. Raises P0002 when Vault lacks them. |
| `v_url`, `v_secret`, `v_headers` | variable | Inside `collector_post`. |
| `collector_tick(p_batch, p_interval, p_region)` | function | `postgres` only. What each cron tick runs: `collector_due`, then `collector_post` only when due. Returns the request id or null. |
| `collector_weekly(p_region)` | function | `postgres` only. Trims `cron.job_run_details` to 7 days, then posts `{ directory: true, prune: true }`. |
| `schedule_stock_collector(p_interval, p_region)` | function | `postgres` only. Creates or replaces the five cron jobs (UTC): `collector-batch-1` to `-4` at `5,35`, `7,37`, `9,39` and `11,41` past each hour, and `collector-weekly` at `50 21 * * 0` (Monday 03:20 India time). Defaults: 4.5 hours, `ap-south-1`. Refuses under 1 hour, and without the Vault secrets. |
| `v_minutes`, `v_jobs`, `v_batch` | variable | Inside `schedule_stock_collector`. |
| `unschedule_stock_collector()` | function | `postgres` only. Removes the five jobs; returns how many there were. |
| `upstream_stats` | view | eRaktKosh calls in the last 24 hours per endpoint and state: calls, success %, median and 95th-percentile ms, last good call. Runs with the caller's rights, so only admins see rows. |
| `bloodlink_ingest` | role | No login. The collector switches to it with `set role`; it may write only the stock tables. On `upstream_calls` it may insert and delete, and read only `called_at`. On `collector_runs` it may read, insert and update; `collector_sweeps` and the scheduling functions are closed to it. |
| `pg_cron`, `pg_net` | extension | Added by the cloud collector migration, in `pg_catalog` and `extensions`. |
| `is_forecast_grid_time(p_time)` | function | Immutable: whether a time is 00:00, 06:00, 12:00 or 18:00 India time. Used by the forecast tables' checks. |
| `set_feature_flag(p_name, p_enabled)` | function | Admins only (security definer). Turns a flag on or off, clearing the kill switch's reason when on, and writes `feature_flag.changed` to the audit log. Raises 42501, 22023 or P0002. |
| `v_was` | variable | Inside `set_feature_flag`: the flag before the change. |
| `stop_forecast_flags(p_reason)` | function | `bloodlink_ml` only (security definer). The kill switch: turns `forecast_badge`, `forecast_ranking` and `forecast_appeals` off with the reason, never `admin_events`, writes `feature_flag.kill_switch` with no actor, and returns how many it stopped. |
| `v_names` | variable | Inside `stop_forecast_flags`: the flags it turned off. |
| `prune_forecasts(p_days)` | function | `bloodlink_ml` only, with its rights. Deletes forecasts and outcomes older than 60 days; returns `forecasts_deleted` and `outcomes_deleted`. |
| `v_forecasts`, `v_outcomes` | variable | Inside `prune_forecasts`. |
| `bloodlink_ml` | role | No login. The forecast's scoring job (phase 2). Reads the stock store and `collector_runs`; writes only `stock_forecasts`, `forecast_outcomes`, `forecast_runs` and `forecast_daily_metrics`; reads `feature_flags` and `model_versions`; runs `stop_forecast_flags` and `prune_forecasts`. |
| `ml-models` | Storage bucket | Private, with no policies: `<model id>.json`, the exported artifacts. |
| `stock-archive` | Storage bucket | Private, with no policies, so only a secret key reaches it. `history/D/HHMM-bN.ndjson.gz` (a cloud batch's changes), `history/D.ndjson.gz` (a laptop day), `sweeps/D/HHMM-bN.json`, `sweeps.ndjson.gz`, `directory/D.json.gz`; D is a UTC date. |
| `profiles_before_write`, `donor_screening_before_write`, `organizations_set_updated_at` | trigger | Run those functions before each write. |
| `on_auth_user_created`, `on_auth_user_email_changed` | trigger | Run `handle_new_user` and `handle_user_email_change` on `auth.users`. |

### Indexes, constraints and security policies

| Name | What it does |
|---|---|
| `organizations_one_open_per_applicant` | Unique index: each person can have only one pending or approved application. |
| `organizations_status_idx`, `audit_log_created_at_idx` | Indexes for the admin lists. |
| `profiles_organization_id_fkey` | Links a profile to its organization. |
| `profiles_select_own`, `profiles_update_own` | Users can read and edit their own profile. |
| `profiles_select_admin` | Admins can read every profile. |
| `donor_screening_owner` | Only the owner can read or change their health answers. |
| `organizations_select_own_or_admin` | Applicants see their own applications; admins see all of them. |
| `organizations_insert_own`, `organizations_update_own_pending` | Applicants can submit, and can edit only while the application is pending. |
| `audit_log_select_admin` | Only admins can read the audit log. |
| `blood_banks_read`, `bank_stock_latest_read`, `stock_history_read` | Anyone may read the public stock data. |
| `upstream_calls_select_admin` | Only admins can read the call log. |
| `blood_banks_ingest`, `bank_stock_latest_ingest`, `stock_history_ingest`, `upstream_calls_ingest` | Only `bloodlink_ingest` may write. |
| `bank_stock_latest_state_district`, `stock_history_fetched_at`, `upstream_calls_called_at` | Indexes for the saved-copy reads, pruning and the stats view. |
| `blood_banks_location_gist` | GiST index on `blood_banks.location`, for radius searches with `ST_DWithin`. PostGIS lives in the `extensions` schema. Rebuilt with the column by the `wrong_state` migration. |
| `blood_banks_location_quality_check` | `location_quality` must be `ok`, `shared`, `wrong_state`, `outside_india` or `missing`. |
| `collector_sweeps_select_admin`, `collector_runs_select_admin` | Only admins can read the collector's tables. |
| `collector_runs_ingest` | `bloodlink_ingest` may write `collector_runs`. |
| `collector_sweeps_started_at`, `collector_runs_started_at`, `collector_runs_archive_day` | Indexes for the tick, the admin overview and the prune. |
| `collector_runs_upload_path` | Unique partial index on `archive_path` for `upload` runs: re-uploading a file replaces its row, so the prune never counts it twice. |
| `upstream_calls_endpoint_check` | Now also allows `master/portal-refresh-hospitals`. |
| `model_versions_one_live` | Unique partial index: at most one live model. |
| `stock_forecasts_as_of`, `forecast_outcomes_as_of`, `forecast_runs_started_at` | Indexes for the latest scores, the daily job and the admin overview. |
| `*_select_admin` on `feature_flags`, `model_versions`, `stock_forecasts`, `forecast_outcomes`, `forecast_runs`, `forecast_daily_metrics` | Only admins can read them. |
| `*_ml` and `*_ml_read` | `bloodlink_ml` may write the four forecast tables and read the flags, the models, `blood_banks`, `bank_stock_latest`, `stock_history` and `collector_runs`. |
