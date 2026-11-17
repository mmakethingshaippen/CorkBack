-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 14 - Posting location confirmation - the migration
-- Spec: .kiro/specs/posting-location-confirmation (Requirements 13, 16, 19, 20).
--
-- Run order (owner, after review):
--   1. supabase/stage14_posting_location_preflight.sql     read-only, BEFORE; save the output
--   2. this file                                           the migration
--   3. supabase/stage14_posting_location_verify.sql        AFTER; ALL CHECKS PASS (rolls itself back)
--   Undo: supabase/stage14_posting_location_rollback.sql (only after the code is rolled back)
--
-- Release order: apply this file BEFORE the code release. Old code ignores the new
-- column and never calls the new functions, so applying it first is safe. New code
-- writes the column, so deploying it first would break publishing.
--
-- What this file creates (ADDITIVE ONLY; no existing row or object is changed):
--   1. postings.location_precision  text not null default 'unreviewed'
--        check (location_precision in ('exact', 'approximate', 'unreviewed')).
--      Every existing row reads 'unreviewed'. A constant default adds no row rewrite.
--   2. Insert columns for authenticated, re-granted: the stage 8 list
--        (author_id, title, body, category_id, rsvp_url, event_date, event_time, end_date,
--         end_time, time_zone, place_label, lat, lng, expiry, expires_at)
--      plus location_precision. The migration refuses to start when the current
--      grant is not exactly the stage 8 list, so the re-grant cannot drop a column.
--      No UPDATE grant is added: clients still cannot write lat, lng or time_zone.
--   3. public.cb_update_posting_location(p_posting_id, p_lat, p_lng, p_time_zone, p_precision)
--        returns text. SECURITY DEFINER, search_path = ''. Author of an active, visible
--        posting only. One UPDATE statement, so a failure leaves lat, lng, time_zone and
--        location_precision as they were. Errors: 42501 not signed in; 22023 bad
--        coordinates or precision; CB404 no such posting / not the author / deleted /
--        hidden; CB409 the posting has ended. EXECUTE: authenticated only.
--   4. public.cb_geocoder_throttle: one row (id boolean primary key check (id)).
--   5. public.cb_geocoder_take_slot(p_max_wait_ms integer default 3000)
--        returns table (slot_at timestamptz, wait_ms integer). One UPDATE reserves the
--        next slot 1100 ms after the previous one; the bound is capped at 5000 ms;
--        no row is returned when the wait would exceed the bound. EXECUTE: service_role only.
--   6. public.cb_geocoder_cache: key_hash (64 hex, an HMAC computed by the server),
--        results jsonb array (at most 20000 bytes), created_at, expires_at (at most
--        24 hours after created_at). No user column.
--   7. public.cb_geocoder_purge_cache() returns integer: deletes expired rows.
--        EXECUTE: service_role only.
--   On the two geocoder tables and two geocoder functions: row level security on with
--   NO policy, every privilege revoked from PUBLIC, anon and authenticated, and
--   service_role granted select, insert, update, delete (tables) / execute (functions).
--
-- What this file does NOT change: any existing postings row (lat, lng, place_label,
-- time_zone and every other column), any existing policy, trigger, or column privilege
-- other than the INSERT list above. The end of the file asserts that and rolls everything
-- back if it is not true, including an md5 proof over id, lat, lng, place_label,
-- time_zone (the same value the preflight prints).
--
-- Re-runnable: every create is "if not exists" / "or replace" / duplicate-tolerant.
-- One transaction: any error leaves nothing applied.

begin;

-- 0. Dependencies and starting state. Nothing is changed before these pass.
do $$
declare
  c text;
  v_stage8 text[] := array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                           'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at'];
  v_missing text;
  v_extra text;
