-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 11 - Message reads - ROLLBACK
--
-- Drops ONLY what stage11_message_reads.sql created: the two functions and the
-- message_thread_reads table (its policies and grants go with it). Every read marker
-- is deleted, so after a later re-apply the backfill marks everything read again.
-- messages and message_threads are not touched. Safe to run when the migration was
-- never applied (every drop is "if exists"). One transaction.
--
-- Caution: if message_thread_reads existed BEFORE the migration (the preflight reports
-- this), this file would drop that table too. Do not run it in that case.
--
-- After rollback the app keeps running: GET /api/messages/unread sees the missing
-- function and returns { supported: false }.

begin;

drop function if exists public.cb_unread_counts();
drop function if exists public.cb_mark_thread_read(uuid, timestamptz);
drop table if exists public.message_thread_reads;

commit;

-- Check: expect 0, 0 and 0.
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'message_thread_reads') as reads_tables,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
          and proname in ('cb_mark_thread_read', 'cb_unread_counts')) as functions,
       (select count(*) from pg_policies where schemaname = 'public' and tablename = 'message_thread_reads') as policies;
