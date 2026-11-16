-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 11 - Message reads (unread tracking) - the migration
--
-- Run order (owner, after review):
--   1. supabase/stage11_message_reads_preflight.sql        read-only, BEFORE; save the output
--   2. this file                                           the migration
--   3. supabase/stage11_message_reads_verify_roles.sql     AFTER; all pass = true (rolls itself back)
--   Undo: supabase/stage11_message_reads_rollback.sql
--
-- What this file creates (ADDITIVE ONLY; nothing existing is dropped or altered):
--   public.message_thread_reads   one read marker per (thread, user)
--     - RLS on. An authenticated user may select, insert and update only their own
--       row, and only for a thread they take part in. A marker may not be in the future.
--     - privileges: authenticated gets select, insert (thread_id, user_id, last_read_at)
--       and update (last_read_at). No delete. anon and PUBLIC get nothing.
--   public.cb_mark_thread_read(p_thread uuid, p_upto timestamptz)
--     - the app's write path. Monotone: the marker becomes the greatest of the stored
--       marker and p_upto, capped at the server clock (now()). An earlier p_upto leaves
--       the marker unchanged without error. Raises 42501 when the caller is not signed
--       in or is not a participant of the thread; nothing is written in that case.
--   public.cb_unread_counts()
--     - one row per thread the caller takes part in: the number of messages sent by the
--       OTHER participant after the caller's marker (all of theirs when there is no
--       marker). The caller's own messages never count. Zero is returned as 0.
--   Both functions are SECURITY DEFINER with search_path = '' and check auth.uid()
--   themselves. EXECUTE is revoked from PUBLIC and anon and granted to authenticated.
--   Backfill: one marker per existing participant of every existing thread, set to the
--   created_at of the thread's latest message (either sender), or the thread's created_at
--   when it has no message, so every message that exists now counts as read.
--   A (thread, user) pair that already has a marker is left alone.
--
-- What this file does NOT change: messages, message_threads (no row, column, constraint,
-- policy or privilege), postings, profiles, follows, connections, alerts.
-- The migration asserts that at the end and rolls everything back if it is not true.
--
-- Safe to run twice: every create is "if not exists" / "or replace" / duplicate-tolerant,
-- and the backfill is "on conflict do nothing". One transaction: any error leaves
-- nothing applied.

begin;

-- 0. Dependencies must exist, and snapshot messages / message_threads so the end of
--    the file can prove they were not touched.
do $$
declare
  v_snap text;
begin
  if to_regclass('public.message_threads') is null
     or to_regclass('public.messages') is null
     or to_regclass('public.profiles') is null then
    raise exception 'stage11: message_threads, messages and profiles must exist (nothing was changed)';
  end if;

  select md5(
      coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m), '') || '#'
   || coalesce((select string_agg(t::text, '|' order by t.id) from public.message_threads t), '') || '#'
   || coalesce((select string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                  '|' order by p.tablename, p.policyname)
                from pg_policies p
                where p.schemaname = 'public' and p.tablename in ('messages', 'message_threads')), '') || '#'
   || coalesce((select string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), '|' order by c.relname)
                from pg_class c
                where c.oid in ('public.messages'::regclass, 'public.message_threads'::regclass)), '') || '#'
   || coalesce((select string_agg(a.attname || ':' || coalesce(a.attacl::text, ''), '|' order by a.attrelid, a.attnum)
                from pg_attribute a
                where a.attrelid in ('public.messages'::regclass, 'public.message_threads'::regclass)
                  and a.attnum > 0 and not a.attisdropped), '') || '#'
   || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), '|' order by k.conname)
                from pg_constraint k
                where k.conrelid in ('public.messages'::regclass, 'public.message_threads'::regclass)), ''))
    into v_snap;
  perform set_config('cb.s11_before', v_snap, true);
end $$;

-- 1. The table: at most one marker per (thread, user).
create table if not exists public.message_thread_reads (
  thread_id    uuid        not null references public.message_threads(id) on delete cascade,
  user_id      uuid        not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null,
  primary key (thread_id, user_id)
);

