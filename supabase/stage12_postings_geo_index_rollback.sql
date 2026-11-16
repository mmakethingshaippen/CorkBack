-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- ROLLBACK for stage12_postings_geo_index.sql. Drops the optional index only.
-- No row is changed. Safe when the index is absent (no error) and safe to run
-- twice. The app keeps working without the index (same results, same order).
--
-- On a large table, `drop index concurrently if exists public.postings_active_geo_idx;`
-- run outside a transaction avoids blocking writes while it drops.
begin;

drop index if exists public.postings_active_geo_idx;

do $$
begin
  if to_regclass('public.postings_active_geo_idx') is not null then
    raise exception 'rollback assert failed: postings_active_geo_idx still exists';
  end if;
end $$;

commit;
