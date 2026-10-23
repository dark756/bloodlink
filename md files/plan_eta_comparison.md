# Plan: a rubric and test bench for comparing ETA methods

**Status: PLAN, not started.** Nothing here has been built or measured. Every number in a results cell below is a placeholder or a figure already measured in `report3.md`, and says which.

- Paths are relative to `bloodlink/` unless they start with `../`.
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

## Why

- **The reviewer asked for OSRM and a time-aware ETA** (report 3, point 2). That is built, and argued for, but not measured against real trips. Report 3 itself flags the gap: the town free-flow speed and the rural congestion scale (0.29) are assumptions "flagged for calibration", and point 4 sets a target of under 25% error in every zone.
- **"Why OSRM and not plain Haversine?"** is the obvious viva question. Today the answer is an argument (road networks, rush hours). A measured table, with the old straight-line method as a baseline, turns it into evidence.
- **Does the model follow the week's traffic?** The time-of-day model is what M1 and M3 add over a fixed speed, and it rests on TomTom city profiles and scaled guesses for towns. Google's traffic-aware predictions for the same trips at every 2-hour slot of a week give a large reference for that pattern, which a few timed trips can't ([the Google trend test](#the-google-trend-test)).
- **A rubric keeps the choice honest.** Accuracy alone would pick a paid, traffic-aware API. Cost, licence, privacy and reliability matter as much for a public emergency tool, and a rubric written before the results makes those trade-offs explicit.

---

## What the ETA is for

The evaluation has to match how the app uses the number, in three places:

1. **The ranking.** `etaScore = 100 · e^(−minutes / τ)` with τ = 30, 45 or 60 minutes, weighted 0.25 to 0.45 (`src/lib/ranking.js`). So what matters most is:
   - the **order** of the banks within one search (relative error);
   - the absolute minutes only through τ: a 10-minute error costs a bank 28% of its ETA points when critical, 20% when urgent and 15% when routine.
2. **The display:** "6.2 km by road · about 24 min now". Here the absolute number matters, and a bias towards optimism is worse than one towards caution.
3. **The ring and plan don't use the ETA.** Rings are chosen by straight-line distance, so the ETA method can't change which banks are candidates, only their order and the plan.

So the bench scores **absolute accuracy** (for the display) and **decision accuracy** (for the ranking) separately. A method can be 30% off in minutes and still rank banks perfectly, if it is off by the same factor for all of them.

---

## The methods to compare

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

## Ground truth

There is no free, complete record of real Indian trip times. The plan uses three tiers, each checking the one below it.

| Tier | What | How many | Strength | Weakness |
|---|---|---|---|---|
| **A · gold** | **Timed trips:** a team member travels from an origin to a bank by car or taxi and logs the time with a phone GPS app | 30 to 60 | Real, at a real time of day | Few; one driver's behaviour; slow to collect |
| **B · silver** | **Google's traffic-aware prediction** for the same weekday and time, from the Routes API (`TRAFFIC_AWARE_OPTIMAL`, `BEST_GUESS`), asked a few days ahead. Google Maps' "Depart at" range written down by hand only as a small fallback | 240 to 480 trips, plus the trend grid of 3,360 | Many, every zone and hour | A model, not a measurement |
| **C · sanity** | Published averages: TomTom city travel times per 10 km, ambulance response studies | A handful | Independent | Too coarse to score a single trip |

How they are used:
1. **Tier A validates tier B.** On the trips that have both, measure tier B's own error. If B is within about 15% of A, it is fit to score the methods at scale.
2. **Tier B scores every method**, with enough trips for each zone and time band.
3. **Tier A re-scores the shortlist,** so the final choice never rests on a model alone.
4. **Tier C** only catches gross errors, such as a method claiming 60 km/h through central Mumbai at 6 pm.

**The circularity rule.** A provider used as the reference must not also be scored as a candidate against it. Google is the reference and fails G1 as a candidate, so the rule is met. If another provider is ever used as the reference, the same rule applies to it: score that provider on tier A only.

