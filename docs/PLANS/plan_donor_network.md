# Plan: the peer-to-peer donor network

**Status: phase 1 (donors only) is built on branch `p2p-network` and its migration is applied to the live project; phase 2 (requests in shadow mode) is next, specified in [Phase 2 build spec](#phase-2-build-spec); phase 3 (in-app only) is specified in [Phase 3 and 4 build spec](#phase-3-and-4-build-spec) and not built; phase 4 is deferred; phase 5 is not started.** [Build progress](#build-progress) says exactly where the work stands. Phases 1 and 2 message nobody, so they go ahead before the partner centre and the sign-offs, which phase 3 needs. Every default marked *assumption* must be calibrated in shadow mode or the pilot before it is trusted.

## Build progress

Read this section first after `/clear`, a compaction, or when taking over from another agent. It is the only record of where the build stands: nothing else carries over between sessions. Whoever finishes or starts a task updates its row here in the same change, before reporting.

**Where things are**
- **Branch:** `p2p-network`, made from `supabase-migration` at `6813b8c`. Commit straight onto it; no new branches without asking the user.
- **Live database:** `20261117000100_donor_network.sql` is applied (2026-11-17). `20261117000200_donor_requests.sql` is applied too (2026-11-17), and the one-minute `advance-requests` cron job (job 36) is scheduled. Requests run in shadow mode: nobody is told.
- **Committed and pushed:** phase 1 `0c01f29`, phase 2 `2b3c738` and the location button `41a314f`, the phase 3 database layer `9034e95` with its fix `abf23d2`, and the phase 3 app code (donor requests card, popup, centre side). All are on `p2p-network` and `origin`. Commit or push only when the user asks, with no AI tool named in the message, a trailer or a comment (`CLAUDE.md`, "Commits"). Never commit `docs/prompt.txt`.
- **Phase 3's migration is not applied to the live project.** `20261118000100_donor_live.sql` is checked only inside the rolled-back transaction; until it is applied, `/api/donor-requests` answers `{ available: false }` and the popup and cards never appear.
- **Done and pending (2026-11-18):**
  - **Done:** phases 1 and 2 (applied; the `advance-requests` cron job runs in shadow mode); phase 3's database layer (P3.2, 533 checks), donor requests card, popup and Realtime signal (P3.3, P3.5), and the centre side (P3.4).
  - **Pending, needs the user:** the on-screen tests (phase 1 join, save, withdraw with quiet hours as `HH:MM`; a shadow request; the location button); applying `20261118000100_donor_live.sql`; the gates G1 to G3, G4 (F1 and F6) and G5.
  - **Pending, deferred:** P3.6 admin screens and donor blocking, P3.7 simulation, P3.8 docs and the pilot checklist, P2.6 whole-wave benchmark, all of phase 4, and the check-in button on the donor card.
  - **Staging:** a staging project and a seed script were considered and dropped; a seeded database for P3.7 does not exist.
  - **Known gaps:** the client can't tell whether someone is in the network, so every signed-in user fetches `/api/donor-requests` once; the popup also shows on `/peer-to-peer`.
- **Checks at the last green run (2026-11-17):** `npm test` 399 tests in 22 files; `npm run lint` and `npm run format:check` clean; `npm run build` with `/`, `/organization`, `/peer-to-peer`, `/privacy`, `/search` and `/set-details` still static; `node scripts/check-donor-network.mjs` 509 of 509 with the phase 3 migration inside the transaction, rolled back (2026-11-18).

**Phase 1: donors only**

| Task | State |
|---|---|
| Migration: consents, settings, areas, donations, `donor_status` and its triggers, `donor_cell_counts()` | Done, applied |
| `src/lib/eligibility.js` on India dates (#64), `eligibilityWindow`, parity fixture | Done |
| `src/lib/donorNetwork.js`, `/api/donor-network`, `DonorNetworkCard.js`, `AreaMap.js` | Done |
| `/privacy` section and `PRIVACY_VERSION` 2026-11-17 | Done |
| Admin overview's donor cells card | Done |
| `src/lib/donorMatching.js` and its tests | Done |
| `scripts/check-donor-network.mjs` | Done, 366 checks |
| `CLAUDE.md` and `docs/code_reference.md` | Done |
| End-to-end test on the running app: join, save, withdraw; quiet hours come back as `HH:MM` | **Not done** |
| Commit | Done, `0c01f29`, pushed |

**Phase 2: requests in shadow mode** (tasks from [Phase 2 build spec](#phase-2-build-spec))

| # | Task | State |
|---|---|---|
| P2.1 | Migration: `blood_requests`, `request_responses`, `blood_compatibility`, the indexes, `create_request()`, `cancel_request()`, `match_wave()`, `advance_requests()`, the shadow read functions, `schedule_donor_requests()` and `unschedule_donor_requests()` | Written: `supabase/migrations/20261117000200_donor_requests.sql`; applied and exercised only inside the rolled-back transaction of `scripts/check-donor-network.mjs`; not applied to the live database, and the cron job is not scheduled |
| P2.2 | `blood_compatibility` rows generated from `compatibility.js`, with a parity check | Done: `scripts/make-compatibility-rows.mjs` writes the 115 rows into the migration (it loads `src/lib` through `scripts/register-src.mjs`); `scripts/check-donor-network.mjs` compares every row set with `donorGroupsFor` for each group and component, and `component_category()` with `componentCategory` |
| P2.3 | `check-donor-network.mjs` extended: grants, row-level security, lifecycles, the lock, and `match_wave` against `planWave` | Done: 366 checks. The script covers grants, row-level security, the request lifecycles, the cron helpers, the advisory lock (a second connection is blocked by each of the four functions until the transaction ends), `match_wave` against `planWave` over about 200 seeded donors and 29 requests (order, scores, wave rows and `filter_counts`), and the covered and back-to-open statuses through `advance_requests` |
| P2.4 | `/api/requests` and its validator | Done: `src/lib/donorRequests.js` (`sanitizeRequest`, `sanitizeTravelConditions`), `src/app/api/requests/route.js`, `tests/donor-requests.test.js` (12 tests); not yet run against the migration, whose read columns it assumes |
| P2.5 | The shadow requests card on `/organization`, and the admin overview's open requests | Done: `ShadowRequestsCard.js` (`/organization` stays static) and the admin overview's card; the last-run line reads the newest `request_waves.ran_at` until the migration gives `advance_requests()` a run record (TODO in `src/app/admin/page.js`) |
| P2.6 | Benchmark of the whole `match_wave` | Deferred: planned for after the alpha, not part of this build. Needs the user's choice of where it runs first |
| P2.7 | Apply the migration and schedule the cron job | Done 2026-11-17: migration applied, `check-donor-network.mjs` 366 of 366 after; `schedule_donor_requests()` run. The first cron run is still to be confirmed. The on-screen test of raising a shadow request is the user's |
| P2.8 | `CLAUDE.md`, `docs/code_reference.md`, this section | Done |

**Phases 3 and 4: live pilot, then SMS** (specified in [Phase 3 and 4 build spec](#phase-3-and-4-build-spec); not built)

| # | Task | State |
|---|---|---|
| P3.1 | Spec check | Done 2026-11-18: S31 to S36 added; awaiting the user's review of the diff before P3.2 |
| P3.2 | Migration: live mode, donor and centre functions, signal table, abuse | Written: `supabase/migrations/20261118000100_donor_live.sql`; exercised only inside the rolled-back transaction of `scripts/check-donor-network.mjs` (533 checks, live lifecycles, S30 pilot hours, S35 proofs); not applied to the live database. Donors have no select on `request_responses`: admins read it through `admin_request_responses()`. Unanswered cards stay answerable (and on `my_request_cards()`) until the request is covered, fulfilled, cancelled, paused or past `needed_by`, and count as ignored only if seen and still unanswered when the request ends. Live waves run 09:00 to 20:00 India time, a critical request being exempt only when `organization_live_flags.critical_outside_hours` is on (`set_organization_live()` sets it). A repeated abuse report raises SQLSTATE BL001. `donations.request_id` and the three admin or member columns are foreign keys, ON DELETE SET NULL |
| P3.4 | Centre side on `/organization`: live requests, arrivals, confirm donation, defer | Built: `/api/requests` GET also returns each request's mode and, for live open or covered requests, the donors from `request_donor_contacts()` (names, phones as the function allows, check-in status; each read is logged as a reveal); POST `confirm_donation` and `defer` call `confirm_donation()` and `defer_donor()` as the signed-in user. `ShadowRequestsCard.js` shows the mode, the accepted donors, Confirm donation (kind by request kind) and Defer with a reason; `/organization` stays static. Validators in `src/lib/donorRequests.js`, tests in `tests/donor-requests.test.js`. Not run against the migration, which is not applied |
| P3.3 | `/api/donor-requests` and the donor requests card on `/peer-to-peer` | Built: GET returns `my_request_cards()`; POST runs `respond`, `cancel_response`, `mark_card_seen`, `check_in` as the signed-in user (`{ available: false }` before the migration); the card shows blood group, centre, distance band, needed by and urgency, marks a card seen when expanded, and after accepting shows address, map link, phone and check-in code with a Can't come button. Pure helpers in `src/lib/donorCards.js`, tests in `tests/donor-cards.test.js` |
| P3.5 | The popup and Realtime | Built: `src/app/DonorRequestsPopup.js` in the root layout fetches only once signed in; Not now hides it for the session, and neither opening it nor Not now marks a card seen; `src/app/useDonorCards.js` refetches on any change to the donor's own `donor_card_signals` row and on window focus |
| P3.6 | Admin screens: open critical requests, abuse queue, suspend, live flag per organization (the database functions exist from P3.2; donor blocking an organization is part of this) | **Deferred**: nothing is live to watch until the gates clear, so no screen is needed yet |
| P3.7 | Simulation of whole requests against the real functions | **Deferred**: needs a seeded database to run against (a staging project or a local stack), and there is neither yet |
| P3.8 | Docs and the pilot checklist | **Deferred**: written once phase 3 has been tested on screen and applied; `CLAUDE.md` carries the check counts until then |
| P4.1 to P4.3 | SMS, delivery receipts and the outbox, tuning | **Deferred** |

Deferred: Donor blocking an organization: deferred to P3.6.

Phase 3 is in-app only (donors see requests when they open the site). Open gates: G1, G2, G3, G4 (F1 and F6) and G5. G6 and G7 and the outbox, channels and token links are deferred. Code for phase 3 may be built before the gates clear; nothing may be applied, scheduled or pushed without the user's go-ahead, and no donor is contacted until the gates clear. After P3.1, stop and show the user the diff before P3.2.

**Rules for any agent doing this work**
- Outward-facing steps need the user's go-ahead each time: applying a migration, writing to the live database outside a rolled-back check, scheduling a cron job, deploying, committing, pushing.
- Run scripts with flags as `node scripts/<name>.mjs --flag`. PowerShell drops the `--` in `npm run <name> -- --flag`, so the flag is lost and the script does its default action.
- Only rolled-back checks run against the live project. Never trigger extra eRaktKosh sweeps.
- Done means `npm test`, lint, `format:check`, `build` (the static pages above still static) and `check-donor-network.mjs` all green, and the row above updated.

- Paths are relative to `bloodlink/` unless they start with `../`.
- Builds on `CLAUDE.md` ("Where to go next", item 6), report 3 (point 4's PostGIS benchmark and notification tests, point 5's donor alerts) and `plan_panels.md` (organization members, notifications inbox, two-factor sign-in).
- Medical and legal statements are a starting point for review by the project guide and a blood-bank medical officer, not advice.

**Contents**
1. [What it is](#what-it-is)
2. [The legal and clinical frame](#the-legal-and-clinical-frame)
3. [Goals, non-goals and success measures](#goals-non-goals-and-success-measures)
4. [People and journeys](#people-and-journeys)
5. [Request types](#request-types)
6. [Architecture](#architecture)
7. [Data model](#data-model)
8. [Matching logic](#matching-logic)
9. [Lifecycles](#lifecycles)
10. [Notifications](#notifications)
11. [Privacy, safety and abuse](#privacy-safety-and-abuse)
12. [Eligibility inside the database](#eligibility-inside-the-database)
13. [Scale and performance](#scale-and-performance)
14. [Measuring it](#measuring-it)
15. [Testing and simulation](#testing-and-simulation)
16. [Phase 2 build spec](#phase-2-build-spec)
17. [Phase 3 and 4 build spec](#phase-3-and-4-build-spec)
18. [Rollout](#rollout)
19. [Decisions and alternatives](#decisions-and-alternatives)
20. [Risks](#risks)
21. [Open questions](#open-questions)
22. [Sources](#sources)

---

## What it is

When a hospital or blood bank needs a blood group it can't find in stock, bloodLink asks nearby eligible donors of that group to **go and donate at that blood centre**. Donors accept or decline in the app. The centre sees who is coming, screens them, collects the blood and confirms the donation, which updates the donor's eligibility automatically.

"Peer to peer" means connecting people who can give with a specific need. Blood never passes from one person to another outside a blood centre.

---

## The legal and clinical frame

These facts decide the architecture more than any technical choice. The project guide should confirm each before the pilot.

| Fact | Consequence for the design |
|---|---|
| Blood is collected, tested and issued only by **licensed blood centres** (Drugs and Cosmetics Act, 1940 and 1945 Rules). | **Every request is anchored to a blood centre.** A donor goes there, never to a patient. The app never arranges a transfusion. |
| **Paid donation has been banned since 1 January 1998** (*Common Cause v. Union of India*, 1996). The National Blood Policy aims for 100% voluntary donation. | **No money anywhere.** Every notification says bloodLink never asks for money. Requests can't carry offers, fees or rewards. |
| National policy discourages **replacement** donation. NBTC 2017: "Replacement donors should be phased out." | The default request is "donors of this group needed at this centre", credited to the centre's stock. Patient-specific requests only from the verified institution treating the patient. |
| **Screening and cross-matching are the centre's job.** The "final call on donor selection is taken by the medical officer". | The app says "you may be eligible"; only the centre says "you can donate today". A deferral is normal and never counts against the donor. |
| The **DPDP Act, 2023** requires notice, specific consent, withdrawal and erasure. Blood group, health answers and location are personal data. | A **separate, explicit consent** to join the network; approximate locations only; contact revealed only on acceptance; retention limits; self-service deletion (`/account`). |
| Thresholds come from NBTC's 2017 guidelines. `src/lib/eligibility.js` follows clauses 2 to 4, 15 to 17 and 47, checked against the official text on 26 October 2026. A centre may ask for photo ID but not make it mandatory. | Eligibility may choose whom to message once the partner centre's medical officer has reviewed the screening questions. Identity rests with the centre, so a check-in code shows only that someone accepted. |

---

## Goals, non-goals and success measures

**Goals**
1. Cover an urgent need that stock can't, faster than phone trees and WhatsApp groups, disturbing fewer people.
2. Never put a donor's safety, privacy or goodwill at risk.
3. Close the loop: every request ends as fulfilled, partly fulfilled, expired or cancelled, with the reason recorded.

**Non-goals (for now):** public requests from unverified individuals; payments; live GPS tracking; a native app; donor-to-patient contact.

**Pilot targets** (*assumptions*, revisit after shadow mode):

| Measure | Definition | Target |
|---|---|---|
| Fill rate | Units donated ÷ units asked, by "needed by" | ≥ 60% for critical and urgent |
| Time to first acceptance | Request opened → first accept | Median ≤ 15 min for critical |
| Notifications per unit | Donors notified ÷ units donated | ≤ 15 |
| Show rate | Arrived ÷ accepted | ≥ 70% |
| Fatigue | Opt-outs within 7 days of a notification ÷ notified | ≤ 2% |
| Safety | Requests reported fake or money-seeking | 0 left open after 1 hour |
| Delivery latency | Queued → delivered, p95 | In-app < 2 s, SMS < 30 s (report 3, point 4) |

---

## People and journeys

| Person | Account | What they do here |
|---|---|---|
| **Donor** | Any signed-in user who joins | Sets areas and availability, gets requests, accepts or declines, checks in |
| **Blood-centre staff** | Member of a verified `blood_bank` organization (`plan_panels.md`, F1) | Raises appeals, sees who is coming, checks in, confirms donations |
| **Hospital staff** | Member of a verified `hospital` organization | Escalates a shortfall from the response plan, anchored to a chosen centre |
| **Admin** | Admin roles (`plan_panels.md`) | Watches open critical requests, handles reports, suspends misuse |

1. **A donor joins.** Profile complete → "Join the donor network" → one-screen notice (what is shared, with whom, how long, how to leave) → consent → one or two areas on a map → availability and quiet hours → browser notifications.
2. **A hospital escalates.** A critical search for 4 units of O- finds 1 → the plan shows a shortfall of 3 → "Ask donors" → picks the anchor centre → the centre's staff may tick "compatible groups acceptable" → matching starts.
3. **A donor responds.** Push: "O- donors needed at KEM Hospital Blood Centre, about 4 km away, by 6:30 pm" → request card → Accept → sees address, map link, phone and check-in code → goes.
4. **The centre confirms.** The donor shows the code → "arrived" → after screening, "donated" or "deferred" (no reason stored) → the count goes up and the donor's next eligible date updates.
5. **A centre appeals.** B- stock is low for the week → "Appeal for donors" with dates and slots → donors book → same check-in flow. Later the forecast (report 3, point 5) suggests appeals before stock drops.

---

## Request types

| Type | Raised by | Group rule | Urgency | Notes |
|---|---|---|---|---|
| **Shortfall** | Verified hospital or centre | Exact; compatible only if the centre allows | Critical, urgent | The emergency path, from a response plan |
| **Platelet apheresis** (single donor platelets: eRaktKosh component 14, "PLA") | Verified centre with apheresis | Exact ABO | Urgent | Common in dengue season. Donors opt in; extra screening. Not "SDP": in eRaktKosh that is Single Donor *Plasma* (component 18) |
| **Centre appeal** | Verified centre | One or more groups, or any | Routine | Stock running low over days, with booked slots |
| **Forecast appeal** (later) | Forecast job or admin, approved by the centre | Groups at risk | Routine | Designed in [`plan_ml_system.md`](plan_ml_system.md) |
| **Camp** (later) | Verified centre | Any | Routine | From eRaktKosh camp data or the panel |

**Group policy** (consistent with report 3's D1.4):
- **Exact first.** Waves 1 and 2 ask only the patient's exact group, keeping scarce O- donors for O- patients.
- **Compatible later, with consent.** From the third wave, if the centre ticked "compatible groups acceptable", `donorGroupsFor(recipientCode, componentCode)` in `src/lib/compatibility.js` adds donors, ranked below exact matches. The centre still cross-matches.
- **Bombay (Oh):** only Bombay donors, ever.

---

## Architecture

Request flow: staff create a request (`create_request` RPC) → `match_wave()` filters, scores and picks donors, inserting `request_responses` and `notification_outbox` rows → a `pg_net` webhook wakes the `dispatch-notifications` Edge Function, which claims rows as `bloodlink_notifier` and sends push, email or SMS → the donor accepts (token link or signed in, `respond()` RPC) → Realtime tells the centre → `pg_cron` runs `advance_requests()` every minute for the next wave → the centre checks in and confirms (`confirm_donation()`), which writes the donation, refreshes donor status and raises the request count. Provider receipts return through the `delivery-webhook` Edge Function.

| Part | Job | Why here |
|---|---|---|
| **Next.js route handlers** (`/api/requests`, `/api/responses`, `/r/[token]`) | Validate input with whitelist validators, call database functions as the signed-in user, serve token links | Same pattern as `/api/details` and `/api/organization` |
| **Postgres functions** | `create_request`, `match_wave`, `respond`, `check_in`, `confirm_donation`, `cancel_request`, `advance_requests` | Matching reads others' rows, so it runs as `security definer` with its own checks, never a service-role key (`CLAUDE.md`) |
| **pg_cron** | Each minute: next waves, expiries, hold timeouts, retrying stuck notifications | Already runs the collector's ticks; one scheduler for both |
| **Outbox + dispatcher** (phase 3) | `notification_outbox` rows become messages via an Edge Function | Sending needs HTTP and provider secrets, which don't belong in SQL or the browser. Phase 2 sends nothing: an in-app card is the `request_responses` row itself, read through `my_request_cards()`, so the outbox, dispatcher and webhook arrive with push and email |
| **`bloodlink_notifier` role** (phase 3) | The dispatcher connects with `SUPABASE_DB_URL` and runs `set role bloodlink_notifier`, which can only claim and update outbox rows through two functions | Same least-privilege pattern as `bloodlink_ingest` |
| **Realtime** | Live inboxes and request boards | `postgres_changes` applies row-level security to inserts and updates. Deletes aren't filtered, so watched tables change a row's status instead of deleting it (`verify_facts.md`, F18) |

---

## Data model

Each table becomes a timestamped migration with explicit grants and CHECK constraints mirrored in JS validators (`CLAUDE.md`, "Schema changes").

| Table | Purpose and key columns |
|---|---|
| `profiles.is_suspended` | New column, `boolean not null default false`. Not client-writable (no column grant); an admin function sets it from phase 3. Read by `donor_status.is_in_network` |
| `consents` | Versioned consent per `purpose` (`donor_network`, `share_phone_with_centre`, `sms`); `user_id`, `notice_version`, `given_at` (database clock), `withdrawn_at`. At most one open row per user and purpose. Given only through `give_consent(purpose, notice_version)` and withdrawn through `withdraw_consent(purpose)`, so no client sets a time. A changed notice needs fresh consent |
| `donor_settings` | One row per user: `is_available` (default true), `snoozed_until`, `quiet_start` and `quiet_end` (`time`, India time, default 22:00 and 07:00), `critical_overrides_quiet` (default false), `critical_overrides_gap` (default false: may a critical request skip the 72 h gap), `max_requests_per_week` (1 to 7, default 2), `apheresis_willing` (default false), `channels` (`text[]`, a subset of `in_app`, `push`, `email`, `sms`, default `{in_app,push}`), `updated_at`. Client-writable through column grants |
| `donor_areas` | Up to two per user, primary key (`user_id`, `kind`), `kind` `home` or `work`: `latitude` and `longitude` as `numeric(5,2)` and `numeric(6,2)` (the centre of a ~1 km cell; CHECK inside India's box, 6 to 37.5 N and 68 to 98 E), and `cell`, a generated `geography(Point, 4326)` with a GiST index |
| `donor_status` | Trigger-computed, never client-written: `blood_group_code`, `is_in_network` (open `donor_network` consent, `is_donor`, profile complete, not suspended), `eligible_from` and `eligible_until` (both null = not eligible on any date; see [Eligibility inside the database](#eligibility-inside-the-database)), `needs_staff_check` (medication), `screening_confirmed_at` (`donor_screening.updated_at`), counters `asks_total`, `accepts_total`, `shows_total`, `ignored_in_a_row`, `last_asked_at`, and `updated_at`. Asks in the last 7 days are counted from `request_responses` at match time, not stored, so no counter needs a weekly reset. Partial index on group where in network and `eligible_from` is not null |
| `blood_requests` | `kind` (shortfall, apheresis, appeal, forecast, camp), `organization_id`, anchor (`anchor_organization_id` or `anchor_hospital_code`) and `anchor_point`, `blood_group_code`, `component_id`, `units_needed` (1 to 50), `urgency`, `needed_by`, `allow_compatible` (centre staff only), `patient_reference` (≤ 40 chars, hospital's own number), travel conditions at creation (`zone_free_flow_kmh`, `congestion_percent`, `rain_factor`, from `src/lib/traffic.js`), `mode` (`shadow` in phase 2), `area` (`urban` or `rural`), `status`, `waves_sent`, `next_wave_at`, `units_donated`, `created_by` (set null on delete so `delete_my_account()` isn't blocked), `closed_at`, `close_reason` |
| `request_waves` | One per wave sent: `request_id`, `wave`, `ring_km`, `candidate_count`, `p_accept`, `k`, `filter_counts` (`jsonb`, donors removed by each hard filter), `ran_at`. What centre staff judge in shadow mode, without seeing donors |
| `request_responses` | One per donor per request (`unique (request_id, donor_id)`): `wave`, `score`, `est_minutes`, `is_exact_group`, `status` (see lifecycle), `created_at`, `updated_at`. Phase 3 adds the 6-character `check_in_code`, `hold_until` and `share_phone` |
| `blood_compatibility` | `recipient_code`, `component_category`, `donor_code`: the rules of `donorGroupsFor` in `compatibility.js` as rows, so SQL reads the same ones |
| `response_tokens` | Single-use SMS and email links; only `token_hash` stored, with `expires_at` and `used_at` |
| `notification_outbox` | `channel` (in_app, push, email, sms, whatsapp), `template`, `payload` (no patient data), `status` (queued, sending, sent, delivered, failed, cancelled), `attempts`, `next_attempt_at`, `provider_message_id`, `last_error`; `unique (response_id, channel)` |
| `donations` | Created in phase 1, because eligibility reads it: `donor_id`, `organization_id`, `donated_on`, `kind` (`whole_blood`, `apheresis_platelets`, `apheresis_plasma`), `request_id` (its foreign key added in phase 2), `source` (`centre_confirmed`). "Not in the future" is a trigger against India's date as for profiles (#46), not a CHECK, which shouldn't depend on the clock. A self-reported donation stays `donor_screening.last_donation_date` |
| `contact_reveals` | Log of each phone reveal: `response_id`, `revealed_to_org`, `revealed_at` |
| `abuse_reports` | `reporter_id`, `request_id`, `reported_user_id`, `reason` (fake, money, harassment, wrong_details, other), `details` (≤ 500), `status` (open, actioned, dismissed) |

**Who can read and write what**

| Table | Donor | Org members | Admins | Functions and roles |
|---|---|---|---|---|
| `consents` | Own: read; give and withdraw through the two functions | — | Counts, through `donor_cell_counts()` | `withdraw_consent('donor_network')` also deletes the areas and settings |
| `donor_settings`, `donor_areas` | Own: all | — | — | Matching reads them as `security definer` |
| `donor_status` | Own: read | Counts per ~1 km cell, cells under 5 hidden, through `donor_cell_counts()` | The same counts. Admins and members share the `authenticated` role, so column grants can't hide `needs_staff_check` from them; they get counts only | Written only by triggers |
| `blood_requests` | Only requests they were notified about, via `my_request_cards()`, without `patient_reference` | Requests raised by or anchored at their organization | All | Created through `create_request()`, which checks role and suspension |
| `request_responses` | Own | Their requests' responses. **Donor name and phone only after acceptance, phone only with `share_phone`**, through a view | All | Status changes only through `respond()`, `check_in()`, `confirm_donation()` |
| `notification_outbox` | — | — | Read | `bloodlink_notifier` through `claim_notifications()` and `finish_notification()` |
| `donations` | Own: read | Read those they confirmed | Read | Rows only through `confirm_donation()` (phase 3) |
| `contact_reveals` | — | — | Read | Written by the view's function on first reveal |
| `abuse_reports` | Insert own | Insert own | All | — |

`donor_screening` stays owner-only. Matching never reads health answers; it reads the window and `needs_staff_check` in `donor_status`, which the trigger derives from them.

---

## Matching logic

### Step 1: hard filters

A donor can be asked only if **every** rule holds (all indexed or cheap):

| # | Rule | Source |
|---|---|---|
| 1 | In the network: consent given, not withdrawn, not suspended | `donor_status.is_in_network` |
| 2 | Available, and not snoozed | `donor_settings` |
| 3 | **Group:** exact, or compatible when the request allows it and this is the third wave or later | `compatibility.js` rules as an SQL lookup table |
| 4 | **Eligible in time:** the window [`eligible_from`, `eligible_until`] overlaps [today in India, `needed_by` in India] | `donor_status` |
| 5 | **Screening answers confirmed in the last 90 days** (`screening_confirmed_at`), as `plan_ml_system.md` Part B requires; older answers get a "please check your answers" card instead | `donor_status` |
| 6 | **No staff check pending** (`needs_staff_check` false). Medication isn't judged by the app, so these donors aren't asked until the partner centre's medical officer says which medications defer (open question 7) | `donor_status` |
| 7 | Apheresis requests: `apheresis_willing` | `donor_settings` |
| 8 | **Within this wave's ring** of the anchor point, by either area | `ST_DWithin(donor_areas.cell, anchor_point, radius)` |
| 9 | **Not asked too often:** last asked over 72 h ago, and fewer asks in the last 7 days than `max_requests_per_week`. A critical request skips the 72 h rule for donors with `critical_overrides_gap`; nothing skips the weekly limit | `donor_status`, `request_responses` |
| 10 | **Not in quiet hours**, unless critical and `critical_overrides_quiet` | `donor_settings`, India time |
| 11 | Not already asked for this request | `unique (request_id, donor_id)` |
| 12 | Not the person who raised it | — |

### Step 2: score

The donor's main uncertainty is **will they actually come?** So the score is an expected value: the chance this donor donates, discounted by travel time.

```text
score = p_donate × e^(−minutes / τ) × rested × groupFit       (0 to 1)

p_donate  = respond × show
  respond = (accepts + 1) / (asks + 5)     # new donor 0.20   (assumption)
  show    = (shows + 4) / (accepts + 5)    # new donor 0.80   (assumption)
minutes   = straight-line km × 1.34 / zone free-flow km/h × 60
            × (1 + congestion % / 100) × rain factor      # traffic.js, request's stored conditions
τ         = 30, 45 or 60 for critical, urgent or routine (ETA_DECAY_MINUTES in ranking.js)
rested    = min(1, 0.5 + days since last asked / 28)
groupFit  = 1 exact, 0.7 compatible
```

- Counts are **smoothed**, so one decline doesn't write a donor off and new donors get a fair chance.
- The decay curve is the one the bank ranking uses. No donor position is ever sent to OSRM or anyone else.
- `rested` spreads requests across donors; ties break at random.
- **No trained model of who comes.** [`plan_ml_system.md`](plan_ml_system.md) ranks forecast appeals with this score too (its S7). At pilot size most requests have fewer eligible donors than one wave asks, and the smoothed counts already learn each donor's record.

### Step 3: waves

Everyone at once wears donors out and sends too many people; one at a time is too slow for a critical case.

```text
match_wave(request):                       # wave = waves sent so far + 1, so the first is 1
    wave      = request.waves_sent + 1
    if wave > MAX_WAVES[urgency]: return
    unitsLeft = units_needed − units_donated
    target    = ceil(unitsLeft × OVERBOOK) # allows for no-shows and deferrals
    wanted    = target − acceptances still on hold
    if wanted <= 0: return
    ring   = RINGS[area][min(wave, 4) − 1]  # urban 5, 10, 15, 25 km; rural 20, 50, 100, 150 km;
                                            # the 5th and 6th waves reuse the widest ring
    groups = exact, plus compatible if allow_compatible and wave >= 3
    candidates = donors passing every filter within ring, best score first
    pAccept = mean `respond` of the top k₀ candidates, k₀ = min(CAP, candidates)
    k       = ceil(wanted / pAccept), clamped to [3, CAP[urgency]] and to the candidates there are
    ask the top k: insert request_responses (wave, score, est_minutes)
    request.waves_sent = wave;  request.next_wave_at = now + GAP[urgency]
```

Score orders donors by `p_donate`; wave size uses only `respond`, because `OVERBOOK` already covers no-shows. Counting them twice would ask too many.

Defaults (all *assumptions*):

| | Critical | Urgent | Routine and appeals |
|---|---|---|---|
| First wave | At once | At once | Next 09:00 to 20:00 window |
| Gap (`GAP`) | 10 min | 30 min | 4 h |
| Most waves | 6 | 4 | 3 |
| Most donors per wave (`CAP`) | 40 | 25 | 25 |
| Overbooking (`OVERBOOK`) | 1.5 | 1.5 | 1.3 |
| Channels | In-app, push, SMS | In-app, push, email; SMS from wave 3 | In-app, push, email |
| Hold after accepting | Est. minutes + 60 min | + 2 h | The booked slot |

`OVERBOOK` ≈ 1 ÷ (show rate × (1 − deferral rate)); with 0.8 and 0.15 that is 1.47, so 1.5 to start. The pilot measures both and resets it.

**Worked example.** Critical, 3 units of O-, urban. Target = ceil(3 × 1.5) = 5 acceptances. New donors have `respond` 0.2, so wave 1 asks ceil(5 / 0.2) = 25 within 5 km (cap 40). If 2 accept in 10 minutes, wave 2 asks ceil(3 / 0.2) = 15 more within 10 km. The request is `covered` at 5 acceptances on hold.

### Step 4: when to stop

`advance_requests()`, each minute, per open request:
- **Covered:** acceptances on hold ≥ ceil((needed − donated) × OVERBOOK) → `covered`, no more waves. Notified-but-unanswered donors are told "Thanks, enough donors are on the way" with an offer to donate voluntarily at the same centre; their response becomes `not_needed`, which never counts against them.
- **Back to open** if an acceptor cancels, misses the hold or is deferred and units are still needed.
- **Fulfilled** when donated ≥ needed.
- **Expired** at `needed_by` or after the last wave plus one gap, as `partly_fulfilled` if any units came.
- **Cancelled** by the raising organization, with a reason; open responses are told at once.

### Step 5: protecting donors

| Rule | Default (*assumption*) |
|---|---|
| Gap between any two requests to one donor | 72 h; a critical request skips it for donors who set `critical_overrides_gap` |
| Most requests a week | Donor's setting, 2 by default |
| Three ignored requests in a row | Snooze 30 days, with a message and how to undo it |
| Decline | Offers "snooze for a week"; never lowers `respond` more than one ask does |
| Deferred at screening | Counts as a show |

---

## Lifecycles

**Request:** `open` → `covered` (enough accepted; back to `open` if an acceptor cancels, misses the hold or is deferred) → `fulfilled` (units donated, from `open` or `covered`). From `open` or `covered`: `partly_fulfilled` (deadline or last wave, some units came), `expired` (none came), or `cancelled`. The last four are final.

**Response:** `notified` → `seen` (opened the card) → `accepted` or `declined`. From `notified`: `accepted`, `declined`, `expired` (no answer by the next wave's end), `not_needed` (request covered). From `accepted`: `cancelled` (donor can't come), `no_show` (hold ran out), `arrived` (checked in) → `donated` or `deferred` (screening said not today). All except `notified`, `seen`, `accepted` and `arrived` are final.

---

## Notifications

**Phase 3 has no notifications.** Donors find out about a request only when they open the website: a popup on page load and a card on `/peer-to-peer` (the [Phase 3 and 4 build spec](#phase-3-and-4-build-spec), S31 to S33). Everything below, the pipeline, the other channels, the message copy and the token links, is **deferred** to a later phase and is kept as the design for it.

### Pipeline (deferred)

1. `match_wave()` inserts one outbox row per donor and channel in the same transaction as the responses. If it fails, nothing is sent.
2. A `pg_net` webhook on insert calls `dispatch-notifications` at once; the minute cron also sweeps rows still `queued`.
3. The function runs `claim_notifications(50)` (`for update skip locked`, marking `sending`), so two runs never send the same row.
4. It sends each row, then calls `finish_notification(id, ok, provider_id, error)`.
5. **Retries** after 1, 5 and 15 minutes, then `failed`. A critical request's failed SMS falls back to push and in-app, already sent.
6. **Delivery receipts** reach `delivery-webhook`, which checks the provider's signature before marking `delivered`.
7. **Idempotency:** `unique (response_id, channel)`.

### Channels, in build order (all deferred except the in-app card)

| Channel | Cost | Reach | Requirements | When |
|---|---|---|---|---|
| **In-app** (popup on site open, a card on `/peer-to-peer`, Realtime while the page is open) | Free | Only while the page is open | None beyond phase 3's own build | Phase 3 |
| **Web push** (VAPID) | Free | Android browsers; iPhones only for an installed web app (iOS 16.4+) | Service worker, PWA manifest | Deferred |
| **Email** | Free to cheap | Everyone, slow to be read | Custom SMTP (`plan_panels.md`, F8) | Deferred |
| **SMS** | Per message | Everyone, fastest read | **DLT registration** with an Indian operator: entity, sender header and every template approved first; only Indian entities can register. MSG91, Fast2SMS, Twilio (adapters in the teammate's fork) | Deferred; critical only at first |
| **WhatsApp** | Per conversation | Very high in India | Business verification, approved templates, recorded opt-in | Later |

### Message copy

No patient data, ever: no name, diagnosis or ward.

> **bloodLink: O- donors needed** at KEM Hospital Blood Centre, Parel, about 4 km from you, by 6:30 pm today. Can you donate? Reply in the app: blk.example/r/7KQ2ZP. bloodLink never asks for money.

After accepting:

> Thank you. Go to KEM Hospital Blood Centre, Parel (map link). Show code **4F7K9Q** at the desk. Centre phone: 022 xxxx xxxx. Can't come? Tap here so someone else can be asked.

English first, then Hindi and Marathi for the pilot city. Each SMS template is registered on DLT word for word with `{#var#}` placeholders.

### Token links (deferred)

- SMS and email links carry a random 128-bit token; only its SHA-256 hash is stored in `response_tokens`.
- Exactly three actions without signing in: view the card, accept, decline. Expires at `needed_by`.
- Accepting shows the centre's details and check-in code, never the donor's own details.
- A forwarded link could let someone else accept. The centre screens whoever arrives; it may ask for photo ID but under NBTC 2017 can't make it mandatory.

---

## Privacy, safety and abuse

| Concern | Design |
|---|---|
| **Where donors live** | Areas stored as a ~1 km cell centre, never an address. Organizations see "within 5 km" bands only. Positions never go to OSRM or any outside service. |
| **Donor's phone** | Only members of the **anchor organization**, only after acceptance, only if the donor ticked "share my number with the centre". Each reveal is logged in `contact_reveals`. Families never see it. |
| **Patient data** | The hospital's own reference number at most. Donors see none. |
| **Consent** | Separate, versioned notice and tick box. Withdrawing clears areas and settings and stops all requests. |
| **Retention** (*assumption*) | Outbox payloads deleted after 90 days. Responses and reveals kept 12 months, then reduced to counts. Donations kept while the account exists (they drive eligibility). |
| **Deletion** | `delete_my_account()` (on `/account`) cascades through every table above, so each new foreign key to `profiles` must cascade or set null. |
| **Fake requests** | Pilot: only members of verified organizations raise requests; critical needs the `manager` role (`plan_panels.md`). |
| **Money scams** | "bloodLink never asks for money" on every message and card. One-tap "This person asked me for money" report pauses the request for admin review. |
| **Request floods** | At most 10 open critical requests per organization; creation rate-limited per member. |
| **Harassment** | Donors can report and block an organization; admins can suspend users and organizations. |
| **Admin access** | Two-factor required for admins and organization owners (`plan_panels.md`, F6). Admins see no health answers. |

---

## Eligibility inside the database

Matching runs in SQL but the rules live in `src/lib/eligibility.js`. To avoid two diverging copies of medical rules:

- **Prerequisite: #64 is fixed first.** `calculateAge` and the donation gap work from India-date strings (`YYYY-MM-DD`), as `profile.js` and the database triggers do, so the JS and SQL agree at any hour.
- Trigger function `refresh_donor_status(user_id)` runs after any change to `profiles` (date of birth, gender, group, `is_donor`, completeness, `is_suspended`), `donor_screening`, `donations` or `consents`, and writes the group, `is_in_network`, `eligible_from`, `eligible_until`, `needs_staff_check` and `screening_confirmed_at`.
- The **window** is stored as two dates, so it never goes stale as days pass and needs no nightly job. `eligibilityWindow(details)` in `eligibility.js` computes the same, and is the reference:
  - **Both null** when the person isn't a donor, has no date of birth, or gave any deferral answer (tattoo, pregnancy, underweight, infection). These answers carry no dates, so the window can't end on its own; the donor changes the answer.
  - `eligible_from` = the later of the 18th birthday and the latest donation + 90 days (men) or 120 days (everyone else). The latest donation is the later of `donor_screening.last_donation_date` and the newest `donations.donated_on`. It is not clamped to today.
  - `eligible_until` = the day before the 66th birthday, or the day before the 61st when no donation is recorded (a first-time donor).
  - Both null when `eligible_from` > `eligible_until`.
  - A 29 February birthday falls on 1 March in other years, as `calculateAge` counts it. `date + interval '18 years'` gives 28 February, so the SQL builds the date with `make_date` instead.
  - `needs_staff_check` = `on_medication`. The window is still computed; hard filter 6 keeps these donors out of matching.
  - `screening_confirmed_at` = `donor_screening.updated_at`.
- **Consistency:** for any India date d, `evaluateEligibility` says `eligible` or `review` exactly when d lies in the window. A test holds the two together.
- **Parity test:** one fixture, `tests/fixtures/eligibility_parity.json` (ages at the edges, 29 February, gaps one day either side, each deferral answer, medication, a centre-confirmed donation newer than the self-reported one), runs through `eligibilityWindow` in Vitest and through `refresh_donor_status` in `scripts/check-donor-network.mjs`, and both must give the same dates.
- Thresholds are checked against the official 2017 text. Apheresis (clauses 2 to 4): donors 18 to 60 and at least 50 kg, 48 hours between apheresis donations, at most twice a week and 24 a year, 28 days after a whole-blood donation. Add when apheresis requests are built.
- A centre-confirmed donation updates `last_donation_date` in the donor's view only with their consent (`donor_screening` is theirs). Otherwise it still sets `eligible_from` through `donations`.

---

## Scale and performance

- **Spatial lookup.** Report 3's benchmark: PostGIS `ST_DWithin` on a GiST index takes **0.60 ms for 100,000 points within 15 km** and 9.7 ms within 150 km, against 185 ms for a scan. A wave's query adds filters and `order by score limit k`: still a few ms.
- **One function per wave.** The project is in Mumbai (#28), ~10 ms per round trip from the laptop. Matching in one SQL transaction avoids the round trips an outside matcher would need.
- **Notification volume.** The largest wave is 40 donors; 100 simultaneous requests are 4,000 messages, well inside report 3's planned test of 10,000 in 5 minutes.
- **Free-plan limits.** Edge Functions run up to 150 s, ample for 50 sends. One-minute pg_cron adds ~1,440 small runs a day; prune `cron.job_run_details` as the collector plan does.
- **One wave at a time.** `match_wave()` and `advance_requests()` take one transaction-level advisory lock, so two requests matching at once can't both ask a donor and break the 72 h gap or the weekly limit. A wave takes milliseconds, so running them one after another costs nothing at this scale.
- **Asks in the last 7 days** are counted through an index on `request_responses (donor_id, created_at)`.
- **What the benchmark doesn't cover.** It timed the distance search on bank positions, not a whole wave (joins, the 7-day count, scoring), and not donors sharing 1 km cells or dense rings. Phase 2 times the whole `match_wave()` (task P2.6).

---

## Measuring it

Logged from the tables and shown on the admin and organization panels:

| Measure | From |
|---|---|
| Fill rate, time to first acceptance, time to fulfilment | `blood_requests`, `request_responses` timestamps |
| Notifications per unit, acceptance, show and deferral rates | `request_responses` |
| Delivery latency per channel | `notification_outbox` |
| Opt-outs within 7 days of a notification | `consents.withdrawn_at` joined to responses |
| Reports by reason and outcome | `abuse_reports` |
| Fairness: share of asks taken by the most-asked 10% of donors | `donor_status.asks_total` |

---

## Testing and simulation

| Level | What | How |
|---|---|---|
| **Unit** | Score formula, wave size, ring choice, stop rules, quiet hours in India time, templates | Pure reference module `src/lib/donorMatching.js` with Vitest, as `ranking.js` has |
| **Schema and SQL parity** | Tables, grants, CHECKs, triggers and functions; eligibility parity against the fixture; from phase 2, `match_wave` picks the same donors in the same order as the reference module | `scripts/check-donor-network.mjs` on the live project inside one transaction that is rolled back, with the migration applied inside it and throwaway rows, as `check-location-schema.mjs` does |
| **Row-level security** | Every row of the access table, as each role, expecting 42501 where refused | Phase 1: the same rolled-back check, switching to `authenticated` with `request.jwt.claims` set per throwaway user. Before phase 3: supabase-js against a local Supabase, never production, with CI (#20) |
| **Simulation** | Tune `OVERBOOK`, `GAP`, `CAP` and priors before any real donor is asked | Below |
| **Notification** | Report 3's tests: latency per channel, 10,000 messages to a fake provider in 5 minutes, retries without duplicates | Fake provider, then providers' test modes |
| **Shadow mode** | Real requests run matching and log whom they would have asked, without sending, for two weeks | Phase 2 |
| **End to end** | Join → request → accept by token → check in → donated → eligibility moves | Playwright on a local stack |

**The simulation**
- **Donors:** 10,000 to 100,000 synthetic donors around real bank positions with a few km of jitter (as `scripts/benchmark-geo.mjs`), with a published Indian blood-group distribution (cite it when used).
- **Behaviour:** acceptance probability from the UCI donor-return data's recency and frequency (duplicates removed), after a long-tailed delay; accepted donors arrive with a show probability; arrivals are deferred with a deferral probability.
- **Requests:** a mix of critical, urgent and routine at real hospital positions.
- **Output:** fill rate, time to fill and notifications per unit per setting; plot notifications per unit against time to fill and pick settings on it. The behavioural inputs are guesses until shadow mode and the pilot replace them, and the report must say so.

---

## Phase 2 build spec

Requests matched in shadow mode: real requests run real waves, the asks are recorded, and **nobody is told**. This section settles every choice phase 2 needs, so the build doesn't have to guess. Where it is more specific than the sections above, it wins for phase 2.

### Settled choices

| # | Choice | Phase 2 |
|---|---|---|
| S1 | **Shadow flag** | `blood_requests.mode text not null default 'shadow' check (mode in ('shadow'))`. Phase 3 widens the CHECK to `live`. |
| S2 | **Donors see nothing** | No donor-facing read of `blood_requests` or `request_responses`: no policy for donors and no `my_request_cards()` yet. The access table's "Own" for donors starts in phase 3. |
| S3 | **Asks don't touch live counters** | Shadow asks never change `donor_status` (`asks_total`, `last_asked_at` and the rest). Rule 9 and `rested` read the donor's last ask and their asks in the last 7 days from `request_responses` of requests in the **same mode**, so the log keeps realistic pacing and live matching starts clean. |
| S4 | **Nobody answers** | Every shadow response stays `notified`, so nothing is on hold and waves run to the last one. `advance_requests()` still implements every rule of `nextRequestStatus` (covered, back to open, fulfilled, expired, partly fulfilled), so phase 3 only adds answers. |
| S5 | **Who may raise one** | The approved applicant of an approved organization of either kind (`profiles.organization_id`, `organizations.status = 'approved'`), not `is_suspended`. At most 10 open requests per organization and 20 created per organization per India day. |
| S6 | **Anchor** | `anchor_hospital_code` references `blood_banks (hospital_code)`. The position is the accepted `bank_location_fixes` row if there is one, else `blood_banks.location` when `location_quality = 'ok'`, as `bankPositions` in `src/lib/bankLocations.js` does; with neither, `create_request()` refuses. It is copied into `anchor_point` at creation. A blood bank organization's form starts from its own `eraktkosh_code`. |
| S7 | **Urban or rural** | `create_request()` counts banks with a usable position within 15 km of the anchor: more than 10 is `urban`, otherwise `rural`, as `/api/blood-search` does (`DENSITY_RADIUS_M`, `DENSE_AREA_MIN_BANKS`). Stored in `area`. |
| S8 | **Travel conditions** | `/api/requests` works them out with `trafficZone` and `trafficConditions` (`src/lib/trafficModel.js`, through `traffic.js`) and the rain from `weather.js` (no rain when that fails), and passes them to `create_request()`, whose CHECKs use `trafficModel.js`' own bounds. A direct call could pass other values inside those bounds; that only reorders donors, so it is accepted. |
| S9 | **Compatibility in SQL** | `blood_compatibility (recipient_code, component_category, donor_code)`, primary key on all three, holds exactly what `donorGroupsFor(recipient, component)` returns for every group and component category, Bombay included (only Bombay donors). The check script compares every pair. |
| S10 | **Tie-break** | The SQL key is `('x' \|\| substr(md5(request_id::text \|\| ':' \|\| donor_id::text), 1, 8))::bit(32)::bigint / 4294967296.0`. The parity check gives `planWave` a `random` that returns the same keys in the order it draws them (donors sorted with `String(id).localeCompare`). `donorMatching.js` doesn't change. |
| S11 | **Distance** | `ST_Distance(donor_areas.cell, anchor_point) / 1000`, the nearest of the donor's areas inside the ring. The parity check passes those distances to `planWave` as `areas[].distanceKm`. Order must match exactly and scores to 1e-9. |
| S12 | **One wave at a time** | `create_request()`, `match_wave()` and `advance_requests()` start with `perform pg_advisory_xact_lock(hashtext('bloodlink.match_wave'))`. |
| S13 | **First wave** | Critical and urgent: inside `create_request()`'s transaction. Routine: `next_wave_at` is the next 09:00 to 20:00 India window, and the cron job sends it. |
| S14 | **Indexes** | `request_responses (donor_id, created_at desc)`; `unique (request_id, donor_id)`; `blood_requests (next_wave_at) where status in ('open', 'covered')`. |
| S15 | **Kinds** | Phase 2 accepts `shortfall` and `apheresis` only. |
| S16 | **What staff see** | `request_waves` rows and `request_wave_summary(request_id)`: per wave, the ring, candidates, k, p_accept, exact and compatible counts, distance bands (to 5, 10, 15, 25 km, beyond), score minimum, median and maximum, and the donors each hard filter removed. Never a donor's identity or position. Members of the raising organization and admins only. |
| S17 | **Cron** | `schedule_donor_requests()` and `unschedule_donor_requests()` add and remove the one-minute `advance-requests` job, like `schedule_stock_forecast()`. The migration schedules nothing; P2.7 does, with the user's go-ahead. |
| S18 | **Deletion** | `created_by` sets null; `request_responses.donor_id` and `request_waves.request_id` cascade; `delete_my_account()` is checked again. |

### Functions

All `security definer`, `set search_path = ''`, with their own checks, errors through the codes `rpcErrorResponse` already maps.

| Function | Who | Does |
|---|---|---|
| `create_request(p_anchor_hospital_code text, p_blood_group_code text, p_component_code text, p_units_needed integer, p_urgency text, p_needed_by timestamptz, p_allow_compatible boolean, p_patient_reference text, p_kind text, p_zone_free_flow_kmh numeric, p_congestion_percent numeric, p_rain_factor numeric) returns bigint` | `authenticated` | Checks S5 to S7, inserts the request in shadow mode, runs the first wave per S13, returns its id. `allow_compatible` only for a blood bank organization. `needed_by` between 30 minutes and 14 days ahead. |
| `cancel_request(p_request_id bigint, p_reason text)` | `authenticated` | A member of the raising organization closes it as `cancelled`. |
| `match_wave(p_request_id bigint) returns integer` | internal only | One wave, as in [Step 3](#step-3-waves), writing `request_waves` and `request_responses`; returns how many were asked. |
| `advance_requests() returns integer` | internal only (the cron job) | Each open or covered request whose `next_wave_at` has come: the next wave, then the status by [Step 4](#step-4-when-to-stop). |
| `request_wave_summary(p_request_id bigint)` | `authenticated` | S16. |

### App

- `src/lib/donorRequests.js` (pure): `sanitizeRequest(input, now)`, a whitelist validator mirroring every CHECK above, with tests.
- `/api/requests`: `GET` the organization's requests with their wave summaries; `POST` `{ action: "create", ... }` or `{ action: "cancel", id, reason }`. As the signed-in user through the server client; the user id only from the session; `{ available: false }` before the migration, as `/api/donor-network` does.
- `src/app/organization/ShadowRequestsCard.js`: a client component on `/organization`, which must stay static. A form to raise a shadow request, then each request's waves from the summary, with "Shadow mode: no donor is told" on it.
- Admin overview: open shadow requests and when `advance_requests()` last ran.

### Order of work

1. P2.1 and P2.2 together, by one agent, since the functions and the compatibility rows meet in the same migration.
2. P2.3 once P2.1 exists. P2.4 and P2.5 alongside it, against the signatures above.
3. P2.6 is deferred to after the alpha and is skipped in this build. When it is taken up, on the user's choice: a local Supabase stack in Docker with 100,000 and 1,000,000 generated donors (preferred), or the live project inside a rolled-back transaction with at most 20,000. It reports `match_wave()`'s median and 95th percentile per ring from `EXPLAIN ANALYZE`.
4. P2.8, then P2.7, applied and scheduled on the user's go-ahead.

---

## Phase 3 and 4 build spec

Phase 3 is the live pilot: real donors are asked, answer and donate. **Phase 3 is in-app only: no push, email or SMS.** A donor finds out about a request only when they open the website: a popup on page load lists their open request cards, and the same list is a card on `/peer-to-peer`. Accepting is the "get in touch": it shows the centre's address, a map link, the centre's phone number and the check-in code. Donors never contact patients or families (N1, N8). Phase 4 (SMS and tuning) is deferred, as are the outbox, channels and token links. Nothing here is built yet. **No donor may be contacted until every gate below is cleared in writing.** Where this section is more specific than the sections above, it wins for these phases.

### Gates

| Gate | Needed for | Who clears it |
|---|---|---|
| G1 Partner blood centre and one hospital agree to the pilot, with a named contact at each | 3 | The user |
| G2 The centre's medical officer reviews the screening questions and the medication rule (open question 7) | 3 | The user, with the centre |
| G3 The project guide signs off the legal frame | 3 | The user |
| G4 `plan_panels.md` F1 (organization members) and F6 (two-factor sign-in) built. F8 (custom SMTP) is deferred with email | 3 | Code |
| G5 Phase 2 exit: two weeks of shadow logs, centre staff find the matches sensible, wave settings chosen | 3 | The user and the centre |
| G6 A Firebase or VAPID key pair for web push | Deferred (no push in phase 3) | The user |
| G7 DLT registration with an Indian operator: entity, sender header, every template word for word | Deferred (no SMS in phase 3 or 4) | The user, with an SMS provider |

### Settled choices

| # | Choice | Phase 3 and 4 |
|---|---|---|
| S19 | **Going live is per request** | The `mode` CHECK widens to `shadow` and `live`. `create_request()` makes a `live` request only when a database flag, set by an admin function, is on for that organization. Everything else stays shadow. |
| S20 | **Donor reads** | `my_request_cards()` returns only requests the donor was notified about, without `patient_reference`. No donor policy on the tables. |
| S21 | **Donor actions** | `respond(request_id, accept)`, `cancel_response(request_id)`, `check_in(request_id, code)` are the only ways a donor changes a response, each as the signed-in user. |
| S22 | **Centre actions** | `confirm_donation(response_id, kind)` creates the `donations` row and moves the response to `donated`; `defer_donor(response_id, reason)` sets `deferred`. Members of the anchor organization only. |
| S23 | **Live counters** | Only live asks move `donor_status` counters. Rule 9 and `rested` keep reading same-mode responses (S3). |
| S24 | **Hold and check-in** | An accepted response holds a place until `hold_until`, from the hold row of the matching section's defaults table (all *assumptions*, to be calibrated in the pilot): the estimated travel minutes plus 60 minutes for a critical request, plus 2 hours for an urgent one, and `needed_by` for a routine one (booked slots arrive with appeals); past it, `no_show` and the request can go back to `open`. A 6-character `check_in_code` is shown after accepting. Nothing assumes the donor sees a request quickly: an unseen card is normal, with no penalty, and `ignored_in_a_row` does not count cards the donor never opened (status still `notified`, never `seen`). A card the donor opened and left unanswered until it expired does count. |
| S25 | **Contact sharing** | Name and phone reach the centre only after acceptance, and the phone only with `share_phone` (consent purpose `share_phone_with_centre`), through a view that logs `contact_reveals`. |
| S26 | **Outbox** | **Deferred.** Later: `match_wave()` inserts `notification_outbox` rows in the same transaction as the responses; `claim_notifications()` and `finish_notification()` as in [Notifications](#notifications). Not in phase 3: no `notification_outbox`, `claim_notifications()` or `finish_notification()`. |
| S27 | **Channels** | **Deferred.** Phase 3 has in-app only (S31). Later: web push, email, and SMS for critical requests, honouring a donor's `channels` setting, with consent purpose `sms` for SMS. |
| S28 | **Token links** | **Deferred.** Later: single-use, hash-stored, three actions without signing in. Not in phase 3: no `response_tokens`, no `/r/[token]`, no service worker or manifest. |
| S31 | **Donor sees requests only on the site** | `my_request_cards()` returns the donor's open cards: blood group, centre name, distance band (to 5, 10, 15, 25 km, beyond), `needed_by` and urgency. A signed-in donor with any gets a modal on page load, with Accept and Decline on each card and a "Not now" button that hides it for the rest of the session (`sessionStorage`, only a convenience; the card stays on `/peer-to-peer`). The same list is a full card on `/peer-to-peer`. A card is marked `seen` only when the donor accepts it, declines it or expands it. The popup opening on page load and "Not now" do not, so frequent visitors don't reach the three-ignored auto-snooze while people who never visit don't. |
| S32 | **Accepting reveals the centre** | After `respond(request_id, true)` the card shows the centre's address, a map link, the centre's phone number and the check-in code. Donors never see patient details or contact patients or families. |
| S33 | **Realtime** | An open page updates when a card is added, answered or closed, through Supabase Realtime on the donor's own row of `donor_card_signals` (S35), which then refetches `my_request_cards()`. Realtime never reads `request_responses`. |
| S34 | **Only live cards** | `my_request_cards()` returns only requests with `mode = 'live'`, for responses of the donor in status `notified`, `seen` or `accepted`. Shadow requests never reach a donor. A card whose request has closed or been covered (`not_needed`, `expired`, `cancelled`) leaves the list, and an open popup drops it on the next update. |
| S35 | **A signal table, not Realtime on responses** | Donors have no select policy on `request_responses` (S20 holds), and nothing relies on Realtime honouring column grants. A dedicated table `donor_card_signals (donor_id uuid primary key references auth.users on delete cascade, changed_at timestamptz not null)` is the only thing the page subscribes to. A donor may select only their own row (row-level security, no write grant); triggers on `request_responses` upsert the row of the donor whose card is added, changed or closed, only for responses whose request has `mode = 'live'`, so a shadow ask never touches a donor's signal; `match_wave()` and `advance_requests()` do the same through those triggers. The table is in the `supabase_realtime` publication. The page treats any change as a signal and refetches `my_request_cards()`; it never renders the payload, which holds nothing but the time. P3.2's checks prove a donor cannot read another donor's signal row, cannot select any column of `request_responses` (`score`, `est_minutes`, `wave`, `status` and the rest), cannot write the signal, that a live card change moves exactly that donor's `changed_at`, that a shadow wave leaves every `changed_at` unchanged, and that `delete_my_account()` still works for a donor with a signal row. |
| S36 | **Where the popup lives** | A client component in the root layout, fetching `/api/donor-requests` only when someone is signed in as a donor in the network; for everyone else it renders nothing and fetches nothing, so `/`, `/organization`, `/peer-to-peer`, `/privacy`, `/search` and `/set-details` stay static. |
| S29 | **Abuse** | `abuse_reports` and an admin queue; an admin function sets `profiles.is_suspended`. |
| S30 | **Pilot hours** | Daytime only at first: live waves run 09:00 to 20:00 India time; critical requests are the exception only when an admin turns that on. |

### Tasks

| # | Task | Depends on |
|---|---|---|
| P3.1 | Spec check: read this section and the plan, settle anything missing, update the tables here. Done: S34 to S36 settle what donors see, Realtime and where the popup lives | none |
| P3.2 | Migration: widen `mode`, the live flag, `my_request_cards()`, `respond()`, `cancel_response()`, `check_in()`, `confirm_donation()`, `defer_donor()`, the contact view, `abuse_reports`, the admin suspend and live-flag functions, `donor_card_signals` with its triggers and own-row policy (S35); checks added to `check-donor-network.mjs`. No outbox, tokens or notification functions | P3.1 |
| P3.3 | `/api` routes and the donor requests card on `/peer-to-peer`: view, accept, decline, cancel, centre details and code | P3.2 |
| P3.4 | Centre side on `/organization`: live requests, arrivals, confirm donation, defer | P3.2 |
| P3.5 | The popup on site open (S31), plus Realtime so an open page updates (S33). A client component mounted for signed-in donors that keeps the other pages static | P3.2, P3.3 |
| P3.6 | Admin: open critical requests, abuse queue, suspend, live flag per organization | P3.2 |
| P3.7 | Simulation of whole requests against the real functions, with no notification path | P3.5 |
| P3.8 | Docs, then the pilot checklist for the user | all |
| P4.1 | **Deferred.** SMS adapter and templates registered on DLT; `sms` consent; critical only | G7 |
| P4.2 | **Deferred.** Delivery webhook, retries and the fallback; the outbox and notifier of S26 to S28 | P4.1 |
| P4.3 | **Deferred.** Tuning from pilot outcomes: starting counts, wave settings, rings | the pilot's data |

### Order of work

1. P3.1, by one agent, before anything is built.
2. P3.2 by one agent, then P3.3, P3.4 and P3.6 in parallel against its signatures.
3. P3.5 after P3.3, then P3.7 and P3.8.
4. Applying any migration, scheduling any job, sending a real message and turning the live flag on each need the user's go-ahead, and none before G1 to G5 are cleared.
5. Phase 4 is deferred. After P3.1, stop and show the user the plan's diff before P3.2 starts.

---

## Rollout

| Phase | Contents | Exit criteria |
|---|---|---|
| **0 · Prerequisites** | **For phase 1** (done on `p2p-network`, 17 November): #64 fixed; the network added to `/privacy` with a new `PRIVACY_VERSION`. **For phase 3:** the partner centre's medical officer has reviewed the screening questions and the medication rule (open question 7); `plan_panels.md` F1 (members), F6 (two-factor), F8 (custom SMTP); the guide's sign-off on the legal frame; a partner centre and hospital | Phase 1's two before it ships; the rest done, in writing, before phase 3 |
| **1 · Donors only** | Join, consent, areas, availability, `profiles.is_suspended`, `donations`, the `donor_status` triggers and the parity test; `donor_cell_counts()`, donor counts per ~1 km cell for admins (cells under 5 hidden); the reference matching module `src/lib/donorMatching.js` with its tests | `check-donor-network.mjs` and `npm test` green; 100 donors in the pilot city |
| **2 · Requests in shadow mode** | `blood_requests`, `request_responses`, `match_wave`, `advance_requests` and the one-minute cron; real requests matched and logged, and nobody told. Until F1, a request's organization member is the approved applicant (`profiles.organization_id` with an `approved` organization), and its anchor point is the bank's position from `blood_banks` with the accepted `bank_location_fixes` applied, as `bankPositions` does | Two weeks of logs; centre staff find matches sensible; simulation settings chosen |
| **3 · Live pilot** | One centre and one hospital; in-app only (a popup on site open and a card on `/peer-to-peer`; no push, email or SMS); daytime only at first; admins watch open critical requests | 20 real requests closed with every outcome recorded; no safety incident |
| **4 · SMS and tuning (deferred)** | DLT registration and SMS for critical; push, email, the outbox and token links; starting counts and wave settings reset from pilot outcomes | Delivery and fill targets met |
| **5 · Appeals and growth** | Centre appeals with slots, forecast appeals, camps, more cities; perhaps public requests confirmed by the anchor centre | Decided after phase 4 |

---

## Decisions and alternatives

**N1 · Every request is anchored to a licensed blood centre.** The law and safety require it, and the centre, which screens, controls who comes. *Alternative:* connect donors and families directly, as WhatsApp groups do: faster, but invites replacement pressure, scams and privacy harm, and the app couldn't know a donation happened.

**N2 · Verified institutions only, at first.** Every request has an accountable sender; fake and money-seeking requests are the commonest harm in informal networks. *Alternative:* public requests with an admin-reviewed requisition slip photo: wider reach, but slow review and forgery risk. Revisit in phase 5 with anchor-centre confirmation.

**N3 · Matching runs in SQL, in one transaction.** Filters, scoring, responses and queued messages succeed or fail together, with no extra privileged connection or round trips. *Alternative:* an Edge Function running a shared JS module (one implementation, easier tests) but it needs a privileged connection and several round trips per wave. The pure JS module remains as the reference for tests and simulation.

**N4 · Areas, not addresses or live location.** A 1 km cell suffices for rings of 5 km or more and reveals far less. *Alternatives:* geocoded home address (precise, sensitive; Nominatim's policy discourages it); live device location (most accurate, but background permission and a bigger privacy ask); district only (too coarse for urban rings).

**N5 · Waves on the search's own rings.** Fast enough for critical cases, gentle on donors, and the same density-aware rings users see in search. *Alternatives:* broadcast (fastest, wears donors out); one at a time (far too slow).

**N6 · An expected-donation score, not a weighted sum.** The main unknown is whether the donor comes; probability times a travel discount says that directly, and wave size follows from the same probability. *Alternative:* a weighted sum like the bank ranking, whose weights would have no natural meaning here.

**N7 · Exact group first; compatible only with the centre's consent, from the third wave.** Consistent with report 3's D1.4; keeps O- donors for O- patients and leaves substitution to clinicians.

**N8 · Donor contact goes to the anchor centre, not the family.** The centre needs it and is accountable; contact with families is where pressure and scams start. *Alternative:* masked calling through a virtual number provider: better privacy at a per-minute cost, worth it if centres call donors often.

**N9 · An outbox and a limited-role dispatcher.** Nothing is sent unless the change committed; retries are safe; provider secrets stay in Edge Function secrets; no service-role key exists. *Alternatives:* sending from the Next.js route (crashes lose messages; serverless may stop after responding); a hosted queue (another service).

**N10 · In-app and web push first, SMS only for critical.** Free channels cover most donors; SMS needs DLT registration and costs per message, so it is kept for when minutes matter.

**N11 · Eligibility as a stored date kept current by triggers.** Indexable, cheap to filter, never trusted from the client. *Alternatives:* compute in every match query (slow, duplicated); trust a client flag (unsafe).

**N12 · Shadow mode before anyone is messaged.** The defaults are guesses; two weeks of "whom would we have asked" lets staff check them at no cost to donors. Report 3 planned the same for forecast alerts.

---

## Risks

| Risk | Effect | Mitigation |
|---|---|---|
| **Too few donors** | Requests go unanswered; feature looks broken | One city with a partner centre; recruit via college NSS and NCC units and the centre's donors; show "N donors near you" to centres before promising anything |
| **Donor fatigue** | Opt-outs grow | Weekly caps, rest factor, waves, auto-snooze, fatigue measure on the admin panel |
| **Fake or money-seeking requests** | Harm to donors and trust | Verified institutions only; warnings; one-tap reports pause a request |
| **Wrong eligibility** | A donor is turned away, or someone unsafe is asked | Thresholds checked against NBTC 2017; medical officer's review; parity tests; "the centre decides" copy |
| **Privacy breach** | Real harm and a DPDP Act problem | 1 km cells; no addresses; contact only on acceptance; owner-only health data; two-factor for privileged accounts; retention limits |
| **SMS regulation and cost** | SMS can't be sent, or costs grow | Start DLT early; SMS only for critical; push first |
| **Latency to the database** | Slower waves | One function per wave; project in Mumbai (#28), the nearest region |
| **Replacement-donation policy** | Conflict with national guidance | Default to voluntary appeals; patient-linked requests only from treating institutions; guide's sign-off in phase 0 |

---

## Open questions

1. Which city, blood centre and hospital will pilot, and will the centre's medical officer review the flows and copy?
2. Should a donation for a request be credited to that patient? (Recommendation: no, beyond telling the hospital it happened.)
3. Should donors see how many others were asked? It might encourage them or make them assume someone else will go.
4. Include apheresis in the pilot given dengue season, or wait for its screening rules to be confirmed?
5. Which languages for the pilot's templates?
6. Should donors be able to choose "only critical requests"? It cuts fatigue but shrinks the pool for urgent ones.
7. Which medications defer a donor, and for how long? Until the partner centre's medical officer answers, a donor on any medication isn't asked (hard filter 6) and sees why.

---

## Sources

- `docs/SUMMARIES/geospatial_benchmark.md` (PostGIS benchmark), `docs/SUMMARIES/performance_testing.md` (notification tests), `docs/SUMMARIES/ml_models.md` (shadow-mode alerts, UCI data).
- The cloud collector (`supabase/migrations/20261103000100_cloud_collector.sql`, `supabase/functions/collect-stock/`; `docs/SUMMARIES/data_quality.md`): the pg_cron, pg_net, Edge Function, Vault and limited-role pattern reused here.
- `src/lib/eligibility.js`, `src/lib/compatibility.js`, `src/lib/ranking.js`, `src/lib/traffic.js`: modules the matching reuses.
- [DLT registration for SMS to India](https://www.plivo.com/docs/sms/concepts/dlt-registration-process) (Plivo's guide; check the operator's DLT portal for current rules).
- NBTC, [*Guidelines for Blood Donor Selection & Blood Donor Referral*](https://www.isignal.in/h-library/document-2.pdf), NACO letter S-12016/5/2016-NACO (NBTC), 11 October 2017. Read from the copy annexed to the Union of India's affidavit in *Thangjam Santa Singh v. Union of India*, WP (C) 275 of 2021 (Annexure A5, pages 162 to 192), because NACO's server wasn't reachable. Clauses 12 and 51, which exclude transgender people, men who have sex with men and female sex workers, are what that case challenges.
- *Common Cause v. Union of India* (Supreme Court, 1996), the National Blood Policy, and the Drugs and Cosmetics Act, 1940 with its 1945 Rules: cite the official texts in the report after the guide's review.
