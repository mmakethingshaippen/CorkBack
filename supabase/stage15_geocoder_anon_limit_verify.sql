-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 15 - Shared anonymous geocoder rate limit - VERIFY (APPLICATION ROLES)
-- Spec: .kiro/specs/posting-location-confirmation (Requirement 24; also 16, 21).
-- Run AFTER stage15_geocoder_anon_limit.sql.
--
-- Checks anon, authenticated and service_role, running each statement as the role the app
-- uses, with JWT claims set the way PostgREST sets them. The whole script is ONE
-- transaction that ENDS WITH ROLLBACK, so no data is left changed.
--
-- Disposable fixtures (created inside this script, removed before the rollback):
--   anon-limit rows keyed by repeat('a'..'f', 64). Refuses to start if any exist.
--
-- Result: one row per check, with pass = true or false. The first row (n = 0) is the
-- overall result 'ALL CHECKS PASS': every check must be pass = true.

begin;

create temp table cb_s15r (n serial, check_name text, accept text[], actual text);

-- Run one statement as a role/user; return its single text result or the SQLSTATE.
create or replace function pg_temp.run_as(p_uid uuid, p_role text, p_sql text)
returns text
language plpgsql
as $f$
declare r text;
begin
  perform set_config('request.jwt.claims',
    case when p_uid is null then json_build_object('role', p_role)::text
         else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  begin
    execute format('set local role %I', p_role);
    execute p_sql into r;
    reset role;
    return coalesce(r, 'null');
  exception when others then
    return sqlstate;
  end;
end;
$f$;

-- Run one statement as the current (owner) role; return 'ok' or the SQLSTATE.
create or replace function pg_temp.try_sql(p_sql text)
returns text
language plpgsql
as $f$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate;
end;
$f$;

create or replace function pg_temp.rec(p_name text, p_accept text[], p_actual text)
returns void language sql as $f$ insert into cb_s15r (check_name, accept, actual) values (p_name, p_accept, p_actual) $f$;

do $$
declare
  keys constant text[] := array[repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64)];
  fn_slot  constant text := 'public.cb_geocoder_take_anon_slot(text, integer, integer)';
  fn_purge constant text := 'public.cb_geocoder_purge_anon_limit(integer)';
  t text; t1 text; t2 text;
  v_trues integer;
  v_expired bigint;
  i integer;
