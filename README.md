# bloodLink

**bloodLink finds blood in an emergency: it reads live stock from India's government eRaktKosh API, ranks nearby blood banks by road travel time, coverage and spare stock, and splits a request across banks in a response plan.**

A final-year B.Tech project on Next.js 16, React 19, Tailwind CSS 4 and Supabase (Postgres 17 and Auth). Hospitals and blood banks register, and admins verify them. Results are informational: blood banks do the screening and cross-matching.

## Architecture

```
eRaktKosh API ──► cache ► retry ► circuit breaker ──► Next.js API routes ──► ranking ──► search page
      │                                     │                  ▲                ▲
      │                                     ▼                  │                │
      │                           saved copy (Supabase)        │       OSRM + TomTom profiles + Open-Meteo
      │                                     ▲                  │         (road time, congestion, rain)
      └──► collect-stock Edge Function ─────┘ (every 4.5 h, archived in Storage)
                                            │
                    stock history ──► score-stock Edge Function ──► stock-out forecast
                                      (logistic regression, every 6 h)   (mark and ranking factor)
```

| Part | What it does |
|---|---|
| `src/lib/eraktkosh.js` | eRaktKosh client: validation, 5-minute cache, retries, per-state and service-wide circuit breakers, 8 s give-up, fallback to the saved copy |
| `src/lib/ranking.js` | Scores each bank on ETA, coverage, surplus and freshness, with weights set by urgency; builds the response plan |
| `src/lib/trafficModel.js` | ETA = free-flow time × (1 + congestion) × rain factor, from OSRM routes, TomTom Traffic Index profiles and Open-Meteo rain |
| `supabase/functions/collect-stock` | The cloud collector: validates, stores changed stock, archives every change |
| `supabase/functions/score-stock`, `ml/` | The stock-out forecast: 19 inputs, logistic regression trained in Python, applied in JavaScript |
| `/admin` | Verification queue, user roles, stock-out events, bank locations, audit log |

## Hardware constraints

No GPU is needed, and nothing in the stack depends on one. bloodLink is built to run on free tiers and one laptop:

- **Hosting:** the Supabase free plan (500 MB database, 1 GB storage). Edge Functions get 2 s of CPU and 256 MB of memory, so the collector and the forecast scorer run in small batches (the directory's state check costs about 0.1 s of CPU).
- **Routing:** the public OSRM demo server, held to one request a second, with a 24-hour cache and a straight-line fallback (× 1.34).
- **Forecast:** a logistic regression. Training takes about a minute on a laptop CPU, and scoring is a dot product in the Edge Function.
- **Search:** one eRaktKosh call, one OSRM table call and one rain call per request, with each state's stock fetched once and cached.

## Results

| Area | Result |
|---|---|
| Data | 4,707 banks with stock in all 36 states, 4,328 with coordinates, collected every 4.5 hours since 3 November 2026. 30 implausible unit counts dropped, 1,694 blood-group labels standardised to 10 names |
| Location search | 4,004 of 4,756 stocked banks visible, up from 3,864, after 140 corrected bank positions |
| Ranking | First choice unchanged in 92% to 98% of ±20% weight changes (Kendall's τ about 0.98) |
| ETA | 24.9% off Google's traffic-aware times, the closest of four methods, on 3,360 trips; 65.0 of 100 on the benchmark rubric. OSRM p95 217 ms, 200 of 200 calls answered |
| Spatial search | A linear scan takes about 0.1 ms on 4,328 banks; an index (k-d tree, R-tree, PostGIS GiST) is 75 to 300 times faster at 100,000 points and more |
| Load | 20 users at once: 0 of 560 requests failed |
| Failures | Every eRaktKosh failure mode (down, slow, flaky, one failing state) re-run on a production build, with the saved copy serving |
| Forecast | Logistic regression predicting a fall to 2 units or fewer: PR-AUC 0.348 at 48 h, walking forward |
| Tests | 254 unit tests (Vitest), 16 Python tests, 46 for the ETA benchmark |

## How to run it

1. **Install:** `npm install`
2. **Configure:** copy `.env.example` to `.env.local` and fill it in (see below), then `npm run db:migrate`
3. **Start:** `npm run dev`, then open http://localhost:3000

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The app |
| `SUPABASE_DB_URL` | Scripts only: migrations, the collector and its cloud setup. Never use it in app code. |
| `SUPABASE_SECRET_KEY` | Scripts only: the private `stock-archive` bucket. Never use it in app code. |
| `NEXT_PUBLIC_CARTO_API_KEY` | Map tiles |
| `OSRM_URL` (optional) | Your own OSRM server. The default is the public demo server. |

Checks: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`. To run the forecast's Python side, use a virtual environment: `pip install -r ml/requirements.txt`, then `python -I ml/train.py <archive> --until <ISO time>`.

## Features

- **Region search** by state and district.
- **Location search.** Rings widen to suit the area: 5 to 25 km in cities, 20 to 150 km in rural areas.
- **Ranked emergency search.** Only banks with the exact blood group count. Travel time allows for time of day, area density, season and rain.
- **Works when eRaktKosh fails.** A cache, retries and a circuit breaker, then a saved copy in Supabase.
- **Accounts.** Google or email sign-in, a profile with donor eligibility (NBTC 2017 guidelines), and organisation applications reviewed by admins.
- **Stock-out forecast.** Banks that may run low within 48 hours are marked, and eligible donors within 15 km are told.

## Layout

| Folder | Contents |
|---|---|
| `src/app/` | Pages and API routes |
| `src/lib/` | The eRaktKosh client, ranking, travel time, routing, validation, forecast |
| `supabase/` | Migrations and the Edge Functions |
| `ml/` | The forecast's Python side: dataset builder, training, exported model and model cards |
| `scripts/` | Migrations, the laptop collector, cloud setup, archive and measurement scripts |
| `tests/` | Vitest unit tests |
| `docs/` | Local project notes: deliverables, the data-integrity check, the code reference and the dated fact check. Markdown other than this file isn't tracked. |

## Data sources

eRaktKosh (Ministry of Health and Family Welfare), OpenStreetMap through OSRM, the TomTom Traffic Index, and Open-Meteo.
