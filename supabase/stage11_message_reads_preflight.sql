-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 11 (message reads / unread) - PREFLIGHT (run BEFORE the migration)
--
-- Read-only: one SELECT inside a READ ONLY transaction. It changes no row, table
-- or function. Save the output.
--
-- Run order (owner, after review):
--   1. this file                                     read-only, BEFORE; save the output
--   2. supabase/stage11_message_reads.sql            the migration
--   3. supabase/stage11_message_reads_verify_roles.sql   AFTER; all pass = true (rolls itself back)
--   (supabase/stage11_message_reads_rollback.sql undoes step 2)
--
-- What it reports:
--   dependency   whether message_threads, messages and profiles exist, and whether
--                the columns the migration reads exist (a missing dependency = fail)
--   target       whether message_thread_reads already exists. If it does, the
--                migration keeps it as it is (create table if not exists) and then
--                refuses to finish unless its shape matches; the rollback would DROP it
--   backfill     how many (thread, participant) marker rows the migration will insert
--                (pairs that already have a marker are not counted)
--   info         existing function and policy names the migration would create
--
-- Expected on a database where the migration has not been applied:
--   dependency rows all 'true'; target message_thread_reads exists = false;
--   backfill rows to insert = 2 x the number of threads.

begin transaction read only;

with
dep as (
  select 'dependency'::text as section, t.name as item, (to_regclass('public.' || t.name) is not null)::text as detail
  from (values ('message_threads'), ('messages'), ('profiles')) as t(name)
  union all
  select 'dependency', 'column ' || c.tbl || '.' || c.col,
         exists (select 1 from information_schema.columns i
                 where i.table_schema = 'public' and i.table_name = c.tbl and i.column_name = c.col)::text
  from (values ('message_threads', 'id'), ('message_threads', 'user_lo'), ('message_threads', 'user_hi'),
               ('message_threads', 'created_at'), ('messages', 'id'), ('messages', 'thread_id'),
               ('messages', 'sender_id'), ('messages', 'created_at')) as c(tbl, col)
),
target as (
  select 'target', 'message_thread_reads exists', (to_regclass('public.message_thread_reads') is not null)::text
  union all
  select 'target', 'message_thread_reads rows',
         case when to_regclass('public.message_thread_reads') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.message_thread_reads', false, true, '')))[1]::text end
  union all
  select 'target', 'message_thread_reads columns',
         coalesce((select string_agg(column_name || ' ' || data_type, ', ' order by ordinal_position)
                   from information_schema.columns
                   where table_schema = 'public' and table_name = 'message_thread_reads'), 'n/a')
),
backfill as (
  select 'backfill', 'rows to insert (thread, participant pairs without a marker)',
         case when to_regclass('public.message_threads') is null then 'n/a'
              when to_regclass('public.message_thread_reads') is null then
                (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.message_threads t cross join lateral unnest(array[t.user_lo, t.user_hi]) u',
                  false, true, '')))[1]::text
              else
                (xpath('/row/c/text()', query_to_xml(
                  'select count(*) as c from public.message_threads t cross join lateral unnest(array[t.user_lo, t.user_hi]) u '
                  || 'where not exists (select 1 from public.message_thread_reads r where r.thread_id = t.id and r.user_id = u)',
                  false, true, '')))[1]::text
         end
  union all
  select 'backfill', 'threads',
         case when to_regclass('public.message_threads') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.message_threads', false, true, '')))[1]::text end
  union all
  select 'backfill', 'messages',
         case when to_regclass('public.messages') is null then 'n/a'
              else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.messages', false, true, '')))[1]::text end
),
fn as (
  select 'info', 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') already exists', 'true'
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname in ('cb_mark_thread_read', 'cb_unread_counts')
),
pol as (
  select 'info', 'policy ' || p.policyname || ' on message_thread_reads already exists', p.cmd
  from pg_policies p
  where p.schemaname = 'public' and p.tablename = 'message_thread_reads'
)
select * from dep
union all select * from target
union all select * from backfill
union all select * from fn
union all select * from pol
order by 1, 2;

rollback;
