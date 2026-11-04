# Summary: the ETA benchmark

*As of 4 November 2026. This file is the whole record of the benchmark: this summary, then [the benchmark in full](#the-benchmark-in-full) (its design and every result), [the plan to finish it](#the-plan-to-finish-it), the findings as the feature list gave them, and report 3's record. The model itself is in [`eta_model.md`](eta_model.md). The bench's code and data are in `../rough_work/eta_benchmarks/`, outside git, and its `README.md` says how to run it. Results derived from Google Maps Platform data.*

**What was asked.** Report 3, point 2 asked for road routing (OSRM) and an ETA that depends on the time of day, how built-up the area is, rush hours and anything else relevant. That is built. The benchmark measures how well it works, which two reviewer points need:
- **point 1,** because the ETA is the largest part of a bank's ranking score;
- **point 4,** which asks for measurable results.

**The answer in brief.** The app's method, called **M3** in the benchmark, is OSRM's road route slowed to TomTom's measured traffic for the hour and the area. It was compared with three other methods against Google's traffic-aware predictions for 3,360 trips across a week. It is the closest, at 24.9% off on average, and it wins on the benchmark's rubric with 65.0 of 100, so it stays. Rural trips are its weak spot: they come out 28% too quick. Timed trips in December will check both M3 and Google, and set the rural and town values.

| Status | |
|---|---|
| **Done** | The bench, the rubric, the Google run (4,107 elements, free), the latency run, the decision |
| **Provisional** | The decision, until the team agrees the rubric (by 13 November) |
| **Planned** | 30 to 60 timed trips in December; a model refitted on them (M5) in January 2027 |

---

## The methods and the headline numbers

The reference is Google's Routes API (`TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`), asked for the week of 9 to 15 November:
- **The sample:** 40 hospital-to-bank pairs, 10 in each zone across 8 or 9 states, timed every 2 hours on all 7 days. That gives 3,360 trips, plus 396 saved searches for ranking.
- **Google's role:** it is the reference, not a candidate. Its terms bar its results from the app's non-Google map.
- **Intervals** are 95%, resampling the 40 origins.

| Method | Average error | Bias | Within 25% | Same first bank as Google's times | Minutes lost by a wrong first pick, p90 | Rubric /100 |
|---|---|---|---|---|---|---|
| M0: straight line × 1.4 at 25 or 45 km/h (the original app) | 34.1% | −9.6% | 46.8% | 74.7% | 6.1 | 55.0 |
| M1: straight line × 1.34 with the traffic model (the fallback) | 32.8% | −10.9% | 47.0% | 77.0% | 4.7 | 56.3 |
| M2: OSRM's time, unadjusted | 47.0% | −47.0% | 5.1% | 74.5% | 5.5 | 45.0 |
| **M3: OSRM with the traffic model (the app)** | **24.9%** (20.6% to 29.4%) | **−5.7%** | **56.8%** | **81.3%** | **1.7** | **65.0** |

M3 beats each other method with p < 0.001 (Wilcoxon on paired errors, Holm-corrected).

## What the results show

- **By zone:** metro 20.0%, city 23.5% (8.7% slow), town 28.0%, rural 28.0% (28.0% quick).
- **By time:** 22% to 29% off in every two-hour block, and weekdays and the weekend are alike.
- **Ranking:** M3 picks Google's first bank in 82.6% of critical searches, against 72.7% for M0. A wrong pick costs 1.25 minutes at the 90th percentile.
- **The week's pattern:** M3's peaks fall at the same hours as Google's, with a median correlation of 0.94 in the metros and 0.67 to 0.86 elsewhere. The size of the swing matches only in the metros (amplitude 1.02, trend R² 0.86). In cities and towns M3 swings more than Google, whose week there is flatter.
- **Each part of M3 earns its place:**
  - without the free-flow floor, the error is 33.3%;
  - without congestion, it is 29.8%, and the week goes flat.
- **Speed and reliability:** 200 uncached calls to the public OSRM server all succeeded, with a 95th percentile of 217 ms.
- **The decision:** M3 leads M1 by 8.7 points, outside the 5-point band where the simpler method would win. The lead holds with every weight moved by ±20%.

## What it says about the model

These are directions only. New values come from timed trips, never from Google's numbers, as its terms require.
- **The rural free-flow speed** (57.8 km/h) is too high. Rural trips are quick because of their base speed, not their congestion.
- **Towns may need less congestion** than × 0.73.
- **Trips under 5 km** come out 24% too quick.

## Limits

- **Google is a model, not a measurement,** and probably weakest outside the metros. The timed trips measure its error per zone.
- **This was one week in November,** so the season and rain factors are untested.
- **The latency was measured from a laptop,** not a deployed server.

## What is left

In detail, with what each step needs and when it is done, in [the plan to finish it](#the-plan-to-finish-it).

| Step | When |
|---|---|
| The key's quota and budget alert; the guide reads Google's current terms | By 8 November |
| The team agrees the rubric (phase 1) and the rules for the timed trips | By 13 November |
| Google's November answers deleted, after the scorecard can be re-computed from saved metrics | 30 November (deadline 3 December) |
| Tools for the timed trips: picker, importer with a GPS check, rain lookup, Google's prediction per trip, M5's fit | 16 November to 4 December |
| 30 to 60 timed trips, with an optional December Google grid | 12 to 20 December |
| Analysis, M5's fit and the decision | 4 to 11 January 2027 |
| The write-up: tables, charts, the viva sentence | By 15 January |
| Self-hosted OSRM (M7), before real traffic | With deployment |

## Where the details are

| What | Where |
|---|---|
| Design, rubric, every result | [The benchmark in full](#the-benchmark-in-full), with [the Google run](#the-google-run-4-november-2026) |
| The steps left, in detail | [The plan to finish it](#the-plan-to-finish-it) |
| The code, data and runs, and how to run them | `../rough_work/eta_benchmarks/` and its `README.md`, outside git |
| The model | [`eta_model.md`](eta_model.md) |
| The findings in full, and report 3's record of the Google check | [Below](#the-feature-in-full) |
| The run's files | `../rough_work/eta_benchmarks/data/runs/2026-11-04-google/` and `ops/osrm-2026-11-04.json`, outside git |

---

## The benchmark in full

*Moved here word for word on 4 November 2026 from `docs/SUMMARIES/eta_benchmark.md` (before that `docs/PLANS/benchmark_eta_system.md`), which was then deleted. It is the benchmark's design and every result.*

**Status, 4 November 2026: the Google half is done; the timed trips are not.** On the rubric as written, **M3 wins** with 65.0 of 100, 8.7 points ahead of M1, so the app keeps its method. The results are [below](#the-google-run-4-november-2026). The summary of findings is in [the summary above](#summary-the-eta-benchmark), and the model in [`eta_model.md`](eta_model.md). The steps left are planned in detail, with dates, in [the plan to finish it](#the-plan-to-finish-it). The Google results were seen before the team agreed the rubric. So the rubric is recorded as unchanged since, and any change to it now must be marked as made after the results.
- **Done:**
  - the bench, its metrics, the rubric, and adapters for M0 to M3 and six ablations, checked in [dry runs](#the-dry-runs) (phase 0);
  - the Google run, which gave the trend test, tier B and ranking fidelity (phases 2 and 3);
  - the operational run, for C4 and C5;
  - the scorecard, the intervals, the pairwise tests and the weight sensitivity;
  - the write-up in `docs/SUMMARIES/eta_benchmark.md` and `docs/SUMMARIES/eta_model.md`.
- **Left,** in the order and with the dates of [the completion plan](#the-plan-to-finish-it):
  1. the open checks: the key's quota and budget alert, and the guide's reading of Google's terms;
  2. phase 1: the team agrees the rubric, the judged scores and [how the bench reads it](#how-the-bench-reads-the-rubric), plus the rules for the timed trips;
  3. a scorecard that can be re-computed from saved metrics, then `node eta-google.mjs --purge`, by 3 December 2026;
  4. the tools the timed trips need: the trip picker, the importer with its GPS check, the rain lookup, Google's predictions for each trip, and M5's fit;
  5. phase 4: 30 to 60 timed trips, each with Google's prediction for the same departure, so Google's own error is measured on all of them;
  6. phase 5: M5, refitting on those trips the rural free-flow speed first, then the town scale, scored against M3 on the test side;
  7. phase 6: the tables and charts under [How to present it](#how-to-present-it), which are still templates (the run's CSVs are ready), and the viva sentence.
- **Optional, not built:**
  - M4 (OpenRouteService);
  - M6 (a paid traffic-aware matrix);
  - M7 (self-hosted OSRM), which is planned before real traffic and would raise C9;
  - a second Google sample, using December's free 5,000;
  - a monsoon re-run in July to September 2027, the only way to test the season and rain factors.
- **Not recorded:** whether the project guide read Google's current terms before collection, and whether the key has a daily quota and a budget alert in the console.

- Paths are relative to `bloodlink/` unless they start with `../`, or name the bench's own files, which are in `../rough_work/eta_benchmarks/`: `eta-bench.mjs`, `etaMetrics.js`, `tests/eta-*.test.js`, `data/` and the rest. The bench moved there from `bloodlink/` on 4 November 2026, outside git.
- "ETA" means the travel time from the person asking (usually a hospital) to a blood bank, as `src/lib/traffic.js` computes it today.

**Contents**
1. [Why](#why)
2. [What the ETA is for](#what-the-eta-is-for)
3. [The methods to compare](#the-methods-to-compare)
4. [Ground truth](#ground-truth)
5. [The Google trend test](#the-google-trend-test)
6. [The rubric](#the-rubric)
7. [Metrics](#metrics)
8. [The test bench](#the-test-bench)
9. [Steps](#steps)
10. [How to present it](#how-to-present-it)
11. [Decisions and alternatives](#decisions-and-alternatives)
12. [Risks and limits](#risks-and-limits)
13. [Sources](#sources)

---

### Why

- **The reviewer asked for OSRM and a time-aware ETA** (report 3, point 2). That is built, and argued for, but not measured against real trips. Report 3 itself flags the gap: the town free-flow speed and the rural congestion scale (0.29) are assumptions "flagged for calibration", and point 4 sets a target of under 25% error in every zone.
- **"Why OSRM and not plain Haversine?"** is the obvious viva question. Today the answer is an argument (road networks, rush hours). A measured table, with the old straight-line method as a baseline, turns it into evidence.
- **Does the model follow the week's traffic?** The time-of-day model is what M1 and M3 add over a fixed speed, and it rests on TomTom city profiles and scaled guesses for towns. Google's traffic-aware predictions for the same trips at every 2-hour slot of a week give a large reference for that pattern, which a few timed trips can't ([the Google trend test](#the-google-trend-test)).
- **A rubric keeps the choice honest.** Accuracy alone would pick a paid, traffic-aware API. Cost, licence, privacy and reliability matter as much for a public emergency tool, and a rubric written before the results makes those trade-offs explicit.

---

### What the ETA is for

The evaluation has to match how the app uses the number, in three places:

1. **The ranking.** `etaScore = 100 · e^(−minutes / τ)` with τ = 30, 45 or 60 minutes, weighted 0.25 to 0.45 (`src/lib/ranking.js`). So what matters most is:
   - the **order** of the banks within one search (relative error);
   - the absolute minutes only through τ: a 10-minute error costs a bank 28% of its ETA points when critical, 20% when urgent and 15% when routine.
2. **The display:** "6.2 km by road · about 24 min now". Here the absolute number matters, and a bias towards optimism is worse than one towards caution.
3. **The ring and plan don't use the ETA.** Rings are chosen by straight-line distance, so the ETA method can't change which banks are candidates, only their order and the plan.

So the bench scores **absolute accuracy** (for the display) and **decision accuracy** (for the ranking) separately. A method can be 30% off in minutes and still rank banks perfectly, if it is off by the same factor for all of them.

---

### The methods to compare

Every method answers the same question: minutes from an origin to each of a set of banks, departing at a given India time.

| ID | Method | Road network | Time of day | Where it is today | Cost |
|---|---|---|---|---|---|
| **M0** | **Straight line, fixed speed** (the original app): Haversine × 1.4, at 25 km/h urban or 45 km/h rural | No | No | Removed from `ranking.js` in report 3; re-created in the bench only | Free |
| **M1** | **Straight line + traffic model** (today's fallback): Haversine × 1.34, zone free-flow speed, TomTom congestion, rain | No | Yes | `estimateTravel` with no `leg` (`etaSource: "estimate"`) | Free |
| **M2** | **OSRM raw:** OSRM's free-flow duration, unadjusted | Yes | No | `fetchRoadLegs` output before `traffic.js` | Free (public server: 1 request a second) |
| **M3** | **OSRM + traffic model** (today's default) | Yes | Yes | `estimateTravel` with a `leg` (`etaSource: "road"`) | Free |
| M4 | OpenRouteService matrix + traffic model: a second free-flow engine | Yes | Yes | Not built | Free with a key and a daily limit |
| M5 | **M3, calibrated:** `ZONE_SCALE`, town and rural free-flow speeds and the detour factor refitted on the calibration split of the **timed trips** (tier A), never on Google's numbers ([E10](#decisions-and-alternatives)) | Yes | Yes | Not built | Free |
| M6 | **Traffic-aware commercial matrix:** TomTom Matrix Routing, HERE or Mappls, departing at the trip's time. Not Google, which is the reference (below) | Yes | Yes, with historical and live traffic | Not built | Billed beyond a free tier; needs a key and a card |
| M7 | Self-hosted OSRM (Geofabrik India extract) | Yes | Yes, via the model | Planned (`CLAUDE.md`, item 7) | A machine with 8 to 12 GB for preprocessing |

Notes:
- **M7 gives the same answers as M3** if both use the same OpenStreetMap date, so it is scored only on latency, reliability, cost and effort, never on accuracy.
- **Google is the reference, not a candidate.** Google's Routes terms say its content must not be used with a non-Google map, and the app draws its map with Leaflet and CARTO tiles. So Google fails gate G1 as a candidate for this app. That leaves it free to be the reference without the circularity problem in [ground truth](#ground-truth).
- **Ablations of M3** show which parts of the model earn their place. Each removes one part:

| Ablation | What it removes | The question it answers |
|---|---|---|
| M3 − congestion | `congestionPercent` set to 0 (equals M2 with the free-flow floor) | Do the TomTom rush-hour profiles help? |
| M3 − floor | The free-flow speed floor (OSRM time is used as it is, then congestion) | Was it right to slow OSRM down to TomTom's free-flow speed? |
| M3 − season | Seasonal factor set to 1 | Does the monthly factor help? (Can only be tested across seasons; see limits.) |
| M3 − rain | Rain factor set to 1 | Does live rain help? (Needs rainy trips.) |
| M3 − zone scale | Every non-metro zone uses the Indian average profile unscaled | Does bank density stand in usefully for town size? |
| M1 with 1.58 for trips under 5 km | The short-trip detour factor measured in report 3 | Is one detour factor enough? |

---

### Ground truth

There is no free, complete record of real Indian trip times. The plan uses three tiers, each checking the one below it.

| Tier | What | How many | Strength | Weakness |
|---|---|---|---|---|
| **A · gold** | **Timed trips:** a team member travels from an origin to a bank by car or taxi and logs the time with a phone GPS app | 30 to 60 | Real, at a real time of day | Few; one driver's behaviour; slow to collect |
| **B · silver** | **Google's traffic-aware prediction** for a coming week, from the Routes API (`TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`), asked a few days ahead, within the free cap ([budget](#budget)). Google Maps' "Depart at" range written down by hand only as a small fallback | The trend grid's 3,360 trips (40 pairs × 84 slots, 840 per zone), plus 747 for the ranking sets | Many, every zone, hour and day | A model, not a measurement |
| **C · sanity** | Published averages: TomTom city travel times per 10 km, ambulance response studies | A handful | Independent | Too coarse to score a single trip |

How they are used:
1. **Tier A validates tier B.** On the trips that have both, measure tier B's own error. If B is within about 15% of A, it is fit to score the methods at scale.
2. **Tier B scores every method**, with enough trips for each zone and time band.
3. **Tier A re-scores the shortlist,** so the final choice never rests on a model alone.
4. **Tier C** only catches gross errors, such as a method claiming 60 km/h through central Mumbai at 6 pm.

**The circularity rule.** A provider used as the reference must not also be scored as a candidate against it. Google is the reference and fails G1 as a candidate, so the rule is met. If another provider is ever used as the reference, the same rule applies to it: score that provider on tier A only.

**Terms of use.** Google's terms limit how its results may be collected, stored and published; the rules this plan follows are under [Rules for using Google's data](#rules-for-using-googles-data). Recording a small sample by hand from the Google Maps app, for an academic evaluation, is a grey area; if it is used at all, say so in the report.

#### Which trips

Trips should look like the searches the app answers, so origins and destinations come from real use:
- **Origins:** hospitals, since requests come from them. Take them from the directory and the data.gov.in list.
- **Destinations:** the banks a ranked search from that origin actually lists. `scripts/ranking-sensitivity.mjs --capture` already saves 52 such candidate sets across 13 places.
- **Strata:**

| Dimension | Levels |
|---|---|
| Zone (`trafficZone`) | metro, city, town, rural |
| Time band (India time) | night 00:00 to 05:00, midday 11:00 to 15:00, evening peak 17:00 to 20:00, and the rest of the day |
| Time of day | each two-hour block, 00:00 to 02:00 through 22:00 to 24:00 |
| Day | weekday (Monday to Friday), Saturday, Sunday |
| Distance | under 5 km, 5 to 15 km, 15 to 40 km, over 40 km |

- **How many.** Report 3 asked for at least 20 trips per zone and time band, which is 240. The tighter figure: to tell apart two methods whose average percentage errors differ by 5 points, when the paired differences have a spread of about 15 points, needs about (1.96 + 0.84)² × 15² / 5² ≈ **71 paired trips** per comparison. Google's sample has 3,360, from 40 origins; since trips from one origin share its roads, the intervals resample origins, so 40 origins is what limits their width. Tier A can't reach this, which is why it validates rather than scores.

#### How a timed trip is recorded

- **Vehicle:** car or taxi, not a two-wheeler, because the model estimates a car.
- **Start and stop:** the origin's gate to the bank's gate. Record departure time to the minute, in India time.
- **Logger:** any GPS app that exports GPX, so the route can be checked afterwards.
- **Notes:** stops (fuel, a wrong turn), weather, anything unusual. A trip with a long unplanned stop is kept but flagged and left out of scoring.
- **Safety:** this is not an emergency drive. Normal speeds, normal routes, and no entering hospital areas beyond the gate.

One line per trip in `data/trips.ndjson`:

```json
{
  "tripId": "mum-0007",
  "tier": "A",
  "origin": { "name": "KEM Hospital", "latitude": 19.0025, "longitude": 72.8417 },
  "hospitalCode": "1234",
  "destination": { "latitude": 19.0176, "longitude": 72.8562 },
  "departAt": "2026-11-06T18:10:00+05:30",
  "observedMinutes": 27,
  "observedRangeMinutes": null,
  "vehicle": "car",
  "rainObserved": "none",
  "flags": [],
  "collectedBy": "team member initials",
  "notes": ""
}
```

Tier B rows use the same shape, with `tier: "B"`, the provider in `source` and, where the reference gives a range ("typically 22 to 35 min"), both ends in `observedRangeMinutes` and the middle in `observedMinutes`.

---

### The Google trend test

**The question:** which method best follows how travel time rises and falls across the week, with the morning and evening peaks, quiet nights and lighter Sundays? The trip tests can't answer it. A method can get the base time right while ignoring the clock (raw OSRM, M2) and still score a fair average error.

**Why Google.** For a future departure, Google's traffic-aware routing predicts a trip's time from its historical traffic data, for any hour of any day. No other source the project can reach gives that many time-stamped predictions for Indian roads. Google is the **reference**, never a candidate (it fails G1; see [the methods](#the-methods-to-compare)).

**A reference, not the truth.** Google's predictions are a model too, probably weakest in towns and rural areas, where fewer phones report traffic. So 10 to 15 of the tier A timed trips are driven on trend-test pairs at trend-test times, to measure Google's own error. If Google is more than about 15% off those trips in a zone, that zone's trend results are reported as indicative only.

#### Design

| Choice | Value | Why |
|---|---|---|
| **Pairs** | 40 hospital-to-bank pairs, **10 in each zone**: metro (one in each of TomTom's 10 metros), city, town and rural. Outside the metros, origins are at least 50 km apart, and at most two per state in a zone; each zone's pairs span 8 or 9 states | Every zone equally, including the town and rural scales report 3 flagged |
| Distances | Metro and city: 3 under 5 km, 4 at 5 to 15 km, 3 at 15 to 25 km (urban searches stop at 25 km). Town: 2, 3, 3, and 2 over 40 km. Rural: 2 at 5 to 15 km, 4 at 15 to 40, 4 at 40 to 150 | Where each zone's searches actually reach |
| Where pairs come from | `eta-sample.mjs`, seeded, from the newest weekly directory copy. Origins are banks whose name marks a hospital (hospital, medical, institute, college, AIIMS…); destinations are other banks. Banks outside their own state, or on a point another bank shares, are left out | Requests come from hospitals; shared points are often district defaults |
| **Time grid** | Every 2 hours (00:00, 02:00 … 22:00 India time) on every day of one coming week, Monday to Sunday: **84 slots per pair**. Each zone gets 840 trips: 600 on weekdays, 120 on Saturday and 120 on Sunday, in every two-hour block | Both daily peaks, every hour, and weekdays against the weekend |
| **Ranking sets** | Every bank in the 52 saved candidate sets (249 banks at 12 places), timed from the place's rounded pin on that Wednesday at 02:00, 12:00 and 18:00 | Night, midday and the evening peak, for ranking fidelity |
| When to ask | All at once, 3 to 7 days before that week; every slot must still be an hour ahead | For future departures Google uses historical patterns. Close to now it mixes in live traffic, which our model doesn't have |
| **API settings** | Routes API `computeRouteMatrix`, `travelMode: DRIVE`, `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `trafficModel: BEST_GUESS`, `departureTime` set to each slot; one origin per request, at most 100 elements | Only `TRAFFIC_AWARE_OPTIMAL` accepts a traffic model, and it allows 100 elements per request |
| Our model's inputs | `now` = the slot's time; rain factor 1; the month of the queried week | Google's future prediction knows no weather, so rain is left out on both sides |
| **Methods scored** | Every method and ablation in `eta-methods.mjs`; M4 and M6 (TomTom or HERE) if built | The time-blind methods score 0 by construction, which is itself a result |

The same answers serve as the tier B trips: each pair at each slot is one trip for [absolute accuracy](#metrics), and the ranking sets give ranking fidelity. Some eRaktKosh positions don't match their bank's name (one pair's "Red Cross, Dewas" sits 15 km from Harda, about 150 km off). That doesn't matter here, since every method and Google time the same two points.

#### Budget

Checked on 4 November 2026 against Google's pages ([sources](#sources)): `TRAFFIC_AWARE_OPTIMAL` and `TRAFFIC_AWARE` matrix calls bill as **Compute Route Matrix Pro**, per element (origins × destinations). Its free cap is **5,000 elements a month** on the global price list and **35,000** for an account billed in India; above it, $10 or $3 per 1,000. Billing must be enabled on the project even inside the cap.

| Use | Elements |
|---|---|
| The pairs, `BEST_GUESS`: 40 pairs × 84 slots | 3,360 |
| Ranking fidelity: 249 banks × 3 times | 747 |
| **Total** | **4,107** |

- **It fits the global cap,** with 893 to spare, so the run is free whichever cap applies. The `PESSIMISTIC` and `OPTIMISTIC` ranges (1,344 elements for 8 pairs) are left out to keep it so; with an India-billed account they fit too.
- **The collector guards the cap.** `eta-google.mjs` adds the elements still to ask for to those already asked for this month (`cache/google_usage.ndjson`) and sends nothing if the sum would pass 95% of the cap. It assumes the global 5,000 unless told `--free-cap 35000`.
- **Guard against a bill in the console too.** Restrict the key to the Routes API, set a daily quota a little above the run, and add a budget alert, so even a bug in the script can't run up charges.

#### Trend metrics

For pair *j* and slot *s*, *g* is Google's `BEST_GUESS` minutes and *p* the method's minutes. Everything is on a log scale, so 10% means the same on a 5-minute trip as on a 50-minute one: *d*<sub>js</sub> = ln *p*<sub>js</sub> − ln *g*<sub>js</sub>.

| Metric | Per pair | Reads as | Part of our model it tests |
|---|---|---|---|
| **Level** | *L*<sub>j</sub> = mean of *d*<sub>js</sub> over the slots, reported as exp(*L*<sub>j</sub>) − 1 | "This method's base time for this trip is 12% high" | OSRM distance, free-flow speed, detour factor |
| **Shape** | Pearson correlation of ln *p* and ln *g* over the 84 slots | Do the peaks and troughs fall at the same hours? | The TomTom weekday-hour profiles |
| **Amplitude** | Slope of ln *p* on ln *g* over the slots | 1 is the same swing, under 1 too flat, over 1 exaggerated, 0 flat | `ZONE_SCALE` (city 0.89, town 0.73, rural 0.29) |
| **Trend R²** | 1 − Σ(*d*<sub>js</sub> − *L*<sub>j</sub>)² ÷ Σ(ln *g*<sub>js</sub> − mean ln *g*<sub>j</sub>)² | Share of Google's time-of-day variation the method reproduces once level is removed: 1 perfect, 0 flat, below 0 worse than flat | Shape and amplitude together |
| Peak ratio error | (max *p* ÷ min *p*) ÷ (max *g* ÷ min *g*) − 1, weekdays | "Rush hour multiplies the time by 2.2, against Google's 2.0" | The profile's peak height |
| Peak hour | Weekday slot of the maximum, difference in hours | The right time of peak, to the nearest 2 h | The profile's timing |
| Sunday effect | *p*(Sun 18:00) ÷ *p*(Wed 18:00), against the same for *g* | Does the weekend relief match? | The weekday rows of the profile |

Rules for reading them:
- **Pairs where Google shows no clear pattern** (weekly maximum ÷ minimum under 1.15, likely for some rural pairs) are reported apart. R² there divides by almost nothing and would be noise. Their level and amplitude are still reported.
- **Summaries:** mean R² over pairs with a clear pattern, overall and per zone; median amplitude per zone; median \|level\| per zone. Intervals by bootstrap over pairs.
- **Time-blind methods** (M0, M2) have R² and amplitude of 0 by construction. The trend test therefore ranks only the time-aware methods; level and the trip tests separate the rest.
- **The ablations show most clearly here.** For example, "M3 − zone scale" against M3 on town and rural pairs says whether scaling by bank density helps.
- **Amplitude by zone is the direct check on report 3's assumptions.** If the rural amplitude is far from 1, the 0.29 scale is wrong in the direction it shows. The new value still comes from timed trips (next section).

#### Rules for using Google's data

The official terms page couldn't be loaded while writing this plan. These rules come from Google's Routes documentation, a reproduction of the terms and a Google forum thread (see [sources](#sources)), so have the project guide read the current terms before collection.
- **Only through the official Routes API,** with a key. Never copy results from the Google Maps website or app with a script.
- **Keep raw results only as long as the terms allow.** The Routes terms quoted allow latitude and longitude to be cached for up to 30 days and say nothing quoted about durations. To be safe, delete the raw durations within 30 days and keep only the computed metrics: `node eta-google.mjs --purge` deletes `cache/google.ndjson` and the run files that copy Google's minutes (`predictions.ndjson`, `predicted_vs_actual.csv`), keeping `metrics.json`, `trend.json` and the summary CSVs.
- **Publish aggregate metrics, not Google's numbers.** A forum reply quotes a Google FAQ saying no Google Maps Platform data may be included in a document. The report shows R², amplitude, level and error tables, and our own methods' curves; `trend_week.csv` leaves Google's curve out. Check before printing it.
- **Only bank and hospital positions go to Google,** from eRaktKosh's public directory and the saved places. No user's pin or data is sent, so `/privacy` doesn't change.
- **Score with Google; don't tune to it.** The terms bar creating content from Google Maps content. Google can show that a parameter is off; its new value is set from the timed trips (tier A), and the report says so. M5 is fitted on tier A only.
- **Credit Google** wherever results derived from it are shown.

---

### The rubric

Two stages: **gates** a method must pass to be considered at all, then **weighted criteria** scored on anchored scales. The rubric, weights and decision rule are fixed **before** any results are seen, and committed to the repository with that date.

#### Stage 1: gates (pass or fail)

| Gate | Pass when |
|---|---|
| G1 · Licence | Its terms allow this use: a public, non-commercial emergency search, shown on the app's Leaflet and CARTO map, with results cached as long as `routing.js` caches them (24 h today). Google fails this gate: its Routes content must not be used with a non-Google map |
| G2 · Privacy | It doesn't need more than the search pin (rounded to about 100 m) and bank positions. It must not need a user id or a phone number. (Today `parseCoordinates` in `src/lib/eraktkosh.js` rounds the pin to 3 decimals, about 110 m, before `routing.js` sends it to the public OSRM server.) |
| G3 · India coverage | It returns a route for at least 95% of the bench's trips |
| G4 · Fallback | When it fails, the app can still answer (M1 behind it, as today) |
| G5 · Budget | Running it for the demo and the evaluation costs nothing beyond a free tier, or the team has agreed the spend |

A method that fails a gate is still reported, with the reason, because "the most accurate option fails on licence" is a finding worth showing.

#### Stage 2: weighted criteria

Each criterion is scored 0 to 4 against the anchors below, multiplied by its weight, and summed to a score out of 100.

| # | Criterion | Weight | 4 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|---|
| C1 | **Absolute accuracy:** MAPE on test trips, in every zone and in the evening peak band | 25 | ≤ 15% in every zone and in the peak band, and \|bias\| ≤ 5% | ≤ 25% in every zone and in the peak band (report 3's target) | ≤ 25% overall, with one zone or the peak band above | 25% to 40% overall | > 40% |
| C2 | **Ranking fidelity:** first choice matches the ranking under true times | 20 | ≥ 95% | ≥ 90% | ≥ 80% | ≥ 70% | < 70% |
| C3 | **Trend capture:** mean trend R² against Google over the pairs with a clear pattern ([the trend test](#trend-metrics)) | 10 | ≥ 0.8, and ≥ 0.6 in every zone | ≥ 0.6 | ≥ 0.4 | ≥ 0.2 | < 0.2, including every time-blind method |
| C4 | **Latency:** 95th-percentile time for one search's table. `/api/blood-search` routes every candidate bank in the widest ring, not only the ring it shows: 137 in central Delhi, and more in rural 150 km rings, in calls of up to 250 | 10 | ≤ 300 ms | ≤ 1 s | ≤ 3 s (`MAX_QUEUE_WAIT_MS`) | ≤ 6 s (`TIMEOUT_MS`) | > 6 s |
| C5 | **Reliability:** share of calls that succeed over a 200-call run | 10 | ≥ 99.5% | ≥ 99% | ≥ 97% | ≥ 90% | < 90% |
| C6 | **Running cost** at 10,000 searches a month | 10 | ₹0, no card | ₹0 within a free tier, card needed | < ₹1,000 | < ₹5,000 | more |
| C7 | **Explainability:** can the app say why the ETA is what it is? | 5 | Every factor shown and cited | Most factors shown | Engine output plus one adjustment | Opaque but stable | Opaque and changes without notice |
| C8 | **Operating effort** for a student team | 5 | Nothing to run | A key and a quota to watch | A small service to run | A server to maintain | A cluster or a licence negotiation |
| C9 | **Reproducibility:** same inputs, same answer, testable offline | 5 | Deterministic, runs in unit tests | Deterministic with a pinned data date | Mostly stable | Changes with live traffic | Can't be repeated |

**Why these weights.**
- **Accuracy and ranking fidelity carry 45 points between them**, plus 10 for trend capture, because the ETA's job is to send people to the right bank and tell them truthfully how long it takes.
- **Ranking fidelity is separate from accuracy** because the ranking is what changes outcomes. A method can have a 30% error and still rank well if the error is uniform; the reverse also happens.
- **Peak hours are inside C1.** A method must meet the error threshold in the evening peak band as well as in every zone, so one that is fine at 3 am and poor at 6 pm can't hide behind its average.
- **Trend capture gets its own line** because the time-of-day model is the main thing M1 and M3 add, and C1 can't see it. C1 measures errors against trips; C3 measures, against Google, whether the curve rises and falls at the right hours by the right amount once the base time is set aside. A flat method can pass C1 by getting the base time right; it scores 0 on C3.
- **No double counting.** C1 scores level and peak error on trips; C3 scores only the shape left after the level is removed. They answer different questions.
- **Operations (C4 to C6, 30 points)** matter because this runs on free tiers with no on-call engineer.
- **Privacy and licence are gates, not points.** No amount of accuracy should buy sending patient locations where they can't go.

**Checking the rubric itself.** As `scripts/ranking-sensitivity.mjs` did for the ranking weights, move each criterion weight by ±20% (rescaling the rest) and report whether the winner changes. If a ±20% change flips the winner, say so and show both.

#### The decision rule, agreed before the results

1. Drop methods that fail a gate.
2. Among the rest, the highest total wins.
3. **If two totals are within 5 points, take the simpler and cheaper one** (lower C6 + C8 cost, then higher C9).
4. A paid method is adopted only if it beats the best free one by at least 10 points **and** clears C1 at level 3 where the free one doesn't.
5. Whatever wins must beat M0 on C1 and C2. If it doesn't, the road network isn't earning its complexity, and that is the finding.

#### How the bench reads the rubric

The rubric is in `etaRubric.js`, and these are the places where its wording needed a reading. The team confirms them, or changes them, in phase 1.
- **C1:** levels 3 and 4 need every zone and the evening peak band measured on the test side, so with a zone missing the best is 2. Level 2 covers any overall MAPE up to 25%, however many strata are above it.
- **C3:** "every zone" in level 4 means every zone with pairs that show a clear pattern, since rural pairs may have none.
- **C4 and C5** come from a run of at least 200 calls (`--ops`). A method that calls nothing (M0, M1) scores 4 on both.
- **C4 times the request itself,** not the wait for the public server's one-a-second slot. The run's calls are spaced a second apart to keep that rule, and a search waits for a slot only when another came in under a second before it; how many searches the server can take is C9's question, and M7's. Counting the wait would put every call near 1 s, C4 at 2 and M3 within 5 points of M1, where the tie rule picks M1.
- **Gates:** a gate not yet checked counts as not passed. G3 is measured; the other gates and C6 to C9 are judged per method in `eta-methods.mjs`. Proposed for the methods built so far:

| Method | Gates | C6 cost | C7 explainability | C8 effort | C9 reproducibility | Why |
|---|---|---|---|---|---|---|
| M0 | all pass | 4 | 3 | 4 | 4 | Distance and speed are shown, but the speeds were guesses, not cited |
| M1 | all pass | 4 | 4 | 4 | 4 | Every factor is shown and cited; deterministic and unit-tested |
| M2 | all pass | 4 | 2 | 4 | 2 | OSRM's time with nothing to explain; the public server's map data changes unpinned |
| M3 | all pass | 4 | 4 | 4 | 2 | Every factor shown and cited; the same unpinned map data |

  G1 passes for the public OSRM server on light use with its credit shown; it is the reason to self-host (M7) before real traffic.
- **Rule 4** compares a paid winner with the free method rule 3 would pick. **Rule 5** is reported, not enforced.
- **Ablations** are scored as diagnostics and never chosen.
- **Strata:** time bands run from their start to before their end; Saturday is reported apart from both the weekdays and Sunday; distance bands use straight-line distance.
- **The split:** within each zone, origins in a fixed order (a hash of their position) go to the test side until it holds 40% of the zone's trips. A zone with a single origin is all test. **Google's trips are all test:** nothing is fitted to Google (E10), and M5 is fitted on timed trips only, so none of them can flatter a method.

---

### Metrics

For trip *i*, *p* is a method's predicted minutes and *t* the true minutes.

**Absolute accuracy**

| Metric | Formula | Reads as |
|---|---|---|
| MAE | mean \|p − t\| | Minutes off, on average |
| MAPE | mean \|p − t\| / t | Share off, on average |
| Median APE | median \|p − t\| / t | Robust to a few bad trips |
| Bias (MPE) | mean (p − t) / t | Positive means pessimistic, negative optimistic |
| P90 APE | 90th percentile of \|p − t\| / t | The bad cases |
| Within 25% | share with \|p − t\| / t ≤ 0.25 | Report 3's target |
| Interval coverage | share of trips where *t* falls in the method's range, for methods that give one | Whether a range can be trusted |

**Decision accuracy**, per candidate set (one search's banks), using tier B for every bank in the set:

| Metric | How |
|---|---|
| **First-choice agreement** | Rank the set with `rankSources`, once with the method's ETAs and once with the true ETAs, keeping stock and freshness as captured. Do the two pick the same first bank? |
| **Kendall's τ** | Between the two orders, as `ranking-sensitivity.mjs` computes it |
| **Regret** | Two numbers. **Score regret:** the true score of the true ranking's first choice minus the true score of the method's first choice (0 when they agree). **Minutes regret:** true minutes to the method's first choice minus true minutes to the true first choice, when positive. "How much did trusting this method cost?" |
| **Plan agreement** | Does `buildResponsePlan` take the same units from the same banks? |
| **ETA-score error** | mean \|etaScore(p) − etaScore(t)\| per urgency. The error as the ranking feels it |

**Trend:** level, shape, amplitude, trend R², peak ratio, peak hour and Sunday effect, defined under [Trend metrics](#trend-metrics).

**Operational:** median and 95th-percentile latency per table call, failure rate and failure kinds over a 200-call run spaced as the provider requires, and cost per 1,000 searches from the provider's price list on the day.

**Statistics**
- **Paired:** every method is scored on the same trips, so compare methods trip by trip.
- **Confidence intervals:** bootstrap 2,000 resamples, **resampling origins, not trips**, because trips from one origin share its roads.
- **Pairwise tests:** Wilcoxon signed-rank on absolute percentage errors, with Holm's correction for the number of pairs.
- **No tuning on test trips.** Split trips 60/40 into calibration and test, grouped by origin so one hospital's trips are all on one side. **Every reported figure is from the test side.**
- **M5 is fitted on tier A's calibration split only**, never on Google's numbers (E10). With 30 to 60 timed trips that is 18 to 36 trips, so M5 refits only the two or three parameters the trend test shows are off, not all of them.

---

### The test bench

#### Files

| File | What it does |
|---|---|
| `eta-bench.mjs` (built) | Runner: reads trips, calls each method, saves predictions, computes metrics, writes the scorecard. `--google` scores against Google's saved answers for the sample (accuracy, ranking fidelity and the trend test), with `--dry-run` M3 standing in for Google; `--dry-run` alone uses the saved captures; `--ops` measures latency and reliability |
| `eta-methods.mjs` (built) | One adapter per method, all with the same interface: M0 to M3 and the ablations, the cached OSRM provider, and each method's judged gates and criteria |
| `eta-sample.mjs` (built) | Picks the 40 pairs, the week's 84 slots and the ranking sets, and writes `trend_pairs.json`. Calls nothing |
| `eta-google.mjs` (built) | The Google reference: the Routes API client, the free-cap guard and the usage ledger, the collector (`--plan` sends nothing) and `--purge`. Unit-tested in `tests/eta-google.test.js` |
| `eta-data.mjs` (built) | Paths and readers the bench's scripts share |
| `src/lib/trafficModel.js` (built, pure) | The traffic model behind `createTrafficModel(profiles, { detourFactor, zoneScale })`; see below |
| `etaMetrics.js` (built, pure) | MAE, MAPE, bias, Kendall's τ, regret, bootstrap, Wilcoxon with Holm's correction, the strata, and the trend metrics (level, shape, amplitude, trend R², peak ratio, peak hour, Sunday effect). Unit-tested in `tests/eta-metrics.test.js`, including a flat method scoring R² 0 and a method equal to the reference scoring 1 |
| `etaRubric.js` (built, pure) | The gates, the criteria with their anchors and weights, the decision rule and the weight sensitivity, with `RUBRIC_AGREED_ON` for phase 1. Unit-tested in `tests/eta-rubric.test.js` |
| `data/` | `trips.ndjson` (timed trips), `trend_pairs.json` (the sample), `cache/osrm.ndjson` and `cache/google.ndjson` (raw answers), `cache/google_usage.ndjson` (elements sent, by time), `ops/<provider>-<date>.json` (operational runs), `runs/<date>[-google][-dry-run]/` (predictions, metrics, scorecard) |

#### The traffic model in plain Node

Plain Node can't import JSON without `with { type: "json" }`, so a script couldn't load `src/lib/traffic.js`, which imports `assets/traffic_profiles.json`. The model therefore lives in `src/lib/trafficModel.js`, which imports no JSON: `createTrafficModel(profiles)` takes the profiles as an argument, as `createStateChecker` does in `src/lib/stateBounds.js`. `traffic.js` binds it to the profile file and keeps the app's exports. The bench evaluates **exactly the code the app runs**, not a copy, and `tests/traffic.test.js` checks that the factory and the app's exports agree.

The factory also returns `travelMinutes`, the minutes before rounding, and takes `detourFactor` and `zoneScale`, so the bench can test other values (the short-trip ablation, and M5 later) without a copy of the model.

#### The adapter interface

```js
// eta-methods.mjs
// Each method: { id, label, provider: "osrm" | null, rubric, estimate }
// estimate(origin, destinations, departAt, { banksWithin15Km, rainMmPerHour }, osrm) resolves to
//   [{ minutes, exactMinutes, distanceM, source, raw }]  in the same order as destinations;
//   minutes is what the app would show, null where the method found no route;
//   exactMinutes is the same before rounding, for the trend test.
```

- **Batching:** trips are grouped by origin and departure time, so each provider sees one matrix call per group, as the app makes one OSRM table call per search.
- **The zone:** a trip may carry `banksWithin15Km`; otherwise the bench counts the banks within 15 km of the origin in the newest weekly directory copy, leaving out those placed outside their own state, as location search does.
- **Departure time for the model methods (M1, M3, M5):** pass the trip's `departAt` as `now` to `congestionPercent` and `trafficConditions`. Rain comes from Open-Meteo's historical archive for that place and hour, so the model gets the same weather the trip had. Until that lookup is built (phase 4, the only trips with weather), a trip may carry `rainMmPerHour`, and without it the rain factor is 1.
- **Departure time for traffic-aware APIs (M6 and the Google reference):** they take future departures. For timed trips, ask for the next date with the same weekday and time ("typical traffic"), 3 to 7 days ahead, and record the date actually asked. Google's sample is asked for its own coming week.
- **The Google reference** (`eta-google.mjs`) is not a method: it fills the true minutes. It calls `computeRouteMatrix` with `TRAFFIC_AWARE_OPTIMAL` and `BEST_GUESS`, one origin and one departure time per request, at most 100 elements, four requests in flight and under 2,500 elements a minute (Google allows 3,000). The first request goes alone, so a key or billing problem stops the run after one element. Its key lives in `.env.local` as `GOOGLE_ROUTES_API_KEY`, is read only by that script and never by app code, and is restricted to the Routes API.
- **Caching:** every provider answer is saved before it is used. A re-run reads the cache, so scoring is free and repeatable, and a paid API is called once per trip at most; an interrupted collection carries on where it stopped. Google's raw answers are deleted within 30 days with `--purge` (see [the rules](#rules-for-using-googles-data)); the metrics computed from them are kept.
- **Rate limits:** one gate per provider, reusing the spacing logic of `routing.js` (1 request a second for the public OSRM server).
- **Versions:** each run records the git commit, the date of `assets/traffic_profiles.json`, and OSRM's `data_version` where the response carries it, because the public server's map data changes.

#### Outputs

- `predictions.ndjson`: one line per trip and method.
- `metrics.json`: every metric, overall and per stratum, with intervals.
- `trend.json`: the trend metrics per method, per pair and per zone, with the pairs that show no clear pattern listed apart.
- `scorecard.md`: gates, criterion scores, totals, the decision-rule outcome and the rubric's sensitivity check.
- CSV files for the charts listed under [How to present it](#how-to-present-it): `methods.csv`, `mape_by_stratum.csv`, `mape_by_zone_band.csv`, `predicted_vs_actual.csv`, `error_cdf.csv`, `regret_by_urgency.csv`, `trend_by_zone.csv` and `trend_week.csv`.

#### The Google run, 4 November 2026

`node eta-google.mjs` asked for the whole sample (week of 9 to 15 November): 4,107 elements in 3,396 requests, every one answered on the first try, in about 2 minutes, at no cost (4,107 of the 5,000 free this month). All 4,107 had a route; 3 had a time of 0 and are left out. Then `node eta-bench.mjs --google`; the results are in `data/runs/2026-11-04-google/`. Only aggregates are given here, as Google's terms ask, and its raw answers are to be deleted with `--purge` by 3 December 2026. Results derived from Google Maps Platform data.

**Against Google, 3,360 trips from 40 origins** (95% intervals over origins):

| Method | MAPE | Bias | Within 25% | First choice agrees (396 searches) | Minutes regret, p90 |
|---|---|---|---|---|---|
| M0 straight line, fixed speed | 34.1% | −9.6% | 46.8% | 74.7% | 6.1 |
| M1 straight line + model | 32.8% | −10.9% | 47.0% | 77.0% | 4.7 |
| M2 OSRM raw | 47.0% | −47.0% | 5.1% | 74.5% | 5.5 |
| **M3 OSRM + model (today)** | **24.9%** (20.6 to 29.4) | **−5.7%** (−13.9 to 2.8) | **56.8%** | **81.3%** | **1.7** |

- **M3 is the closest to Google on every measure,** and beats each other method with p < 0.001 (Wilcoxon, Holm-corrected). It also picks the same first bank most often, and when it picks another, the 90th-percentile cost is 1.7 minutes against 6.1 for the original rule. Plain OSRM is 47% too fast, which is why the free-flow floor exists.
- **By zone, M3:** metro 20.0% (bias −1.2%), city 23.5% (+8.7%), town 28.0% (−2.5%), rural 28.0% (**−28.0%**). Rural trips come out far too quick.
- **By time:** MAPE 22% to 29% in every two-hour block; quicker than Google at night (bias −15%) and slightly slower in the evening peak (+4.7%). Weekdays, Saturday and Sunday are alike (24% to 25%).
- **By distance:** best at 5 to 15 km (15.9%); under 5 km, 24% too quick.
- **Ablations:** without the free-flow floor, 33.3%; without congestion, 29.8%; season and rain change nothing in one November week, as expected. Without the zone scale, 23.5% overall: better in rural areas (18.3%), worse in cities and towns.

**The trend** (35 of 40 pairs show a clear pattern; Google's week is almost flat for 5 pairs in cities, towns and rural areas):

| Zone | Pairs | M3 trend R², median | M3 amplitude, median | Without the zone scale: amplitude |
|---|---|---|---|---|
| metro | 10 | 0.86 | 1.02 | 1.02 |
| city | 8 | 0.17 | 1.36 | 1.48 |
| town | 9 | −4.25 | 1.42 | 1.81 |
| rural | 8 | −0.01 | 0.76 | 2.13 |

- **In the metros M3 follows Google's week closely,** with the same peak hours and the same swing. M1 gives the same trend figures, since it shares M3's congestion and differs only in level.
- **In towns and cities it swings more than Google,** whose week there is much flatter (a median swing of about 1.2 in towns and rural areas, against 1.7 in metros). Google may simply have less traffic data there; the timed trips will tell.
- **The mean R² is −1.66,** pulled down by town pairs whose small swing makes any mismatch large. The median is 0.08. C3 scores 0 on either.

**What it says about the model** (directions only; new values come from the timed trips, E10):
- **Rural trips are too quick because of their base speed, not their congestion.** Their level is a median 28% below Google's, and dropping the 0.29 scale would make their swing 2.1 times Google's. The rural free-flow speed (57.8 km/h, highway speed) is the value to check.
- **The zone scales point the right way** (removing them overstates the town and rural swings), but towns may need less congestion than 0.73.

**The operational run** (`node eta-bench.mjs --ops`, 4 November, from a laptop in India): 200 uncached table calls to the public OSRM server, cycling through the 13 sensitivity places, each with every bank in its widest ring (9 to 137, median 60). All 200 succeeded; the request took a median of 180 ms and 217 ms at the 95th percentile. The results are in `data/ops/osrm-2026-11-04.json`.

**The scorecard:**

| Method | C1 (25) | C2 (20) | C3 (10) | C4 (10) | C5 (10) | C6 (10) | C7 (5) | C8 (5) | C9 (5) | Total |
|---|---|---|---|---|---|---|---|---|---|---|
| M0 | 1 | 1 | 0 | 4 | 4 | 4 | 3 | 4 | 4 | 55.0 |
| M1 | 1 | 1 | 0 | 4 | 4 | 4 | 4 | 4 | 4 | 56.3 |
| M2 | 0 | 1 | 0 | 4 | 4 | 4 | 2 | 4 | 2 | 45.0 |
| **M3** | **2** | **2** | **0** | **4** | **4** | **4** | **4** | **4** | **2** | **65.0** |

- **M3 wins,** 8.7 points ahead of M1, outside the 5-point tie band, and it beats M0 on MAPE and first-choice agreement. Moving each weight by ±20% changes the winner in none of the 18 runs.
- **What holds it back:** C1 (town and rural trips 28% off, above 25%), C2 (81% first-choice agreement; level 3 needs 90%), C3 (a mean trend R² of −1.66, pulled down by the towns; level 1 needs 0.2) and C9 (the public server's map data and rules can change). Self-hosting OSRM (M7) would raise C9; the timed trips and a recalibrated rural speed are the way to raise C1.
- **Provisional** until the team agrees the rubric (phase 1).

#### The dry runs

**On Google's sample, 4 November 2026.** `node eta-bench.mjs --google --dry-run`: the sample picked by `eta-sample.mjs` for the week of 9 November, with M3's minutes before rounding standing in for Google's. It runs everything the Google run will, without a key, in under a minute. The results are in `data/runs/2026-11-04-google-dry-run/`.
- **The distribution is as designed:** 3,360 test trips, 840 per zone; 2,400 on weekdays, 480 on Saturday and 480 on Sunday; 672, 1,092, 1,092 and 504 in the four distance bands. 747 more time the ranking sets: 432 searches compared (48 sets × 3 times × 3 urgencies).
- **M3 against itself:** MAPE 1.5%, which is whole-minute rounding, and R² 1 on the trend in every zone. Its first choice matches in 96.3% of searches, not 100%: rounding to the minute alone changes the first bank in 3.7% of them, which is the floor for any method shown in whole minutes.
- **The time-blind methods** (M0, M2, M3 − congestion) score R² 0. M3 − zone scale falls to 0.16, its rural pairs far below 0, showing the test will see a wrong zone scale.
- **Every zone and the evening peak are measured**, so C1 can reach level 4, as M3 does here. The decision rule still stops at "not reached", because C4 and C5 wait for an `--ops` run.
- `node eta-google.mjs --plan` counts 3,396 requests and 4,107 elements, within 95% of the 5,000 free; without a key it sends nothing.

**On the saved captures, 3 November 2026.** `node eta-bench.mjs --dry-run` on the 52 saved captures (Friday 23 October, 19:35 India time). Each captured bank is a trip whose true minutes are the ETA M3 gave at capture. The results are in `data/runs/2026-11-03-dry-run/`; its trend figures came from a trend mode on the captures' places that the Google sample has since replaced.
- **M3 reproduced 246 of its 250 captured ETAs exactly** (MAPE 0.6%). Two Mumbai banks are 7 and 10 minutes quicker today because OSRM's route to them changed after the capture. The public server reports no `data_version` to record, which is why C9 scores it 2.
- **The captures predate pin rounding.** Their straight-line distances match the unrounded places: 287 m from Mumbai's point to its nearest bank, against 288 m captured and 284 m from the rounded pin. Rounding moves an origin about 40 m, which sends OSRM onto another road for the banks on a place's own point. So a dry run keeps the captured origins, while real trips are rounded as the app rounds a pin.
- **The trend test gives what its construction demands.** R² is 1 for M3 against itself, and 0 for the flat methods (M0, M2, M3 − congestion). M1 and M3 − floor score 1 too, while differing from M3 only in level, by 12% and 24%: the split of level from shape works. M3 − zone scale has R² 0.93, and an amplitude of 2.8 on the rural pair, the swing the 0.29 scale takes out.
- **The scorecard stops where it should.** The test side holds 107 trips from 6 origins (metro 84, city 22, rural 1, no town), all in the evening peak. So no method can reach C1 level 3, C4 and C5 wait for an `--ops` run, and the decision rule reports "not reached".
- A re-run makes no OSRM calls and takes about a second.

---

### Steps

| Phase | What | Time | Needs |
|---|---|---|---|
| 0 | **Done 3 November.** The traffic model loads in plain Node (above); `etaMetrics.js`, `etaRubric.js` and their tests; the runner; adapters for M0 to M3 and the ablations. Dry run on the 52 saved candidate sets with M3 as a stand-in truth ([results](#the-dry-runs)) | 1 day | Nothing |
| 1 | **Commit the rubric, weights and decision rule** with the date, before any truth is collected: confirm [how the bench reads the rubric](#how-the-bench-reads-the-rubric) and the judged scores in `eta-methods.mjs`, then set `RUBRIC_AGREED_ON` in `etaRubric.js` | 1 h | The team's agreement |
| 2 and 3 | **Done 4 November: the Google run** ([results](#the-google-run-4-november-2026)), the trend test, tier B and ranking fidelity in one collection of 4,107 elements. Left: `node eta-google.mjs --purge` by 3 December 2026. A second sample of 40 pairs could use December's free 5,000 | An hour | A Google Cloud project with billing enabled, and the guide's reading of the terms |
| 4 | Tier A collection: 30 to 60 timed trips, chosen to overlap tier B, with 10 to 15 on trend-test pairs at trend-test times to check Google itself | Two weekends plus weekday evenings | Team members with a car or taxi budget |
| 5 | Fit M5 on tier A's calibration trips; run the bench (split, ablations, statistics, scorecard and rubric sensitivity are built). `--ops` for C4 and C5 is done (4 November). Delete Google's raw answers once the metrics are saved | 1 day | Nothing |
| 6 | Write it up for the report; if the winner isn't M3, plan the change in `routing.js` and `traffic.js` | Half a day | Nothing |

If time is short, phases 0 to 3 already answer "which method follows the trend best, and how far off is each against Google", and tier A then becomes "planned".

**The phases left are planned step by step, with dates, in [the plan to finish it](#the-plan-to-finish-it).** It changes two things above:
- **Google's error is measured on every timed trip,** each asked for at its own departure. The 10 to 15 trend-test pairs of phase 4 are spread over 8 or 9 states per zone, out of a car's reach.
- **The Google run's scorecard can be re-computed** from its saved metrics after the purge (`--rescore`), so the purge needn't wait for phase 1.

---

### How to present it

**One table per question:**

| Method | Gates | MAPE (test) | Bias | Within 25% | Trend R² | Amplitude | First choice agrees | Regret (median, p90 min) | p95 latency | Cost / month | Total /100 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| M0 straight line, fixed speed | | | | | 0 (no time input) | 0 | | | | ₹0 | |
| M1 straight line + model | | | | | | | | | | ₹0 | |
| M2 OSRM raw | | | | | 0 (no time input) | 0 | | | 0.7 s (report 3, one call) | ₹0 | |
| M3 OSRM + model (today) | | | | | | | | | | ₹0 | |
| … | | | | | | | | | | | |

**The trend table**, one row per zone:

| Zone | Pairs with a clear pattern | Trend R², M1 | Trend R², M3 | Trend R², M3 − zone scale | Amplitude, M3 | Peak hour off by (median) | Google's own error on timed trips |
|---|---|---|---|---|---|---|---|
| metro | of 12 | | | | | | |
| city | of 10 | | | | | | |
| town | of 10 | | | | | | |
| rural | of 8 | | | | | | |

**Charts:**
- **One week for one metro pair:** M3's and M1's curves, M2's flat line, and Google's peak hours and swing marked as numbers. Print Google's own curve only if the terms allow it.
- **Amplitude by zone,** with a line at 1: the direct test of the 0.89, 0.73 and 0.29 zone scales.
- MAPE by zone and time band, one line per method: shows where time-awareness pays.
- Predicted against true minutes, log scale, one panel per method, with the 45° line.
- Error distribution (cumulative share of trips within *x*% error).
- Regret by urgency: does a method's error ever cost a critical patient minutes?
- Ablation bars: how much each part of M3 changes MAPE.

**The sentence for the viva**, filled in from the results: "Against N timed and M reference trips, plain distance at a fixed speed was X% off and picked the wrong first bank in Y% of searches; OSRM with the traffic model was X′% off and Y′%, at no cost and with every factor explained. Across a week of Google's traffic predictions, our model reproduced Z% of the time-of-day variation in metros and Z′% in towns."

---

### Decisions and alternatives

**E1 · Score decisions as well as minutes.**
- *Why:* the ranking only feels the ETA through the order and τ. A method that is uniformly slow ranks perfectly but displays badly; both need a number.
- *Alternative:* MAPE alone. Simpler, but it can't show whether an error ever changed which bank a patient was sent to.

**E2 · Gates before points.**
- *Why:* licence and privacy aren't trade-offs. A weighted score would let enough accuracy outweigh a breach.
- *Alternative:* everything weighted. More flexible, and easier to game.

**E3 · Anchored 0-to-4 scales.**
- *Why:* two people scoring the same results get the same number, and the anchors tie to thresholds already in the code (`TIMEOUT_MS`, `MAX_QUEUE_WAIT_MS`) and in report 3 (25%).
- *Alternative:* free 1-to-10 marks. Quick, but not repeatable.

**E4 · Fix the rubric before collecting truth.**
- *Why:* otherwise weights drift towards whatever won. The same rule report 3 used for the forecast models.

**E5 · Two-tier truth.**
- *Why:* timed trips are the only real measurement but too few to score strata; a reference model gives scale but must itself be checked.
- *Alternatives:* timed trips only (honest, too small); a reference only (large, circular if the reference is also a candidate); ambulance GPS logs (best of all, but not available to a student project; worth asking a 108 service).

**E6 · Evaluate the app's own code, not a re-implementation.**
- *Why:* a copy can drift from what users get. Hence the `createTrafficModel` refactor.

**E7 · Hold out by origin.**
- *Why:* trips from one hospital share roads and traffic. A random split would let M5 learn a road it is then tested on, and flatter it.

**E8 · Google as the reference, not a candidate.**
- *Why:* it gives traffic-aware predictions for any hour, from far more trip data than the project could collect, and it can't be a candidate anyway: its Routes content can't be used with the app's non-Google map (G1).
- *Alternatives:* TomTom or HERE as the reference (also traffic-aware, but they would then be barred as candidates, and they are the realistic paid candidates); timed trips only (too few for 84 slots × 40 pairs).

**E9 · Test the trend separately from the level.**
- *Why:* the two parts of the model fail in different ways. Level comes from OSRM and the free-flow speeds; the trend comes from the TomTom profiles and zone scales. Splitting the log difference into level, shape and amplitude says which part to fix.
- *Alternative:* one MAPE over all slots. Simpler, but a method could score well on a good base time while staying flat, which is exactly what the test is meant to expose.

**E10 · Score with Google; set parameters from timed trips.**
- *Why:* Google's terms bar creating content from its content, and fitting our constants to its numbers would come close to that. Using it only to measure keeps the evaluation clean, and the timed trips are real measurements anyway.
- *Alternative:* fit M5 directly to Google's grid. More data to fit on, but a licence risk, and it would make Google the hidden source of our model.

---

### Risks and limits

| Limit | Effect | What to do |
|---|---|---|
| **Season can't be tested before the next monsoon** | The seasonal factor and rain factor stay unvalidated | Report them as untested; re-run tier B in July to September 2027 |
| One driver's habits in tier A | Systematic bias | Spread trips across team members; report bias per driver |
| Taxi and car, not ambulance | An ambulance with a siren is faster in traffic | Say the model estimates a private car or taxi, which is how most blood is fetched |
| Provider terms change | A method may fail G1 later | Record the terms' date with the run |
| The public OSRM server's map data changes | Results drift | Record `data_version`; self-hosting (M7) pins it |
| Origins only where the team can travel | Few rural and hill trips | Use tier B for rural strata; mark tier A coverage honestly |
| Google is thin in towns and rural areas | Its predictions there may be nearly flat or wrong | Report pairs with no clear pattern apart; check Google against timed trips per zone; call a zone indicative only if Google is over about 15% off |
| Google's future predictions know no weather | Rain can't be tested this way | Rain factor 1 in the trend test; rain stays untested until rainy timed trips exist |
| Google's terms | Collection or publication could break them | Official API only; raw results deleted within 30 days; only aggregate metrics published; parameters set from timed trips; the guide reads the current terms first |
| An unexpected Google bill | Real cost to a student | Key restricted to the Routes API, a daily quota just above the planned run, a budget alert |
| The free cap is lower than the run | Charges, or an incomplete grid | Split across two calendar months, or cut the range pairs |

---

### Sources

- `docs/SUMMARIES/eta_model.md` (the model and its measurements: 1.34 detour, 65 km/h OSRM, 33.7 km/h TomTom Mumbai, zone scales) and point 4 (the ETA calibration test it planned).
- [TomTom Traffic Index](https://www.tomtom.com/traffic-index/ranking/): the profiles in `assets/traffic_profiles.json`.
- [OSRM demo-server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server): the limits of `router.project-osrm.org`, the server `routing.js` uses. FOSSGIS's [routing usage policy](https://routing.openstreetmap.de/about.html) covers its own server, `routing.openstreetmap.de`.
- [Google Maps Platform service specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522): an example of caching limits to check under gate G1.
- [Routes API: traffic models](https://developers.google.com/maps/documentation/routes/traffic-model): `BEST_GUESS`, `PESSIMISTIC` and `OPTIMISTIC`; they need `TRAFFIC_AWARE_OPTIMAL`; both Compute Routes and Compute Route Matrix support them.
- [Routes API: Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix): at most 100 elements per request with `TRAFFIC_AWARE_OPTIMAL`, 625 otherwise.
- Google Maps Platform's [global price list](https://developers.google.com/maps/billing-and-pricing/pricing) and [India price list](https://developers.google.com/maps/billing-and-pricing/pricing-india), read on 4 November 2026: Compute Route Matrix Pro has 5,000 free elements a month globally and 35,000 for India-billed accounts. The [Routes SKU details](https://developers.google.com/maps/billing-and-pricing/sku-details/routes) and [Routes usage and billing](https://developers.google.com/maps/documentation/routes/usage-and-billing): `TRAFFIC_AWARE` and `TRAFFIC_AWARE_OPTIMAL` make a matrix element Pro; elements are origins × destinations; billing must be enabled.
- [Google forum: Routes API data and caching](https://discuss.google.dev/t/data-visualisations-with-routes-api-data/279145): the 30-day caching rule for coordinates, the non-Google-map rule, and the FAQ line on documents.
- [A reproduction of the terms' misuse clauses](https://wpgeodirectory.com/support/topic/changes-to-google-maps-platform-terms-of-service/): no scraping, no caching beyond the service terms, no creating content from Google Maps content. Read the official terms at <https://cloud.google.com/maps-platform/terms>.

---

## The plan to finish it

*Moved here word for word on 4 November 2026 from `docs/SUMMARIES/eta_benchmark.md`, "The plan to finish it" (before that `docs/PLANS/plan_complete_eta_benchmark.md`), which was then deleted. "The benchmark" below means the section above.*

**Status, 4 November 2026: not started.** This plan covers the steps the ETA benchmark still needs, in date order, each in enough detail to carry out. The benchmark is described in [the benchmark in full](#the-benchmark-in-full), which is called "the benchmark" below. Its phases 0, 2 and 3 are done: against Google's traffic-aware predictions, M3 (the app's method) is 24.9% off on average and wins on the rubric with 65.0 of 100. Its findings are summarised in [the summary above](#summary-the-eta-benchmark).

- Paths are relative to `bloodlink/` unless they start with `../`, or name the bench's own files, which are in `../rough_work/eta_benchmarks/`, whose `README.md` says how to run them. New scripts in step 4 go there too.
- Commands are run from `../rough_work/eta_benchmarks/`, with `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON` where this plan writes `node`.
- "Calibration side" and "test side" are the bench's split of timed trips by origin, 60% and 40% within each zone.

**Contents**
1. [What finishing it means](#what-finishing-it-means)
2. [The steps at a glance](#the-steps-at-a-glance)
3. [Step 1 · Close the open checks](#step-1--close-the-open-checks)
4. [Step 2 · Agree the rubric (phase 1)](#step-2--agree-the-rubric-phase-1)
5. [Step 3 · Make the scorecard re-computable, then purge](#step-3--make-the-scorecard-re-computable-then-purge)
6. [Step 4 · Build what the timed trips need](#step-4--build-what-the-timed-trips-need)
7. [Step 5 · Plan the trips and ask Google](#step-5--plan-the-trips-and-ask-google)
8. [Step 6 · Drive the timed trips (phase 4)](#step-6--drive-the-timed-trips-phase-4)
9. [Step 7 · Analyse and fit M5 (phase 5)](#step-7--analyse-and-fit-m5-phase-5)
10. [Step 8 · Decide, and change the app only if M5 wins](#step-8--decide-and-change-the-app-only-if-m5-wins)
11. [Step 9 · Write it up (phase 6)](#step-9--write-it-up-phase-6)
12. [Later, optional](#later-optional)
13. [Risks](#risks)

---

### What finishing it means

The benchmark answers three questions. The Google half has answered the first two; the timed trips answer the third.

| Question | Answered by | Status |
|---|---|---|
| Which method is closest to typical traffic, in every zone and at every hour? | Google's grid (tier B) | **Answered:** M3 |
| Does the model follow the week's rises and falls? | The trend test against Google | **Answered:** in the metros, yes; elsewhere it swings too much |
| How far off are M3 and Google themselves against real trips, and what should the town and rural values be? | Timed trips (tier A) | **Open** |

It is finished when:
- the rubric is agreed, and the scorecard carries the date;
- Google's raw answers are deleted within 30 days of each collection;
- 30 to 60 timed trips are recorded, each checked against its GPS track, with Google's prediction for the same departure;
- Google's own error is measured per zone, so each zone's November results are either confirmed or marked "indicative only";
- M5, the model refitted on the calibration side, is scored against M3 on the test side, and the agreed rule decides whether the app changes;
- the benchmark's tables and charts are filled in, and the summaries, `docs/SUMMARIES/eta_benchmark.md` and `docs/SUMMARIES/eta_model.md`, say what was found.

---

### The steps at a glance

| Step | What | When | Time | Needs |
|---|---|---|---|---|
| 1 | Close the open checks: the key's quota and budget alert, and the guide's reading of Google's terms | By Sunday 8 November | 30 minutes, plus the guide's reading | Console access; the project guide |
| 2 | Agree the rubric (phase 1), including the new rules for the timed trips | By Friday 13 November | A 1-hour meeting | The team |
| 3 | Make the scorecard re-computable from saved metrics, then purge Google's November answers | Build by Friday 20 November; purge on Monday 30 November (deadline Thursday 3 December) | 2 hours | Nothing |
| 4 | Build the trip picker, importer, GPS check, rain lookup, Google asks for trips, and M5's fit | 16 November to Friday 4 December | About 2 days | Nothing |
| 5 | Plan the trips; ask Google for each trip, and optionally for a December grid | 30 November to 11 December | 2 hours, then 10 minutes twice a week | The team's base and cars |
| 6 | Drive the timed trips (phase 4) | Weekends of 12–13 and 19–20 December, weekday evenings between; buffer 2–3 January | Two weekends plus evenings | At least two team members with a car or a taxi budget |
| 7 | Analyse; fit M5 (phase 5) | Monday 4 to Friday 8 January 2027 | About a day | Nothing |
| 8 | Decide; change the app only if M5 wins | By Monday 11 January | Half a day if it changes | Nothing |
| 9 | Write it up (phase 6) | By Friday 15 January | Half a day | Nothing |

The dates assume no exams in December. If the trip weekends move, steps 5 and 7 move with them, and so does the December grid's deadline (step 5).

---

### Step 1 · Close the open checks

**Why:** two things the benchmark asked for before the November collection weren't recorded. One protects against a bill, and the other against breaking Google's terms.

1. **The key** (Google Cloud console, APIs & Services, Credentials): check that it is restricted to the Routes API.
2. **A daily limit:** on the Routes API's quotas page, set the lowest daily limit the console offers for route matrix requests. Raise it only on a collection day, to a little above that day's planned requests.
3. **A budget alert** (Billing, Budgets & alerts): a budget of ₹100 for the project, with alerts at 50%, 90% and 100%.
4. **The guide reads Google's current terms:** the Maps Platform Terms of Service and the Routes section of the Service Specific Terms. Three questions to answer:
   - may aggregate results (error tables, R², amplitudes) appear in the report and the slides;
   - is deleting the raw answers within 30 days enough;
   - is any Google curve or per-trip number barred, as the benchmark assumes?
5. **Record** the date and the answers in the benchmark, under "Rules for using Google's data".

**If the guide says no to aggregates:** purge at once (step 3's purge, without waiting for its build). Then report the benchmark from the timed trips only, and keep the Google results as an internal check.

**Done when:** the three items are recorded in the benchmark, with the date.

---

### Step 2 · Agree the rubric (phase 1)

**Why:** the rubric was meant to be fixed before any results. The Google results came first, so the team now confirms it, and marks any change as made after the results. The rules for the timed trips (item 5 below) must be fixed before any trip is driven.

**Before the meeting,** each member reads, in the benchmark:
- "The rubric";
- "How the bench reads the rubric";
- the scorecard under "The Google run, 4 November 2026".

**Agenda,** one decision per item:
1. **The weights and anchors,** C1 to C9.
2. **The decision rule,** rules 1 to 5, including the 5-point tie band.
3. **The bench's readings:**
   - C1 levels 3 and 4 need every zone and the evening peak measured;
   - C3's "every zone" means zones with pairs that show a clear pattern;
   - C4 and C5 score 4 for methods that call nothing;
   - C4 times the request, not the public server's one-a-second slot;
   - a gate not yet checked counts as failed;
   - rules 4 and 5 are read as the benchmark states;
   - ablations are never chosen;
   - the split is by origin.
4. **The judged gates and scores** C6 to C9 per method (the table in "How the bench reads the rubric").
5. **The rules for the timed trips,** new:
   - **(a) When M5 replaces M3.** Proposed:
     - on the test side of the timed trips, M5's MAPE is lower, with a paired Wilcoxon p < 0.05;
     - its bias is no further from 0;
     - if a December grid is collected (step 5), M5's rubric total on it is no more than 5 points below M3's.

     Otherwise M3 stays, and M5's values are reported as a finding.
   - **(b) When Google is too far off in a zone.** Proposed: Google's MAPE against that zone's timed trips is over 15%, on at least 5 trips. That zone's November results are then reported as indicative only. A zone with fewer than 5 trips is "not checked".
   - **(c) What M5 may refit:** at most three values. In order:
     1. the rural free-flow speed (57.8 km/h today);
     2. the town congestion scale (0.73) or the town free-flow speed;
     3. the city congestion scale (0.89).

     A value is refitted only if its zone has at least 5 trips on the calibration side.
   - **(d) Whether to collect the December grid** (step 5): 4,167 elements within December's free 5,000.

**Record:**
- In `etaRubric.js`, set `RUBRIC_AGREED_ON` to the meeting's date.
- Under "The rubric" in the benchmark, add a dated line. Either "Agreed on …, after the Google results of 4 November were seen; unchanged since", or a list headed "Changed after the results", with each change and its reason.
- Add items 5(a) to (d) to "How the bench reads the rubric".
- Re-score, so the scorecard prints the date. Before the purge, use `node eta-bench.mjs --google`; after it, use step 3's `--rescore`.

**Done when:** the scorecard's rubric line shows the date, and 5(a) to (d) are in the benchmark.

---

### Step 3 · Make the scorecard re-computable, then purge

**Why:** Google's November answers must go by 3 December, 30 days after they were asked for on 4 November. After the purge, `--google` can't re-run the November trips. But the rubric may still need re-applying to them, for example after a change agreed in step 2, or once M7 has an operational run. The scorer needs only `metrics.json`, `trend.json` and the newest `ops/` file, and the purge keeps all three.

**Build** (about 2 hours):
1. **`node eta-bench.mjs --rescore <run folder>`** writes that folder's `scorecard.md` from its `metrics.json`, its `trend.json` and the newest operational run. It reads no trips and no cache.
2. **Check it before the purge:** `--rescore data/runs/2026-11-04-google` must write the same `scorecard.md` as `--google` did. Compare the two files.

**Last chance for Google's per-trip minutes.** Anything not already in the kept files must be computed before the purge. The kept files are:
- `metrics.json`, `trend.json` and `scorecard.md`;
- `methods.csv`, `mape_by_stratum.csv`, `mape_by_zone_band.csv`, `error_cdf.csv`, `regret_by_urgency.csv`, `trend_by_zone.csv` and `trend_week.csv`.

Agree in step 2 whether any other cut of the data is wanted. Keep the November sample as `data/trend_pairs_2026-11-09.json` before step 5 rewrites `trend_pairs.json`.

**Purge** on Monday 30 November: `node eta-google.mjs --purge`. Then check that:
- `cache/google.ndjson` is gone;
- `predictions.ndjson` and `predicted_vs_actual.csv` are gone from `runs/2026-11-04-google/`;
- `--rescore` still writes the scorecard;
- `cache/google_usage.ndjson`, the element counts, is kept.

Record the date in the benchmark, under "The Google run, 4 November 2026".

**Done when:** the purge is recorded, and `--rescore` works on the purged folder.

---

### Step 4 · Build what the timed trips need

About 2 days of work, from 16 November, finished by Friday 4 December so the first trips can be planned. Every piece reads and writes `data/`, and each is unit-tested.

**4a · The trip picker:** `node eta-trips.mjs --plan --base <latitude,longitude> [--count 60]`.
- **Origins:** banks whose name marks a hospital, within a day's drive of the base. It uses the same `HOSPITAL_NAME` rule as `eta-sample.mjs`.
- **Destinations:** banks a ranked search from that origin would list, using the same rings and the same wrong-state rule.
- **Planned trips** are spread over the quotas in step 5, each with a planned departure in India time.
- **Output:** `trip_plan.json`. It calls no outside service.

**4b · The importer and the GPS check:** `node eta-trips.mjs --import <sheet.csv> [--gpx <folder>]`.
- **The sheet:** one row per trip, with the columns of "How a timed trip is recorded" in the benchmark. The importer converts it to `trips.ndjson`.
- **Checks:**
  - every time is in India time, with `+05:30`;
  - departure comes before arrival;
  - minutes are between 1 and 300;
  - both points lie in India and in their own state;
  - the vehicle is a car or taxi;
  - flags are from the known list.
- **With the GPS tracks:**
  - the trip starts at the last track point within 50 m of the origin's gate, and ends at the first within 50 m of the bank's gate;
  - a trip is flagged when its tracked time differs from the logged one by more than 2 minutes;
  - a trip is also flagged for a stop of 5 minutes or more below 2 km/h, away from both gates.
- **It prints** the counts per zone, band, distance and driver against the quotas.

**4c · Rain for each trip:** each trip's `rainMmPerHour` comes from Open-Meteo's historical weather API: hourly rain at the origin, for the departure hour. The answers are cached in `cache/weather.ndjson`. The archive lags real time by a few days (check the current delay), so import each weekend's trips a week later, or fill rain in on a second pass.

**4d · Google for the timed trips:** `node eta-google.mjs --trips <trip_plan.json> [--plan]`.
- **What it asks for:** each planned trip whose departure is 3 to 7 days ahead, at that departure, with the November settings (`TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`).
- **Bookkeeping:** the same cache, usage ledger and 95% cap guard as the sample. `--plan` prints the count and sends nothing. About 60 elements in all.
- **In the bench:** a timed trip whose pair and departure are in the Google cache gets Google's minutes alongside. The bench then reports, per zone, Google's own MAPE and bias against the trips, as aggregates.

**4e · M5:**
- **Separate speeds:** `createTrafficModel(profiles, { detourFactor, zoneScale, freeFlowKmh })`, where `freeFlowKmh` can override the city, town and rural speeds. Today the town speed is halfway between the Indian average and the highway speed, so refitting the highway speed alone would also move towns; the override keeps them apart.
- **A test:** with no overrides, the model's answers stay exactly the same. `tests/traffic.test.js` already checks that the factory and the app agree.
- **The fit:** `node eta-fit.mjs` reads the calibration side of `trips.ndjson`. It runs a grid search over the values step 2 allowed, minimising the mean of (ln predicted − ln observed)². Example ranges:
  - rural speed 35 to 70 km/h, in steps of 0.5;
  - town and city scales 0.3 to 1.0, in steps of 0.01.
- **Intervals and output:** it refits on 1,000 resamples of origins for 90% intervals, and writes `m5_fit.json` with the values, intervals, trip counts and date. It never reads Google's answers (the benchmark's E10).
- **The M5 adapter** in `eta-methods.mjs` reads `m5_fit.json`, with M3's judged gates and scores.

**4f · Tests** (Vitest), each with a test file:
- the importer's checks;
- the GPS start, end and stop flags on a synthetic track;
- the fit recovering known values from synthetic trips;
- the factory with no overrides.

**4g · A dry run of the whole chain.** Make 40 synthetic trips, from M3's minutes with the rural trips 25% slower and some noise added. Then run them through every step:
1. the import;
2. `eta-google.mjs --trips --plan`;
3. the bench;
4. the fit, which should recover the 25% within its interval;
5. the scorecard.

**Done when:**
- lint, the format check and the tests pass;
- the dry run recovers the planted value;
- `docs/CODE_REFERENCE.md` and `CLAUDE.md` list the new scripts and options.

---

### Step 5 · Plan the trips and ask Google

**5a · The base.** The team's city, plus one day-trip direction that takes in towns and open highway. Rural trips are the ones that matter most: the rural speed is the model's largest known error.

**5b · The list.** Run the picker, then check every trip by hand:
- the route is safe;
- there is parking at both gates;
- it doesn't enter a hospital's emergency area;
- night trips happen only with two people in the car.

**5c · Quotas.** Each trip counts once in each part of the table.

| Part | Group | Target | Minimum | Why |
|---|---|---|---|---|
| Zone | metro or city | 25 | 12 | The base's own streets |
| Zone | town (3 to 10 banks within 15 km) | 12 | 6 | The town scale: M3's swing there is 1.42 times Google's |
| Zone | rural (0 to 2 banks) | 12 | 6 | The rural speed: M3 is 28% too quick there |
| Time | evening peak, 17:00 to 20:00 | 15 | 8 | C1 needs the peak band |
| Time | midday, 11:00 to 15:00 | 10 | 5 | |
| Time | the rest of the day | 15 | 8 | |
| Time | night, 00:00 to 05:00 | 5 | 0 | Only with two people; otherwise reported as untested |
| Distance | under 5 km | 10 | 6 | M3 is 24% too quick there |
| Distance | 5 to 15 km | 15 | 8 | |
| Distance | 15 to 40 km | 15 | 8 | |
| Distance | over 40 km | 10 | 5 | |
| Who | drivers | 2 or more | 2 | Bias is reported per driver |
| Who | origins | 10 or more | 8 | The split is by origin, so few origins means a small test side |

**Why the benchmark's "10 to 15 trips on trend-test pairs" is replaced.** The 40 trend-test pairs are spread over 8 or 9 states per zone, out of a car's reach. Instead, every timed trip gets Google's prediction for its own departure (step 4d), so Google's error is measured on all of them.

**5d · Google for the trips.** Run `node eta-google.mjs --trips trip_plan.json` every Monday and Thursday from 7 December. Each run asks for the trips 3 to 7 days ahead. Raise the console's daily limit (step 1) before each run.

**5e · The December grid, if step 2 agreed it.** The same 40 pairs and saved searches for the week of Monday 14 to Sunday 20 December. It gives a second month to confirm November's results, and a Google reference to score M5 on.
1. Keep November's sample (step 3).
2. Run `node eta-sample.mjs --week 2026-12-14`. It picks the same pairs with the new dates.
3. On Friday 11 December, the last day 3 days ahead, run `node eta-google.mjs --plan`, then `node eta-google.mjs`.

Budget and deadline:
- **The budget:** 4,107 elements plus about 60 for the trips, within the guard's 4,750 for December.
- **The deadline:** these answers must be scored by Friday 8 January and purged by Sunday 10 January, 30 days after they are asked for.
- **If the trip weekends move later,** move the grid week with them, keeping it out of 24 December to 1 January.

**Done when:** `trip_plan.json` meets the minimums, and each trip's Google ask is in the cache before it is driven.

---

### Step 6 · Drive the timed trips (phase 4)

On the weekends of 12–13 and 19–20 December, with weekday evening trips between. 2–3 January is the buffer. Avoid 24 December to 1 January, when holiday traffic isn't typical; flag any trip made then.

**Before each day:**
- the day's list from `trip_plan.json`;
- phones charged, with the GPS logger installed and tested;
- the shared sheet open.

**Each trip,** as "How a timed trip is recorded" in the benchmark describes:
1. Start the logger at the origin's gate, and note the departure to the minute.
2. Drive normally, by the usual route. This is not an emergency drive.
3. Note the arrival at the bank's gate.
4. Note stops, wrong turns and the weather.
5. Flag anything unusual. A flagged trip is kept, but not scored.

**After each day:**
- fill in the sheet the same evening;
- import it with `--import` and the day's tracks, and read the report;
- fix logging slips while they are fresh.

**After the first weekend,** compare the counts with the quotas, and move the second weekend's trips to fill the gaps.

**If there are fewer than 30 trips by 20 December,** use the buffer. If there are still fewer than 30, the timed trips are reported as indicative only, M3 stays, and M5 is fitted only as a finding.

**Done when:** at least 30 unflagged trips are imported, with tracks, rain and Google's predictions.

---

### Step 7 · Analyse and fit M5 (phase 5)

Monday 4 to Friday 8 January 2027, about a day.

1. **Finish the import.** Fill in rain for the last trips (step 4c), and re-run `--import`.
2. **Score M0 to M3 on the timed trips:** `node eta-bench.mjs data/trips.ndjson`. Leave out `--sets`: timed trips can't time every bank in a candidate set, so ranking fidelity stays with Google's grids.
3. **Google's own error, per zone** (rule 5(b) of step 2). Zones over 15% have their November results marked "indicative only" in the benchmark and the summary.
4. **Fit M5:** `node eta-fit.mjs`. Check each value:
   - **at the edge of its range:** the range was wrong, or the zone's trips are too few. Widen the range or drop the value.
   - **with a wide interval:** report it as such.
5. **Score M5** with the others:
   - **on the test side of the timed trips;**
   - **on the December grid, if collected:** `node eta-bench.mjs --google`, with December's sample, by 8 January. Then purge December's answers by 10 January.
6. **Apply rule 5(a)** from step 2.

**Done when:** the run folders hold the timed-trip scorecard, Google's per-zone error and M5's values with intervals.

---

### Step 8 · Decide, and change the app only if M5 wins

**If M3 stays:** record "M5 not adopted", with its values and intervals, as a finding about the model, in the benchmark and the summary.

**If M5 wins:**
1. **The values:** keep TomTom's measured figures in `assets/traffic_profiles.json` as they are. Add the fitted speeds and scales as constants in `src/lib/trafficModel.js`, each with a comment citing the timed trips and `m5_fit.json`.
2. **Tests:** update the expectations in `tests/traffic.test.js`. Then run lint, the format check, the tests and the build.
3. **Docs:**
   - the zone table in `docs/SUMMARIES/eta_model.md`;
   - a dated note in `docs/SUMMARIES/eta_model.md` (D2.3, the rural assumption, now calibrated);
   - the travel-time section of `CLAUDE.md`;
   - `docs/CODE_REFERENCE.md`.
4. **No new Google scoring:** the new values come from timed trips only (E10).

**Done when:** the decision and its evidence are recorded, and any change passes every check.

---

### Step 9 · Write it up (phase 6)

By Friday 15 January.

1. **The benchmark:**
   - fill in the tables under "How to present it": the methods table, and the trend table with Google's own error per zone;
   - write the viva sentence;
   - mark the phases done.
2. **Charts,** from the kept CSVs, with Google credited on each:
   - amplitude by zone, with a line at 1;
   - MAPE by zone and time band;
   - the error distribution;
   - regret by urgency;
   - ablation bars;
   - one metro pair's week with M3, M1 and M2 only, giving Google's peak hours and swing as numbers.

   Predicted against true minutes is drawn for the timed trips only.
3. **Everywhere the result is quoted:**
   - [the summary above](#summary-the-eta-benchmark);
   - [`eta_model.md`](eta_model.md), if the values change;
   - `docs/deliverables.md`, report 3's point 2;
   - `docs/plans.md`, item 8;
   - `CLAUDE.md`.
4. **Two or three slides** for the final review: the methods table, the zone chart and the decision.

**Done when:** no table in the benchmark is a template, and every document quotes the same figures.

---

### Later, optional

| What | When | How | What it changes |
|---|---|---|---|
| **M7, self-hosted OSRM** | Before real traffic, with deployment (`docs/plans.md`, item 9) | Docker `osrm-backend` with Geofabrik's India extract (8 to 12 GB of memory to prepare), `OSRM_URL` pointed at it, then `--ops` and `--rescore` | The same answers as M3 for the same map date. C9 rises to 3 with a pinned data date, worth 1.25 points |
| **Latency from the deployed server** | Once deployed | `--ops` from a machine in the deployment's region | C4 measured where the app runs, not from a laptop |
| **M4, OpenRouteService; M6, a paid traffic-aware matrix** | Only while a Google grid is held (within its 30 days) | An adapter each, G1 checked against their terms first; rule 4 for a paid one | Whether another engine beats M3 |
| **A monsoon run** | A week in July to September 2027 | A new Google sample in that month's free allowance | Tests the seasonal factor. Rain still needs rainy timed trips |

---

### Risks

| Risk | Effect | What to do |
|---|---|---|
| The team can't reach towns or rural roads | M5 can't refit the rural speed, the largest error | Keep 57.8 km/h; report Google's direction and the gap; try one day trip on a highway |
| Fewer than 30 trips | The timed trips can't decide | Report them as indicative; M3 stays |
| The guide reads Google's terms as barring aggregates | The Google results can't be published | Purge at once; publish the timed trips only (step 1) |
| Exams or holidays move the trip weekends | The December grid's deadline slips | Move the grid week with the trips (step 5e) |
| Open-Meteo's archive lags | Rain is missing at import | Import a week later, or fill rain on a second pass |
| The public OSRM server's map changes between November and January | Small shifts between runs | Methods are compared on the same trips on the same day, so comparisons hold; record `data_version` where given |
| Holiday traffic, 24 December to 1 January | Untypical trips | Avoid those days; flag any trip made then |

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### How well it does: the ETA benchmark, 4 November 2026

The ETA benchmark (`docs/SUMMARIES/eta_benchmark.md`) scored M3 and three other methods against Google's traffic-aware predictions for a coming week (Routes API, `TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`).
- **Google is the reference, not a candidate.** Its terms bar showing its results on the app's non-Google map. Only aggregates are given here, as its terms ask. Results derived from Google Maps Platform data.
- **The sample:** 40 hospital-to-bank pairs, 10 in each zone across 8 or 9 states. Each pair was timed every 2 hours on all 7 days of 9 to 15 November, 3,360 trips in all, 840 per zone. The 52 saved searches were also timed at 02:00, 12:00 and 18:00 on the Wednesday, giving 396 searches to compare rankings on.
- **The cost:** 4,107 elements, within Google's free 5,000 a month, so ₹0.
- **Intervals** are 95%, resampling the 40 origins.

| Method | Average error | Bias | Within 25% | Same first bank as Google's times | Minutes lost by a wrong first pick, p90 | Rubric total /100 |
|---|---|---|---|---|---|---|
| M0: straight line × 1.4 at a fixed 25 or 45 km/h (the original app) | 34.1% | −9.6% | 46.8% | 74.7% | 6.1 | 55.0 |
| M1: straight line × 1.34 with the traffic model (the fallback) | 32.8% | −10.9% | 47.0% | 77.0% | 4.7 | 56.3 |
| M2: OSRM's time, unadjusted | 47.0% | −47.0% | 5.1% | 74.5% | 5.5 | 45.0 |
| **M3: OSRM with the traffic model (what the app uses)** | **24.9%** (20.6% to 29.4%) | **−5.7%** | **56.8%** | **81.3%** | **1.7** | **65.0** |

**Accuracy**
- **M3 is the closest,** and it beats each other method with p < 0.001 (Wilcoxon on paired errors, Holm-corrected).
- **By zone:**
  - metro 20.0% (bias −1.2%);
  - city 23.5% (+8.7%);
  - town 28.0% (−2.5%);
  - rural 28.0% (−28.0%).

  Only the rural trips lean strongly one way: they come out too quick.
- **By time:** 22% to 29% off in every two-hour block. M3 is quicker than Google at night (−15%) and slightly slower in the evening peak (+4.7%). Weekdays, Saturday and Sunday are alike, at 24% to 25%.
- **By distance:** best at 5 to 15 km (15.9%). Under 5 km, trips come out 24% too quick.

**Ranking**
- **M3 picks Google's first bank most often:** in 81.3% of searches, and 82.6% when critical, against 72.7% for M0.
- **A wrong pick costs little:** 1.7 minutes at the 90th percentile, and 1.25 when critical.
- **Its ETA scores are the closest:** off by 6.5 points out of 100 on average, against 11.1 for M0 and 16.9 for raw OSRM.
- **The methods differ in the first choice, not the whole order.** The full order agrees about equally for all four (Kendall's τ 0.86 to 0.89).

**The week's pattern.** This covers the 35 pairs whose week on Google varies by at least 15%.
- **The peaks fall at the right hours.** The median correlation between M3's week and Google's is 0.94 in the metros, 0.86 in cities, 0.74 in towns and 0.67 in rural areas. The weekday peak falls in the same 2-hour slot as Google's for 63% of pairs.
- **The size of the swing matches only in the metros,** with a median amplitude of 1.02 and a trend R² of 0.86. Outside the metros it doesn't match:
  - in cities (1.36) and towns (1.42), M3 swings more than Google, whose week there is flatter;
  - rural pairs swing less (0.76).

  Google may simply have less traffic data outside the metros; the timed trips will tell.
- **Sunday:** in the metros, Google and M3 both make Sunday at 18:00 14% to 16% quicker than Wednesday. In cities and towns, M3 makes it 12% to 14% quicker, against Google's 4%.
- **The mean trend R² is −1.66** (median 0.08). Town pairs pull it down, because their small swing makes any mismatch large. So the trend criterion (C3) scores 0.

**Which parts of M3 earn their place** (each removed in turn):
- **The free-flow floor:** without it, the error is 33.3%. Raw OSRM is 47% too quick.
- **Congestion:** without it, the error is 29.8% and the week is flat.
- **The zone scale:** without it, the error is 23.5% overall, better in rural areas (18.3%) but worse in cities and towns. The rural week then swings 2.1 times as much as Google's.
- **Season and rain** change nothing in one November week with no weather, as expected, so they stay untested.
- **The fallback (M1)** with a 1.58 detour factor for trips under 5 km is 31.6% off, against 32.8% with 1.34 throughout.

**Speed and reliability.** 200 uncached calls went from a laptop in India to the public OSRM server, each with every bank in a place's widest ring (9 to 137 banks). All were answered, with a median of 180 ms and 217 ms at the 95th percentile. The one-request-a-second spacing the public server requires isn't counted, because a search waits for it only when another search came in under a second before.

**The decision.** The rubric weighs:
- accuracy (25 points), ranking (20) and the week's pattern (10);
- latency (10), reliability (10) and cost (10);
- explainability, effort and reproducibility (5 each).

M3 scores 65.0, 8.7 points ahead of M1. That is outside the 5-point band where the simpler method would win, and the lead holds with every weight moved by ±20%. **So M3 stays the app's method.** This is provisional until the team agrees the rubric. M3 loses points in four places:
- accuracy outside the metros;
- ranking (81%, where 90% scores higher);
- the week's pattern;
- reproducibility, since the public server's map data changes with no version to record.

**What it says about the model.** These are directions only. New values will come from timed trips, never from Google's numbers, as its terms require.
- **Rural trips are too quick because of their base speed,** not their congestion. The 57.8 km/h highway free-flow speed is the value to check.
- **Towns may need less congestion than × 0.73,** since their week swings 1.42 times as much as Google's.
- **Trips under 5 km come out 24% too quick.** The timed trips will show whether the model or Google is off.

**Limits**
- **Google is a model too, not a measurement,** and probably weakest in towns and rural areas. 10 to 15 of the planned timed trips will check it.
- **This was one week in November,** with no monsoon and no rain. The season and rain factors stay untested until monsoon or rainy trips exist.
- **The latency was measured from a laptop.** A deployed server's will differ.

**Where the details are:**
- the benchmark, `docs/SUMMARIES/eta_benchmark.md`, under "The Google run, 4 November 2026", and its summary, `docs/SUMMARIES/eta_benchmark.md`;
- report 3's record of the Google check, below;
- the run's files, in `../rough_work/eta_benchmarks/data/runs/2026-11-04-google/` (`scorecard.md`, `metrics.json`, `trend.json` and the chart CSVs).

Google's raw answers are deleted by 3 December 2026. The metrics are kept.

## Report 3's record

### Checked against Google (4 November)

The ETA benchmark (`docs/SUMMARIES/eta_benchmark.md`) names the methods it compares. **This point's design is M3**: OSRM's road route with the free-flow floor (D2.2), the zone's congestion (D2.3, D2.4), season and rain (D2.5). The others:
- **M0** is the rule this point started from: straight line × 1.4 at 25 or 45 km/h.
- **M1** is M3's own fallback when OSRM fails (D2.6): straight line × 1.34 with the same model.
- **M2** is OSRM's time with no adjustment.

The benchmark also runs ablations of M3, each with one part removed.

**How it was measured.** There are no complete records of real Indian trip times, so the reference is Google's traffic-aware prediction (Routes API, `TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`) for the coming week. Google is used as a reference only: its terms bar showing its results on the app's map, and no value in the model is fitted to its numbers.
- **The sample:** 40 hospital-to-bank pairs, 10 per zone across 8 or 9 states each, at distances each zone's searches reach. Each pair was timed every 2 hours on all 7 days of 9 to 15 November: 3,360 trips, 840 per zone, on weekdays, Saturday and Sunday. The 52 saved searches were also timed at 02:00, 12:00 and 18:00 on the Wednesday, for ranking.
- **The cost:** 4,107 elements, all answered, within Google's free 5,000 a month: ₹0.
- **Intervals** resample the 40 origins.

| Method | Average error (95% interval) | Bias | Within 25% | Same first bank as Google's times | Minutes lost by a wrong pick, p90 |
|---|---|---|---|---|---|
| M0 | 34.1% | −9.6% | 46.8% | 74.7% | 6.1 |
| M1 | 32.8% | −10.9% | 47.0% | 77.0% | 4.7 |
| M2 | 47.0% | −47.0% | 5.1% | 74.5% | 5.5 |
| **M3** | **24.9%** (20.6% to 29.4%) | **−5.7%** | **56.8%** | **81.3%** | **1.7** |

- **M3 is the closest, and the gap is real:** it beats each other method with p < 0.001 (Wilcoxon on paired errors, Holm-corrected). This is the measured answer to "why OSRM and not straight lines": the road network and the traffic model together cut the average error from 34% to 25%, and the minutes a wrong first choice costs from 6.1 to 1.7.
- **D2.1 and D2.2 hold.** Raw OSRM is 47% too quick. Without the free-flow floor M3's error rises to 33.3%, and without congestion to 29.8%.
- **By zone:** metro 20.0%, city 23.5% (8.7% slow), town 28.0%, rural 28.0% (28.0% quick). By time, 22% to 29% in every two-hour block: quick at night (−15%), close in the evening peak (+4.7%). Weekdays and the weekend are alike.
- **The week's pattern:** in the metros, M3 follows Google's week closely (median trend R² 0.86, the same peak hours, the same swing). In towns it swings more than Google, whose week there is almost flat. Google may have less traffic data there.
- **The rural assumption flagged in D2.3 is the weak spot,** but the 0.29 scale isn't the problem. Rural trips' base time is a median 28% below Google's, and removing the scale would make their weekly swing twice Google's. The highway free-flow speed (57.8 km/h) is what to calibrate, from timed trips.
- **It stays the app's method.** The benchmark's rubric also weighs latency, reliability, cost and effort before declaring a winner. Over 200 uncached calls to the public OSRM server, each with every bank in the widest ring, all succeeded, in 217 ms at the 95th percentile. On the rubric, M3 scores 65.0 of 100, against 56.3 for M1, 55.0 for M0 and 45.0 for M2. Its lead holds with each weight moved by ±20%. The team still has to agree the rubric, so the result is provisional. The full results are in `docs/SUMMARIES/eta_benchmark.md`, under "The Google run, 4 November 2026", and the summary in `docs/SUMMARIES/eta_benchmark.md`.

### Point 4: the ETA accuracy test

**ETA accuracy**, the calibration flagged in point 2. `docs/SUMMARIES/eta_benchmark.md` now plans it in full: a rubric fixed before any results, timed trips as the truth, and Google's traffic-aware predictions as a reference for the week's pattern. In short:
- **Collect:** timed trips by car or taxi in each zone (metro, city, town, rural) at night, midday and the evening peak, plus Google's predictions for the same weekday and time through its Routes API.
- **Measure:** mean absolute error, mean percentage error and bias, by zone and hour, and whether each method picks the same first bank as the true times.
- **Adjust:** `ZONE_SCALE` and the town and rural free-flow speeds from the timed trips only, until the percentage error is under 25% everywhere. Google's numbers are used to score, never to tune (the plan's decision E10).
- **Save:** the trips go in `../rough_work/eta_benchmarks/data/` as a regression test.

> **Status, 4 November 2026.** The benchmark is built (`../rough_work/eta_benchmarks/eta-bench.mjs` and the modules it uses), and its Google half and the latency run are done: point 2's design, M3, is 24.9% off Google's predictions on average, the closest of four methods, and wins on the rubric with 65.0 of 100 ([point 2](#checked-against-google-4-november)). The timed trips are still to come.
