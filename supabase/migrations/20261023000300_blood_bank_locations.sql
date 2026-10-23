-- bloodLink blood bank locations
-- A PostGIS point for every directory bank with a usable position, with a GiST
-- index, so radius searches can run in the database. Used by the geospatial
-- benchmark (scripts/benchmark-geo.mjs, report 3 point 4) and the base for
-- donor locations later.
--
-- The column is generated from latitude and longitude, so the collector
-- (scripts/snapshot.mjs) keeps writing those two and never this one.
-- Banks flagged outside India get no point.

create extension if not exists postgis with schema extensions;

alter table public.blood_banks
  add column location extensions.geography(Point, 4326)
  generated always as (
    case
      when latitude is null or longitude is null or location_quality = 'outside_india' then null
      else extensions.st_setsrid(extensions.st_makepoint(longitude, latitude), 4326)::extensions.geography
    end
  ) stored;

create index blood_banks_location_gist on public.blood_banks using gist (location);
