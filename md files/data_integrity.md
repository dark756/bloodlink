# Data integrity: reviewer point 3

This document records how bloodLink's blood-bank data was checked for the reviewer's point 3, what the checks found, and what was fixed. The work was done on 23 and 24 October 2026.

> **Point 3, as the reviewer wrote it.** "Strengthen Data Quality and Freshness Handling: As the system relies on eRaktKosh and data.gov.in, the report should explain how the approximately 4,487 records are standardized, validated, deduplicated, and refreshed. The handling of stale data and API failures should also be demonstrated. Also try to search other datasets also."

- **Sources of the earlier numbers.** `report3.md` (points 3.1 and 3.2) describes how the data pipeline was built. This document checks that work independently, then records the faults found and how each was fixed.
- **Paths.** Code paths are relative to `bloodlink/`, data paths to `blood_data/`.
- **Issue numbers** (#33 to #41) are the stable IDs in `CLAUDE.md`'s known-issues list.

**Contents**
1. [Summary](#summary)
2. [Which records: the 4,487 figure](#which-records-the-4487-figure)
3. [Standardised](#standardised)
4. [Validated](#validated)
5. [De-duplicated](#de-duplicated)
6. [Refreshed](#refreshed)
7. [Stale data](#stale-data)
8. [API failures](#api-failures)
9. [Other datasets](#other-datasets)
10. [Faults found and fixed](#faults-found-and-fixed)
11. [What remains](#what-remains)
12. [How to repeat the checks](#how-to-repeat-the-checks)

---

## Summary

| Reviewer asked for | Status | Evidence |
|---|---|---|
| Standardise the records | **Done** | 1,694 blood-group labels renamed to 10 canonical names; names, times and component codes normalised. Re-run: same counts. |
| Validate them | **Done, and extended** | Unit counts, group names and future dates checked on every response: 30 implausible counts dropped. **New:** coordinates are now checked against state boundaries. 206 banks that eRaktKosh places outside their own state are flagged and left out of location search (#36). |
| De-duplicate them | **Done, with 6 pairs to review** | No repeated bank codes in 4,707 rows; history unique per bank and update; 6 likely duplicate code pairs listed for review. |
| Refresh them | **Done** | Hourly stock collection, 36 of 36 states in every run since the fix on 23 October. Weekly directory refresh; its first scheduled run is Monday 26 October. |
| Handle stale data | **Done, two faults fixed** | Two ages on every bank, 297 dormant banks marked. Fixed: dormant banks could choose the search ring (#40); the outage banner could show the directory's age as the stock's (#39). |
| Demonstrate API failures | **Done, two faults fixed** | Every failure mode re-run on a production build. Fixed: the saved copy could count the wrong blood component (#37); one failing state cut every state off from live data (#38). |
| Search other datasets | **Done** | Camps, data.gov.in, Malaysia MoH, UCI and NCVBDC, each validated (`report3.md`, point 3.2). Camp data checked for personal details: none. |

---

## Which records: the 4,487 figure

The Sem 7 progress report says bloodLink "built a standardized master directory of approximately 4,487 hospitals and blood centres". No dataset kept in the workspace has that count. The nearest is **4,457**, the number of banks a nationwide eRaktKosh `nearest` call returned in April 2026 (`rough_work/info.txt`), so 4,487 is probably a slip.

On 23 October 2026 the counts were:

| Set | Banks | What it is |
|---|---|---|
| eRaktKosh stock (`blood-availability`, all 36 states) | **4,707** | Every bank that reports stock. This is what search ranks. |
| eRaktKosh directory (`nearest`, nationwide) | **4,328** | Every bank with coordinates. Location search needs these. |
| In both | 4,028 | |
| Stock but no coordinates | 679 | Invisible to location search; region search still lists them (#33). |
| Coordinates but no stock row | 300 | |
| **All distinct bank codes** | **5,007** | |
| data.gov.in blood bank directory | 2,823 | Older, with licence dates and service hours. 34.5% match eRaktKosh. |

The numbers move as eRaktKosh adds and removes banks, so the documents should quote the date with any count.

---

## Standardised

Every eRaktKosh stock response passes through one validator, `src/lib/stockQuality.js`, in the app and in the hourly collector alike.

| Field | Standard | Count on the 23 October sweep |
|---|---|---|
| Blood-group labels | One of 10 canonical names. "O +ve", "o+VE" and "O +Ve" all become `O+Ve`. | **1,694** labels renamed |
| Bank names and addresses | Trailing commas and spaces removed | All rows |
| Update times | Parsed as India time, stored as UTC | All rows |
| Components | Kept by eRaktKosh's own name; the history stores the short code (`PRBC`, `FFP`) | All rows |

**Why it mattered.** Before the label fix, every search missed those 1,694 entries, in at least 10 states, because the names were compared exactly.

**Checked again on 24 October.** Re-running the validator over the raw sweep in `eraktkosh/state_sweeps/2026-10-23T1830/` gave the same 1,694.

---

## Validated

### Stock values

| Rule | Why | Result on 4,707 banks |
|---|---|---|
| Units per group must be a whole number from 0 to 2,000 | 99% of entries are 290 or less; 30 listed over 2,000, up to 15,280 | **30** entries dropped |
| The group must be one of the 10 known groups | Unknown labels can't be matched to a patient | 0 unknown |
| An update time more than 10 minutes in the future becomes unknown | A future time would score as perfectly fresh | 0 found |
| A bank listed twice in one response keeps its newer row | Guard only | 0 found |
| Stock older than 30 days is **dormant** | 6.3% of banks; see [Stale data](#stale-data) | **297** banks |

All five counts were reproduced exactly on 24 October.

### Coordinates (new)

eRaktKosh's `nearest` call supplies each bank's latitude and longitude. Report 3 flagged two kinds of bad position: 2 banks outside India, and 606 banks sharing 203 identical points, probably district defaults.

**The check on 24 October found a third, worse kind: banks placed in the wrong state.**
- In central Delhi, 36 of the 51 banks within 5 km of Connaught Place belong to other states: Punjab, Kerala, Tamil Nadu, Assam, Arunachal Pradesh, Uttar Pradesh and more. Their addresses say so.
- A critical search for 4 units of O+ red cells in Delhi ranked Atulaya Blood Centre first, "5 min away", and the plan took all 4 units from it. It is in Muktsar, Punjab, about 400 km away. For O-, the top choice was Apollo, Chennai.
- Wallajah District Hospital, Tamil Nadu, was placed in Mumbai.
- None of these had been flagged, and location search never read the flags anyway.

**The fix (#36).**
1. `assets/state_boundaries.json` holds an outline of each of the 36 states and union territories, from geoBoundaries (DataMeet India community, CC BY 2.5 IN). The outlines are simplified to about 1 km. `scripts/build-state-boundaries.mjs` rebuilds the file.
2. `src/lib/stateBounds.js` says whether a bank's point lies inside its own state, allowing 5 km for border cases.
   - **Margin.** Of the banks outside their state, 30 are within 5 km of it and are kept as genuine border cases.
   - **Borderline cases checked by hand.** The 21 banks 5 to 25 km out were all real errors: Agra, Kanpur and Prayagraj banks placed in Delhi, a Punjab bank placed near Lahore, and a Gujarat bank in the sea.
3. Location search leaves misplaced banks out and says how many. Region search still lists them.
4. The collector flags them `wrong_state` in `blood_banks.location_quality`. Migration `20261024000100_wrong_state_locations.sql` adds the value and gives them no PostGIS point.

| `location_quality` | Before (23 Oct) | After (24 Oct) |
|---|---|---|
| `ok` | 3,720 | 3,602 |
| `shared` (same point as another bank) | 606 | 518 |
| `wrong_state` | (not checked) | **206** |
| `outside_india` | 2 | 2 |

**After the fix**, the same Delhi searches list only Delhi banks:
- 44 misplaced banks within 25 km are left out.
- The O+ plan now takes its 4 units from a bank in South Delhi.

---

## De-duplicated

| Level | How | Result |
|---|---|---|
| Within one response | Newer row wins for a repeated `hospitalCode` | 0 repeats in 4,707 rows, within or across states |
| Across hourly sweeps | `stock_history` is unique on (bank, update time) | 4,786 history events on 23 October, no duplicates |
| Inside eRaktKosh | Same point plus a similar distinctive name | **6 likely duplicate pairs**, for example "Vardaan Charitable Blood Centre" and "VARDAAN BLOOD CENTRE" (`crosswalk/eraktkosh_possible_duplicates.csv`). Not merged yet: they need checking by phone or against the licence list. |
| Against data.gov.in | Under 300 m apart plus a matching distinctive word | 34.5% of data.gov.in banks matched; 15 coordinate-less eRaktKosh banks could be placed from it |
| Within data.gov.in | Same fields | 33 duplicate rows, 372 at (0, 0), 14 outside India |

**Matching on distinctive words.** The first name matcher paired "Sadar Hospital Ara" with "Sadar Hospital Nawada". Generic words ("Hospital", "District", "Charitable") and place names are now removed before comparing names.

---

## Refreshed

| Data | How often | Where it goes | Status on 24 October |
|---|---|---|---|
| Stock, all 36 states | **Hourly**, at 5 past the hour | `bank_stock_latest`, `stock_history`, and a local archive | 36 of 36 states saved at 23:05 and 00:05 India time. A full sweep takes about 2.5 minutes. |
| Directory (`nearest`) | Weekly, Mondays 03:35 | `blood_banks` | First scheduled run due Monday 26 October. Run by hand once on 24 October to apply the new flags. |
| District list (`master/all`) | By hand, now and then | `assets/district_data.json` | Refreshed 23 October: 3 districts added, 1 removed. |

- **Why hourly.** A bank updates its stock about once a day (median gap 24 h), so more often would mostly re-read unchanged data.
- **Uploads.** Only banks whose update time changed are uploaded in full; the rest get a new fetch time.
- **Retention.** History is kept 60 days in Supabase and indefinitely in `eraktkosh/history/`.
- **Limits.**
  - Collection runs only while the project laptop is on (#35). A plan to move it to Supabase is approved but not started (`supabase_scheduler.md`).
  - Two early runs were stopped by a console signal. Since the collector runs in its own hidden console, no run has failed.

---

## Stale data

eRaktKosh stock is what each bank last typed in. The median age is 9.7 hours, but 6.3% of banks haven't updated in 30 days.

| Measure | What the user sees |
|---|---|
| Two ages per bank | "Bank updated 3 h ago · checked 12 min ago": when the bank updated, and when bloodLink fetched it. |
| Freshness score | 100 within 6 hours, falling to 0 at 72 hours; 20 to 35% of a bank's ranking. |
| Dormant banks (30+ days) | Listed with a red badge, never used in the response plan. |
| Saved-copy banner | Yellow when stock comes from a saved copy under 24 hours old, red when older. |

**Two faults found and fixed.**
- **#40 · Dormant banks could choose the search ring.** In nearest mode, the search stopped at the first ring holding any stocked bank, even a dormant one. If that was the only bank within 5 km, the user saw just that bank. Ring choice now ignores dormant banks (`src/lib/rings.js`). They are still listed, and still shown when no active bank has stock.
- **#39 · The banner could show the directory's age as the stock's.**
  - During an outage, the bank list comes from the saved directory, which is refreshed weekly. Its date was folded into the stock's age.
  - So from about a day after each Monday refresh, every outage would have shown the red "stock has probably changed" banner, even with stock saved an hour earlier.
  - The two ages are now reported apart (`oldestFetchedAt` for stock, `locationsFetchedAt` for the directory). The banner now says "some of the stock shown was saved …", which matches the value it shows.

---

## API failures

Each eRaktKosh lookup falls back in order: memory cache (5 minutes), live call (one retry; after 8 s, serve a backup while the call finishes), older memory copy, the copy saved in Supabase, then a clear error with a Retry button.

Re-run on 24 October against production builds:

| Drill | Result |
|---|---|
| eRaktKosh **down** | Every search answered from the saved copy. The Mumbai ranked plan still covered 3 of 3 units. |
| eRaktKosh **slow** (+12 s per call) | Region search answered from the saved copy in 8.2 s; ranked Mumbai in 11.1 s. |
| **One state blocked** (Maharashtra) | Mumbai answered from the saved copy. After four Maharashtra failures, Goa, Tamil Nadu and Gujarat were all still live. |
| Road routing (**OSRM**) down | Every bank fell back to an estimated travel time; the search still answered. |

**Two faults found and fixed.**
- **#37 · The saved copy could count the wrong blood component.**
  - The collector saves every component. When a bank listed only one, the search treated it as whatever component was asked for.
  - With eRaktKosh down, a search for A+ red cells near Saifai ranked a plasma-only bank first with "408 units" and sent the patient there. 29 stocked banks list a single component.
  - Components now match by name only. The saved copy is cut to the requested component, exactly as a live filtered answer is.
  - The name match was first confirmed live for every component eRaktKosh offers.
- **#38 · One failing state cut every state off from live data.**
  - The circuit breaker was shared. Three failures from one state within a minute sent every state to the saved copy for 2 minutes.
  - The first drill missed it only because each Mumbai search also fetched Tamil Nadu (for the misplaced Wallajah bank), and that success reset the circuit.
  - Each state now has its own circuit. The service-wide one opens only when failures come from two or more places.

---

## Other datasets

All are stored and catalogued in `blood_data/` (`README.md`), with validation reports in `blood_data/quality/`.

| Dataset | Size | Validation summary | Use |
|---|---|---|---|
| eRaktKosh donation camps | 80,757 camps, Oct 2025 to Nov 2026 | No duplicate ids; 78.9% linked to a bank. **No personal details:** organiser names and phone numbers were dropped before saving, and a scan of the file on 24 October found none. | Supply events for the stock-out forecast |
| eRaktKosh auto-refresh list | 452 banks | Median stock age 0.3 h, against 9.7 h for the rest | Cleanest series to model first |
| data.gov.in blood bank directory | 2,823 banks | 33 duplicates, 372 at (0, 0), licence dates up to "2105" | Licences, service hours, placing banks |
| Malaysia MoH daily donations | 20 years, national and 13 states | No missing days; groups add up on 96 to 100% of days | Testing forecast methods on a long series |
| UCI blood transfusion | 748 donors | 29% exact duplicate rows | Donor-response model |
| NCVBDC dengue cases | 36 states, 2021 to 2026 | State sums match the totals | Seasonal platelet demand |
| geoBoundaries IND states (new) | 36 outlines | Every outline matched an eRaktKosh state by name | The wrong-state check above |

The monthly stock and issue reports that a demand model would need (`MonthlyCollection/*`) need a blood-bank login; access must be requested from NBTC or MoHFW.

---

## Faults found and fixed

| # | Fault | Before | After |
|---|---|---|---|
| 36 | Banks placed in the wrong state ranked as nearby | Delhi O+ plan: a Punjab bank, "5 min" | Delhi lists only Delhi banks; 206 banks flagged nationwide |
| 37 | Saved copy counted the wrong component | A plasma-only bank ranked first for red cells with 408 units | Not listed for red cells; still listed for plasma |
| 38 | One failing state opened the circuit for all | After 3 Maharashtra failures, Goa served from the saved copy | Goa, Tamil Nadu and Gujarat stay live |
| 39 | Outage banner used the directory's age | Stock age = older of stock and directory | Reported apart; the banner wording matches |
| 40 | Dormant banks chose the nearest-mode ring | A lone dormant bank could end the search at 5 km | Ring set by active banks only |
| 41 | Rate limit dodged with a fake `X-Forwarded-For` | A new header per request, no limit | Header trusted only on Vercel or behind configured proxies; the 21st request in a minute is refused |

**How the fixes were checked.**
- Each fix has unit tests: 24 new, 118 in all.
- Lint, the format check and the production build pass.
- 18 live checks ran against production builds (normal, eRaktKosh down, Maharashtra blocked, no trusted proxy), plus the 27 earlier ones.
- The new migration is applied to the live project, and the directory was re-flagged.

**A wrong statement corrected.** `CLAUDE.md` said eRaktKosh filters "never remove banks". The component filter does: Mizoram has 9 banks unfiltered and 8 with the red-cell filter. The note now says so.

---

## What remains

| Item | Why it matters | Next step |
|---|---|---|
| 679 stocked banks without coordinates (#33) | Location search can't see 14% of stocked banks | Place 15 from data.gov.in (`crosswalk/coordinates_for_unlocated_banks.csv`); geocode the rest from their addresses |
| 206 wrong-state and 518 shared-point banks (#34) | Wrong-state banks are now hidden from location search; shared-point distances may be off by a few km | Re-place them the same way as #33, then clear the flag |
| 6 likely duplicate code pairs (#34) | One bank could appear twice | Check by phone or licence number, then merge |
| Collection depends on the laptop (#35) | History will have gaps | `supabase_scheduler.md`, when approved to start |
| Weekly directory task not yet run on schedule | The new flags rely on it | Confirm Monday 26 October's run in `eraktkosh/collector.log` |

---

## How to repeat the checks

Run from `bloodlink/` unless noted.

```bash
npm run lint && npm run format:check && npm test && npm run build
node scripts/migrate.mjs --status                 # 4 migrations applied
# Directory flags (needs SUPABASE_DB_URL); the weekly task runs this:
npm run snapshot -- --directory --prune
# Production build for the live checks; TRUSTED_PROXY_HOPS=1 lets scripts simulate many users:
TRUSTED_PROXY_HOPS=1 npx next start -p 3126
TRUSTED_PROXY_HOPS=1 ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1 ERAKTKOSH_SIMULATE=down npx next start -p 3128
TRUSTED_PROXY_HOPS=1 ERAKTKOSH_SIMULATE_ALLOW_PRODUCTION=1 ERAKTKOSH_SIMULATE_STATES=27 npx next start -p 3129
```

Spot checks against those servers:
- `GET /api/blood-search?lat=28.6139&lng=77.2090&componentId=12&bloodGroupId=15&units=4&urgency=critical` on 3126. Every result's address is in Delhi, and `misplacedBanks` is above 0.
- `GET /api/blood-search?lat=26.9608&lng=78.9621&componentId=12&bloodGroupId=11&units=2&urgency=critical` on 3128. Bank 1702 (Saifai) is not listed.
- On 3129: four Mumbai ranked searches, then `GET /api/search?stateCode=30`. `X-Data-Source` is `live`.
- From the workspace root, re-run the data validators:
  - `python -I blood_data/scripts/validate_eraktkosh.py blood_data`
  - `python -I blood_data/scripts/validate_history.py blood_data`
