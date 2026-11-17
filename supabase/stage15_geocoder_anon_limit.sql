-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 15 - Shared anonymous geocoder rate limit - the migration
-- Spec: .kiro/specs/posting-location-confirmation (Requirement 24; also 16, 21).
--
-- Run order (owner, after review; stage 14 must already be applied):
--   1. supabase/stage15_geocoder_anon_limit_preflight.sql     read-only, BEFORE; save the output
--   2. this file                                              the migration
--   3. supabase/stage15_geocoder_anon_limit_verify.sql        AFTER; ALL CHECKS PASS (rolls itself back)
--   Undo: supabase/stage15_geocoder_anon_limit_rollback.sql (only after the code is rolled back)
--
-- Release order: apply this file BEFORE the code release. Old code never calls the new
-- function; new code fails closed (HTTP 503) for anonymous place search until it exists,
-- so applying it first is safe. New code deployed first would turn every anonymous place
-- search into a 503 until the migration lands.
--
-- Stage 15 is ADDITIVE to stage 14. It adds the shared anonymous rate limit that bounds
-- signed-out `purpose=place` lookups across all server instances, keyed by a hashed
-- client id so no raw IP, user id or email is ever stored. It touches no stage 14 object.
--
-- What this file creates (ADDITIVE ONLY; no stage 14 object and no existing row changes):
--   1. public.cb_geocoder_anon_limit: client_hash (64 lowercase hex, an HMAC computed by
--        the server from the client IP), window_start timestamptz, hits integer >= 0.
--        NO raw IP, NO user id, NO email, NO other identifying column.
--   2. public.cb_geocoder_take_anon_slot(p_client_hash text, p_max_hits integer default 30,
--        p_window_seconds integer default 600) returns boolean. SECURITY DEFINER,
--        search_path = ''. One atomic upsert: when no row or the row's window_start is
--        older than the window, reset window_start = now() and hits = 1 and return true;
--        otherwise increment hits and return (hits <= p_max_hits). Confirmed limit:
--        30 hits / 600 seconds. EXECUTE: service_role only.
--   3. public.cb_geocoder_purge_anon_limit(p_window_seconds integer default 600)
--        returns integer: deletes rows whose window_start is older than the window and
--        returns the count. Keeps the table from growing without limit. EXECUTE:
--        service_role only.
--   On the new table and both functions: row level security on with NO policy, every
--   privilege revoked from PUBLIC, anon and authenticated, and service_role granted
--   select, insert, update, delete (table) / execute (functions).
--
-- What this file does NOT change: any stage 14 object (the location_precision column and
-- its grant, cb_update_posting_location, cb_geocoder_throttle, cb_geocoder_take_slot,
-- cb_geocoder_cache, cb_geocoder_purge_cache, their privileges and RLS) and any existing
-- row. The end of the file recomputes the stage 14 inventory md5 (the value the preflight
-- prints) and rolls everything back if it differs.
--
-- Re-runnable: every create is "if not exists" / "or replace" / duplicate-tolerant.
-- One transaction: any error leaves nothing applied.

begin;

-- 0. Dependencies: stage 14 must be fully applied, and the roles must exist. Nothing is
--    changed before these pass. Stage 15 is additive and must not run without stage 14.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'stage15: roles anon, authenticated and service_role must exist (nothing was changed)';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision') then
    raise exception 'stage15: stage 14 is not applied (postings.location_precision is missing). Apply stage 14 first (nothing was changed)';
  end if;
  if to_regprocedure('public.cb_update_posting_location(uuid,double precision,double precision,text,text)') is null
     or to_regprocedure('public.cb_geocoder_take_slot(integer)') is null
     or to_regprocedure('public.cb_geocoder_purge_cache()') is null
     or to_regclass('public.cb_geocoder_throttle') is null
     or to_regclass('public.cb_geocoder_cache') is null then
    raise exception 'stage15: a stage 14 object is missing. Apply stage 14 first (nothing was changed)';
  end if;
end $$;

