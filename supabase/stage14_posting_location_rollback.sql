-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 14 - Posting location confirmation - ROLLBACK
-- Spec: .kiro/specs/posting-location-confirmation (Requirements 16.2, 16.3).
--
-- Drops ONLY what stage14_posting_location.sql created:
--   - function public.cb_update_posting_location(uuid, double precision, double precision, text, text)
--   - function public.cb_geocoder_take_slot(integer)
--   - function public.cb_geocoder_purge_cache()
--   - table    public.cb_geocoder_cache (its index and constraints go with it)
--   - table    public.cb_geocoder_throttle
--   - column   public.postings.location_precision (its check constraint goes with it)
-- and restores the stage 8 INSERT grant for authenticated EXACTLY (the stage 8 list,
-- without location_precision). Nothing else is touched: no other table, policy,
-- trigger, function or privilege, and no value in any other postings column.
--
-- SAFE ORDER (important): roll the CODE back first, then run this file.
--   The new code writes location_precision on publish and calls cb_update_posting_location.
--   If this file runs while the new code is still deployed, publishing and the edit-save
--   location call fail. Old code ignores the column and never calls the functions, so
--   old code on the rolled-back database is fine. Order: 1. redeploy the old code,
--   2. run this file. (Applying is the reverse: migration first, then code.)
--
-- WHAT IS LOST (cannot be recovered from the database afterwards):
--   - Every postings.location_precision value ('exact' / 'approximate' / 'unreviewed').
--     The column is dropped. If the migration is applied again later, every posting reads
--     'unreviewed' again, including those the poster had confirmed or marked approximate.
--     The lat and lng values the posters chose stay as they are (they are not touched);
--     only the label saying how precise they are is lost.
--   - All cb_geocoder_cache rows (a cache of public map search results, at most 24 hours
--     old; searches simply go to the geocoder again) and the cb_geocoder_throttle state
--     (one timestamp; the next call starts a fresh 1100 ms spacing).
--   Nothing a poster typed is lost, and no posting, reply, like or message is deleted.
--
-- Proof inside this file: before any change it records the row count, the md5 of
-- (id, lat, lng, place_label, time_zone) that the preflight prints, an md5 over every
-- existing column (to_jsonb minus location_precision), an md5 of the column privileges on
-- every column except location_precision, and an md5 of the postings policies. After the
-- drops it recomputes all four and raises (rolling the whole transaction back) on any
-- difference. It also asserts that every stage 14 object is gone and that authenticated's
-- INSERT columns are exactly the stage 8 list.
--
-- Safe to run twice: every drop is "if exists" and the grant is the same statement each time.
-- Refuses to start (nothing changed) when the authenticated INSERT columns are neither the
-- stage 8 list nor the stage 8 list plus location_precision, so it cannot silently remove
-- a grant a later stage added. One transaction: any error leaves nothing changed.
--
-- Caution: if any of these objects existed BEFORE stage 14 (the preflight
-- stage14_posting_location_preflight.sql expects them all absent and fails otherwise),
-- this file would drop them too. Do not run it in that case.

begin;

-- 0. Starting state and snapshot. Nothing is changed before this passes.
do $$
declare
  v_stage8 text[] := array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                           'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at'];
  v_missing text;
  v_extra text;
begin
  if to_regclass('public.postings') is null then
    raise exception 'stage14 rollback: public.postings must exist (nothing was changed)';
  end if;

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
    raise exception 'stage14 rollback: authenticated INSERT columns on postings are neither the stage 8 list nor that list plus location_precision (missing: %, extra: %); review before running (nothing was changed)',
      coalesce(v_missing, 'none'), coalesce(v_extra, 'none');
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14 rollback: anon has an INSERT privilege on postings; review before running (nothing was changed)';
  end if;
  if has_table_privilege('authenticated', 'public.postings', 'insert') then
    raise exception 'stage14 rollback: authenticated has a table-wide INSERT on postings; review before running (nothing was changed)';
  end if;

  perform set_config('cb.s14r_rows', (select count(*)::text from public.postings), true);
  perform set_config('cb.s14r_md5_a',
    (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
       from public.postings p), true);
  perform set_config('cb.s14r_md5_b',
    (select md5(coalesce(string_agg((to_jsonb(p) - 'location_precision')::text, E'\n' order by p.id), ''))
       from public.postings p), true);
  perform set_config('cb.s14r_acl',
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
  perform set_config('cb.s14r_policies',
    (select md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                    '|' order by p.policyname), ''))
       from pg_policies p where p.schemaname = 'public' and p.tablename = 'postings'), true);
end $$;

