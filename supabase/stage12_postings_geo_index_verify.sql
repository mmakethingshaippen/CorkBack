-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- VERIFY for stage12_postings_geo_index.sql. Read-only: it only reads the system
-- catalogs and changes nothing. Run it AFTER the migration (and after a
-- `create index concurrently` build, which can leave an invalid index).
--
-- Checks that postings_active_geo_idx exists, is valid and ready, is a btree on
-- (lat, lng), and that its condition matches the map query filters for deleted
-- and moderation-hidden postings and does not contain expires_at.
-- It raises an error at the first failed check; on success the last row says
-- 'stage12 verify: all checks passed'.
do $$
declare
  def text;
  pred text;
  valid boolean;
  ready boolean;
begin
  if to_regclass('public.postings_active_geo_idx') is null then
    raise exception 'verify failed: postings_active_geo_idx does not exist';
  end if;

  select i.indisvalid, i.indisready, pg_get_expr(i.indpred, i.indrelid), pg_get_indexdef(i.indexrelid)
    into valid, ready, pred, def
    from pg_index i
   where i.indexrelid = to_regclass('public.postings_active_geo_idx');

  if not valid then raise exception 'verify failed: index is INVALID (drop it with the rollback script and rebuild)'; end if;
  if not ready then raise exception 'verify failed: index is not ready'; end if;
  if def not like '%USING btree (lat, lng)%' then
    raise exception 'verify failed: index is not a btree on (lat, lng): %', def;
  end if;
  if pred is null then raise exception 'verify failed: index has no condition (should be partial)'; end if;
  if pred not like '%deleted_at IS NULL%' then
    raise exception 'verify failed: condition lacks deleted_at IS NULL: %', pred;
  end if;
  if pred not like '%moderation_hidden_at IS NULL%' then
    raise exception 'verify failed: condition lacks moderation_hidden_at IS NULL: %', pred;
  end if;
  if pred like '%expires_at%' then
    raise exception 'verify failed: condition must not mention expires_at: %', pred;
  end if;
  if (select count(*) from pg_indexes
       where schemaname = 'public' and tablename = 'postings' and indexname = 'postings_active_geo_idx') <> 1 then
    raise exception 'verify failed: expected exactly one postings_active_geo_idx';
  end if;
end $$;

select 'stage12 verify: all checks passed' as result;

-- For review: the index as stored.
select pg_get_indexdef(indexrelid) as index_definition,
       indisvalid as valid,
       pg_get_expr(indpred, indrelid) as condition
from pg_index
where indexrelid = to_regclass('public.postings_active_geo_idx');
