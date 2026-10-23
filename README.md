# bloodLink

bloodLink finds blood in an emergency. It searches live blood stock at Indian blood banks through the government eRaktKosh API and ranks the nearby banks for a request. It also splits the request across banks in a response plan. Hospitals and blood banks can register, and admins verify them.

It is a final-year B.Tech project, built with Next.js 16 (App Router, JavaScript), React 19, Tailwind CSS 4 and Supabase (Postgres and Auth). It also uses Leaflet, OSRM and Open-Meteo.

## Features

- **Region search** by state and district.
- **Location search.** Search rings widen to suit the area: 5 to 25 km in cities, 20 to 150 km in rural areas.
- **Ranked emergency search.**
  - Only banks with the exact blood group count.
  - Each bank is scored on road travel time, how much of the request it covers, spare stock, and how recently it updated its stock. The weights depend on urgency.
  - Travel time allows for time of day, area density, season and rain.
- **Works when eRaktKosh fails.** The app uses a cache, retries and a circuit breaker, then falls back to a saved copy in Supabase. A scheduled collector refreshes that copy every hour.
- **Accounts.** Sign in with Google or email, keep a profile with donor eligibility, and apply to register an organisation. Admins review applications.

Results are informational. Blood banks do the screening and cross-matching.

## Getting started

```bash
npm install
npm run db:migrate   # apply supabase/migrations/*.sql
npm run dev          # http://localhost:3000
```

Put these variables in `.env.local`:

| Variable | Needed for |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The app |
| `SUPABASE_DB_URL` | Scripts only: migrations and the collector. Never use it in app code. |
| `NEXT_PUBLIC_CARTO_API_KEY` | Map tiles |
| `OSRM_URL` (optional) | Your own OSRM server. The default is the public demo server. |

## Checks

```bash
npm run lint
npm run format:check
npm test
npm run build
```

## Layout

| Folder | Contents |
|---|---|
| `src/app/` | Pages and API routes |
| `src/lib/` | Shared modules: the eRaktKosh client, ranking, travel time, routing, validation |
| `supabase/migrations/` | Database schema |
| `scripts/` | Migrations, the stock collector (`snapshot.mjs`) and measurement scripts |
| `tests/` | Vitest unit tests |

## Data sources

eRaktKosh (Ministry of Health and Family Welfare), OpenStreetMap through OSRM, the TomTom Traffic Index, and Open-Meteo.
