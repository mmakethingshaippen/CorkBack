-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- READ-ONLY preflight for stage12_postings_geo_index.sql (optional partial index
-- postings_active_geo_idx on public.postings (lat, lng)). Changes nothing; run
-- it in the Supabase SQL editor and read every row.
--
-- Expected before the migration: index ABSENT, lat and lng both 'double precision'.
-- Expected after the migration: index present, valid, with the two-condition predicate.

select 'postings row count' as item,
       (select count(*)::text from public.postings) as detail
union all
select 'postings_active_geo_idx',
       coalesce((select pg_get_indexdef(i.indexrelid)
                        || ' | valid=' || i.indisvalid || ' | ready=' || i.indisready
                 from pg_index i
                 where i.indexrelid = to_regclass('public.postings_active_geo_idx')), 'ABSENT')
union all
select 'column type: ' || c.column_name,
       c.data_type || ' | nullable=' || c.is_nullable
from information_schema.columns c
where c.table_schema = 'public' and c.table_name = 'postings' and c.column_name in ('lat', 'lng')
union all
select 'column moderation_hidden_at (must exist, from stage 8)',
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'postings' and column_name = 'moderation_hidden_at'), 'ABSENT')
union all
select 'column deleted_at (must exist)',
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'postings' and column_name = 'deleted_at'), 'ABSENT')
union all
select 'existing index on postings: ' || indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'postings';
