-- bloodLink: let the collector's prune run
-- prune_stock_store() runs with the caller's rights, and scripts/snapshot.mjs calls
-- it as bloodlink_ingest. Deleting call-log rows older than p_call_days reads
-- called_at in the WHERE clause, which needs SELECT on that column, but the role
-- had only INSERT and DELETE on upstream_calls. Every prune therefore failed with
-- 42501 and nothing was trimmed (#56). The grant covers that one column, so the
-- role still can't read what the calls returned.

grant select (called_at) on public.upstream_calls to bloodlink_ingest;
