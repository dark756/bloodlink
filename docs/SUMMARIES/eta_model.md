# Summary: the ETA model (road routing and a time-aware ETA)

*As of 4 November 2026. How well it works is in [`eta_benchmark.md`](eta_benchmark.md). The code is `src/lib/trafficModel.js`, `src/lib/traffic.js`, `src/lib/routing.js` and `src/lib/weather.js`, with the profiles in `assets/traffic_profiles.json`.*

**What was asked** (report 3, point 2): "implement OSRM and make sure that ETA depends on time of day, population density, estimated rush-hour slowdowns, and whatever else is relevant". The ETA is also the largest part of a bank's ranking score, so the request is part of reviewer point 1's "ETA".

**The answer in brief.** Every bank's travel time is OSRM's road route, slowed to measured traffic:

**ETA = free-flow time × (1 + congestion / 100) × rain factor**

- **Free-flow time** is the slower of OSRM's driving time and the road distance at the zone's measured free-flow speed. OSRM assumes about 65 km/h through Mumbai, where TomTom measures 33.7 km/h with no congestion.
- **Congestion** comes from TomTom's Traffic Index 2025, for this weekday and hour in India time, times the month's seasonal factor.
- **The zone** picks the speed and the congestion profile:
  - one of TomTom's 10 Indian metros;
  - otherwise city, town or rural, by the banks within 15 km, scaled to the Indian average.
- **Rain** at the pin, from Open-Meteo: × 1.15 at 2.5 mm/h or more, × 1.3 at 7.6 mm/h or more.
- **If OSRM fails,** the straight line × 1.34 is used, with the same zone and conditions, and the bank is marked as an estimate.

The ETA benchmark calls this method **M3**, and the fallback **M1**. Against Google's predictions, M3 is 24.9% off on average, the closest of four methods, and it stays the app's method ([`eta_benchmark.md`](eta_benchmark.md)).

| Status | |
|---|---|
| **Done** | OSRM routing with a 24-hour cache and the public server's rules kept; the TomTom profiles; zones by density; season and rain; the fallback; checked against Google |
| **Planned** | The town and rural values set from timed trips (December); self-hosted OSRM before real traffic |

