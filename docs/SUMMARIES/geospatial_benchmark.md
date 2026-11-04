# Summary: the geospatial search benchmark

*As of 4 November 2026. The full record follows the summary: [the ring search in full](#the-feature-in-full), then [report 3's record](#report-3s-record) of the benchmark, from its point 4. The script is `scripts/benchmark-geo.mjs`, and the results are in `../blood_data/measurements/geo_benchmark_memory.json` and `geo_benchmark_postgis.json`, outside git.*

**What was asked** (reviewer point 2): compare Haversine, expanding ring search and spatial indexing "quantitatively using different dataset sizes", by search time, the number of candidates evaluated, and scalability.

**The answer in brief.** Six methods were compared on the real directory of 4,328 banks and on copies of up to 500,000 points.
- **Today's banks don't need an index.** A linear scan costs about 0.1 ms, which eRaktKosh's own answer of 0.3 to 12 s dwarfs.
- **A donor network of 100,000 or more does need one.** There an index is 75 to 300 times faster than a scan and evaluates under 1% of the points.

So donors will go in PostGIS with a GiST index, which already exists on `blood_banks.location`.

| Status | |
|---|---|
| **Done** | Six methods at five sizes; time, candidates, build cost; every answer checked against the linear scan; the PostGIS index |
| **Planned** | The index used by donor search (`../PLANS/plan_donor_network.md`) |

---

## Method

- **Queries:** 200 points near real banks, at radii of 15 km (a city search) and 150 km (the widest rural ring).
- **Data:** the real eRaktKosh directory of 4,328 banks, then copies with about 5 km of random jitter, so the clustering into cities is kept.
- **Methods:**
  - a linear scan with Haversine;
  - the app's expanding rings;
  - a 0.25° grid;
  - a 3-D k-d tree;
  - a packed R-tree;
  - PostGIS `ST_DWithin`, with and without its GiST index.
- **Candidates** are the distance calculations a method needs.
- **Correctness:** every method's answer was checked against the linear scan. The check caught two bugs in the benchmark itself, both fixed before these numbers: ties between banks on shared points, and a search box too small at 150 km.

## Results in memory (median per query)

| Points | Radius | Linear scan | Rings | Grid 0.25° | k-d tree | R-tree | Found |
|---|---|---|---|---|---|---|---|
| **4,328 (real)** | 15 km | 115 µs, 4,328 candidates | 129 µs | **4.6 µs**, 36 candidates | 8.3 µs, 52 | 8.5 µs, 23 | 22 |
| 4,328 | 150 km | 119 µs | 126 µs | 35 µs, 224 | 23 µs, 351 | **21 µs**, 196 | 167 |
| 10,000 | 15 km | 250 µs | 299 µs | 5.8 µs | 5.1 µs | **5.0 µs** | 46 |
| 50,000 | 15 km | 1.36 ms | 1.67 ms | **19 µs** | 32 µs | 26 µs | 241 |
| 100,000 | 15 km | 2.91 ms | 3.40 ms | **49 µs**, 818 | 63 µs, 680 | 57 µs, 524 | 480 |
| 100,000 | 150 km | 3.56 ms | 3.59 ms | **0.91 ms** | 1.19 ms | 1.20 ms | 3,861 |
| **500,000** | 15 km | 65.4 ms (p95 202 ms), 500,000 candidates | 37.5 ms | **0.39 ms**, 4,110 | 0.50 ms, 3,099 | 0.57 ms, 2,630 | 2,406 |
| 500,000 | 150 km | 69.7 ms | 61.9 ms | 9.4 ms | **6.8 ms** | 7.4 ms | 19,368 |

Build times at 500,000 points: grid 47 ms, R-tree 1.1 s, k-d tree 4.2 s.

## Results in the database (PostGIS on Supabase)

These are the median server execution times from `EXPLAIN ANALYZE`. The network round trip to the database comes on top: about 10 ms from the laptop to Mumbai since 3 November.

| Points | Radius | With the GiST index | Without (scan) | Index build |
|---|---|---|---|---|
| 4,328 | 15 km | **0.11 ms** | 7.9 ms | 0.2 s |
| 4,328 | 150 km | 0.52 ms | 8.1 ms | |
| 100,000 | 15 km | **0.60 ms** | 185 ms | 0.9 s |
| 100,000 | 150 km | 9.7 ms | 186 ms | |
| 500,000 | 15 km | 75 ms | 925 ms | 5.5 s |
| 500,000 | 150 km | 96 ms | 976 ms | |

## What the numbers show

- **Bank search stays as it is.** Normally eRaktKosh's own `nearest` call does the radius search on its side. When it is down, the app scans the saved directory in memory, in about 0.1 ms.
- **Donor search needs an index.** At 100,000 to 500,000 donors a scan grows to 3 to 65 ms per query, with a heavy tail, and evaluates every point. PostGIS also gives persistence, sharing between server instances, and row-level security, which an in-memory tree can't.
- **In memory, a grid is enough.** It matches the trees at city radii and builds 20 to 90 times faster. Trees win only for very wide radii over very large sets.

## The status of spatial indexing, stated plainly

Reviewer point 6 asked for this:

| Item | Status |
|---|---|
| A PostGIS GiST index on `blood_banks.location` | **Completed** |
| Bank search without an index (eRaktKosh's `nearest`, or a linear scan) | **Completed, by choice:** an index wouldn't help at 4,328 banks |
| Donor locations in PostGIS, queried with the index | **Planned** (`../PLANS/plan_donor_network.md`) |
| A k-d tree or R-tree in the app | **Not planned:** PostGIS covers the large case, and a grid would serve any in-memory cache |

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Density-aware ring search
Files: `src/app/api/blood-search/route.js`, `src/lib/rings.js`, `src/lib/stateBounds.js`

Location search now adapts to the area. It used to always search 3, 5 and 10 km, so rural users found nothing.
- One eRaktKosh call fetches every bank within 150 km.
- Banks whose point lies outside their own state or outside India are left out, checked against state outlines with a 5 km margin for border cases. The page says how many were left out. Region search still lists them.
- If more than 10 banks are within 15 km, the area counts as **urban** and the search rings are 5, 10, 15 and 25 km. Otherwise it is **rural**, with rings of 20, 50, 100 and 150 km.
- **Nearest mode** (no component or group chosen) returns the smallest ring with an active bank holding matching stock. Dormant banks (no update for 30 days) never decide the ring. They are still listed, and if every bank with stock is dormant, the smallest ring with any of them is used.
- **Ranked mode** (component and group chosen) widens the ring until active banks cover the units needed.
- Stock is fetched once per state, in parallel. Before, it was fetched once per ring, one state after another.

## Report 3's record

### Point 4: the geospatial search benchmark

**Geospatial search benchmark** (the reviewer's point 2), `scripts/benchmark-geo.mjs`:
- **Setup:**
  - 200 query points near real banks.
  - Datasets: the real directory of 4,328 banks, then copies with about 5 km of jitter, so the real clustering is kept.
  - Every method's answer was checked against the linear scan for every query. The check caught two of the benchmark's own bugs (ties between banks on shared points, and a search box that was too small at 150 km), which were fixed before these numbers.
- **In memory**, median per query; candidates are the distance calculations needed:

| Banks | Radius | Linear scan | Rings (app logic) | Grid 0.25° | k-d tree (3-D) | R-tree (packed) | Banks found |
|---|---|---|---|---|---|---|---|
| **4,328 (real)** | 15 km | 115 µs, 4,328 candidates | 129 µs | **4.6 µs**, 36 candidates | 8.3 µs, 52 | 8.5 µs, 23 | 22 |
| 4,328 | 150 km | 119 µs | 126 µs | 35 µs, 224 | 23 µs, 351 | **21 µs**, 196 | 167 |
| 10,000 | 15 km | 250 µs | 299 µs | 5.8 µs | 5.1 µs | **5.0 µs** | 46 |
| 50,000 | 15 km | 1.36 ms | 1.67 ms | **19 µs** | 32 µs | 26 µs | 241 |
| 100,000 | 15 km | 2.91 ms | 3.40 ms | **49 µs**, 818 | 63 µs, 680 | 57 µs, 524 | 480 |
| 100,000 | 150 km | 3.56 ms | 3.59 ms | **0.91 ms** | 1.19 ms | 1.20 ms | 3,861 |
| **500,000** | 15 km | 65.4 ms (95th percentile 202 ms), 500,000 candidates | 37.5 ms | **0.39 ms**, 4,110 | 0.50 ms, 3,099 | 0.57 ms, 2,630 | 2,406 |
| 500,000 | 150 km | 69.7 ms | 61.9 ms | 9.4 ms | **6.8 ms** | 7.4 ms | 19,368 |

  Build times at 500,000: grid 47 ms, R-tree 1.1 s, k-d tree 4.2 s.

- **PostGIS in Supabase**, `ST_DWithin` on a geography column, median server execution time from `EXPLAIN ANALYZE`. The 175 ms network round trip comes on top.

| Points | Radius | GiST index | Without index (scan) | Index build |
|---|---|---|---|---|
| 4,328 | 15 km | **0.11 ms** | 7.9 ms | 0.2 s |
| 4,328 | 150 km | 0.52 ms | 8.1 ms | |
| 100,000 | 15 km | **0.60 ms** | 185 ms | 0.9 s |
| 100,000 | 150 km | 9.7 ms | 186 ms | |
| 500,000 | 15 km | 75 ms | 925 ms | 5.5 s |
| 500,000 | 150 km | 96 ms | 976 ms | |

- **Conclusions:**
  - **Today's directory:** at 4,328 banks a linear scan costs about 0.1 ms. That is less than 0.01% of a search's time, which eRaktKosh's own answer (0.3 to 12 s) dominates. The ring search and in-memory scan in the app are the right choice for now, and the measurement shows it.
  - **The donor network:** at 100,000 to 500,000 points (donors, not banks), a linear scan grows to 3 to 65 ms per query, with a heavy tail (202 ms at the 95th percentile). It evaluates every point, while a spatial index evaluates under 1%. **So donor locations go in PostGIS with a GiST index**, as the roadmap planned. The index is 75 to 300 times faster than a scan and gives persistence, sharing between instances and row-level security, which an in-memory tree can't.
  - **Grid against trees:** the simple grid is as fast as the k-d tree or R-tree at city-sized radii and builds 20 to 90 times faster. Trees win only for very wide radii over very large sets. A grid is enough for any in-memory cache.
  - **Implemented.** The migration `20261023000300_blood_bank_locations.sql` added PostGIS, a generated `blood_banks.location` column and the GiST index `blood_banks_location_gist`.
- Raw results: `blood_data/measurements/geo_benchmark_*.json`.
