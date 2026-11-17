-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 14 - Posting location confirmation - VERIFY (APPLICATION ROLES)
-- Spec: .kiro/specs/posting-location-confirmation (Requirements 13, 16, 20).
-- Run AFTER stage14_posting_location.sql (run it right after the migration: check V2
-- expects every pre-existing posting to still read 'unreviewed').
--
-- Checks anon, authenticated (author and another user) and service_role, running each
-- statement as the role the app uses, with JWT claims set the way PostgREST sets them.
--
-- Disposable fixtures (created inside this script, no password, undeliverable email):
--   users     6c5e0000-0000-4000-8000-0000000014aa  cb_s14t_a  author
--             6c5e0000-0000-4000-8000-0000000014ab  cb_s14t_b  another user
--   postings  6c5e0000-0000-4000-8000-0000000014a1  active, visible (author A)
--             6c5e0000-0000-4000-8000-0000000014a2  ended (event day 3 days ago)
--             6c5e0000-0000-4000-8000-0000000014a3  hidden by moderation
--             6c5e0000-0000-4000-8000-0000000014a4  deleted
--   cache     key_hash = repeat('a'..'f', 64)
-- Refuses to start if any exist. The whole script is ONE transaction that ENDS WITH
-- ROLLBACK, so no data is left changed (the last result set is read before the rollback;
-- an extra check also proves the pre-existing postings are the same after the fixtures
-- are removed: same md5 as the preflight prints).
--
-- Result: one row per check, with pass = true or false. The first row (n = 0) is the
-- overall result 'ALL CHECKS PASS': every check must be pass = true.

begin;

