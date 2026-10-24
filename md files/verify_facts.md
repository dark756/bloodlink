# Fact check: the numbers and assumptions bloodLink relies on

**Status: CHECKED on 24 October 2026.** Every hard number, outside fact and modelling assumption in the code and the documents was traced to a source and checked independently where possible. No app code was changed. One plan file was corrected (see [What was changed](#what-was-changed)).

- Paths are relative to `bloodlink/` unless they start with `../`.
- "Docs" means `CLAUDE.md` and the files in `md files/`. Each finding names where the fact is used.

**Labels used below**

| Label | Meaning |
|---|---|
| **Confirmed** | An independent source, or a fresh live measurement, gives the same value |
| **Drifted** | Re-measured today and different, because eRaktKosh's data changes; the documented value was right when taken |
| **Mismatch** | The source says something different; the docs or code should change |
| **Ambiguous** | Correct under one reading, wrong or unclear under another; needs a clarifying word in the docs |
| **Unverified** | Couldn't be checked from here (site blocked, data outside the repo) |
| **Project choice** | A design parameter or the project's own analysis, not an outside fact; judged for reasonableness only |

**Contents**
1. [How the checks were done](#how-the-checks-were-done)
2. [Summary](#summary)
3. [Mismatches and ambiguities](#mismatches-and-ambiguities)
4. [Medical and clinical facts](#medical-and-clinical-facts)
5. [eRaktKosh facts, re-measured live](#eraktkosh-facts-re-measured-live)
6. [Travel-time model](#travel-time-model)
7. [Geography and coordinates](#geography-and-coordinates)
8. [Ranking arithmetic](#ranking-arithmetic)
9. [Platforms and services](#platforms-and-services)
10. [Law and policy](#law-and-policy)
11. [Datasets and literature](#datasets-and-literature)
12. [Project choices](#project-choices)
13. [What couldn't be verified](#what-couldnt-be-verified)
14. [What was changed](#what-was-changed)
15. [Sources](#sources)

---

## How the checks were done

| Kind of fact | How it was checked |
|---|---|
| eRaktKosh counts, fields and quirks | **A fresh live sweep** on 24 October 2026, 10:42 to 10:48 India time: the nationwide `nearest` call, `master/all`, the auto-refresh list, all 36 states' `blood-availability`, and eight filter tests. About 45 calls, at least 1.2 s apart. Analysed with the repo's own `stockQuality.js`, `stock.js` and `stateBounds.js`. The calls came from a cloud container outside India |
| OSRM detour factor and speeds | **One live OSRM table call** from the same Mumbai point to the 94 nearest correctly placed banks |
| TomTom profiles | **TomTom's own city pages** (Mumbai, Kolkata, Pune, Bengaluru), parsed the way `scripts/build-traffic-profiles.mjs` parses them, and compared with `assets/traffic_profiles.json` |
| Ranking and model arithmetic | **Recomputed** with `src/lib/ranking.js` and from the asset files |
| Medical, legal, platform and dataset facts | **Official documentation first** (Supabase, Vercel, Next.js's bundled docs, OSRM, Open-Meteo, CARTO, geoBoundaries, UCI, data.gov.my, MoHFW). **Secondary sources only where the official one was unreachable**, and marked as such |

---

## Summary

- **The project's own measurements hold up remarkably well.** Re-measured today:
  - Mumbai's detour factor is 1.34, exactly as report 3 says, and OSRM's implied speed is 65 km/h, also exact.
  - The location-quality counts match to the bank: 3,602 ok, 518 shared, 206 wrong-state, 2 outside India.
  - 297 dormant banks, 6.3% older than 30 days, 1,697 relabelled groups (1,694 documented), and 4,328 directory banks.
- **Every number in the ranking documents recomputes exactly:** the ETA table, the surplus scores, the worked example (59.8 against 56.9), and the "extra minutes" table.
- **The TomTom asset was transcribed correctly:** for example, Mumbai is at 61.5% congestion, 33.7 km/h free-flow and 114.7% on Friday at 6 pm, as on TomTom's live page.
- **The platform facts are right:** Supabase limits, Vercel's `X-Forwarded-For`, CARTO's key requirement, Next.js 16's changes, Nominatim's policy and Open-Meteo's terms.
- **The weak spots are elsewhere:**
  - **Donor-eligibility thresholds:** three mismatches with NBTC 2017. This is #24, and the most important finding.
  - **Two statistics that depend on the time of day,** quoted as if they were constant.
  - **The derivation of two traffic scales,** which doesn't reproduce.
  - **A few small wording and source issues.**

---

## Mismatches and ambiguities

Ranked by how much they matter. Each says where to fix it.

| # | Finding | Label | Where | What to do |
|---|---|---|---|---|
| F1 | **Tattoo, piercing and acupuncture deferral is 12 months** in NBTC's 2017 guidelines; the profile form asks about 6 months | **Mismatch** | `src/app/set-details/page.js` (question text), `src/lib/eligibility.js` (reason text) | Change to 12 months (#24) |
| F2 | **Minimum weight is 45 kg for a 350 ml collection and over 55 kg for 450 ml** (NBTC 2017); the form defers anyone "under 50 kg" | **Mismatch** | `set-details/page.js`, `eligibility.js` | Ask for weight bands, or defer only under 45 kg; leave 350 or 450 ml to the centre (#24) |
| F3 | **First-time donors must be 60 or younger** (repeat donors up to 65; apheresis donors 18 to 60, NBTC 2017); the code allows anyone 18 to 65 | **Mismatch** | `eligibility.js` (`ELIGIBILITY_RULES`) | Use the donation history: a first donation needs age ≤ 60 (#24) |
| F4 | **Deferral for 12 months after delivery** (NBTC 2017); the form asks only "currently pregnant or breastfeeding" | **Mismatch (gap)** | `set-details/page.js` | Add "given birth in the last 12 months" (#24) |
| F5 | **Two traffic scales don't reproduce from their formula.** Report 3 derives city 0.89 and town 0.73 from 0.971 + 0.168 × log10(population ratio), at 2 million and 300,000 people against 9.7 million. That gives **0.86 and 0.72**, or **0.88 and 0.74** if divided by the value at ratio 1 | **Mismatch** (small) | `src/lib/traffic.js` (`ZONE_SCALE` comment), `report3.md` point 2, `CLAUDE.md` | Record the exact populations and normalisation used, or change the values to 0.88 and 0.74. The ranking effect is tiny either way |
| F6 | **"Auto-refresh banks: median stock age 0.3 h against 9.7 h for the rest"** was measured at 18:30, minutes after a refresh batch at 18:14. At 10:47 today the same banks were *older* (4.6 h against 3.2 h) | **Ambiguous** (time-dependent) | `CLAUDE.md` (eRaktKosh quirks), `report3.md` points 3.2 and 5, `data_integrity.md` | Say they refresh in batches at fixed times and are not continuously fresh. Re-check report 3's reasoning that they are "the cleanest series to model first" against the history |
| F7 | **"Median stock age 9.7 h"** is an evening snapshot. At 10:47 today it was **3.3 h**, because 73% of banks update between 07:00 and 12:00 | **Ambiguous** (time-dependent) | `CLAUDE.md`, `report3.md`, `data_integrity.md` | Quote it with the time taken, or as a daily median from the history |
| F8 | **"Majuli removed"** from the district list. The old asset listed Majuli twice (codes 746 and 713); the refresh removed the duplicate 746. Majuli is still there as 713 | **Mismatch** (wording) | `CLAUDE.md` (eRaktKosh notes), `report3.md` D3.2.3 | "a duplicate Majuli entry (code 746) removed" |
| F9 | **TomTom's populations aren't Census figures.** The asset's populations come from TomTom (Kolkata 6.58 million) and differ from the 2011 Census urban agglomerations (Kolkata about 14.1 million; Mumbai 18.4 million against TomTom's 18.2 million). They feed the "9.7 million metro average" behind F5, and the r = 0.70 density correlation | **Ambiguous** | `assets/traffic_profiles.json`, `report3.md` point 2 | Say "TomTom's metro populations"; the correlation is reproduced below with them |
| F10 | **"85.6% on a weekday at 6 pm"** (India profile) is Monday's value. The Monday-to-Friday average is 87.2% | **Ambiguous** | `report3.md` point 2, step 2 | "85.6% on a Monday, 89.5% on a Friday" |
| F11 | **"51.5% congestion a year"** is the mean of TomTom's ten traffic-weighted city averages. The hourly grid the model actually uses averages 39.7% over the week, because quiet hours count equally | **Ambiguous** | `report3.md` point 2 | Add "traffic-weighted; the hourly grid averages 39.7%" |
| F12 | **Rain categories mix scales.** The 2.5 and 7.6 mm/h thresholds are the American Meteorological Society's hourly bands (confirmed). The IIT Bombay study the rain factors cite classified rain by India Meteorological Department categories, which are per 24 hours (light 2.5 to 15.5 mm a day) | **Ambiguous** | `src/lib/traffic.js` (`RAIN`), `report3.md` D2.5 | Name the AMS as the threshold source; say the factors are set conservatively from studies using daily categories |
| F13 | **Supabase now restores a paused free project for up to 1 year,** not 90 days | **Mismatch** (outdated) | `supabase_scheduler.md` ("Where the data lives", sources) | Update when the plan is next touched |
| F14 | **Compatibility rules are stricter than practice.** Transfusion services give out-of-group platelets and cryoprecipitate when needed, and may give RhD-positive red cells to RhD-negative patients in a life-threatening emergency. `compatibility.js` never allows these | **Ambiguous** (safe for an informational tool) | `src/lib/compatibility.js`, `features.md` | Call the rules "conservative" in the comments and docs; the donor plan already leaves substitution to the centre |
| F15 | **"SDP" means two different things.** In eRaktKosh's list it is Single Donor *Plasma* (component 18); Single Donor *Platelets* is 14, "PLA". Indian clinical usage says SDP for the platelets | **Mismatch** in `plan_donor_network.md` | Fixed in this commit | Never write "SDP" without the component name |
| F16 | **Nominatim's limit applies to the whole app,** not each user: "the sum of traffic by all your users should not exceed the limits", and switching providers must be possible without a software update. The map calls it straight from every browser | **Ambiguous** (fine at today's scale) | `src/app/components/BloodMap.js` | Before a public launch, route reverse geocoding through the server with a cache (#52 in `review_and_next_moves.md`) |
| F17 | **`getClaims()` verifies locally only with asymmetric signing keys.** With the legacy symmetric key it calls the Auth server every time | **Ambiguous** | `src/lib/auth.js` comment; review finding #49 | Check the project's JWT signing keys in the dashboard; switch to asymmetric keys if needed, or the proxy and layout each add a round trip to Tokyo |
| F18 | **Realtime doesn't apply row-level security to DELETE events** | **Ambiguous** (affects a plan) | `plan_donor_network.md` (Realtime) | Use status changes, not deletes, on tables the inboxes watch |
| F19 | **The OSRM usage policy is cited from the wrong page.** Report 3 cites the FOSSGIS page for `routing.openstreetmap.de`; the app uses `router.project-osrm.org`, whose policy is on OSRM's wiki (FOSSGIS-sponsored, 1 request a second, reasonable non-commercial use) | **Mismatch** (citation) | `report3.md` point 2, `src/lib/routing.js` comment | Cite the OSRM wiki's demo-server page as well |
| F20 | **geoBoundaries metadata says "year represented 2011",** yet the file has the post-2020 units (Telangana, Ladakh, merged Dadra and Nagar Haveli and Daman and Diu) | **Ambiguous** | `assets/state_boundaries.json`, `data_integrity.md` | Note the metadata quirk; the outlines are what matter, and they include the current units |
| F21 | **The minimum whole-blood gap:** NBTC's older blood-bank standards page says "at least 12 weeks" (84 days); the 2017 guidelines say 90 days for men and 120 for women. The code follows 2017 | **Ambiguous**; code right | `eligibility.js` | None. Cite the 2017 document |
| F22 | **The gap for "other" gender** is 120 days in the code. The guidelines only speak of men and women | **Project choice** | `eligibility.js` | Fine as the conservative choice; say so in the comment |

---

## Medical and clinical facts

| Fact | Used in | Source | Result |
|---|---|---|---|
| Donor age 18 to 65 | `eligibility.js` | NBTC 2017, as reproduced by Rashtrotthana Blood Centre | **Confirmed for repeat donors;** first-time donors only to 60 (F3) |
| Gap after whole blood: 90 days for men, 120 for women | `eligibility.js` | NBTC 2017 (reproduced; Studocu copy agrees) | **Confirmed** |
| Tattoo or piercing deferral, 6 months | set-details form | NBTC 2017: 12 months | **Mismatch** (F1). Assam SBTC's page and WHO's general guidance say 6 months, so sources do differ; the national 2017 guideline is the one to follow |
| Weight under 50 kg defers | set-details form | NBTC 2017: 45 kg (350 ml), over 55 kg (450 ml) | **Mismatch** (F2) |
| Haemoglobin 12.5 g/dl | Not used (the centre tests) | NBTC 2017; Assam SBTC | **Confirmed** in sources; correctly left to the centre |
| Apheresis: at least 48 h apart, at most twice a week, 24 a year | `plan_donor_network.md` (rules to add later) | NBTC 2017 (reproduced) | **Confirmed;** the plan rightly waits for the official text |
| Red cells: O to all; Rh-negative patients get Rh-negative | `compatibility.js` | UTMB chart; Lifeblood | **Confirmed** as the preferred rule; stricter than emergency practice (F14) |
| Whole blood must be ABO-identical | `compatibility.js` | AABB standards (via search), MedicineNet | **Confirmed;** low-titre group O whole blood is an exception in trauma programmes |
| Plasma: AB to all; Rh doesn't matter | `compatibility.js` | UTMB chart; NZ Blood | **Confirmed** |
| Platelets follow plasma rules, Rh-negative for Rh-negative | `compatibility.js` | UTMB: same ABO first, any ABO may be used; Rh-negative preferred | **Confirmed as a preference;** stricter than practice (F14) |
| Cryoprecipitate follows plasma rules | `compatibility.js` (component 17) | UTMB and NZ Blood: any ABO may be used | **Ambiguous:** conservative (F14) |
| Bombay (Oh) patients receive only Bombay blood | `compatibility.js` | PMC case reports; Lifeblood | **Confirmed** |
| Bombay donors "reserved for Bombay recipients" | `compatibility.js` comment | — | **Project choice;** clinically, Oh red cells carry no A, B or H antigen. Reserving them reflects their rarity. Say so |
| NHS Blood and Transplant's amber alert at about 2 days of supply | `report3.md` point 5 | NHSBT and ITV, October 2022: alert when stocks fall to about 2 days; O groups were under 2 | **Confirmed** |
| Canadian guidance of 4 to 6 days of red cells | `report3.md` point 5 | Canadian Blood Services: "approximately 4-6 days of average daily use" | **Confirmed** (a hospital rule of thumb) |

---

## eRaktKosh facts, re-measured live

Today's values come from the sweep on 24 October 2026 between 10:42 and 10:48 India time. The documented values were taken on 23 and 24 October, mostly in the evening.

| Fact (docs) | Documented | Today | Result |
|---|---|---|---|
| Base URL, no key, `User-Agent: Mozilla/5.0` | — | Every call answered | **Confirmed** |
| Banks with stock, all 36 states | 4,707 | **4,724** | **Drifted** (+17) |
| Size of a full sweep | 9.5 MB | 9.64 MB | **Confirmed** |
| Time for a full sweep | 87 s | 182 s | **Drifted:** today's calls came from outside India. It still fits the scheduler plan's 150 s batches, about 60 s each, if its Edge Function runs outside India |
| Uttar Pradesh | 678 banks, 12.4 s, 1.4 MB | 681 banks, 17.9 s, 1.41 MB | **Confirmed** (size); time varies |
| Lakshadweep returns none | 0 | 0 | **Confirmed** |
| Responses not compressed | No `Content-Encoding` | None, even when asked for gzip | **Confirmed** |
| Parameter names case-sensitive; `districtCode` and `ComponentId` ignored | — | Goa with `districtCode=585`: 5 (ignored); `districtId=585`: 3. Mizoram with `ComponentId=12`: 9 (ignored); `componentId=12`: 8 | **Confirmed** |
| `bloodGroupId` doesn't remove banks; banks without that group come back empty | — | Goa O- filter: all 5 banks, quantities only for O-. Goa AB- red cells: 5 banks, 3 with an empty list | **Confirmed** |
| `componentId` drops banks without the component (Mizoram 9 to 8) | 9 and 8 | 9 and 8 | **Confirmed** |
| A filtered response lists only that component | — | Only "Packed Red Blood Cells" | **Confirmed** |
| Directory banks (`nearest`, nationwide) | 4,328 | **4,328** | **Confirmed** |
| In both lists / stock without coordinates / coordinates without stock | 4,028 / 679 (432 + 247) / 300 | 4,043 / **681** (434 + 247) / 285 | **Drifted** slightly |
| All distinct bank codes | 5,007 | 5,009 | **Drifted** slightly |
| Location quality: ok / shared / wrong state / outside India | 3,602 / 518 / 206 / 2 | **3,602 / 518 / 206 / 2** | **Confirmed exactly** |
| 203 points shared by several banks | 203 | 203 | **Confirmed** |
| **Stocked banks location search can't see** ("up to 885") | up to 885 | **874:** 681 without coordinates, 191 wrong-state banks with stock, 2 outside India | **Confirmed;** the exact baseline for `plan_bank_locations.md` is **3,850 visible** today (4,724 − 874) |
| Labels written like "O +ve" | 1,694 | 1,697 | **Confirmed** |
| Group entries over 2,000 units; largest | 30; 15,280 | 17; 7,794 | **Drifted** (banks corrected some) |
| 99th percentile of units per entry | 290 | 287 | **Confirmed** |
| Dormant banks (over 30 days) | 297 (6.3%) | **297 (6.3%)** | **Confirmed exactly** |
| Older than 90 days; oldest | 3.3%; 236 days | 3.3%; 236 days | **Confirmed** |
| Median stock age | 9.7 h | **3.3 h** at 10:47 | **Ambiguous** (F7) |
| Older than 1 day | 23.9% | 28.9% | **Drifted** (time of day) |
| `offline` is "1" for 98.7%; the 59 "0" banks are staler (median 104 h) | 59 banks, 104 h | 59 banks, 120 h | **Confirmed** |
| `moderateStock` always "0" | — | "0" for 4,712, empty for 12 | **Confirmed** |
| `stockSource` 0 to 3 | 2 for 4,073 | 0: 30, 1: 167, 2: 4,072, 3: 59 | **Confirmed** |
| `hospitalCode` is a number in `nearest`, a string in `blood-availability` | — | Same | **Confirmed** |
| `dist` is straight-line metres | — | Equal to Haversine within 0.11%, a constant gap that suggests eRaktKosh uses a radius of about 6,378 km rather than 6,371 | **Confirmed;** negligible |
| Names sometimes end in stray commas | — | 7 of 4,724 rows | **Confirmed** |
| Auto-refresh list | 452 banks, 412 with stock, median age 0.3 h | 452 banks, 427 with stock, median age **4.6 h** (rest 3.2 h) | **Count confirmed;** freshness **ambiguous** (F6) |
| `master/all`: 781 districts, 36 states | 781, 36 | 781, 36, and identical to `assets/district_data.json` in every district, group and component | **Confirmed** |
| "99 is Uttar Pradesh"; eRaktKosh codes, not Census codes | — | 99 = Uttar Pradesh, 97 = Delhi, 98 = Rajasthan | **Confirmed** |
| Districts Markapuram, Polavaram and Tamulpur added; Majuli removed | — | The three are present; Majuli is still present (F8) | **Mismatch** (wording) |
| Central Delhi: 36 of the 51 banks within 5 km of Connaught Place are from other states | 36 of 51 | 38 of 54 (from 28.6315, 77.2167) | **Confirmed** in substance; the centre point used isn't recorded |
| Banks within 15 km of the 10 TomTom city centres: Ernakulam 14 to New Delhi 149 | 14 to 149 | 11 to 135 | **Confirmed** in shape; the centres used aren't recorded |
| Blood-group codes: A+ 11 … AB- 18, Bombay 22 and 23 | — | Same in the live `master/all` | **Confirmed** |
| Components: Whole Blood 11, PRBC 12, FFP 13 | — | Same; all 14 components mapped in `compatibility.js` | **Confirmed** |
| eRaktKosh launched in 2016 by MoHFW | — | MoHFW's own page: inaugurated 7 April 2016 | **Confirmed** |

---

## Travel-time model

| Fact | Used in | Check | Result |
|---|---|---|---|
| Median road ÷ straight-line distance over 94 Mumbai bank trips: **1.34** (10th percentile 1.17, 90th 1.70; under 5 km 1.58) | `traffic.js` (`DETOUR_FACTOR`) | Live OSRM call, same point, 94 nearest correctly placed banks | **1.34, 1.17, 1.71; under 5 km 1.61. Confirmed** |
| OSRM's implied free-flow speed: median **65 km/h** (56 under 5 km, 76 for 30 to 60 km) | `traffic.js` comment, `CLAUDE.md` | Same call | **65; 55 under 5 km straight-line; 74 for 30 to 60 km. Confirmed** |
| OSRM's car profile assumes near-limit speeds | `CLAUDE.md` | OSRM `car.lua`: primary roads 65 km/h, trunk 85, motorway 90 | **Confirmed:** 65 km/h is the primary-road default |
| The detour factor is in the usual range | report 3 | Ballou et al. (2002) country circuity factors. The India value couldn't be read | **Unverified** externally; the live re-measurement is the stronger evidence |
| TomTom Mumbai: 61.5% average congestion, 33.7 km/h free-flow, Friday 6 pm 114.7%, Friday 3 am 1% | `assets/traffic_profiles.json` | TomTom's live Mumbai page | **Confirmed exactly** |
| Mumbai September 69.8% against May 52.5% | `report3.md` | 61.5 × 1.135 and 61.5 × 0.854 from the asset | **Confirmed** |
| City free-flow speeds 28.8 to 39.7 km/h | `report3.md` | Asset: Kolkata 28.8, New Delhi 39.7; TomTom's pages agree for Kolkata | **Confirmed** |
| Bengaluru city centre 74.4% | `report3.md` | TomTom's page: centre 74.4%, metro area 60% (the app uses metro) | **Confirmed** |
| TomTom measures "more than 3.65 trillion km a year" | `report3.md` | TomTom's page | **Confirmed** |
| "TomTom Traffic Index 2025" | asset, credits | The page's data is dated 2025 | **Confirmed** |
| India average 51.5% a year | `report3.md` | Mean of the 10 cities' TomTom figures = 51.5 | **Confirmed;** see F11 |
| Weekday 6 pm 85.6%, Sunday 6 pm 60.3% | `report3.md` | Monday 85.6, Sunday 60.3 | **Ambiguous** (F10) |
| Seasonal factor 1.09 to 1.11 in July to September; 0.89 in March | `report3.md` | 1.107, 1.091, 1.093; March 0.892 | **Confirmed** |
| Indian highway free-flow about 58 km/h; metro highway congestion about 30% | `traffic.js`, `report3.md` | Mean of the 7 cities with highway data: 57.8 km/h; India highway congestion 29.9% | **Confirmed** |
| Rural scale 0.29 = "half the congestion on metro highways" | `traffic.js` | Half of 29.9% is 15%, and 15 ÷ 51.5 = 0.29 | **Confirmed arithmetic;** still an assumption, as the code says |
| City 0.89, town 0.73 from the within-country fit | `traffic.js`, `report3.md` | Recomputed: 0.86 and 0.72 (or 0.88 and 0.74 normalised) | **Mismatch** (F5) |
| First cross-country town scale 0.86 ("7.4 points per tenfold step") | `report3.md` | (51.5 − 7.4) ÷ 51.5 = 0.856 | **Confirmed** |
| Town free-flow halfway between 33.1 and 57.8 km/h | `traffic.js` | 45.45 km/h | **Confirmed;** a project choice |
| Metro average population 9.7 million | `report3.md` | Mean of the asset's TomTom populations: 9.75 million | **Confirmed;** but see F9 |
| Bank density tracks population: r = 0.70 for ln(banks) against ln(population) | `report3.md` D2.4 | Recomputed with today's directory and TomTom populations: **0.70** (0.68 without misplaced banks) | **Confirmed** |
| Rain bands 2.5 and 7.6 mm/h | `traffic.js` (`RAIN`) | American Meteorological Society glossary: light up to 0.25 cm/h, moderate 0.26 to 0.76, heavy over 0.76 | **Confirmed;** see F12 |
| Rain adds 10% to 130% on two Mumbai roads (IIT Bombay, WCTR 2019) | `report3.md` | The WCTR abstract: "increase in travel time by 10-130%" | **Confirmed** |
| Bengaluru rain week: about +30% average (MoveInSync) | `report3.md` | The News Minute: 30% average in the last week of August 2022; up to 62% in some areas (the headline's figure) | **Confirmed** |
| Open-Meteo "current" precipitation is the last 15 minutes, so mm × 3,600 ÷ interval is mm/h | `src/lib/weather.js` | Open-Meteo docs: current values are 15-minutely; precipitation is "the total from the previous 15 minutes"; `interval` is in seconds | **Confirmed** |
| India time is UTC + 5:30 | `traffic.js` | — | **Confirmed** |

---

## Geography and coordinates

| Fact | Used in | Check | Result |
|---|---|---|---|
| Earth radius 6,371 km for Haversine | `src/lib/geo.js` | The IUGG mean radius is 6,371.0 km | **Confirmed** |
| India's bounding box 6 to 37.5° N, 68 to 97.5° E | `geo.js` (`INDIA_BOUNDS`) | Southernmost Indira Point 6°45′ N; northern claim line about 37°05′ N; westernmost Sir Creek about 68°07′ E; easternmost Kibithu 97°24′ E | **Confirmed;** the east and west margins are only about 0.1° |
| 36 states and union territories | assets, `CLAUDE.md` | geoBoundaries IND ADM1 has 36 units; `master/all` lists 36 | **Confirmed** |
| State outlines from geoBoundaries (DataMeet India community and Election Commission of India), CC BY 2.5 IN | `assets/state_boundaries.json`, search-page credit | The geoBoundaries API metadata | **Confirmed;** see F20 |
| 1 degree of latitude is 110.57 km; 1 degree of longitude at the equator is 111.32 km | `stateBounds.js`, `traffic.js` | The latitude value is the equatorial one; at India's latitudes it is 110.7 to 110.9 km | **Confirmed;** under 0.3% error, negligible |
| 4 decimals of a coordinate ≈ 11 m; 5 decimals ≈ 1 m; 0.1° ≈ 11 km | `eraktkosh.js`, `routing.js`, `weather.js` | 0.0001° × 111 km | **Confirmed** |

---

## Ranking arithmetic

Recomputed with `src/lib/ranking.js` itself.

| Documented | Recomputed | Result |
|---|---|---|
| ETA score at 10, 30 and 60 min: 71.7, 80.1, 84.6 / 36.8, 51.3, 60.7 / 13.5, 26.4, 36.8 | Identical | **Confirmed** |
| Surplus: one request's worth spare scores 63, two score 86 | 63.2, 86.5 | **Confirmed** |
| Freshness: 30 for unknown equals about 52 h | 30 at 52.2 h | **Confirmed** |
| Worked example, critical: A 59.8, B 56.9 | 59.8, 56.9 | **Confirmed** |
| Urgent: A 65.5, B 68.3; routine: A 73.7, B 74.4 | Identical | **Confirmed** |
| Spare stock is worth +12.6, +9.5, +3.2 points, or about 15, 19 and 10 extra minutes | +12.6 = 14.9 min; +9.5 = 18.6 min; +3.2 = 9.7 min | **Confirmed** |
| Every urgency's weights add up to 1 | 1.00, 1.00, 1.00 | **Confirmed** |
| A 10-minute error costs 28%, 20% and 15% of ETA points (`plan_eta_comparison.md`) | 28%, 20%, 15% | **Confirmed** |
| 71 paired trips detect a 5-point MAPE difference (`plan_eta_comparison.md`) | (1.96 + 0.84)² × 15² ÷ 5² = 70.6 | **Confirmed** |
| The ranking's "first choice unchanged in 92 to 98%" (sensitivity) | Data outside the repo | **Unverified** here |

---

## Platforms and services

| Fact | Used in | Source | Result |
|---|---|---|---|
| Next.js 16: `next build` no longer lints; `middleware` renamed `proxy`; Node 20.9 or later | `CLAUDE.md`, `src/proxy.js` | The version 16 upgrade guide in `node_modules/next/dist/docs/` | **Confirmed** |
| Vercel overwrites `X-Forwarded-For` and doesn't forward outside IPs | `src/lib/rateLimit.js` | Vercel's request-headers docs | **Confirmed** |
| CARTO tiles need a key; without one, raster tiles carry an "API key required" watermark | `BloodMap.js` | CARTO's basemap-styles README; free for non-commercial use up to 5 million tile requests a month | **Confirmed** |
| Supabase free plan: 500 MB database, 1 GB storage, 5 GB egress, 500,000 Edge Function calls, paused after a week of inactivity, no automatic backups | `supabase_scheduler.md`, `report3.md` | Supabase pricing page | **Confirmed** |
| Paused free projects can be restored for 90 days | `supabase_scheduler.md` | Supabase docs: up to 1 year | **Mismatch** (F13) |
| Edge Functions: 150 s wall clock (free), 400 s (paid), 2 s CPU, 256 MB | `supabase_scheduler.md`, `plan_donor_network.md` | Supabase limits page | **Confirmed;** this review's timing puts the directory's state check at about 0.1 s of CPU |
| Edge Functions get `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEYS`; the service-role key is legacy | `supabase_scheduler.md` | Supabase secrets page | **Confirmed** |
| Legacy `anon` and `service_role` keys retired by the end of 2026 | `supabase_scheduler.md` | Supabase migration guide: "deprecating … by the end of 2026" | **Confirmed** |
| `getClaims()` verifies the token locally | `src/lib/auth.js` | Supabase reference: only with asymmetric keys | **Ambiguous** (F17) |
| Realtime Postgres Changes respect row-level security | `plan_donor_network.md` | Supabase docs: every event authorised per subscriber, except DELETE | **Confirmed with a caveat** (F18) |
| Multi-factor sign-in level available in the JWT as `aal`; policies can require `aal2` | `plan_panels.md` | Supabase MFA docs | **Confirmed;** whether TOTP is free on every plan wasn't stated on that page |
| Web push for web apps on iPhone from iOS 16.4, Home Screen web apps only | `plan_donor_network.md` | WebKit | **Confirmed** |
| OSRM demo server: at most 1 request a second, non-commercial | `routing.js`, `CLAUDE.md` | OSRM wiki (FOSSGIS sponsors it) | **Confirmed;** citation fix (F19) |
| Nominatim: 1 request a second, identifying User-Agent, attribution, one-time bulk rules, 4 a minute for periodic scripts, end-user use only if "moderate" | `BloodMap.js`, `plan_bank_locations.md` | OSM Foundation usage policy | **Confirmed;** see F16 |
| Open-Meteo free API: non-commercial only, under 10,000 calls a day, data CC BY 4.0 | `weather.js`, search-page credit | Open-Meteo terms | **Confirmed** |
| Google Routes: `TRAFFIC_AWARE_OPTIMAL` needed for traffic models; 100 elements a request; future departure times | `plan_eta_comparison.md` | Google's Routes docs | **Confirmed** |
| Google Geocoding: latitude and longitude may be cached for 30 days | `plan_bank_locations.md` | Google Maps Platform service terms | **Confirmed** |
| Google's free cap: 5,000 Pro route-matrix elements a month | `plan_eta_comparison.md` | Google's pricing table | **Confirmed** as listed; the billing tier for traffic-aware calls is still unconfirmed, as the plan says |
| TRAI DLT registration for SMS in India | `plan_donor_network.md` | Vendor guides (Plivo and others) | **Confirmed** in substance (secondary sources) |

---

## Law and policy

| Fact | Used in | Source | Result |
|---|---|---|---|
| Supreme Court, *Common Cause v. Union of India*, 1996, against professional donation | `plan_donor_network.md` | Judgment of 4 January 1996, WP (C) 91 of 1992 (Legal Authority, Common Cause) | **Confirmed** |
| Paid donation banned from 1 January 1998 | `plan_donor_network.md` | Wikipedia, "Blood donation in India" | **Confirmed** only by a secondary source; cite the court's orders in the report |
| Blood centres licensed under the Drugs and Cosmetics Act 1940 and Rules 1945 | `plan_donor_network.md` | CDSCO guidelines; the 2020 Second Amendment renamed Part X-B "Blood Centres"; Schedule F Part XII-B sets the requirements | **Confirmed** |
| National Blood Policy (2002) aims at voluntary, non-remunerated donation | `plan_donor_network.md` | Wikipedia: published 2002 | **Confirmed** (secondary); about 70% of blood is still voluntary, the rest replacement |
| DPDP Act 2023: notice, specific consent, withdrawal (s. 6) and erasure (s. 12) | `plan_donor_network.md`, `plan_panels.md` | India Code text; law-firm summaries | **Confirmed** in substance; the 2025 DPDP Rules weren't checked |

---

## Datasets and literature

| Fact | Used in | Source | Result |
|---|---|---|---|
| UCI blood transfusion: 748 donors, CC BY 4.0, Hsin-Chu, Taiwan | `report3.md` point 3.2 | UCI page | **Confirmed** |
| UCI: "29% exact duplicate rows"; "Monetary = 250 × Frequency" | `report3.md`, `data_integrity.md` | Downloaded and checked: 215 of 748 rows repeat another (28.7%); Monetary = 250 × Frequency in every row | **Confirmed** |
| Malaysia daily donations by group, national and states, CC BY 4.0 | `report3.md` | data.gov.my: national and state datasets, CC BY 4.0, from 22 main sites covering about 80% of donations | **Confirmed;** the "20 years" start date isn't shown on the page |
| M5 forecasting was won by global LightGBM models | `report3.md` point 5 | KAIST, Durham and IJF summaries | **Confirmed** (secondary) |
| data.gov.in blood bank directory, 2,823 banks | `report3.md`, `data_integrity.md` | data.gov.in returned 403 | **Unverified** |
| India Post PIN directory with coordinates | `plan_bank_locations.md` | Open Knowledge index and mirrors; the portal was unreachable | **Unverified** (plan already says so) |

---

## Project choices

These are parameters or the project's own analysis. They can't be checked against an outside source; each was judged for whether evidence supports it.

| Choice | Where | Evidence |
|---|---|---|
| Ranking weights, τ of 30, 45 and 60 min | `ranking.js` | Reasoned in `features.md`; the sensitivity analysis is outside the repo |
| Freshness full at 6 h, zero at 72 h, 30 when unknown | `ranking.js` | Supported by the project's median update gap of 24.2 h (history outside the repo) |
| Dormant after 30 days | `stock.js` | Today 6.3% of banks; the cut is clean, with 3.3% beyond 90 days |
| Units over 2,000 per group dropped | `stockQuality.js` | Today's 99th percentile is 287, so 2,000 is about seven times it |
| Urban when more than 10 banks are within 15 km; rings of 5 to 25 km and 20 to 150 km | `route.js` | From the ring-search spec in `../rough_work/` |
| City from 11 banks, town from 3 | `traffic.js` | Ties to the urban threshold |
| Rain factors 1.15 and 1.3 | `traffic.js` | At the low end of the two studies above; reasonable |
| Timeouts, caches, circuit (3 failures a minute, 2 minutes open), rate limits | `eraktkosh.js`, `routing.js`, `weather.js`, `rateLimit.js` | Engineering choices, consistent with the measured response times |
| 120-day gap for "other" gender | `eligibility.js` | Conservative (F22) |

---

## What couldn't be verified

- **The official NBTC 2017 PDF.** NACO's server reset the connection. The figures above come from a blood centre that reproduces its table, and a Studocu copy; check them against the PDF for #24.
- **Anything computed from data outside the repository:**
  - the stock history (update gaps, unit changes);
  - the data.gov.in crosswalk (34.5% matched, 15 placed);
  - the 80,757 camps;
  - the Malaysian statistics (Sunday × 1.71, Hari Raya);
  - the dengue figures;
  - the ranking-sensitivity results;
  - report 3's response times and the geospatial benchmark.
- **TomTom's cross-city fits** ("381 cities", "7.4 points per tenfold", "34 countries and 411 pairs"): the underlying table isn't kept.
- **Two pages that blocked automated access:** data.gov.in (403) and the AMS glossary (403, confirmed through search instead).

---

## What was changed

- **`plan_donor_network.md`:** the request-type row now says "single donor platelets (component 14, 'PLA')" and warns that eRaktKosh's "SDP" is Single Donor Plasma (F15).
- Nothing else. The other findings are listed for the owners of `CLAUDE.md`, `report3.md`, `data_integrity.md`, `supabase_scheduler.md` and the code to apply.

---

## Sources

**Live checks (24 October 2026):** eRaktKosh (`eraktkosh.mohfw.gov.in`), the OSRM demo server (`router.project-osrm.org`), TomTom Traffic Index city pages for [Mumbai](https://www.tomtom.com/traffic-index/city/mumbai/), Kolkata, Pune and [Bengaluru](https://www.tomtom.com/traffic-index/city/bengaluru/), and the [UCI dataset download](https://archive.ics.uci.edu/dataset/176/blood+transfusion+service+center).

**Medical**
- NBTC 2017 guidelines as reproduced by [Rashtrotthana Blood Centre](https://bloodcentre.rashtrotthana.org/criteria-for-blood-donation/), with a [Studocu copy](https://www.studocu.com/ph/document/colegio-san-agustin-bacolod/hematology/1-blood-donor/122242876); [Assam SBTC eligibility page](https://asbtc.assam.gov.in/frontimpotentdata/eligibility-criteria-for-blood-donation); [NBTC blood-bank standards](http://nbtc.naco.gov.in/page/bloodbankstandard/); [PMC: impact of the 2017 guidelines](https://pmc.ncbi.nlm.nih.gov/articles/PMC6825231/); [WHO: who can give blood](https://www.who.int/campaigns/world-blood-donor-day/2020/who-can-give-blood).
- [UTMB component ABO compatibility chart](https://www.utmb.edu/bloodbank/blood-componenet-abo-compatability-chart/1000); [Lifeblood component compatibility](https://www.lifeblood.com.au/health-professionals/products/component-compatibility); [NZ Blood plasma components](https://nzblood.co.nz/healthcare-professionals/transfusion-medicine/transfusion-medicine-handbook/4-blood-components/4-11-plasma-components); [AABB whole blood](https://aabb.org/regulatory-and-advocacy/regulatory-affairs/regulatory-for-blood/whole-blood-and-red-blood-cell-components); [MedicineNet: whole blood](https://www.medicinenet.com/whole_blood/article.htm).
- Bombay phenotype: [PMC4339919](https://pmc.ncbi.nlm.nih.gov/articles/PMC4339919), [Lifeblood](https://www.lifeblood.com.au/news-and-stories/health-professionals-news/one-for-all).
- [NHSBT amber alert, 2022](https://www.blood.co.uk/news-and-campaigns/news-and-statements/amber-alert-issued-on-blood-stocks-existing-o-neg-and-o-pos-donors-asked-to-make-appointments/); [ITV report](https://itv.com/news/2022-10-12/nhs-issues-first-ever-amber-alert-as-blood-stocks-fall); [Canadian Blood Services inventory guidance](https://professionaleducation.blood.ca/en/transfusion/best-practices/blood-utilization-best-practices/blood-system-inventory-management-best).

**Travel and weather**
- [OSRM demo-server policy](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server); [OSRM car profile](https://raw.githubusercontent.com/Project-OSRM/osrm-backend/master/profiles/car.lua); [FOSSGIS routing policy](https://routing.openstreetmap.de/about.html).
- [AMS glossary: rain](https://glossary.ametsoc.org/wiki/Rain); IMD rainfall categories ([Hyderabad bulletin](https://mausam.imd.gov.in/hyderabad/mcdata/tsfcst.pdf), [RSMC New Delhi](https://rsmcnewdelhi.imd.gov.in/uploads/archive/8/8_051ce4_hrainfall.pdf)); [IIT Bombay, WCTR 2019](https://www.wctrs-society.com/wp-content/uploads/abstracts/mumbai/WCTR2019_Mumbai_526.pdf); [The News Minute on MoveInSync](https://www.thenewsminute.com/article/bengaluru-rains-pushed-average-commute-time-62-august-167433); [Down To Earth on TomTom 2025](https://www.downtoearth.org.in/amp/story/urbanisation/bengaluru-kolkata-among-worlds-slowest-cities-as-india-ranks-high-on-congestion-index).
- [Open-Meteo docs](https://open-meteo.com/en/docs) and [terms](https://open-meteo.com/en/terms).
- [Ballou et al. (2002), country circuity factors](https://trid.trb.org/view.aspx?id=726009).

**Geography**
- [geoBoundaries IND ADM1 metadata](https://www.geoboundaries.org/api/current/gbOpen/IND/ADM1/); [extreme points of India](https://en.wikipedia.org/wiki/List_of_extreme_points_of_India); [WorldAtlas](https://www.worldatlas.com/articles/the-most-extreme-points-of-india.html).
- Census 2011 urban agglomerations ([Wikipedia list](https://en.wikipedia.org/wiki/List_of_million-plus_urban_agglomerations_in_India), [census2011.co.in](https://www.census2011.co.in/urbanagglomeration.php)).

**Platforms**
- [Supabase pricing](https://supabase.com/pricing), [Edge Function limits](https://supabase.com/docs/guides/functions/limits), [secrets](https://supabase.com/docs/guides/functions/secrets), [new API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys), [free-project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [getClaims](https://supabase.com/docs/reference/javascript/auth-getclaims), [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes), [MFA](https://supabase.com/docs/guides/auth/auth-mfa).
- [Vercel request headers](https://vercel.com/docs/headers/request-headers); [CARTO basemap styles](https://github.com/CartoDB/basemap-styles); [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/); [WebKit: web push on iOS](https://webkit.org/?p=13878).
- Google: [Routes traffic models](https://developers.google.com/maps/documentation/routes/traffic-model), [Compute Route Matrix](https://developers.google.com/maps/documentation/routes/compute_route_matrix), [service terms](https://cloud.google.com/maps-platform/terms/maps-service-terms/index-20240522), [pricing](https://developers.google.com/maps/billing/overview/).
- [Plivo: DLT registration](https://www.plivo.com/docs/sms/concepts/dlt-registration-process).

**Law and datasets**
- *Common Cause v. Union of India* ([Legal Authority](https://www.legalauthority.in/judgement/common-cause-a-regd-society-new-delhi-vs-union-of-india-26678), [Common Cause](https://www.commoncause.in/writ_details.php?id=55)); [Blood donation in India](https://en.wikipedia.org/wiki/Blood_donation_in_India); [CDSCO blood-centre guidelines (2020)](https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2018/UploadBloodBank/Guidelines_for_blood_bank-merged-with-GSR-166E-dated-11.03.2020.pdf); [DPDP Act 2023 (India Code)](https://www.indiacode.nic.in/bitstream/123456789/22037/2/a2023-22.pdf); [MoHFW: about e-RaktKosh](https://eraktkosh.mohfw.gov.in/BLDAHIMS/bloodbank/about.cnt).
- [UCI blood transfusion dataset](https://archive.ics.uci.edu/dataset/176/blood+transfusion+service+center); data.gov.my [national](https://data.gov.my/data-catalogue/blood_donations) and [state](https://data.gov.my/data-catalogue/blood_donations_state) donations; M5 summaries ([KAIST](https://dspace.kaist.ac.kr/handle/10203/299580), [Durham](https://durham-repository.worktribe.com/OutputFile/1207845)).
