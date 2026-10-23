# Plan: what the admin, blood-bank, hospital and donor panels could do

**Status: PLAN, not started.** This is a menu of features with priorities and reasons, plus the foundation they share. Nothing has been built.

- Paths are relative to `bloodlink/` unless they start with `../`.
- It expands item 5 of "Where to go next" in `CLAUDE.md` ("Verified accounts get a role but no tools yet") and answers part of #32 (the slides promise a chronic-care module).
- The donor network itself is planned in `plan_donor_network.md`; this file covers the panels people use around it.
- **Priorities:** **Must** = needed before a pilot with one real bank and hospital. **Should** = makes the pilot work well. **Could** = later or stretch. **Size:** S under a day, M one to three days, L a week or more, for one developer who knows the codebase.

**Contents**
1. [Where it stands](#where-it-stands)
2. [Principles that shape every panel](#principles-that-shape-every-panel)
3. [The shared foundation](#the-shared-foundation)
4. [Admin panel](#admin-panel)
5. [Blood-bank panel](#blood-bank-panel)
6. [Hospital panel](#hospital-panel)
7. [Donor and user panel](#donor-and-user-panel)
8. [Optional: a health-official view](#optional-a-health-official-view)
9. [Who can do what](#who-can-do-what)
10. [Data model additions](#data-model-additions)
11. [Roadmap](#roadmap)
12. [What not to build, and why](#what-not-to-build-and-why)
13. [Testing](#testing)
14. [Open questions](#open-questions)

---

## Where it stands

| Panel | Exists today | Missing |
|---|---|---|
| **Admin** | `/admin`: counts, review queue with Approve, Reject and Suspend, the eRaktKosh collection-health card, recent activity. `/admin/organizations`, `/admin/users` (grant or remove admin), `/admin/audit` | Evidence for verification, data-quality tools, user suspension, privacy requests, finer admin roles, alerts |
| **Blood bank** | A verified badge on `/peer-to-peer` and the `blood_bank` role | Everything |
| **Hospital** | A verified badge and the `hospital` role | Everything |
| **Donor / user** | `/peer-to-peer`: profile, role badge, live eligibility. `/set-details` to edit | Availability, history, reminders, requests (see `plan_donor_network.md`) |

Two limits in the current data model matter for every panel:
- **One person per organization.** `organizations.applicant_id` and `profiles.organization_id` tie an organization to the one person who applied. A real blood bank has a medical officer, technicians and a counsellor on shifts. They can't share one login.
- **An organization has no position.** It has an address and an optional eRaktKosh code, but no confirmed point, hours or services. A hospital's emergency request needs to start from where the hospital is.

---

## Principles that shape every panel

**P1 · eRaktKosh stays the record of stock. bloodLink never asks a bank to type its stock in.**
- *Why:* licensed blood centres already update eRaktKosh. A second place to enter stock means double work, and two numbers that disagree, in an emergency. bloodLink's value is reading eRaktKosh well, not replacing it.
- *What a bank can add instead:* short-lived status notes ("O- units on hold for a surgery until 4 pm", "closed for the festival today"), hours, services and contacts.
- *Alternative rejected:* own stock entry with eRaktKosh as a fallback. It would win on freshness only for banks that keep both up to date, and lose everywhere else.

**P2 · Organizations have members.** One organization, many people, each with a role (owner, manager, staff, viewer). Every panel checks membership, not `profiles.role`.

**P3 · Permissions live in the database.** Row-level security plus `security definer` functions, as today. Pages hide what you can't do; the database refuses it. Every action that changes another person's data writes `audit_log`.

**P4 · As little patient data as possible.** No patient names. A hospital refers to a patient by its own internal number, which means nothing outside the hospital. Required by the spirit of the Digital Personal Data Protection Act (#18), and it makes a leak far less harmful.

**P5 · Medical output stays informational** (#24). Panels show eligibility, compatibility and rankings as guidance; the bank screens and cross-matches.

**P6 · Build in the order the donor network and emergency requests need.** A panel feature that nothing else depends on waits.

---

## The shared foundation

Build these first; every panel below assumes them.

| # | Piece | What | Why | Size |
|---|---|---|---|---|
| F1 | **Organization members** | `organization_members` with a role, invitations by email, a helper `is_org_member(org, min_role)` for policies. Backfill each approved applicant as `owner`. | P2. One login per bank doesn't survive shifts | M |
| F2 | **Organization profile** | A confirmed map pin, hours, a 24×7 flag, services (component separation, apheresis, irradiation), contact numbers by role, a landmark | Requests start from the hospital's point; donors and runners need the right gate | M |
| F3 | **Verified eRaktKosh link** | For a blood bank, its eRaktKosh code confirmed by an admin against the directory (name, district, phone) | Lets the bank's panel show its own live stock and confirm its own pin (`plan_bank_locations.md`) | S |
| F4 | **Panel shell** | `/org/[id]` with tabs by role; `/dashboard` sends each person to their panel; the proxy guards `/org` | One place for each organization's tools | S |
| F5 | **Notifications inbox** | A `notifications` table and a bell in the header, live through Supabase Realtime. Shared with the donor network | Reservations, reviews and requests all need to reach someone | M |
| F6 | **Two-factor sign-in** for admins and organization owners | Supabase Auth's TOTP; policies on sensitive tables require the `aal2` level in the JWT | An admin or bank-owner account can approve, suspend and see donors' contact details | M |
| F7 | **Private document storage** | A Supabase Storage bucket for licences and requisition slips, readable by the organization's members and admins only | Verification needs evidence, and it must not be public | S |

---

## Admin panel

### Verification

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **Evidence panel on each application** | Shows the uploaded licence, the claimed eRaktKosh code's directory entry side by side (name, district, phone), and a name-similarity score | Today an admin approves on trust. This turns approval into a check | F3, F7 | Must | M |
| **"Needs more information" status** | A fourth decision that sends a note back without rejecting | Most problems are a missing document, not a fake applicant | `review_organization()` gains a value | Should | S |
| **Conflict warnings** | Flags two organizations claiming one eRaktKosh code, or one registration number | The cheapest way to catch impersonation | Unique checks | Must | S |
| **Re-verification reminders** | Lists organizations whose licence expiry date (entered at review) is near or past | Licences expire; data.gov.in has dates for many banks | A `licence_valid_until` column | Could | S |
| **Two-person rule for suspensions** | A suspension takes effect once a second admin confirms | Suspending a hospital mid-emergency is serious; one mistaken click shouldn't do it | A pending-action table | Could | M |

### Data quality

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **Location review queue** (`/admin/locations`) | Proposed and missing bank positions with a draggable pin | The last step of #33 and #34 | `plan_bank_locations.md` | Must | M |
| **Duplicate-code review** | The 6 likely duplicate eRaktKosh pairs side by side, with merge or "not a duplicate" | #34's remaining item | `../blood_data/crosswalk/eraktkosh_possible_duplicates.csv` | Should | S |
| **Dormant and stale banks** | Banks not updated for 7 and 30 days, by state, with their phone numbers | These are banks someone could call to nudge, and the forecast excludes them | `bank_stock_latest.entry_at` | Should | S |
| **Validator trends** | Per day: labels renamed, counts dropped, future dates, from `upstream_calls.quality` | Spots eRaktKosh changing a format before it breaks searches | Existing column | Could | S |
| **Freshness map** | States or districts coloured by median stock age and the share of dormant banks | One picture of where the data can be trusted | Leaflet, state outlines | Could | M |

### Platform health

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **Collector alerts** | Email to admins when no sweep finished for 6.5 hours, or success fell under 95% | The health card helps only if someone opens it | `supabase_scheduler.md` adds `collector_runs` | Should | S |
| **Search health** | Search counts, the share served from the saved copy, routing fallbacks, rate-limit refusals, 95th-percentile times | Shows when users, not just the collector, are affected | App logging into a small table, aggregated | Could | M |
| **Zero-result searches** | Where and for which group searches found nothing, rounded to the district | Real unmet demand, useful for the forecast and for camp planning | The same log, anonymised | Could | S |

### Users, privacy and safety

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **Suspend a user** | Blocks a person from requests and donor matching, with a reason, without deleting them | The donor network will attract misuse (`plan_donor_network.md`) | An `is_suspended` column read by policies and the proxy | Must before the donor network | S |
| **Privacy requests** | A queue of "delete my account" and "export my data" requests with a due date | #18 and the DPDP Act's rights to erasure and access | A `privacy_requests` table; deletion through a function | Must before launch | M |
| **Abuse reports** | Reports from donors and banks about a request or a person, with the history | Fake and money-seeking requests are a known problem in informal blood groups | `plan_donor_network.md` | Must with the donor network | M |
| **Finer admin roles** | `reviewer` (organizations only), `data_steward` (locations and data), `support` (users and reports), `super_admin` | Least privilege: a volunteer reviewing locations doesn't need to grant admin | Extend `set_user_role()` | Should | M |
| **Audit log search and export** | Filters by actor, action, target and date; CSV export | Needed the first time someone asks "who approved this?" | Existing table | Should | S |

### Requests oversight (once the donor network exists)

| Feature | What it does | Why | Priority | Size |
|---|---|---|---|---|
| **Open critical requests** | Every critical request not yet covered, with its age and how many donors were asked | A human can step in when matching is failing | Must with the network | S |
| **Fatigue watch** | Donors asked most often this month, opt-out rate after a notification | Asking the same people too often loses them | Should | S |
| **Suspicious patterns** | One phone or account behind many requests, requests far from their stated hospital | Catches fraud early | Should | M |

### Content and settings

| Feature | What it does | Priority | Size |
|---|---|---|---|
| **Banners** | A site-wide notice ("eRaktKosh is down nationally", "dengue season: platelet donors needed in Delhi") | Could | S |
| **Ranking explainer** | The current weights, τ values and freshness cut-offs, read-only, with a what-if calculator on a saved candidate set | Could | M |

---

## Blood-bank panel

For members of a verified organization of kind `blood_bank` with a confirmed eRaktKosh link (F3).

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **"How bloodLink sees you"** | The bank's own listing: stock as eRaktKosh last gave it, its age, the dormant flag, location quality, how it ranked in recent searches | Banks rarely know their listing is stale or misplaced. Showing them is the cheapest fix for both | F3, stock store | Must | S |
| **Confirm our location** | Drag the pin to the right gate; saved as a `bank_confirmed` fix | Fixes #33 and #34 at the source, with better accuracy than any geocoder | `plan_bank_locations.md` | Must | S |
| **Status notes** | Short notes with an expiry: on hold, closed today, call before coming, apheresis available today | P1: adds what eRaktKosh can't say, without double entry | A `bank_notes` table; shown on search results | Should | S |
| **Stock history** | The bank's own units per component and group over time, from `stock_history` | Lets the bank see its own patterns; the base for its forecast | Existing table | Should | M |
| **Low-stock watch** | The bank sets a level per group; bloodLink tells it when eRaktKosh shows the stock below it | A simple alert that works before the forecast exists | Notifications (F5) | Should | S |
| **Reservation requests** | Hospitals ask to reserve units; the bank accepts, partly accepts or declines, with a hold time | Turns the response plan into an action instead of a phone call | Hospital panel | Should | L |
| **Donor appeals** | Ask nearby eligible donors of a group to come in, for a date range and time slots | The donor network's main supply tool, run by the people who screen donors | `plan_donor_network.md` | Must with the network | M |
| **Check-in and confirmation** | Scan a donor's check-in code; record donated or deferred | Closes the loop: the donor's last donation date updates itself, and requests know they were met | `plan_donor_network.md` | Must with the network | M |
| **Camps** | The bank's camps from eRaktKosh's camp data, plus camp slots donors can book | Camps are where most voluntary donation happens | Camp data in `../blood_data/` | Could | M |
| **Forecast** | "You usually run short of B- in weeks like this", once the forecast exists | Report 3, point 5: camp planning for blood-bank accounts | Point 5 model | Could | L |
| **Team** | Invite and remove staff, set roles | F1 | F1 | Must | S |

---

## Hospital panel

For members of a verified organization of kind `hospital`.

| Feature | What it does | Why | Builds on | Priority | Size |
|---|---|---|---|---|---|
| **Emergency request composer** | Group, component, units, urgency and "needed by", with the hospital's internal patient number. Runs the ranked search from the hospital's own pin and shows the plan | The ranked search exists; this gives it a home and a record | F2, `/api/blood-search` | Must | M |
| **Request board** | Every open request with its plan, each bank's status (to call, called, reserved, collected), who is fetching and when | In an emergency, several people chase the same blood. One board stops duplicate calls and lost requests | Realtime | Must | M |
| **Call script** | For banks not on bloodLink: the phone number, what to ask, and buttons to record the answer | Most banks won't have accounts for a long time | — | Should | S |
| **Reservation requests** | Send the plan's lines to banks that are on bloodLink; see accept or decline live | The other half of the bank feature | Blood-bank panel | Should | L |
| **Runner tracking** | Assign a runner; they share a link that shows "collected" and "on the way" | Saves calls between ward, runner and bank | A signed link; no live GPS needed at first | Could | M |
| **Escalate to donors** | When the plan has a shortfall, ask eligible donors to donate at the chosen bank, credited to the request | The donor network's emergency path, started by a verified hospital, so the request is trusted | `plan_donor_network.md` | Must with the network | M |
| **Chronic-care schedules** | For patients who need regular transfusions (thalassaemia, for example): due dates, a usual bank, reminders a few days ahead, and a pool of regular donors | The slides promise a chronic-care module (#32). Regular, predictable need is where planning helps most | Patient consent; no names (P4) | Could | L |
| **Saved banks** | Favourite or contracted banks, shown first in the composer | Hospitals have usual suppliers | — | Could | S |
| **Reports** | Time to secure units, requests met, shortfalls by group and month | Shows the hospital, and the project report, whether bloodLink helps | Request history | Could | M |
| **Team** | Invite and remove staff; only `manager` and above may raise critical requests | F1 | F1 | Must | S |

---

## Donor and user panel

The existing `/peer-to-peer` page, grown. Details of matching and notifications are in `plan_donor_network.md`.

| Feature | What it does | Why | Priority | Size |
|---|---|---|---|---|
| **Join the donor network** | A separate, explicit consent to be contacted, with a plain-language notice | Willing to donate is not the same as agreeing to be messaged (DPDP Act consent) | Must | S |
| **Availability** | Available now, snooze for a week, quiet hours, at most N requests a week | Respects donors' time, which keeps them | Must | S |
| **Donation areas** | Up to two areas (home, work) picked on a map, stored at about 1 km precision | Matching needs a position; an exact home address isn't needed | Must | S |
| **Request inbox** | Requests sent to you, with accept or decline, the bank's address and a check-in code | The core of the network | Must | M |
| **Donation history** | Donations confirmed by banks, plus ones you add yourself | Eligibility then updates itself | Should | S |
| **Eligibility countdown and reminder** | "You can donate again from 12 March", and a message that day if you want one | Turns a deferral into a return visit | Should | S |
| **Nearby camps** | Upcoming camps within your areas | A gentle way in for new donors | Could | S |
| **Your impact** | Donations made, requests helped, a yearly certificate | Recognition helps retention. No leaderboards: they pressure people | Could | S |
| **Your data** | Download your data, withdraw consent, delete your account | #18 | Must before launch | M |
| **Saved searches** (any user) | Save a search and get told when that group appears within your area | Useful to families during a long hospital stay | Could | M |

---

## Optional: a health-official view

A read-only role for district or state health staff, granted by an admin after verification. Stretch work, but worth a slide because it shows where the project could go.
- Stock by group and district from the saved copy, and which banks haven't updated eRaktKosh lately.
- Camps planned against districts running low.
- Aggregates only: no donor or patient data, and no cell smaller than 5 people.

---

## Who can do what

| Action | Donor / user | Org viewer | Org staff | Org manager | Org owner | Admin reviewer | Data steward | Super admin |
|---|---|---|---|---|---|---|---|---|
| Search, see public stock | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Join the donor network, respond to requests | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| See own organization's board and history | | ✓ | ✓ | ✓ | ✓ | | | ✓ |
| Raise a routine or urgent request | | | ✓ | ✓ | ✓ | | | |
| Raise a critical request, escalate to donors | | | | ✓ | ✓ | | | |
| Bank: status notes, check-in, confirm donations | | | ✓ | ✓ | ✓ | | | |
| Bank: appeals, confirm location | | | | ✓ | ✓ | | | |
| See an accepted donor's phone number | | | ✓ | ✓ | ✓ | | | |
| Invite or remove members | | | | | ✓ | | | ✓ |
| Review organizations | | | | | | ✓ | | ✓ |
| Review locations and duplicates | | | | | | | ✓ | ✓ |
| Suspend users, handle reports and privacy requests | | | | | | | | ✓ (or `support`) |
| Grant admin roles | | | | | | | | ✓ |

Admins see no donor health answers, as today: `donor_screening` stays owner-only.

---

## Data model additions

Sketches only; each becomes a migration with explicit grants, row-level security and CHECK constraints mirrored in a JS validator, as `CLAUDE.md` requires.

```sql
create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  member_role text not null check (member_role in ('owner', 'manager', 'staff', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'removed')),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

-- True when the caller is an active member with at least p_min_role.
create function public.is_org_member(p_org uuid, p_min_role text default 'viewer')
returns boolean language sql stable security definer set search_path = '' as $$ ... $$;

alter table public.organizations
  add column latitude double precision,
  add column longitude double precision,
  add column location_confirmed_at timestamptz,
  add column hours jsonb,               -- {"mon": [["09:00","17:00"]], ...} or {"24x7": true}
  add column services text[],           -- 'component_separation', 'apheresis', 'irradiation'
  add column eraktkosh_verified_at timestamptz,
  add column licence_valid_until date;

create table public.bank_notes (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('on_hold', 'closed', 'call_first', 'apheresis_today', 'other')),
  text text check (char_length(text) <= 200),
  expires_at timestamptz not null,      -- at most 72 hours ahead, enforced by a trigger
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null,
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.privacy_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('export', 'delete')),
  status text not null default 'open' check (status in ('open', 'done', 'refused')),
  due_at timestamptz not null,
  handled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
```

- **`profiles.role` stays** for the proxy's quick routing, but membership decides permissions. Approving an organization adds the applicant as `owner`; `review_organization()` gains that step.
- **Reservations, requests and donations** belong to the donor-network migration (`plan_donor_network.md`), so the two plans share one request model.

---

## Roadmap

| Phase | Contents | Unlocks | Rough size |
|---|---|---|---|
| **A · Foundation** | F1 members, F2 organization profile, F3 eRaktKosh link, F4 shell, admin evidence panel and conflict warnings | Real organizations with teams | 1.5 weeks |
| **B · Banks see themselves** | "How bloodLink sees you", confirm location, status notes, location review queue, suspend a user, audit search | Better data from the source | 1 week |
| **C · Hospitals act** | Request composer, request board, call script, F5 notifications | The ranked search becomes a workflow | 1.5 weeks |
| **D · Donor network** | Join, availability, areas, inbox, appeals, check-in, escalation, abuse reports, open-critical view (`plan_donor_network.md`) | The peer-to-peer feature | 3 to 4 weeks |
| **E · Closing the loop** | Reservations between hospitals and banks, donation history, reminders, collector alerts, privacy requests, F6 two-factor | Fewer phone calls; launch readiness | 2 weeks |
| **F · Insight** | Stock history, low-stock watch, forecast, chronic care, reports, health-official view | The forecasting work pays off | Open-ended |

**For the project report,** phases A to C are a credible "completed" set for the next review; D is the headline feature; E and F are "planned".

---

## What not to build, and why

| Idea | Why not |
|---|---|
| Stock entry in bloodLink | P1. Double entry and conflicting numbers |
| Payments of any kind, including "processing fees" between families and banks | Selling blood is illegal in India, and anything involving money invites the scams the donor network must keep out. Banks' processing charges stay between the bank and the patient |
| Patient medical records or names | P4. A hospital reference number is enough |
| A public donor directory or map of donors | Exposes donors to harassment. Banks see aggregated counts only, at 1 km cells with at least 5 donors |
| Leaderboards | Pressure people to donate more often than is safe |
| A native mobile app first | `CLAUDE.md` already says PWA first: web push and an installable page cover the need |

---

## Testing

- **Row-level security per role:** for each table, a signed-in user of each role tries to read and write what the matrix above says they can't, and gets 42501. Run against a local Supabase (`supabase start`), never production (#20).
- **Functions:** `is_org_member`, the extended `review_organization`, and every new `security definer` function, with the same refusals tested (wrong role, wrong organization, suspended user).
- **Unit tests** for each new validator (organization profile, notes, request composer input), mirroring the CHECK constraints, as `src/lib/organization.js` does today.
- **End to end** (Playwright, once #20's suite exists): apply, verify, invite a teammate, raise a request, see it on the board, a bank confirms a location.

---

## Open questions

1. Should a person be able to belong to more than one organization (a doctor at two hospitals)? The members table allows it; the panel shell would need an organization switcher.
2. Who verifies a hospital's identity in practice: the licence number alone, a call to the hospital's published number, or both?
3. Should hospitals without a verified account be able to raise requests at all, with lower trust? The donor-network plan recommends no for the pilot.
4. Which one bank and one hospital would pilot this? Their workflow should shape phases B and C more than this list does.