alter table public.message_thread_reads enable row level security;

-- 2. Privileges: explicit and column-limited. anon and PUBLIC get nothing.
revoke all on table public.message_thread_reads from public, anon, authenticated;
grant select on public.message_thread_reads to authenticated;
grant insert (thread_id, user_id, last_read_at) on public.message_thread_reads to authenticated;
grant update (last_read_at) on public.message_thread_reads to authenticated;

-- 3. Row level security: own row, participating thread only. (A duplicate_object
--    error on a second run is ignored, so nothing is dropped.)
do $$
begin
  create policy "reads own select" on public.message_thread_reads
    for select to authenticated
    using (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.message_threads t
        where t.id = message_thread_reads.thread_id
          and (select auth.uid()) in (t.user_lo, t.user_hi)
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "reads own insert" on public.message_thread_reads
    for insert to authenticated
    with check (
      user_id = (select auth.uid())
      and last_read_at <= now()
      and exists (
        select 1 from public.message_threads t
        where t.id = message_thread_reads.thread_id
          and (select auth.uid()) in (t.user_lo, t.user_hi)
      )
    );
exception when duplicate_object then null;
end $$;

do $$
begin
  create policy "reads own update" on public.message_thread_reads
    for update to authenticated
    using (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.message_threads t
        where t.id = message_thread_reads.thread_id
          and (select auth.uid()) in (t.user_lo, t.user_hi)
      )
    )
    with check (
      user_id = (select auth.uid())
      and last_read_at <= now()
      and exists (
        select 1 from public.message_threads t
        where t.id = message_thread_reads.thread_id
          and (select auth.uid()) in (t.user_lo, t.user_hi)
      )
    );
exception when duplicate_object then null;
end $$;

-- 4. cb_mark_thread_read: monotone, clamped to the server clock, participants only.
create or replace function public.cb_mark_thread_read(p_thread uuid, p_upto timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $f$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_thread is null or p_upto is null then
    raise exception 'thread and timestamp are required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.message_threads t
    where t.id = p_thread and v_uid in (t.user_lo, t.user_hi)
  ) then
    raise exception 'not a participant of this thread' using errcode = '42501';
  end if;

  insert into public.message_thread_reads as r (thread_id, user_id, last_read_at)
  values (p_thread, v_uid, least(p_upto, now()))
  on conflict (thread_id, user_id)
  do update set last_read_at = excluded.last_read_at
  where r.last_read_at < excluded.last_read_at;
end;
$f$;

-- 5. cb_unread_counts: the other participant's messages after my marker.
create or replace function public.cb_unread_counts()
returns table (thread_id uuid, unread integer)
language sql
stable
security definer
set search_path = ''
as $f$
  select t.id as thread_id, count(m.id)::integer as unread
  from public.message_threads t
  left join public.message_thread_reads r
         on r.thread_id = t.id and r.user_id = auth.uid()
  left join public.messages m
         on m.thread_id = t.id
        and m.sender_id <> auth.uid()
        and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where auth.uid() is not null
    and auth.uid() in (t.user_lo, t.user_hi)
  group by t.id
$f$;

revoke all on function public.cb_mark_thread_read(uuid, timestamptz) from public, anon;
revoke all on function public.cb_unread_counts() from public, anon;
grant execute on function public.cb_mark_thread_read(uuid, timestamptz) to authenticated;
grant execute on function public.cb_unread_counts() to authenticated;

-- 6. Backfill: every message that exists now counts as read. Inserts into the NEW
--    table only; a pair that already has a marker is skipped.
insert into public.message_thread_reads (thread_id, user_id, last_read_at)
select t.id, u.user_id,
       coalesce((select max(m.created_at) from public.messages m where m.thread_id = t.id), t.created_at)
from public.message_threads t
cross join lateral unnest(array[t.user_lo, t.user_hi]) as u(user_id)
on conflict (thread_id, user_id) do nothing;

-- 7. Assertions. Any failure raises and the whole transaction rolls back.
do $$
declare
  v_after text;