**What is left:** the rural free-flow speed (57.8 km/h) is the weak spot, since rural trips come out 28% too quick. It and the town congestion scale are set from timed trips in [the plan to finish the benchmark](eta_benchmark.md#the-plan-to-finish-it), never from Google's numbers.

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Travel times by road, for the hour you search
Files: `src/lib/trafficModel.js`, `src/lib/traffic.js`, `src/lib/routing.js`, `src/lib/weather.js`, `assets/traffic_profiles.json`

Every bank's ETA comes from one method, which the ETA benchmark ([`eta_benchmark.md`](eta_benchmark.md)) calls **M3: OSRM's road route, slowed to measured traffic.** The measurements and decisions behind it are in report 3's record, below.

**ETA = free-flow time × (1 + congestion / 100) × rain factor**
- **Free-flow time** is the slower of two: OSRM's driving time, and the road distance at the zone's measured free-flow speed. OSRM's car profile assumes about 65 km/h through Mumbai, where TomTom measures 33.7 km/h with no congestion at all.
- **Congestion** is the zone's TomTom Traffic Index 2025 value for this weekday and hour in India time, interpolated to the minute, times the month's seasonal factor. Friday 6 pm in Mumbai adds about 115%; 3 am adds 1%.
- **Rain** at the pin, from Open-Meteo: × 1.15 at 2.5 mm/h or more, × 1.3 at 7.6 mm/h or more.

The zone is picked from where the search is made:

| Zone | When | Free-flow speed | Congestion |
|---|---|---|---|
| metro | inside one of TomTom's 10 Indian metros (10 km margin) | that city's, for example Mumbai 33.7 km/h | that city's own weekday-hour profile |
| city | 11 or more banks within 15 km | Indian average, 33.1 km/h | Indian average × 0.89 |
| town | 3 to 10 banks | halfway to highway speed, about 45 km/h | Indian average × 0.73 |
| rural | 0 to 2 banks | Indian highways, 57.8 km/h | Indian average × 0.29 |

If OSRM can't be reached, the road distance is the straight line × 1.34 (the median over 94 Mumbai trips), with the same zone, congestion and rain. The benchmark calls this fallback **M1**. The bank's reason then says "estimated from straight-line distance".

```text
# src/lib/trafficModel.js
estimateTravel(trip, zone, conditions):
    if OSRM routed it: roadKm = the route's distance;    routeMinutes = the route's time
    else:              roadKm = straight line × 1.34;    routeMinutes = 0
    freeFlowMinutes = max(routeMinutes, roadKm / zone.freeFlowKmh × 60)
    minutes = freeFlowMinutes × (1 + conditions.congestionPercent / 100) × conditions.rainFactor
    return max(1, round(minutes))
```

## Report 3's record

### Point 2: road routing (OSRM) and a time-aware ETA

> *Request:* implement OSRM and make sure that ETA depends on time of day, population density, estimated rush-hour slowdowns, and whatever else is relevant.

#### Where it started

`estimateEtaMinutes` in `src/lib/ranking.js` turned straight-line distance into minutes with one fixed rule: distance × 1.4 for detours, at 25 km/h in an urban area or 45 km/h in a rural one. Time, day, season and weather changed nothing.

#### Measurements taken before designing

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

#### Plan

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

#### Decisions

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

#### Change made while building: towns were too slow

The first version scaled town congestion by 0.86 and kept the city free-flow speed. A live check on Friday at 6:22 pm gave Panaji (Goa, a town with 3 banks within 15 km):
- +76% congestion;
- 50 minutes for a 15.6 km trip that locals would expect to take 30 to 35.

Two fixes followed, both from data:
- **Scale from comparisons inside each country.** Across 34 countries and 411 city pairs in the TomTom index, congestion relative to a country's largest city is 0.971 + 0.168 × log10(population ratio), with r = 0.40. Measured from the Indian metro average of 9.7 million people (TomTom's metro populations), and divided by the fit's value at that average, a city of about 2 million comes out at about 0.88 and a town of about 300,000 at about 0.74. The scales became city 0.89 and town 0.73, under one point of congestion from those values; the exact inputs used weren't kept (`docs/verify_facts.md`, F5). The earlier cross-country fit had compared cities in different countries, which mixes national driving conditions in with city size.
- **Town free-flow speed set halfway between city streets (33.1 km/h) and open road (57.8 km/h).** Town trips leave the built-up area quickly. This is an assumption and is listed for calibration in point 4.

After the fix, the same Panaji trip is **34 minutes**.

#### Steps taken

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

#### Results

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

#### How to defend it

- **"Why not Google Maps?"** It is billed and needs a card. OSRM is open, and the model sits behind `routing.js`, so a paid traffic-aware service can replace it without touching the ranking.
- **"OSRM doesn't know traffic."** Correct, so OSRM supplies only the road network and distance. Speeds and the rush-hour shape come from TomTom's measured data.
  - OSRM alone would claim 65 km/h through Mumbai.
  - TomTom's figures are the published averages for the same cities, and the code shows which hour and month were used.
- **"Population density?"** It is measured by bank density, which correlates 0.70 with city population (TomTom's metro populations) over the measured cities. The scales come from a 411-city fit.
- **"Is the rural value made up?"** Partly. It is the one assumption with no direct measurement, and it is flagged in the code. Point 4 gives the calibration method: compare against timed sample trips. (4 November: against Google, rural trips come out 28% too quick, from the base speed rather than the 0.29 scale; [above](eta_benchmark.md#checked-against-google-4-november).)
- **"Does it work?"** Against Google's traffic-aware predictions for 3,360 trips across all four zones and every hour of a week, M3 is 24.9% off on average. That is the closest of the four methods compared, and it picks Google's first bank in 81% of searches ([above](eta_benchmark.md#checked-against-google-4-november)).
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