**Terms of use.** Google's terms limit how its results may be collected, stored and published; the rules this plan follows are under [Rules for using Google's data](#rules-for-using-googles-data). Recording a small sample by hand from the Google Maps app, for an academic evaluation, is a grey area; if it is used at all, say so in the report.

### Which trips

Trips should look like the searches the app answers, so origins and destinations come from real use:
- **Origins:** hospitals, since requests come from them. Take them from the directory and the data.gov.in list.
- **Destinations:** the banks a ranked search from that origin actually lists. `scripts/ranking-sensitivity.mjs --capture` already saves 52 such candidate sets across 13 places.
- **Strata:**

| Dimension | Levels |
|---|---|
| Zone (`trafficZone`) | metro, city, town, rural |
| Time band (India time) | night 00:00 to 05:00, midday 11:00 to 15:00, evening peak 17:00 to 20:00 |
| Day | weekday, Sunday |
| Distance | under 5 km, 5 to 15 km, 15 to 40 km, over 40 km |

- **How many.** Report 3 asked for at least 20 trips per zone and time band, which is 240. The tighter figure: to tell apart two methods whose average percentage errors differ by 5 points, when the paired differences have a spread of about 15 points, needs about (1.96 + 0.84)² × 15² / 5² ≈ **71 paired trips** per comparison. 240 trips are enough overall; 480 (40 per cell) give usable per-zone figures. Tier A can't reach this, which is why it validates rather than scores.

### How a timed trip is recorded

- **Vehicle:** car or taxi, not a two-wheeler, because the model estimates a car.
- **Start and stop:** the origin's gate to the bank's gate. Record departure time to the minute, in India time.
- **Logger:** any GPS app that exports GPX, so the route can be checked afterwards.
- **Notes:** stops (fuel, a wrong turn), weather, anything unusual. A trip with a long unplanned stop is kept but flagged and left out of scoring.
- **Safety:** this is not an emergency drive. Normal speeds, normal routes, and no entering hospital areas beyond the gate.

One line per trip in `../blood_data/eta_calibration/trips.ndjson`:

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

## The Google trend test

**The question:** which method best follows how travel time rises and falls across the week, with the morning and evening peaks, quiet nights and lighter Sundays? The trip tests can't answer it. A method can get the base time right while ignoring the clock (raw OSRM, M2) and still score a fair average error.

**Why Google.** For a future departure, Google's traffic-aware routing predicts a trip's time from its historical traffic data, for any hour of any day. No other source the project can reach gives that many time-stamped predictions for Indian roads. Google is the **reference**, never a candidate (it fails G1; see [the methods](#the-methods-to-compare)).

**A reference, not the truth.** Google's predictions are a model too, probably weakest in towns and rural areas, where fewer phones report traffic. So 10 to 15 of the tier A timed trips are driven on trend-test pairs at trend-test times, to measure Google's own error. If Google is more than about 15% off those trips in a zone, that zone's trend results are reported as indicative only.

### Design

| Choice | Value | Why |
|---|---|---|
| **Pairs** | 40 fixed hospital-to-bank pairs: 12 metro (Mumbai, Delhi, Bengaluru), 10 city, 10 town and 8 rural, spread over the four distance bands | Every zone, including the town and rural scales report 3 flagged |
| Where pairs come from | Origins are hospitals; destinations are banks from the saved candidate sets (`ranking-sensitivity.mjs --capture`) | Trips the app actually times |
| **Time grid** | Every 2 hours (00:00, 02:00 … 22:00 India time) on every day of one coming week: **84 slots per pair** | Shows both daily peaks and the weekday-against-Sunday difference |
| When to ask | All at once, 3 to 7 days before that week | For future departures Google uses historical patterns. Close to now it mixes in live traffic, which our model doesn't have |
| **API settings** | Routes API `computeRouteMatrix`, `routingPreference: TRAFFIC_AWARE_OPTIMAL`, `trafficModel: BEST_GUESS`, `departureTime` set to each slot | Only `TRAFFIC_AWARE_OPTIMAL` accepts a traffic model. It allows 100 elements per request, so one request per origin and slot is enough |
| **Range** | `PESSIMISTIC` and `OPTIMISTIC` as well, for 8 pairs (2 per zone) | A band to judge whether a method's swing is plausible |
| Our model's inputs | `now` = the slot's time; rain factor 1; the month of the queried week | Google's future prediction knows no weather, so rain is left out on both sides |
| **Methods scored** | M1, M3 and the ablations (M3 − congestion, M3 − zone scale, M3 − floor); M0 and M2 for completeness; M4 and M6 (TomTom or HERE) if built | The time-blind methods score 0 by construction, which is itself a result |

### Budget

| Use | Elements |
|---|---|
| Trend test, `BEST_GUESS`: 40 pairs × 84 slots | 3,360 |
| Trend test ranges: 8 pairs × 84 slots × 2 models | 1,344 |
| Tier B absolute trips | 480 |
| Ranking fidelity: about 20 candidate sets × 16 banks × 3 time bands | about 960 |
| **Total** | **about 6,150** |

- **Free cap.** Google's pricing table lists 5,000 free a month for the Pro route-matrix SKU, and a localized copy lists 35,000 for India-billed accounts. Neither is confirmed for this setting, so check which SKU `TRAFFIC_AWARE_OPTIMAL` matrix calls bill under before running.
- **If the cap is 5,000:** run the trend test in one calendar month and the rest in the next, or cut the ranges to 4 pairs (672 elements).
- **Guard against a bill.** A billing account with a card is needed even inside the free cap. Restrict the key to the Routes API, set a daily quota in the Google Cloud console a little above the planned run, and add a budget alert, so a bug can't run up charges.

### Trend metrics

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

### Rules for using Google's data

The official terms page couldn't be loaded while writing this plan. These rules come from Google's Routes documentation, a reproduction of the terms and a Google forum thread (see [sources](#sources)), so have the project guide read the current terms before collection.
- **Only through the official Routes API,** with a key. Never copy results from the Google Maps website or app with a script.
- **Keep raw results only as long as the terms allow.** The Routes terms quoted allow latitude and longitude to be cached for up to 30 days and say nothing quoted about durations. To be safe, delete the raw durations in `cache/google.ndjson` within 30 days and keep only the computed metrics.
- **Publish aggregate metrics, not Google's numbers.** A forum reply quotes a Google FAQ saying no Google Maps Platform data may be included in a document. The report shows R², amplitude, level and error tables, and our own methods' curves. Check before printing Google's own curve.
- **Score with Google; don't tune to it.** The terms bar creating content from Google Maps content. Google can show that a parameter is off; its new value is set from the timed trips (tier A), and the report says so. M5 is fitted on tier A only.
- **Credit Google** wherever results derived from it are shown.

---

## The rubric

Two stages: **gates** a method must pass to be considered at all, then **weighted criteria** scored on anchored scales. The rubric, weights and decision rule are fixed **before** any results are seen, and committed to the repository with that date.

### Stage 1: gates (pass or fail)

| Gate | Pass when |
|---|---|
| G1 · Licence | Its terms allow this use: a public, non-commercial emergency search, shown on the app's Leaflet and CARTO map, with results cached as long as `routing.js` caches them (24 h today). Google fails this gate: its Routes content must not be used with a non-Google map |
| G2 · Privacy | It doesn't need more than the search pin (rounded to about 100 m) and bank positions. It must not need a user id or a phone number. (Today `parseCoordinates` in `src/lib/eraktkosh.js` rounds the pin to 4 decimals, about 11 m, and `routing.js` sends that to the public OSRM server; rounding to 3 decimals, about 110 m, is a cheap improvement worth making whatever wins.) |
| G3 · India coverage | It returns a route for at least 95% of the bench's trips |
| G4 · Fallback | When it fails, the app can still answer (M1 behind it, as today) |
| G5 · Budget | Running it for the demo and the evaluation costs nothing beyond a free tier, or the team has agreed the spend |

A method that fails a gate is still reported, with the reason, because "the most accurate option fails on licence" is a finding worth showing.

### Stage 2: weighted criteria

Each criterion is scored 0 to 4 against the anchors below, multiplied by its weight, and summed to a score out of 100.

| # | Criterion | Weight | 4 | 3 | 2 | 1 | 0 |
|---|---|---|---|---|---|---|---|
| C1 | **Absolute accuracy:** MAPE on test trips, in every zone and in the evening peak band | 25 | ≤ 15% in every zone and in the peak band, and \|bias\| ≤ 5% | ≤ 25% in every zone and in the peak band (report 3's target) | ≤ 25% overall, with one zone or the peak band above | 25% to 40% overall | > 40% |
| C2 | **Ranking fidelity:** first choice matches the ranking under true times | 20 | ≥ 95% | ≥ 90% | ≥ 80% | ≥ 70% | < 70% |
| C3 | **Trend capture:** mean trend R² against Google over the pairs with a clear pattern ([the trend test](#trend-metrics)) | 10 | ≥ 0.8, and ≥ 0.6 in every zone | ≥ 0.6 | ≥ 0.4 | ≥ 0.2 | < 0.2, including every time-blind method |
| C4 | **Latency:** 95th-percentile time for one search's table (up to 38 banks) | 10 | ≤ 300 ms | ≤ 1 s | ≤ 3 s (`MAX_QUEUE_WAIT_MS`) | ≤ 6 s (`TIMEOUT_MS`) | > 6 s |
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

### The decision rule, agreed before the results

1. Drop methods that fail a gate.
2. Among the rest, the highest total wins.
3. **If two totals are within 5 points, take the simpler and cheaper one** (lower C6 + C8 cost, then higher C9).
4. A paid method is adopted only if it beats the best free one by at least 10 points **and** clears C1 at level 3 where the free one doesn't.
5. Whatever wins must beat M0 on C1 and C2. If it doesn't, the road network isn't earning its complexity, and that is the finding.

---

## Metrics

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

## The test bench

### Files

| File | What it does |
|---|---|
| `scripts/eta-bench.mjs` (new) | Runner: reads trips, calls each method, saves predictions, computes metrics, writes the scorecard. `--trend` runs the trend grid instead of the trips |
| `scripts/eta-methods.mjs` (new) | One adapter per method, all with the same interface, plus the Google reference adapter |
| `src/lib/etaMetrics.js` (new, pure) | MAE, MAPE, bias, Kendall's τ, regret, bootstrap, and the trend metrics (level, shape, amplitude, trend R², peak ratio, peak hour, Sunday effect). Unit-tested in `tests/eta-metrics.test.js`, including a flat method scoring R² 0 and a method equal to the reference scoring 1 |
| `../blood_data/eta_calibration/` | `trips.ndjson`, `trend_pairs.json` (the 40 pairs and the queried week), `cache/<method>.ndjson` (raw provider answers), `runs/<date>/` (predictions, metrics, scorecard) |

### A prerequisite: plain Node can't load the traffic model yet

`src/lib/traffic.js` imports `assets/traffic_profiles.json` directly. Checked for this plan with Node 22: importing it from a script fails with `ERR_IMPORT_ATTRIBUTE_MISSING`, because Node needs `with { type: "json" }` on a JSON import. Next and Vitest load it fine, which is why nothing has noticed.

Fix it the way `src/lib/stateBounds.js` already does: export a `createTrafficModel(profiles)` that takes the profiles as an argument, and keep today's exports as thin wrappers bound to the imported file. The bench then evaluates **exactly the code the app runs**, not a copy. Add a unit test that the wrapper and the factory agree.

### The adapter interface

```js
// scripts/eta-methods.mjs
// Each method: { id, label, needs: ["OSRM_URL"] | ["TOMTOM_KEY"] | ["GOOGLE_ROUTES_API_KEY"] | [], estimate }
// estimate(origin, destinations, departAt) resolves to
//   [{ minutes, distanceM, source, raw }]  in the same order as destinations;
//   minutes is null where the method found no route.
```

- **Batching:** trips are grouped by origin and departure time, so each provider sees one matrix call per group, as the app makes one OSRM table call per search.
- **Departure time for the model methods (M1, M3, M5):** pass the trip's `departAt` as `now` to `congestionPercent` and `trafficConditions`. Rain comes from Open-Meteo's historical archive for that place and hour, so the model gets the same weather the trip had.
- **Departure time for traffic-aware APIs (M6 and the Google reference):** they take future departures. Ask for the next date with the same weekday and time ("typical traffic"), 3 to 7 days ahead, and record the date actually asked.
- **The Google reference adapter** calls `computeRouteMatrix` with `TRAFFIC_AWARE_OPTIMAL` and the traffic model per request (`BEST_GUESS`, or `PESSIMISTIC` and `OPTIMISTIC` for the range pairs), one origin and one departure time per request, at most 100 elements. Its key lives in `.env.local` as `GOOGLE_ROUTES_API_KEY`, is read only by the bench scripts and never by app code, and is restricted to the Routes API.
- **Caching:** every provider answer is saved before it is used. A re-run reads the cache, so scoring is free and repeatable, and a paid API is called once per trip at most. Google's raw answers are deleted within 30 days (see [the rules](#rules-for-using-googles-data)); the metrics computed from them are kept.
- **Rate limits:** one gate per provider, reusing the spacing logic of `routing.js` (1 request a second for the public OSRM server).
- **Versions:** each run records the git commit, the date of `assets/traffic_profiles.json`, and OSRM's `data_version` where the response carries it, because the public server's map data changes.

### Outputs

- `predictions.ndjson`: one line per trip and method.
- `metrics.json`: every metric, overall and per stratum, with intervals.
- `trend.json`: the trend metrics per method, per pair and per zone, with the pairs that show no clear pattern listed apart.
- `scorecard.md`: gates, criterion scores, totals, the decision-rule outcome and the rubric's sensitivity check.
- CSV files for the charts listed under [How to present it](#how-to-present-it).

---

## Steps

| Phase | What | Time | Needs |
|---|---|---|---|
| 0 | Fix the traffic-model import (above). Write `etaMetrics.js` and its tests, the runner, and adapters for M0 to M3. Dry run on the 52 saved candidate sets with M3 as a stand-in truth, to test the plumbing | 1 day | Nothing |
| 1 | **Commit the rubric, weights and decision rule** with the date, before any truth is collected | 1 h | The team's agreement |
| 2 | **Google trend test.** Pick the 40 pairs and the coming week; set up the key, its daily quota and a budget alert; run the grid (about 5,000 elements, a few minutes of calls); compute the trend metrics for every method and ablation | 1 day | A Google Cloud billing account with a card, and the guide's reading of the terms |
| 3 | Tier B trips and candidate sets from Google: 240 to 480 trips across zones, bands and days, and about 20 candidate sets for ranking fidelity. In the next calendar month if the free cap is 5,000 | 1 day | The same key |
| 4 | Tier A collection: 30 to 60 timed trips, chosen to overlap tier B, with 10 to 15 on trend-test pairs at trend-test times to check Google itself | Two weekends plus weekday evenings | Team members with a car or taxi budget |
| 5 | Split, fit M5 on tier A's calibration trips, run the bench, ablations, statistics, scorecard, rubric sensitivity. Delete Google's raw answers once the metrics are saved | 1 day | Nothing |
| 6 | Write it up for the report; if the winner isn't M3, plan the change in `routing.js` and `traffic.js` | Half a day | Nothing |

If time is short, phases 0, 1, 2 and 5 already answer "which method follows the trend best"; phase 3 adds absolute accuracy and ranking fidelity at scale, and tier A then becomes "planned".

---

## How to present it

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

## Decisions and alternatives

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

## Risks and limits

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

## Sources

- `md files/report3.md`, point 2 (the model and its measurements: 1.34 detour, 65 km/h OSRM, 33.7 km/h TomTom Mumbai, zone scales) and point 4 (the ETA calibration test it planned).
- [TomTom Traffic Index](https://www.tomtom.com/traffic-index/ranking/): the profiles in `assets/traffic_profiles.json`.
- [FOSSGIS routing usage policy](https://routing.openstreetmap.de/about.html): the public OSRM server's limits.
- [Google Maps Platform service specific terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522): an example of caching limits to check under gate G1.
- [Routes API: traffic models](https://developers.google.com/maps/documentation/routes/traffic-model): `BEST_GUESS`, `PESSIMISTIC` and `OPTIMISTIC`; they need `TRAFFIC_AWARE_OPTIMAL`; both Compute Routes and Compute Route Matrix support them.
- [Routes API: Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix): at most 100 elements per request with `TRAFFIC_AWARE_OPTIMAL`, 625 otherwise.
- [Google Maps Platform pricing overview](https://developers.google.com/maps/billing/overview/) and a [localized pricing table](https://developers.google.com/maps/billing-and-pricing/pricing?hl=es-419): 5,000 free Compute Route Matrix Pro elements a month; 35,000 for India-billed accounts in the localized copy. Check the live English page.
- [Google forum: Routes API data and caching](https://discuss.google.dev/t/data-visualisations-with-routes-api-data/279145): the 30-day caching rule for coordinates, the non-Google-map rule, and the FAQ line on documents.
- [A reproduction of the terms' misuse clauses](https://wpgeodirectory.com/support/topic/changes-to-google-maps-platform-terms-of-service/): no scraping, no caching beyond the service terms, no creating content from Google Maps content. Read the official terms at <https://cloud.google.com/maps-platform/terms>.
