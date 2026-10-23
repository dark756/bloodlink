# bloodLink code reference

This lists every function, component, constant and variable in the app, file by file, with one line on what each one is or does.

- Paths are relative to `bloodlink/`.
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
11. [Database, `supabase/migrations/`](#database)

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
  - `.prettierignore` skips the top-level `archive/`, `assets/`, `public/` and `supabase/` folders, plus Markdown files. The entries start with `/` so that `src/lib/supabase/` is still formatted.

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
| `parseCoordinates(searchParams, latName, lngName)` | function | module | Validates latitude and longitude and rounds them to 4 decimals, about 11 m. |
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

### `src/lib/stockStore.js`
Server-only reads of the copy `scripts/snapshot.mjs` saves, with the publishable key and no session.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_KEY` | constant | module | The public project URL and publishable key. |
| `PAGE_SIZE` | constant | module | 1,000; the Data API's row limit per request. |
| `DIRECTORY_TTL_MS` | constant | module | 1 h; how long the directory stays in memory. |
| `publicClient` | variable | module | The Supabase client, created on first use. |
| `getPublicClient()` | function | module | That client, or `null` without the environment variables. |
| `selectAllRows(buildQuery)` | function | module | Every row of a query, a page at a time. |
| `rows` | variable | `selectAllRows`, `loadSavedAvailability` | The rows read so far. |
| `loadSavedAvailability({ stateCode, districtId, componentId })` | function | module | Saved rows for a state or district, with the oldest fetch time. With a `componentId`, cut down to that component by `keepOnlyComponent`. |
| `savedRows`, `componentName` | variable | `loadSavedAvailability` | The eRaktKosh rows, and the requested component's name. |
| `supabase` | variable | `loadSavedAvailability`, `loadSavedNearest` | The public client. |
| `directoryCache` | variable | module | `{ banks, loadedAt }`. Kept on `globalThis`. |
| `loadDirectory(supabase)` | function | module | The saved directory, without banks placed outside India or outside their own state, or missing coordinates. |
| `banks` | variable | `loadDirectory`, `loadSavedNearest` | The directory rows. |
| `loadSavedNearest({ latitude, longitude, radius })` | function | module | Saved banks within a radius, in eRaktKosh's `nearest` shape, with straight-line distances. |
| `origin`, `data` | variable | `loadSavedNearest` | The search point, and the banks found. |

### `src/lib/geo.js`
Pure distance helpers.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `EARTH_RADIUS_M` | constant | module | 6,371 km in meters. |
| `toRadians(degrees)` | function | module | Degrees to radians. |
| `haversineMeters(from, to)` | function | module | Straight-line distance between two `{ latitude, longitude }` points. |
| `dLat`, `dLon`, `a` | variable | `haversineMeters` | The differences in radians, and the haversine term. |
| `INDIA_BOUNDS` | constant | module | Latitude 6 to 37.5 and longitude 68 to 97.5. |
| `isInIndia({ latitude, longitude })` | function | module | Whether a point lies inside those bounds. |

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
Which blood groups a patient can receive, for each type of component. Informational only. Since report 3 the search uses exact groups only, so nothing in the app imports this module; it is kept, with its tests, for donor matching.

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

### `src/lib/traffic.js`
Pure travel-time model: ETA = free-flow time × (1 + congestion / 100) × rain factor. Safe in the browser and on the server.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `trafficProfiles` | import | module | `assets/traffic_profiles.json`: TomTom weekday-hour congestion for 10 Indian metros plus an India average. |
| `DETOUR_FACTOR` | constant | module | 1.34; road distance ÷ straight-line distance, the median of 94 Mumbai bank trips. Used when there is no route. |
| `METRO_MARGIN_KM` | constant | module | 10 km; how far outside a TomTom metro's box its own profile still applies. |
| `ZONE_MIN_BANKS` | constant | module | Banks within 15 km that make a city (11) or a town (3). |
| `ZONE_SCALE` | constant | module | Share of the Indian average congestion: metro 1, city 0.89, town 0.73, rural 0.29. |
| `RAIN` | constant | module | Moderate rain from 2.5 mm/h adds 15%; heavy rain from 7.6 mm/h adds 30%. |
| `IST_OFFSET_MS` | constant | module | India's +5:30 offset, in milliseconds. |
| `KM_PER_DEGREE` | constant | module | 111.32 km per degree of latitude. |
| `DAY_NAMES` | constant | module | `"Sun"` to `"Sat"`. |
| `roundToTenth(value)` | function | module | Rounds to one decimal place. |
| `indiaClock(now)` | function | module | `{ day, hour, minute, month }` on India's clock; day 0 is Sunday. |
| `shifted` | variable | `indiaClock` | The time moved by +5:30, read with UTC getters. |
| `formatIndiaTime(now)` | function | module | `"Fri 6:05 pm"`. |
| `hour12` | variable | `formatIndiaTime` | The hour on a 12-hour clock. |
| `findMetro(latitude, longitude)` | function | module | The TomTom metro whose box (plus margin) contains the point, nearest centre first, or `null`. |
| `latMargin`, `lonMargin` | variable | `findMetro` | The 10 km margin in degrees. |
| `squaredDistance(city)` | function | `findMetro` | Rough distance to a city centre, for choosing between overlapping boxes. |
| `trafficZone({ latitude, longitude }, banksWithin15Km)` | function | module | The zone for a search: `{ kind, name, freeFlowKmh, scale, weekHour, seasonal }`. |
| `metro`, `india`, `kind` | variable | `trafficZone` | The matched metro, the India average profile, and `"metro"`, `"city"`, `"town"` or `"rural"`. |
| `freeFlowKmh` | variable | `trafficZone` | Free-flow speed per zone kind: city streets, halfway for towns, highway for rural. |
| `congestionPercent(zone, now)` | function | module | % extra travel time now: the weekday-hour value interpolated to the minute, times the month's factor and the zone's scale. |
| `nextDay`, `nextHour`, `thisHourValue`, `nextHourValue`, `hourValue` | variable | `congestionPercent` | The two hourly values around now, and the value between them. |
| `rainFactor(rainMmPerHour)` | function | module | 1, 1.15 or 1.3. |
| `describeCongestion(congestion)` | function | module | `"light"`, `"moderate"`, `"heavy"` or `"rush-hour traffic"`. |
| `trafficConditions(zone, { now, rainMmPerHour })` | function | module | Conditions shared by every bank in one search: zone, city, India time, congestion, label, rain. |
| `congestion` | variable | `trafficConditions` | This search's congestion %. |
| `estimateTravel({ straightLineM, leg }, zone, conditions)` | function | module | `{ etaMinutes, roadDistanceM, etaSource }` for one bank. |
| `hasRoute`, `roadKm`, `routeMinutes`, `freeFlowMinutes`, `minutes` | variable | `estimateTravel` | Whether OSRM routed it, road km, OSRM minutes, the slower free-flow time, and the final minutes. |

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
Donor eligibility, worked out every time it is read. Informational only.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `ELIGIBILITY_RULES` | constant | module | Age 18–65, and a gap of 90 days (men) or 120 days (others) between donations. |
| `MS_PER_DAY` | constant | module | Milliseconds in a day. |
| `toDate(value)` | function | module | A `Date` from a value, or `null`. |
| `date` | variable | `toDate` | The parsed date. |
| `calculateAge(dob, now)` | function | module | Age in whole years on the given day. |
| `birthDate` | variable | `calculateAge` | The date of birth as a `Date`. |
| `age` | variable | `calculateAge`, `evaluateEligibility` | Age in years. |
| `isBeforeBirthday` | variable | `calculateAge` | Whether this year's birthday is still to come. |
| `evaluateEligibility(details, now)` | function | module | Returns `{ status, eligible, reasons, nextEligibleDate }`. `status` is `not-donor`, `eligible`, `review` or `deferred`. |
| `donorDetails` | variable | `evaluateEligibility` | The donor's screening answers. |
| `reasons` | variable | `evaluateEligibility` | Why the person can't donate now, or needs a check. |
| `nextEligibleDate` | variable | `evaluateEligibility` | The first date they can donate again, as `YYYY-MM-DD`. |
| `lastDonation` | variable | `evaluateEligibility` | The last donation date as a `Date`. |
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
| `trimText(value, maxLength)` | function | module | Trims text and cuts it to a maximum length. Anything that isn't a string becomes `""`. |
| `parsePastDate(value, today)` | function | module | A valid past date, `null` if empty, or `false` if invalid or in the future. |
| `sanitizeDetails(input, now)` | function | module | Validates and cleans a [`details`](#data-shapes) object. Returns `{ errors, details }`. |
| `fields` | variable | `sanitizeDetails` | The submitted form, or `{}` if it wasn't an object. |
| `today` | variable | `sanitizeDetails` | Today's date as `YYYY-MM-DD`. |
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
| `safeNextPath(value, fallback)` | function | module | Allows only same-site redirect paths, which blocks open redirects. |

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
| `PROTECTED_PATHS` | constant | module | Pages that need sign-in: `/peer-to-peer`, `/set-details`, `/organization`, `/admin`. |
| `isUnderPath(pathname, basePath)` | function | module | Whether a path is that path or below it. `/admin` matches `/admin/users`. |
| `proxy(request)` | function | module | Refreshes the session, then sends people to `/login`, `/set-details` or `/` as needed. |
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
| `GET()` | handler | module | Returns email, name, avatar, role, `details` (when complete), `draft` and eligibility. |
| `screening` | variable | `GET` | The user's `donor_screening` row. |
| `draft` | variable | `GET` | Whatever is saved so far, used to prefill the form. |
| `details` | variable | `GET`, `POST` | The complete, validated profile. |
| `POST(request)` | handler | module | Validates and saves the profile. Deletes the screening answers when the person isn't a donor. |
| `errors` | variable | `POST` | Validation errors from `sanitizeDetails`. |
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

### `src/app/api/admin/rpcError.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `rpcErrorResponse(error)` | function | module | Turns a database-function error into HTTP 403, 400, 404 or 500. |

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
| `loadHeaderUser()` | function | module | The signed-in user's name, avatar and role for the header, or `null`. |
| `RootLayout({ children })` | component | module | The page frame: header, main content and footer. |

### `src/app/page.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `HomePage()` | component | module | Landing page with links to search and to the donor network. |

### `src/app/components/Header.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `Header({ user })` | component | module | Top navigation bar, with avatar and sign-out. |
| `isSigningOut` | state | `Header` | True while sign-out is running. |
| `initials` | variable | `Header` | Shown when the user has no avatar picture. |
| `handleSignOut()` | function | `Header` | Signs out, then reloads the home page. |

### `src/app/components/BloodMap.js`: the map on `/search`
Only loaded through `next/dynamic` with `ssr: false`, because Leaflet needs the browser.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `CARTO_API_KEY` | constant | module | Key for the CARTO map tiles. Without it, the map shows a watermark. |
| `TILE_URL` | constant | module | The map-tile address. |
| `TILE_ATTRIBUTION` | constant | module | The OpenStreetMap and CARTO credit line. |
| `GEOCODE_DELAY_MS` | constant | module | 800 ms; how long the pin must be still before its place name is looked up. |
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
| `coordsKey`, `controller`, `timer` | variable | `BloodMap` (effect) | The pin's key, a way to cancel the lookup, and the delay timer. |
| `address`, `label` | variable | `BloodMap` (effect) | Nominatim's address parts, and the place name chosen from them. |
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
| `handleLocationSearch()` | function | `SearchPage` | Runs a nearest or ranked search through `/api/blood-search`. |

### `src/app/login/page.js` and `src/app/login/LoginForm.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `metadata` | constant | `page.js` | The page title, "Sign in · Bloodlink". |
| `LoginPage({ searchParams })` | component | `page.js` | Reads `?next=` and `?error=`, then shows the form. |
| `nextPath` | variable | `LoginPage` | Where to go after signing in. |
| `callbackFailed` | variable | `LoginPage` | Whether a sign-in link just failed. |
| `buildCallbackUrl(path)` | function | `LoginForm.js` | The `/auth/callback` address Supabase returns to. |
| `LoginForm({ nextPath, callbackFailed })` | component | `LoginForm.js` | Google button plus email/password sign-in and sign-up. |
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

### `src/app/set-details/page.js`: the 3-step profile form

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `EMPTY_FORM` | constant | module | Blank values for every field. |
| `PERSONAL_STEP`, `BLOOD_STEP`, `SCREENING_STEP` | constant | module | Step numbers 0, 1 and 2. The screening step is for donors only. |
| `formFromDetails(details)` | function | module | Flattens a saved `details` object into the form's fields. |
| `donorDetails` | variable | `formFromDetails` | The saved screening answers. |
| `detailsFromForm(form)` | function | module | Builds the nested `details` object the API expects. |
| `FormField({ label, htmlFor, children })` | component | module | A label above an input. |
| `CheckboxRow({ checked, onChange, children })` | component | module | A checkbox with its question. |
| `StepIndicator({ stepCount, currentStep })` | component | module | The numbered dots and lines at the top of the form. |
| `stepIndexes`, `isDone`, `isLast`, `dotClass` | variable | `StepIndicator` | The step numbers, whether a step is finished or last, and the dot's style. |
| `SetDetailsPage()` | component | module | The profile form. It prefills when editing. |
| `form` | state | `SetDetailsPage` | Every field's current value. |
| `currentStep` | state | `SetDetailsPage` | Which step is showing. |
| `isProfileLoaded` | state | `SetDetailsPage` | False until the saved profile has loaded. |
| `isEditing` | state | `SetDetailsPage` | True when a complete profile already exists. |
| `isSaving` | state | `SetDetailsPage` | True while saving. |
| `error` | state | `SetDetailsPage` | Error message to show. |
| `handleFieldChange(fieldName)` | function | `SetDetailsPage` | Returns the change handler that copies one input into `form`. |
| `value` | variable | `handleFieldChange` | The input's value, or the checkbox's state. |
| `districts` | variable | `SetDetailsPage` | Districts of the chosen state. |
| `eligibility` | variable | `SetDetailsPage` | Live eligibility for the answers so far. |
| `stepCount` | variable | `SetDetailsPage` | 3 for donors, 2 for everyone else. |
| `handleSubmit()` | function | `SetDetailsPage` | Saves through `/api/details`, then opens `/peer-to-peer`. |
| `handlePersonalStepSubmit(event)` | function | `SetDetailsPage` | Checks step 1's required fields, then moves on. |
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
| `AdminOverviewPage()` | component | module | Counts, the review queue, collection health and recent activity. |
| `userCount`, `completeProfileCount`, `donorCount`, `adminCount` | variable | `AdminOverviewPage` | Account totals. |
| `pendingCount`, `approvedCount` | variable | `AdminOverviewPage` | Pending and verified organizations. |
| `pendingApplications` | variable | `AdminOverviewPage` | Up to 20 applications waiting for review. |
| `recentAuditEntries`, `auditEntries` | variable | `AdminOverviewPage` | The 8 latest audit-log entries: the query result, and its rows. |
| `collectionStats` | variable | `AdminOverviewPage` | The `upstream_stats` query result. |

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

### `tests/routing.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `table(durations, distances)` | function | module | An OSRM table answer with the source in front. |
| `fakeHttp(...answers)` | function | module | A stand-in for axios that answers from a list and records each URL. |

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

### `tests/stock-quality.test.js`

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `NOW` | constant | module | Fixed test clock: 23 Oct 2026, 12:00 India time. |
| `row(hospitalCode, entrydate, quantities, extra)` | function | module | A test eRaktKosh row with stray commas. |
| `quantitiesOf(cleanedRow)` | function | module | A row's cleaned red-cell quantities text. |
| `one`, `two` | constant | report test | Two reports to add together. |

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
| `validProfile` | constant | profile tests | A valid form submission, plus a forbidden `role` field. |
| `rows`, `roundTrip` | variable | profile test | Database rows, and the `details` read back from them. |
| `validApplication` | constant | organization tests | A valid blood-bank application. |

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

### `scripts/snapshot.mjs`: the hourly collector, `npm run snapshot`
Saves eRaktKosh stock and the directory into the stock store, as `bloodlink_ingest`. Optionally appends changes to a local archive.

| Name | Kind | Inside | What it is / does |
|---|---|---|---|
| `BASE_URL`, `TIMEOUT_MS`, `STATE_GAP_MS`, `BATCH_SIZE` | constant | module | eRaktKosh address, 60 s timeout, 1 s between states, 400 rows per insert. |
| `DIRECTORY_QUERY` | constant | module | One `nearest` call from central India with a 5,000 km radius. |
| `args`, `argValue(name)` | variable | module | The command-line arguments, and the value after a flag. |
| `isDirectoryRun`, `isAllStates`, `requestedStates`, `archiveDir`, `shouldPrune`, `logFile` | constant | module | What this run does, and the `--log` file, if any. |
| `write(text)` | function | module | With `--log`: appends a line to the log file. `console.log` and `console.error` are pointed at it. |
| `signal` | variable | module | Each of SIGINT, SIGBREAK, SIGHUP and SIGTERM. The handler logs it with the time, carries on after Ctrl+C and Ctrl+Break, and exits after a close or terminate. |
| `databaseUrl` | constant | module | `SUPABASE_DB_URL` from `.env.local`. |
| `districtData`, `stateNames`, `componentShortNames` | constant | module | The lookup file, state names by code, and component short names by full name. |
| `stateChecker` | constant | module | `createStateChecker` over `assets/state_boundaries.json`, read with `fs`. |
| `stateCodes` | constant | module | The states to save. |
| `sleep`, `digitsOrNull`, `toIsoOrNull` | function | module | A pause; a digits-only value or `null`; an eRaktKosh time as ISO UTC. |
| `callEraktkosh(endpoint, params)` | function | module | One GET: `{ ok, data, status, durationMs, bytes, failureKind }`. |
| `insertRows(client, table, columns, rows, conflictClause, casts)` | function | module | Multi-row inserts in batches. |
| `batch`, `values`, `tuples`, `placeholders`, `cast` | variable | `insertRows` | One batch of rows, its query values, the `($1, $2, …)` groups, one row's placeholders, and a column's type cast. |
| `logCall(client, endpoint, stateCode, call, rowCount, quality)` | function | module | Writes one `upstream_calls` row. |
| `compactStock(row)` | function | module | `{ "PRBC": { "O+Ve": 74 } }`: the copy kept in `stock_history`. |
| `appendArchive(fileName, lines)` | function | module | Appends JSON lines to a file in the archive folder. |
| `snapshotDirectory(client)` | function | module | Saves the nationwide directory, flagging `missing`, `outside_india`, `wrong_state` (outside its own state, from `stateChecker.locationProblem`) and `shared` locations. |
| `pointCounts`, `pointKey`, `seenAt`, `banksByCode`, `locationQuality`, `qualityCounts` | variable | `snapshotDirectory` | Banks per coordinate point, its key, the run time, rows by code, one bank's flag, and flag totals. |
| `snapshotStates(client)` | function | module | Saves each state: validates, uploads changed rows in full, updates the fetch time of the rest, and adds history. |
| `districtByCode`, `sweepStartedAt`, `sweep`, `okCount` | variable | `snapshotStates` | District per bank from the directory, when the sweep began, the sweep summary, and states saved. |
| `previousEntry`, `isChanged`, `changedRows`, `unchangedCodes`, `latestRows`, `historyRows` | variable | `snapshotStates` | Saved update times, the change test, and the rows to write. |
| `client`, `isSuccess` | variable | module | The Postgres connection, and the exit status. |

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
| `args` | constant | module | The command-line arguments: `--capture <url> <dir>`, or a folder to analyse. |
| `PLACES`, `GROUPS`, `FACTORS` | constant | module | 13 places, 4 blood groups, and the ±20% factors. |
| `capture(baseUrl, outDir)` | function | module | Saves one ranked search per place and group from a running server, which needs `TRUSTED_PROXY_HOPS=1`. |
| `kendallTau(orderA, orderB)` | function | module | Rank agreement from -1 to 1. |
| `perturbed(weights, name, factor)` | function | module | One weight scaled, with all of them rescaled to add up to 1. |
| `analyse(dir)` | function | module | Re-ranks every saved set with each change and writes `sensitivity_report.json`. |
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
| `nextConfig` | constant | `next.config.mjs` | Allows Google profile pictures, and redirects the old `/search/v1`–`v3` URLs to `/search`. |
| (default export) | config | `vitest.config.mjs` | Test settings, plus the `@` alias for `src/`. |
| `eslintConfig` | constant | `eslint.config.mjs` | Next.js lint rules. `archive/` is ignored. |
| `config` | constant | `postcss.config.mjs` | Loads Tailwind. |
| (settings) | config | `.prettierrc.json` | `printWidth: 100`; everything else uses Prettier's defaults. |
| (paths) | config | `.prettierignore` | Folders and files Prettier skips. |
| (data) | asset | `assets/traffic_profiles.json` | TomTom congestion profiles for 10 Indian metros plus an India average, built by `scripts/build-traffic-profiles.mjs`. Read by `src/lib/traffic.js`. |
| (data) | asset | `assets/state_boundaries.json` | Simplified outlines of the 36 states and union territories, keyed by eRaktKosh state code, with bounding boxes and the CC BY 2.5 IN credit. Built by `scripts/build-state-boundaries.mjs`; read by `/api/blood-search` and `scripts/snapshot.mjs` through `src/lib/stateBounds.js`. |

---

## Database

Schema is in `supabase/migrations/20261023000100_init.sql`, `20261023000200_stock_store.sql`, `20261023000300_blood_bank_locations.sql` and `20261024000100_wrong_state_locations.sql`. All are applied to the live project, so changes go in a new migration file, never into an existing one. SQL uses `snake_case`. Function parameters start with `p_` and local variables with `v_`.

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
| | `created_at`, `updated_at` | Timestamps. |
| `donor_screening` | `user_id` | The donor; one row per person. |
| | `last_donation_date`, `donation_camp` | Last donation, and where it happened. |
| | `recent_tattoo`, `pregnant`, `underweight`, `on_medication`, `medication_details`, `has_disease` | Health answers. Only their owner can read them. |
| | `updated_at` | Timestamp. |
| `organizations` | `id`, `kind` | Application id; `hospital` or `blood_bank`. |
| | `name`, `registration_number`, `eraktkosh_code` | Who the organization is. |
| | `state_code`, `district_code`, `address`, `phone` | Where it is. |
| | `status` | `pending`, `approved`, `rejected` or `suspended`. |
| | `applicant_id` | Who applied. |
| | `review_note`, `reviewed_by`, `reviewed_at` | The last admin review. |
| | `created_at`, `updated_at` | Timestamps. |
| `audit_log` | `id`, `actor_id` | Entry number, and the admin who acted. `actor_id` is null for scripts. |
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

### Functions and triggers

| Name | Kind | What it does |
|---|---|---|
| `set_updated_at()` | trigger function | Stamps `updated_at` on `organizations`. |
| `profiles_before_write()` | trigger function | Rejects a future date of birth, and sets `is_profile_complete` and `updated_at`. |
| `donor_screening_before_write()` | trigger function | Rejects a future donation date, and sets `updated_at`. |
| `handle_new_user()` | trigger function | Creates a `profiles` row for every new sign-up. |
| `handle_user_email_change()` | trigger function | Copies an email change into `profiles`. |
| `is_admin()` | function | Whether the caller is an admin. Used by the security policies. |
| `review_organization(p_organization_id, p_decision, p_note)` | function | Admin only. Approves, rejects or suspends an application, sets or removes the applicant's role, and writes the audit log. |
| `v_org` | variable | Inside `review_organization`: the application being reviewed. |
| `set_user_role(p_user_id, p_role)` | function | Admin only. Grants or removes admin, refuses to remove the last admin, and writes the audit log. |
| `v_old_role` | variable | Inside `set_user_role`: the user's role before the change. |
| `prune_stock_store(p_history_days, p_call_days)` | function | `bloodlink_ingest` only. Deletes history older than 60 days and call logs older than 90; returns the counts. |
| `v_history`, `v_calls` | variable | Inside `prune_stock_store`: rows deleted from each table. |
| `upstream_stats` | view | eRaktKosh calls in the last 24 hours per endpoint and state: calls, success %, median and 95th-percentile ms, last good call. Runs with the caller's rights, so only admins see rows. |
| `bloodlink_ingest` | role | No login. The collector switches to it with `set role`; it may write only the stock tables. |
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