-- 1. Functions first, then tables (no object depends on another here; this order is just tidy).
drop function if exists public.cb_update_posting_location(uuid, double precision, double precision, text, text);
drop function if exists public.cb_geocoder_take_slot(integer);
drop function if exists public.cb_geocoder_purge_cache();
drop table if exists public.cb_geocoder_cache;
drop table if exists public.cb_geocoder_throttle;

-- 2. Restore the stage 8 INSERT grant exactly (same statements as stage8_moderation.sql),
--    then drop the column. No CASCADE: if anything depends on the column, the drop fails
--    and the whole transaction rolls back instead of removing that object.
revoke insert on public.postings from anon, authenticated;
grant insert (author_id, title, body, category_id, rsvp_url, event_date, event_time, end_date, end_time,
              time_zone, place_label, lat, lng, expiry, expires_at)
  on public.postings to authenticated;

alter table public.postings drop column if exists location_precision;

-- 3. Assertions on the ACTUAL resulting state. Any failure raises and rolls everything back.
do $$
declare
  v_stage8 text[] := array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                           'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at'];
  v_acl text;
begin
  -- Every stage 14 object is gone.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision') then
    raise exception 'stage14 rollback assertion: postings.location_precision still exists';
  end if;
  if exists (select 1 from pg_constraint where conname = 'postings_location_precision_check') then
    raise exception 'stage14 rollback assertion: postings_location_precision_check still exists';
  end if;
  if to_regclass('public.cb_geocoder_cache') is not null or to_regclass('public.cb_geocoder_throttle') is not null then
    raise exception 'stage14 rollback assertion: a geocoder table still exists';
  end if;
  if exists (select 1 from pg_proc
             where pronamespace = 'public'::regnamespace
               and proname in ('cb_update_posting_location', 'cb_geocoder_take_slot', 'cb_geocoder_purge_cache')) then
    raise exception 'stage14 rollback assertion: a stage 14 function still exists';
  end if;

  -- INSERT columns for authenticated = the stage 8 list, nothing else; anon none.
  if exists (select 1 from unnest(v_stage8) as s(col)
             where not has_column_privilege('authenticated', 'public.postings', s.col, 'insert')) then
    raise exception 'stage14 rollback assertion: authenticated is missing a stage 8 INSERT column';
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and a.attname::text <> all (v_stage8)
               and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14 rollback assertion: authenticated has an INSERT column outside the stage 8 list';
  end if;
  if has_table_privilege('authenticated', 'public.postings', 'insert') then
    raise exception 'stage14 rollback assertion: authenticated has a table-wide INSERT on postings';
  end if;
  if exists (select 1 from pg_attribute a
             where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
               and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')) then
    raise exception 'stage14 rollback assertion: anon has an INSERT privilege on postings';
  end if;

  -- Existing rows, column privileges and policies are unchanged.
  if (select count(*)::text from public.postings) is distinct from current_setting('cb.s14r_rows') then
    raise exception 'stage14 rollback assertion: the postings row count changed';
  end if;
  if (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
        from public.postings p) is distinct from current_setting('cb.s14r_md5_a') then
    raise exception 'stage14 rollback assertion: id, lat, lng, place_label or time_zone of a posting changed';
  end if;
  if (select md5(coalesce(string_agg(to_jsonb(p)::text, E'\n' order by p.id), ''))
        from public.postings p) is distinct from current_setting('cb.s14r_md5_b') then
    raise exception 'stage14 rollback assertion: a column value of a posting changed';
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
  if v_acl is distinct from current_setting('cb.s14r_acl') then
    raise exception 'stage14 rollback assertion: a column privilege on an existing postings column changed';
  end if;
  if (select md5(coalesce(string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                     '|' order by p.policyname), ''))
        from pg_policies p where p.schemaname = 'public' and p.tablename = 'postings')
     is distinct from current_setting('cb.s14r_policies') then
    raise exception 'stage14 rollback assertion: a postings policy changed';
  end if;
end $$;

commit;

-- Check (read-only). Expect 0, 0, 0, 0 and the same rows and md5 as the preflight.
select (select count(*) from information_schema.columns
         where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision') as precision_columns,
       (select count(*) from pg_class where relnamespace = 'public'::regnamespace
          and relname in ('cb_geocoder_cache', 'cb_geocoder_throttle')) as geocoder_tables,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('cb_update_posting_location', 'cb_geocoder_take_slot', 'cb_geocoder_purge_cache')) as functions,
       (select count(*) from pg_constraint where conname = 'postings_location_precision_check') as constraints,
       (select count(*) from public.postings) as postings_rows,
       (select md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', p.id, p.lat, p.lng, p.place_label, p.time_zone), E'\n' order by p.id), ''))
          from public.postings p) as postings_md5;