begin
  if to_regclass('public.cb_geocoder_anon_limit') is null
     or to_regprocedure('public.cb_geocoder_take_anon_slot(text,integer,integer)') is null
     or to_regprocedure('public.cb_geocoder_purge_anon_limit(integer)') is null then
    raise exception 'Stage 15 is not applied (a stage 15 object is missing). Nothing was changed.';
  end if;
  if exists (select 1 from public.cb_geocoder_anon_limit where client_hash = any (keys)) then
    raise exception 'Stage 15 test rows already exist. Nothing was changed.';
  end if;

  -- ---------------- structure ----------------
  perform pg_temp.rec('V1 cb_geocoder_anon_limit has exactly client_hash, window_start, hits: no raw IP, user, uid, email or address column',
    array['client_hash,hits,window_start/0'],
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'cb_geocoder_anon_limit') || '/'
    || (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'cb_geocoder_anon_limit'
           and (column_name ilike '%ip%' or column_name ilike '%user%' or column_name ilike '%uid%'
                or column_name ilike '%email%' or column_name ilike '%author%' or column_name ilike '%addr%')));
  perform pg_temp.rec('V2 the table: row level security on, no policy in pg_policies',
    array['true/0'],
    (select c.relrowsecurity::text from pg_class c where c.oid = 'public.cb_geocoder_anon_limit'::regclass) || '/'
    || (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'cb_geocoder_anon_limit'));
  perform pg_temp.rec('V3 client_hash must be 64 lowercase hex: short, long, uppercase and non-hex are refused; a 64-hex key is accepted',
    array['23514,23514,23514,23514,ok'],
    pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', repeat('a', 63))) || ','
    || pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', repeat('a', 65))) || ','
    || pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', repeat('A', 64))) || ','
    || pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', repeat('g', 64))) || ','
    || pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', keys[6])));
  delete from public.cb_geocoder_anon_limit where client_hash = any (keys);
  perform pg_temp.rec('V4 hits must be >= 0: a negative hits is refused', array['23514'],
    pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash, hits) values (%L, -1)', keys[1])));
  perform pg_temp.rec('V5 client_hash is the primary key: a duplicate key is refused', array['ok/23505'],
    pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', keys[1])) || '/'
    || pg_temp.try_sql(format('insert into public.cb_geocoder_anon_limit (client_hash) values (%L)', keys[1])));
  delete from public.cb_geocoder_anon_limit where client_hash = any (keys);

  -- ---------------- functions: security, privileges ----------------
  perform pg_temp.rec('V6 both functions are security definer with an empty search_path; service_role only (not anon, authenticated or PUBLIC)',
    array['2/2/true/false/false'],
    (select count(*)::text from pg_proc p where p.oid in (fn_slot::regprocedure, fn_purge::regprocedure) and p.prosecdef) || '/'
    || (select count(*)::text from pg_proc p where p.oid in (fn_slot::regprocedure, fn_purge::regprocedure)
         and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')) || '/'
    || (has_function_privilege('service_role', fn_slot, 'execute') and has_function_privilege('service_role', fn_purge, 'execute'))::text || '/'
    || (has_function_privilege('anon', fn_slot, 'execute') or has_function_privilege('anon', fn_purge, 'execute')
        or has_function_privilege('authenticated', fn_slot, 'execute') or has_function_privilege('authenticated', fn_purge, 'execute'))::text || '/'
    || (select bool_or(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0))::text
          from pg_proc p where p.oid in (fn_slot::regprocedure, fn_purge::regprocedure)));

  -- ---------------- anon and authenticated are refused everywhere ----------------
  perform pg_temp.rec('V7 anon: select, insert, update, delete on cb_geocoder_anon_limit', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.cb_geocoder_anon_limit') || ','
    || pg_temp.run_as(null, 'anon', format('with x as (insert into public.cb_geocoder_anon_limit (client_hash) values (%L) returning 1) select count(*)::text from x', keys[1]))
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (update public.cb_geocoder_anon_limit set hits = 0 returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (delete from public.cb_geocoder_anon_limit returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V8 authenticated: select, insert, update, delete on cb_geocoder_anon_limit', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'authenticated', 'select count(*)::text from public.cb_geocoder_anon_limit') || ','
    || pg_temp.run_as(null, 'authenticated', format('with x as (insert into public.cb_geocoder_anon_limit (client_hash) values (%L) returning 1) select count(*)::text from x', keys[1]))
    || ',' || pg_temp.run_as(null, 'authenticated', 'with x as (update public.cb_geocoder_anon_limit set hits = 0 returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(null, 'authenticated', 'with x as (delete from public.cb_geocoder_anon_limit returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V9 anon and authenticated cannot execute either function', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])) || ','
    || pg_temp.run_as(null, 'anon', 'select public.cb_geocoder_purge_anon_limit(600)::text') || ','
    || pg_temp.run_as(null, 'authenticated', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])) || ','
    || pg_temp.run_as(null, 'authenticated', 'select public.cb_geocoder_purge_anon_limit(600)::text'));
  perform pg_temp.rec('V10 the refused calls left no row in cb_geocoder_anon_limit', array['0'],
    (select count(*)::text from public.cb_geocoder_anon_limit where client_hash = any (keys)));

  -- ---------------- service_role access ----------------
  perform pg_temp.rec('V11 service_role reads the table and executes both functions', array['0/true/0'],
    pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_anon_limit where client_hash = ' || quote_literal(keys[1])) || '/'
    || pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])) || '/'
    || pg_temp.run_as(null, 'service_role', 'select public.cb_geocoder_purge_anon_limit(0)::text'));
  delete from public.cb_geocoder_anon_limit where client_hash = any (keys);

  -- ---------------- the 30 / window limit ----------------
  -- 30 hits for one id return true, the 31st and 32nd return false; a different id counts
  -- separately; after the window passes the same id returns true again.
  v_trues := 0;
  for i in 1..30 loop
    if pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])) = 'true' then
      v_trues := v_trues + 1;
    end if;
  end loop;
  perform pg_temp.rec('V12 the first 30 hits for one id are all within the limit (true)', array['30'], v_trues::text);
  perform pg_temp.rec('V13 the 31st and 32nd hits for the same id are over the limit (false)', array['false/false'],
    pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])) || '/'
    || pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1])));
  perform pg_temp.rec('V14 the row records 32 hits for that id', array['32'],
    (select hits::text from public.cb_geocoder_anon_limit where client_hash = keys[1]));
  perform pg_temp.rec('V15 a different id is counted separately: its first hit is within the limit (true)', array['true'],
    pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[2])));

  -- Simulate the window passing by ageing the row, then the same id is allowed again and
  -- the window resets to 1 hit. The take call runs in its own statement first, so the
  -- hits read below sees the post-call value (not the pre-call snapshot).
  update public.cb_geocoder_anon_limit set window_start = now() - interval '11 minutes' where client_hash = keys[1];
  t := pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', keys[1]));
  perform pg_temp.rec('V16 after the window passes, the same id returns true again and the window resets to 1 hit', array['true/1'],
    t || '/' || (select hits::text from public.cb_geocoder_anon_limit where client_hash = keys[1]));
  perform pg_temp.rec('V17 a null or non-hex client hash is rejected (22023), no row for it', array['22023/22023/0'],
    pg_temp.run_as(null, 'service_role', 'select public.cb_geocoder_take_anon_slot(null, 30, 600)::text') || '/'
    || pg_temp.run_as(null, 'service_role', format('select public.cb_geocoder_take_anon_slot(%L, 30, 600)::text', 'not-hex')) || '/'
    || (select count(*)::text from public.cb_geocoder_anon_limit where client_hash !~ '^[0-9a-f]{64}$'));

  -- ---------------- the purge ----------------
  delete from public.cb_geocoder_anon_limit where client_hash = any (keys);
  insert into public.cb_geocoder_anon_limit (client_hash, window_start, hits) values
    (keys[3], now() - interval '20 minutes', 5),   -- older than the window: purged
    (keys[4], now() - interval '11 minutes', 3),   -- older than the window: purged
    (keys[5], now(), 1);                            -- fresh: kept
  select count(*) into v_expired from public.cb_geocoder_anon_limit
    where window_start < now() - interval '600 seconds' and client_hash = any (keys);
  t := pg_temp.run_as(null, 'service_role', 'select public.cb_geocoder_purge_anon_limit(600)::text');
  perform pg_temp.rec('V18 the purge returns the number of expired rows it deleted', array[v_expired::text], t);
  perform pg_temp.rec('V19 the purge deletes only expired rows: none expired of the fixtures left, the fresh fixture row kept',
    array['0/1'],
    (select count(*)::text from public.cb_geocoder_anon_limit
       where client_hash = any (keys) and window_start < now() - interval '600 seconds') || '/'
    || (select count(*)::text from public.cb_geocoder_anon_limit where client_hash = keys[5]));

  -- ---------------- cleanup ----------------
  delete from public.cb_geocoder_anon_limit where client_hash = any (keys);
  perform pg_temp.rec('V20 no stage 15 test rows remain', array['0'],
    (select count(*)::text from public.cb_geocoder_anon_limit where client_hash = any (keys)));
end;
$$;

select n, check_name, accept, actual, actual = any (accept) as pass
from (
  select 0 as n, 'ALL CHECKS PASS' as check_name, array['true'] as accept,
         coalesce(bool_and(actual = any (accept)), false)::text as actual
  from cb_s15r
  union all
  select n, check_name, accept, actual from cb_s15r
) s
order by n;

rollback;