begin
  if to_regclass('public.postings') is null then
    raise exception 'stage14: public.postings must exist (nothing was changed)';
  end if;
  foreach c in array array['id', 'author_id', 'lat', 'lng', 'place_label', 'time_zone', 'expires_at',
                           'event_date', 'end_date', 'end_time', 'deleted_at', 'moderation_hidden_at'] loop
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'postings' and column_name = c) then
      raise exception 'stage14: column postings.% is missing (nothing was changed)', c;
    end if;
  end loop;
  if to_regprocedure('public.cb_safe_time_zone(text)') is null
     or to_regprocedure('public.posting_takedown_at(timestamptz,date,date,time,text)') is null then
    raise exception 'stage14: cb_safe_time_zone and posting_takedown_at must exist (apply stage 6 first; nothing was changed)';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')
     or not exists (select 1 from pg_roles where rolname = 'authenticated')
     or not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception 'stage14: roles anon, authenticated and service_role must exist (nothing was changed)';
  end if;

  -- The current INSERT grant for authenticated must be exactly the stage 8 list
  -- (location_precision may already be there on a re-run).
  select string_agg(s.col, ', ') into v_missing
    from unnest(v_stage8) as s(col)
   where not has_column_privilege('authenticated', 'public.postings', s.col, 'insert');
  select string_agg(a.attname::text, ', ') into v_extra
    from pg_attribute a
   where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname::text <> 'location_precision'
     and a.attname::text <> all (v_stage8)
     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert');
  if v_missing is not null or v_extra is not null then
    raise exception 'stage14: authenticated INSERT columns on postings differ from the stage 8 list (missing: %, extra: %); review before running (nothing was changed)',
      coalesce(v_missing, 'none'), coalesce(v_extra, 'none');
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14: anon has an INSERT privilege on postings; review before running (nothing was changed)';
  end if;
  if has_table_privilege('authenticated', 'public.postings', 'insert') then
    raise exception 'stage14: authenticated has a table-wide INSERT on postings; review before running (nothing was changed)';
  end if;
end $$;

