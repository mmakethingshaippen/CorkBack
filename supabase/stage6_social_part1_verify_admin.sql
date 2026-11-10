-- CorkBack - Stage 6 part 1 - VERIFY (ADMIN) - run AFTER the migration
--
-- Admin-role checks only: catalog state and function results, evaluated as the
-- SQL editor role. Read-only: no inserts, updates, deletes, and no role
-- switching. Application-role behavior is tested separately in
-- stage6_social_part1_verify_roles.sql.
--
-- Result: one table. pass = true (ok), false (stop and report), null (info only).

with checks(n, check_name, expected, actual) as (
  values
  -- A1 structure ---------------------------------------------------------------
  (1, 'A1 postings has time_zone, end_date, end_time', '3',
   (select count(*)::text from information_schema.columns
    where table_schema = 'public' and table_name = 'postings'
      and column_name in ('time_zone', 'end_date', 'end_time'))),

  (2, 'A2 end-date check constraint exists', '1',
   (select count(*)::text from pg_constraint
    where conrelid = 'public.postings'::regclass and conname = 'postings_end_not_before_start')),

  -- A3 policies ----------------------------------------------------------------
  (3, 'A3 likes/plans/connections policies are exactly the reviewed set',
   'connections: connections party read | likes: likes owner read | likes: likes self delete active | '
   || 'likes: likes self insert active | plans: plans owner read | plans: plans self delete active | '
   || 'plans: plans self insert active | plans: plans self update active',
   (select string_agg(tablename || ': ' || policyname, ' | '
                      order by tablename collate "C", policyname collate "C")
    from pg_policies
    where schemaname = 'public' and tablename in ('likes', 'plans', 'connections'))),

  (4, 'A4 no likes/plans policy applies to anon or public', '0',
   (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename in ('likes', 'plans')
      and roles && array['public', 'anon']::name[])),

  (5, 'A5 no restrictive or permissive-true policies on likes/plans/connections', '0',
   (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename in ('likes', 'plans', 'connections')
      and (permissive = 'RESTRICTIVE' or coalesce(qual, '') ~* '^\(?\s*true\s*\)?$'))),

  (6, 'A6 RLS enabled', 'connections=true,likes=true,plans=true,postings=true',
   (select string_agg(relname || '=' || relrowsecurity, ',' order by relname collate "C")
    from pg_class
    where relnamespace = 'public'::regnamespace
      and relname in ('likes', 'plans', 'connections', 'postings'))),

  (7, 'A7 one like / one plan per user per posting (primary keys)', 'likes.likes_pkey,plans.plans_pkey',
   (select string_agg(cl.relname || '.' || con.conname, ',' order by cl.relname collate "C")
    from pg_constraint con
    join pg_class cl on cl.oid = con.conrelid
    where cl.relnamespace = 'public'::regnamespace
      and cl.relname in ('likes', 'plans')
      and con.contype = 'p'
      and (select array_agg(a.attname::text order by a.attname)
           from pg_attribute a
           where a.attrelid = con.conrelid and a.attnum = any (con.conkey))
          = array['posting_id', 'user_id'])),

  -- A8 functions and grants ------------------------------------------------------
  (8, 'A8 functions exist; only posting_reaction_counts is security definer',
   'cb_safe_time_zone=false,posting_is_active=false,posting_reaction_counts=true,posting_takedown_at=false',
   (select string_agg(proname || '=' || prosecdef, ',' order by proname collate "C")
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('cb_safe_time_zone', 'posting_takedown_at', 'posting_is_active',
                      'posting_reaction_counts'))),

  (9, 'A9 anon may execute all four functions', 'true,true,true,true',
   has_function_privilege('anon', 'public.cb_safe_time_zone(text)', 'execute') || ',' ||
   has_function_privilege('anon', 'public.posting_takedown_at(timestamptz,date,date,time,text)', 'execute') || ',' ||
   has_function_privilege('anon', 'public.posting_is_active(uuid)', 'execute') || ',' ||
   has_function_privilege('anon', 'public.posting_reaction_counts(uuid[])', 'execute')),

  (10, 'A10 authenticated may execute all four functions', 'true,true,true,true',
   has_function_privilege('authenticated', 'public.cb_safe_time_zone(text)', 'execute') || ',' ||
   has_function_privilege('authenticated', 'public.posting_takedown_at(timestamptz,date,date,time,text)', 'execute') || ',' ||
   has_function_privilege('authenticated', 'public.posting_is_active(uuid)', 'execute') || ',' ||
   has_function_privilege('authenticated', 'public.posting_reaction_counts(uuid[])', 'execute')),

  (11, 'A11 anon and authenticated can SELECT postings (needed by posting_is_active)', 'true,true',
   has_table_privilege('anon', 'public.postings', 'SELECT') || ',' ||
   has_table_privilege('authenticated', 'public.postings', 'SELECT')),

  (12, 'A12 authenticated has the table privileges the app needs (likes s/i/d, plans s/i/u/d)',
   'true,true,true,true,true,true,true',
   has_table_privilege('authenticated', 'public.likes', 'SELECT') || ',' ||
   has_table_privilege('authenticated', 'public.likes', 'INSERT') || ',' ||
   has_table_privilege('authenticated', 'public.likes', 'DELETE') || ',' ||
   has_table_privilege('authenticated', 'public.plans', 'SELECT') || ',' ||
   has_table_privilege('authenticated', 'public.plans', 'INSERT') || ',' ||
   has_table_privilege('authenticated', 'public.plans', 'UPDATE') || ',' ||
   has_table_privilege('authenticated', 'public.plans', 'DELETE')),

  -- A13-A20 lifecycle: same cases and values as src/lib/lifecycle.test.ts -------
  (13, 'A13 event day ends at local midnight (America/Los_Angeles)', '2026-11-17 07:59:59.999',
   (public.posting_takedown_at('2099-01-01', '2026-11-16', null, null, 'America/Los_Angeles') at time zone 'UTC')::text),
  (14, 'A14 daylight saving day (2026-03-08, Los Angeles)', '2026-03-09 06:59:59.999',
   (public.posting_takedown_at('2099-01-01', '2026-03-08', null, null, 'America/Los_Angeles') at time zone 'UTC')::text),
  (15, 'A15 no stored zone falls back to UTC-12', '2026-11-17 11:59:59.999',
   (public.posting_takedown_at('2099-01-01', '2026-11-16', null, null, null) at time zone 'UTC')::text),
  (16, 'A16 invalid zone falls back to UTC-12', '2026-11-17 11:59:59.999',
   (public.posting_takedown_at('2099-01-01', '2026-11-16', null, null, 'Not/AZone') at time zone 'UTC')::text),
  (17, 'A17 malformed zone strings are rejected like the app (5, +05, empty, spaces)',
   'Etc/GMT+12,Etc/GMT+12,Etc/GMT+12,Etc/GMT+12,Etc/GMT+12',
   public.cb_safe_time_zone('5') || ',' || public.cb_safe_time_zone('+05') || ',' ||
   public.cb_safe_time_zone('') || ',' || public.cb_safe_time_zone(' America/Los_Angeles') || ',' ||
   public.cb_safe_time_zone('America/Los Angeles')),
  (18, 'A18 explicit end time', '2026-11-16 20:00:00',
   (public.posting_takedown_at('2099-01-01', '2026-11-16', null, '12:00', 'America/Los_Angeles') at time zone 'UTC')::text),
  (19, 'A19 explicit end date and time', '2026-11-19 01:30:00',
   (public.posting_takedown_at('2099-01-01', '2026-11-16', '2026-11-18', '17:30', 'America/Los_Angeles') at time zone 'UTC')::text),
  (20, 'A20 expiry wins when earlier', '2026-11-10 00:00:00',
   (public.posting_takedown_at('2026-11-10 00:00:00+00', '2026-11-16', null, null, 'America/Los_Angeles') at time zone 'UTC')::text),

  -- A21-A23 reference posting -----------------------------------------------------
  (21, 'A21 reference posting ffe92f35 reads as ended', 'false',
   public.posting_is_active('ffe92f35-622f-490e-a76a-e420088f0c61')::text),
  (22, 'A22 reference posting unchanged (new columns null)',
   '2024-11-16 | not deleted | tz=null | end=null/null',
   (select event_date::text
           || ' | ' || case when deleted_at is null then 'not deleted' else 'DELETED' end
           || ' | tz=' || coalesce(time_zone, 'null')
           || ' | end=' || coalesce(end_date::text, 'null') || '/' || coalesce(end_time::text, 'null')
    from public.postings where id = 'ffe92f35-622f-490e-a76a-e420088f0c61')),
  (23, 'A23 counts function for the reference posting', 'rows=1 likes=0 going=0 interested=0',
   (select 'rows=' || count(*) || ' likes=' || coalesce(sum(like_count), 0)
           || ' going=' || coalesce(sum(going_count), 0)
           || ' interested=' || coalesce(sum(interested_count), 0)
    from public.posting_reaction_counts(array['ffe92f35-622f-490e-a76a-e420088f0c61']::uuid[]))),

  -- A24 totals (compare with preflight baseline) -------------------------------
  (24, 'A24 info: totals (compare with preflight baseline)', null,
   'postings=' || (select count(*) from public.postings)
   || ' postings_active=' || (select count(*) from public.postings where deleted_at is null)
   || ' likes=' || (select count(*) from public.likes)
   || ' plans=' || (select count(*) from public.plans)
   || ' connections=' || (select count(*) from public.connections)
   || ' connections_accepted=' || (select count(*) from public.connections where status = 'accepted')
   || ' follows=' || (select count(*) from public.follows)
   || ' profiles=' || (select count(*) from public.profiles)
   || ' auth_users=' || (select count(*) from auth.users)
   || ' message_threads=' || (select count(*) from public.message_threads)
   || ' messages=' || (select count(*) from public.messages)
   || ' replies=' || (select count(*) from public.replies)),

  (25, 'A25 info: non-deleted postings with no stored zone (use the UTC-12 fallback)', null,
   (select count(*)::text from public.postings where deleted_at is null and time_zone is null))
)
select n, check_name, expected, actual,
       case when expected is null then null else expected is not distinct from actual end as pass
from checks
order by n;
