-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
--
-- CorkBack - Stage 11 - Message reads - VERIFY (APPLICATION ROLES)
-- Run AFTER stage11_message_reads.sql.
--
-- Checks the anon role, a participant and a third user, running each statement as
-- the role the app uses, with JWT claims set the way PostgREST sets them.
--
-- Disposable fixtures (created inside this script, no password, undeliverable email):
--   A 6c5e0000-0000-4000-8000-0000000011aa  cb_s11t_a  participant (the reader)
--   B 6c5e0000-0000-4000-8000-0000000011ab  cb_s11t_b  the other participant
--   C 6c5e0000-0000-4000-8000-0000000011ac  cb_s11t_c  third user, not in the thread
-- Refuses to start if any exist. The whole script is ONE transaction that ENDS WITH
-- ROLLBACK, so no data is left changed (the last result set is read before the rollback;
-- an extra check also proves the pre-existing markers, messages and threads are the same
-- after the fixtures are removed).
--
-- Result: one row per check, with pass = true or false. The first row (n = 0) is the
-- overall result: every check must be pass = true.
--
-- Fixture messages: B sends m1 (now - 3 min), m2 (now - 2 min), m3 (now - 1 min);
-- A sends m4 (now - 30 s). So A has 3 unread and B has 1 unread before anything is read.

begin;

create temp table cb_s11r (n serial, check_name text, accept text[], actual text);

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

