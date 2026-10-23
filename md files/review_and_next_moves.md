# Review: does everything fit together, and what next

**Status: REVIEW.** Done on 24 October 2026 (India time) against commit `f178c57` on `supabase-migration`. No app code was changed. Two plan files were corrected in the same commit as this review (see [Soundness of the plans](#soundness-of-the-plans)).

- Paths are relative to `bloodlink/` unless they start with `../`.
- New findings carry the next free issue IDs from `CLAUDE.md` (#42 onwards), with a severity and a tier, so they can be copied into its known-issues list as they are. Nothing in `CLAUDE.md` itself was edited.

**Contents**
1. [Verdict](#verdict)
2. [What was checked](#what-was-checked)
3. [Live checks](#live-checks)
4. [Code findings](#code-findings)
5. [Documentation findings](#documentation-findings)
6. [Soundness of the plans](#soundness-of-the-plans)
7. [Next moves](#next-moves)
8. [A suggested order](#a-suggested-order)
9. [What this review couldn't check](#what-this-review-couldnt-check)

---

## Verdict

- **The app works as the documents say.** Lint, the format check, all 118 tests and the production build pass. Every verification step in `CLAUDE.md` that can run without the Supabase project's credentials gave the documented answer against live eRaktKosh, OSRM and Open-Meteo.
- **`CODE_REFERENCE.md` is fully in sync:** every top-level function, constant and file in `src/`, `scripts/` and `tests/` is documented, and it names nothing that doesn't exist.
- **No serious bugs.** Twelve small findings, #42 to #53. Four matter before the next big steps: #46 and #47 before the donor network uses eligibility, and #51 and #52 before a public deployment.
- **The documents have drifted in a few places,** mostly about where the reference files live and what is committed. Collected as #54 and #55.
- **The plans are sound one by one.** Two things need deciding across them:
  - **Collection (#35) is on the critical path for the forecast.** It is tagged Low, but the forecasting work needs it running now.
  - **The database region (#28) should be decided before anything else is built on the project.** That includes the cloud collector, the donor network and a deployment.
- **The plans together are more than a semester of work.** [A suggested order](#a-suggested-order) proposes a cut for the final review.

---

## What was checked

| Check | How | Result |
|---|---|---|
| Install | `npm ci` from the lockfile | 420 packages, clean |
| Lint | `npm run lint` | 0 errors, 0 warnings |
| Format | `npm run format:check` | All files formatted |
| Unit tests | `npm test`, then per file | **118 passed**, and the per-file counts match `CLAUDE.md` exactly (ranking 20, eRaktKosh client 19, traffic 16, stock and profile 15, compatibility 13, stock quality 10, routing 8, state bounds 7, rings 6, rate limit 4) |
| Build | `npm run build` with placeholder public Supabase values | Succeeds; the 19 routes and the proxy match the routes table in `CLAUDE.md` |
| Code read | Every file in `src/`, `scripts/`, `tests/` and `supabase/migrations/`, plus the config files | Findings below |
| Code reference | A script compared every top-level name and file with `CODE_REFERENCE.md` | 0 missing either way |
| Documents | `CLAUDE.md`, `README.md` and everything in `md files/` read against the code and git | Findings below |
| Plans | `supabase_scheduler.md`, report 3's point 5, "Where to go next" in `CLAUDE.md`, and the four plan files | Verdicts below |

---

## Live checks

A production build was started with `next start` on this machine, then sent the verification searches from `CLAUDE.md`. There were no Supabase credentials, so the saved-copy path could only fail gracefully, and the eRaktKosh calls went out from outside India.

| `CLAUDE.md` check | Expected | Got |
|---|---|---|
| Region search, Goa (`stateCode=30`) | 5 banks | **5**, `X-Data-Source: live` |
| Goa, district 585 | 3 banks | **3** |
| Location search, Mumbai, red cells | `urban`, 5 km ring, zone `metro` | **urban, 5 km, metro (Mumbai)**, 10 banks, all with road ETAs |
| Ranked, Mumbai, O- red cells, 3 units, critical | A plan; O-Ve stock only | **Plan covers 3 of 3;** every result lists O-Ve only |
| Ranked, central Delhi, O+ red cells, 4 units, critical | Only Delhi addresses; `misplacedBanks` above 0 | **12 of 12 Delhi addresses; 44 misplaced,** the same 44 `data_integrity.md` reports |
| `OSRM_URL=http://127.0.0.1:9/` | Still answers; every `etaSource` is `estimate` | **Answered;** all `estimate`, `routingDegraded: true`, plan 3 of 3 |
| Rate limit without `TRUSTED_PROXY_HOPS` | 21st search in a minute gets 429 | **Requests 1 to 20: 200; request 21: 429** |

Times, for the record: the first Mumbai location search took 6.4 s cold, the ranked Mumbai search 3.1 s, and the cold Delhi ranked search 19.1 s. Delhi's 25 km ring reaches Haryana and Uttar Pradesh banks, and eRaktKosh takes about 12 s for Uttar Pradesh. With no saved copy the client has nothing to give up to, so it waited. With the saved copy in place, the 8-second give-up bounds this, as report 3 measured.

---

## Code findings

Sorted by tier, then severity. Each has a one-line fix.

| ID | Severity · tier | Where | What happens | Fix |
|---|---|---|---|---|
| **#51** | Medium · P1 | `next.config.mjs` | No security headers: no Content-Security-Policy, `frame-ancestors`, Referrer-Policy or Permissions-Policy. Matters as soon as the app is public | Add `headers()`: allow CARTO tiles, Nominatim and Supabase; `frame-ancestors 'none'`; `geolocation=(self)` |
| **#52** | Medium · P2 | `src/app/components/BloodMap.js:76`, `src/lib/eraktkosh.js:354`, `src/lib/routing.js` | The user's location goes to three outside services without being disclosed: to Nominatim from the browser at full GPS precision, to the public OSRM server at about 11 m, and to Open-Meteo at 0.1°. The pin of someone searching for blood is health-adjacent personal data | Round to 3 decimals (about 110 m) before Nominatim and OSRM; name all three services in the privacy note (#18) |
| **#49** | Medium · P2 | `src/app/layout.js:15-19` | The root layout reads the session and the profile on every request. Every page, including the landing page, is rendered on demand and waits on a profile query to Tokyo (about 175 ms, #28) | Load the header's user in a small client component, or cache it; measure before and after |
| **#46** | Low · P2 | `src/lib/profile.js:26`; triggers in `supabase/migrations/20261023000100_init.sql:112, 133` | "Today" is the UTC date in both the validator and the database. Between midnight and 05:30 India time, a birth or donation date of today is rejected as being in the future | Today in `Asia/Kolkata` in JS; `(now() at time zone 'Asia/Kolkata')::date` in a new migration's triggers. Needed before centres confirm "donated today" |
| **#47** | Low · P2 | `src/app/set-details/page.js:11` | The profile form preselects gender "male", so a donor who skips the field gets the 90-day donation gap instead of 120 | No default; the validator already requires a choice. Fix before eligibility chooses whom to message |
| **#50** | Low · P2 | `src/lib/eraktkosh.js:232` | Without a memory copy, every lookup downloads the saved rows for its state in parallel with the live call (report 3, D3.4), separately for each component, group and district combination. Cold serverless instances repeat it; Uttar Pradesh is about a megabyte each time, against the free plan's 5 GB of egress a month | Cache the saved rows per state, not per filter, and cut them in memory with `keepOnlyComponent` |
| **#42** | Low · P2 | `supabase/migrations/20261023000100_init.sql:245` | Approving an admin's own organization application skips them entirely, so `organization_id` is never set. If they later lose the admin role, `set_user_role()` makes them a plain user, though their organization is approved | Always set `organization_id`; only leave the role alone for admins. Fix before `plan_panels.md`'s member backfill |
| **#43** | Low · P3 | `src/app/admin/AdminActions.js:36`, `src/app/api/admin/rpcError.js:13` | "Approve" on an old rejected or suspended application, while the same person has another open one, breaks the one-open-application index (23505). The admin sees "The action failed" and the server returns 500 | Map 23505 to 409 with a clear message, or hide Approve when another open application exists |
| **#44** | Low · P3 | `src/lib/stockStore.js:74`, `src/app/api/blood-search/route.js:211` | During an eRaktKosh outage, `misplacedBanks` reads 0, because the saved directory drops wrong-state banks before the route counts them. The "N banks left out" note disappears just when the saved copy is in use | Count them in `loadSavedNearest` and pass the count through |
| **#45** | Low · P3 | `src/lib/stockStore.js:48` | A district search served from the saved copy misses banks with no directory row. Their `district_id` is null, because it comes from `blood_banks`, and the 679 unplaced banks aren't there | Fill `district_id` from placements (`plan_bank_locations.md`), or let the collector record the district another way |
| **#48** | Low · P3 | `src/app/page.js:27` | The home page says "Connect directly with donors in your area", which the donor-network plan rules out (decisions N1, N8) | "Ask nearby donors to give at a blood centre (coming soon)" |
| **#53** | Low · P3 | `src/proxy.js:62` | A signed-in user who opens `/login?next=/organization` is sent to the home page, not to `next` | Redirect to `safeNextPath(next)` |

What was checked and found right, so nobody re-checks it: the circuit and fallback order in `eraktkosh.js`, ring choice and dormant handling, exact-group matching, the response plan, the state-outline filter, the rate limiter's proxy handling, every route's input validation, the auth callback's redirect check, row-level security and grants in all four migrations, and the `security definer` functions' checks.

---

## Documentation findings

**#54 · Low · P1 · The `mongodb-final` tag isn't on GitHub.** `CLAUDE.md` and `features.md` say it marks the last MongoDB version, but `git ls-remote --tags origin` lists no tags. Push it from the laptop: `git push origin mongodb-final`.

**#55 · Low · P1 · The documents disagree with the repository in places.**

| # | Where | What | Fix |
|---|---|---|---|
| a | `features.md` lines 6, 7, 313 and 391; `report3.md` lines 6 and 358 | They say the Supabase work is uncommitted. It was committed on 24 October (`5af73b9`) and pushed | Reword: committed on `supabase-migration` |
| b | `CLAUDE.md` lines 11 to 14 and later; `report3.md`, `features.md` and `supabase_scheduler.md` | They point to the reference documents at the workspace root (`../report3.md`, `../data_integrity.md`, `../features.md`, `../supabase_scheduler.md`, `../CODE_REFERENCE.md`). In the repository they are in `md files/`. Anyone who clones gets broken pointers; if copies also exist at the workspace root, the two sets will drift | Keep one copy, in the repository, and point every reference at it |
| c | `md files/` | The folder name has a space, which breaks unquoted shell commands and some tools | Rename to `docs/` when b is done |
| d | `CLAUDE.md`, "How to use this file" | It doesn't list the four plan files or this review | Add them |
| e | `CLAUDE.md`, known issues | IDs **#30 and #31** appear nowhere: neither open nor in the "fixed, IDs not to be reused" list | Add them to the fixed list, or restore their entries |
| f | GitHub | The default branch is `master` at `fdb2b2a`, the MongoDB app. Anyone opening the repository sees the old version | Open a pull request from `supabase-migration` and merge it, or make `supabase-migration` the default |
| g | `report3.md`, point 4, "ETA accuracy" | It says to adjust `ZONE_SCALE` until the error is under 25%, from "timed drives or Google Maps' typical times recorded by hand". `plan_eta_comparison.md` now says to score with Google but set parameters from timed trips only (E10) | Point report 3 at the plan |
| h | `CLAUDE.md`, "Where to go next", item 6 | It names a `donor_responses` table; `plan_donor_network.md` calls it `request_responses` | Use one name |

---

## Soundness of the plans

| Plan | Verdict | What to change or watch |
|---|---|---|
| **`supabase_scheduler.md`** (approved, not started) | **Sound, and the most urgent.** Thorough on limits, cost, rollback and least privilege | **CPU time.** Its own sources list a 2 s CPU limit per Edge Function request, which the design doesn't discuss. The heaviest pure step is the weekly directory's state-outline check, which this review timed at about 0.1 s for 4,328 banks, so it should fit; add a CPU measurement to Phase 0 anyway. **Order:** rotate the database password (#26) before Phase 1, since the plan connects with `SUPABASE_DB_URL`; and decide the region (#28) first, so the collector is built on the final project |
| **Report 3, point 5** (forecasting) | **Sound method:** baselines, walk-forward splits, metrics and a decision rule fixed in advance | **It depends on collection that isn't running reliably.** Today history accumulates only while the laptop is on (#35). A late-December backtest on about 8 weeks of history needs the cloud collector running from roughly now. The label noise (unit drops mix issues, corrections and expiry) is already stated in its risks |
| **`CLAUDE.md`, "Where to go next"** | **Reasonable order** | #35 is tagged Low and P2 but is on the forecast's critical path; #28 is tagged Low and P2 but gets harder to do every week. Raise both to P1 |
| **`plan_bank_locations.md`** | **Sound** | Its weekly "supersede" step belongs in `src/lib/collector.js` if the scheduler plan lands first; **added in this commit.** The geoBoundaries district outlines must be matched by name to eRaktKosh's 781 districts; already in its Phase 0 |
| **`plan_eta_comparison.md`** | **Sound** | **Corrected in this commit:** it said the pin reaches OSRM at 5 decimals (about 1 m). `parseCoordinates` rounds it to 4 (about 11 m) first. Google's billing tier and current terms are still unconfirmed, as the plan says |
| **`plan_panels.md`** | **Sound** | Fix #42 before the member backfill. The sizes assume one developer who knows the codebase; with other plans running alongside, phases A to C are about a month. It proposes a privacy-request queue, while the donor plan proposes self-service deletion: use self-service deletion with an audit row, and the queue only for data exports |
| **`plan_donor_network.md`** | **Sound architecture;** scope is the main risk | It needs four issues (#18, #24, #27, #46/#47) and parts of two plans (members and two-factor from `plan_panels.md`; pg_cron and Edge Functions from the scheduler) first. For the final review, phases 0 to 2 (donors, then requests in shadow mode) are realistic; phase 3 only if a partner blood centre agrees |

**Across the plans**
1. **Three plans add cloud jobs on the same machinery:** the collector, the donor notifications and the bank-location supersede step all use pg_cron, Edge Functions and limited roles. Build the scheduler's setup first and reuse it: one Vault secret pattern, one role per job (`bloodlink_ingest`, `bloodlink_notifier`), and one runs table that the admin card watches.
2. **`/admin/locations` appears in two plans** (bank locations and panels). It is the same page; build it once.
3. **No conflicts in data model or naming** beyond #55h. New migrations must all sort after `20261024000100`.
4. **Size.** Roughly: scheduler 1 to 2 days; bank locations 3 to 4 days; ETA bench about a week plus trips; panels A to C about a month; donor network phases 0 to 2 about a month, plus the legal review; forecasting from late December. That is more than one semester for a small team, hence the order below.

---

## Next moves

These are new; none is in an existing plan. They are ordered by value for effort.

**1 · Make GitHub the single source of truth.** *About half a day.*
- Merge `supabase-migration` into `master` through a pull request (#55f), and push the `mongodb-final` tag (#54).
- Point every document reference at one copy in the repository, rename `md files/` to `docs/`, and list the plans in `CLAUDE.md` (#55b, c, d).
- Account for #30 and #31, and reword the "uncommitted" lines (#55a, e).
- *Why first:* everything after this is reviewed, cloned or graded from GitHub, and today it shows the MongoDB app.

**2 · Fix the small bugs.** *About a day.*
- #46, #47, #51 and #52 first, because the donor network and a deployment depend on them. Then #42, #43, #44, #45, #48 and #53.
- Add one test per fix, as `CLAUDE.md` asks.

**3 · Decide the region now, and put everything in it.** *A decision, then about half a day.*
- **Why now:** the database holds 19 MB, the stock history is rebuilt from the laptop's archive, and only test accounts exist. After the cloud collector, the donor network or real users arrive, moving is far harder.
- **If the project moves to Mumbai (`ap-south-1`)** and the app is deployed in Vercel's Mumbai region (`bom1`):
  - every query skips the round trip to Tokyo, about 175 ms each (#28, #49);
  - eRaktKosh sees Indian addresses from both the app and Edge Functions, which removes the scheduler plan's region risk;
  - the 4.5-hour collector writes stay local.
- **If it stays in Tokyo,** at least deploy the app's functions in Vercel's Tokyo region (`hnd1`), next to the database, not in Vercel's default US region.
- Confirm in the dashboard that the free plan offers Mumbai before deciding.

**4 · A deployment-readiness pass.** *One to two days.* "Ship" in `CLAUDE.md` says "Deploy to Vercel"; these are the specifics it needs:
- the function region (move 3), environment variables, and the security headers (#51);
- `error.js` and `not-found.js` pages, so a crash shows a helpful page with the emergency advice rather than a blank one;
- `/api/health`, reporting eRaktKosh's circuit state, the saved copy's age and the last collector sweep, for an uptime monitor and for the viva demo;
- a `.env.example`, and `engines` in `package.json` (the scripts use `process.loadEnvFile` and `--disable-warning`; Next 16 needs Node 20.9 or later);
- the layout's per-page database wait (#49);
- **Nominatim:** reverse geocoding triggered by users is allowed only "provided that your number of users is moderate" ([usage policy](https://operations.osmfoundation.org/policies/nominatim/)). Before a public launch, budget for a hosted geocoder or a self-hosted one.

**5 · Route tests from recorded answers, then CI.** *One to two days.* This is #20, made concrete:
- Record one real `nearest` and `blood-availability` answer each for Mumbai, central Delhi and Saifai into `tests/fixtures/`.
- Test `/api/blood-search` with `vi.mock("@/lib/eraktkosh")` serving them: ring choice, the misplaced count, exact-group filtering, the plan, the saved-copy mode and the 400s. This is the most complex file in the app (321 lines), and it has no tests.
- A GitHub Actions job: `npm ci`, lint, the format check, tests and a build with placeholder public variables. This review's build used placeholders and passed, so CI needs no secrets.

**6 · Report the bad coordinates to eRaktKosh, and ask for the monthly data in the same letter.** *About an hour, plus a wait.*
- Send the 206 wrong-state and 2 outside-India banks, with the evidence from `data_integrity.md`, to the eRaktKosh team at NBTC or MoHFW.
- **Why:** a fix at the source helps every eRaktKosh user, and bloodLink's weekly directory run would then supersede its own fixes automatically (`plan_bank_locations.md`, decision L6).
- In the same letter from the department, ask for access to the `MonthlyCollection` stock and issue reports, which report 3 says would raise every forecasting model's ceiling. A reply takes time, so send it early.

**7 · A small usability study for the report.** *Two to three days, including the write-up.*
- 5 to 8 participants, ideally hospital staff or medical students.
- Four tasks: a region search, a ranked search and reading its plan, interpreting a freshness banner, and applying as an organization.
- Measure task success, time on task and the System Usability Scale questionnaire.
- *Why:* the reviewer's point 4 asked for measurable results; this adds the one kind the project doesn't have yet, from real users.

**8 · Accessibility and language.** *Two to four days.*
- **Map and keyboard.** The map can only be used by clicking or tapping. Add a place-search box with an explicit search button as the alternative. Nominatim allows a search a user submits; it forbids autocomplete as you type.
- **Contrast.** The `#999` credit line is 2.8:1 on white, which fails WCAG AA (4.5:1 needed). The `#666` body text, at 5.7:1, passes.
- **Hindi.** Translate the search page first, then one regional language for the pilot city. Emergency users shouldn't need English.
- **A low-end phone on a slow network.** Test with throttling, since the map tiles and Leaflet dominate the page weight.

**9 · A one-page threat model.** *About half a day.*
- **Assets:** health answers, donor areas, roles, and the database password (#26).
- **Who might attack:** curious users, fake requesters, scrapers, a leaked key.
- **Controls in place:** row-level security, `security definer` functions, the rate limit, no service-role key.
- **Gaps:** #26, #51, #52, and two-factor sign-in, which is planned.
- *Why:* reviewers value it, and the donor network's legal and safety review will start from it.

---

## A suggested order

Weeks are counted from now, for a team of about two working part-time. Shift it to the semester's real dates.

| When | Work | What it gives the report |
|---|---|---|
| **Week 1** | Move 1 (repository); #26, #25 and #27 (dashboard settings); decide the region (move 3); fix #46, #47, #51, #52 and #54; send the letter (move 6) | A clean, current repository; P0 issues closed |
| **Week 2** | `supabase_scheduler.md` on the final project; `plan_bank_locations.md` phases 0 to 4, including the Nominatim run | Continuous collection from now on; the before-and-after visibility number |
| **Weeks 3 and 4** | Route tests and CI (move 5); `plan_eta_comparison.md` phases 0 to 2, the Google trend test; bank-location app changes; `plan_panels.md` phase A; deployment readiness (move 4) | ETA trend results; CI badge; a deployed demo |
| **Weeks 5 to 7** | `plan_panels.md` phases B and C; `plan_donor_network.md` phases 0 and 1; the usability study (move 7); accessibility and Hindi (move 8); threat model (move 9) | Hospital and blood-bank tools; usability numbers |
| **Late December** | The forecast backtest (report 3, point 5); `plan_donor_network.md` phase 2, in shadow mode; ETA timed trips | Model comparison; matching evaluated without messaging anyone |
| **January** | Write-up; align the documents with the code (#32); viva rehearsal; donor-network phase 3 only with a partner centre | Final report |

---

## What this review couldn't check

- **The live Supabase project.** There were no credentials here, so these weren't checked: the row-level security refusals in `CLAUDE.md`'s "Security" step, which migrations are applied, the saved-copy fallback, sign-in, and the admin pages against real data. Run those steps locally before the next review.
- **Anything outside the repository:** `../blood_data/` (archive, crosswalk, measurements), `../documentation/`, the Windows scheduled tasks and `collector.log`.
- **Google sign-in and the email sender,** which depend on dashboard settings (#25, #27).
- **Whether workspace-root copies of the reference documents exist** and differ from `md files/` (#55b).
