-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 15 - Shared anonymous geocoder rate limit - ROLLBACK
-- Spec: .kiro/specs/posting-location-confirmation (Requirements 16.2, 16.3, 24.2).
--
-- Drops ONLY what stage15_geocoder_anon_limit.sql created:
--   - function public.cb_geocoder_take_anon_slot(text, integer, integer)
--   - function public.cb_geocoder_purge_anon_limit(integer)
--   - table    public.cb_geocoder_anon_limit (its primary key and check go with it)
-- Nothing else is touched: no stage 14 object, no other table, policy, trigger, function
-- or privilege.
--
-- SAFE ORDER (important): roll the CODE back first, then run this file.
--   The new code calls cb_geocoder_take_anon_slot for anonymous place search and fails
--   closed (HTTP 503) when it is missing. If this file runs while the new code is still
--   deployed, anonymous place search answers 503. Old code never calls it, so old code on
--   the rolled-back database is fine. Order: 1. redeploy the old code, 2. run this file.
--
-- WHAT IS LOST (cannot be recovered afterwards): the cb_geocoder_anon_limit rows (a
--   transient count of anonymous place searches per hashed client id within the current
--   window; the next search simply starts a fresh window). No posting, reply, like,
--   message or anything a user typed is affected. No stage 14 object is affected.
--
-- Proof inside this file: before any change it records an md5 inventory of every stage 14
-- object (the same value stage15_geocoder_anon_limit_preflight.sql prints). After the
-- drops it recomputes that md5 and raises (rolling the whole transaction back) on any
-- difference, and asserts that every stage 15 object is gone.
--
-- Safe to run twice: every drop is "if exists". One transaction: any error leaves nothing
-- changed.
--
-- Caution: if any of these stage 15 objects existed BEFORE stage 15 (the preflight expects
-- them all absent and the migration creates them), this file would drop them too. Do not
-- run it in that case.

begin;

-- 0. Snapshot the stage 14 inventory, so the end can prove stage 14 is untouched.
do $$
begin
  perform set_config('cb.s15r_s14',
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
    ), true);
end $$;

-- 1. Drop the stage 15 objects (functions first, then the table; no dependency between
--    them, this order is just tidy).
drop function if exists public.cb_geocoder_take_anon_slot(text, integer, integer);
drop function if exists public.cb_geocoder_purge_anon_limit(integer);
drop table if exists public.cb_geocoder_anon_limit;

-- 2. Assertions on the ACTUAL resulting state. Any failure raises and rolls everything back.
do $$
begin
  -- Every stage 15 object is gone.
  if to_regclass('public.cb_geocoder_anon_limit') is not null then
    raise exception 'stage15 rollback assertion: cb_geocoder_anon_limit still exists';
  end if;
  if exists (select 1 from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('cb_geocoder_take_anon_slot', 'cb_geocoder_purge_anon_limit')) then
    raise exception 'stage15 rollback assertion: a stage 15 function still exists';
  end if;

  -- Stage 14 is unchanged: recompute the inventory md5 and compare with the snapshot.
  if md5(
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
    ) is distinct from current_setting('cb.s15r_s14') then
    raise exception 'stage15 rollback assertion: a stage 14 object changed';
  end if;
end $$;

commit;

-- Check (read-only). Expect 0, 0 and the stage 14 objects still present.
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace
          and relname = 'cb_geocoder_anon_limit') as anon_limit_tables,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('cb_geocoder_take_anon_slot', 'cb_geocoder_purge_anon_limit')) as functions,
       (to_regprocedure('public.cb_geocoder_take_slot(integer)') is not null) as stage14_take_slot_present,
       (to_regclass('public.cb_geocoder_cache') is not null) as stage14_cache_present;
