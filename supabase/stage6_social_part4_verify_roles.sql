-- CorkBack - Stage 6 part 4 - VERIFY (APPLICATION ROLES) - run AFTER the migration
--
-- Dedicated disposable accounts, created and deleted by this script:
--   A  6c5e0000-0000-4000-8000-00000000004a  cb-s6t4-a@corkback-test.invalid  cb_s6t4_a  (sender)
--   B  6c5e0000-0000-4000-8000-00000000004b  cb-s6t4-b@corkback-test.invalid  cb_s6t4_b  (poster)
--   C  6c5e0000-0000-4000-8000-00000000004c  cb-s6t4-c@corkback-test.invalid  cb_s6t4_c  (unrelated)
-- No password, undeliverable email. Refuses to start if any exist, so cleanup
-- deletes only rows from this run. One atomic DO block. R28 compares totals,
-- R29 compares the set of thread/message IDs, and R30 compares the full
-- contents (every column) of the threads and messages that existed before.

create temp table if not exists cb_s6r4 (n serial, kind text, check_name text, accept text[], actual text);
truncate cb_s6r4;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-00000000004a';
  v_b constant uuid := '6c5e0000-0000-4000-8000-00000000004b';
  v_c constant uuid := '6c5e0000-0000-4000-8000-00000000004c';
  test_ids constant uuid[] := array['6c5e0000-0000-4000-8000-00000000004a',
    '6c5e0000-0000-4000-8000-00000000004b', '6c5e0000-0000-4000-8000-00000000004c']::uuid[];
  lo_ab uuid; hi_ab uuid; lo_ac uuid; hi_ac uuid; lo_bc uuid; hi_bc uuid;
  v_cat smallint; p_active uuid; p_ended uuid; p_deleted uuid; p_by_c uuid; p_b2 uuid; th uuid; th2 uuid;
  k1 uuid := gen_random_uuid(); k2 uuid := gen_random_uuid();
  before_totals text; after_totals text; before_ids text; after_ids text;
  existing_thread_ids uuid[]; existing_message_ids uuid[]; before_content text; after_content text;
  blank text; blanks text[];
  i1 int; i2 int; t1 text;