begin
  if not exists (
    select 1 from pg_index i
    where i.indrelid = 'public.message_thread_reads'::regclass and i.indisprimary
      and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
           where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['thread_id', 'user_id']
  ) then
    raise exception 'stage11 assertion: message_thread_reads has no primary key (thread_id, user_id); an incompatible table already existed';
  end if;
  if (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'message_thread_reads'
        and column_name in ('thread_id', 'user_id', 'last_read_at')) <> 3 then
    raise exception 'stage11 assertion: message_thread_reads is missing a column; an incompatible table already existed';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.message_thread_reads'::regclass) then
    raise exception 'stage11 assertion: row level security is not enabled on message_thread_reads';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'public' and tablename = 'message_thread_reads'
        and policyname in ('reads own select', 'reads own insert', 'reads own update')) <> 3 then
    raise exception 'stage11 assertion: expected the three message_thread_reads policies';
  end if;
  if has_any_column_privilege('anon', 'public.message_thread_reads', 'select,insert,update,references')
     or has_table_privilege('anon', 'public.message_thread_reads', 'select,insert,update,delete,truncate,references,trigger') then
    raise exception 'stage11 assertion: anon has a privilege on message_thread_reads';
  end if;
  if has_table_privilege('authenticated', 'public.message_thread_reads', 'delete,truncate,references,trigger')
     or has_table_privilege('authenticated', 'public.message_thread_reads', 'insert,update') then
    raise exception 'stage11 assertion: authenticated has a table-wide write privilege on message_thread_reads';
  end if;
  if has_function_privilege('anon', 'public.cb_mark_thread_read(uuid, timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.cb_unread_counts()', 'execute') then
    raise exception 'stage11 assertion: anon can execute a message reads function';
  end if;
  if not (has_function_privilege('authenticated', 'public.cb_mark_thread_read(uuid, timestamptz)', 'execute')
          and has_function_privilege('authenticated', 'public.cb_unread_counts()', 'execute')) then
    raise exception 'stage11 assertion: authenticated cannot execute a message reads function';
  end if;
  if exists (
    select 1
    from public.message_threads t
    cross join lateral unnest(array[t.user_lo, t.user_hi]) as u(user_id)
    where not exists (select 1 from public.message_thread_reads r where r.thread_id = t.id and r.user_id = u.user_id)
  ) then
    raise exception 'stage11 assertion: a thread participant has no marker after the backfill';
  end if;

  select md5(
      coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m), '') || '#'
   || coalesce((select string_agg(t::text, '|' order by t.id) from public.message_threads t), '') || '#'
   || coalesce((select string_agg(p.policyname || ':' || p.cmd || ':' || coalesce(p.qual, '') || ':' || coalesce(p.with_check, ''),
                                  '|' order by p.tablename, p.policyname)
                from pg_policies p
                where p.schemaname = 'public' and p.tablename in ('messages', 'message_threads')), '') || '#'
   || coalesce((select string_agg(c.relname || ':' || coalesce(c.relacl::text, ''), '|' order by c.relname)
                from pg_class c
                where c.oid in ('public.messages'::regclass, 'public.message_threads'::regclass)), '') || '#'
   || coalesce((select string_agg(a.attname || ':' || coalesce(a.attacl::text, ''), '|' order by a.attrelid, a.attnum)
                from pg_attribute a
                where a.attrelid in ('public.messages'::regclass, 'public.message_threads'::regclass)
                  and a.attnum > 0 and not a.attisdropped), '') || '#'
   || coalesce((select string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), '|' order by k.conname)
                from pg_constraint k
                where k.conrelid in ('public.messages'::regclass, 'public.message_threads'::regclass)), ''))
    into v_after;
  if v_after is distinct from current_setting('cb.s11_before', true) then
    raise exception 'stage11 assertion: messages or message_threads changed (rows, policies, privileges or constraints)';
  end if;
end $$;

commit;

-- Check (read-only): markers vs. participants. Expect markers >= participant_pairs.
select (select count(*) from public.message_thread_reads) as markers,
       (select count(*) * 2 from public.message_threads) as participant_pairs;
