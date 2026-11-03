# What changed in bloodLink

This lists everything added or changed on top of the original app, the version tagged `mongodb-final`. The work came in three rounds:

1. **Bug fixes and cleanup.** This is commit `fdb2b2a` on `master`.
2. **The move from MongoDB and NextAuth to Supabase.** This is on branch `supabase-migration`, committed on 24 October as `5af73b9`. It has been GitHub's default branch since 26 October.
3. **New features:** the ranking engine, the response plan, compatibility, and verification with admin tools. These are in the same commit.

Paths are relative to `bloodlink/`. Everything listed here passes `npm run lint`, `npm test` and `npm run build`.

**Report 3 update (2026-10-23).** A fourth round changed the ranking engine:
- It now counts the exact blood group only, with no compatible substitutes.
- It scores spare stock, weighted most when critical.
- ETA comes from OSRM road routes, adjusted for time of day, day of week, season, area density and rain.

The ranking section below is up to date with report 3. Where the rest of this list disagrees, `docs/report3.md` is the current record of what changed and why.

**Data checks (2026-10-24).** An independent re-check of the data found and fixed six faults, #36 to #41. They are listed under [Found in the 24 October data checks](#found-in-the-24-october-data-checks), and `docs/data_integrity.md` has the details.

**Review fixes (2026-10-26).** Thirteen faults found in the reviews of 24 and 25 October were fixed. They are listed under [Found in the reviews of 24 and 25 October](#found-in-the-reviews-of-24-and-25-october). There are now 125 tests.

**Cloud collection (2026-11-03).** The database moved from Tokyo to Mumbai (#28), and stock collection moved off the laptop to Supabase (#35): see [Stock collected in Supabase, every 4.5 hours](#stock-collected-in-supabase-every-45-hours). It was committed on 3 November, on the branch `mumbai-and-cloud-collector`. There are now 150 tests.

---

## 1. New features

### Ranked emergency search with a response plan
Files: `src/lib/ranking.js`, `src/app/api/blood-search/route.js`, `src/app/search/page.js`

The measurements behind the numbers here are in `docs/report3.md`, points 1 and 4.

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

### Density-aware ring search
Files: `src/app/api/blood-search/route.js`, `src/lib/rings.js`, `src/lib/stateBounds.js`

Location search now adapts to the area. It used to always search 3, 5 and 10 km, so rural users found nothing.
- One eRaktKosh call fetches every bank within 150 km.
- Banks whose point lies outside their own state or outside India are left out, checked against state outlines with a 5 km margin for border cases. The page says how many were left out. Region search still lists them.
- If more than 10 banks are within 15 km, the area counts as **urban** and the search rings are 5, 10, 15 and 25 km. Otherwise it is **rural**, with rings of 20, 50, 100 and 150 km.
- **Nearest mode** (no component or group chosen) returns the smallest ring with an active bank holding matching stock. Dormant banks (no update for 30 days) never decide the ring. They are still listed, and if every bank with stock is dormant, the smallest ring with any of them is used.
- **Ranked mode** (component and group chosen) widens the ring until active banks cover the units needed.
- Stock is fetched once per state, in parallel. Before, it was fetched once per ring, one state after another.

### Hospital and blood-bank verification
Files: `src/app/organization/`, `src/app/api/organization/`, `src/lib/organization.js`

- Any signed-in user can apply on `/organization` to register a hospital or a blood bank. The application includes the name, registration number, address, contact and an optional eRaktKosh code.
- The application stays **Pending** until an admin reviews it. The applicant sees its status and the admin's note.
- If the admin **approves** it, the user's role becomes Hospital or Blood bank, and a badge appears on their profile.
- If the admin **rejects** or **suspends** it, the role goes back to User. A rejected applicant can apply again.
- An applicant who is already an admin keeps the admin role, but is still linked to the organization, so removing the admin role later leaves them its role.

### Admin dashboard
Files: `src/app/admin/`, `src/app/api/admin/`

The Admin pages are only visible to admins.
- **Overview:** counts, plus the queue of pending applications with Approve, Reject and Suspend buttons and a note field. It also shows the eRaktKosh collection card for the last 24 hours (success rate, response times, each state's last good fetch, worst first) and the collector's last sweep, in red once none has finished within the interval plus 2 hours.
- **Organizations:** every application, filterable by status.
- **Users:** search users by name or email, filter by role, and grant or remove admin rights. The database refuses to remove the last admin.
- **Audit log:** every admin action, with who did it and when.

Run `npm run db:make-admin -- <email>` to make the first admin.

### Email/password sign-in
File: `src/app/login/`

Besides Google, you can now sign up and sign in with an email and password. New accounts confirm their address by email.

### Privacy note, consent and account deletion
Files: `src/app/privacy/page.js`, `src/app/account/`, `src/lib/privacy.js`

India's Digital Personal Data Protection Act, 2023 asks for a notice, specific consent, and a way to withdraw it and have your data erased (#18).
- **`/privacy`** says what bloodLink stores and why, who can see it, which outside services receive what, how long it is kept, and how to use your rights. The footer links to it.
- **Consent.** Saving your details needs a tick against the current version of the note. The database records the version and stamps the time itself. When the note changes, its version date changes and the form asks again.
- **Account deletion.** `/account`, reached from your name in the header, deletes your account, profile, health answers and organization applications at once. The last admin can't delete theirs.

### Less of your location leaves your browser
Files: `src/lib/geo.js`, `src/lib/geocoding.js`, `src/app/api/reverse-geocode/route.js`

A search pin is personal data: it shows where someone needs blood (#52).
- The pin is rounded to 3 decimals, about 110 m, in the browser and again on the server, so eRaktKosh, OSRM and Nominatim never get more.
- The place name under the map now comes from bloodLink's server. It asks Nominatim at most once a second and remembers each point for a week, so the app's total traffic stays within Nominatim's policy. Browsers no longer contact Nominatim at all.

### Security headers
File: `next.config.mjs`

Every response now tells the browser not to let other sites frame bloodLink, to send only the site's address as the referrer, to let only bloodLink's own pages ask for your location, and not to guess file types (#51). A full Content-Security-Policy is reported in the browser console rather than enforced, until it has been checked on every page.

### Live donor eligibility
File: `src/lib/eligibility.js`

Eligibility used to be a yes/no value saved when the form was submitted, so it never changed. It is now worked out each time the profile is viewed, from:
- age: 18 to 65, but at most 60 for a first donation
- the gap since the last donation: 90 days for men, 120 days otherwise
- the health answers: a tattoo, piercing or acupuncture in the last 12 months; pregnancy, breastfeeding, a birth in the last 12 months, or an abortion or miscarriage in the last 6; weight under 45 kg; medication; and the listed infections

`/peer-to-peer` shows the result, and, if you're deferred, the next date you can donate. The rules and the form's questions follow the National Blood Transfusion Council's 2017 donor-selection guidelines, clauses 2 to 4, 15 to 17 and 47. They were checked against the official text on 26 October, which fixed four mismatches (#24).

### Better search results
Files: `src/lib/stock.js`, `src/app/search/page.js`

Each result card now shows:
- stock as unit counts per group
- a tap-to-call phone number
- a **Directions** link to Google Maps
- two ages: when the bank updated its stock and when bloodLink last checked it, for example "Bank updated 3 h ago · checked 12 min ago"

### Stock collected in Supabase, every 4.5 hours
Files: `src/lib/collector.js`, `supabase/functions/collect-stock/index.ts`, `supabase/migrations/20261103000100_cloud_collector.sql`, `scripts/setup-cloud-collector.mjs`, `scripts/upload-archive.mjs`, `scripts/sync-archive.mjs`, `src/app/admin/page.js`

The saved copy that searches fall back to when eRaktKosh is down is refreshed around the clock, not only while the project laptop is on.
- **How.** `pg_cron` in the database checks every 30 minutes whether a sweep is due. Every 4.5 hours it posts four batches of 9 states, 2 minutes apart, to the `collect-stock` Edge Function in Mumbai, which calls eRaktKosh one state a second and saves through the limited `bloodlink_ingest` role, with the same validation as before. Searches and the stock tables are unchanged.
- **Safe to leave running.** The function needs a secret kept in Vault. It refuses a job that already ran in the last 50 minutes, so collection can never be more often than hourly, and it stops starting states before the 150-second limit.
- **History kept for good.** Every change is archived, gzipped, in the private Storage bucket `stock-archive`, including everything the laptop collected since 23 October. The database keeps 60 days, and its weekly prune deletes a day only once the archive holds all of it. A weekly laptop task copies the archive into `../blood_data/` as a second copy.
- **Visible.** The admin overview shows the last sweep, in red when none has finished within the interval plus 2 hours.
- **Why 4.5 hours.** It misses 4.9% of the updates hourly sweeps see, most of them values replaced within 10 minutes, for a fifth of the calls. Its times shift each sweep, so every hour of the day gets sampled. The measurements and decisions are in `docs/report3.md`, point 3.1.
- **Cost:** ₹0 on the free plan.

### Unit tests
Files: `tests/`

There are 150 Vitest tests. Run them with `npm test`.
- `ranking.test.js` (20 tests): the weights, each score, exact-group matching, the worked scenarios, urgency changing the first choice, and the response plan.
- `eraktkosh-client.test.js` (21 tests): the eRaktKosh client's cache, saved copy, retries, per-state and service-wide circuits, freshness summary with stock and directory ages kept apart, shared calls, and the pin rounded to 3 decimals.
- `traffic.test.js` (16 tests): the travel-time model. It covers India time, traffic zones, congestion by time, day, season and density, rain, and the travel estimate.
- `stock-eligibility-profile.test.js` (22 tests): stock parsing, components matched by name only, cutting saved rows to one component, the district an eRaktKosh address names, eligibility with NBTC's 2017 limits, and profile and organization validation, including real calendar dates and India's "today".
- `compatibility.test.js` (13 tests): the rules for each component, Rh, and Bombay blood.
- `stock-quality.test.js` (10 tests): the eRaktKosh row validator: group names, row checks and dormant stock.
- `routing.test.js` (11 tests): OSRM route parsing and requests, Open-Meteo rain, and Nominatim place names with their cache.
- `state-bounds.test.js` (7 tests): whether a bank lies in its own state, the border margin, and points that are missing or outside India.
- `rings.test.js` (6 tests): ring choice in both modes, with dormant banks never deciding it.
- `rate-limit.test.js` (4 tests): `X-Forwarded-For` is trusted only behind configured proxies.
- `auth.test.js` (5 tests): sign-in redirects stay on the site, and the admin routes' database errors map to the right HTTP status.
- `collector.test.js` (15 tests): the shared collector. Changed rows are uploaded in full and the rest only re-stamped; a failed state is logged, or rolled back unarchived, and the batch goes on; the time budget skips what it can't start; the four batches cover the 36 states once; the directory flags wrong-state banks; the repeat guard; the function's secret and request checks; and the overdue warning.

Separately, a one-off script ran 47 end-to-end checks against the live database. It is not kept in the repo.

---

## 2. Bug fixes

The first four groups are in commit `fdb2b2a`. The 23 and 24 October fixes are in `5af73b9`, on `supabase-migration`. The fixes from the 24 and 25 October reviews were committed on 26 October, on the same branch, and the later ones of that day on 3 November, on `mumbai-and-cloud-collector`.

### Security
- **Anyone could overwrite anyone's profile.** `/api/details` trusted the email address sent in the request. It now takes your identity from your sign-in session only.
- **Personal data in logs.** The same route printed phone numbers and health answers to the logs. It no longer does.
- **Open proxy.** The search routes forwarded any query string to eRaktKosh. They now accept only known parameters and are rate-limited per IP address.
- **Unvalidated form input.** The profile form now goes through a whitelist validator (`src/lib/profile.js`): phone format, no future dates, a valid state and district.

### Search
- **Filters were silently ignored.** The app sent `districtCode` and `ComponentId`, but eRaktKosh only accepts `districtId` and `componentId`, and it is case-sensitive. District and component filters now work. For example, North Goa returns 3 banks instead of all 5.
- **Banks with no stock were listed.** eRaktKosh returns every bank whatever you filter for. Results are now filtered on real stock.
- **The search could freeze.** A failed request left the page loading forever. Errors now show a red notice, and the buttons work again.
- **The location button stayed disabled.** After a denied location permission, picking a point on the map now enables the search.
- **Old results stayed on screen.** A new search now replaces them, so "No results" shows correctly.
- **Slow and repeated requests.** Requests to eRaktKosh now time out after 25 s, results are cached for 5 min, and if eRaktKosh is down the app shows the last good result, marked as stale.
- **Too many map lookups.** The address lookup (Nominatim) fired on every map click, against its usage policy. It now waits until you stop clicking.

### Profile form
- Editing your details now **prefills** the form instead of wiping your profile.
- The form now ends on a success state for non-donors too, instead of a blank step.
- Signing out mid-form is handled properly.

### Code health
- Three copies of the search page (v1, v2, v3) became one `/search` page. The old copies are in `archive/`.
- The lookup tables (states, districts, groups, components) were copied into five files. They now come from one place, `src/lib/constants.js`.
- `npm run lint` went from 9 errors to none.
- Leaflet's CSS no longer loads twice, and the map icons no longer come from a CDN.
- The default Next.js icons are gone from `public/`, `.gitattributes` keeps line endings LF on every system, and the committed `.env.example` lists every variable (#23).

### Found in the 23 October cross-check
- **Two files were never formatted.** `.prettierignore` listed `supabase/`, which also matched `src/lib/supabase/`. The entries are now anchored to the app folder, and both Supabase client files are formatted.

### Found in the 24 October data checks
`docs/data_integrity.md` has the evidence for each, before and after.
- **#36 · Banks in the wrong state ranked as nearby.** A Delhi search for O+ put a bank in Muktsar, Punjab, first, "5 min away". Location search now leaves out banks outside their own state, and the collector flags them `wrong_state`.
- **#37 · The saved copy could count the wrong component.** With eRaktKosh down, a plasma-only bank ranked first for red cells. Components now match by name only, and the saved copy is cut to the requested component.
- **#38 · One failing state cut every state off from live data.** Each state now has its own circuit. The service-wide one opens only when failures come from two or more places.
- **#39 · The outage banner could show the directory's age as the stock's.** The two ages are now reported apart.
- **#40 · A dormant bank could choose the search ring.** Ring choice now ignores dormant banks.
- **#41 · A made-up `X-Forwarded-For` header dodged the rate limit.** The header is now trusted only on Vercel or behind proxies set in `TRUSTED_PROXY_HOPS`.

### Found in the reviews of 24 and 25 October
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

---

## 3. The move to Supabase

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

---

## 4. Documents and planning files

- **`CLAUDE.md`:** how the project works, the commands, and a numbered known-issues list.
- **`docs/CODE_REFERENCE.md`:** every function and variable, file by file.
- **`docs/report3.md`:** the answer to each reviewer suggestion, with the decisions, measurements and test results behind it.
- **`docs/data_integrity.md`:** an independent check of reviewer point 3 (data quality, freshness and failures), with the faults it found and fixed.
- **`docs/plans.md`:** all planned work in order of priority, with each item's details and its plan file where one exists. The plan files, in `docs/PLANS/`, none started:
  - `docs/PLANS/plan_bank_locations.md`: place the banks location search can't see;
  - `docs/PLANS/plan_eta_comparison.md`: compare ETA methods against timed trips and Google's predictions;
  - `docs/PLANS/plan_panels.md`: tools for admins, blood banks, hospitals and donors;
  - `docs/PLANS/plan_donor_network.md`: the peer-to-peer donor network.
- **Dated review:** `docs/verify_facts.md` (every number and outside fact).
- **`../blood_data/README.md`:** a catalogue of the collected and outside datasets, with their validation results.
- **`../documentation/sem 7 progress reports/report 2/`:** the updated report and slides.
  - They add the ranking algorithm and worked examples, verification and admin, test results, and a Completed / In Progress / Planned table.
  - They correct report 1's claims about the stack and about features the app doesn't have.
  - They show the database schema: an entity-relationship diagram (slide 23, report Figure 3) and each table's contents, rules and access (slide 24, report Table 7).

---

## 5. Not done yet

- **Hospital and blood-bank roles have no tools yet.** Verified accounts get a badge but no dashboard.
- **Before a public launch:** a custom email sender (`docs/PLANS/plan_panels.md`, F8), a contact address on `/privacy`, the project guide's reading of the privacy note, and enforcing the Content-Security-Policy. All are tracked in `CLAUDE.md`.
- **Banks location search can't place.** 679 stocked banks have no coordinates (#33). The 206 that eRaktKosh puts in the wrong state are left out until they are re-placed (#34). Region search lists them all.
- **Not built:**
  - donor matching and requests
  - notifications
  - stock forecasting: the history is collecting; the seven models to compare, the early checks, a first walk-forward dry run (3 November) and the subplan are in `docs/report3.md`, point 5

  These are planned in `docs/PLANS/plan_donor_network.md`, `docs/PLANS/plan_panels.md` and `docs/report3.md`, and ordered in `docs/plans.md`.
