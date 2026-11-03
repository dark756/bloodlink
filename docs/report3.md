# Report 3: answering the reviewer's suggestions

This report records every decision and step taken on 2026-10-23 to answer the reviewer's feedback in `documentation/suggested changes after sem 7 report 1.txt`. Each section has a plan, the decisions with their evidence, the steps taken, and how the result was checked.

- **Code paths** are relative to `bloodlink/` unless they start with `../`.
- **Where the work is.** Branch `supabase-migration`, GitHub's default branch since 26 October. Report 3's work was committed on 24 October as `5af73b9`, on top of `798fe73`, and the review fixes on 26 October. The later fixes of 26 October and the work of 3 November were committed on 3 November, on the branch `mumbai-and-cloud-collector`.
- **Order of work.** The points are worked in the order they were asked, not by number: 2, 1, 3.1, 3.2, 4, 5.
- **Follow-up on 2026-10-24.** `docs/data_integrity.md` re-checks point 3 independently and records six faults it found and fixed (#36 to #41). The counts and results here that it changed have been updated, and each point says where.
- **Reviews of 24 and 25 October.** A review of the code, docs and plans, whose next moves are now in `docs/plans.md`, and `docs/verify_facts.md`, which checked every number and outside fact. Thirteen of the faults they and a follow-up review found were fixed on 26 October; `CLAUDE.md` lists them and the ones still open. Where they corrected a figure or a source here, the text has been updated.
- **Point 5 on 2026-10-26.** The shortlist of seven models, two low-fidelity checks and the subplan were added. The check scripts are in `../rough_work/ML/`, outside git.
- **3 November.** The database moved to Mumbai (#28), collection moved to Supabase ([point 3.1](#collection-moved-to-supabase-3-november)), and point 5 gained an [early walk-forward dry run](#an-early-walk-forward-dry-run-3-november).

**Contents**
1. [Point 2: road routing (OSRM) and a time-aware ETA](#point-2-road-routing-osrm-and-a-time-aware-eta)
2. [Point 1: ranking engine, exact group only, rewarding spare stock](#point-1-ranking-engine-exact-group-only-rewarding-spare-stock)
3. [Point 3.1: stale data, eRaktKosh failures and hourly collection](#point-31-stale-data-eraktkosh-failures-and-hourly-collection)
4. [Point 3.2: re-collecting, validating and de-duplicating the data; other datasets](#point-32-re-collecting-validating-and-de-duplicating-the-data-other-datasets)
5. [Point 4: how testing and performance measurement are done](#point-4-how-testing-and-performance-measurement-are-done)
6. [Point 5: which ML approaches to compare](#point-5-which-ml-approaches-to-compare)
7. [Reviewer suggestions, one by one](#reviewer-suggestions-one-by-one)

---

## Point 2: road routing (OSRM) and a time-aware ETA

> *Request:* implement OSRM and make sure that ETA depends on time of day, population density, estimated rush-hour slowdowns, and whatever else is relevant.

### Where it started

`estimateEtaMinutes` in `src/lib/ranking.js` turned straight-line distance into minutes with one fixed rule: distance × 1.4 for detours, at 25 km/h in an urban area or 45 km/h in a rural one. Time, day, season and weather changed nothing.

### Measurements taken before designing

All of these were taken live on 2026-10-23.

| Check | Result | What it decided |
|---|---|---|
| Public OSRM server, `router.project-osrm.org`, table service with Indian coordinates | Works. Answered in about 0.7 s. It accepted tables of 100, 150 and 300 points. | One table call can time every bank in a ring. |
| Road distance ÷ straight-line distance over 94 real Mumbai bank trips (OSRM table from 19.0760, 72.8777) | Median **1.34**. 10th percentile 1.17, 90th 1.70. Short trips (under 5 km) 1.58. | The fallback detour factor becomes 1.34, measured, instead of the guessed 1.4. |
| Speed implied by OSRM's free-flow times on the same 94 trips | Median **65 km/h**. 56 km/h under 5 km, 76 km/h for 30 to 60 km. | OSRM's car profile assumes near-limit speeds, about twice what Mumbai traffic allows even with no congestion. OSRM time cannot be used raw. |
| TomTom Traffic Index 2025, 10 Indian city pages | Measured free-flow speed (all roads, metro area) 28.8 to 39.7 km/h; Mumbai 33.7 km/h. Congestion level per weekday and hour (168 values per city), per month (12), morning and evening peaks. | Gives a real, cited speed and a rush-hour shape for each city. |
| Mumbai example, TomTom | Average congestion 61.5%. Friday 6 pm 114.7%; Friday 3 am 1%. September 69.8% against May 52.5%. | Rush hour more than doubles travel time; the monsoon months are worse. |
| eRaktKosh `nearest`, banks within 15 km of each of the 10 city centres | Ernakulam 14 to New Delhi 149. | Bank density tracks population: correlation of ln(banks) with ln(population) is 0.70, using TomTom's metro populations, not Census figures. |
| TomTom ranking, 381 cities outside North America | Congestion rises about **7.4 points per tenfold rise in population** (r = 0.43). | Used to scale the congestion level down for smaller towns. |
| Open-Meteo current weather, no key | Works. Returns rain in the last 15 minutes. | Live rain can be included. |

### Plan

1. **`src/lib/routing.js` (new, server only): OSRM client.**
   - One `table` call from the user to every bank being timed, returning road distance and OSRM free-flow time.
   - Base URL from a new server-only variable `OSRM_URL`, defaulting to the public server.
   - A 6-second timeout and a 24-hour cache per user-to-bank pair, since roads don't change by the hour.
   - The public server's rules are kept: at most one request per second from this server, an honest User-Agent, and OpenStreetMap attribution on the page.
   - On any failure, no error is shown. The bank falls back to straight-line distance × 1.34.
2. **`assets/traffic_profiles.json` (new) and `scripts/build-traffic-profiles.mjs` (new).**
   - The script downloads the 10 TomTom city pages once and keeps, for each city:
     - the metro area's bounding box and free-flow speed;
     - its 7 × 24 weekday-hour congestion grid;
     - its 12 monthly levels.
   - It also builds an "India average" profile for places outside those cities.
3. **`src/lib/traffic.js` (new, pure): the travel-time model.**
   - **Zone.** It picks a traffic zone for the search location:
     - **metro:** inside one of the 10 TomTom metro areas (10 km margin). Uses that city's own profile.
     - **city:** more than 10 banks within 15 km, the threshold the ring search already uses for "urban".
     - **town:** 3 to 10 banks.
     - **rural:** 0 to 2 banks.
   - **Free-flow time.** OSRM time, but never faster than the zone's measured free-flow speed.
   - **Congestion.** From the zone's profile at the current India-time weekday, hour and minute (interpolated between hours), times the month's seasonal factor.
   - **Rain.** A conservative extra for moderate or heavy rain at that moment.
   - **ETA** = free-flow time × (1 + congestion) × rain factor.
4. **`src/lib/weather.js` (new, server only): current rain from Open-Meteo.**
   - Timeout 2.5 s, cached 15 minutes per 0.1° cell.
   - If it fails, the rain factor is simply 1.
5. **`src/app/api/blood-search/route.js`: wire it in.**
   - The ring is still chosen by straight-line distance, which is cheap.
   - Only the banks inside the chosen ring are routed: one OSRM call, with the weather call in parallel.
   - Each result carries `roadDistanceM`, `etaMinutes` and `etaSource` (`road` or `estimate`).
   - A `travel` block describes the zone, congestion and rain used.
   - Nearest mode gets road ETAs too, but stays sorted by distance as its specification says.
6. **`src/lib/ranking.js`.** `rankSources` uses each bank's `etaMinutes` instead of estimating it, so scoring and travel estimation are separate. The ETA reason names the traffic condition.
7. **`src/app/search/page.js`.**
   - Show road distance and "about N min now".
   - Explain what the times are based on.
   - Add the OpenStreetMap, OSRM and TomTom credits.
8. **Tests:** `tests/traffic.test.js` and `tests/routing.test.js`, covering:
   - rush hour against night, weekday against Sunday, monsoon against dry month;
   - zone detection;
   - the free-flow floor;
   - the rain bands;
   - OSRM response parsing and fallback.
9. **Docs:** `CLAUDE.md` (environment variable, scoring section, modules) and `docs/CODE_REFERENCE.md`.

### Decisions

**D2.1 · OSRM gives the road distance; measured speeds give the time.**
- *Why OSRM:* it is open source, free, and covers India from OpenStreetMap. Its `table` service times many destinations in one request.
- *Why not OSRM time alone:* it assumes 65 km/h through Mumbai; see the measurements above.
- *Why TomTom:* its figures are measured from real trips, more than 3.65 trillion km a year by its own statement, and are published per city.
- *Alternatives considered:*
  - **Google Distance Matrix:** traffic-aware, but billed per element and needs a card.
  - **OpenRouteService:** needs a key, with a 2,000 requests a day limit.
  - **TomTom Routing API:** traffic-aware, needs a key and a licence.
  - All three are drop-in replacements later, because routing sits behind `routing.js`.

**D2.2 · Free-flow time = the slower of OSRM's time and road distance ÷ the zone's measured free-flow speed.** OSRM still wins where it is slower, for example on a winding hill road.

**D2.3 · Congestion comes from measured weekday-hour profiles.**
- The 10 TomTom cities use their own profile.
- Everywhere else uses the average Indian profile shape, scaled by zone:

| Zone | Free-flow speed | Congestion level | Basis |
|---|---|---|---|
| metro | that city's measured speed | that city's measured profile | TomTom 2025, per city |
| city | Indian average, all roads | Indian average × 0.89 | A city of about 2 million against the 9.7 million metro average, from TomTom's within-country fit. The first version used the Indian average unscaled; see "Change made while building". |
| town | Halfway between city streets and open road (about 45 km/h) | Indian average × 0.73 | A town of about 300,000, from the same fit. The first version used 0.86 from a global fit and the city speed; see below. |
| rural | Indian average on highways (about 58 km/h) | Indian average × 0.29 | Assumption: rural trips are mostly open road. Set to half the congestion measured on Indian metro highways (about 30%). Flagged for calibration. |

**D2.4 · Population density is measured by blood-bank density.**
- The app already counts banks within 15 km for the ring search.
- That count correlates with city population (r = 0.70 over the 10 cities, with TomTom's metro populations) and needs no extra data.
- A census-density layer was considered and rejected for now. Census districts use different codes from eRaktKosh, and district-level density hides the difference between a city centre and its rural edge.

**D2.5 · Season and rain are included; other factors are not.**
- **Season:** the monthly factor carries the monsoon effect from measurement, for example Mumbai in September.
- **Live rain:** moderate rain (2.5 to 7.6 mm/h) adds 15% and heavy rain (over 7.6 mm/h) adds 30%.
  - The bands are the American Meteorological Society's hourly rain rates.
  - The studies below classed rain by daily totals (India Meteorological Department categories), so the factors are set cautiously, at the low end of their findings:
  - 10% to 130% on two Mumbai roads (IIT Bombay, WCTR 2019);
  - +30% average in a rainy Bengaluru week (MoveInSync, 2022).
- **Considered and left out:**
  - **Festivals and holidays:** they need a calendar per state.
  - **Ambulance priority:** we don't know who is travelling.
  - **Time to issue blood at the bank:** the same for every bank, so it cannot change the ranking.
  - **Live traffic:** needs a paid feed.

**D2.6 · Failures degrade quietly.**
- If OSRM fails, the straight-line estimate × 1.34 is used, still with the time-of-day factors. The bank is marked `etaSource: "estimate"`.
- If the weather call fails, there is no rain factor.
- A search never fails because routing failed.

### Change made while building: towns were too slow

The first version scaled town congestion by 0.86 and kept the city free-flow speed. A live check on Friday at 6:22 pm gave Panaji (Goa, a town with 3 banks within 15 km):
- +76% congestion;
- 50 minutes for a 15.6 km trip that locals would expect to take 30 to 35.

Two fixes followed, both from data:
- **Scale from comparisons inside each country.** Across 34 countries and 411 city pairs in the TomTom index, congestion relative to a country's largest city is 0.971 + 0.168 × log10(population ratio), with r = 0.40. Measured from the Indian metro average of 9.7 million people (TomTom's metro populations), and divided by the fit's value at that average, a city of about 2 million comes out at about 0.88 and a town of about 300,000 at about 0.74. The scales became city 0.89 and town 0.73, under one point of congestion from those values; the exact inputs used weren't kept (`docs/verify_facts.md`, F5). The earlier cross-country fit had compared cities in different countries, which mixes national driving conditions in with city size.
- **Town free-flow speed set halfway between city streets (33.1 km/h) and open road (57.8 km/h).** Town trips leave the built-up area quickly. This is an assumption and is listed for calibration in point 4.

After the fix, the same Panaji trip is **34 minutes**.

### Steps taken

1. **Measured OSRM and TomTom first.** See the table above. The working files are in the session scratchpad and are not part of the app.
2. **Wrote `scripts/build-traffic-profiles.mjs` and ran it.** It produced `assets/traffic_profiles.json`, 13.7 KB:
   - for each of the 10 cities: the 7 × 24 congestion grid, 12 seasonal factors, free-flow speeds and the metro bounding box;
   - an India average.
   - The average is 51.5% congestion a year: the mean of TomTom's ten traffic-weighted city figures. The hourly grid itself averages 39.7% over the week, because quiet hours count equally.
   - At 6 pm it is 85.6% on a Monday, 89.5% on a Friday and 60.3% on a Sunday.
   - The seasonal factor is 1.09 to 1.11 in July to September and 0.89 in March.
3. **Added `src/lib/traffic.js`** (pure, browser-safe), **`src/lib/routing.js`** and **`src/lib/weather.js`** (server only), as planned.
4. **`src/lib/ranking.js`.**
   - `estimateEtaMinutes` and `TRAVEL` were removed. τ is now `ETA_DECAY_MINUTES`.
   - `rankSources` reads each bank's `etaMinutes`.
   - Ties are broken by ETA instead of straight-line distance.
   - The travel reason now reads, for example, "About 18 min by road at this hour (rush-hour traffic)".
5. **`src/app/api/blood-search/route.js`.**
   - The weather call starts with the request.
   - The OSRM call starts as soon as the candidate banks are known, and runs alongside the stock lookups.
   - Results gain `roadDistanceM`, `etaMinutes` and `etaSource`.
   - The response gains a `travel` block: zone, city, local time, congestion %, label, rain and how many banks were road-routed.
6. **`src/app/search/page.js`.**
   - Each bank shows "6.2 km by road · about 24 min now".
   - The results list explains the basis, for example "Travel times use road routes and Mumbai traffic for Fri 6:22 pm (rush-hour traffic, +116%)".
   - The page credits OSRM, OpenStreetMap, TomTom and Open-Meteo.
7. **Tests.**
   - `tests/traffic.test.js`, 16 tests: India clock, zones, rush hour against night, Sunday against Wednesday, monsoon against May, interpolation between hours, density scaling, rain, the free-flow floor, and the straight-line fallback.
   - `tests/routing.test.js`, 8 tests: OSRM parsing, the cache, failure without throwing, banks with no coordinates, and the Open-Meteo rain rate.
   - `tests/ranking.test.js` now gives each test bank an `etaMinutes`. The scenario scores did not change.

### Results

- **Checks:** `npm run lint` is clean, `npm run format:check` is clean, `npm test` passes all 64 tests, and `npm run build` passes.
- **Live searches**, run on Friday 2026-10-23 at about 6:22 pm India time, production build:

| Search | Zone found | Congestion used | Example result |
|---|---|---|---|
| Mumbai, ranked O- red cells, 3 units, critical | metro, Mumbai | +116% (rush hour) | 7.4 km by road, 29 min. All 7 banks road-routed. Plan covers 3 of 3 units. Whole search 1.6 s. |
| Nashik (13 banks within 15 km) | city | +78% | 2.5 km by road, 8 min |
| Satara (4 banks) | town | +64% | 2.5 km by road, 8 min |
| Barmer, Rajasthan (1 bank) | rural | +26% | 1.1 km by road, 2 min |
| Panaji, Goa (3 banks) | town | +64% | 15.6 km by road, 34 min |
| Mumbai ranked again, with `OSRM_URL` pointed at a closed port | metro, Mumbai | +116% | All 7 banks marked `estimate`, `routingDegraded: true`. Search still answered, in 2.2 s. |

### How to defend it

- **"Why not Google Maps?"** It is billed and needs a card. OSRM is open, and the model sits behind `routing.js`, so a paid traffic-aware service can replace it without touching the ranking.
- **"OSRM doesn't know traffic."** Correct, so OSRM supplies only the road network and distance. Speeds and the rush-hour shape come from TomTom's measured data.
  - OSRM alone would claim 65 km/h through Mumbai.
  - TomTom's figures are the published averages for the same cities, and the code shows which hour and month were used.
- **"Population density?"** It is measured by bank density, which correlates 0.70 with city population (TomTom's metro populations) over the measured cities. The scales come from a 411-city fit.
- **"Is the rural value made up?"** Partly. It is the one assumption with no direct measurement, and it is flagged in the code. Point 4 gives the calibration method: compare against timed sample trips.
- **Public server limits are respected.** The app makes at most one OSRM request a second, sends an honest User-Agent, and credits OpenStreetMap. Production should self-host OSRM with Docker and the Geofabrik India extract. Three commands are needed (`osrm-extract`, `osrm-partition` and `osrm-customize`, then `osrm-routed --algorithm mld`), and the preprocessing needs about 8 to 12 GB of memory. Only `OSRM_URL` changes.
- **Data licences.**
  - TomTom's figures are credited and used for an academic project; a commercial version would license TomTom's Traffic Stats API.
  - Open-Meteo is free for non-commercial use, with credit.
  - OSRM output carries the OpenStreetMap ODbL credit.

**Sources:**
- [TomTom Traffic Index 2025](https://www.tomtom.com/traffic-index/ranking/), city pages, for example [Mumbai](https://www.tomtom.com/traffic-index/city/mumbai/).
- [OSRM demo-server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): the rules for `router.project-osrm.org`, the server the app uses. At most one request a second, a valid User-Agent, no heavy use. FOSSGIS sponsors it; its [routing usage policy](https://routing.openstreetmap.de/about.html) covers a different server, `routing.openstreetmap.de`.
- [IIT Bombay, WCTR 2019](https://www.wctrs-society.com/wp-content/uploads/abstracts/mumbai/WCTR2019_Mumbai_526.pdf): rain raised travel time 10% to 130% on two Mumbai roads.
- [The News Minute, on MoveInSync](https://www.thenewsminute.com/article/bengaluru-rains-pushed-average-commute-time-62-august-167433): Bengaluru rain week, about +30% average travel time.
- [Down To Earth, TomTom 2025](https://www.downtoearth.org.in/amp/story/urbanisation/bengaluru-kolkata-among-worlds-slowest-cities-as-india-ranks-high-on-congestion-index): Bengaluru centre 74.4%.

---

## Point 1: ranking engine, exact group only, rewarding spare stock

> *Request:* make sure that stock overflow is rewarded more in critical and urgent situations. Remove the compatibility feature from the engine's calculations, and list a hospital as a match only if it has the exact blood type required.

### Where it started

`rankSources` scored four things:
- compatibility: 100 for exact stock that covers the request, 85 for some exact stock, 70 for substitutes only;
- ETA;
- stock: `100 · min(1, units / needed)`, so anything beyond the request earned nothing;
- freshness.

The route counted compatible substitute groups from `donorGroupsFor` unless `compatible=0` was sent. The page had an "Include compatible groups" box, ticked by default.

### Plan

1. **Matching.** Only banks listing the patient's exact group count. A new pure helper, `exactGroupUnits(row, component, group)` in `src/lib/stock.js`, returns that group's units. A bank with 0 is not a match, whatever compatible stock it holds.
2. **Remove compatibility from the engine.**
   - `compatibilityScore` is deleted.
   - The `compatible` parameter, `acceptedGroups`, the check box and the "(compatible)" labels go.
   - Plan allocations no longer need "exact first".
   - `src/lib/compatibility.js` stays, with its tests. Nothing in search uses it, but the planned donor matching will.
3. **Split the stock score in two.**
   - **Coverage:** `100 · min(1, units / needed)`, the old stock score.
   - **Surplus** (new): `100 · (1 − e^(−spare / needed))`, where `spare = max(0, units − needed)`.
4. **Re-weight by urgency, with surplus weighted most when critical,** using the weight compatibility used to hold.
5. **Reasons.** Three per bank: travel, stock ("6 O-Ve units listed: covers the 3 needed, with 3 to spare"), freshness.
6. **Tests.** Rewrite `tests/ranking.test.js` with hand-checked scenarios.

### Decisions

**D1.1 · Why reward spare stock at all?**
1. **A buffer against stale data.** eRaktKosh stock is whatever the bank last typed in, and in the live Mumbai check most banks had last updated 8 to 12 hours earlier. A bank listing exactly the 3 units needed has no margin if one was issued since. In an emergency, an empty-handed trip costs the most.
2. **Patients needing more.** Critical bleeding often needs more units than first asked for. A bank with spare stock can meet a second request without a second trip.
3. **Fewer trips in the plan.** The greedy plan takes from banks in rank order. Ranking banks with spare stock higher tends to cover a request from fewer banks. In the live routine example below, one bank covered all 3 units.

**D1.2 · Why this shape?**
- Measuring spare stock in multiples of the request keeps it fair across request sizes: 2 spare units mean more for a 1-unit request than for a 10-unit one.
- The exponential gives diminishing returns. The first extra request's worth scores 63, the second takes it to 86, and beyond that there is little gain, so a large bank far away cannot win on size alone.
- It uses the same e^(−x) form as the ETA score, so one explanation covers both.

**D1.3 · Weights**

| Urgency | ETA | Coverage | Surplus | Freshness | Old weights (compat., ETA, stock, fresh.) |
|---|---|---|---|---|---|
| critical | 0.45 | 0.15 | **0.20** | 0.20 | 0.10, 0.45, 0.25, 0.20 |
| urgent | 0.35 | 0.25 | **0.15** | 0.25 | 0.20, 0.35, 0.25, 0.20 |
| routine | 0.25 | 0.35 | **0.05** | 0.35 | 0.25, 0.25, 0.25, 0.25 |

- **ETA weights are unchanged** from the reviewed version, so the urgency logic the reviewer saw still holds.
- **Compatibility's weight is redistributed:**
  - critical: 0.10 to surplus. Coverage also moves 0.10 to surplus, because when critical a close bank with some units is worth visiting first and the plan adds the rest.
  - urgent: 0.15 to surplus, 0.05 to freshness.
  - routine: 0.10 to coverage, 0.05 to surplus, 0.10 to freshness. Routine requests have time to choose the most reliable single source.
- **Spare stock's reward, by urgency.** The table shows what spare equal to one more request (score 63.2) is worth, measured from a bank 10 minutes away.

| Urgency | Extra points | Extra minutes of travel it is worth |
|---|---|---|
| critical | +12.6 | about 15 |
| urgent | +9.5 | about 19 |
| routine | +3.2 | about 10 |

  - In points, the reward is largest when critical and smallest when routine, as asked.
  - In minutes, urgent is slightly above critical, because a critical request values every minute more (τ = 30 against 45). The panel can change the exchange rate by editing one number per urgency in `WEIGHTS`, and the tests show the effect.

**D1.4 · What "exact" means.**
- The eRaktKosh group label must equal the patient's group, ignoring case. So `O-Ve` matches O-, and Bombay `Oh+Ve` matches only Bombay Oh+.
- A bank that has only O- red cells is not listed for an A+ patient, though O- red cells would be clinically acceptable.
- This is deliberate, and safer for a public tool: the decision to give a substitute stays with the blood bank and the clinician.

**D1.5 · Banks short of the request still count.** "A match" means it has the exact group. A bank with 1 of 3 units is listed, scores lower on coverage, and the plan adds other banks.

### Steps taken

1. **`src/lib/ranking.js`, rewritten.**
   - New: `coverageScore`, `surplusScore`, `describeStock`, the new `WEIGHTS`, and three reasons per bank.
   - Removed: `compatibilityScore`, `exactUnits`, `totalUnits`, and the allocations in the plan.
   - `rankSources` drops any source with 0 units.
2. **`src/lib/stock.js`:** added `exactGroupUnits`.
3. **`src/app/api/blood-search/route.js`.**
   - Ranked mode asks eRaktKosh for the component and the group, the same parameters nearest mode uses, so the two share the cache.
   - It keeps only exact-group units.
   - It no longer reads `compatible`. The response has `bloodGroup` instead of `acceptedGroups` and `compatible`.
4. **`src/app/search/page.js`.**
   - The "Include compatible groups" box is removed and the urgency row is two columns.
   - The plan lists "N units" per bank.
   - The result heading names the exact group.
   - The ranking footnote explains the new scores.
5. **`tests/ranking.test.js`, 19 tests** (a 20th, for dormant banks, came in 3.1):
   - the weights;
   - each score, including surplus 0, 63.2 and 86.5;
   - exact-only matching (an AB+ patient is not matched to a bank holding only O- and O+);
   - the critical split;
   - spare stock's margin by urgency;
   - spare stock against travel time;
   - freshness;
   - urgency trade-off;
   - plan coverage and shortfall.
6. **Docs.** `CLAUDE.md` now covers the scoring, weights, travel model, environment variable, modules and verification steps. `docs/CODE_REFERENCE.md` has every new and changed name. Its cross-check script reports 0 missing either way.

### Results

- **Checks:** lint is clean, format is clean, all 69 tests pass, and the build passes.
- **Worked example from the tests,** critical, 2 units of O- red cells:
  - Bank A, 10 min, 1 unit, fresh: 0.45 × 71.7 + 0.15 × 50 + 0.20 × 0 + 0.20 × 100 = **59.8**.
  - Bank B, 40 min, 6 units, 30 h old: 0.45 × 26.4 + 0.15 × 100 + 0.20 × 86.5 + 0.20 × 63.6 = **56.9**.
  - A ranks first. The plan takes 1 unit from A and 1 from B.
- **Live, Mumbai, O- red cells, 3 units, Friday 6:25 pm:**

| Urgency | Top 3 (minutes, units, score) | Plan |
|---|---|---|
| critical | Cooper (4 min, 2 units, 69.4); Raheja (26 min, 6 units, 65.1); L.T.M.G. (28 min, 6 units, 64.7) | 2 units from Cooper, then 1 from Raheja |
| routine | L.T.M.G. (28 min, 6 units, 87.8); Deepak (18 min, 4 units, 87.5); Raheja (26 min, 6 units, 86.8) | All 3 from L.T.M.G., one trip |

- **Exact-only check, live.** An AB+ search near Mumbai returned 9 banks, none showing any group other than AB+Ve. Sending `compatible=1` is ignored, and the response has no `compatible` or `acceptedGroups` field.

### How to defend it

- **"Why not count O- for everyone?"** Substitution is a clinical decision. A public search showing only exact matches can't steer anyone towards a wrong product, and it keeps scarce O- stock for O- patients. The compatibility rules are still in the code for donor matching, where a clinician confirms.
- **"Why reward surplus more when critical?"** In a critical case, a wasted trip is the worst outcome. Spare stock protects against stock that changed since it was posted, and against the patient needing more. In routine cases there is time to phone first, so surplus matters little (0.05).
- **"Isn't this arbitrary?"** The form is explained (D1.2), the weights are explicit and add up to 1, and each one's effect is shown in points and minutes (D1.3). The tests pin the hand calculations. Point 4 describes the sensitivity and expert-review tests that would refine the numbers.

---

## Point 3.1: stale data, eRaktKosh failures and hourly collection

> *Request:* execute `IMMEDIATE_NEXT_STEP.MD`, and make sure a system can load the API results at a reasonable refresh rate. This is for data collection only at this stage, not deployment: hourly or less often.

`IMMEDIATE_NEXT_STEP.MD` was a plan on hold, and this request lifted the hold. It had four phases: 0 (checks), 1 (resilience in the app), 2 (a saved copy that survives restarts) and 3 (measurement). This section records the plan and what was done, so the file has been retired.

### Phase 0: checks, run on 2026-10-23 from 18:30 India time

| Check | Result | Consequence |
|---|---|---|
| All 36 states, `blood-availability`, one second apart | 86.7 s in total, 9.5 MB, **4,707 banks**. Uttar Pradesh is slowest: 12.4 s for 1.4 MB, 678 banks. Lakshadweep returns none. No compression: no `Content-Encoding` header. | A full sweep takes about 2 minutes, so **hourly is comfortable and polite**. Per-state timeouts stay at 25 s. |
| Nationwide `nearest`, 5,000 km from central India | 1.6 s, 1.8 MB, **4,328 banks** with coordinates | The directory takes one call; refreshing it weekly is enough. |
| Directory joined with stock on `hospitalCode` | 4,028 in both. **679 stocked banks have no coordinates** (432 blood banks and 247 storage units), and 300 directory banks have no stock row. | Location search cannot see 14% of stocked banks. Recorded as a data-quality finding; 3.2 tries other sources for their locations. |
| `offline` | "1" for 4,648 banks, "0" for 59. The "0" banks' median stock age is **104 h**, against 9.7 h. | It is not "entered by hand". It marks banks that rarely update, and the freshness score already penalises those, so it is not used separately. |
| `moderateStock` | Always "0" or empty | Carries no information. Ignored. |
| `stockSource` (directory) | 2 for 4,073 banks; 1, 3 and 0 for the rest. Banks with 0 have the oldest stock: 90th-percentile age 722 h. | Meaning unpublished. Kept in the directory for later analysis; not scored. |
| Stock age over all 4,707 banks, at 18:30 | Median **9.7 h** (most banks update between 07:00 and 12:00, so the median depends on the hour: 3.3 h at 10:47 the next morning), 75th percentile 18.5 h, 90th percentile 222 h. 23.9% are older than 1 day, **6.3% older than 30 days**, 3.3% older than 90 days. The oldest is 236 days. | The dormant cut-off of 30 days is confirmed. It marks 297 banks. |
| Group labels | **1,694 entries do not match our names.** They use "O +ve", with a space and lower case. The 116 "Oh+VE" entries already match. | **A real bug.** The app compared names exactly, so all searches missed these entries in at least 10 states. Fixed by normalising labels (step 1 below). The validator's count on the same sweep agrees exactly: 1,694 renamed. |
| Unit counts | 57,946 group entries. 99th percentile 290; **30 entries over 2,000**, the largest 15,280; none negative. | Values over 2,000 per group are implausible and dropped. |
| Duplicates | No `hospitalCode` repeats, within a state or across states | The rule "keep the newer row" stays as a guard. |
| Coordinates | 2 banks are placed outside India (longitude 64 and 66). 606 banks share 203 identical points. | Flagged in the directory as `location_quality`. |
| Access from outside India | Tested on 24 October from a cloud container outside India: every call answered, though a full sweep took 182 s against 87 s from here (`docs/verify_facts.md`). | Collection ran on this machine, in India. The cloud collector, since 3 November, runs in Mumbai and was tested there first ([below](#collection-moved-to-supabase-3-november)). |

### Plan

**Scope for this stage.** The request is collection, not deployment. So:
- Saved data is written only by a scheduled script on this machine, not after live searches. This was the simpler of the two options in the original Decision 1.
- The app reads the saved copy as its fallback.
- The schedule is **hourly**: all states plus a directory refresh once a week.

**Phase 1: resilience inside the app**
1. **`src/lib/stock.js`.** `parseQuantities` normalises group labels to the 10 canonical names, which fixes the bug above. `isDormant(entryDate, now)` marks stock older than 30 days.
2. **`src/lib/stockQuality.js`** (new, pure). `validateAvailabilityRows(rows, { now })` returns `{ rows, report }`:
   - drops unit counts that aren't whole numbers from 0 to 2,000;
   - normalises labels and drops unknown groups;
   - treats a time more than 10 minutes in the future as unknown;
   - keeps the newer of two rows for the same bank;
   - cleans names;
   - counts every change.
   - It is written so the Node scripts can import it too.
3. **`src/lib/eraktkosh.js`, rebuilt around `createEraktkoshClient({ http, savedStore, now, simulate })`.** The existing exports stay as thin wrappers. The chain for each lookup:
   1. Fresh memory cache, under 5 minutes.
   2. If the circuit is open (3 failures within a minute), skip eRaktKosh for 2 minutes, then let one request test it.
   3. Live call, with one quick retry after a short random delay on network errors and 5xx answers. If a backup exists, give up after 8 seconds and serve the backup; the live call finishes in the background and refreshes the cache.
   4. The older copy in memory.
   5. The copy saved in Supabase.
   6. A clear error.
   - Failure kinds: timeout, network, http and shape.
   - Each answer says where it came from: `live`, `cache`, `memory` or `saved`, with `fetchedAt`.
4. **`ERAKTKOSH_SIMULATE=down|slow|flaky`.** It only works outside production builds.
5. **The search route** returns a `freshness` block: `source`, `fetchedAt`, `oldestFetchedAt`, `upstream` (ok, degraded or down) and `failedStates` by name. Region search sends `X-Data-Source` and `X-Data-Fetched-At`. Each bank carries `isDormant`, and dormant banks stay listed but are left out of the plan.
6. **The search page:**
   - a banner by source and age: none when live, yellow for a saved copy under 24 h old, red when older;
   - two ages on each bank ("Bank updated 3 h ago · checked 40 min ago");
   - "Couldn't check Karnataka" for failed states;
   - a dormant badge;
   - a Retry button on errors.

**Phase 2: a saved copy that survives restarts**

7. **Migration `20261023000200_stock_store.sql`.** Four tables:
   - `blood_banks`: directory, public read;
   - `bank_stock_latest`: one validated eRaktKosh row per bank, public read;
   - `stock_history`: a compact copy written whenever a bank's update time changes, public read;
   - `upstream_calls`: one row per eRaktKosh call, admins only.

   Writers and views:
   - All writes go through a new no-login role, `bloodlink_ingest`. The collector connects with the existing `SUPABASE_DB_URL` and immediately runs `set role bloodlink_ingest`, so for the rest of the session it can only touch the stock tables. No new password is created. Before deployment, the role gets a login and its own connection string.
   - An `upstream_stats` view is created with `security_invoker`.
   - A `prune_stock_store(p_history_days, p_call_days)` function trims history after 60 days and the call log after 90. It runs as `bloodlink_ingest`; the column grant it needs was added on 26 October (#56), and until then every prune failed.
8. **`src/lib/stockStore.js`** (new, server only). Reads the saved copy with the publishable key:
   - for a state, in eRaktKosh's own row shape, so the existing parsing works unchanged;
   - for the directory, `loadSavedNearest` gives straight-line distances in memory when `nearest` is down.
9. **`scripts/snapshot.mjs`** (new):
   - `--directory` saves the nationwide `nearest` call;
   - `--states 30,99` or `--all` saves stock state by state, 1 second apart, validated with `stockQuality.js`;
   - `--archive <dir>` also writes each sweep's changes to a local daily file for point 3.2.
10. **Hourly schedule:** a Windows Task Scheduler job on this machine runs `--all --archive` every hour, plus `--directory` on Mondays.

**Phase 3: measurement**

11. **The `upstream_stats` view and an admin card.** The card shows, for the last 24 hours, eRaktKosh's success rate, its median and 95th-percentile time, and the last good fetch for each state.
12. **`scripts/measure-search.mjs`** (new). It runs N searches per scenario against a running server and prints the median and 95th percentile, cold and warm.
13. **Failure drill:** each simulate mode, recording what the user sees, the time and the source. Results go in this section and feed point 4.
14. **Tests** with a fake HTTP layer, for every step in the chain and every validation rule.

### Decisions

**D3.1 · Collect hourly, from this machine, writing through a limited role.**
- **Hourly.** A full sweep takes about 3.5 minutes and downloads 9.5 MB. Hourly is the most often the request allows.
- **Why not more often?** A bank updates its stock about once a day (a median gap of 24.2 h in the first repeat updates collected), so polling more often would mostly re-read unchanged data.
- **Why not less often?** A stock-out forecast needs to see the drop before it happens. Daily samples would miss same-day drops.
- **Why this machine?** It is in India, so the "blocked abroad" question doesn't arise, and a scheduler is free.
- **Why a role and not a new password?** `set role bloodlink_ingest` limits the session without creating a new secret.
- **Since 3 November** collection runs in Supabase every 4.5 hours, through the same role: see [Collection moved to Supabase](#collection-moved-to-supabase-3-november).

**D3.2 · History is written only when a bank's update time changes.**
- Between updates, a bank's stock is constant by definition, so repeating it adds nothing.
- The cost was measured: about 420 bytes a row in Postgres. A typical day of changes is roughly 6,000 rows, about 2.5 MB, so 60 days is about 150 MB. That is why history is pruned at 60 days in the database.
- The archive keeps everything for point 5: the Storage bucket `stock-archive` since 3 November, with a weekly copy in `../blood_data/eraktkosh/`, where the laptop wrote it before.

**D3.3 · Only changed rows are uploaded.**
- The first version re-uploaded every bank every hour, about 9.5 MB to Tokyo.
- Now only changed banks send their full row, and unchanged banks get a one-line fetch-time update.

**D3.4 · The saved copy is looked up as soon as there is no memory copy.**
- The first measurement showed the cost of waiting: a cold Uttar Pradesh search took 10.4 s, 8 s of give-up plus a 2.4 s database read.
- Looking it up straight away costs at most one small query per state every 5 minutes, and brought the same search to 8.0 s.

**D3.5 · One live call per key at a time.**
- In the same measurement, a second request started its own 12-second Uttar Pradesh call while the first was still running.
- Concurrent searches now share the call in flight. The second request finished in 4.4 s, and eRaktKosh gets fewer calls.

**D3.6 · A shorter wait once eRaktKosh is known to be slow.**
- The slow drill showed a location search waiting twice, first for `nearest` and then for stock: 16 s.
- When `nearest` already came back degraded, the stock lookups now give up after 3 s. The same drill dropped to 11 s.

**D3.7 · The failure switch works in a local production build too.**
- Your own `next dev` server was running on port 3000, and Next 16 allows only one dev server per folder.
- Rather than stop it, the drill used a production build on port 3125 with a second, explicit flag, `ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1`.

**D3.8 · What was deliberately left for deployment.**
- Saving after live searches with Next's `after()`.
- A login for the ingest role, with an `INGEST_DB_URL`.
- Logging the app's own eRaktKosh calls.
- A server-side scheduler. Done on 3 November: Supabase `pg_cron` plus an Edge Function, every 4.5 hours ([below](#collection-moved-to-supabase-3-november)).

  The request asked for collection only, not a deployment-ready system.

### Steps taken

1. Phase 0 survey of all 36 states plus the nationwide directory (table above).
2. **Fixed group-label matching.** Added `GROUP_NAMES`, `normalizeGroupName`, `DORMANT_DAYS` and `isDormant` to `src/lib/stock.js`.
3. **Added `src/lib/stockQuality.js`.** Run over the full sweep, it reported:

   | Rows | Labels renamed | Unit counts dropped | Duplicates | Future dates | Dormant banks |
   |---|---|---|---|---|---|
   | 4,707 in, 4,707 out | 1,694 | 30 | 0 | 0 | 297 (6.3%) |

4. **Rebuilt `src/lib/eraktkosh.js`** around `createEraktkoshClient`:
   - the cache, circuit, retry, give-up, shared live calls, validation, saved fallback and simulator;
   - `summarizeFreshness`.
5. **Added `src/lib/stockStore.js`** (saved-copy reads with the publishable key) and **`src/lib/geo.js`** (`haversineMeters`, `isInIndia`).
6. **Added migration `20261023000200_stock_store.sql` and applied it** to the live project with `npm run db:migrate`.
7. **Added `scripts/snapshot.mjs`** and the npm script `snapshot`.
   - The first directory run saved 4,328 banks: 3,720 `ok`, 606 `shared` and 2 `outside_india`.
   - The first full sweep saved 36 of 36 states, 4,702 banks, in 3 min 29 s, and wrote a 1.26 MB baseline to `../blood_data/eraktkosh/history/`.
8. **Routes.**
   - `/api/blood-search` returns `freshness`, plus `checkedAt` and `isDormant` on every bank. Dormant banks don't count towards the ring or the plan.
   - `/api/search` and `/api/nearest` send `X-Data-Source`, `X-Data-Fetched-At` and `X-Data-Upstream`.
9. **Search page:**
   - the freshness banner: yellow under 24 h, red when older;
   - "Bank updated 3 h ago · checked 12 min ago";
   - a red "Not updated for 30+ days" badge;
   - named failed states;
   - a Retry button.
10. **Admin overview:** an "eRaktKosh data collection, last 24 hours" card from `upstream_stats`, showing the worst-served states first.
11. **Added `scripts/measure-search.mjs`** and the npm script `measure`.
12. **Scheduled the collection with Windows Task Scheduler:**
    - `\bloodLink\Stock snapshot (hourly)`, every hour from 20:05;
    - `\bloodLink\Directory snapshot and prune (weekly)`, Mondays at 03:35.

    Both logged to `../blood_data/eraktkosh/collector.log`. They were disabled on 3 November, when collection moved to Supabase ([below](#collection-moved-to-supabase-3-november)).

    **The first scheduled runs.**
    - **20:05 and 22:05:** each saved Andaman and Nicobar, then stopped with exit code 0xC000013A, a console Ctrl+C or close signal. No sleep, shutdown or error was logged near either time.
    - **21:05:** the run between them saved 36 of 36 states.
    - **Fixes tried:**
      - Hiding the window, through `powershell -WindowStyle Hidden`, was not enough: 22:05 failed with it.
      - Running outside the logged-in session (S4U) needs administrator rights.
    - **The fix in place:** both tasks run `../blood_data/scripts/run_collector.ps1`, which starts Node **in its own hidden console** (`Start-Process -WindowStyle Hidden`), so a signal reaching the launcher can't reach the sweep.
      - Node writes its own log through the new `--log` option.
      - It records any Ctrl+C, Ctrl+Break, close or termination signal with the time, and carries on after Ctrl+C. The next failure, if any, will name its cause.
      - **23:05, the first scheduled run with it:** 36 of 36 states saved in 2 min 30 s, with no signal logged.
    - **Data loss is negligible.**
      - Each state is saved in its own transaction.
      - History is event-based, so a missed hour loses a bank's update only if that bank updated twice within the gap; banks update about once a day.
      - The next sweep picks up every change.
13. **Tests:** `tests/eraktkosh-client.test.js` (14 tests) and `tests/stock-quality.test.js` (10 tests), plus a dormant scenario in `tests/ranking.test.js`. That made 94 tests. The fixes on 24 October added 24 more, for 118 (`docs/data_integrity.md`), and the review fixes on 26 October 7 more, for **125**.

### Results

**Security**, checked with the publishable key against the Data API:
- Anonymous visitors can read `blood_banks` (4,328 rows), `bank_stock_latest` and `stock_history` (4,707 rows).
- Reading `upstream_calls` or `upstream_stats` gives 42501.
- Insert, update and `prune_stock_store` all give 42501.

**Response times**, production build on this machine, eRaktKosh live (`npm run measure`):

| Scenario | First request after start | Then: median, 95th percentile (10 runs) | 20 users at once: median, 95th percentile (100 requests) |
|---|---|---|---|
| Region, Goa (5 banks) | 368 ms, live | 4 ms, 5 ms | 17 ms, 30 ms |
| Region, Uttar Pradesh (678 banks) | 8,038 ms, saved copy (eRaktKosh took about 12 s) | 13 ms, 4,387 ms (one request joined the call in flight) | 77 ms, 143 ms |
| Location, Mumbai, red cells | 1,429 ms, live | 4 ms, 8 ms | 21 ms, 40 ms |
| Ranked, Mumbai, O- × 3, critical | 541 ms | 2 ms, 4 ms | 17 ms, 33 ms |
| Ranked, rural Barmer, O+ × 2, urgent | 690 ms, live | 2 ms, 5 ms | 15 ms, 28 ms |

No request failed, out of 560 (55 sequential and 505 concurrent).

**Failure drill**, each mode on a fresh server (`ERAKTKOSH_SIMULATE`). Every search answered with HTTP 200 and results.

| Mode | First round: time, source | Second round | What the user sees |
|---|---|---|---|
| **down** | 0.35 to 4.6 s, saved copy. The Mumbai ranked plan still covers 3 of 3. | 0.35 to 1.0 s, saved (the circuit is open) | Yellow banner: "eRaktKosh isn't responding, so this shows stock bloodLink saved 40 min ago" |
| **slow** (+12 s per call) | Region 8.0 s, location 11.0 s, ranked 9.3 s, saved copy (degraded) | 5 ms to 3.6 s, refreshed cache | Yellow banner: "eRaktKosh is slow right now, so this shows stock bloodLink saved…" |
| **flaky** (half of calls fail) | 0.3 to 1.7 s, live: the retry hid every failure. Uttar Pradesh 8.0 s, saved. | Cache or live | No banner, except for the saved Uttar Pradesh copy |
| **Maharashtra blocked** (`ERAKTKOSH_SIMULATE_STATES=27`) | Goa live 0.29 s. Mumbai 1.2 s and 0.3 s, Maharashtra from the saved copy. | Same | Yellow banner for the saved copy. With no saved copy, the state is named: "Couldn't check Maharashtra" (unit test). |

**Re-run on 24 October** (`docs/data_integrity.md`, API failures). This drill missed two faults, both since fixed:
- **#37:** with eRaktKosh down, the saved copy could count the wrong component. A plasma-only bank ranked first for red cells.
- **#38:** the Maharashtra row passed only because each Mumbai search also fetched Tamil Nadu. That success reset a circuit shared by every state. Each state now has its own circuit.

After the fixes, every mode answered again, and with Maharashtra blocked, Goa, Tamil Nadu and Gujarat all stayed live.

**Data store size** after the first sweep:
- `bank_stock_latest` 4.4 MB;
- `blood_banks` 1.4 MB;
- `stock_history` 2.0 MB;
- the whole database 19 MB of the 500 MB free tier.

### Data quality write-up (reviewer point 3)

`docs/data_integrity.md` checks each item below again, with the 24 October counts.

- **Standardised.**
  - Group labels go to 10 canonical names: 1,694 entries renamed.
  - Names and addresses are trimmed.
  - Update times are parsed as India time and stored as UTC.
  - Components are compacted to their short codes in the history.
- **Validated.**
  - Implausible unit counts are dropped: 30 entries over 2,000, up to 15,280.
  - Future update times are treated as unknown: none found.
  - Directory coordinates are checked against state outlines. On 24 October, 206 banks lay outside their own state and 2 outside India. They are flagged `wrong_state` and `outside_india`, and location search leaves them out (#36).
  - 518 more banks share a point with another bank and are flagged `shared`.
- **De-duplicated.**
  - Within a response, the newer row wins: no duplicates found in 4,707.
  - Across sweeps, history is unique on (bank, update time).
  - Matching against other datasets is point 3.2.
- **Refreshed.** Stock every 4.5 hours in Supabase since 3 November, hourly from the laptop before, and the directory weekly. History is kept 60 days in the database and for good in the Storage archive, with a weekly copy on the laptop.
- **Stale data, two ages.**
  - Every bank shows when the bank updated its stock and when bloodLink checked it.
  - 6.3% of banks, those not updated for 30 days, are dormant: listed with a red badge, kept out of the ring growth and the plan, and scored 0 for freshness.
- **API failures.** The drill table above shows the fallback chain working for each case.

### Findings to fix later (added to CLAUDE.md as #33 to #35)

- **#33: 679 stocked banks (14%) have no coordinates in eRaktKosh's `nearest`.** Location search can't see them. Point 3.2 looks for their locations in other datasets.
- **#34: eRaktKosh coordinates are unreliable for 726 banks** (counted on 24 October). 206 sit outside their own state, 2 outside India, and 518 share points with other banks. Location search leaves out the first two kinds, and distances to the third may be off by a few km.
- **#35: collection runs only while this machine is on and logged in.** The history will have gaps. Moving the scheduler to a server is deployment work. **Done on 3 November** (below).

### Collection moved to Supabase (3 November)

On 3 November collection moved off the laptop into the Supabase project, which closes #35. This records the plan that was carried out, `docs/PLANS/supabase_scheduler.md`. It was approved on 23 October, with all seven decisions answered that day, and was folded in here once done; the migration's header still names it. How to run, change and roll back the collector is in `CLAUDE.md`, and every function is in `docs/CODE_REFERENCE.md`.

#### Why

- **The laptop was the weak point.** The hourly task ran only while the laptop was on and signed in, about 6 hours in 10, and two of its first four runs died after one state. Every hour it was off left a gap in the history the forecast learns from.
- **Supabase runs it in the project the data already lives in:** `pg_cron` fires on schedule, `pg_net` calls an Edge Function, and the function does what the laptop did. No new account or machine is needed, and the code is in the repository.
- **What stayed the same:** the app and its search code; the stock tables, the `bloodlink_ingest` role and the validation in `src/lib/stockQuality.js`; the directory's state-outline check (#36); and one call per state, one second apart.

#### How it works

```
pg_cron, every 30 min                          Edge Function collect-stock, pinned to ap-south-1
collector_tick(n) asks "is batch n due?"
+0 min batch 1 ─┐ (a sweep is due 4.5 h after the last one began)
+2 min batch 2 ─┤ net.http_post ──► /functions/v1/collect-stock { batch: n, sweep }
+4 min batch 3 ─┤   + x-region, x-collector-secret     │
+6 min batch 4 ─┘                                       ├─► eRaktKosh, 9 states, 1 s apart
Mon 03:20 directory + prune ──► { directory: true,      ├─► Postgres as bloodlink_ingest (the same tables as before)
                                    prune: true }        ├─► Storage: changed rows → stock-archive/history/YYYY-MM-DD/HHMM-bN.ndjson.gz
                                                         │            batch summary → stock-archive/sweeps/YYYY-MM-DD/HHMM-bN.json
                                                         └─► collector_runs: one row per job
```

**Four batches, because a free-plan Edge Function may run for at most 150 s.** A full sweep is about 90 s of eRaktKosh time plus gaps and writes; the laptop's 23:05 sweep on 23 October took 150 s in all. The states are split by their measured time (call + 1 s gap + about 0.6 s of writes), which leaves about four times the headroom:

| Batch | Starts | Estimated time | States |
|---|---|---|---|
| 1 | sweep start | 37 s | Uttar Pradesh, Kerala, Madhya Pradesh, Delhi, Uttarakhand, Puducherry, Nagaland, Goa, Lakshadweep |
| 2 | +2 min | 36 s | Andhra Pradesh, Telangana, Haryana, West Bengal, Jharkhand, Arunachal Pradesh, Meghalaya, Mizoram, Ladakh |
| 3 | +4 min | 36 s | Maharashtra, Rajasthan, Gujarat, Bihar, Assam, Himachal Pradesh, Andaman and Nicobar, Manipur, Dadra and Nagar Haveli and Daman and Diu |
| 4 | +6 min | 35 s | Karnataka, Tamil Nadu, Punjab, Chhattisgarh, Odisha, Jammu and Kashmir, Tripura, Sikkim, Chandigarh |

- **A time budget** keeps each batch inside 150 s: no state starts after 110 s, and no eRaktKosh call waits past 135 s. States it can't start are logged as skipped and fetched next sweep.
- **One collector, two runners.** `src/lib/collector.js` holds the logic: fetch a state, validate, compare update times, upsert changed rows, refresh fetch times, add history, log the call. The function and `scripts/snapshot.mjs` both call it with their own database, fetch and archive adapters, and both connect with `npm:pg`. The CLI's API deploy (`--use-api`) bundles `src/lib/` and both asset files from outside `supabase/`.
- **Least privilege, with one exception.** The function connects with the built-in `SUPABASE_DB_URL` and runs `set role bloodlink_ingest` first, as the laptop did, so no new password exists. The exception is the archive: Storage is written only through its API, so the function uses the built-in secret key (`SUPABASE_SECRET_KEYS`) for the `stock-archive` client and nothing else.
- **Nobody else can trigger it.** The function is deployed without JWT checks (`--no-verify-jwt`), as Supabase advises for calls from `pg_cron`, and requires an `x-collector-secret` header that matches its secret, compared in constant time. The cron jobs read the URL and the secret from Vault, so neither is in a migration or in git.
- **Never more often than hourly.** The function refuses (409) a job of the same kind and batch that started in the last 50 minutes, whichever runner ran it, so a wrong schedule or a leaked secret can't add sweeps.
- **The schedule.** Cron repeats at fixed clock times, so it can't say "every 4.5 hours" directly:
  - four jobs, one per batch, run a small SQL check every 30 minutes, at :05, :07, :09 and :11 and again at :35 to :41 India time (the same minutes in UTC). Nothing is sent unless a sweep is due.
  - `collector_due` decides and records the sweep, and `collector_post` sends it through `pg_net`, waiting up to 150 s (`pg_net`'s default is 5 s). Keeping them apart lets the check be tested without sending anything.
  - Batch 1 starts a sweep once the last one began 4 h 25 min ago or more; the 5 minutes absorb cron jitter. Batches 2 to 4 post only within 10 minutes of their own sweep's start, and once each.
  - A missed sweep (a paused project, say) starts at the next tick, and the rhythm continues from there.
  - `collector_weekly`, Monday 03:20 India time, between batch slots, saves the directory, runs the prune, and deletes `pg_cron`'s own run log older than 7 days (the ticks add about 190 rows a day).
  - `schedule_stock_collector(interval)` changes the interval with one SQL call and no redeploy, and refuses anything under 1 hour.
- **Monitoring.** `collector_runs` holds one row per job: a batch, the directory, the prune, or an upload of laptop history, with the runner (`edge` or `laptop`), times, states saved, failed and skipped, rows changed, and the archive file with its UTC day and line count. The admin overview shows the last sweep, in red once none has finished within the interval plus 2 hours.
- **The archive.** Each batch writes its changed rows, gzipped, to the private bucket `stock-archive` (no file when nothing changed), and a summary of about 2 KB either way; the weekly run writes the directory (about 0.4 MB). The laptop's history up to the cutover went up once as `history/YYYY-MM-DD.ndjson.gz` and `sweeps.ndjson.gz`, so the archive is complete from 23 October. Gzip shrinks history 6 to 8.6 times, so it grows about 5 MB a month and the free 1 GB lasts over 15 years.
- **The prune waits for the archive.** It deletes a day of `stock_history` only when the archived lines recorded for that UTC day cover every row the database holds for it; any other day is kept and listed in `history_days_kept`. No batch crosses UTC midnight, since the ticks fall at 5 to 11 and 35 to 41 minutes past the hour. Laptop runs don't count until `npm run archive:upload` puts their days in the bucket.
- **The laptop's copy.** `npm run archive:sync` downloads only the files the laptop lacks, in its own layout: a batch's file becomes `history/YYYY-MM-DD_HHMM-bN.ndjson`, and a sweep's four summaries become one line of `sweeps.ndjson`, so the history readers need no change. A weekly task runs it and catches up after the laptop was off.

#### How often: every 4.5 hours (decision 6)

Measured on 23 October unless marked:
- **Storage hardly depends on the interval.** History gains a row only when a bank's own update time changes (about 430 bytes with indexes, about 4,000 rows a day). Only `upstream_calls` grows with every sweep, 18 KB each. With the 60-day history and 90-day call-log prunes, the database levels off at 135 to 170 MB whatever the interval, of the free 500 MB.
- **Banks update in the morning.** 73% of the 4,184 banks that updated that week made their latest update between 07:00 and 11:59 India time, and under 8% between 19:00 and 05:59.
- **What a longer interval loses.** eRaktKosh gives each bank's exact update time, so a later sweep still records the right time. Lost are an update the bank overwrites before a sweep sees it, and the saved copy's freshness, at worst one interval old.

| Option | India times | Sweeps a day | Updates missed | Saved copy at worst | Database growth a day | Database size with pruning | Function calls a month |
|---|---|---|---|---|---|---|---|
| Hourly | :05 every hour | 24 | none (the baseline) | 1 h | 2.15 MB | 172 MB | 2,880 |
| Every 2 hours | 00:05, 02:05 … 22:05 | 12 | 2.5% | 2 h | 1.9 MB | 152 MB | 1,440 |
| Every 3 hours | 00:05, 03:05 … 21:05 | 8 | 3.7% | 3 h | 1.8 MB | 144 MB | 960 |
| **Every 4.5 hours (chosen)** | shifts by 4.5 h each sweep, repeating every 3 days | 5.3 | **4.9%** | 4.5 h | 1.75 MB | 138 MB | 640 |
| Morning-weighted | 06:05, 08:05, 10:05, 12:05, 15:05, 19:05, 23:05 | 7 | about 2% (modelled) | 2 h in the morning, 7 h overnight | 1.8 MB | 142 MB | 840 |
| Every 6 hours | 05:05, 11:05, 17:05, 23:05 | 4 | 5.7% | 6 h | 1.7 MB | 134 MB | 480 |
| Daily | 13:05 | 1 | about 25% (modelled) | 24 h | 1.3 MB | 109 MB | 120 |

- **"Updates missed"** is the share of the updates hourly sweeps saw that the schedule wouldn't, because the bank updated again first. It was measured on 3 November with `../blood_data/scripts/measure_schedule.py` (`../blood_data/measurements/schedule_miss_rate_2026-11-03.json`):
  - 148 hourly sweeps from 23 October to 3 November, in 45 runs of back-to-back sweeps; only 5 runs reached 8 sweeps or more.
  - Each schedule keeps every fourth and fifth sweep of a run, alternately for 4.5 hours, and is scored on the same 6,379 updates: those entered while a run was going and seen at least 6 sweeps before it ended. Updates first seen at a run's first sweep are left out, since some were made while the laptop was off.
  - Scored on its own wider sample, 4.5 hours misses 5.2%. Of its misses, 58% are values the bank replaced within 10 minutes (most likely corrections), 12% within an hour, 14% within 2 hours and 16% later.
  - The runs fall in the hours the laptop was on, mostly the day, when banks update most, so the figures lean high.
- **Why 4.5 hours.** It costs a fifth of the hourly calls, and its sweep times shift by 4.5 hours each sweep and repeat every 3 days, so over a cycle sweeps fall every 1.5 hours around the clock and no hour of the day goes unsampled. The forecast's dynamics are daily (24 to 72 h horizons, point 5), so it doesn't need stock within the hour. 4.9% sits at the 5% threshold set for the check, so it was reported before cutover, and the interval stayed at 4.5 hours. Every 3 hours was the runner-up; every 6 hours the longest interval worth defending.

#### Decisions (23 October)

| # | Decision | Answer |
|---|---|---|
| 1 | Change the live project: `pg_cron` and `pg_net`, one migration, one Edge Function, one Storage bucket and five cron jobs | Yes |
| 2 | Region | Mumbai (`ap-south-1`) if Phase 0 showed it worked, so eRaktKosh sees an Indian address. It did |
| 3 | Archive | Gzipped files in a Storage bucket, accepting the secret key the upload needs. Drawbacks below |
| 4 | The laptop's tasks | Disabled at cutover, deleted after a 24-hour watch, everything collected kept. `snapshot.mjs` and `run_collector.ps1` stay for runs by hand |
| 5 | CLI login | You run `npx supabase login` before anything starts |
| 6 | Interval | Every 4.5 hours |
| 7 | Local copy | A weekly Task Scheduler task runs `npm run archive:sync`, catching up after the laptop was off |

**Where the data lives.** Collection and storage happen entirely in the Supabase project; the laptop can stay off.

| Place | What it holds | Kept for |
|---|---|---|
| Supabase database | The latest stock per bank, which the app falls back to; the directory; `stock_history` | History 60 days, the call log 90 |
| Storage bucket `stock-archive` | Every change since 23 October, gzipped, the laptop's included; batch summaries; weekly directories | For good |
| Laptop, `../blood_data/eraktkosh/` | Everything up to the cutover, plus what the weekly sync downloads | Until deleted |

The free plan backs up neither cloud copy, and both sit in one project. If the project were deleted, paused and not restored within a year, or damaged by a bad migration, no other copy would exist except the laptop's. That is the laptop's only role now; collection never depends on it.

**The drawbacks of the Storage archive (decision 3).** Keeping all history in the database would be simpler, but it fills the free 500 MB in 7 to 9 months. The archive costs:
1. **A key with wide rights.** The upload uses the built-in secret key, which reaches every table and bucket, so a bug in the upload code could too. Database writes still go through `bloodlink_ingest`, and the key comes from the function's environment, never a file.
2. **No backup by Supabase,** hence the weekly sync.
3. **History in two places and two formats.** The last 60 days are in SQL; everything is in gzipped NDJSON, which pandas reads and SQL can't.
4. **The prune depends on the archive.** A failed upload keeps that day in the database until `npm run archive:upload -- --from-db <day>` archives it from the rows still there.
5. **Old files must stay readable.** Each archived line carries `"v": 1`; the laptop's older files count as version 1.

**Cost on the free plan: ₹0.**

| Item | Use per month | Free allowance |
|---|---|---|
| Edge Function calls | about 640 | 500,000 |
| `pg_cron` ticks | about 5,800 small SQL checks; the run log is trimmed weekly | included |
| Function time per call | about 35 s of 150 s | — |
| Database size | levels off at about 138 MB | 500 MB |
| Storage archive | about 5 MB a month | 1 GB |

**Risks that remain.**

| Risk | What happens | Mitigation |
|---|---|---|
| eRaktKosh blocks Supabase's addresses | No data from the cloud | Unlikely: it answered the function in Mumbai in Phase 0. Fallback: the same `collector.js` on a free always-on VM in Mumbai, or the laptop tasks again |
| A batch exceeds 150 s | That batch's remaining states are skipped | The time budget; they are fetched next sweep |
| The free project is paused for inactivity | Everything stops, the app too | Scheduled writes are reported to count as activity (a community answer, not official). The admin overview warns when a sweep is overdue |
| A `pg_net` call fails; it doesn't retry | One batch missed | `collector_runs` shows the gap, and history is event-based, so the next sweep catches up |
| The secret leaks | Extra eRaktKosh calls, still at most one per job in 50 minutes | It lives only in Vault and the function's secrets; re-running the setup rotates it |
| A database password change | Batches might fail | `SUPABASE_DB_URL` is a built-in secret and should follow it; check `collector_runs` after a change |

#### Steps taken

1. **Phase 1, the code, written on 3 November:** `src/lib/collector.js`, which `scripts/snapshot.mjs` now wraps (the laptop's 13:05 sweep that day ran on it, 36 of 36 states); the `collect-stock` and `collector-probe` functions, which pass `deno check`; the migration `20261103000100_cloud_collector.sql`; the setup, check, probe, upload and sync scripts; the admin overview's "last sweep" line; and 15 unit tests, for 150 in all. `scripts/check-cloud-collector.mjs` ran its 27 SQL checks on the Tokyo project inside a rolled-back transaction, and again on Mumbai once the migration was applied there.
2. **The move to Mumbai (#28) came first,** the same day, so the collector was built on the final project.
3. **Phase 0, before anything was scheduled** (`node scripts/probe-cloud-collector.mjs`, `../blood_data/measurements/collector_probe_2026-11-03.json`). A throwaway function, deleted afterwards, showed:
   - eRaktKosh answered it: Goa's 5 banks in 0.3 s, and Uttar Pradesh's 684 banks (1.4 MB) in 12 to 13 s, as from the laptop;
   - with `x-region: ap-south-1` it ran in Mumbai (`x-sb-edge-region`), and unpinned calls from the laptop landed there too;
   - parsing and validating Uttar Pradesh took 13 to 41 ms of the 2,000 ms of CPU allowed;
   - `npm:pg` connected with `SUPABASE_DB_URL` as given in 27 to 44 ms, with round trips of 0 to 2 ms, and `set role bloodlink_ingest` worked;
   - the deploy bundled `src/lib/` and both asset files: 4 batches, 36 states and 36 outlines.
4. **The setup** (`node scripts/setup-cloud-collector.mjs`): the secret in the function's secrets and in Vault with the URL, and `collect-stock` deployed. A smoke test without eRaktKosh calls:
   - called directly, the function refused a missing or wrong secret (401), a GET (405), and a batch of 9, an empty body or a batch with a prune (400);
   - a prune posted through Vault and `pg_net` ran in Mumbai, and was recorded as an `edge` run; a second one at once was refused (409).
5. **The interval was measured** on the laptop's hourly sweeps (above): 4.9% missed at 4.5 hours.
6. **The cutover, on 3 November:**
   - the laptop's 15:05 sweep, its last, saved 36 of 36 states. Both laptop tasks were then disabled, and their definitions saved in `../blood_data/scripts/tasks/`;
   - `npm run archive:upload` put all 12 laptop days, `sweeps.ndjson` and the 3 directory files into the bucket, and `--check` showed every day matching the database: 48,553 rows;
   - the weekly sync task, `\bloodLink\Archive sync (weekly)`, was registered with `../blood_data/scripts/register_sync_task.ps1` and run once through Task Scheduler, with result 0. Its launcher retries a failed sync twice, 15 minutes apart, since Task Scheduler's restart setting isn't documented to fire when a program merely exits with an error; the task's time limit is 2 hours to fit;
   - `schedule_stock_collector()` ran at 15:36, after the 15:35 tick, so the first cloud sweep began at 16:05, an hour after the laptop's last.
7. **Left:** the 24-hour watch (5 or 6 sweeps, each with four `collector_runs` rows of 9 states), then deleting the two laptop tasks; testing the sync's catch-up across a shutdown once; and checking the first weekly directory and prune, on Monday 9 November.

#### Results

**The first cloud sweep, 3 November at 16:05 India time** (sweep 4), checked end to end at 16:13:

| Batch | Ran (UTC) | States saved | Rows changed, all archived |
|---|---|---|---|
| 1 | 10:35:01 to 10:35:43 | 9 of 9 | 7 |
| 2 | 10:37:00 to 10:37:39 | 9 of 9 | 20 |
| 3 | 10:39:01 to 10:39:37 | 9 of 9 | 14 |
| 4 | 10:41:00 to 10:41:39 | 9 of 9 | 22 |

- The five cron jobs ran at their planned minutes, and the four batches were posted 2.0 minutes apart.
- Every `pg_net` call was answered with 200 from `ap-south-1`.
- eRaktKosh got 36 calls, one per state, all successful. The saved copy was refreshed for all 35 states that list banks; Lakshadweep lists none.
- Each batch took 36 to 42 s of the 150 s allowed, close to the 35 to 37 s estimated.
- Storage held the four history files and the four batch summaries.
- `npm run archive:sync` then brought the four files and one merged 36-state sweep line to the laptop. `validate_history.py` counted 48,616 history events, the 48,553 uploaded plus these 63, with no duplicates.

#### Sources

- [Edge Functions limits](https://supabase.com/docs/guides/functions/limits): free plan 150 s wall clock, 256 MB, 2 s CPU per request.
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), and [pg_cron in Supabase](https://supabase.com/docs/guides/database/extensions/pgcron): `pg_cron` with `pg_net`, secrets in Vault.
- [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets): `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEYS` are provided; `SUPABASE_SERVICE_ROLE_KEY` is legacy, and [the legacy keys are being retired](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
- [Regional invocations](https://supabase.com/docs/guides/functions/regional-invocation): `x-region`, and `x-sb-edge-region` in the answer.
- [Deploying without Docker, importing files outside `supabase/`](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory).
- [Database backups](https://supabase.com/docs/guides/platform/backups): Storage objects aren't included, and free projects aren't backed up.
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing): restorable for up to a year (`docs/verify_facts.md`, F13); a [community note](https://github.com/orgs/supabase/discussions/13121) that `pg_cron` activity counts.
- [Pricing](https://supabase.com/pricing): free plan 1 GB Storage, 5 GB egress a month.
- [Task Scheduler settings](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2008-r2-and-2008/cc722178(v=ws.11)): "Run task as soon as possible after a scheduled start is missed" runs a task missed while the computer was off, after a 10-minute wait.

---

## Point 3.2: re-collecting, validating and de-duplicating the data; other datasets

> *Request:* look into the downloaded eRaktKosh results in `rough_work/`, write and run code to call the API again, and look into data validation and duplicates. Search the web for other sources of similar data that could train the model in the slides: trends in a hospital's stock falling below a threshold, so donors and users can be told to donate before it does. Only find and validate data; don't build the model yet. Store it in `blood_data/`.

### What was already downloaded

| File | What it is | Source endpoint | Can it be refreshed? |
|---|---|---|---|
| `rough_work/district_data.json` (April 2026) | States, districts, blood groups, components and form lists | `POST /eraktkosh/master/all` with `{"hospitalCode":100}`, found in the portal's script | Yes. Re-fetched; see below |
| `rough_work/state_data.json` (April 2026) | Per state: blood collected, blood centres, registered donors, camps organised, upcoming camps | An old dashboard call that is no longer in the portal's script | No. Kept as a dated snapshot |
| `rough_work/info.txt` | Sample `blood-availability` and `nearest` rows, plus counts (4,457 nearest, 4,170 by state) | `blood-availability`, `nearest` | Yes. Re-collected in full in point 3.1 |
| `redundant_bloodlink/all_gov_data.json` | data.gov.in "Blood Bank Directory": 2,823 banks with coordinates, licence dates and service hours | data.gov.in API (a key is needed, #19) | Not without a key of our own. Used as it is |
| `redundant_bloodlink/village_data.json` | Maharashtra's village directory (LGD codes) | data.gov.in | Not relevant to blood stock. Not used |

### eRaktKosh calls found in the portal's own script

The public portal's bundled script (`static/js/main.09cdccc7.js`, 4.5 MB) lists every call it makes.

| Public, no login | Behind a blood-bank login (an SSO ticket) |
|---|---|
| `blood-availability`, `bloodbank/nearest`, `bloodbanks` | `MonthlyCollection/bloodStockComponentWise` |
| **`camps/details?stateCode&districtCode&startDate&endDate`**: donation camps, past and future | `MonthlyCollection/componentWiseISsueCollection` (units issued per component per month) |
| `camps/hospitalCode`: one bank's camps | `MonthlyCollection/MonthlyData`, `getmonthlyreport` |
| `master/all` (POST) | |
| **`master/portal-refresh-hospitals`**: 452 bank codes with automatic stock refresh | |

The login-only monthly endpoints hold exactly what a demand model needs: units issued per component per month, per bank. They are not used here. Getting that data properly means an access request to NBTC or MoHFW, recorded as a recommendation in point 5.

### Plan

1. **Create `blood_data/`**:
   - one folder per source;
   - scripts in their own `blood_data/scripts/` folder, apart from the downloaded data;
   - a catalogue in `blood_data/README.md`: source, licence, date, fields, validation results and use.
2. **Archive the April downloads with dates.** Re-fetch what can be refreshed (`master/all`, `portal-refresh-hospitals`) and compare.
3. **Collect 12 months of donation camps** for all 36 states, a quarter per call, 1 second apart. Drop personal fields (organiser name, phone) before saving.
4. **Validate each dataset:** schema, missing values, ranges, duplicate keys and date coverage. Write a JSON quality report per source.
5. **De-duplicate across sources:**
   - match the data.gov.in directory against eRaktKosh's directory by distance (under 300 m) plus name similarity;
   - find likely duplicate codes inside eRaktKosh (same point, similar name);
   - try to place the 679 coordinate-less banks (#33) through name and district matches.
6. **Find and download other datasets** that are open and relevant, and validate them the same way:
   - Malaysia's daily donations by blood group, national and by state (CC BY 4.0);
   - the UCI donor-return data (CC BY 4.0);
   - NCVBDC state-wise dengue cases, a seasonal driver of platelet demand.
7. **Record what the data can and cannot support.** This sets up point 5.

### Decisions

**D3.2.1 · Keep personal data out.**
- Camp records carry organiser names and phone numbers. Only the camp id, date, time, organising bank, district, state, type and registration flag are stored.
- That keeps to data minimisation under India's Digital Personal Data Protection Act. A model needs when and where camps happen, not who ran them.

**D3.2.2 · Match names on distinctive words, not whole names.**
- The first matcher paired "Sadar Hospital Ara" with "Sadar Hospital Nawada", and "General Hospital Mahuva" with "General Hospital Ahwa".
- Removing generic words ("Hospital", "Charitable", "District" and so on) and place names left the words that actually identify a bank.
- After that change, every sampled match and placement checked out by eye.
- Precision is preferred over recall: a wrong match would put a bank in the wrong place on the map.

**D3.2.3 · Refresh the app's district lookup.**
- `bloodlink/assets/district_data.json` was byte-identical to the April download. Since then eRaktKosh added 3 districts, dropped a duplicate Majuli entry (code 746; Majuli is still listed as 713) and renamed 2.
- The re-fetched `master/all` is the same source, so it replaced the app's copy, and all 94 tests still pass.
- Without it, a search in Polavaram or Markapuram would have been rejected as an unknown district.

**D3.2.4 · Collect 12 months of camps, not all of them.** Records go back to 2023, but they were sparse then: 130 in January 2023 against 858 in January 2025 for Maharashtra. Twelve months shows a full seasonal cycle at a third of the download.

**D3.2.5 · Ignore or postpone some sources.**
- **The village directory** is not about blood.
- **Locked or paid sources:** eRaktKosh's login-only monthly reports, Indiastat (paid) and Kaggle (login).
- **Other national blood services:** NHSBT, Lifeblood and Hong Kong publish no historical stock levels.

### Steps taken

1. Created `blood_data/` with a folder per source, the scripts kept apart, and the catalogue `blood_data/README.md`.
2. Archived the April downloads with their dates, plus today's raw state sweep and directory.
3. Read the eRaktKosh portal's script to list every call it makes. That found the camp, master and auto-refresh calls, and showed that the monthly stock and issue reports need a login.
4. Re-fetched `master/all` and `portal-refresh-hospitals`.
5. Downloaded 80,757 camps (`scripts/fetch_camps.py`), and the Malaysian, UCI and NCVBDC data.
6. Validated everything:
   - `scripts/validate_eraktkosh.py`, `validate_camps.py`, `validate_external.py` and `validate_history.py`;
   - reports in `blood_data/quality/`;
   - matches in `blood_data/crosswalk/`.

### Results

| Dataset | Size | Validation summary | Use for the forecast |
|---|---|---|---|
| **eRaktKosh stock, our hourly collection** | 4,707 banks, growing hourly | No duplicates. 1,694 labels normalised, 30 implausible counts dropped. Median age 9.7 h at 18:30 (it depends on the hour); 6.3% dormant | The target: units per bank, component and group over time |
| **eRaktKosh auto-refresh banks** | 452 codes, 412 with stock | **Median stock age 0.3 h, against 9.7 h for the rest**, at 18:30 on 23 October, minutes after a refresh batch. At 10:47 the next morning it was 4.6 h against 3.2 h: they refresh in batches at fixed times | Regularly refreshed series. Check against the history whether they are the best ones to model first |
| **eRaktKosh camps** | 80,757, Oct 2025 to Nov 2026 | No duplicate ids. 78.9% linked to a bank. Peaks in September (12,192) and June; low in February; Sunday 24% | Supply events per bank; seasonality |
| eRaktKosh directory | 4,328 banks | 2 outside India, 606 on shared points, 6 possible duplicate code pairs, 679 stocked banks without coordinates | Location, and the benchmark dataset (reviewer point 2) |
| data.gov.in directory | 2,823 banks | 33 duplicates, 372 at (0, 0), 14 outside India, licence dates up to "2105". 34.5% match eRaktKosh | Licence and service-hour attributes; placed 15 coordinate-less banks |
| **Malaysia MoH donations** | 20 years daily, national and 13 states | No missing days, no duplicates. Groups sum to "all" on 96–100% of days. Weekly cycle: Sunday ×1.71, Friday ×0.63 | A long series for choosing and testing forecasting methods |
| UCI donor return | 748 donors | **29% exact duplicate rows**; "Monetary" = 250 × "Frequency" | A donor-response model: whom to notify |
| NCVBDC dengue | 36 states × 2021–2026 | State sums match the totals exactly. West Bengal 2025 not reported | A yearly platelet-demand driver by state |

**What the first snapshot says about thresholds.** Among the 3,698 banks holding red cells, the share at or below 5 units is:

| Group | O+ | B+ | A+ | AB+ | B- | O- | A- | AB- |
|---|---|---|---|---|---|---|---|---|
| At or below 5 units | 19.5% | 19.9% | 31.6% | 53.8% | 85.8% | 86.6% | 91.6% | 98.0% |

A fixed threshold would flag almost every negative-group stock all the time. The forecast target has to be relative to each bank and group, such as days of supply or the bank's own usual level. This shapes point 5.

**First history check, 2026-10-23 at 22:50**, two full sweeps (18:53 and 21:05), `quality/history.json`. This is an early sample and will firm up as sweeps accumulate.
- **Events:** 4,731 update events, no duplicates, no state failed in any completed sweep.
- **Few evening changes, genuinely:** only 23 banks changed between 18:53 and 21:05.
  - Spot-checked against eRaktKosh directly: five auto-refresh banks in Tamil Nadu all carried 18:14:07 to 18:14:10 and had not changed by 22:47.
  - **Auto-refresh banks are updated in batches, not continuously.** The hourly history will show when those batches run.
- **First 24 repeat updates:**
  - The median gap between a bank's updates is **24.2 h** (10th percentile 6 h, 90th percentile 33.6 h), consistent with banks updating about once a day.
  - Red-cell stock changes by a median of **-1 unit** per update (10th percentile -14, 90th percentile +1). Most updates record units used.
- **For point 5:** daily rather than hourly dynamics are what the model must learn, and 24 to 72 h horizons match the update rhythm.

### What changed for the open issues

- **#33 (679 banks without coordinates):** 15 placed confidently from data.gov.in (`crosswalk/coordinates_for_unlocated_banks.csv`), not yet applied to `blood_banks`. The rest are mostly storage units, or banks newer than the data.gov.in list. Next options:
  - eRaktKosh's own `bloodbanks?stateCode=` call;
  - geocoding addresses with Nominatim (one request a second).
- **#34 (unreliable coordinates):** add the 6 possible duplicate code pairs to review. Since 24 October, the 206 wrong-state banks are flagged and left out of location search until they are re-placed the same way as #33.

**Sources:**
- [Malaysia: Daily Blood Donations by Blood Group](https://data.gov.my/data-catalogue/blood_donations) (CC BY 4.0).
- [UCI Blood Transfusion Service Center](https://archive.ics.uci.edu/dataset/176/blood+transfusion+service+center).
- [NCVBDC dengue cases and deaths 2021–2026](https://ncvbdc.mohfw.gov.in/Doc/Dengue-Cases-deaths-2021-2026-till-April.pdf).
- [Canadian Blood Services, inventory best practices](https://professionaleducation.blood.ca/en/transfusion/best-practices/blood-utilization-best-practices/blood-system-inventory-management-best).
- NHS Blood and Transplant's 2022 amber alert, as reported by [ITV](https://itv.com/news/2022-10-12/nhs-issues-first-ever-amber-alert-as-blood-stocks-fall).
- Lifeblood's [Blood Supply Update](https://www.lifeblood.com.au/news-and-stories/media-centre/media-releases/blood-alert-new-system-allows-people-track-blood-supplies-6500-donors).
- [IIETA GRU blood donation study](https://www.iieta.org/download/file/fid/174570).
- [MDPI blood supply forecasting](https://www.mdpi.com/2078-2489/14/1/31).
- [arXiv red-cell demand forecasting](https://arxiv.org/pdf/2008.07486).

---

## Point 4: how testing and performance measurement are done

> *Request:* include a section on how testing can be done, as in point 4 of the suggestions. The reviewer asked for measurable results covering functional testing, search and API response time, load testing, notification performance and failure scenarios.

### Plan

1. **Lay out the test levels:** unit, integration, end-to-end, security, performance and failure. For each, say what exists today, how to run it, and what to add.
2. **Measure what can be measured now,** so the section has numbers rather than only methods:
   - response time and load: done in 3.1;
   - the failure drill: done in 3.1;
   - **a geospatial benchmark** (new, the reviewer's point 2): linear scan, the ring search, a grid, a k-d tree, an R-tree and PostGIS GiST, at 4,328 real banks and synthetic sets up to 500,000. It measures time, candidates evaluated and build cost, and checks that every method returns the same banks;
   - **ranking sensitivity** (new, the reviewer's point 1): change each weight by ±20% and measure how stable the top choice and the order stay.
3. **Define tests for parts not yet built:** notifications, and ETA accuracy against timed trips.

### Test levels

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

### Results

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

**Ranking sensitivity** (the reviewer's point 1), `scripts/ranking-sensitivity.mjs`:
- **Data:** 48 real candidate sets captured from the live search: 12 cities and towns plus rural Barmer; O+, O-, A+ and B+ red cells; 3 units; median 16 banks a set, up to 38.
- **Method:** for each urgency, each of the four weights moved by -20% and +20%, giving 384 re-rankings per urgency.

| Urgency | First choice unchanged | Mean Kendall's τ | Most sensitive weight |
|---|---|---|---|
| critical | **98%** | 0.976 | ETA: first choice unchanged in 96% |
| urgent | **98%** | 0.978 | ETA and surplus, 97% each |
| routine | **92%** | 0.978 | freshness, 88% |

- **Urgency changes the answer.** Critical and routine pick a different first bank in **13 of the 48 sets (27%)**.
- **So:** the ranking is stable to reasonable doubt about the exact weights, yet still responds to urgency. That is the property a weighted score should have.

### Tests to add for parts not built yet

**Notifications** (planned: in-app, then email, then SMS):

| Measure | How | Target |
|---|---|---|
| Time from request to delivery, per channel | Timestamps when queued, sent and delivered (provider webhook) | In-app under 2 s; SMS under 30 s at the 95th percentile |
| Throughput | Queue 10,000 messages against a fake provider, then the providers' test modes (MSG91 and Twilio test credentials) | 10,000 within 5 minutes |
| Failure handling | Make the provider return 500s or time out | Retried with back-off, never sent twice, failures logged |
| Correctness | Unit tests for who is told, using the compatibility and eligibility modules: only eligible donors, nobody already asked within the cooldown, opt-outs respected | 100% of the rules covered |

**ETA accuracy**, the calibration flagged in point 2. `docs/PLANS/plan_eta_comparison.md` now plans it in full: a rubric fixed before any results, timed trips as the truth, and Google's traffic-aware predictions as a reference for the week's pattern. In short:
- **Collect:** timed trips by car or taxi in each zone (metro, city, town, rural) at night, midday and the evening peak, plus Google's predictions for the same weekday and time through its Routes API.
- **Measure:** mean absolute error, mean percentage error and bias, by zone and hour, and whether each method picks the same first bank as the true times.
- **Adjust:** `ZONE_SCALE` and the town and rural free-flow speeds from the timed trips only, until the percentage error is under 25% everywhere. Google's numbers are used to score, never to tune (the plan's decision E10).
- **Save:** the trips go in `../blood_data/eta_calibration/` as a regression test.

**Forecast quality** is defined in point 5.

---

## Point 5: which ML approaches to compare

> *Request:* based on the data collected in point 3, suggest which ML models, approaches and strategies could work best. We are to compare two or three, or more, and present the findings before going ahead with the best one.

This also answers the reviewer's point 5: where AI/ML fits in BloodLink, what decision it improves, what goes in, what comes out, and how the matching and response engine uses it.

The shortlist, two low-fidelity checks and the subplan were added on 2026-10-26, and an early walk-forward dry run on 2026-11-03. The scripts are in `../rough_work/ML/`, outside git, with a README and a summary, `SUMMARY.md`.

### The problem, stated precisely

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

### What the collected data can support

| Need | Source (point 3) | Ready? |
|---|---|---|
| Stock over time, per bank, component and group | `stock_history`, plus `blood_data/eraktkosh/history/`, hourly since 2026-10-23 | **Growing.** Weekly patterns need about 8 weeks, and festivals need a year. The 412 auto-refresh banks are refreshed in batches at fixed times, which may make them the cleanest series; the history will show. |
| Supply events | 80,757 camps, 78.9% linked to a bank | Yes: a year of history, with September and June peaks |
| Calendar effects | Malaysia's 20-year series as a proxy: weekday explains 65% of daily variation; the Hari Raya week drops to 36–55% | Method yes. India's own effects (Diwali, Holi, Eid, exams, summer) need an Indian holiday calendar, easy to add |
| Demand drivers | NCVBDC dengue by state and year; monsoon season (rain and seasonal factors already exist in point 2's model) | Yearly only; monthly would need IDSP weekly reports |
| Bank attributes | Directory, data.gov.in crosswalk (licence, 24×7), type (blood bank or storage unit), auto-refresh flag | Yes |
| Donor response | UCI (748 donors: recency, frequency, time). bloodLink's own donor profiles later | Method yes; real data later |
| True demand (units issued) | eRaktKosh `MonthlyCollection/*` | **No: it needs a login.** Ask NBTC or MoHFW for access. It would raise every model's ceiling. |

### Findings that shape the choice

1. **Strong weekly and yearly cycles.** In Malaysia, autocorrelation is 0.69 at 7 days and 0.62 at 364 days but only 0.08 day to day. Sunday runs 1.71× the mean and Friday 0.63×. Any model must know the weekday and the festival calendar, and the camp data agrees (24% of camps on Sundays). Plain ARIMA without seasonal terms would miss this.
2. **Festivals move.** The deepest dip each year is the Hari Raya week, which falls on different dates every year (April 2023, April 2024, March–April 2025, March 2026). A month-of-year feature can't capture that; a holiday-calendar feature can.
3. **Rare groups are intermittent.** Negative groups are mostly 0 to 5 units at a bank, and 12% of Malaysian state-days have no AB donations at all. Models built for smooth series overreact here. Intermittent-demand methods, or direct classification of "will it run short?", suit them better.
4. **Thousands of short series, not a few long ones.** With 4,707 banks × up to 14 components × 8 groups and only weeks of history each, a single **global** model trained across all banks will beat one model per series. This was the clear lesson of the M5 forecasting competition, where global gradient-boosted trees won.
5. **Data comes in events, not on a clock.** A bank's stock changes only when the bank updates it. Hourly sweeps give the observation times; between updates the value carries forward. Features must say how stale the value is (the existing freshness score), or the model will trust old numbers.
6. **Supply shocks are known in advance.** Camps are registered close to their date, about 1 to 2 weeks ahead, so they help short horizons.

### Choosing the models

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

### Early results, at low fidelity

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

### An early walk-forward dry run (3 November)

A first run of the walk-forward test on bloodLink's own history, held early as a phase 5.2 dry run. **It decides nothing:** the backtest at about 8 weeks, in late December, does, with the decision rule applied once as written. The full tables are in `../rough_work/ML/SUMMARY.md` and `results/walk_forward_summary.md`; the script is `walk_forward_check.py`.

**The test.**
- **Data:** 10.8 days of the laptop's hourly collection, 23 October 13:26 to 3 November 07:37 UTC, fixed with `--until` so a rerun gives the same tables. 879,673 rows of a bank, group and forecast time with red cells in stock, at 3,638 banks, at 43 forecast times on the 6-hourly India-time grid of phase 5.1.
- **Gaps:** each bank's stock is rebuilt at the bank's own update times, not when the collector saw them, so a night the laptop was off loses only an update a later one in the same gap replaced. Of 8,161 drops to zero, 1.2% were refilled within 6 h, the kind a gap could hide.
- **Labels:** the rules under "The subplan" below, in full.
- **Split:** walk forward one India day at a time, with a purge. Models train on every forecast time whose outcome was known before the test day began; at 48 h that is 4 test days, 304,124 cases and 17,520 stock-outs (5.8%) at 3,561 banks. The hazard model trains on the latest days too, with open cases censored at the day's start.
- **Uncertainty:** 90% intervals from 1,000 resamples of whole banks, the same draws for every model. With too few test days to resample days, as the plan intends, the per-day spread is the larger uncertainty.
- **Five of the seven models ran.** ETS and SARIMA need two full weeks of daily values per series, about mid-November.

**At 48 h, the decision horizon:**

| Model | PR-AUC (90% interval) | Recall at precision 0.5 | False alerts per bank per week* | Brier |
|---|---|---|---|---|
| 1 · GBM classifier | **0.262** (0.246–0.278) | **0.047** | 2.44 | **0.0477** |
| 3 · Hazard model | 0.256 (0.241–0.272) | 0.029 | 2.31 | 0.0484 |
| 2 · Logistic regression | 0.254 (0.239–0.270) | 0.032 | 2.31 | 0.0485 |
| 4 · GBM quantiles | 0.236 (0.224–0.250) | 0.005 | 2.30 | 0.0488 |
| 7 · TSB | 0.120 (0.113–0.128) | 0 | 2.76 | 0.0664 |
| Baseline: rate at that many units | 0.183 (0.176–0.193) | 0 | 2.51 | 0.0496 |
| Baseline: days of supply | 0.121 (0.113–0.130) | 0 | 2.62 | — |
| Baseline: overall rate | 0.057 | 0 | — | 0.0543 |

\* At a cut-off that sends as many alerts as there are stock-outs. Counted at most once per bank, group and day.

- **The three simplest global models are close,** within 0.008, and about 40% above the best baseline. The GBM classifier leads on three of the four days; on 1 November logistic regression and the hazard model scored higher. The day-to-day spread, about 0.04, is wider than the gaps between them.
- **No model reaches precision 0.5 with useful recall,** as this section foresaw, so the decision rule falls back to PR-AUC.
- **Dry run of the rule: logistic regression.** The GBM classifier leads by 0.8 points, inside the 2-point margin, so the simpler model wins; it is 39% above the best baseline, past the 10% required. The Malaysia rehearsal's dry run picked the same model.
- **False alerts are the open problem:** about 2.3 per bank per week, against the limit of 1 set under "How the prediction feeds the engine".
- **24 h and 72 h.** At 24 h the GBM classifier is ahead on all 6 days and in every resample, by 1.5 points (0.183 against 0.168), still inside the margin. At 72 h, on 2 test days, the three are tied (0.312 to 0.316).
- **By group and bank type.** Rh− groups run out 3 to 5 times as often and are harder to predict: about 7 times their base rate for Rh+ groups and under 3 times for Rh−. Auto-refresh banks are much more predictable (0.40 against 0.23).
- **Units at t + 24 h and t + 48 h (output 2).** GBM quantiles beat "no change" on MASE by only 1 to 2%, short of the 10% margin, but cut pinball loss by 11 to 12%: the range is where the model adds something. TSB, which forecasts use but no refills, is worse than no change.
- **Cost:** 9 to 12 minutes for the whole test on the laptop, well under phase 5.2's hour.
- **Against the two checks of 26 October,** the pattern holds: the GBM classifier leads narrowly, logistic regression is close, and the rule picks the simpler one. The 24 h scores rose from about 0.11 to 0.17–0.18, since a week of history now shows each bank's recent use.

**What it can't say yet.** Two to six test days, with one more day enough to reorder the top three; no weekly or festival cycle (Diwali, on 8 November, will be the first); cut-offs chosen on test labels, as the metric is defined, where the app must set them in advance; and median warning times of 39 to 44 h for every model, so the lead-time bar of 24 h doesn't separate them.

**What follows from it.**
- **Kept as planned:** the backtest in late December, once; phase 5.1 built the way this script works (stock rebuilt at the banks' own update times, the cleared-page rule, the 6-hourly grid), so the laptop's gaps and the cloud's 4.5-hour sweeps give the same rows; ETS and SARIMA added from about mid-November and refitted weekly; TSB kept, as it costs nothing.
- **Suggested, waiting for approval** (listed in `docs/plans.md`):
  1. add recall at 1 false alert per bank per week to the decision rule, next to recall at precision 0.5. It has to be agreed before the December test weeks are collected, so the rule stays fixed in advance;
  2. refresh the camps download (180 eRaktKosh calls, one second apart), so that camps in the last and next 7 days can be inputs;
  3. report each group's PR-AUC with its lift over that group's base rate.

### How to compare them

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

### How the prediction feeds the engine

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

### Risks and limits, stated up front

- **Self-reported stock.** eRaktKosh stock is what banks type in; 6.3% haven't updated in 30 days. Dormant banks are excluded from training, and freshness is a feature.
- **Zeros that aren't stock-outs.** A bank that clears its page reads as running out of every group at once. The label rules (phase 5.1) leave these out, and the backtest reports the result both ways.
- **No true demand yet.** Unit decreases mix issues with corrections and expiry. The monthly issue reports would fix that (access request).
- **Gaps in collection.** Until 3 November the laptop collected only while it was on (#35); since then the cloud sweeps every 4.5 hours, around the clock. Stock is rebuilt at the banks' own update times, so a gap loses only an update that a later one replaced, and missing hours are never filled in silently.
- **Donor fatigue and fairness.** False alarms cost donor goodwill, which is why the false-alert rate is a selection metric, not an afterthought.
- **Medical safety.** The forecast decides whom to ask to donate, never what a patient receives. Blood banks still do all screening and cross-matching.

### The subplan, with dates

| Phase | When | Work | Done when |
|---|---|---|---|
| **5.0 · Choose and rehearse** | 26 October 2026: **done** | The criteria, the longlist and the seven models; the Malaysia rehearsal and the plumbing test, in `../rough_work/ML/` | This section |
| **5.1 · Labels and features** | November 2026 | Build the dataset from `stock_history`, or the local archive: every bank × component × group at 00:00, 06:00, 12:00 and 18:00 India time, carrying the last value forward. This grid gives the same rows from the laptop's hourly sweeps and the cloud's 4.5-hourly ones. Write down the label rules below. Add the features: stock now and its recent decreases, days of supply, the bank's update rhythm and freshness, weekday and hour, the Indian holiday calendar, camps in the last and next 7 days, Open-Meteo rain, bank type, auto-refresh and state | One script rebuilds the same dataset from the raw history, identically each time, and unit tests pin the label rules |
| **5.2 · Dry runs of the harness** | Every 2 weeks from mid-November; a first one on 3 November ([above](#an-early-walk-forward-dry-run-3-november)) | Run the baselines and all seven models through the walk-forward harness on the history so far. Check only that it runs and the numbers are sane, not which model leads | The harness runs end to end in under an hour on the laptop |
| **5.3 · The backtest** | Late December 2026, at about 8 weeks | Run it once and apply the decision rule as written | A table per metric with intervals, the chosen model and example banks, presented to the panel |
| **5.4 · Scoring and shadow mode** | January 2027 | The chosen model scores every series after each sweep, and the probabilities are stored with the model's version. Ranked search reads them behind a flag. Donor alerts are logged, not sent, for 2 weeks | Calibration and false alerts per bank per week measured on live data |
| **5.5 · Later** | 2027 | Retrain monthly and watch for calibration drift. Output 1b once daily use is reliable. The LSTM, TFT and a pretrained model once 6 to 12 months exist. Model R once notifications collect responses | — |

**Label rules (phase 5.1), fixed before the backtest:**
- **Stock-out:** the units of that component and group reach zero within (t, t + H], given more than zero at t. Cases already at zero at t aren't scored.
- **A whole component cleared at once:** when every group of a component falls from 10 or more units in total to zero in one update, the bank is treated as not reporting, and the case is left out. Using that much of every group between two updates is far less likely than a cleared page. A small bank using its last few units still counts as a stock-out.
- **Quick refills still count.** A zero refilled within hours was real for anyone who arrived then. Their share is reported.
- **Dormant banks,** with no update in 30 days (point 3.1), are left out.
- **Censoring:** a case whose window runs past the end of the data, or into a collection gap (#35), is dropped for that horizon. The hazard model keeps it up to the gap.

---

## Reviewer suggestions, one by one

Each suggestion in `documentation/suggested changes after sem 7 report 1.txt`, with the answer, the evidence and its status.

| # | Reviewer asked for | Answer | Evidence | Status |
|---|---|---|---|---|
| 1 | A defined, validated ranking algorithm: compatibility, distance, ETA, reliability; scoring and weights explained with examples or test scenarios | Four scores (ETA, coverage, surplus, freshness) with urgency weights; exact blood group only; spare stock rewarded most when critical; ETA from road routes and traffic | Point 1 (D1.1 to D1.5, worked example 59.8 against 56.9); point 4 sensitivity (first choice unchanged in 92–98% of ±20% weight changes, τ ≈ 0.98); 20 unit tests | **Completed** |
| 2 | Benchmark Haversine, the expanding rings and spatial indexing at different dataset sizes: time, candidates evaluated, scalability | Linear, rings, grid, k-d tree, R-tree and PostGIS GiST, from 4,328 to 500,000 points | Point 4 tables. Linear is about 0.1 ms today; indexes are 75 to 300× faster at 100,000+ points. PostGIS column and index added | **Completed.** Using the index for donor search is **Planned** |
| 3 | Data standardisation, validation, de-duplication and refresh for the ~4,487 records; stale data and API failures demonstrated; other datasets | Validator (labels, ranges, dates, duplicates), collection (hourly, then every 4.5 hours in Supabase), saved fallback, two ages per bank, dormant banks, failure drill; cross-source matching; 6 other datasets found and validated, plus state outlines to check coordinates | Point 3.1 (Phase 0 survey, drill table), point 3.2 (`blood_data/`, quality reports, crosswalk), `docs/data_integrity.md` (independent re-check; coordinates checked against state outlines; six faults fixed) | **Completed.** Placing the 679 unlocated banks (#33) and re-placing the 206 in the wrong state (#34) are **In progress** |
| 4 | Measurable results: functional tests, response time, load, notification performance, failure scenarios | Test-level plan with numbers: 125 unit tests; response times; 20 concurrent users; failure drill; benchmark | Point 4 and point 3.1 tables; `blood_data/measurements/` | **Completed** for everything built. Integration and end-to-end suites and CI (#20) are **Planned**; notification tests are **Planned** with the feature |
| 5 | Where AI/ML fits, what it improves, inputs, outputs, and how the engine uses it | The probability of a stock-out within 24–72 h per bank × component × group, lowering the bank's ranking score and starting donor alerts. Seven models shortlisted against five baselines, for a walk-forward backtest with a decision rule fixed in advance | Point 5: criteria, longlist, shortlist and subplan; a rehearsal on Malaysia, a plumbing test and an early walk-forward dry run on bloodLink's history (`../rough_work/ML/`) | **In progress.** Models chosen and rehearsed at low fidelity; the dry run of 3 November picks logistic regression, deciding nothing. Collected since 2026-10-23, every 4.5 hours in Supabase since 3 November, with the backtest due in late December 2026 |
| 6 | Clearly separate completed, in-progress and planned work | This table, plus the issue list in `CLAUDE.md` | — | **Completed** |

### Completed, in progress, planned: the whole system

| Status | Items |
|---|---|
| **Completed** | Region, location and ranked search. Exact-group ranking with the surplus score. OSRM routes with time-of-day, density, seasonal and rain-aware ETA. Response plan. eRaktKosh validation, circuit, retry, give-up and saved-copy fallback. Stock store, with collection every 4.5 hours in Supabase and history archived in Storage. Dormant banks. Freshness banners and two ages. Supabase Auth, profiles and donor eligibility. Organisation verification and admin tools. Collection-health card. PostGIS locations. State-boundary check on bank coordinates. 125 unit tests, measurements, failure drill, benchmark and sensitivity analysis. |
| **In progress** | Stock history accumulating, every 4.5 hours. The stock-out forecast: seven models shortlisted and rehearsed, an early walk-forward dry run done, and the backtest waiting for 8 weeks of history (point 5). Locating the 679 banks without coordinates (#33). Re-placing the 206 banks in the wrong state and reviewing duplicate codes (#34). |
| **Planned** | Stock-out forecasting in the app (point 5). Donor network: locations, requests, notifications. Hospital and blood-bank dashboards. Self-hosted OSRM, and ETA calibration from timed trips. Integration and end-to-end tests with CI (#20). Deployment: ingest login, `after()` saves. |

> **Status update, 26 October 2026 (later).** Consent, a privacy note and account deletion (#18) are now done, with security headers (#51) and a search pin rounded to about 110 m before it reaches any outside service (#52). Donor eligibility now follows NBTC's 2017 guidelines, checked against the official text (#24), and pages no longer wait on a profile query (#49). The database is moving from Tokyo to Mumbai (#28). There are 135 unit tests.

> **Status update, 3 November 2026.** The database moved from Tokyo to Mumbai (#28), and collection moved off the laptop to Supabase (#35, [point 3.1](#collection-moved-to-supabase-3-november)): `pg_cron` and an Edge Function sweep all 36 states every 4.5 hours, around the clock, through the same `bloodlink_ingest` role. Measured on the laptop's hourly sweeps, 4.5 hours misses 4.9% of the updates hourly sweeps see, most of them values replaced within 10 minutes. Every change is archived, gzipped, in Supabase Storage, including all the laptop collected since 23 October, and a weekly task keeps a copy on the laptop. An [early walk-forward dry run](#an-early-walk-forward-dry-run-3-november) of the forecast picks logistic regression, deciding nothing. There are 150 unit tests.

> The spatial-indexing ambiguity the reviewer pointed out is now resolved. Search uses eRaktKosh's own `nearest` call, or a linear scan over the saved directory when that is down. The benchmark shows that is right at 4,328 banks. A PostGIS GiST index exists on `blood_banks.location`, but search doesn't use it yet. It is planned for the donor network, where the benchmark shows it is needed.