-- 0b. Snapshot the stage 14 inventory, so the end of the file can prove stage 14 did not
--     change. This is the same md5 the preflight prints and the verify compares.
do $$
begin
  perform set_config('cb.s15_s14',
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

-- 1. The shared anonymous-limit table. One row per active hashed client id per window.
--    client_hash is a 64 lowercase hex HMAC (same format as the cache key). No raw IP,
--    no user id, no email: those columns must never exist here.
create table if not exists public.cb_geocoder_anon_limit (
  client_hash  text        primary key check (client_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz not null default now(),
  hits         integer     not null default 0 check (hits >= 0)
);

-- 2. cb_geocoder_take_anon_slot: one atomic upsert. Records a hit for a hashed client id
--    and returns whether the caller is within the window limit (confirmed: 30 / 600 s).
--    The ON CONFLICT path resets the window when the stored window_start is older than
--    the window, otherwise increments hits. A single statement, so concurrent callers for
--    one id serialize on the row and the count is never lost (no read-modify-write race).
create or replace function public.cb_geocoder_take_anon_slot(
  p_client_hash   text,
  p_max_hits      integer default 30,
  p_window_seconds integer default 600
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_max    integer := greatest(coalesce(p_max_hits, 0), 0);
  v_window integer := greatest(coalesce(p_window_seconds, 0), 0);
  v_hits   integer;
begin
  if p_client_hash is null or p_client_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid client hash' using errcode = '22023';
  end if;

  insert into public.cb_geocoder_anon_limit as a (client_hash, window_start, hits)
  values (p_client_hash, now(), 1)
  on conflict (client_hash) do update
    set window_start = case when a.window_start < now() - make_interval(secs => v_window)
                            then now() else a.window_start end,
        hits = case when a.window_start < now() - make_interval(secs => v_window)
                    then 1 else a.hits + 1 end
  returning hits into v_hits;

  return v_hits <= v_max;
end;
$f$;

-- 3. cb_geocoder_purge_anon_limit: deletes rows whose window has fully passed, so the
--    table never grows without limit. Returns the number of rows it removed.
create or replace function public.cb_geocoder_purge_anon_limit(
  p_window_seconds integer default 600
)
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_window  integer := greatest(coalesce(p_window_seconds, 0), 0);
  v_deleted integer;
begin
  delete from public.cb_geocoder_anon_limit
   where window_start < now() - make_interval(secs => v_window);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$f$;

-- 4. Privileges on the stage 15 objects: service_role only; RLS on with no policy.
alter table public.cb_geocoder_anon_limit enable row level security;

revoke all on table public.cb_geocoder_anon_limit from public, anon, authenticated;
grant select, insert, update, delete on table public.cb_geocoder_anon_limit to service_role;

revoke all on function public.cb_geocoder_take_anon_slot(text, integer, integer) from public, anon, authenticated;
revoke all on function public.cb_geocoder_purge_anon_limit(integer) from public, anon, authenticated;
grant execute on function public.cb_geocoder_take_anon_slot(text, integer, integer) to service_role;
grant execute on function public.cb_geocoder_purge_anon_limit(integer) to service_role;

-- 5. Assertions on the ACTUAL resulting state. Any failure raises and the whole
--    transaction rolls back.
do $$
declare
  v_role text;
  v_fn   text;
begin
  -- The table: exactly client_hash, window_start, hits; no identifying column.
  if (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'cb_geocoder_anon_limit') is distinct from 'client_hash,hits,window_start' then
    raise exception 'stage15 assertion: cb_geocoder_anon_limit must have exactly client_hash, window_start, hits';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cb_geocoder_anon_limit'
               and (column_name ilike '%ip%' or column_name ilike '%user%' or column_name ilike '%uid%'
                    or column_name ilike '%email%' or column_name ilike '%author%' or column_name ilike '%addr%')) then
    raise exception 'stage15 assertion: cb_geocoder_anon_limit has a raw IP or identifying column';
  end if;
  if not exists (select 1 from pg_constraint k where k.conrelid = 'public.cb_geocoder_anon_limit'::regclass and k.contype = 'c'
                 and pg_get_constraintdef(k.oid) like '%0-9a-f%64%') then
    raise exception 'stage15 assertion: the client_hash 64-hex check constraint is missing';
  end if;
  if not exists (select 1 from pg_constraint k where k.conrelid = 'public.cb_geocoder_anon_limit'::regclass and k.contype = 'p') then
    raise exception 'stage15 assertion: client_hash is not the primary key';
  end if;

  -- RLS on, no policy, service_role only, no privilege for PUBLIC/anon/authenticated.
  if not (select c.relrowsecurity from pg_class c where c.oid = 'public.cb_geocoder_anon_limit'::regclass) then
    raise exception 'stage15 assertion: row level security is not enabled on cb_geocoder_anon_limit';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cb_geocoder_anon_limit') then
    raise exception 'stage15 assertion: cb_geocoder_anon_limit must have no policy';
  end if;
  foreach v_role in array array['anon', 'authenticated'] loop
    if has_table_privilege(v_role, 'public.cb_geocoder_anon_limit', 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege(v_role, 'public.cb_geocoder_anon_limit', 'select,insert,update,references') then
      raise exception 'stage15 assertion: % has a privilege on cb_geocoder_anon_limit', v_role;
    end if;
  end loop;
  if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
             where c.oid = 'public.cb_geocoder_anon_limit'::regclass and x.grantee = 0) then
    raise exception 'stage15 assertion: PUBLIC has a privilege on cb_geocoder_anon_limit';
  end if;
  if not (has_table_privilege('service_role', 'public.cb_geocoder_anon_limit', 'select')
          and has_table_privilege('service_role', 'public.cb_geocoder_anon_limit', 'insert')
          and has_table_privilege('service_role', 'public.cb_geocoder_anon_limit', 'update')
          and has_table_privilege('service_role', 'public.cb_geocoder_anon_limit', 'delete')) then
    raise exception 'stage15 assertion: service_role cannot read and write cb_geocoder_anon_limit';
  end if;

  -- Both functions: SECURITY DEFINER, empty search_path, service_role only.
  foreach v_fn in array array['public.cb_geocoder_take_anon_slot(text, integer, integer)',
                              'public.cb_geocoder_purge_anon_limit(integer)'] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_fn::regprocedure and p.prosecdef
        and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')
    ) then
      raise exception 'stage15 assertion: % is not SECURITY DEFINER with an empty search_path', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'stage15 assertion: service_role cannot execute %', v_fn;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'stage15 assertion: % can execute %', v_role, v_fn;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               where p.oid = v_fn::regprocedure and x.grantee = 0) then
      raise exception 'stage15 assertion: PUBLIC can execute %', v_fn;
    end if;
  end loop;

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
    ) is distinct from current_setting('cb.s15_s14') then
    raise exception 'stage15 assertion: a stage 14 object changed (stage 15 must be additive only)';
  end if;
end $$;

commit;

-- Check (read-only). Expect the new table empty and both functions present.
select (select count(*) from public.cb_geocoder_anon_limit) as anon_limit_rows,
       (to_regprocedure('public.cb_geocoder_take_anon_slot(text,integer,integer)') is not null) as take_anon_slot_present,
       (to_regprocedure('public.cb_geocoder_purge_anon_limit(integer)') is not null) as purge_anon_limit_present;