create or replace function pg_temp.rec(p_name text, p_accept text[], p_actual text)
returns void language sql as $f$ insert into cb_s11r (check_name, accept, actual) values (p_name, p_accept, p_actual) $f$;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-0000000011aa';
  v_b constant uuid := '6c5e0000-0000-4000-8000-0000000011ab';
  v_c constant uuid := '6c5e0000-0000-4000-8000-0000000011ac';
  ids constant uuid[] := array['6c5e0000-0000-4000-8000-0000000011aa', '6c5e0000-0000-4000-8000-0000000011ab',
                               '6c5e0000-0000-4000-8000-0000000011ac']::uuid[];
  th uuid;
  m1 timestamptz; m2 timestamptz;
  v_now constant timestamptz := now();
  before_hash text; after_hash text;
  t text; t1 text;
  hash_sql constant text :=
    'select md5(coalesce((select string_agg(r::text, ''|'' order by r.thread_id, r.user_id) from public.message_thread_reads r), '''') || ''#'' '
    || '|| coalesce((select string_agg(m::text, ''|'' order by m.id) from public.messages m), '''') || ''#'' '
    || '|| coalesce((select string_agg(x::text, ''|'' order by x.id) from public.message_threads x), ''''))';
begin
  if to_regclass('public.message_thread_reads') is null
     or to_regprocedure('public.cb_mark_thread_read(uuid, timestamptz)') is null
     or to_regprocedure('public.cb_unread_counts()') is null then
    raise exception 'Stage 11 is not applied (message_thread_reads or its functions are missing). Nothing was changed.';
  end if;
  if exists (select 1 from auth.users where id = any (ids) or email like 'cb-s11t-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (ids) or username like 'cb\_s11t\_%') then
    raise exception 'Stage 11 test accounts already exist. Nothing was changed.';
  end if;

  execute hash_sql into before_hash;

  -- Fixtures (as the migration owner).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'cb-s11t-' || u.k || '@corkback-test.invalid', '', '{}',
         json_build_object('username', 'cb_s11t_' || u.k)::jsonb, now(), now()
    from (values (v_a, 'a'), (v_b, 'b'), (v_c, 'c')) as u(id, k);
  insert into public.profiles (id, username)
  select u.id, 'cb_s11t_' || u.k from (values (v_a, 'a'), (v_b, 'b'), (v_c, 'c')) as u(id, k)
  on conflict (id) do nothing;

  insert into public.message_threads (user_lo, user_hi) values (least(v_a, v_b), greatest(v_a, v_b)) returning id into th;
  m1 := v_now - interval '3 minutes';
  m2 := v_now - interval '2 minutes';
  insert into public.messages (thread_id, sender_id, body, created_at) values
    (th, v_b, '[TEST] m1', m1),
    (th, v_b, '[TEST] m2', m2),
    (th, v_b, '[TEST] m3', v_now - interval '1 minute'),
    (th, v_a, '[TEST] m4 from the reader', v_now - interval '30 seconds');

  -- ---------------- static: privileges and function definition ----------------
  perform pg_temp.rec('V1 anon has no privilege on message_thread_reads; authenticated has no delete/truncate and no table-wide insert/update',
    array['false/false/false'],
    has_any_column_privilege('anon', 'public.message_thread_reads', 'select,insert,update,references')::text || '/'
    || has_table_privilege('authenticated', 'public.message_thread_reads', 'delete,truncate,references,trigger')::text || '/'
    || has_table_privilege('authenticated', 'public.message_thread_reads', 'insert,update')::text);
  perform pg_temp.rec('V2 both functions are security definer with an empty search_path; anon cannot execute, authenticated can',
    array['2/false/true'],
    (select count(*)::text from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('cb_mark_thread_read', 'cb_unread_counts') and p.prosecdef
        and p.proconfig @> array['search_path=""']) || '/'
    || (has_function_privilege('anon', 'public.cb_mark_thread_read(uuid, timestamptz)', 'execute')
        or has_function_privilege('anon', 'public.cb_unread_counts()', 'execute'))::text || '/'
    || (has_function_privilege('authenticated', 'public.cb_mark_thread_read(uuid, timestamptz)', 'execute')
        and has_function_privilege('authenticated', 'public.cb_unread_counts()', 'execute'))::text);
  perform pg_temp.rec('V3 messages and message_threads: authenticated still has no UPDATE or DELETE; anon has no INSERT, UPDATE or DELETE',
    array['false/false'],
    (has_table_privilege('authenticated', 'public.messages', 'update,delete')
       or has_table_privilege('authenticated', 'public.message_threads', 'update,delete'))::text || '/'
    || (has_table_privilege('anon', 'public.messages', 'insert,update,delete')
       or has_table_privilege('anon', 'public.message_threads', 'insert,update,delete'))::text);

  -- ---------------- anon ----------------
  perform pg_temp.rec('V4 anon select, insert, update, delete on message_thread_reads', array['42501,42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.message_thread_reads') || ','
    || pg_temp.run_as(null, 'anon', format('with x as (insert into public.message_thread_reads (thread_id, user_id, last_read_at) values (%L, %L, now()) returning 1) select count(*)::text from x', th, v_a)) || ','
    || pg_temp.run_as(null, 'anon', 'with x as (update public.message_thread_reads set last_read_at = now() returning 1) select count(*)::text from x') || ','
    || pg_temp.run_as(null, 'anon', 'with x as (delete from public.message_thread_reads returning 1) select count(*)::text from x'));
  perform pg_temp.rec('V5 anon executes cb_mark_thread_read and cb_unread_counts', array['42501,42501'],
    pg_temp.run_as(null, 'anon', format('select ''ok'' from (select public.cb_mark_thread_read(%L, now())) s', th)) || ','
    || pg_temp.run_as(null, 'anon', 'select count(*)::text from public.cb_unread_counts()'));

  -- ---------------- participant: unread counts ----------------
  perform pg_temp.rec('V6 before any read: A has 3 unread (B''s messages; A''s own message is not counted), B has 1',
    array['3/1'],
    pg_temp.run_as(v_a, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)) || '/'
    || pg_temp.run_as(v_b, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));
  -- The mark runs in its own statement first: a sub-select in the same statement would not see the row it writes.
  t1 := pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, m1));
  perform pg_temp.rec('V7 A marks read up to m1: marker = m1, unread 2', array['ok/true/2'],
    t1 || '/'
    || (select (last_read_at = m1)::text from public.message_thread_reads where thread_id = th and user_id = v_a) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));
  perform pg_temp.rec('V8 an EARLIER timestamp returns without error and leaves the marker unchanged', array['ok/true/2'],
    pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, m1 - interval '1 hour')) || '/'
    || (select (last_read_at = m1)::text from public.message_thread_reads where thread_id = th and user_id = v_a) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));
  t1 := pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, m2));
  perform pg_temp.rec('V9 a LATER timestamp moves the marker forward (m2): unread 1', array['ok/true/1'],
    t1 || '/'
    || (select (last_read_at = m2)::text from public.message_thread_reads where thread_id = th and user_id = v_a) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));
  t1 := pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, v_now + interval '1 day'));
  perform pg_temp.rec('V10 a FUTURE timestamp (+1 day) is stored as the server clock, not the future; unread 0', array['ok/true/0'],
    t1 || '/'
    || (select (last_read_at = v_now)::text from public.message_thread_reads where thread_id = th and user_id = v_a) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));
  perform pg_temp.rec('V11 after the clamp, an earlier mark again does not lower it (monotone)', array['ok/true'],
    pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, m1)) || '/'
    || (select (last_read_at = v_now)::text from public.message_thread_reads where thread_id = th and user_id = v_a));
  perform pg_temp.rec('V12 null thread or null timestamp is refused and writes nothing', array['22023,22023/1'],
    pg_temp.run_as(v_a, 'authenticated', 'select ''ok'' from (select public.cb_mark_thread_read(null, now())) s') || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, null)) s', th)) || '/'
    || (select count(*)::text from public.message_thread_reads where thread_id = th));
  perform pg_temp.rec('V13 B (no marker yet) still has 1 unread: A''s marker does not affect B', array['1'],
    pg_temp.run_as(v_b, 'authenticated', format('select max(unread)::text from public.cb_unread_counts() where thread_id = %L', th)));

  -- ---------------- participant: direct table access ----------------
  perform pg_temp.rec('V14 A reads only their own marker; B sees none of A''s (B has no row yet)', array['1/0'],
    pg_temp.run_as(v_a, 'authenticated', format('select count(*)::text from public.message_thread_reads where thread_id = %L', th)) || '/'
    || pg_temp.run_as(v_b, 'authenticated', format('select count(*)::text from public.message_thread_reads where thread_id = %L', th)));
  perform pg_temp.rec('V15 A inserts a marker for B (someone else''s row)', array['42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (insert into public.message_thread_reads (thread_id, user_id, last_read_at) values (%L, %L, now()) returning 1) select count(*)::text from x', th, v_b)));
  perform pg_temp.rec('V16 A inserts a marker for a thread that does not exist', array['42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (insert into public.message_thread_reads (thread_id, user_id, last_read_at) values (gen_random_uuid(), %L, now()) returning 1) select count(*)::text from x', v_a)));
  perform pg_temp.rec('V17 B marks via the function, then A updates B''s row directly: 0 rows changed', array['ok/0'],
    pg_temp.run_as(v_b, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, %L)) s', th, m1)) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.message_thread_reads set last_read_at = now() where thread_id = %L and user_id = %L returning 1) select count(*)::text from x', th, v_b)));
  perform pg_temp.rec('V18 A cannot change thread_id or user_id of a marker, cannot set a future marker, cannot delete', array['42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.message_thread_reads set user_id = %L where thread_id = %L returning 1) select count(*)::text from x', v_b, th)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.message_thread_reads set thread_id = gen_random_uuid() where thread_id = %L returning 1) select count(*)::text from x', th)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (delete from public.message_thread_reads where thread_id = %L returning 1) select count(*)::text from x', th)));
  perform pg_temp.rec('V18b A cannot set their own marker into the future by a direct update (row check)', array['42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.message_thread_reads set last_read_at = now() + interval ''1 day'' where thread_id = %L returning 1) select count(*)::text from x', th)));

  -- ---------------- third user ----------------
  t := pg_temp.run_as(v_c, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, now())) s', th));
  perform pg_temp.rec('V19 C (not in the thread) calls cb_mark_thread_read: refused, and no marker is stored for C', array['42501/0'],
    t || '/' || (select count(*)::text from public.message_thread_reads where thread_id = th and user_id = v_c));
  perform pg_temp.rec('V20 C gets no unread row for the thread and reads no markers for it', array['0/0'],
    pg_temp.run_as(v_c, 'authenticated', format('select count(*)::text from public.cb_unread_counts() where thread_id = %L', th)) || '/'
    || pg_temp.run_as(v_c, 'authenticated', format('select count(*)::text from public.message_thread_reads where thread_id = %L', th)));
  perform pg_temp.rec('V21 C inserts a marker for the thread as themselves, and as A', array['42501,42501'],
    pg_temp.run_as(v_c, 'authenticated', format('with x as (insert into public.message_thread_reads (thread_id, user_id, last_read_at) values (%L, %L, now()) returning 1) select count(*)::text from x', th, v_c)) || ','
    || pg_temp.run_as(v_c, 'authenticated', format('with x as (insert into public.message_thread_reads (thread_id, user_id, last_read_at) values (%L, %L, now()) returning 1) select count(*)::text from x', th, v_a)));
  perform pg_temp.rec('V22 C updates the markers of the thread: 0 rows changed', array['0'],
    pg_temp.run_as(v_c, 'authenticated', format('with x as (update public.message_thread_reads set last_read_at = now() where thread_id = %L returning 1) select count(*)::text from x', th)));
  perform pg_temp.rec('V23 a signed-in caller with no user id (empty claims) is refused by the function', array['42501'],
    pg_temp.run_as(null, 'authenticated', format('select ''ok'' from (select public.cb_mark_thread_read(%L, now())) s', th)));
  perform pg_temp.rec('V24 the markers after all of the above: A at the server clock, B at m1, none for C', array['2/true/true/0'],
    (select count(*)::text from public.message_thread_reads where thread_id = th) || '/'
    || (select (last_read_at = v_now)::text from public.message_thread_reads where thread_id = th and user_id = v_a) || '/'
    || (select (last_read_at = m1)::text from public.message_thread_reads where thread_id = th and user_id = v_b) || '/'
    || (select count(*)::text from public.message_thread_reads where thread_id = th and user_id = v_c));

  -- ---------------- cleanup and no-change proof ----------------
  delete from auth.users where id = any (ids);   -- cascades profiles, thread, messages, markers

  execute hash_sql into after_hash;
  perform pg_temp.rec('V25 after the fixtures are removed, pre-existing markers, messages and threads are unchanged (every column)',
    array[before_hash], after_hash);
  perform pg_temp.rec('V26 no test accounts remain', array['0/0'],
    (select count(*)::text from auth.users where id = any (ids)) || '/' || (select count(*)::text from public.profiles where id = any (ids)));
end;
$$;

select n, check_name, accept, actual, actual = any (accept) as pass
from (
  select 0 as n, 'ALL CHECKS PASS' as check_name, array['true'] as accept,
         coalesce(bool_and(actual = any (accept)), false)::text as actual
  from cb_s11r
  union all
  select n, check_name, accept, actual from cb_s11r
) s
order by n;

rollback;
