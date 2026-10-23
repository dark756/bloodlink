-- bloodLink: banks placed in the wrong state
-- eRaktKosh's nearest call puts some banks far outside their own state; on
-- 2026-10-24, banks from Punjab, Kerala, Tamil Nadu and Assam sat in central
-- Delhi. scripts/snapshot.mjs now flags them 'wrong_state', using the state
-- outlines in assets/state_boundaries.json (src/lib/stateBounds.js). Like banks
-- placed outside India, they get no PostGIS point.

alter table public.blood_banks
  drop constraint blood_banks_location_quality_check;
alter table public.blood_banks
  add constraint blood_banks_location_quality_check
  check (location_quality in ('ok', 'shared', 'wrong_state', 'outside_india', 'missing'));

-- A generated column's expression can't be changed in place, so the column and
-- its index are rebuilt. The column grants are table-wide, so they still apply.
alter table public.blood_banks drop column location;
alter table public.blood_banks
  add column location extensions.geography(Point, 4326)
  generated always as (
    case
      when latitude is null or longitude is null
        or location_quality in ('outside_india', 'wrong_state') then null
      else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
    end
  ) stored;

create index blood_banks_location_gist on public.blood_banks using gist (location);
