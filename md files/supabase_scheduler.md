# Plan: move the stock collector from the laptop to Supabase

**Status: APPROVED, not started.**
- All seven decisions were answered on 2026-10-23.
- Nothing has been built or deployed. Work starts only when you ask for it, beginning with your `npx supabase login`.

Paths are relative to `bloodlink/` unless they start with `../`.

## Why

- **The laptop is the weak point.** The hourly collector (`scripts/snapshot.mjs`, run by Windows Task Scheduler) only runs while this laptop is on and logged in. Two of the first four scheduled runs on 2026-10-23 died after one state. Every hour the laptop is off leaves a gap in the stock history the forecast will learn from (#35).
- **Supabase can run it instead,** in the project the data already lives in:
  - Supabase Cron (`pg_cron`) fires on schedule;
  - `pg_net` calls an Edge Function;
  - the function does exactly what the laptop does today.
- **No new account, no new machine, no git commit.** Edge Functions deploy from the CLI.

## What stays the same

- The app and its search code. The collector isn't in the search path.
- The stock tables, the `bloodlink_ingest` role, and the validation rules in `src/lib/stockQuality.js`.
- The directory's location checks: `src/lib/stateBounds.js` with `assets/state_boundaries.json`, which flag banks outside their own state as `wrong_state` (#36, added 2026-10-24).
- **One call per state, one second apart,** as before. How often a sweep runs is decision 6; every option is hourly or less often.

## Design

```
pg_cron (in Postgres), every 30 min:          Edge Function "collect-stock"
collector_tick(n) asks "is batch n due?"       (region: Mumbai if available)
+0 min batch 1 ─┐ (a sweep is due 4.5 h after the last one began)
+2 min batch 2 ─┤ net.http_post ──► /functions/v1/collect-stock { batch: n }
+4 min batch 3 ─┤   + x-region, x-collector-secret     │
+6 min batch 4 ─┘                                       ├─► eRaktKosh, 9 states, 1 s apart
Mon 03:20 directory + prune ──► { directory: true }     ├─► Postgres as bloodlink_ingest (same tables as today)
                                                         ├─► Storage: changed rows → stock-archive/YYYY-MM-DD/HHMM-bN.ndjson.gz
                                                         └─► collector_runs: one row per call (for monitoring)
```

**1. Four batches per sweep, not one big call.** A free-plan Edge Function may run for at most 150 s. A full sweep takes about 90 s of eRaktKosh time, plus gaps and database writes. The laptop's 23:05 sweep took 150 s in all, right at the limit. The 36 states are split by measured time (2026-10-23 sweep, call time + 1 s gap + about 0.6 s of writes):

| Batch | Starts | Estimated time | States |
|---|---|---|---|
| 1 | sweep start | 37 s | Uttar Pradesh, Kerala, Madhya Pradesh, Delhi, Uttarakhand, Puducherry, Nagaland, Goa, Lakshadweep |
| 2 | +2 min | 36 s | Andhra Pradesh, Telangana, Haryana, West Bengal, Jharkhand, Arunachal Pradesh, Meghalaya, Mizoram, Ladakh |
| 3 | +4 min | 36 s | Maharashtra, Rajasthan, Gujarat, Bihar, Assam, Himachal Pradesh, Andaman and Nicobar, Manipur, Dadra and Nagar Haveli and Daman and Diu |
| 4 | +6 min | 35 s | Karnataka, Tamil Nadu, Punjab, Chhattisgarh, Odisha, Jammu and Kashmir, Tripura, Sikkim, Chandigarh |

  That leaves about four times the headroom. Spacing the batches two minutes apart keeps eRaktKosh seeing one request at a time, as today.

**2. One collector implementation, not two.**
- The logic in `scripts/snapshot.mjs` moves into a shared module, `src/lib/collector.js`. It contains: fetch a state, validate, compare with saved update times, upsert changed rows, refresh fetch times, add history, log the call.
- Both the Node script and the Edge Function call it, each passing in its own database and fetch adapters.
- The CLI's API-based deploy (`supabase functions deploy --use-api`) can bundle files from outside `supabase/`, so the function imports `src/lib/collector.js` and `stockQuality.js` directly. The weekly directory run also needs `stateBounds.js` and `assets/state_boundaries.json` (294 KB). Without them, the cloud run would stop flagging wrong-state banks.
- The laptop script keeps working as a manual tool and as the fallback.

**3. The same least-privilege model, with one exception.**
- Inside an Edge Function, Supabase provides `SUPABASE_DB_URL`. The function connects with it and runs `set role bloodlink_ingest` first, exactly as the laptop does. No new database password is created.
- **The exception is the archive upload.** Storage needs Supabase's built-in secret key; see decision 3, drawback 1.

**4. The function can't be triggered by anyone else.** Edge Functions accept the public publishable key by default, so that alone would let anyone set off eRaktKosh calls. The function therefore also requires an `x-collector-secret` header that matches a function secret. The cron jobs read the same value from Supabase Vault, so it never appears in a migration or in git.
- The function also refuses a batch that already ran in the last 50 minutes (checked in `collector_runs`). A wrong schedule or a leaked secret can never make collection more frequent than hourly.

**5. Region: Mumbai if possible.**
- eRaktKosh answered a request from outside India on 2026-10-23, but a government site could start blocking foreign addresses.
- Edge Functions can be pinned to a region with the `x-region` header. If `ap-south-1` (Mumbai) is accepted, eRaktKosh sees an Indian address.
- Database writes then cross to Tokyo, about 100 ms each, which is fine with only changed rows uploaded.
- Phase 0 checks this first.

**6. The archive moves to Supabase Storage.**
- The laptop writes the full history to `../blood_data/eraktkosh/history/`. The cloud can't write there, and the database keeps history only 60 days (free-tier size).
- So each batch writes its changed rows, gzipped, to a private Storage bucket, `stock-archive`, as `YYYY-MM-DD/HHMM-bN.ndjson.gz`. A batch with no changes writes no file.
- Gzip shrinks today's history 6 to 8.6 times (6 times for a 25-row file, 8.6 times for the whole day). That makes the archive about 5 MB a month, so the free 1 GB lasts over 15 years.
- **At cutover, everything the laptop has collected so far is uploaded once to the same bucket.** The cloud archive is then complete from 2026-10-23 on. The local files are kept as they are.
- A new `npm run archive:sync` downloads any new files into `../blood_data/eraktkosh/history/` and unzips them. A weekly laptop task runs it, catching up whenever the laptop is next on (decision 7). See "Where the data lives".
- **The weekly prune deletes database history only after the matching archive files exist.** Each batch records in `collector_runs` how many rows its file holds, so the prune can check this before deleting.
- The drawbacks of this choice are listed under decision 3.

**7. Monitoring.**
- A new `collector_runs` table holds one row per call: batch, runner (`edge` or `laptop`), started and finished times, states saved and failed, rows changed, and rows archived.
- The admin overview card gains a "last sweep" line, and a red warning when no batch has finished within the interval plus two hours (6.5 hours).

## How often to sweep (decision 6)

Measured on 2026-10-23 at 23:10 India time, on the live project, the local archive and the 23:05 sweep.

**Storage hardly depends on the interval.**
- `stock_history` gains a row only when a bank's own update time changes, about 430 bytes with its indexes.
  - A bank that updates once a day writes one row, whether it is checked hourly or every 6 hours.
  - About 4,000 rows a day are expected: 3,587 of the 4,707 banks updated in the last 24 hours.
- `upstream_calls` is the only table that grows with every sweep: 36 rows of about 500 bytes, 18 KB a sweep. Hourly, that is a fifth of the growth.
- `bank_stock_latest` and `blood_banks` stay the same size.
- **Pruning and gzip keep storage small, not the interval.** With the 60-day history and 90-day call log prune already in place, the database levels off at 135 to 170 MB whatever the interval. The free limit is 500 MB.

**Banks update in the morning.**
- Of the 4,184 banks that updated in the past week, 73% made their latest update between 07:00 and 11:59 India time. Under 8% did so between 19:00 and 05:59.
- At 23:05, only 2 banks had updated in the previous hour.
- This counts each bank's latest update only, on a single Friday.

**What a longer interval costs.** eRaktKosh gives each bank's exact update time, so a sweep 3 hours later still records the right time. Two things are lost:
- **An update that the same bank overwrites before a sweep sees it.** In the early sample of 24 repeat updates, the median gap between a bank's updates is 24.2 h, and 10% of gaps are under 6 h.
- **Freshness of the saved copy** the app falls back to when eRaktKosh is down. At worst it is one interval old.

| Option | India times | Sweeps a day | Updates missed (rough) | Saved copy at worst | Database growth a day | Database size with pruning | Function calls a month |
|---|---|---|---|---|---|---|---|
| Hourly (the plan so far) | :05 every hour | 24 | none (the baseline) | 1 h | 2.15 MB | 172 MB | 2,880 |
| Every 2 hours | 00:05, 02:05 … 22:05 | 12 | about 1% | 2 h | 1.9 MB | 152 MB | 1,440 |
| Every 3 hours (recommended) | 00:05, 03:05 … 21:05 | 8 | about 2% | 3 h | 1.8 MB | 144 MB | 960 |
| **Every 4.5 hours (chosen, locked)** | shifts by 4.5 h each sweep, repeating every 3 days | 5.3 | about 3 to 4% | 4.5 h | 1.75 MB | 138 MB | 640 |
| Morning-weighted | 06:05, 08:05, 10:05, 12:05, 15:05, 19:05, 23:05 | 7 | about 2% | 2 h in the morning, 7 h overnight | 1.8 MB | 142 MB | 840 |
| Every 6 hours | 05:05, 11:05, 17:05, 23:05 | 4 | about 5% | 6 h | 1.7 MB | 134 MB | 480 |
| Daily | 13:05 | 1 | about 25% | 24 h | 1.3 MB | 109 MB | 120 |

- **"Updates missed"** is modelled from the 24-gap sample, so treat it as rough. The check before cutover replaces it with a measured figure.
- **Without any pruning,** the database would fill in about 7 months hourly, 8.5 months every 3 hours, 9 months every 4.5 or 6 hours, and 12 months daily. The interval buys a couple of months at most.
- **The gzipped archive** grows by about 5 MB a month in every option.

**Opinions.**
- **Hourly:** the best data, but most sweeps land outside the morning updates and find little. It is worth it only if the forecast needs stock within the day. Point 5 says it doesn't: the dynamics are daily, with 24 to 72 h horizons.
- **Every 2 hours:** a compromise with little gain over every 3 hours.
- **Every 3 hours (recommended):**
  - a third of the eRaktKosh calls and a third of the call log;
  - about 2% of updates missed;
  - a saved copy never more than 3 hours old.
  - Spacing is even, so a weekend or a different update pattern can't catch it out.
  - In UTC, which `pg_cron` uses, it is simply `35 */3 * * *`.
- **Every 4.5 hours (chosen):**
  - a fifth of the hourly calls;
  - about 3 to 4% of updates missed;
  - a saved copy at most 4.5 hours old.
  - 4.5 hours doesn't divide a day, so sweep times shift by 4.5 hours each sweep and repeat every 3 days, 16 sweeps per cycle. Over those 3 days, sweeps fall every 1.5 hours around the clock.
  - That costs a scheduler a little more effort (see "How the 4.5-hour schedule runs"), but it brings one real benefit: no hour of the day is never sampled, so the data shows when banks really update.
- **Morning-weighted:** fits today's pattern best, but that pattern comes from one day. Switch to it once two weeks of data confirm the pattern.
- **Every 6 hours:** the longest interval I would defend. During the morning updates the saved copy can be 6 hours old, so the fallback lags most when stock moves most.
- **Daily:** not recommended. It misses about a quarter of updates, and one failed run leaves the saved copy over a day old (the red banner).

**How the 4.5-hour schedule runs.** Cron repeats at fixed clock times, so it can't express "every 4.5 hours" directly. Instead:
- **Four `pg_cron` jobs run every 30 minutes,** one per batch, at :05, :07, :09 and :11 and again at :35 to :41 India time.
  - Each runs only a small SQL check, `collector_tick(n)`. Nothing is sent to the Edge Function or eRaktKosh unless a sweep is due.
- **The batch 1 job starts a sweep** when the last sweep began 4 h 25 min ago or more: it records the sweep in `collector_sweeps` and posts batch 1. The 5-minute allowance absorbs cron jitter, so sweeps land exactly 4.5 hours apart.
- **The batch 2 to 4 jobs** post their batch only if a sweep began in the last 10 minutes and their batch hasn't run for it yet. So the four batches still go 2 minutes apart.
- **If a sweep is missed** (the project was paused, say), the next tick starts one at once, and the 4.5-hour rhythm continues from there.
- **The weekly directory and prune** moves to Monday 03:20 India time, between batch slots, so eRaktKosh still sees one request at a time. It also deletes `pg_cron`'s own run log (`cron.job_run_details`) older than 7 days, since the 30-minute ticks add about 190 rows a day.
- **Locked at 4.5 hours** on 2026-10-23. It is the default in `schedule_stock_collector()`.
  - The function also accepts another interval, as one SQL call with no redeploy, for example `select public.schedule_stock_collector('6 hours');`.
  - Values under 1 hour are refused.

**Checking before cutover.**
- The laptop keeps sweeping hourly until cutover, but only while it is on, which is a few hours a day.
- Just before switching, I'll take every fourth and fifth of the hourly sweeps that ran back to back, alternately (4.5 hours on average). Then I'll count the updates this schedule would have missed.
- If the count is over 5%, I'll report back before cutting over. If too few back-to-back sweeps exist to say, I'll report that instead and re-check from the cloud data after the first week.

## Steps

### Phase 0 · checks before building (about 1 hour; you run one command)

1. **Log the CLI in, once:** `npx supabase login`. It opens a browser and stores an access token on this laptop only. I can't do this step for you.
2. **Deploy a throwaway `collector-probe` function** that:
   - fetches Goa from eRaktKosh;
   - connects with `SUPABASE_DB_URL` and runs `set role bloodlink_ingest`;
   - reports `SB_REGION`.
3. **Call it twice:** with `x-region: ap-south-1`, and without the header. Record the region used, eRaktKosh's answer, the time and the database round trip.
4. **Decide the region from the result.** If eRaktKosh refuses Supabase's addresses entirely, stop here and use the fallback below.
5. **Delete the probe.**

### Phase 1 · the cloud collector (about half a day)

1. **`src/lib/collector.js`** (new): the shared logic from `snapshot.mjs`, with injected `fetchJson`, `db` (`query`) and `archive` (`write`) adapters. `scripts/snapshot.mjs` becomes a thin Node wrapper around it, with the same flags as today.
2. **`supabase/functions/collect-stock/index.ts`** (new):
   - checks the secret;
   - accepts `{ batch: 1–4 }`, `{ directory: true }` or `{ prune: true }`;
   - runs the batch through `collector.js` with Deno adapters, using the `postgres` client and Storage;
   - uploads with the built-in secret key from `SUPABASE_SECRET_KEYS`, used only to build the Storage client for `stock-archive`;
   - writes its `collector_runs` row.
3. **Migration `<timestamp>_cloud_collector.sql`**, dated when it is written. It must sort after `20261024000100_wrong_state_locations.sql`, which already uses that timestamp:
   - enable `pg_cron` and `pg_net`;
   - add `collector_sweeps` (one row per sweep: start time, interval) and `collector_runs`. Admins read both, and `bloodlink_ingest` writes `collector_runs`.
   - add the private `stock-archive` bucket with its access policies;
   - add `collector_tick(n)`, the due check described under "How the 4.5-hour schedule runs". It is `security definer` and executable only by the `pg_cron` job owner.
   - add `schedule_stock_collector(p_interval interval default '4 hours 30 minutes')` and `unschedule_stock_collector()`.
     - They create or remove the five cron jobs: four 30-minute ticks and the weekly directory and prune. The function URL and secret are read from Vault.
     - An interval under 1 hour is refused.
   - The migration only defines these functions; it schedules nothing by itself.
4. **`scripts/setup-cloud-collector.mjs`** (new), run once. It:
   - creates a random collector secret;
   - stores it with `supabase secrets set` and in Vault;
   - deploys the function;
   - prints the commands to schedule or unschedule.
   - The secret is never written to a file in the repo.
5. **`scripts/sync-archive.mjs`** (new), `npm run archive:sync`: downloads new archive files into `../blood_data/eraktkosh/history/` and unzips them.
   - **Incremental:** it lists the bucket and fetches only the files that aren't on the laptop yet. One run therefore catches up any number of missed weeks.
   - **Safe to interrupt:** each file is written to a temporary name and renamed when complete. A run cut short by shutdown leaves no half files, and the next run finishes the job.
   - **Waits for the network:** it retries for up to 10 minutes, since Wi-Fi often isn't connected straight after start-up. If it still fails, it exits with an error code, so Task Scheduler retries later.
   - **Logs** each run to `../blood_data/eraktkosh/sync.log`: files fetched, rows, and the newest day held.
   - **Key:** it reads Supabase's secret key from `.env.local`, which is used by scripts only, like `SUPABASE_DB_URL`. The bucket is private, so it can't be read with the publishable key.
6. **Tests** (Vitest) for `collector.js` with fake adapters:
   - changed and unchanged rows;
   - history only on new update times;
   - a failed state is logged and the batch continues;
   - batch membership covers all 36 states exactly once;
   - the directory run flags a bank outside its own state `wrong_state`, as the laptop does;
   - the secret check refuses a wrong secret.
   - A SQL check of `collector_tick`, run against the live project inside a transaction that is rolled back:
     - a sweep starts after 4.5 hours, never sooner;
     - batches 2 to 4 follow only their own sweep;
     - a missed sweep restarts at the next tick.

### Phase 2 · cutover (about 1 hour, then 24 hours of watching)

1. **Measure the 4.5-hour schedule first** with the laptop's hourly sweeps, as described under decision 6.
2. **Upload the laptop's archive so far** (`../blood_data/eraktkosh/history/*.ndjson`, gzipped) to `stock-archive`. Check the row counts against the local files. The local files stay.
3. **Switch at an hour boundary, so eRaktKosh never gets two collectors in the same hour:**
   - stop the two laptop tasks at once (`Disable-ScheduledTask -TaskPath '\bloodLink\' -TaskName *`);
   - then run `select public.schedule_stock_collector();`. The first sweep starts at the next tick.
4. **Watch 24 hours.** Expect 5 or 6 sweeps, each with four `collector_runs` rows and 9 states saved per row. `upstream_stats` should show all 36 states with a last good fetch within 4.5 hours.
5. **Delete the two collector tasks** once the watch passes. This is decision 4.
   - The command names them, so it can't remove the new sync task by mistake:
     `Unregister-ScheduledTask -TaskPath '\bloodLink\' -TaskName 'Stock snapshot (hourly)','Directory snapshot and prune (weekly)' -Confirm:$false`
6. **Run `npm run archive:sync` once,** and check the files against `stock_history`.
7. **Create the weekly sync task** `\bloodLink\Archive sync (weekly)`, as described under decision 7. Then test the catch-up once:
   - set its trigger a few minutes ahead;
   - shut the laptop down across that time;
   - start it again, and confirm `sync.log` shows a run about 10 minutes after sign-in.
8. **Update the docs:**
   - `CLAUDE.md`: the collector section, #35, the sync task, and the commands to re-create the laptop tasks;
   - `../CODE_REFERENCE.md`;
   - `../blood_data/README.md`;
   - `../report3.md`: point 3.1, "collection moved to Supabase".

### Rollback (one minute)

```sql
select public.unschedule_stock_collector();
```

```powershell
Enable-ScheduledTask -TaskPath '\bloodLink\' -TaskName *
```

- **During the 24-hour watch,** the laptop tasks are only disabled, so the two commands above are the whole rollback.
- **After they are deleted,** rolling back means re-creating them with the commands in `CLAUDE.md`, a few minutes' work.

## Cost on the free plan

| Item | Use per month | Free allowance |
|---|---|---|
| Edge Function calls | about 640 (4 per sweep, 5.3 sweeps a day, plus weekly) | 500,000 |
| `pg_cron` ticks | about 5,800 small SQL checks; the run log is trimmed weekly | included |
| Function time per call | about 35 s of 150 s | — |
| Database size | levels off at about 138 MB (history pruned at 60 days, call log at 90) | 500 MB |
| Storage archive | about 5 MB a month, gzipped | 1 GB |
| `pg_cron`, `pg_net` | included | included |

Expected cost: **₹0**.

## Risks

| Risk | Likelihood | What happens | Mitigation |
|---|---|---|---|
| eRaktKosh blocks Supabase's addresses | Low: it answered from outside India on 2026-10-23 | No data from the cloud | Phase 0 tests it first. Fallback: the same `collector.js` on a free always-on Oracle Cloud VM in Mumbai |
| Mumbai region not accepted | Medium | The function runs in another region | Use the default region, which eRaktKosh answered from abroad. Keep the Oracle fallback |
| A batch exceeds 150 s (eRaktKosh very slow) | Low | That batch's remaining states are skipped this sweep | The per-call timeout stays at 60 s. The function stops starting new states once 110 s have passed and logs the rest as skipped; they are fetched next sweep |
| The free project gets paused for inactivity | Low: scheduled writes count as activity (community answer, not official) | Everything stops, including the app | Use the app weekly. The admin card warns when a sweep is overdue |
| A cron call fails silently (`pg_net` doesn't retry) | Low | One batch missed | `collector_runs` shows the gap; the next sweep catches up (history is event-based) |
| The secret leaks | Low | Someone could trigger extra eRaktKosh calls | It lives only in Vault and the function's secrets. Rotate with the setup script |
| Rotating the database password (#26) breaks the function | Unknown | Batches fail | After rotating, check `collector_runs`. `SUPABASE_DB_URL` is a built-in secret and should follow the change; confirm in Phase 2 |

## Decisions

All seven were answered on 2026-10-23.

| # | Decision | Answer |
|---|---|---|
| 1 | Change the live project: enable `pg_cron` and `pg_net`, and add one migration, one Edge Function, one Storage bucket and five cron jobs | **Yes** |
| 2 | Region | **Mumbai (`ap-south-1`) if Phase 0 shows it works**, so eRaktKosh sees an Indian address. Otherwise the default region |
| 3 | Archive | **Gzipped files in a Storage bucket.** The secret key needed for the upload is accepted. Drawbacks below |
| 4 | The laptop's scheduled tasks after cutover | **Stop them as soon as the cloud collector is set up, and delete them after the 24-hour watch.** Keep everything collected so far |
| 5 | CLI login | **You run `npx supabase login` when you ask for this plan to be carried out.** Nothing starts before that |
| 6 | Sweep interval | **Every 4.5 hours, locked.** Times shift each sweep and repeat every 3 days |
| 7 | Local copy on the laptop | **A weekly Task Scheduler task runs `npm run archive:sync`.** If the laptop is off at that time, the task runs soon after it is next switched on |

### Where the data lives

After cutover, collection and storage happen entirely in the Supabase project. The laptop can stay off.

| Place | What it holds | Kept for |
|---|---|---|
| Supabase database | The latest stock per bank, which the app falls back to; the bank directory; `stock_history` | History: 60 days, then pruned |
| Supabase Storage, bucket `stock-archive` | Every change since 2026-10-23, gzipped, including the laptop's data, uploaded once at cutover | For good |
| Laptop, `../blood_data/eraktkosh/` | Everything collected until cutover, plus everything the weekly `npm run archive:sync` downloads later | Until you delete it |

**What "backup" means here.**
- Both cloud copies sit in the same Supabase project, and the free plan backs up neither of them.
- So if the project itself is lost, no second copy exists anywhere. That could happen if the project is:
  - deleted by mistake;
  - paused for inactivity and not restored within 90 days;
  - damaged by a bad migration, or by a bug that deletes rows or files.
- A backup is simply a copy kept somewhere else, and the laptop is the cheapest "somewhere else".
- `npm run archive:sync` downloads the archive into `../blood_data/`. That is the laptop's only role after cutover. Collection never depends on it.

**When it syncs:**
- weekly, by the task in decision 7, catching up whenever the laptop is next on;
- by hand before training or testing point 5's model, so the model sees the latest data.
- Each sync downloads only new files, about 5 MB a month.

### Decision 3: drawbacks of the Storage archive

The alternative was to keep all history in the database. That is simpler, with one place and SQL for everything, but it fills the 500 MB free database in 7 to 9 months. The Storage archive avoids that, at these costs:

1. **The upload uses a key with wide rights. You accepted this on 2026-10-23.**
   - Storage files can only be written through the Storage API, so the function uses Supabase's built-in secret key, `SUPABASE_SECRET_KEYS`. The older service-role key is being retired at the end of 2026.
   - The key can reach every table and bucket, so a bug in the upload code could too. Database writes still go through `bloodlink_ingest`.
   - The function reads the key from the environment Supabase gives it, not from a file. That costs nothing and keeps the key out of git, where anyone who saw it could use it.
2. **Supabase doesn't back it up.** See "Where the data lives". The weekly sync (decision 7) keeps a second copy on the laptop.
3. **History lives in two places and two formats.**
   - The last 60 days are in SQL (`stock_history`). Everything is also in gzipped NDJSON files.
   - Questions about older data need the files. pandas reads them directly; SQL can't.
4. **The prune now depends on the archive.**
   - Before deleting a day from `stock_history`, the prune checks that `collector_runs` shows the same number of archived rows for that day.
   - If an upload failed, that day is kept and the gap is logged, so the database grows until it is fixed.
   - It is one more moving part than a plain delete.
5. **Old files must stay readable.** Each archived line carries a format version (`"v": 1`), so a later change to the row shape won't break older files. The laptop's existing files count as version 1.

These are not problems: size, about 5 MB a month of the free 1 GB, and download traffic, about 5 MB a month of the free 5 GB.

### Decision 4: the laptop after cutover

Your answer: the laptop stays off most of the day, so its tasks stop as soon as the cloud collector is set up, and the data collected so far is kept.
- **At cutover (Phase 2, step 3):** both tasks are disabled at once, so eRaktKosh is never swept by two collectors.
- **After the 24-hour watch (step 5):** both are deleted. `snapshot.mjs` and `run_collector.ps1` stay, for manual runs.
- **Kept:**
  - everything in `../blood_data/`;
  - a copy of the history in `stock-archive`, uploaded in step 2.
- **Added in their place:** one weekly sync task, which never calls eRaktKosh (decision 7).

### Decision 7: the weekly local copy

**Your question: will it run if the laptop is off at the scheduled time?** Yes, if the task is set up as follows. It runs soon after the laptop is next switched on.
- **"Run as soon as possible after a scheduled start is missed"** (`StartWhenAvailable`) makes Windows run a missed task once the computer is back on. The two collector tasks already use it.
  - Windows waits about 10 minutes after start-up before running the missed task. The 10 minutes comes from Microsoft's older documentation, and the Phase 2 test confirms it on this laptop.
  - Several missed weeks produce one catch-up run, not a burst. That one run is enough, because the sync fetches every file the laptop doesn't have.
- **It runs only while you are signed in.** The task runs as your Windows user, like today's tasks: running it with nobody signed in needs administrator rights. In practice the laptop is in use whenever it's on.
- **It runs on battery** and isn't stopped when the charger is unplugged, like today's tasks. Windows' defaults would skip a laptop on battery.
- **If the sync fails,** for example because Wi-Fi isn't connected yet, Task Scheduler retries 3 times, 15 minutes apart. If all of those fail, the next week's run or catch-up gets everything.
- **What it can't do:** run while the laptop is off or asleep. So the laptop copy can be weeks behind if the laptop isn't used. Nothing is lost, because the cloud keeps everything; the copy just catches up on the next run.

**Settings, for the record:**
- weekly trigger, Sundays at 21:00 India time;
- `-StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval 00:15:00 -ExecutionTimeLimit 01:00:00`;
- the same hidden-PowerShell launcher as the collector, so no window flashes up.
- The trigger time matters little because of the catch-up. Sunday evening is a guess at when the laptop is likeliest on.

Work starts when you ask for it, beginning with `npx supabase login`.

## Sources

- [Supabase Edge Functions limits](https://supabase.com/docs/guides/functions/limits): free plan 150 s wall clock, 256 MB, 2 s CPU per request.
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions): `pg_cron` with `pg_net`, secrets in Vault.
- [pg_cron in Supabase](https://supabase.com/docs/guides/database/extensions/pgcron).
- [Edge Function environment variables](https://supabase.com/docs/guides/functions/secrets): `SUPABASE_DB_URL` and `SUPABASE_SECRET_KEYS` are provided by default; `SUPABASE_SERVICE_ROLE_KEY` is listed as legacy.
- [Migrating to publishable and secret API keys](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys): the legacy `service_role` key is being retired.
- [Database backups](https://supabase.com/docs/guides/platform/backups): backups don't include Storage objects, and free projects aren't backed up automatically.
- [Paused free projects are restorable for 90 days](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days) (2024).
- [Pricing](https://supabase.com/pricing): free plan 1 GB Storage, 5 GB egress a month.
- [Task Scheduler task settings](https://learn.microsoft.com/en-us/previous-versions/windows/it-pro/windows-server-2008-r2-and-2008/cc722178(v=ws.11)): "Run task as soon as possible after a scheduled start is missed" starts a task missed because the computer was off, after a 10-minute wait.
- [Regional invocations](https://supabase.com/docs/guides/functions/regional-invocation): the `x-region` header, and `x-sb-edge-region` in the response.
- [Deploy without Docker, importing files outside `supabase/`](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory).
- [Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), and [community note that pg_cron activity counts](https://github.com/orgs/supabase/discussions/13121).