create temp table cb_s14r (n serial, check_name text, accept text[], actual text);

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
-- A failed statement rolls back inside its own sub-transaction.
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
returns void language sql as $f$ insert into cb_s14r (check_name, accept, actual) values (p_name, p_accept, p_actual) $f$;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-0000000014aa';
  v_b constant uuid := '6c5e0000-0000-4000-8000-0000000014ab';
  ids constant uuid[] := array['6c5e0000-0000-4000-8000-0000000014aa', '6c5e0000-0000-4000-8000-0000000014ab']::uuid[];
  p_act constant uuid := '6c5e0000-0000-4000-8000-0000000014a1';
  p_end constant uuid := '6c5e0000-0000-4000-8000-0000000014a2';
  p_hid constant uuid := '6c5e0000-0000-4000-8000-0000000014a3';
  p_del constant uuid := '6c5e0000-0000-4000-8000-0000000014a4';
  pids constant uuid[] := array['6c5e0000-0000-4000-8000-0000000014a1', '6c5e0000-0000-4000-8000-0000000014a2',
                                '6c5e0000-0000-4000-8000-0000000014a3', '6c5e0000-0000-4000-8000-0000000014a4']::uuid[];
  keys constant text[] := array[repeat('a', 64), repeat('b', 64), repeat('c', 64), repeat('d', 64), repeat('e', 64), repeat('f', 64)];
  v_cat smallint;
  before_hash text; after_hash text;
  v_notunrev bigint;
  v_rows bigint;
  h1 text; h2 text; h3 text;
  t text; t1 text; t2 text; t3 text;
  s1 timestamptz; s2 timestamptz; s3 timestamptz;
  n0 timestamptz; n1 timestamptz; n2 timestamptz;
  v_expired bigint;
  hash_sql constant text :=
    'select md5(coalesce(string_agg(format(''%s|%s|%s|%s|%s'', id, lat, lng, place_label, time_zone), E''\n'' order by id), '''')) from public.postings';
  fn_upd constant text := 'public.cb_update_posting_location(uuid, double precision, double precision, text, text)';
begin
  if to_regclass('public.cb_geocoder_cache') is null or to_regclass('public.cb_geocoder_throttle') is null
     or to_regprocedure(fn_upd) is null
     or to_regprocedure('public.cb_geocoder_take_slot(integer)') is null
     or to_regprocedure('public.cb_geocoder_purge_cache()') is null
     or not exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision') then
    raise exception 'Stage 14 is not applied (location_precision or a geocoder object is missing). Nothing was changed.';
  end if;
  if exists (select 1 from auth.users where id = any (ids) or email like 'cb-s14t-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (ids) or username like 'cb\_s14t\_%')
     or exists (select 1 from public.postings where id = any (pids))
     or exists (select 1 from public.cb_geocoder_cache where key_hash = any (keys)) then
    raise exception 'Stage 14 test accounts, postings or cache rows already exist. Nothing was changed.';
  end if;

  execute hash_sql into before_hash;       -- the value the preflight prints
  select count(*) into v_rows from public.postings;
  select next_slot_at into n0 from public.cb_geocoder_throttle;
  select count(*) into v_notunrev from public.postings where location_precision <> 'unreviewed';

  -- Fixtures (as the migration owner).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'cb-s14t-' || u.k || '@corkback-test.invalid', '', '{}',
         json_build_object('username', 'cb_s14t_' || u.k)::jsonb, now(), now()
    from (values (v_a, 'a'), (v_b, 'b')) as u(id, k);
  insert into public.profiles (id, username)
  select u.id, 'cb_s14t_' || u.k from (values (v_a, 'a'), (v_b, 'b')) as u(id, k)
  on conflict (id) do nothing;

  select id into v_cat from public.categories order by id limit 1;
  insert into public.postings (id, author_id, title, category_id, place_label, lat, lng, expiry, expires_at, time_zone)
  values (p_act, v_a, '[TEST] s14 active', v_cat, 'Fixture place', 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles');
  insert into public.postings (id, author_id, title, category_id, place_label, lat, lng, expiry, expires_at, time_zone, event_date)
  values (p_end, v_a, '[TEST] s14 ended', v_cat, 'Fixture place', 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', current_date - 3);
  insert into public.postings (id, author_id, title, category_id, place_label, lat, lng, expiry, expires_at, time_zone, moderation_hidden_at)
  values (p_hid, v_a, '[TEST] s14 hidden', v_cat, 'Fixture place', 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', now());
  insert into public.postings (id, author_id, title, category_id, place_label, lat, lng, expiry, expires_at, time_zone, deleted_at)
  values (p_del, v_a, '[TEST] s14 deleted', v_cat, 'Fixture place', 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', now());

  -- ---------------- existing data ----------------
  perform pg_temp.rec('V1 the postings md5 over id, lat, lng, place_label, time_zone read at the start is a 32-hex value (the same formula the preflight prints; compared again in V60)',
    array['true'], (before_hash ~ '^[0-9a-f]{32}$')::text);
  perform pg_temp.rec('V2 every pre-existing posting reads unreviewed (rows that do not: 0)', array['0'], v_notunrev::text);

  -- ---------------- static: column, constraint, privileges ----------------
  perform pg_temp.rec('V3 postings.location_precision is text, not null, default unreviewed',
    array['text/NO/true'],
    (select c.data_type || '/' || c.is_nullable || '/' || (c.column_default like '''unreviewed''%')::text
       from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'postings' and c.column_name = 'location_precision'));
  perform pg_temp.rec('V4 a posting inserted without a precision reads unreviewed (the fixtures)', array['4'],
    (select count(*)::text from public.postings where id = any (pids) and location_precision = 'unreviewed'));
  perform pg_temp.rec('V5 the check constraint refuses an unknown precision and accepts the three values',
    array['23514/ok/ok/ok'],
    pg_temp.try_sql(format('update public.postings set location_precision = %L where id = %L', 'bogus', p_act)) || '/'
    || pg_temp.try_sql(format('update public.postings set location_precision = %L where id = %L', 'exact', p_act)) || '/'
    || pg_temp.try_sql(format('update public.postings set location_precision = %L where id = %L', 'approximate', p_act)) || '/'
    || pg_temp.try_sql(format('update public.postings set location_precision = %L where id = %L', 'unreviewed', p_act)));
  perform pg_temp.rec('V6 authenticated may INSERT exactly the stage 8 list plus location_precision (columns missing / extra), no table-wide INSERT',
    array['0/0/false'],
    (select count(*)::text from unnest(array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                                             'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at',
                                             'location_precision']) as s(col)
      where not has_column_privilege('authenticated', 'public.postings', s.col, 'insert')) || '/'
    || (select count(*)::text from pg_attribute a
         where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
           and a.attname::text <> all (array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                                             'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at',
                                             'location_precision'])
           and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')) || '/'
    || has_table_privilege('authenticated', 'public.postings', 'insert')::text);
  perform pg_temp.rec('V7 anon has no INSERT on any postings column; neither role can UPDATE location_precision, lat, lng or time_zone',
    array['0/false'],
    (select count(*)::text from pg_attribute a
      where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
        and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')) || '/'
    || (select bool_or(has_column_privilege(r.role, 'public.postings', c.col, 'update'))::text
          from (values ('anon'), ('authenticated')) as r(role),
               (values ('location_precision'), ('lat'), ('lng'), ('time_zone')) as c(col)));
  perform pg_temp.rec('V8 cb_update_posting_location is security definer with an empty search_path; authenticated only (not anon, service_role or PUBLIC)',
    array['true/true/true/false/false/false'],
    (select p.prosecdef::text || '/'
            || exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')::text || '/'
            || has_function_privilege('authenticated', p.oid, 'execute')::text || '/'
            || has_function_privilege('anon', p.oid, 'execute')::text || '/'
            || has_function_privilege('service_role', p.oid, 'execute')::text || '/'
            || exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0)::text
       from pg_proc p where p.oid = fn_upd::regprocedure));

  -- ---------------- cb_update_posting_location: author ----------------
  t := pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 40.5, -73.25, %L, %L)', p_act, 'Europe/Paris', 'approximate'));
  perform pg_temp.rec('V9 the author changes an active posting: returns updated; lat, lng, zone and precision all written',
    array['updated/40.5/-73.25/Europe/Paris/approximate'],
    t || '/' || (select p.lat || '/' || p.lng || '/' || p.time_zone || '/' || p.location_precision from public.postings p where p.id = p_act));
  t := pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, -33.5, 151.25, %L, %L)', p_act, 'Not/AZone', 'exact'));
  perform pg_temp.rec('V10 an unsafe time zone is stored as null (precision exact)', array['updated/-33.5/151.25/null/exact'],
    t || '/' || (select p.lat || '/' || p.lng || '/' || coalesce(p.time_zone, 'null') || '/' || p.location_precision from public.postings p where p.id = p_act));
  t := pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 90, 180, null, %L)', p_act, 'approximate'));
  perform pg_temp.rec('V11 the range limits (90, 180) and a null zone are accepted', array['updated/90/180/null/approximate'],
    t || '/' || (select p.lat || '/' || p.lng || '/' || coalesce(p.time_zone, 'null') || '/' || p.location_precision from public.postings p where p.id = p_act));
  t := pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, -90, -180, %L, %L)', p_act, 'America/Los_Angeles', 'exact'));
  perform pg_temp.rec('V12 the other range limits (-90, -180) are accepted', array['updated/-90/-180/America/Los_Angeles/exact'],
    t || '/' || (select p.lat || '/' || p.lng || '/' || coalesce(p.time_zone, 'null') || '/' || p.location_precision from public.postings p where p.id = p_act));

  -- ---------------- refusals and atomicity ----------------
  select md5(to_jsonb(p)::text) into h1 from public.postings p where p.id = p_act;
  perform pg_temp.rec('V13 another user: CB404, and the row is unchanged',
    array['CB404/true'],
    pg_temp.run_as(v_b, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')) || '/'
    || ((select md5(to_jsonb(p)::text) from public.postings p where p.id = p_act) = h1)::text);
  perform pg_temp.rec('V14 a hidden posting, a deleted posting and an unknown posting id: CB404 for the author',
    array['CB404,CB404,CB404'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_hid, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_del, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(gen_random_uuid(), 10, 20, %L, %L)', 'Europe/Paris', 'exact')));
  select md5(to_jsonb(p)::text) into h2 from public.postings p where p.id = p_end;
  perform pg_temp.rec('V15 an ended posting: CB409 for the author, and the row is unchanged',
    array['CB409/true'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_end, 'Europe/Paris', 'exact')) || '/'
    || ((select md5(to_jsonb(p)::text) from public.postings p where p.id = p_end) = h2)::text);
  perform pg_temp.rec('V16 an ended posting for another user is CB404 (not CB409), so ended state is not disclosed',
    array['CB404'],
    pg_temp.run_as(v_b, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_end, 'Europe/Paris', 'exact')));
  perform pg_temp.rec('V17 hidden and deleted rows are unchanged after the refused calls',
    array['0'],
    (select count(*)::text from public.postings p
      where p.id in (p_hid, p_del) and (p.lat <> 37.8716 or p.lng <> -122.2727 or p.location_precision <> 'unreviewed')));
  perform pg_temp.rec('V18 NaN, Infinity, -Infinity, lat 90.0001, lat -90.0001, lng 180.0001, lng -180.0001: all 22023',
    array['22023,22023,22023,22023,22023,22023,22023'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, %L::double precision, 20, %L, %L)', p_act, 'NaN', 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, %L::double precision, %L, %L)', p_act, 'Infinity', 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, %L::double precision, 20, %L, %L)', p_act, '-Infinity', 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 90.0001, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, -90.0001, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 180.0001, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, -180.0001, %L, %L)', p_act, 'Europe/Paris', 'exact')));
  perform pg_temp.rec('V19 precision unreviewed, an unknown precision and a null precision: all 22023',
    array['22023,22023,22023'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'unreviewed')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'bogus')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, null)', p_act, 'Europe/Paris')));
  perform pg_temp.rec('V20 a null latitude, a null longitude and a null posting id: all 22023',
    array['22023,22023,22023'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, null, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(%L, 10, null, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.cb_update_posting_location(null, 10, 20, %L, %L)', 'Europe/Paris', 'exact')));
  perform pg_temp.rec('V21 atomic: after all the failed calls on the active posting (22023 and CB404) its whole row, every column, is unchanged',
    array['true'], ((select md5(to_jsonb(p)::text) from public.postings p where p.id = p_act) = h1)::text);
  perform pg_temp.rec('V22 a valid location with an invalid precision does not move lat, lng or time_zone (validation before the single UPDATE)',
    array['-90/-180/America/Los_Angeles/exact'],
    (select p.lat || '/' || p.lng || '/' || p.time_zone || '/' || p.location_precision from public.postings p where p.id = p_act));
  perform pg_temp.rec('V23 no signed-in user id (empty claims) is refused; anon cannot execute', array['42501,42501'],
    pg_temp.run_as(null, 'authenticated', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')) || ','
    || pg_temp.run_as(null, 'anon', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')));
  perform pg_temp.rec('V24 service_role cannot execute cb_update_posting_location', array['42501'],
    pg_temp.run_as(null, 'service_role', format('select public.cb_update_posting_location(%L, 10, 20, %L, %L)', p_act, 'Europe/Paris', 'exact')));
  perform pg_temp.rec('V25 the row after the refusals still holds the last accepted location (V12)', array['true'],
    ((select md5(to_jsonb(p)::text) from public.postings p where p.id = p_act) = h1)::text);

  -- ---------------- direct writes to postings ----------------
  perform pg_temp.rec('V26 a direct UPDATE of lat, of time_zone and of location_precision by the author is refused',
    array['42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set lat = 1 where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set time_zone = %L where id = %L returning 1) select count(*)::text from x', 'Europe/Paris', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set location_precision = %L where id = %L returning 1) select count(*)::text from x', 'exact', p_act)));
  perform pg_temp.rec('V27 a direct UPDATE of lng and of lat and lng together by the author is refused, and anon is refused too',
    array['42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set lng = 1 where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set lat = 1, lng = 1 where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(null, 'anon', format('with x as (update public.postings set lat = 1 where id = %L returning 1) select count(*)::text from x', p_act)));
  perform pg_temp.rec('V28 the row is still unchanged after the direct updates', array['true'],
    ((select md5(to_jsonb(p)::text) from public.postings p where p.id = p_act) = h1)::text);
  perform pg_temp.rec('V29 authenticated can still INSERT a posting with a precision, the default reads unreviewed, an unknown precision is refused, anon is refused',
    array['approximate/unreviewed/23514/42501'],
    pg_temp.run_as(v_a, 'authenticated', format($q$with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, place_label, location_precision)
        values (%L, '[TEST] s14 direct insert', %L, 1, 2, '24h', now() + interval '1 day', 'Fixture place', 'approximate') returning location_precision)
        select max(location_precision) from x$q$, v_a, v_cat)) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format($q$with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, place_label)
        values (%L, '[TEST] s14 direct insert default', %L, 1, 2, '24h', now() + interval '1 day', 'Fixture place') returning location_precision)
        select max(location_precision) from x$q$, v_a, v_cat)) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format($q$with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, place_label, location_precision)
        values (%L, '[TEST] s14 direct insert bad', %L, 1, 2, '24h', now() + interval '1 day', 'Fixture place', 'bogus') returning 1)
        select count(*)::text from x$q$, v_a, v_cat)) || '/'
    || pg_temp.run_as(null, 'anon', format($q$with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, place_label)
        values (%L, '[TEST] s14 anon insert', %L, 1, 2, '24h', now() + interval '1 day', 'Fixture place') returning 1)
        select count(*)::text from x$q$, v_a, v_cat)));

  -- ---------------- geocoder objects: structure ----------------
  perform pg_temp.rec('V30 both geocoder tables: row level security on, no policy in pg_policies',
    array['true/true/0'],
    (select bool_and(c.relrowsecurity)::text from pg_class c where c.oid in ('public.cb_geocoder_throttle'::regclass, 'public.cb_geocoder_cache'::regclass)) || '/'
    || (select (count(*) = 2)::text from pg_class c where c.oid in ('public.cb_geocoder_throttle'::regclass, 'public.cb_geocoder_cache'::regclass))
    || '/' || (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('cb_geocoder_throttle', 'cb_geocoder_cache')));
  perform pg_temp.rec('V31 anon and authenticated hold no privilege (table or column) on either geocoder table; PUBLIC holds none; service_role has select, insert, update, delete',
    array['false/false/true'],
    (select bool_or(has_table_privilege(r.role, t.tbl, 'select,insert,update,delete,truncate,references,trigger')
                    or has_any_column_privilege(r.role, t.tbl, 'select,insert,update,references'))::text
       from (values ('anon'), ('authenticated')) as r(role),
            (values ('public.cb_geocoder_throttle'), ('public.cb_geocoder_cache')) as t(tbl)) || '/'
    || (select bool_or(exists (select 1 from aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) x where x.grantee = 0))::text
          from pg_class c where c.oid in ('public.cb_geocoder_throttle'::regclass, 'public.cb_geocoder_cache'::regclass)) || '/'
    || (select bool_and(has_table_privilege('service_role', t.tbl, 'select') and has_table_privilege('service_role', t.tbl, 'insert')
                        and has_table_privilege('service_role', t.tbl, 'update') and has_table_privilege('service_role', t.tbl, 'delete'))::text
          from (values ('public.cb_geocoder_throttle'), ('public.cb_geocoder_cache')) as t(tbl)));
  perform pg_temp.rec('V32 both geocoder functions are security definer with an empty search_path; service_role only (not anon, authenticated or PUBLIC)',
    array['2/2/true/false/false'],
    (select count(*)::text from pg_proc p where p.oid in ('public.cb_geocoder_take_slot(integer)'::regprocedure, 'public.cb_geocoder_purge_cache()'::regprocedure)
        and p.prosecdef) || '/'
    || (select count(*)::text from pg_proc p where p.oid in ('public.cb_geocoder_take_slot(integer)'::regprocedure, 'public.cb_geocoder_purge_cache()'::regprocedure)
        and exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where replace(c, '"', '') = 'search_path=')) || '/'
    || (has_function_privilege('service_role', 'public.cb_geocoder_take_slot(integer)', 'execute')
        and has_function_privilege('service_role', 'public.cb_geocoder_purge_cache()', 'execute'))::text || '/'
    || (has_function_privilege('anon', 'public.cb_geocoder_take_slot(integer)', 'execute')
        or has_function_privilege('anon', 'public.cb_geocoder_purge_cache()', 'execute')
        or has_function_privilege('authenticated', 'public.cb_geocoder_take_slot(integer)', 'execute')
        or has_function_privilege('authenticated', 'public.cb_geocoder_purge_cache()', 'execute'))::text || '/'
    || (select bool_or(exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee = 0))::text
          from pg_proc p where p.oid in ('public.cb_geocoder_take_slot(integer)'::regprocedure, 'public.cb_geocoder_purge_cache()'::regprocedure)));
  perform pg_temp.rec('V33 cb_geocoder_cache has exactly key_hash, results, created_at, expires_at: no user, uid, email or author column',
    array['created_at,expires_at,key_hash,results/0'],
    (select string_agg(column_name, ',' order by column_name) from information_schema.columns
      where table_schema = 'public' and table_name = 'cb_geocoder_cache') || '/'
    || (select count(*)::text from information_schema.columns
         where table_schema = 'public' and table_name = 'cb_geocoder_cache'
           and (column_name ilike '%user%' or column_name ilike '%uid%' or column_name ilike '%email%' or column_name ilike '%author%')));
  perform pg_temp.rec('V34 cb_geocoder_throttle holds exactly one row', array['1'], (select count(*)::text from public.cb_geocoder_throttle));
  perform pg_temp.rec('V35 a second throttle row is impossible: id false violates the check, id true violates the primary key',
    array['23514/23505'],
    pg_temp.try_sql('insert into public.cb_geocoder_throttle (id) values (false)') || '/'
    || pg_temp.try_sql('insert into public.cb_geocoder_throttle (id) values (true)'));

  -- ---------------- geocoder objects: anon and authenticated are refused everywhere ----------------
  perform pg_temp.rec('V36 anon: select, insert, update, delete on cb_geocoder_cache', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.cb_geocoder_cache') || ','
    || pg_temp.run_as(null, 'anon', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[1], '[]'))
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (update public.cb_geocoder_cache set expires_at = now() returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (delete from public.cb_geocoder_cache returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V37 authenticated: select, insert, update, delete on cb_geocoder_cache', array['42501,42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', 'select count(*)::text from public.cb_geocoder_cache') || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[1], '[]'))
    || ',' || pg_temp.run_as(v_a, 'authenticated', 'with x as (update public.cb_geocoder_cache set expires_at = now() returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(v_a, 'authenticated', 'with x as (delete from public.cb_geocoder_cache returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V38 anon: select, insert, update, delete on cb_geocoder_throttle', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.cb_geocoder_throttle') || ','
    || pg_temp.run_as(null, 'anon', 'with x as (insert into public.cb_geocoder_throttle (id) values (true) returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (update public.cb_geocoder_throttle set next_slot_at = now() returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(null, 'anon', 'with x as (delete from public.cb_geocoder_throttle returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V39 authenticated: select, insert, update, delete on cb_geocoder_throttle', array['42501,42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', 'select count(*)::text from public.cb_geocoder_throttle') || ','
    || pg_temp.run_as(v_a, 'authenticated', 'with x as (insert into public.cb_geocoder_throttle (id) values (true) returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(v_a, 'authenticated', 'with x as (update public.cb_geocoder_throttle set next_slot_at = now() returning 1) select count(*)::text from x')
    || ',' || pg_temp.run_as(v_a, 'authenticated', 'with x as (delete from public.cb_geocoder_throttle returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V40 anon and authenticated execute cb_geocoder_take_slot and cb_geocoder_purge_cache', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.cb_geocoder_take_slot(1000)') || ','
    || pg_temp.run_as(null, 'anon', 'select public.cb_geocoder_purge_cache()::text') || ','
    || pg_temp.run_as(v_a, 'authenticated', 'select count(*)::text from public.cb_geocoder_take_slot(1000)') || ','
    || pg_temp.run_as(v_a, 'authenticated', 'select public.cb_geocoder_purge_cache()::text'));
  perform pg_temp.rec('V41 the refused calls took no slot and the throttle row did not move', array['true'],
    ((select t.next_slot_at from public.cb_geocoder_throttle t) = n0)::text);

  -- ---------------- geocoder objects: service_role access ----------------
  perform pg_temp.rec('V42 service_role reads the throttle row and updates it', array['1/1'],
    pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_throttle') || '/'
    || pg_temp.run_as(null, 'service_role', 'with x as (update public.cb_geocoder_throttle set next_slot_at = ''-infinity'' returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V43 service_role inserts, reads, updates and deletes a cache row', array['1,1,1,1,0'],
    pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[1], '[{"a":1}]')) || ','
    || pg_temp.run_as(null, 'service_role', format('select count(*)::text from public.cb_geocoder_cache where key_hash = %L', keys[1])) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (update public.cb_geocoder_cache set results = %L where key_hash = %L returning 1) select count(*)::text from x', '[]', keys[1])) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (delete from public.cb_geocoder_cache where key_hash = %L returning 1) select count(*)::text from x', keys[1])) || ','
    || (select count(*)::text from public.cb_geocoder_cache where key_hash = keys[1]));

  -- ---------------- cache constraints ----------------
  perform pg_temp.rec('V44 expiry: 25 hours after created_at is refused; exactly 24 hours is accepted; equal to created_at is refused; before created_at is refused',
    array['23514/1/23514/23514'],
    pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, created_at, expires_at) values (%L, %L, now(), now() + interval ''25 hours'') returning 1) select count(*)::text from x', keys[2], '[]')) || '/'
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, created_at, expires_at) values (%L, %L, now(), now() + interval ''24 hours'') returning 1) select count(*)::text from x', keys[2], '[]')) || '/'
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, created_at, expires_at) values (%L, %L, now(), now()) returning 1) select count(*)::text from x', keys[3], '[]')) || '/'
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, created_at, expires_at) values (%L, %L, now(), now() - interval ''1 hour'') returning 1) select count(*)::text from x', keys[3], '[]')));
  perform pg_temp.rec('V45 key_hash must be 64 lowercase hex: short, long, uppercase, non-hex are refused; a duplicate key is refused',
    array['23514,23514,23514,23514,23505'],
    pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', repeat('a', 63), '[]')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', repeat('a', 65), '[]')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', repeat('A', 64), '[]')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', repeat('g', 64), '[]')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[2], '[]')));
  perform pg_temp.rec('V46 results must be a jsonb array of at most 20000 bytes: an object, a string, null and an oversize array are refused',
    array['23514,23514,23502,23514'],
    pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[3], '{"a":1}')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, %L, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[3], '"text"')) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, null, now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[3])) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.cb_geocoder_cache (key_hash, results, expires_at) values (%L, (select jsonb_agg(repeat(''x'', 100)) from generate_series(1, 250)), now() + interval ''1 hour'') returning 1) select count(*)::text from x', keys[3])));
  perform pg_temp.rec('V47 an update that moves expires_at past 24 hours of created_at is refused, and the row keeps its value',
    array['23514/true'],
    pg_temp.run_as(null, 'service_role', format('with x as (update public.cb_geocoder_cache set expires_at = created_at + interval ''25 hours'' where key_hash = %L returning 1) select count(*)::text from x', keys[2])) || '/'
    || (select (expires_at <= created_at + interval '24 hours')::text from public.cb_geocoder_cache where key_hash = keys[2]));

  -- ---------------- cb_geocoder_take_slot ----------------
  update public.cb_geocoder_throttle set next_slot_at = '-infinity';
  t1 := pg_temp.run_as(null, 'service_role', 'select slot_at::text || ''|'' || wait_ms::text from public.cb_geocoder_take_slot(3000)');
  t2 := pg_temp.run_as(null, 'service_role', 'select slot_at::text || ''|'' || wait_ms::text from public.cb_geocoder_take_slot(3000)');
  t3 := pg_temp.run_as(null, 'service_role', 'select slot_at::text || ''|'' || wait_ms::text from public.cb_geocoder_take_slot(3000)');
  s1 := split_part(t1, '|', 1)::timestamptz; s2 := split_part(t2, '|', 1)::timestamptz; s3 := split_part(t3, '|', 1)::timestamptz;
  perform pg_temp.rec('V48 the first call on an idle throttle gets a slot now (wait at most 50 ms); the second waits about 1100 ms, the third about 2200 ms',
    array['true/true/true'],
    (split_part(t1, '|', 2)::integer <= 50)::text || '/'
    || (split_part(t2, '|', 2)::integer between 900 and 1100)::text || '/'
    || (split_part(t3, '|', 2)::integer between 2000 and 2200)::text);
  perform pg_temp.rec('V49 sequential calls get slots at least 1000 ms apart (1100 ms nominal)',
    array['true/true'],
    ((extract(epoch from (s2 - s1)) * 1000) >= 1000)::text || '/' || ((extract(epoch from (s3 - s2)) * 1000) >= 1000)::text);
  perform pg_temp.rec('V50 the third slot is about 2200 ms after the first (spacing is exactly 1100 ms, not more)',
    array['true'],
    ((extract(epoch from (s3 - s1)) * 1000) between 2200 and 2300)::text);
  select t.next_slot_at into n1 from public.cb_geocoder_throttle t;
  perform pg_temp.rec('V51 next_slot_at after three calls is the third slot plus 1100 ms', array['true'],
    ((extract(epoch from (n1 - s3)) * 1000) between 1099.9 and 1100.1)::text);

  update public.cb_geocoder_throttle set next_slot_at = clock_timestamp() + interval '10 seconds';
  select t.next_slot_at into n1 from public.cb_geocoder_throttle t;
  t1 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(3000)');
  select t.next_slot_at into n2 from public.cb_geocoder_throttle t;
  perform pg_temp.rec('V52 when the wait would exceed the bound: no row is returned, next_slot_at does not move', array['0/true'],
    t1 || '/' || (n1 = n2)::text);
  t1 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(0)');
  t2 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(-5)');
  t3 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(null)');
  perform pg_temp.rec('V53 a bound of 0, a negative bound and a null bound all behave as 0: no row while a slot is 10 s away', array['0,0,0'],
    t1 || ',' || t2 || ',' || t3);
  t1 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(1000000)');
  select t.next_slot_at into n2 from public.cb_geocoder_throttle t;
  perform pg_temp.rec('V54 the bound is capped at 5000 ms: a huge bound still gets no row when the slot is 10 s away, and nothing moves', array['0/true'],
    t1 || '/' || (n1 = n2)::text);
  update public.cb_geocoder_throttle set next_slot_at = clock_timestamp() + interval '4 seconds';
  t1 := pg_temp.run_as(null, 'service_role', 'select wait_ms::text from public.cb_geocoder_take_slot(1000000)');
  perform pg_temp.rec('V55 a slot 4 s away is granted under a huge bound, with a wait between 3500 and 5000 ms (the cap)', array['true'],
    (t1 ~ '^[0-9]+$' and t1::integer between 3500 and 5000)::text);
  update public.cb_geocoder_throttle set next_slot_at = clock_timestamp() + interval '6 seconds';
  t1 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(1000000)');
  perform pg_temp.rec('V56 a slot 6 s away is refused under a huge bound (cap 5000 ms)', array['0'], t1);
  update public.cb_geocoder_throttle set next_slot_at = clock_timestamp() + interval '2 seconds';
  select t.next_slot_at into n1 from public.cb_geocoder_throttle t;
  t1 := pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.cb_geocoder_take_slot(3000)');
  select t.next_slot_at into n2 from public.cb_geocoder_throttle t;
  perform pg_temp.rec('V57 a granted call moves next_slot_at forward by exactly 1100 ms and never backwards', array['1/true/true'],
    t1 || '/' || (n2 > n1)::text || '/' || ((extract(epoch from (n2 - n1)) * 1000) between 1099.9 and 1100.1)::text);

  -- ---------------- cb_geocoder_purge_cache ----------------
  delete from public.cb_geocoder_cache where key_hash = any (keys);
  insert into public.cb_geocoder_cache (key_hash, results, created_at, expires_at) values
    (keys[4], '[]', now() - interval '2 hours', now() - interval '1 hour'),     -- expired
    (keys[5], '[]', now(), now() + interval '1 hour'),                            -- fresh
    (keys[6], '[]', now() - interval '1 hour', now());                            -- expires exactly now: purged
  select count(*) into v_expired from public.cb_geocoder_cache where expires_at <= now();
  t := pg_temp.run_as(null, 'service_role', 'select public.cb_geocoder_purge_cache()::text');
  perform pg_temp.rec('V58 purge returns the number of expired rows it deleted', array[v_expired::text], t);
  perform pg_temp.rec('V59 purge deletes only expired rows: none expired left, the fresh fixture row is kept',
    array['0/1'],
    (select count(*)::text from public.cb_geocoder_cache where expires_at <= now()) || '/'
    || (select count(*)::text from public.cb_geocoder_cache where key_hash = keys[5]));

  -- ---------------- cleanup and no-change proof ----------------
  delete from public.cb_geocoder_cache where key_hash = any (keys);
  delete from public.postings where author_id = any (ids) or id = any (pids);
  delete from auth.users where id = any (ids);   -- cascades profiles

  execute hash_sql into after_hash;
  perform pg_temp.rec('V60 after the fixtures are removed, the postings md5 over id, lat, lng, place_label, time_zone equals the value read at the start (the preflight value)',
    array[before_hash], after_hash);
  perform pg_temp.rec('V61 the postings row count is the same as at the start', array[v_rows::text], (select count(*)::text from public.postings));
  perform pg_temp.rec('V62 no test accounts, postings or cache rows remain', array['0/0/0/0'],
    (select count(*)::text from auth.users where id = any (ids)) || '/' || (select count(*)::text from public.profiles where id = any (ids)) || '/'
    || (select count(*)::text from public.postings where author_id = any (ids) or id = any (pids)) || '/'
    || (select count(*)::text from public.cb_geocoder_cache where key_hash = any (keys)));
end;
$$;

select n, check_name, accept, actual, actual = any (accept) as pass
from (
  select 0 as n, 'ALL CHECKS PASS' as check_name, array['true'] as accept,
         coalesce(bool_and(actual = any (accept)), false)::text as actual
  from cb_s14r
  union all
  select n, check_name, accept, actual from cb_s14r
) s
order by n;

rollback;
