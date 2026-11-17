-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 15 (shared anonymous geocoder rate limit) - PREFLIGHT (run BEFORE the migration)
--
-- Spec: .kiro/specs/posting-location-confirmation (Requirement 24; also 16, 21).
--
-- Read-only: one SELECT inside a READ ONLY transaction. It changes no row, table
-- or function. Save the output. Stage 15 is ADDITIVE to stage 14: it adds the shared
-- anonymous rate limit and touches no stage 14 object.
--
-- Run order (owner, after review; stage 14 must already be applied):
--   1. this file                                                read-only, BEFORE; save the output
--   2. supabase/stage15_geocoder_anon_limit.sql                 the migration
--   3. supabase/stage15_geocoder_anon_limit_verify.sql          AFTER; ALL CHECKS PASS (rolls itself back)
--   (supabase/stage15_geocoder_anon_limit_rollback.sql undoes step 2; run it only after the code is rolled back)
--
-- What it reports:
--   dependency   the roles the migration needs, and that every STAGE 14 object is present
--                (a 'false' here = stop; the migration refuses to start too). Stage 15
--                is additive to stage 14 and must not run on a database without it.
--   stage14      an md5 inventory of every stage 14 object the migration must leave
--                unchanged (the column, the five functions/tables and their privileges).
--                The migration recomputes this md5 at its end and refuses to finish when
--                it differs; the verify compares it again. Save the 'stage14 inventory md5'.
--   target       whether any stage 15 object already exists. Expected: every row 'false'.
--                If one is 'true' the migration is partly applied or was applied before:
--                it is written to be re-runnable, but read the rows before you run it.
--
-- Expected on a database where stage 14 is applied and stage 15 is not:
--   dependency rows all 'true'; target rows all 'false'.

begin transaction read only;

with
dep as (
  select 'dependency'::text as section, 'role ' || r.name as item, exists (select 1 from pg_roles where rolname = r.name)::text as detail
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
  union all
  select 'dependency', 'stage 14 column postings.location_precision',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision')::text
  union all
  select 'dependency', 'stage 14 function ' || f.sig, (to_regprocedure(f.sig) is not null)::text
  from (values ('public.cb_update_posting_location(uuid,double precision,double precision,text,text)'),
               ('public.cb_geocoder_take_slot(integer)'),
               ('public.cb_geocoder_purge_cache()')) as f(sig)
  union all
  select 'dependency', 'stage 14 table ' || t.name, (to_regclass('public.' || t.name) is not null)::text
  from (values ('cb_geocoder_throttle'), ('cb_geocoder_cache')) as t(name)
),
-- An md5 over the stage 14 objects' signatures and privileges. The migration recomputes
-- the same value and refuses to finish when it differs (additive = stage 14 unchanged).
s14 as (
  select 'stage14'::text, 'stage14 inventory md5',
    md5(
      coalesce((select pg_get_constraintdef(oid) from pg_constraint
                where conname = 'postings_location_precision_check' and conrelid = 'public.postings'::regclass), 'none') || '|'
      || coalesce((select c.data_type || ':' || c.is_nullable || ':' || c.column_default
                   from information_schema.columns c
                   where c.table_schema = 'public' and c.table_name = 'postings' and c.column_name = 'location_precision'), 'none') || '|'
      || coalesce((select string_agg(
            p.oid::regprocedure::text || ':' || p.prosecdef::text || ':' || pg_get_function_result(p.oid)
              || ':auth=' || has_function_privilege('authenticated', p.oid, 'execute')::text
              || ':anon=' || has_function_privilege('anon', p.oid, 'execute')::text
              || ':svc=' || has_function_privilege('service_role', p.oid, 'execute')::text,
            '|' order by p.oid::regprocedure::text)
          from pg_proc p
          where p.oid in (
            to_regprocedure('public.cb_update_posting_location(uuid,double precision,double precision,text,text)'),
            to_regprocedure('public.cb_geocoder_take_slot(integer)'),
            to_regprocedure('public.cb_geocoder_purge_cache()'))), 'none') || '|'
      || coalesce((select string_agg(
            c.relname || ':rls=' || c.relrowsecurity::text
              || ':pol=' || (select count(*)::text from pg_policies pp where pp.schemaname = 'public' and pp.tablename = c.relname)
              || ':anon=' || has_table_privilege('anon', c.oid, 'select,insert,update,delete')::text
              || ':auth=' || has_table_privilege('authenticated', c.oid, 'select,insert,update,delete')::text
              || ':svc=' || has_table_privilege('service_role', c.oid, 'select,insert,update,delete')::text,
            '|' order by c.relname)
          from pg_class c
          where c.oid in (to_regclass('public.cb_geocoder_throttle'), to_regclass('public.cb_geocoder_cache'))), 'none')
    )
),
target as (
  select 'target'::text, 'table cb_geocoder_anon_limit exists', (to_regclass('public.cb_geocoder_anon_limit') is not null)::text
  union all
  select 'target', 'function ' || f.sig || ' exists', (to_regprocedure(f.sig) is not null)::text
  from (values ('public.cb_geocoder_take_anon_slot(text,integer,integer)'),
               ('public.cb_geocoder_purge_anon_limit()')) as f(sig)
)
select * from dep
union all select * from s14
union all select * from target
order by 1, 2;

rollback;
