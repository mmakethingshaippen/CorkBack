-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- stage12: optional geographic index for the map read.
--
-- Creates exactly one index, postings_active_geo_idx, a partial btree on
-- public.postings (lat, lng) limited to rows that are neither deleted nor
-- moderation-hidden. The app works the same with or without it (same rows, same
-- order, same truncated value); the index only helps the lat/lng range filter as
-- the table grows. No row is inserted, updated or deleted. Safe to run twice:
-- the second run finds the index and changes nothing.
--
-- What the map query does (src/lib/mapQuery.ts): it filters lat and lng ranges,
-- deleted_at is null, moderation_hidden_at is null and expires_at > now(), then
-- orders by is_promoted, created_at, id. A plain (lat, lng) partial btree is the
-- design's choice. It serves the deleted/hidden filters and the lat range; the
-- lng range, expiry and ordering are applied on the rows it returns.
--
-- expires_at > now() is deliberately NOT in the predicate: now() is not
-- immutable, so Postgres does not allow it in an index condition.
--
-- LARGE TABLE: create index takes a lock that blocks writes to postings while it
-- builds. On a large table consider `create index concurrently if not exists ...`
-- instead, run OUTSIDE a transaction (it cannot run inside begin/commit), then run
-- stage12_postings_geo_index_verify.sql to confirm the index is valid.
-- If a concurrent build fails it leaves an INVALID index: drop it with the
-- rollback script and run again.
--
-- Run stage12_postings_geo_index_preflight.sql first.
begin;

create index if not exists postings_active_geo_idx
  on public.postings (lat, lng)
  where deleted_at is null and moderation_hidden_at is null;

do $$
declare
  def text;
  n int;
begin
  select count(*) into n from pg_indexes
   where schemaname = 'public' and tablename = 'postings' and indexname = 'postings_active_geo_idx';
  if n <> 1 then
    raise exception 'stage12 assert failed: expected exactly one postings_active_geo_idx, found %', n;
  end if;

  -- An index of the same name but a different shape would be silently kept by
  -- "if not exists", so check the definition.
  select pg_get_indexdef(indexrelid) into def
    from pg_index where indexrelid = to_regclass('public.postings_active_geo_idx');
  if def not like '%USING btree (lat, lng)%'
     or def not like '%deleted_at IS NULL%'
     or def not like '%moderation_hidden_at IS NULL%'
     or def like '%expires_at%' then
    raise exception 'stage12 assert failed: existing postings_active_geo_idx has a different definition: %', def;
  end if;
end $$;

commit;
