-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 14 (posting location confirmation) - PREFLIGHT (run BEFORE the migration)
--
-- Spec: .kiro/specs/posting-location-confirmation (Requirements 13, 16, 19, 20).
--
-- Read-only: one SELECT inside a READ ONLY transaction. It changes no row, table
-- or function. Save the output. The two values you compare after the migration are
-- the postings row count and the postings md5 (section 'data').
--
-- Run order (owner, after review):
--   1. this file                                          read-only, BEFORE; save the output
--   2. supabase/stage14_posting_location.sql              the migration
--   3. supabase/stage14_posting_location_verify.sql       AFTER; ALL CHECKS PASS (rolls itself back)
--   (supabase/stage14_posting_location_rollback.sql undoes step 2; run it only after the code is rolled back)
--
-- What it reports:
--   dependency   the tables, columns, functions and roles the migration needs
--                (a 'false' here = stop; the migration refuses to start too)
--   target       whether any stage 14 object already exists. Expected: every row 'false'.
--                If one is 'true' the migration is partly applied or was applied before:
--                it is written to be re-runnable, but read the rows before you run it
--   data         postings row count, and the md5 over id, lat, lng, place_label, time_zone
--                ordered by id (no existing row may change; the migration recomputes the
--                same md5 and refuses to finish when it differs), and the rows that would
--                read 'unreviewed' after the migration (= all of them)
--   grant        the postings columns that 'authenticated' and 'anon' may INSERT today.
--                Expected: authenticated = the stage 8 list below, anon = none, and
--                'matches stage 8 list' = true. If it is false the migration stops before
--                it changes anything, so that its re-grant cannot drop a column
--                Stage 8 list: author_id, title, body, category_id, rsvp_url, event_date,
--                event_time, end_date, end_time, time_zone, place_label, lat, lng, expiry,
--                expires_at
--   info         existing triggers on postings (stage 8 publish defaults is expected)
--
-- Expected on a database where the migration has not been applied:
--   dependency rows all 'true'; target rows all 'false'; grant 'matches stage 8 list' = true.

begin transaction read only;

with
dep as (
  select 'dependency'::text as section, t.name as item, (to_regclass('public.' || t.name) is not null)::text as detail
  from (values ('postings')) as t(name)
  union all
  select 'dependency', 'column postings.' || c.col,
         exists (select 1 from information_schema.columns i
                 where i.table_schema = 'public' and i.table_name = 'postings' and i.column_name = c.col)::text
  from (values ('id'), ('author_id'), ('lat'), ('lng'), ('place_label'), ('time_zone'), ('expires_at'),
               ('event_date'), ('end_date'), ('end_time'), ('deleted_at'), ('moderation_hidden_at')) as c(col)
  union all
  select 'dependency', 'function ' || f.sig, (to_regprocedure(f.sig) is not null)::text
  from (values ('public.cb_safe_time_zone(text)'),
               ('public.posting_takedown_at(timestamptz,date,date,time,text)')) as f(sig)
  union all
  select 'dependency', 'role ' || r.name, exists (select 1 from pg_roles where rolname = r.name)::text
  from (values ('anon'), ('authenticated'), ('service_role')) as r(name)
),
target as (
  select 'target'::text, 'column postings.location_precision exists',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision')::text
  union all
  select 'target', 'constraint postings_location_precision_check exists',
         exists (select 1 from pg_constraint
                 where conname = 'postings_location_precision_check' and conrelid = 'public.postings'::regclass)::text
  union all
  select 'target', 'function ' || f.sig || ' exists', (to_regprocedure(f.sig) is not null)::text
  from (values ('public.cb_update_posting_location(uuid,double precision,double precision,text,text)'),
               ('public.cb_geocoder_take_slot(integer)'),
               ('public.cb_geocoder_purge_cache()')) as f(sig)
  union all
  select 'target', 'table ' || t.name || ' exists', (to_regclass('public.' || t.name) is not null)::text
  from (values ('cb_geocoder_throttle'), ('cb_geocoder_cache')) as t(name)
),
data as (
  select 'data'::text, 'postings rows',
         case when to_regclass('public.postings') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.postings', false, true, '')))[1]::text end
  union all
  select 'data', 'postings md5 (id, lat, lng, place_label, time_zone, ordered by id)',
         case when to_regclass('public.postings') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml(
                'select md5(coalesce(string_agg(format(''%s|%s|%s|%s|%s'', id, lat, lng, place_label, time_zone), E''\n'' order by id), '''')) as c from public.postings',
                false, true, '')))[1]::text end
  union all
  select 'data', 'rows that will read unreviewed after the migration (expect = postings rows)',
         case when to_regclass('public.postings') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.postings', false, true, '')))[1]::text end
),
grants as (
  select 'grant'::text, 'authenticated may INSERT these postings columns',
         coalesce((select string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                   from pg_attribute a
                   where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
                     and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')), 'none')
  union all
  select 'grant', 'anon may INSERT these postings columns (expect none)',
         coalesce((select string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                   from pg_attribute a
                   where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
                     and has_column_privilege('anon', a.attrelid, a.attnum, 'insert')), 'none')
  union all
  select 'grant', 'authenticated has a table-wide INSERT on postings (expect false)',
         has_table_privilege('authenticated', 'public.postings', 'insert')::text
  union all
  select 'grant', 'matches stage 8 list (expect true; location_precision ignored)',
         (not exists (
            select 1 from unnest(array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                                       'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at']) as s(col)
            where not has_column_privilege('authenticated', 'public.postings', s.col, 'insert'))
          and not exists (
            select 1 from pg_attribute a
            where a.attrelid = 'public.postings'::regclass and a.attnum > 0 and not a.attisdropped
              and a.attname::text <> 'location_precision'
              and a.attname::text <> all (array['author_id', 'title', 'body', 'category_id', 'rsvp_url', 'event_date', 'event_time',
                                                'end_date', 'end_time', 'time_zone', 'place_label', 'lat', 'lng', 'expiry', 'expires_at'])
              and has_column_privilege('authenticated', a.attrelid, a.attnum, 'insert')))::text
),
trig as (
  select 'info'::text, 'trigger ' || t.tgname || ' on postings', pg_get_triggerdef(t.oid)
  from pg_trigger t
  where t.tgrelid = 'public.postings'::regclass and not t.tgisinternal
)
select * from dep
union all select * from target
union all select * from data
union all select * from grants
union all select * from trig
order by 1, 2;

rollback;
