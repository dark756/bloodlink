# Summary: data quality and freshness

*As of 4 November 2026. The full record follows the summary: [the feature in full](#the-feature-in-full), then [report 3's record](#report-3s-record) of points 3.1 and 3.2, re-checked independently in [`../data_integrity.md`](../data_integrity.md). The datasets are catalogued in `../blood_data/README.md`, with validation reports in `../blood_data/quality/`, outside git.*

**What was asked** (reviewer point 3): explain how the "approximately 4,487 records" are standardised, validated, de-duplicated and refreshed; demonstrate the handling of stale data and API failures; and search for other datasets.

**The answer in brief.**
- **One validator** standardises and checks every eRaktKosh response, in the app and in the collector.
- **Stock is collected every 4.5 hours** in Supabase, around the clock, with every change archived.
- **Each bank shows two ages:** when it updated, and when bloodLink checked.
- **A six-step fallback** answers every search when eRaktKosh is down, slow or failing, as a drill showed.
- **Six other datasets** were found, validated and catalogued.

The known gaps are bank locations: 679 banks have no coordinates and 206 sit in the wrong state.

| Status | |
|---|---|
| **Done** | Standardise, validate, de-duplicate, refresh; stale data and failures demonstrated; six other datasets |
| **Planned** | Placing the 679 unlocated banks and the 206 in the wrong state (#33, #34) |
| **Not touched** | Merging 6 likely duplicate bank pairs; monthly issue data (it needs a login); refreshing the data.gov.in directory (it needs our own API key) |

---

## Which records

No dataset has 4,487 records. The nearest is 4,457, the banks a nationwide eRaktKosh call returned in April 2026, so 4,487 is probably a slip. These are the counts on 23 October 2026, and every count in the final report should carry its date:

| Set | Banks |
|---|---|
| eRaktKosh stock, all 36 states: what search ranks | **4,707** |
| eRaktKosh directory, with coordinates: what location search needs | **4,328** |
| In both | 4,028 |
| Stock but no coordinates | 679 |
| Coordinates but no stock row | 300 |
| data.gov.in blood bank directory | 2,823 (34.5% match eRaktKosh) |

## Standardised, validated, de-duplicated

| Step | What | Result |
|---|---|---|
| Group labels | 10 canonical names: "O +ve", "o+VE" and "O +Ve" all become `O+Ve` | **1,694** entries renamed. Before this, every search missed them in at least 10 states |
| Names, times, components | Trimmed; India time stored as UTC; components matched by eRaktKosh's own name | All rows |
| Units | A whole number from 0 to 2,000 | **30** implausible entries dropped, up to 15,280 |
| Future update times | Over 10 minutes ahead counts as unknown | 0 found |
| Dormant banks | No update in 30 days | **297** banks (6.3%) |
| Location | The bank's point must lie inside its own state, with a 5 km margin (geoBoundaries outlines) | 3,602 fine, 518 on a shared point, **206 in the wrong state**, 2 outside India |
| Duplicates within a response and across runs | The newer row wins; history unique on bank and update time | 0 found |
| Duplicates inside eRaktKosh | The same point plus a similar distinctive name | **6 likely pairs,** listed but not merged |
| Matching data.gov.in | Under 300 m apart plus a matching distinctive word | 34.5% matched; 15 unlocated banks can be placed from it |

The state check matters. In central Delhi, 36 of the 51 banks within 5 km of Connaught Place belong to other states. A critical Delhi search now lists only Delhi banks.

## Refreshed

| Data | How often | Where |
|---|---|---|
| Stock, all 36 states | **Every 4.5 hours** since 3 November, by Supabase `pg_cron` and an Edge Function in Mumbai | `bank_stock_latest` and `stock_history`, with every change archived in Supabase Storage, and a weekly copy on the laptop |
| Directory | Weekly, on Mondays | `blood_banks` |
| District list | By hand, now and then | `assets/district_data.json` |

- **Why 4.5 hours:** a bank updates about once a day (a median gap of 24.2 hours). Measured on hourly sweeps, 4.5 hours misses 4.9% of updates, most of them values replaced within 10 minutes, for a fifth of the calls.
- **Before 3 November,** the laptop collected hourly, but only while it was on.

## Stale data

73% of banks update between 07:00 and 12:00, so the median age depends on the hour: 9.7 hours one evening, 3.3 hours the next morning.

| Measure | What the user sees |
|---|---|
| Two ages on every bank | "Bank updated 3 h ago · checked 12 min ago" |
| Freshness score | 100 within 6 hours, falling to 0 at 72 hours; 20% to 35% of a bank's ranking |
| Dormant banks | A red badge; never chosen for the plan |
| Saved-copy banner | Yellow for a saved copy under 24 hours old, red when older |

## API failures

Each eRaktKosh lookup takes the first step that has data:
1. the memory cache, under 5 minutes old;
2. a per-state circuit: after 3 failures within a minute, skip that state's live call for 2 minutes;
3. a live call with one retry, giving up after 8 seconds when a backup exists;
4. the older copy in memory;
5. the copy saved in Supabase;
6. a clear error with a Retry button.

The failure drill (down, slow, flaky, one state blocked, OSRM down) answered every search. Its results are in [`performance_testing.md`](performance_testing.md). The drills and checks found five faults, all fixed (#37, #38, #44, #45, #50).

## Other datasets

| Dataset | Size | Use |
|---|---|---|
| eRaktKosh donation camps | 80,757 camps, 78.9% linked to a bank; personal details dropped | Supply events |
| eRaktKosh auto-refresh list | 452 banks | Possibly the cleanest series to model |
| data.gov.in blood bank directory | 2,823 banks | Licences, service hours, placing banks |
| Malaysia's daily donations | 20 years, national and 13 states | Rehearsing the forecast |
| UCI blood transfusion | 748 donors | Donor behaviour in the donor network's simulation |
| NCVBDC dengue cases | 36 states, 2021 to 2026 | Seasonal platelet demand |
| geoBoundaries state outlines | 36 outlines | The wrong-state check |

Not used: eRaktKosh's monthly reports need a login, Indiastat is paid, Kaggle needs a login, and NHSBT, Lifeblood and Hong Kong publish no historical stock levels.

## What is left

- **Bank locations** (planned, #33 and #34; `../PLANS/plan_bank_locations.md`):
  - 679 stocked banks have no coordinates, 14% of stocked banks, invisible to location search;
  - 206 are placed in the wrong state;
  - 15 can be placed from data.gov.in now.
- **The 6 likely duplicate pairs,** to check by phone or licence number, then merge.
- **Monthly issue data,** real demand per bank. It needs a blood-bank login. A letter to NBTC or MoHFW is suggested in [`../plans.md`](../plans.md), item 5.

---

## The feature in full

*Moved here word for word on 4 November 2026, when `docs/features.md` and `docs/report3.md` were folded into these summaries. "The feature in full" is the feature list's description of how it works now. "Report 3's record" is report 3's dated record of the work: it keeps the history, and its cross-references ("point 3.1", "D2.4") name parts of report 3 that [`../deliverables.md`](../deliverables.md) maps to these files.*

### Stock collected in Supabase, every 4.5 hours
Files: `src/lib/collector.js`, `supabase/functions/collect-stock/index.ts`, `supabase/migrations/20261103000100_cloud_collector.sql`, `scripts/setup-cloud-collector.mjs`, `scripts/upload-archive.mjs`, `scripts/sync-archive.mjs`, `src/app/admin/page.js`

The saved copy that searches fall back to when eRaktKosh is down is refreshed around the clock, not only while the project laptop is on.
- **How.** `pg_cron` in the database checks every 30 minutes whether a sweep is due. Every 4.5 hours it posts four batches of 9 states, 2 minutes apart, to the `collect-stock` Edge Function in Mumbai, which calls eRaktKosh one state a second and saves through the limited `bloodlink_ingest` role, with the same validation as before. Searches and the stock tables are unchanged.
- **Safe to leave running.** The function needs a secret kept in Vault. It refuses a job that already ran in the last 50 minutes, so collection can never be more often than hourly, and it stops starting states before the 150-second limit.
- **History kept for good.** Every change is archived, gzipped, in the private Storage bucket `stock-archive`, including everything the laptop collected since 23 October. The database keeps 60 days, and its weekly prune deletes a day only once the archive holds all of it. A weekly laptop task copies the archive into `../blood_data/` as a second copy.
- **Visible.** The admin overview shows the last sweep, in red when none has finished within the interval plus 2 hours.
- **Why 4.5 hours.** It misses 4.9% of the updates hourly sweeps see, most of them values replaced within 10 minutes, for a fifth of the calls. Its times shift each sweep, so every hour of the day gets sampled. The measurements and decisions are in report 3's record, below.
- **Cost:** ₹0 on the free plan.

### Found in the 24 October data checks
`docs/data_integrity.md` has the evidence for each, before and after.
- **#36 · Banks in the wrong state ranked as nearby.** A Delhi search for O+ put a bank in Muktsar, Punjab, first, "5 min away". Location search now leaves out banks outside their own state, and the collector flags them `wrong_state`.
- **#37 · The saved copy could count the wrong component.** With eRaktKosh down, a plasma-only bank ranked first for red cells. Components now match by name only, and the saved copy is cut to the requested component.
- **#38 · One failing state cut every state off from live data.** Each state now has its own circuit. The service-wide one opens only when failures come from two or more places.
- **#39 · The outage banner could show the directory's age as the stock's.** The two ages are now reported apart.
- **#40 · A dormant bank could choose the search ring.** Ring choice now ignores dormant banks.
- **#41 · A made-up `X-Forwarded-For` header dodged the rate limit.** The header is now trusted only on Vercel or behind proxies set in `TRUSTED_PROXY_HOPS`.

## Report 3's record

### Point 3.1: stale data, eRaktKosh failures and hourly collection

> *Request:* execute `IMMEDIATE_NEXT_STEP.MD`, and make sure a system can load the API results at a reasonable refresh rate. This is for data collection only at this stage, not deployment: hourly or less often.

`IMMEDIATE_NEXT_STEP.MD` was a plan on hold, and this request lifted the hold. It had four phases: 0 (checks), 1 (resilience in the app), 2 (a saved copy that survives restarts) and 3 (measurement). This section records the plan and what was done, so the file has been retired.

#### Phase 0: checks, run on 2026-10-23 from 18:30 India time

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

#### Plan

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

#### Decisions

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

#### Steps taken

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

#### Results

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

#### Data quality write-up (reviewer point 3)

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

#### Findings to fix later (added to CLAUDE.md as #33 to #35)

- **#33: 679 stocked banks (14%) have no coordinates in eRaktKosh's `nearest`.** Location search can't see them. Point 3.2 looks for their locations in other datasets.
- **#34: eRaktKosh coordinates are unreliable for 726 banks** (counted on 24 October). 206 sit outside their own state, 2 outside India, and 518 share points with other banks. Location search leaves out the first two kinds, and distances to the third may be off by a few km.
- **#35: collection runs only while this machine is on and logged in.** The history will have gaps. Moving the scheduler to a server is deployment work. **Done on 3 November** (below).

#### Collection moved to Supabase (3 November)

On 3 November collection moved off the laptop into the Supabase project, which closes #35. This records the plan that was carried out, `docs/PLANS/supabase_scheduler.md`. It was approved on 23 October, with all seven decisions answered that day, and was folded in here once done; the migration's header still names it. How to run, change and roll back the collector is in `CLAUDE.md`, and every function is in `docs/CODE_REFERENCE.md`.

##### Why

- **The laptop was the weak point.** The hourly task ran only while the laptop was on and signed in, about 6 hours in 10, and two of its first four runs died after one state. Every hour it was off left a gap in the history the forecast learns from.
- **Supabase runs it in the project the data already lives in:** `pg_cron` fires on schedule, `pg_net` calls an Edge Function, and the function does what the laptop did. No new account or machine is needed, and the code is in the repository.
- **What stayed the same:** the app and its search code; the stock tables, the `bloodlink_ingest` role and the validation in `src/lib/stockQuality.js`; the directory's state-outline check (#36); and one call per state, one second apart.

##### How it works

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

##### How often: every 4.5 hours (decision 6)

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

##### Decisions (23 October)

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

##### Steps taken

1. **Phase 1, the code, written on 3 November:** `src/lib/collector.js`, which `scripts/snapshot.mjs` now wraps (the laptop's 13:05 sweep that day ran on it, 36 of 36 states); the `collect-stock` and `collector-probe` functions, which pass `deno check`; the migration `20261103000100_cloud_collector.sql`; the setup, check, probe, upload and sync scripts; the admin overview's "last sweep" line; and 15 unit tests, for 150 in all. `scripts/check-cloud-collector.mjs` ran its 27 SQL checks on the Tokyo project inside a rolled-back transaction, and again on Mumbai once the migration was applied there.
2. **The move to Mumbai (#28) came first,** the same day, so the collector was built on the final project.
3. **Phase 0, before anything was scheduled** (`node scripts/probe-cloud-collector.mjs`, `../blood_data/measurements/collector_probe_2026-11-03.json`). A throwaway function, deleted afterwards, showed the results below. The probe's function and script were removed from the repository on 4 November, once collection had cut over; git history keeps them.
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

##### Results

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

##### Sources

- [Edge Functions limits](https://supabase.com/docs/guides/functions/limits): free plan 150 s wall clock, 256 MB, 2 s CPU per request.
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions), and [pg_cron in Supabase](https://supabase.com/docs/guides/database/extensions/pgcron): `pg_cron` with `pg_net`, secrets in Vault.
- [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets): `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEYS` are provided; `SUPABASE_SERVICE_ROLE_KEY` is legacy, and [the legacy keys are being retired](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys).
- [Regional invocations](https://supabase.com/docs/guides/functions/regional-invocation): `x-region`, and `x-sb-edge-region` in the answer.
- [Deploying without Docker, importing files outside `supabase/`](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory).
- [Database backups](https://supabase.com/docs/guides/platform/backups): Storage objects aren't included, and free projects aren't backed up.
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing): restorable for up to a year (`docs/verify_facts.md`, F13); a [community note](https://github.com/orgs/supabase/discussions/13121) that `pg_cron` activity counts.
- [Pricing](https://supabase.com/pricing): free plan 1 GB Storage, 5 GB egress a month.
- [Task Scheduler settings](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2008-r2-and-2008/cc722178(v=ws.11)): "Run task as soon as possible after a scheduled start is missed" runs a task missed while the computer was off, after a 10-minute wait.

### Point 3.2: re-collecting, validating and de-duplicating the data; other datasets

> *Request:* look into the downloaded eRaktKosh results in `rough_work/`, write and run code to call the API again, and look into data validation and duplicates. Search the web for other sources of similar data that could train the model in the slides: trends in a hospital's stock falling below a threshold, so donors and users can be told to donate before it does. Only find and validate data; don't build the model yet. Store it in `blood_data/`.

#### What was already downloaded

| File | What it is | Source endpoint | Can it be refreshed? |
|---|---|---|---|
| `rough_work/district_data.json` (April 2026) | States, districts, blood groups, components and form lists | `POST /eraktkosh/master/all` with `{"hospitalCode":100}`, found in the portal's script | Yes. Re-fetched; see below |
| `rough_work/state_data.json` (April 2026) | Per state: blood collected, blood centres, registered donors, camps organised, upcoming camps | An old dashboard call that is no longer in the portal's script | No. Kept as a dated snapshot |
| `rough_work/info.txt` | Sample `blood-availability` and `nearest` rows, plus counts (4,457 nearest, 4,170 by state) | `blood-availability`, `nearest` | Yes. Re-collected in full in point 3.1 |
| `redundant_bloodlink/all_gov_data.json` | data.gov.in "Blood Bank Directory": 2,823 banks with coordinates, licence dates and service hours | data.gov.in API (a key is needed, #19) | Not without a key of our own. Used as it is |
| `redundant_bloodlink/village_data.json` | Maharashtra's village directory (LGD codes) | data.gov.in | Not relevant to blood stock. Not used |

#### eRaktKosh calls found in the portal's own script

The public portal's bundled script (`static/js/main.09cdccc7.js`, 4.5 MB) lists every call it makes.

| Public, no login | Behind a blood-bank login (an SSO ticket) |
|---|---|
| `blood-availability`, `bloodbank/nearest`, `bloodbanks` | `MonthlyCollection/bloodStockComponentWise` |
| **`camps/details?stateCode&districtCode&startDate&endDate`**: donation camps, past and future | `MonthlyCollection/componentWiseISsueCollection` (units issued per component per month) |
| `camps/hospitalCode`: one bank's camps | `MonthlyCollection/MonthlyData`, `getmonthlyreport` |
| `master/all` (POST) | |
| **`master/portal-refresh-hospitals`**: 452 bank codes with automatic stock refresh | |

The login-only monthly endpoints hold exactly what a demand model needs: units issued per component per month, per bank. They are not used here. Getting that data properly means an access request to NBTC or MoHFW, recorded as a recommendation in point 5.

#### Plan

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

#### Decisions

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

#### Steps taken

1. Created `blood_data/` with a folder per source, the scripts kept apart, and the catalogue `blood_data/README.md`.
2. Archived the April downloads with their dates, plus today's raw state sweep and directory.
3. Read the eRaktKosh portal's script to list every call it makes. That found the camp, master and auto-refresh calls, and showed that the monthly stock and issue reports need a login.
4. Re-fetched `master/all` and `portal-refresh-hospitals`.
5. Downloaded 80,757 camps (`scripts/fetch_camps.py`), and the Malaysian, UCI and NCVBDC data.
6. Validated everything:
   - `scripts/validate_eraktkosh.py`, `validate_camps.py`, `validate_external.py` and `validate_history.py`;
   - reports in `blood_data/quality/`;
   - matches in `blood_data/crosswalk/`.

#### Results

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

#### What changed for the open issues

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
