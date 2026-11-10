-- CorkBack - Stage 6 part 3 - VERIFY (ADMIN) - run AFTER the migration
--
-- Catalog checks only. Read-only: no writes, no role switching. Behaviour as the
-- app's roles is tested in stage6_social_part3_verify_roles.sql.
-- Result: one table. pass = true (ok), false (stop and report), null (info only).

with checks(n, check_name, expected, actual) as (
  values
  (1, 'B1 connections policies are exactly the reviewed set',
   'connections addressee accept UPDATE | connections party delete DELETE | connections party read SELECT | '
   || 'connections requester insert pending INSERT',
   (select string_agg(policyname || ' ' || cmd, ' | ' order by policyname collate "C")
    from pg_policies where schemaname = 'public' and tablename = 'connections')),

  (2, 'B2 accept policy: recipient only, pending -> accepted',
   'using=((auth.uid() = addressee_id) AND (status = ''pending''::connection_status)) '
   || 'check=((auth.uid() = addressee_id) AND (status = ''accepted''::connection_status))',
   (select 'using=' || qual || ' check=' || with_check from pg_policies
    where schemaname = 'public' and tablename = 'connections' and policyname = 'connections addressee accept')),

  (3, 'B3 insert policy: requester is caller and status pending',
   '((auth.uid() = requester_id) AND (status = ''pending''::connection_status))',
   (select with_check from pg_policies
    where schemaname = 'public' and tablename = 'connections' and policyname = 'connections requester insert pending')),

  (4, 'B4 one connection per pair (unique, either direction)', 'true',
   (select (count(*) = 1)::text from pg_indexes
    where schemaname = 'public' and tablename = 'connections' and indexname = 'connections_one_per_pair'
      and indexdef ilike 'CREATE UNIQUE INDEX%LEAST(requester_id, addressee_id)%GREATEST(requester_id, addressee_id)%')),

  (5, 'B5 self-request check still present', '1',
   (select count(*)::text from pg_constraint
    where conrelid = 'public.connections'::regclass and conname = 'no_self_connect')),

  (6, 'B6 authenticated: no table-level INSERT/UPDATE; SELECT/DELETE kept', 'insert=false update=false select=true delete=true',
   'insert=' || has_table_privilege('authenticated', 'public.connections', 'INSERT')
   || ' update=' || has_table_privilege('authenticated', 'public.connections', 'UPDATE')
   || ' select=' || has_table_privilege('authenticated', 'public.connections', 'SELECT')
   || ' delete=' || has_table_privilege('authenticated', 'public.connections', 'DELETE')),

  (7, 'B7 authenticated column grants: insert parties only; update status only',
   'ins requester=true addressee=true status=false | upd status=true requester=false addressee=false',
   'ins requester=' || has_column_privilege('authenticated', 'public.connections', 'requester_id', 'INSERT')
   || ' addressee=' || has_column_privilege('authenticated', 'public.connections', 'addressee_id', 'INSERT')
   || ' status=' || has_column_privilege('authenticated', 'public.connections', 'status', 'INSERT')
   || ' | upd status=' || has_column_privilege('authenticated', 'public.connections', 'status', 'UPDATE')
   || ' requester=' || has_column_privilege('authenticated', 'public.connections', 'requester_id', 'UPDATE')
   || ' addressee=' || has_column_privilege('authenticated', 'public.connections', 'addressee_id', 'UPDATE')),

  (8, 'B8 anon cannot insert, update, or delete connections', 'false,false,false',
   has_table_privilege('anon', 'public.connections', 'INSERT') || ',' ||
   has_table_privilege('anon', 'public.connections', 'UPDATE') || ',' ||
   has_table_privilege('anon', 'public.connections', 'DELETE')),

  (9, 'B9 viewer_is_friend_of exists, security invoker, executable', 'exists=1 definer=false anon=true auth=true',
   'exists=' || (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'viewer_is_friend_of')
   || ' definer=' || coalesce((select prosecdef::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'viewer_is_friend_of'), 'missing')
   || ' anon=' || has_function_privilege('anon', 'public.viewer_is_friend_of(uuid)', 'execute')
   || ' auth=' || has_function_privilege('authenticated', 'public.viewer_is_friend_of(uuid)', 'execute')),

  (10, 'B10 plans policies: friend read replaces owner read; writes unchanged',
   'plans self delete active DELETE | plans self insert active INSERT | plans self or friend read SELECT | plans self update active UPDATE',
   (select string_agg(policyname || ' ' || cmd, ' | ' order by policyname collate "C")
    from pg_policies where schemaname = 'public' and tablename = 'plans')),

  (11, 'B11 plans friend read requires an ACTIVE posting', 'true',
   (select (qual ilike '%viewer_is_friend_of(user_id)%posting_is_active(posting_id)%')::text from pg_policies
    where schemaname = 'public' and tablename = 'plans' and policyname = 'plans self or friend read')),

  (12, 'B12 likes still owner-only read (unchanged by part 3)', 'likes owner read',
   (select string_agg(policyname, ',') from pg_policies
    where schemaname = 'public' and tablename = 'likes' and cmd = 'SELECT')),

  (13, 'B13 no restrictive or always-true policies on connections/plans/likes', '0',
   (select count(*)::text from pg_policies
    where schemaname = 'public' and tablename in ('connections', 'plans', 'likes')
      and (permissive = 'RESTRICTIVE' or coalesce(qual, '') ~* '^\(?\s*true\s*\)?$'))),

  (14, 'B14 info: totals (compare with preflight baseline)', null,
   'connections=' || (select count(*) from public.connections)
   || ' accepted=' || (select count(*) from public.connections where status = 'accepted')
   || ' plans=' || (select count(*) from public.plans)
   || ' likes=' || (select count(*) from public.likes)
   || ' follows=' || (select count(*) from public.follows)
   || ' postings=' || (select count(*) from public.postings)
   || ' profiles=' || (select count(*) from public.profiles)
   || ' auth_users=' || (select count(*) from auth.users)
   || ' messages=' || (select count(*) from public.messages))
)
select n, check_name, expected, actual,
       case when expected is null then null else expected is not distinct from actual end as pass
from checks
order by n;