begin
  if exists (select 1 from auth.users where id = any (test_ids) or email like 'cb-s6t4-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (test_ids) or username in ('cb_s6t4_a', 'cb_s6t4_b', 'cb_s6t4_c')) then
    raise exception 'Test accounts cb_s6t4_a/b/c already exist. Nothing was changed.';
  end if;

  select 'postings=' || (select count(*) from public.postings) || ' threads=' || (select count(*) from public.message_threads)
         || ' messages=' || (select count(*) from public.messages) || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users) into before_totals;
  select coalesce(string_agg(id::text, ',' order by id), '') || '|' || coalesce((select string_agg(id::text, ',' order by id) from public.messages), '')
    into before_ids from public.message_threads;
  -- Full row contents of the pre-existing rows (every column), for R30.
  select coalesce(array_agg(id), '{}') into existing_thread_ids from public.message_threads;
  select coalesce(array_agg(id), '{}') into existing_message_ids from public.messages;
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.message_threads t where t.id = any (existing_thread_ids)), '')
             || '#' ||
             coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m where m.id = any (existing_message_ids)), ''))
    into before_content;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated', 'cb-s6t4-a@corkback-test.invalid', '', '{}', '{"username":"cb_s6t4_a"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated', 'cb-s6t4-b@corkback-test.invalid', '', '{}', '{"username":"cb_s6t4_b"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_c, 'authenticated', 'authenticated', 'cb-s6t4-c@corkback-test.invalid', '', '{}', '{"username":"cb_s6t4_c"}', now(), now());
  insert into public.profiles (id, username) values (v_a, 'cb_s6t4_a'), (v_b, 'cb_s6t4_b'), (v_c, 'cb_s6t4_c') on conflict (id) do nothing;
  if (select count(*) from public.profiles where (id, username) in ((v_a, 'cb_s6t4_a'), (v_b, 'cb_s6t4_b'), (v_c, 'cb_s6t4_c'))) <> 3 then
    raise exception 'Test profiles were not created with the expected usernames.';
  end if;
  lo_ab := least(v_a, v_b); hi_ab := greatest(v_a, v_b);
  lo_ac := least(v_a, v_c); hi_ac := greatest(v_a, v_c);
  lo_bc := least(v_b, v_c); hi_bc := greatest(v_b, v_c);

  select id into v_cat from public.categories order by id limit 1;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_b, '[TEST] stage6 part4 active', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles') returning id into p_active;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone, event_date)
  values (v_b, '[TEST] stage6 part4 ended', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', current_date - 3) returning id into p_ended;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone, deleted_at)
  values (v_b, '[TEST] stage6 part4 deleted', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', now()) returning id into p_deleted;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_c, '[TEST] stage6 part4 by C', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles') returning id into p_by_c;
  -- A second posting by B with NO thread, so R20 can only fail on permission.
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_b, '[TEST] stage6 part4 B second', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles') returning id into p_b2;

  -- ---------------- A (sender) ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_active, lo_ab, hi_ab) returning id into th;
    t1 := 'created'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R1 A starts a thread with poster B about B''s posting', array['created'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_active, lo_ab, hi_ab); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R2 second thread for the same pair and posting', array['23505'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (null, lo_ab, hi_ab); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R3 thread with no posting', array['42501'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_active, lo_ac, hi_ac); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R4 thread about B''s posting with unrelated C', array['42501'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_by_c, lo_bc, hi_bc); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R5 A creates a thread between two other people', array['42501'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_deleted, lo_ab, hi_ab); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R6 thread about a deleted posting', array['42501'], t1);

  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_ended, lo_ab, hi_ab) returning id into th2;
    t1 := 'created'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R7 thread about an ENDED posting is allowed (messaging the poster stays available)', array['created'], t1);

  begin set local role authenticated;
    insert into public.message_threads (id, posting_id, user_lo, user_hi) values (gen_random_uuid(), p_by_c, lo_ac, hi_ac); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R8 client-chosen thread id', array['42501'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body, client_id) values (th, v_a, '[TEST] one', k1); get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R9 A sends a message with an idempotency key', array['1'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body, client_id) values (th, v_a, '[TEST] one', k1)
      on conflict (thread_id, sender_id, client_id) do nothing;
    get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R10 retrying the same send (same key) is a no-op (the app''s statement)', array['0'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body, client_id) values (th, v_a, '[TEST] one', k2); get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R11 intentionally sending the same text again (new key) is a new message', array['1'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body, created_at) values (th, v_a, '[TEST] backdated', '2020-01-01'); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R12 backdated created_at', array['42501'], t1);

  -- Whitespace-only bodies: spaces, tab/newline mixes, CRLF, VT/FF, NBSP,
  -- ideographic space, BOM, line separator, en quad, empty string.
  blanks := array['   ', E'\t', E'\n', E'\t\n ', E'\r\n', E'\u000b\f', E'\u00a0', E'\u3000', E'\ufeff', E'\u2028', E'\u2000', ''];
  t1 := '';
  foreach blank in array blanks loop
    begin set local role authenticated;
      insert into public.messages (thread_id, sender_id, body) values (th, v_a, blank);
      t1 := t1 || 'inserted,'; reset role;
    exception when others then t1 := t1 || sqlstate || ','; end; reset role;
  end loop;
  insert into cb_s6r4 values (default, 'blocked', 'R13 whitespace-only bodies (spaces, tab, newline, CRLF, VT/FF, NBSP, U+3000, BOM, U+2028, U+2000, empty)',
    array[repeat('23514,', array_length(blanks, 1))], t1);

  -- Bodies the app can send stay accepted (in the ended-posting thread, so the
  -- counts in R19/R25 are unaffected): inner text with surrounding whitespace,
  -- a zero-width space (not whitespace to trim() either), exactly 2000 chars.
  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body, client_id) values (th2, v_a, E'\t hi \n', gen_random_uuid());
    insert into public.messages (thread_id, sender_id, body, client_id) values (th2, v_a, E'\u200b', gen_random_uuid());
    insert into public.messages (thread_id, sender_id, body, client_id) values (th2, v_a, repeat('x', 2000), gen_random_uuid());
    select count(*) into i1 from public.messages where thread_id = th2;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R13b non-blank bodies accepted (text with surrounding whitespace, zero-width space, 2000 chars)', array['3'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body) values (th, v_a, repeat('x', 2001)); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R14 body over 2000 characters', array['23514'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body) values (th, v_b, '[TEST] spoofed'); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R15 A sends as B', array['42501'], t1);

  begin set local role authenticated;
    update public.messages set body = '[TEST] edited' where thread_id = th; get diagnostics i1 = row_count; t1 := i1 || ' rows'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R16 editing a sent message', array['42501', '0 rows'], t1);

  begin set local role authenticated;
    delete from public.messages where thread_id = th; get diagnostics i1 = row_count; t1 := i1 || ' rows'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R17 deleting a sent message', array['42501', '0 rows'], t1);

  begin set local role authenticated;
    update public.message_threads set user_hi = v_c where id = th; get diagnostics i1 = row_count; t1 := i1 || ' rows'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R18 changing a thread''s participants', array['42501', '0 rows'], t1);

  -- ---------------- B (poster, participant) ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin set local role authenticated;
    select count(*) into i1 from public.messages where thread_id = th;
    insert into public.messages (thread_id, sender_id, body, client_id) values (th, v_b, '[TEST] reply', gen_random_uuid()); get diagnostics i2 = row_count;
    t1 := i1 || ',' || i2; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'required', 'R19 B reads both messages and replies', array['2,1'], t1);

  -- p_b2 has no thread yet, so the only possible failure is the permission check.
  begin set local role authenticated;
    insert into public.message_threads (posting_id, user_lo, user_hi) values (p_b2, lo_ab, hi_ab); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R20 the poster cannot start a thread about their own posting (no existing thread)', array['42501'], t1);

  -- ---------------- C (unrelated) ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);
  begin set local role authenticated;
    select count(*) into i1 from public.message_threads where id = th;
    select count(*) into i2 from public.messages where thread_id = th;
    t1 := i1 || ',' || i2; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R21 C reads the A-B thread and messages', array['0,0'], t1);

  begin set local role authenticated;
    insert into public.messages (thread_id, sender_id, body) values (th, v_c, '[TEST] intruder'); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R22 C posts into the A-B thread', array['42501'], t1);

  -- ---------------- anon ----------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin set local role anon;
    select count(*) into i1 from public.messages where thread_id = th; t1 := i1 || ' rows'; reset role;
  exception when insufficient_privilege then t1 := 'denied 42501'; when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R23 signed-out reads messages', array['0 rows', 'denied 42501'], t1);
  begin set local role anon;
    insert into public.messages (thread_id, sender_id, body) values (th, v_a, '[TEST] anon'); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r4 values (default, 'blocked', 'R24 signed-out sends', array['42501'], t1);

  -- ---------------- results and cleanup ----------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  -- All inserts in this block share one transaction (same now()), so this checks
  -- that every timestamp is server-set; ordering across real sends is tested in
  -- the browser suite, where each send is its own request.
  select count(*) || ' messages, all server-timestamped=' || bool_and(created_at = now())
    into t1 from public.messages where thread_id = th;
  insert into cb_s6r4 values (default, 'admin', 'R25 three messages, every timestamp server-set (none backdated)', array['3 messages, all server-timestamped=true'], t1);
  select count(*) into i1 from public.message_threads where user_lo = any (test_ids) or user_hi = any (test_ids);
  insert into cb_s6r4 values (default, 'admin', 'R26 exactly two test threads (active posting, ended posting)', array['2'], i1::text);

  delete from public.message_threads where user_lo = any (test_ids) or user_hi = any (test_ids);
  delete from auth.users where id = any (test_ids);
  delete from public.profiles where id = any (test_ids);
  delete from public.postings where title like '[TEST] stage6 part4%' and author_id = any (test_ids);

  select (select count(*) from auth.users where id = any (test_ids)) || ',' || (select count(*) from public.profiles where id = any (test_ids))
         || ',' || (select count(*) from public.postings where title like '[TEST] stage6 part4%')
         || ',' || (select count(*) from public.message_threads where user_lo = any (test_ids) or user_hi = any (test_ids))
         || ',' || (select count(*) from public.messages where sender_id = any (test_ids)) into t1;
  insert into cb_s6r4 values (default, 'admin', 'R27 no test rows left (users, profiles, postings, threads, messages)', array['0,0,0,0,0'], t1);

  select 'postings=' || (select count(*) from public.postings) || ' threads=' || (select count(*) from public.message_threads)
         || ' messages=' || (select count(*) from public.messages) || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users) into after_totals;
  insert into cb_s6r4 values (default, 'admin', 'R28 totals after = before (' || before_totals || ')', array[before_totals], after_totals);
  select coalesce(string_agg(id::text, ',' order by id), '') || '|' || coalesce((select string_agg(id::text, ',' order by id) from public.messages), '')
    into after_ids from public.message_threads;
  insert into cb_s6r4 values (default, 'admin', 'R29 thread and message row IDs unchanged (same set of IDs before and after)', array[before_ids], after_ids);
  select md5(coalesce((select string_agg(t::text, '|' order by t.id) from public.message_threads t where t.id = any (existing_thread_ids)), '')
             || '#' ||
             coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m where m.id = any (existing_message_ids)), ''))
    into after_content;
  insert into cb_s6r4 values (default, 'admin', 'R30 pre-existing thread and message CONTENTS unchanged (md5 of every column)', array[before_content], after_content);
end $$;

select n, kind, check_name, array_to_string(accept, ' | ') as accept, actual, actual = any (accept) as pass
from cb_s6r4 order by n;
