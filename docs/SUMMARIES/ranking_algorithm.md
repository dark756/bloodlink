# Summary: the ranking algorithm

*As of 4 November 2026. The full record follows the summary: [the feature in full](#the-feature-in-full), then [report 3's record](#report-3s-record) of point 1 (the design and its decisions) and point 4 (the sensitivity check). The code is `src/lib/ranking.js`.*

**What was asked** (reviewer point 1): "Clearly define how blood sources will be ranked based on compatibility, distance, ETA, and reliability", with a scoring method and weights "explained with suitable examples or test scenarios".

**The answer in brief.** Each bank that holds the patient's exact blood group gets four scores from 0 to 100:
- **ETA:** how soon it can be reached, by road at this hour;
- **coverage:** whether it covers the whole request;
- **surplus:** how much it has to spare;
- **freshness:** how recently it updated.

They are combined with weights that depend on urgency. A response plan then takes units from banks in rank order until the request is covered. Moving each weight by ±20% leaves the first choice unchanged in 92% to 98% of real searches.

| Status | |
|---|---|
| **Done** | The scores, weights and reasons; worked and live examples; 20 unit tests; the sensitivity check; the ETA checked against Google |
| **Planned** | Reliability from the stock-out forecast (January 2027); the ETA checked against timed trips (December) |
| **Not touched** | A review of the weights by a blood-bank officer |

---

## The scores

| Score | Formula | Rewards |
|---|---|---|
| **ETA** | `100 · e^(−minutes / τ)`, with τ = 30, 45 or 60 minutes for critical, urgent and routine | Arriving sooner. A critical request loses points fastest per minute |
| **Coverage** | `100 · min(1, units / units needed)` | One bank covering the whole request |
| **Surplus** | `100 · (1 − e^(−spare / units needed))` | A buffer, in case stock changed since it was posted. One request's worth spare scores 63, two score 86 |
| **Freshness** | 100 within 6 hours of the bank's update, falling to 0 at 72 hours; 30 with no update time | Trusting recent numbers |

| Urgency | ETA | Coverage | Surplus | Freshness |
|---|---|---|---|---|
| critical | 0.45 | 0.15 | 0.20 | 0.20 |
| urgent | 0.35 | 0.25 | 0.15 | 0.25 |
| routine | 0.25 | 0.35 | 0.05 | 0.35 |

**Why these weights:**
- **Critical:** time matters most, and an empty-handed trip costs the most. A close bank with only some of the units is still worth visiting first, because the plan adds the rest from other banks.
- **Routine:** there is time to phone ahead and pick the most reliable single source.

## Each factor the reviewer named

- **Compatibility:** the exact blood group only.
  - Giving a substitute such as O− for an A+ patient is a clinical decision.
  - A public search showing only exact matches can't steer anyone to the wrong product, and it keeps scarce O− for O− patients.
  - The full compatibility rules are kept, with 13 tests, for donor matching, where a clinician confirms.
- **Distance:** the straight-line distance picks the search ring:
  - 5, 10, 15 or 25 km where more than 10 banks lie within 15 km;
  - 20, 50, 100 or 150 km elsewhere.
- **ETA:** one OSRM call routes every bank in the ring. The time is the free-flow time × (1 + congestion / 100) × a rain factor. Congestion comes from TomTom's weekday-hour profiles, scaled by how built-up the area is. If routing fails, the straight line × 1.34 is used, and the bank is marked as an estimate. Against Google's predictions, this method picks Google's first bank in 81% of searches ([`eta_benchmark.md`](eta_benchmark.md)).
- **Reliability:** today, this is freshness and the dormant flag. Banks that haven't updated in 30 days are listed but left out of the plan. Stock-out risk joins it in January 2027 ([`ml_models.md`](ml_models.md)).

## Examples

**Worked example,** critical, 2 units of O− red cells:
- Bank A, 10 minutes away, 1 unit, fresh: 0.45 × 71.7 + 0.15 × 50 + 0.20 × 0 + 0.20 × 100 = **59.8**.
- Bank B, 40 minutes away, 6 units, 30 hours old: 0.45 × 26.4 + 0.15 × 100 + 0.20 × 86.5 + 0.20 × 63.6 = **56.9**.
- A ranks first. The plan takes 1 unit from A and 1 from B.

**Live example,** Mumbai, O− red cells, 3 units, Friday 23 October at 6:25 pm:

| Urgency | Top three (minutes, units, score) | Plan |
|---|---|---|
| critical | Cooper (4 min, 2 units, 69.4); Raheja (26 min, 6 units, 65.1); L.T.M.G. (28 min, 6 units, 64.7) | 2 units from Cooper, then 1 from Raheja |
| routine | L.T.M.G. (28 min, 6 units, 87.8); Deepak (18 min, 4 units, 87.5); Raheja (26 min, 6 units, 86.8) | All 3 from L.T.M.G., in one trip |

**Test scenarios** are in `tests/ranking.test.js`, with 20 tests:
- the weights, and each score, including surplus at 0, 63.2 and 86.5;
- exact-only matching;
- the critical split, and the value of spare stock against travel time;
- freshness and the urgency trade-off;
- plan coverage and shortfall;
- dormant banks.

## How the weights hold up

`scripts/ranking-sensitivity.mjs` re-ranked 48 real candidate sets from live searches. They come from 12 cities and towns plus rural Barmer, for O+, O−, A+ and B+ red cells, 3 units each. Each weight was moved 20% down and 20% up.

| Urgency | First choice unchanged | Order kept (Kendall's τ) | Most sensitive weight |
|---|---|---|---|
| critical | 98% | 0.976 | ETA: 96% unchanged |
| urgent | 98% | 0.978 | ETA and surplus: 97% each |
| routine | 92% | 0.978 | freshness: 88% |

Urgency still changes the answer. Critical and routine pick a different first bank in 13 of the 48 sets (27%).

## What is left

- **Reliability beyond freshness** (planned):
  - the stock-out forecast multiplies coverage and surplus by (1 − P), behind a flag, from January 2027;
  - blood banks confirming reservations in their panel would give each bank a track record (`../PLANS/plan_panels.md`).
- **The ETA against timed trips** (planned, December): `docs/SUMMARIES/eta_benchmark.md`, "The plan to finish it".
- **Expert review of the weights** (not touched). Give a blood-bank medical officer, or the project guide, 10 sample scenarios to rank blind, and compare their order with the engine's.

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Ranked emergency search with a response plan
Files: `src/lib/ranking.js`, `src/app/api/blood-search/route.js`, `src/app/search/page.js`

The measurements behind the numbers here are in report 3's record, below.

On `/search`, pick a location, a component, a blood group, the **units needed** and an **urgency** (Critical, Urgent or Routine). The app then:
- Finds the nearby banks that list the patient's **exact** blood group for that component. A bank with none of that group is not a match, whatever other groups it holds.
- Leaves out banks whose map point lies outside their own state or outside India, because their distance means nothing, and says how many it left out. eRaktKosh places 206 banks in the wrong state. In central Delhi, 36 of the 51 banks within 5 km of Connaught Place belong to other states.
- Widens the search ring until the exact-group stock inside it covers the request.
- Gives each bank a score out of 100 from four parts, weighted by urgency.
- Shows three plain-language **reasons** under each bank: travel, stock and freshness. For example: "About 12 min by road at this hour (heavy traffic)", "6 O-Ve units listed: covers the 3 needed, with 3 to spare" and "Stock updated 2 h ago".
- Builds a **response plan**: how many units to take from which bank, in rank order. If even the largest search area can't cover the request, it says how many units are missing (the **shortfall**) instead of failing.
- Warns you to call ahead when a bank's stock data is old.

#### The four scores

| Score | Formula (0 to 100) | What it measures |
|---|---|---|
| **ETA** | `100 · e^(−minutes / τ)`, with τ = 30, 45 or 60 min for critical, urgent or routine | How soon the blood can reach the patient |
| **Coverage** | `100 · min(1, units / units needed)` | How much of the request this one bank can meet |
| **Surplus** | `100 · (1 − e^(−spare / units needed))`, where spare = max(0, units − units needed) | The margin left after the request. No spare scores 0, one request's worth scores 63 and two score 86. |
| **Freshness** | 100 if the bank updated its stock within 6 h, falling in a straight line to 0 at 72 h. 30 if it gives no update time. | How far the listed count can be trusted |

ETA score by travel time, showing how τ makes critical requests penalise each minute more:

| Travel time | Critical (τ 30) | Urgent (τ 45) | Routine (τ 60) |
|---|---|---|---|
| 10 min | 71.7 | 80.1 | 84.6 |
| 30 min | 36.8 | 51.3 | 60.7 |
| 60 min | 13.5 | 26.4 | 36.8 |

#### Weights by urgency

Each row adds up to 1. The score is the weighted sum of the four parts.

| Urgency | ETA | Coverage | Surplus | Freshness |
|---|---|---|---|---|
| critical | **0.45** | 0.15 | **0.20** | 0.20 |
| urgent | 0.35 | 0.25 | 0.15 | 0.25 |
| routine | 0.25 | **0.35** | 0.05 | **0.35** |

#### Pseudocode

```text
# src/app/api/blood-search/route.js, ranked mode
rankedSearch(pin, component, group, unitsNeeded, urgency):
    nearby = eRaktKosh nearest(pin, radius 150 km)
    nearby = nearby without banks outside their own state or India   # stateBounds.js;
                                                                     # counted in misplacedBanks
    rings  = 5, 10, 15, 25 km   if more than 10 banks are within 15 km (urban)
             20, 50, 100, 150 km otherwise (rural)
    in parallel:
        stock  = eRaktKosh blood-availability, once per state involved
        routes = one OSRM table call for every nearby bank
        rain   = Open-Meteo, current rain at the pin

    candidates = []
    for bank in nearby:
        units = exactGroupUnits(stock[bank], component, group)   # this group only
        if units == 0: skip                                      # not a match
        bank.etaMinutes = estimateTravel(route, area, India time, month, rain)
        candidates.add(bank, units)

    # Grow the ring until stock that can be relied on covers the request (rings.js).
    ring = first ring where the units of non-dormant candidates inside it >= unitsNeeded,
           else the largest ring
    ranked = rankSources(candidates inside ring, urgency, unitsNeeded)
    plan   = buildResponsePlan(ranked, unitsNeeded)
    return ranked, plan

# src/lib/ranking.js
rankSources(sources, urgency, unitsNeeded, now):
    w   = WEIGHTS[urgency]
    tau = 30, 45 or 60 for critical, urgent or routine
    for source in sources where source.units > 0:
        eta       = 100 * exp(-source.etaMinutes / tau)
        coverage  = 100 * min(1, source.units / unitsNeeded)
        spare     = max(0, source.units - unitsNeeded)
        surplus   = 100 * (1 - exp(-spare / unitsNeeded))
        hours     = hours since the bank's last stock update
        freshness = 30                        if there is no update time
                    100                       if hours <= 6
                    0                         if hours >= 72
                    100 * (72 - hours) / 66   otherwise
        source.score   = w.eta * eta + w.coverage * coverage
                       + w.surplus * surplus + w.freshness * freshness
        source.reasons = [travel, stock, freshness]
    sort by score, highest first; on a tie, the shorter ETA first
    return sources

buildResponsePlan(ranked, unitsNeeded):
    remaining = unitsNeeded
    for source in ranked:
        if remaining <= 0: stop
        if source is dormant (no stock update for 30 days): skip
        take = min(source.units, remaining)
        plan.add(source, take)
        remaining = remaining - take
    shortfall = max(0, remaining)
    return plan, shortfall
```

#### Why these four parts

The reviewer asked for ranking on compatibility, distance, ETA and reliability. Here is what happened to each, and why:

- **Compatibility: now a filter, not a score.**
  - Giving a substitute group, such as O- red cells to an A+ patient, is a clinical decision. It belongs to the blood bank and the doctor, after cross-matching. A public search that lists only exact matches can't steer anyone towards the wrong product.
  - It also keeps scarce O- stock for O- patients, who can receive nothing else.
  - Once matching is a filter, every ranked bank has the exact group, so a compatibility score no longer tells banks apart. Its weight went to the other parts.
  - The rules stay in `src/lib/compatibility.js` for donor matching later, where a clinician confirms.
- **Distance: folded into ETA.**
  - ETA already contains distance, and it adds what distance misses: the road network, rush hours, area density, the season and rain. A bank 5 km across a congested city can take longer than one 12 km down a highway.
  - Scoring both would count distance twice.
- **ETA** stays the main way to reach the patient sooner. Its curve falls fastest when critical (the table above). A bank 30 minutes away keeps 37% of its ETA points when critical, 51% when urgent and 61% when routine.
- **Coverage** asks whether this one bank can meet the whole request, which saves a second trip. It is kept apart from surplus so that "can it meet the request?" and "how much is left over?" can be weighted differently for each urgency.
- **Surplus is new.** It is the margin after the request.
  - **Stale stock.** eRaktKosh stock is whatever the bank last typed in. In the live Mumbai check, most banks had last updated 8 to 12 hours earlier. A bank listing exactly the units needed has no margin if any were issued since, and an empty-handed trip costs the most in an emergency.
  - **Patients who need more.** Critical bleeding often needs more units than first asked for. A bank with spare stock can meet a second request without a second trip.
  - **Fewer trips.** The plan takes units from banks in rank order. Ranking banks with a margin higher tends to cover a request from fewer banks.
  - **Fair across request sizes.** Spare stock is measured in multiples of the request, so 2 spare units count for more on a 1-unit request than on a 10-unit one.
  - **Diminishing returns.** One request's worth of spare scores 63, two score 86, and beyond that there is little gain. A large bank far away can't win on size alone.
  - **Easy to explain.** It has the same `e^(−x)` form as the ETA score, so one explanation covers both.
- **Freshness stands in for "reliability".**
  - The only reliability signal eRaktKosh gives for each bank is when it last updated its stock.
  - The 6 h and 72 h cut-offs are kept from the reviewed version, and the collected data supports them. Banks update about once a day: the median gap between a bank's updates is 24.2 h, the 10th percentile 6 h and the 90th 33.6 h.
  - Stock updated within 6 h is as recent as the fastest-updating banks manage, so it gets full marks.
  - By 72 h a bank has missed about three daily updates, far past the 90th percentile, so its count can't be planned on without a call.
  - A bank with no update time scores 30, the same as stock about 52 hours old. An unknown age is treated as fairly old, not as worthless.
  - **Dormant banks,** with no update for 30 days (6.3% of banks), are listed with a red badge. They don't count towards the ring or the plan.

#### Why these weights for each urgency

- **Critical (ETA 0.45, coverage 0.15, surplus 0.20, freshness 0.20).** Minutes matter most.
  - **ETA has its largest weight** and its steepest curve.
  - **Coverage has its lowest weight.** A close bank holding some of the units is worth reaching first, and the plan adds the rest from the next bank. Holding out for one bank that has everything costs time.
  - **Surplus has its highest weight.** A wasted trip is the worst outcome, and spare stock protects against stale counts and a patient who needs more.
  - **Freshness stays at 0.20.** Stale stock risks a wasted trip, but there's no time to prefer a fresh bank far away over a near one.
- **Urgent (0.35, 0.25, 0.15, 0.25).** It sits between the other two. It is still led by travel time, but there is more room to favour a bank that covers the whole request and updated recently.
- **Routine (0.25, 0.35, 0.05, 0.35).** There's time to phone ahead, so a margin matters little and surplus gets 0.05. The aim is the most reliable single source: one that covers everything (coverage 0.35) with recently updated stock (freshness 0.35).
- **Where the weights came from.**
  - When compatibility became a filter, its share of the score went where each urgency needs it. Mostly that was surplus when critical, surplus and freshness when urgent, and coverage and freshness when routine.
  - Critical coverage was also lowered in favour of surplus, for the reason above.
  - The ETA weights and τ values were kept from the version the reviewer saw, so the urgency logic they reviewed still holds.

What spare stock is worth, for a bank 10 minutes away holding one extra request's worth of spare (surplus 63.2):

| Urgency | Extra points | Extra travel it outweighs |
|---|---|---|
| critical | +12.6 | about 15 min |
| urgent | +9.5 | about 19 min |
| routine | +3.2 | about 10 min |

- **In points,** spare stock is rewarded most when critical and least when routine, as asked.
- **In minutes,** urgent is slightly above critical. That's because a critical request values each minute more (τ 30 against 45).
- **Both critical and urgent** are well above routine. Changing one number per urgency in `WEIGHTS` moves this, and the tests show the effect.

#### Worked example

The same two banks, a request for 2 units of O- red cells. The critical case is checked in `tests/ranking.test.js`; the other two rows were worked out with the same code.
- **Bank A:** 10 min away, 1 unit, updated 1 h ago.
- **Bank B:** 40 min away, 6 units, updated 30 h ago.

| Urgency | Bank A score | Bank B score | First choice | Plan |
|---|---|---|---|---|
| critical | **59.8** | 56.9 | A | 1 unit from A, then 1 from B |
| urgent | 65.5 | **68.3** | B | both units from B, one trip |
| routine | 73.7 | **74.4** | B | both units from B, one trip |

How the critical scores are built:
- **A:** 0.45 × 71.7 + 0.15 × 50 + 0.20 × 0 + 0.20 × 100 = **59.8**
- **B:** 0.45 × 26.4 + 0.15 × 100 + 0.20 × 86.5 + 0.20 × 63.6 = **56.9**

When critical, reaching some blood 30 minutes sooner wins, and the plan fetches the rest from B. With more time, one trip to the bank that covers everything wins.

Live, in Mumbai, for 3 units of O- red cells on a Friday at 6:25 pm:

| Urgency | Top 3 (minutes, units, score) | Plan |
|---|---|---|
| critical | Cooper (4 min, 2 units, 69.4); Raheja (26 min, 6 units, 65.1); L.T.M.G. (28 min, 6 units, 64.7) | 2 units from Cooper, then 1 from Raheja |
| routine | L.T.M.G. (28 min, 6 units, 87.8); Deepak (18 min, 4 units, 87.5); Raheja (26 min, 6 units, 86.8) | All 3 from L.T.M.G., one trip |

#### How well the weights hold up

`scripts/ranking-sensitivity.mjs` re-ranked 48 real sets of candidate banks. They come from 12 cities and towns plus rural Barmer, for O+, O-, A+ and B+ red cells and 3 units. Each of the four weights was moved 20% down and 20% up.

| Urgency | First choice unchanged | Order similarity (Kendall's τ; 1 = identical) | Most sensitive weight |
|---|---|---|---|
| critical | 98% | 0.976 | ETA |
| urgent | 98% | 0.978 | ETA and surplus |
| routine | 92% | 0.978 | freshness |

- Reasonable doubt about the exact weights barely changes the answer.
- Urgency still matters: critical and routine pick a different first bank in 13 of the 48 sets (27%).
- 20 unit tests in `tests/ranking.test.js` pin the weights, each score, exact-only matching, the scenarios above and the plan's shortfall.

#### Limits

- **The weights are reasoned, not learned from outcomes.** There is no record yet of which bank actually supplied the blood. Next, a clinician or blood-bank review, and later outcome data once requests exist.
- **Stock counts are self-reported by banks.** Freshness and surplus soften this but can't remove it, which is why stale banks carry "call to confirm".
- **The ranking is informational.** Blood banks do the real screening and cross-matching.

### Component-aware blood compatibility
File: `src/lib/compatibility.js`

**Not used by search.** Search counts the exact group only (see the ranking section above). The module and its 13 tests are kept for donor matching, where a clinician confirms any substitute. The rules depend on the component:
- **Red cells:** O gives to everyone. Rh-negative patients get only Rh-negative cells.
- **Whole blood:** the group must match exactly.
- **Plasma:** the reverse of red cells. AB gives to everyone, and Rh doesn't matter.
- **Platelets:** plasma rules, plus Rh-negative for Rh-negative patients.
- **Bombay (Oh):** Bombay patients receive only Bombay blood.

Any use of these rules stays informational: a blood bank must still cross-match before any transfusion. The rules are also conservative: in an emergency, transfusion services may give out-of-group platelets or cryoprecipitate, or RhD-positive red cells to an RhD-negative patient, and these rules never do.

## Report 3's record

### Point 1: ranking engine, exact group only, rewarding spare stock

> *Request:* make sure that stock overflow is rewarded more in critical and urgent situations. Remove the compatibility feature from the engine's calculations, and list a hospital as a match only if it has the exact blood type required.

#### Where it started

`rankSources` scored four things:
- compatibility: 100 for exact stock that covers the request, 85 for some exact stock, 70 for substitutes only;
- ETA;
- stock: `100 · min(1, units / needed)`, so anything beyond the request earned nothing;
- freshness.

The route counted compatible substitute groups from `donorGroupsFor` unless `compatible=0` was sent. The page had an "Include compatible groups" box, ticked by default.

#### Plan

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

#### Decisions

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

#### Steps taken

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

#### Results

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

#### How to defend it

- **"Why not count O- for everyone?"** Substitution is a clinical decision. A public search showing only exact matches can't steer anyone towards a wrong product, and it keeps scarce O- stock for O- patients. The compatibility rules are still in the code for donor matching, where a clinician confirms.
- **"Why reward surplus more when critical?"** In a critical case, a wasted trip is the worst outcome. Spare stock protects against stock that changed since it was posted, and against the patient needing more. In routine cases there is time to phone first, so surplus matters little (0.05).
- **"Isn't this arbitrary?"** The form is explained (D1.2), the weights are explicit and add up to 1, and each one's effect is shown in points and minutes (D1.3). The tests pin the hand calculations. Point 4 describes the sensitivity and expert-review tests that would refine the numbers.

### Point 4: ranking sensitivity

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

**With the stock-out forecast's factor** (`docs/PLANS/ML_system.md`, A6): coverage and surplus × (1 − P), with P the chance that the group falls to 2 units or fewer within 24 h, or 48 h for a routine request. It was rerun on 48 sets captured on 4 November from the saved stock, with the forecast attached (`../blood_data/measurements/ranking_sensitivity_2026-11-04/`):

| Urgency | First choice unchanged: full factor | Mean τ: full | First choice unchanged: half factor (1 − P/2) | Mean τ: half |
|---|---|---|---|---|
| critical | 92% | 0.953 | 94% | 0.977 |
| urgent | 92% | 0.942 | 94% | 0.967 |
| routine | 83% | 0.857 | 83% | 0.925 |

- **The factor moves the order more than any weight changed by 20%** does (96% to 98% of first choices unchanged on the same sets), most for routine requests, where P48 is larger.
- **Where it moves the first choice,** the bank it demotes usually carries a high risk: in Kolkata A+ routine, the first choice without it had a 74% chance of falling to 2 units and drops to 13th. Where the demoted bank's own risk is small (1.6% in Guwahati), two banks scored nearly the same.
- **Open:** whether to keep the full factor or halve it (the plan's open question 7). It is behind `forecast_ranking`, which an admin can turn off.