-- 0b. Snapshot, so the end of the file can prove no existing row or column privilege
--     changed. md5_a is the preflight value; md5_b covers every existing column.
do $$
begin
  perform set_config('cb.s14_rows',
    (select count(*)::text from public.postings), true);
  perform set_config('cb.s14_md5_a',
    (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
       from public.postings p), true);
  perform set_config('cb.s14_md5_b',
    (select md5(coalesce(string_agg((to_jsonb(p) - 'location_precision')::text, E'\n' order by p.id), ''))
       from public.postings p), true);
  perform set_config('cb.s14_acl',
    (select md5(coalesce(string_agg(
        a.attname::text || ':'
        || has_column_privilege('anon', a.attrelid, a.attnum, 'select')::text
        || has_column_privilege('anon', a.attrelid, a.attnum, 'insert')::text
        || has_column_privilege('anon', a.attrelid, a.attnum, 'update')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')::text,
        '|' order by a.attnum), ''))
       from pg_attribute a
      where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
        and a.attname::text <> 'location_precision'), true);
  perform set_config('cb.s14_policies',
    (select md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                    '|' order by p.policyname), ''))
       from pg_policies p where p.schemaname = 'public' and p.tablename = 'postings'), true);
  perform set_config('cb.s14_col_existed',
    exists (select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision')::text, true);
end $$;

-- 1. The column. Existing rows read 'unreviewed' (constant default, no rewrite).
alter table public.postings add column if not exists location_precision text not null default 'unreviewed';

do $$
begin
  alter table public.postings
    add constraint postings_location_precision_check
    check (location_precision in ('exact', 'approximate', 'unreviewed'));
exception when duplicate_object then null;
end $$;

-- 2. Insert columns: the stage 8 list plus location_precision. Same statement shape
--    as stage 8 (revoke, then an explicit column list). Step 0 proved the current
--    list equals the stage 8 list, so nothing is dropped.
revoke insert on public.postings from anon, authenticated;
grant insert (author_id, title, body, category_id, rsvp_url, event_date, event_time, end_date, end_time,
              time_zone, place_label, lat, lng, expiry, expires_at, location_precision)
  on public.postings to authenticated;

-- 3. cb_update_posting_location: author-only, active and visible posting, one UPDATE.
create or replace function public.cb_update_posting_location(
  p_posting_id uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_time_zone  text,
  p_precision  text
)
returns text
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid  uuid := auth.uid();
  v_zone text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  -- NaN and infinity fail the range tests (NaN sorts above every number).
  if p_posting_id is null or p_lat is null or p_lng is null or p_precision is null
     or not (p_lat between -90 and 90)
     or not (p_lng between -180 and 180)
     or p_precision not in ('exact', 'approximate') then
    raise exception 'invalid location' using errcode = '22023';
  end if;

  -- Keep the zone only when cb_safe_time_zone accepts it as given; otherwise null,
  -- which reads as the same fallback zone (as the publish route does).
  v_zone := case when p_time_zone is not null and public.cb_safe_time_zone(p_time_zone) = p_time_zone
                 then p_time_zone else null end;

  update public.postings p
     set lat = p_lat,
         lng = p_lng,
         time_zone = v_zone,
         location_precision = p_precision
   where p.id = p_posting_id
     and p.author_id = v_uid
     and p.deleted_at is null
     and p.moderation_hidden_at is null
     and now() < public.posting_takedown_at(p.expires_at, p.event_date, p.end_date, p.end_time, p.time_zone);

  if not found then
    -- Nothing was written. Say why.
    if not exists (select 1 from public.postings p
                   where p.id = p_posting_id and p.author_id = v_uid
                     and p.deleted_at is null and p.moderation_hidden_at is null) then
      raise exception 'posting not found' using errcode = 'CB404';
    end if;
    raise exception 'posting has ended' using errcode = 'CB409';
  end if;
  return 'updated';
end;
$f$;

revoke all on function public.cb_update_posting_location(uuid, double precision, double precision, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.cb_update_posting_location(uuid, double precision, double precision, text, text)
  to authenticated;

-- 4. Geocoder throttle: exactly one row (id can only be true).
create table if not exists public.cb_geocoder_throttle (
  id           boolean     primary key default true check (id),
  next_slot_at timestamptz not null default '-infinity'
);
insert into public.cb_geocoder_throttle (id) values (true) on conflict (id) do nothing;

-- 5. cb_geocoder_take_slot: one atomic UPDATE. The row lock serializes concurrent
--    callers; a loser re-checks the WHERE against the new next_slot_at. One clock
--    reading (v_now) is used for the test and for the new slot, so slot_at - v_now
--    never exceeds the bound.
create or replace function public.cb_geocoder_take_slot(p_max_wait_ms integer default 3000)
returns table (slot_at timestamptz, wait_ms integer)
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_now   timestamptz := clock_timestamp();
  v_bound integer := least(greatest(coalesce(p_max_wait_ms, 0), 0), 5000);
  v_next  timestamptz;
begin
  update public.cb_geocoder_throttle t
     set next_slot_at = greatest(t.next_slot_at, v_now) + interval '1100 milliseconds'
   where t.id
     and greatest(t.next_slot_at, v_now) <= v_now + v_bound * interval '1 millisecond'
  returning t.next_slot_at into v_next;

  if not found then
    return;  -- no slot within the bound: the caller answers "busy"
  end if;

  slot_at := v_next - interval '1100 milliseconds';
  wait_ms := greatest(0, ceil(extract(epoch from (slot_at - clock_timestamp())) * 1000))::integer;
  return next;
end;
$f$;

-- 6. Geocoder cache: HMAC key, normalized results, at most 24 hours, no user column.
create table if not exists public.cb_geocoder_cache (
  key_hash   text        primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  results    jsonb       not null check (jsonb_typeof(results) = 'array' and octet_length(results::text) <= 20000),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (expires_at > created_at and expires_at <= created_at + interval '24 hours')
);
create index if not exists cb_geocoder_cache_expires_idx on public.cb_geocoder_cache (expires_at);

-- 7. cb_geocoder_purge_cache: expired rows only.
create or replace function public.cb_geocoder_purge_cache()
returns integer
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_deleted integer;
begin
  delete from public.cb_geocoder_cache where expires_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$f$;

-- 8. Privileges on the geocoder objects: service_role only; RLS on with no policy.
alter table public.cb_geocoder_throttle enable row level security;
alter table public.cb_geocoder_cache enable row level security;

revoke all on table public.cb_geocoder_throttle from public, anon, authenticated;
revoke all on table public.cb_geocoder_cache from public, anon, authenticated;
grant select, insert, update, delete on table public.cb_geocoder_throttle to service_role;
grant select, insert, update, delete on table public.cb_geocoder_cache to service_role;

revoke all on function public.cb_geocoder_take_slot(integer) from public, anon, authenticated;
revoke all on function public.cb_geocoder_purge_cache() from public, anon, authenticated;
grant execute on function public.cb_geocoder_take_slot(integer) to service_role;
grant execute on function public.cb_geocoder_purge_cache() to service_role;

-- 9. Assertions on the ACTUAL resulting state. Any failure raises and the whole
--    transaction rolls back.
do $$
declare
  v_stage8 text[] := array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                           'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at'];
  v_tbl    text;
  v_fn     text;
  v_role   text;
  v_acl    text;
begin
  -- The column: type, not null, default, check.
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision'
      and data_type = 'text' and is_nullable = 'NO' and column_default like '''unreviewed''%'
  ) then
    raise exception 'stage14 assertion: postings.location_precision is not text not null default ''unreviewed''';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'postings_location_precision_check' and conrelid = 'public.postings'::regclass
      and pg_get_constraintdef(oid) like '%exact%' and pg_get_constraintdef(oid) like '%approximate%'
      and pg_get_constraintdef(oid) like '%unreviewed%'
  ) then
    raise exception 'stage14 assertion: the location_precision check constraint is missing';
  end if;
  if current_setting('cb.s14_col_existed') = 'false'
     and exists (select 1 from public.postings where location_precision <> 'unreviewed') then
    raise exception 'stage14 assertion: an existing posting does not read unreviewed';
  end if;

  -- Existing rows and privileges are unchanged.
  if (select count(*)::text from public.postings) is distinct from current_setting('cb.s14_rows') then
    raise exception 'stage14 assertion: the postings row count changed';
  end if;
  if (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
        from public.postings p) is distinct from current_setting('cb.s14_md5_a') then
    raise exception 'stage14 assertion: id, lat, lng, place_label or time_zone of an existing posting changed';
  end if;
  if (select md5(coalesce(string_agg((to_jsonb(p) - 'location_precision')::text, E'\n' order by p.id), ''))
        from public.postings p) is distinct from current_setting('cb.s14_md5_b') then
    raise exception 'stage14 assertion: an existing column value of a posting changed';
  end if;
  select md5(coalesce(string_agg(
        a.attname::text || ':'
        || has_column_privilege('anon', a.attrelid, a.attnum, 'select')::text
        || has_column_privilege('anon', a.attrelid, a.attnum, 'insert')::text
        || has_column_privilege('anon', a.attrelid, a.attnum, 'update')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')::text
        || has_column_privilege('authenticated', a.attrelid, a.attnum, 'update')::text,
        '|' order by a.attnum), ''))
    into v_acl
    from pg_attribute a
   where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname::text <> 'location_precision';
  if v_acl is distinct from current_setting('cb.s14_acl') then
    raise exception 'stage14 assertion: a column privilege on an existing postings column changed';
  end if;
  if (select md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                     '|' order by p.policyname), ''))
        from pg_policies p where p.schemaname = 'public' and p.tablename = 'postings')
     is distinct from current_setting('cb.s14_policies') then
    raise exception 'stage14 assertion: a postings policy changed';
  end if;

  -- INSERT columns for authenticated = stage 8 list + location_precision, nothing else.
  if exists (select 1 from unnest(v_stage8 || array['location_precision']) as s(col)
             where not has_column_privilege('authenticated', 'public.postings', s.col, 'insert')) then
    raise exception 'stage14 assertion: authenticated lost an INSERT column on postings';
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and a.attname::text <> all (v_stage8 || array['location_precision'])
               and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14 assertion: authenticated has an extra INSERT column on postings';
  end if;
  if has_table_privilege('authenticated', 'public.postings', 'insert') then
    raise exception 'stage14 assertion: authenticated has a table-wide INSERT on postings';
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14 assertion: anon has an INSERT privilege on postings';
  end if;
  if has_column_privilege('anon', 'public.postings', 'location_precision', 'update')
     or has_column_privilege('authenticated', 'public.postings', 'location_precision', 'update') then
    raise exception 'stage14 assertion: a client can UPDATE location_precision directly';
  end if;

  -- cb_update_posting_location.
  if not exists (
    select 1 from pg_proc p
    where p.oid = 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)'::regprocedure
      and p.prosecdef
      and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')
  ) then
    raise exception 'stage14 assertion: cb_update_posting_location is not SECURITY DEFINER with an empty search_path';
  end if;
  if not has_function_privilege('authenticated', 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)', 'execute')
     or has_function_privilege('anon', 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)', 'execute')
     or has_function_privilege('service_role', 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)', 'execute') then
    raise exception 'stage14 assertion: cb_update_posting_location must be executable by authenticated only';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
             where p.oid = 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)'::regprocedure
               and x.grantee = 0) then
    raise exception 'stage14 assertion: PUBLIC can execute cb_update_posting_location';
  end if;

  -- Geocoder tables: RLS on, no policy, service_role only, no PUBLIC.
  foreach v_tbl in array array['cb_geocoder_throttle', 'cb_geocoder_cache'] loop
    if not (select c.relrowsecurity from pg_class c where c.oid = ('public.' || v_tbl)::regclass) then
      raise exception 'stage14 assertion: row level security is not enabled on %', v_tbl;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_tbl) then
      raise exception 'stage14 assertion: % must have no policy', v_tbl;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_table_privilege(v_role, 'public.' || v_tbl, 'select,insert,update,delete,truncate,references,trigger')
         or has_any_column_privilege(v_role, 'public.' || v_tbl, 'select,insert,update,references') then
        raise exception 'stage14 assertion: % has a privilege on %', v_role, v_tbl;
      end if;
    end loop;
    if exists (select 1 from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x
               where c.oid = ('public.' || v_tbl)::regclass and x.grantee = 0) then
      raise exception 'stage14 assertion: PUBLIC has a privilege on %', v_tbl;
    end if;
    if not (has_table_privilege('service_role', 'public.' || v_tbl, 'select')
            and has_table_privilege('service_role', 'public.' || v_tbl, 'insert')
            and has_table_privilege('service_role', 'public.' || v_tbl, 'update')
            and has_table_privilege('service_role', 'public.' || v_tbl, 'delete')) then
      raise exception 'stage14 assertion: service_role cannot read and write %', v_tbl;
    end if;
  end loop;

  -- Geocoder functions: SECURITY DEFINER, empty search_path, service_role only.
  foreach v_fn in array array['public.cb_geocoder_take_slot(integer)', 'public.cb_geocoder_purge_cache()'] loop
    if not exists (
      select 1 from pg_proc p
      where p.oid = v_fn::regprocedure and p.prosecdef
        and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')
    ) then
      raise exception 'stage14 assertion: % is not SECURITY DEFINER with an empty search_path', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'execute') then
      raise exception 'stage14 assertion: service_role cannot execute %', v_fn;
    end if;
    foreach v_role in array array['anon', 'authenticated'] loop
      if has_function_privilege(v_role, v_fn, 'execute') then
        raise exception 'stage14 assertion: % can execute %', v_role, v_fn;
      end if;
    end loop;
    if exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
               where p.oid = v_fn::regprocedure and x.grantee = 0) then
      raise exception 'stage14 assertion: PUBLIC can execute %', v_fn;
    end if;
  end loop;

  -- Throttle: exactly one row. Cache: no user column, HMAC key and 24 hour checks.
  if (select count(*) from public.cb_geocoder_throttle) <> 1 then
    raise exception 'stage14 assertion: cb_geocoder_throttle must hold exactly one row';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'cb_geocoder_cache'
               and (column_name ilike '%user%' or column_name ilike '%uid%' or column_name ilike '%email%'
                    or column_name ilike '%author%')) then
    raise exception 'stage14 assertion: cb_geocoder_cache has a user-identifying column';
  end if;
  if (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'cb_geocoder_cache') is distinct from 'created_at,expires_at,key_hash,results' then
    raise exception 'stage14 assertion: cb_geocoder_cache must have exactly key_hash, results, created_at, expires_at';
  end if;
  if not exists (select 1 from pg_constraint k where k.conrelid = 'public.cb_geocoder_cache'::regclass and k.contype = 'c'
                 and pg_get_constraintdef(k.oid) like '%24:00:00%')
     or not exists (select 1 from pg_constraint k where k.conrelid = 'public.cb_geocoder_cache'::regclass and k.contype = 'c'
                    and pg_get_constraintdef(k.oid) like '%0-9a-f%') then
    raise exception 'stage14 assertion: the cache expiry or key check constraint is missing';
  end if;
end $$;

commit;

-- Check (read-only). Compare with the preflight: same rows, same md5.
select (select count(*) from public.postings) as postings_rows,
       (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
          from public.postings p) as postings_md5,
       (select count(*) from public.postings where location_precision = 'unreviewed') as unreviewed_rows,
       (select count(*) from public.cb_geocoder_throttle) as throttle_rows;
