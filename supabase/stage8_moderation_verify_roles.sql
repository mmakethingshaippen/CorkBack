-- CorkBack - Stage 8 - VERIFY (APPLICATION ROLES) - run AFTER stage8_moderation.sql (phase A)
--
-- Runs the stage 8 rules as the roles the app uses (anon, authenticated,
-- service_role) with JWT claims set the way PostgREST sets them.
--
-- Dedicated disposable accounts, created and deleted by this script
-- (no password, undeliverable email):
--   A 6c5e0000-0000-4000-8000-00000000008a  cb_s8t_a  author
--   R 6c5e0000-0000-4000-8000-00000000008b  cb_s8t_r  reporter
--   U 6c5e0000-0000-4000-8000-00000000008c  cb_s8t_u  unrelated user
--   M 6c5e0000-0000-4000-8000-00000000008d  cb_s8t_m  test admin (its admins row is removed with the account)
--   B 6c5e0000-0000-4000-8000-00000000008e  cb_s8t_b  second author (rate-limit postings)
-- Refuses to start if any exist. One atomic DO block.
--
-- This script is ONE transaction, so it cannot show how two simultaneous sessions
-- interact (reply/report rate limits under concurrency, report vs hide/delete
-- lock ordering). That is covered by supabase/isolated-test/concurrency.mjs,
-- which needs several real database connections and is meant for an isolated
-- database, not for production.
--
-- Audit protection is never disabled. The test admin's audit rows are KEPT:
-- admin_username = 'cb_s8t_m', every reason starts with '[TEST]', and their
-- posting/report/admin references become null when the test accounts are
-- deleted. R60 lists exactly what is retained. Expected: every row pass = true.

create temp table if not exists cb_s8r (n serial, kind text, check_name text, accept text[], actual text);
truncate cb_s8r;

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

create or replace function pg_temp.rec(p_kind text, p_name text, p_accept text[], p_actual text)
returns void language sql as $f$ insert into cb_s8r (kind, check_name, accept, actual) values (p_kind, p_name, p_accept, p_actual) $f$;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-00000000008a';
  v_r constant uuid := '6c5e0000-0000-4000-8000-00000000008b';
  v_u constant uuid := '6c5e0000-0000-4000-8000-00000000008c';
  v_m constant uuid := '6c5e0000-0000-4000-8000-00000000008d';
  v_b constant uuid := '6c5e0000-0000-4000-8000-00000000008e';
  ids constant uuid[] := array['6c5e0000-0000-4000-8000-00000000008a', '6c5e0000-0000-4000-8000-00000000008b',
    '6c5e0000-0000-4000-8000-00000000008c', '6c5e0000-0000-4000-8000-00000000008d', '6c5e0000-0000-4000-8000-00000000008e']::uuid[];
  v_cat smallint;
  p_act uuid; p_end uuid; p_hid uuid; p_del uuid; p_rl uuid[] := '{}'; p_tmp uuid; th uuid; v_report uuid;
  v_end_expires timestamptz; n int; t text;
  before_totals text; after_totals text; before_hash text; after_hash text; log_before int; log_after int;
  q text;
  ins text;  -- SQL text helper for publish probes
  t1 text; t2 text; cnt text; rid text;
  v_rep_act uuid; v_rep_hid uuid;   -- pending reports: on p_act / on p_hid (both by the reporter)
begin
  if exists (select 1 from auth.users where id = any (ids) or email like 'cb-s8t-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (ids) or username like 'cb\_s8t\_%') then
    raise exception 'Stage 8 test accounts already exist. Nothing was changed.';
  end if;

  select (select count(*) from public.postings) || '/' || (select count(*) from public.replies) || '/'
      || (select count(*) from public.posting_reports) || '/' || (select count(*) from public.admins) || '/'
      || (select count(*) from public.profiles) || '/' || (select count(*) from public.message_threads) || '/'
      || (select count(*) from public.messages) || '/' || (select count(*) from public.reply_submissions)
    into before_totals;
  select count(*) into log_before from public.moderation_log;
  select md5(coalesce((select string_agg(p::text, '|' order by p.id) from public.postings p), '') || '#'
          || coalesce((select string_agg(r::text, '|' order by r.id) from public.replies r), '') || '#'
          || coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m), '') || '#'
          || coalesce((select string_agg(x::text, '|' order by x.id) from public.message_threads x), '') || '#'
          || coalesce((select string_agg(l::text, '|' order by l.id) from public.moderation_log l), ''))
    into before_hash;

  -- Fixtures (as the migration owner).
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', 'cb-s8t-' || u.k || '@corkback-test.invalid', '', '{}',
         json_build_object('username', 'cb_s8t_' || u.k)::jsonb, now(), now()
    from (values (v_a, 'a'), (v_r, 'r'), (v_u, 'u'), (v_m, 'm'), (v_b, 'b')) as u(id, k);
  insert into public.profiles (id, username)
  select u.id, 'cb_s8t_' || u.k from (values (v_a, 'a'), (v_r, 'r'), (v_u, 'u'), (v_m, 'm'), (v_b, 'b')) as u(id, k)
  on conflict (id) do nothing;
  insert into public.admins (user_id, granted_note) values (v_m, 'stage 8 verify_roles test admin (removed with the account)');

  select id into v_cat from public.categories order by id limit 1;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_a, '[TEST] s8 active', v_cat, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id into p_act;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone, event_date)
  values (v_a, '[TEST] s8 ended', v_cat, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles', current_date - 3)
  returning id, expires_at into p_end, v_end_expires;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_a, '[TEST] s8 to hide', v_cat, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id into p_hid;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_a, '[TEST] s8 to delete', v_cat, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id into p_del;
  for n in 1..4 loop
    insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
    values (v_b, '[TEST] s8 rate ' || n, v_cat, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id into p_tmp;
    p_rl := p_rl || p_tmp;
  end loop;
  -- An existing private conversation between U and A about the posting that will be hidden.
  insert into public.message_threads (posting_id, user_lo, user_hi) values (p_hid, least(v_u, v_a), greatest(v_u, v_a)) returning id into th;
  insert into public.messages (thread_id, sender_id, body, client_id) values (th, v_u, '[TEST] private hello', gen_random_uuid());
  -- Reactions (inserted as the owner) so the aggregate has something to leak:
  -- p_hid: 1 like (R) + 1 going (U); p_del: 1 like (R); p_rl[4]: 1 like (U).
  insert into public.likes (posting_id, user_id) values (p_hid, v_r), (p_del, v_r), (p_rl[4], v_u);
  insert into public.plans (posting_id, user_id, kind) values (p_hid, v_u, 'going');

  -- ---------------- admins: nobody can make themselves (or anyone) admin ----------------
  perform pg_temp.rec('blocked', 'R1 user inserts themself into admins', array['42501'],
    pg_temp.run_as(v_u, 'authenticated', format('with x as (insert into public.admins (user_id) values (%L) returning 1) select count(*)::text from x', v_u)));
  perform pg_temp.rec('blocked', 'R2 user reads admins', array['42501'],
    pg_temp.run_as(v_u, 'authenticated', 'select count(*)::text from public.admins'));
  perform pg_temp.rec('blocked', 'R3 user changes an admin row', array['42501'],
    pg_temp.run_as(v_u, 'authenticated', format('with x as (update public.admins set user_id = %L returning 1) select count(*)::text from x', v_u)));
  perform pg_temp.rec('blocked', 'R3b service_role (server key) inserts or reads admins', array['42501,42501'],
    pg_temp.run_as(null, 'service_role', format('with x as (insert into public.admins (user_id) values (%L) returning 1) select count(*)::text from x', v_u)) || ','
    || pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.admins'));
  perform pg_temp.rec('required', 'R4 is_admin(): false for a user, true for the admin', array['false/true'],
    pg_temp.run_as(v_u, 'authenticated', 'select public.is_admin()::text') || '/' || pg_temp.run_as(v_m, 'authenticated', 'select public.is_admin()::text'));
  perform pg_temp.rec('blocked', 'R5 signed-out calls is_admin()', array['42501'],
    pg_temp.run_as(null, 'anon', 'select public.is_admin()::text'));

  -- ---------------- publishing: protected fields are server-side ----------------
  ins := 'with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at%s) values (%L, ''[TEST] s8 probe'', %s, 37.87, -122.27, ''1w'', now() + interval ''7 days''%s) returning 1) select count(*)::text from x';
  perform pg_temp.rec('blocked', 'R6a client sets id / created_at / is_promoted / deleted_at / moderation_hidden_at / flyer_url on publish',
    array['42501,42501,42501,42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', format(ins, ', id', v_a, v_cat, ', gen_random_uuid()')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format(ins, ', created_at', v_a, v_cat, ', ''2099-01-01''')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format(ins, ', is_promoted', v_a, v_cat, ', true')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format(ins, ', deleted_at', v_a, v_cat, ', now()')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format(ins, ', moderation_hidden_at', v_a, v_cat, ', now()')) || ','
    || pg_temp.run_as(v_a, 'authenticated', format(ins, ', flyer_url', v_a, v_cat, ', ''https://example.invalid/x.png''')));
  perform pg_temp.rec('blocked', 'R6b publish as someone else', array['42501'],
    pg_temp.run_as(v_a, 'authenticated', format(ins, '', v_u, v_cat, '')));
  -- (Each action runs in its own statement first: a scalar sub-select in the same
  -- expression could be evaluated before the action.)
  t := pg_temp.run_as(v_a, 'authenticated', format('with x as (insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at) values (%L, ''[TEST] s8 long'', %s, 37.87, -122.27, ''1m'', ''2099-01-01'') returning 1) select count(*)::text from x', v_a, v_cat));
  perform pg_temp.rec('required', 'R6c a client-chosen expiry (2099) is replaced by the preset: stored expiry = created_at + 30 days for 1m', array['1/true/false'],
    t || '/' || coalesce((select (expires_at = created_at + interval '30 days')::text || '/' || is_promoted::text
                            from public.postings where author_id = v_a and title = '[TEST] s8 long'), 'no row'));
  perform pg_temp.rec('blocked', 'R6d signed-out publish', array['42501'],
    pg_temp.run_as(null, 'anon', format(ins, '', v_a, v_cat, '')));

  -- ---------------- reporting ----------------
  perform pg_temp.rec('required', 'R7 reporter reports an active posting', array['created'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''spam_scam'', ''  [TEST] looks like a scam  '')', p_act)));
  perform pg_temp.rec('required', 'R8 reporting the same posting again while pending is a no-op', array['already_reported'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''other'', null)', p_act)));
  perform pg_temp.rec('required', 'R9 exactly one pending report row; details trimmed', array['1/[TEST] looks like a scam'],
    (select count(*)::text || '/' || max(details) from public.posting_reports where posting_id = p_act and reporter_id = v_r));
  perform pg_temp.rec('required', 'R10 an ended posting can be reported (still reachable by link)', array['created'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''misleading'', null)', p_end)));
  perform pg_temp.rec('blocked', 'R11 author reports their own posting', array['CB400'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.submit_posting_report(%L, ''duplicate'', null)', p_act)));
  perform pg_temp.rec('blocked', 'R12 details over 1000 characters', array['CB413'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.submit_posting_report(%L, ''other'', %L)', p_act, repeat('x', 1001))));
  perform pg_temp.rec('blocked', 'R13 signed-out reports', array['42501'],
    pg_temp.run_as(null, 'anon', format('select public.submit_posting_report(%L, ''spam_scam'', null)', p_act)));
  perform pg_temp.rec('blocked', 'R14 direct insert into posting_reports (bypassing limits), as user and as service_role', array['42501,42501'],
    pg_temp.run_as(v_u, 'authenticated', format('with x as (insert into public.posting_reports (posting_id, reporter_id, reason) values (%L, %L, ''spam_scam'') returning 1) select count(*)::text from x', p_act, v_u)) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.posting_reports (posting_id, reporter_id, reason) values (%L, %L, ''spam_scam'') returning 1) select count(*)::text from x', p_act, v_u)));
  perform pg_temp.rec('required', 'R15 reporter reports the posting that will be hidden', array['created'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''personal_info'', null)', p_hid)));
  -- R has 3 reports in the last 10 minutes; two more reach the limit of 5, the next is refused.
  perform pg_temp.rec('required', 'R16 4th and 5th reports within 10 minutes accepted', array['created,created'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''spam_scam'', null)', p_rl[1])) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''spam_scam'', null)', p_rl[2])));
  perform pg_temp.rec('blocked', 'R17 6th report within 10 minutes (rate limit)', array['CB429'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_posting_report(%L, ''spam_scam'', null)', p_rl[3])));
  perform pg_temp.rec('required', 'R18 reporter sees their own reports (safe columns only)', array['5'],
    pg_temp.run_as(v_r, 'authenticated', 'select count(*)::text from (select id, posting_id, reason, status, created_at from public.posting_reports) s'));
  perform pg_temp.rec('blocked', 'R19 reporter selects reporter_id; reporter selects details', array['42501,42501'],
    pg_temp.run_as(v_r, 'authenticated', 'select count(reporter_id)::text from public.posting_reports') || ','
    || pg_temp.run_as(v_r, 'authenticated', 'select count(details)::text from public.posting_reports'));
  perform pg_temp.rec('blocked', 'R20 posting author sees no reports about their posting; unrelated user sees none', array['0,0'],
    pg_temp.run_as(v_a, 'authenticated', format('select count(*)::text from (select id from public.posting_reports where posting_id = %L) s', p_act)) || ','
    || pg_temp.run_as(v_u, 'authenticated', 'select count(*)::text from (select id from public.posting_reports) s'));
  perform pg_temp.rec('blocked', 'R21 signed-out and service_role read reports', array['42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from (select id from public.posting_reports) s') || ','
    || pg_temp.run_as(null, 'service_role', 'select count(*)::text from (select id from public.posting_reports) s'));

  -- ---------------- admin reads ----------------
  perform pg_temp.rec('blocked', 'R22 non-admin opens the report queue / posting detail / log', array['42501,42501,42501'],
    pg_temp.run_as(v_u, 'authenticated', 'select count(*)::text from public.admin_report_queue(''all'')') || ','
    || pg_temp.run_as(v_u, 'authenticated', format('select count(*)::text from public.admin_posting_detail(%L)', p_act)) || ','
    || pg_temp.run_as(v_u, 'authenticated', 'select count(*)::text from public.admin_moderation_log()'));
  perform pg_temp.rec('required', 'R23 admin queue: 5 pending from the reporter, shown by username', array['5/cb_s8t_r'],
    pg_temp.run_as(v_m, 'authenticated', 'select count(*)::text || ''/'' || max(reporter_username) from public.admin_report_queue(''pending'') where reporter_username = ''cb_s8t_r'''));
  perform pg_temp.rec('required', 'R24 admin queue filter by reason', array['1'],
    pg_temp.run_as(v_m, 'authenticated', 'select count(*)::text from public.admin_report_queue(''pending'', ''personal_info'') where reporter_username = ''cb_s8t_r'''));
  perform pg_temp.rec('required', 'R25 admin posting detail shows context and state', array['[TEST] s8 ended/ended'],
    pg_temp.run_as(v_m, 'authenticated', format('select title || ''/'' || state from public.admin_posting_detail(%L)', p_end)));
  perform pg_temp.rec('blocked', 'R26 admin reads moderation_log directly (only through the admin function)', array['42501'],
    pg_temp.run_as(v_m, 'authenticated', 'select count(*)::text from public.moderation_log'));

  -- ---------------- hide ----------------
  perform pg_temp.rec('blocked', 'R27 non-admin hides a posting', array['42501'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] nope'')', p_hid)));
  perform pg_temp.rec('blocked', 'R28 hide without a reason (empty, whitespace)', array['CB422,CB422'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, '''')', p_hid)) || ','
    || pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, E'' \t\n'')', p_hid)));
  -- A reply that exists before the hide (must become unreadable with the posting).
  perform pg_temp.run_as(v_u, 'authenticated', format('select public.submit_reply(%L, ''[TEST] reply before hide'', gen_random_uuid())::text', p_hid));

  -- A supplied report_id must belong to the posting being hidden. The wrong id is
  -- refused with nothing changed: neither posting, neither posting's reports, no log row.
  select id into v_rep_act from public.posting_reports where posting_id = p_act and reporter_id = v_r;
  select id into v_rep_hid from public.posting_reports where posting_id = p_hid and reporter_id = v_r;
  select (select count(*) from public.postings where moderation_hidden_at is not null and author_id = v_a) || '/'
      || (select count(*) from public.posting_reports where status <> 'pending' and posting_id in (p_act, p_hid)) || '/'
      || (select count(*) from public.moderation_log where posting_id in (p_act, p_hid))
    into cnt;
  perform pg_temp.rec('blocked', 'R28b admin hides p_hid citing a report that belongs to ANOTHER posting; and citing a report that does not exist', array['CB400,CB404'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] wrong report'', %L)', p_hid, v_rep_act)) || ','
    || pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] no such report'', gen_random_uuid())', p_hid)));
  perform pg_temp.rec('required', 'R28c the refused hides changed nothing: no posting hidden, no report resolved, no log row', array[cnt],
    (select count(*) from public.postings where moderation_hidden_at is not null and author_id = v_a) || '/'
    || (select count(*) from public.posting_reports where status <> 'pending' and posting_id in (p_act, p_hid)) || '/'
    || (select count(*) from public.moderation_log where posting_id in (p_act, p_hid)));
  perform pg_temp.rec('required', 'R28d ... and both reports are still pending, p_hid still visible', array['pending,pending/1'],
    (select string_agg(status::text, ',' order by posting_id = p_act) from public.posting_reports where id in (v_rep_act, v_rep_hid)) || '/'
    || pg_temp.run_as(null, 'anon', format('select count(*)::text from public.postings where id = %L', p_hid)));
  perform pg_temp.rec('blocked', 'R28e non-admin supplies a report id (admin check comes first)', array['42501'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] nope'', %L)', p_hid, v_rep_hid)));

  -- Aggregate counts BEFORE hiding: anon and signed-in callers see the totals.
  cnt := format('select coalesce(string_agg(like_count || ''/'' || going_count || ''/'' || interested_count, '',''), ''none'') from public.posting_reaction_counts(array[%L]::uuid[])', p_hid);
  perform pg_temp.rec('required', 'R29a posting_reaction_counts BEFORE hiding: anon and authenticated see likes/going/interested', array['1/1/0,1/1/0'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt));
  perform pg_temp.rec('required', 'R29 admin hides with a reason, citing the posting''s own report', array['hidden'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] personal information'', %L)', p_hid, v_rep_hid)));
  perform pg_temp.rec('required', 'R29b posting_reaction_counts WHILE HIDDEN: no row for anon, user, reporter, author or admin', array['none,none,none,none,none'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt) || ',' || pg_temp.run_as(v_r, 'authenticated', cnt)
    || ',' || pg_temp.run_as(v_a, 'authenticated', cnt) || ',' || pg_temp.run_as(v_m, 'authenticated', cnt));
  perform pg_temp.rec('required', 'R29c the stored likes/plans are untouched by hiding (hidden from the aggregate, not erased)', array['1/1'],
    (select count(*) from public.likes where posting_id = p_hid) || '/' || (select count(*) from public.plans where posting_id = p_hid));
  perform pg_temp.rec('required', 'R30 hiding again is a no-op', array['already_hidden'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] again'')', p_hid)));
  perform pg_temp.rec('blocked', 'R30b a wrong report id is refused even when the posting is already hidden', array['CB400'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] again'', %L)', p_hid, v_rep_act)));
  perform pg_temp.rec('required', 'R31 pending report on it marked actioned; one hide logged with admin and reason',
    array['actioned/1/cb_s8t_m/[TEST] personal information'],
    (select max(status::text) from public.posting_reports where posting_id = p_hid) || '/'
    || (select count(*) || '/' || max(admin_username) || '/' || max(reason) from public.moderation_log where posting_id = p_hid and action = 'hide_posting'));
  perform pg_temp.rec('required', 'R31b the hide log row links to the posting''s own report; the other posting''s report is untouched', array['true/pending'],
    (select (report_id = v_rep_hid)::text from public.moderation_log where posting_id = p_hid and action = 'hide_posting') || '/'
    || (select status::text from public.posting_reports where id = v_rep_act));
  perform pg_temp.rec('required', 'R32 deleted_at and expires_at untouched by hiding', array['true'],
    (select (deleted_at is null and expires_at > now())::text from public.postings where id = p_hid));
  q := format('select count(*)::text from public.postings where id = %L', p_hid);
  perform pg_temp.rec('blocked', 'R33 hidden posting invisible to signed-out / unrelated / reporter / author / admin (direct reads)',
    array['0,0,0,0,0'],
    pg_temp.run_as(null, 'anon', q) || ',' || pg_temp.run_as(v_u, 'authenticated', q) || ',' || pg_temp.run_as(v_r, 'authenticated', q)
    || ',' || pg_temp.run_as(v_a, 'authenticated', q) || ',' || pg_temp.run_as(v_m, 'authenticated', q));
  perform pg_temp.rec('required', 'R34 author sees the moderation notice and reason; others get nothing',
    array['[TEST] personal information/0'],
    pg_temp.run_as(v_a, 'authenticated', format('select reason from public.my_hidden_posting_notice(%L)', p_hid)) || '/'
    || pg_temp.run_as(v_u, 'authenticated', format('select count(*)::text from public.my_hidden_posting_notice(%L)', p_hid)));
  perform pg_temp.rec('blocked', 'R35 on a hidden posting: like, reply, new thread, report, author edit, promote, reading its replies',
    array['42501,CB404,42501,CB404,0,CB404,0'],
    pg_temp.run_as(v_u, 'authenticated', format('with x as (insert into public.likes (posting_id, user_id) values (%L, %L) returning 1) select count(*)::text from x', p_hid, v_u)) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] hi'', gen_random_uuid())::text', p_hid)) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('with x as (insert into public.message_threads (posting_id, user_lo, user_hi) values (%L, %L, %L) returning 1) select count(*)::text from x', p_hid, least(v_r, v_a), greatest(v_r, v_a))) || ','
    || pg_temp.run_as(v_u, 'authenticated', format('select public.submit_posting_report(%L, ''spam_scam'', null)', p_hid)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set title = ''[TEST] edited'' where id = %L returning 1) select count(*)::text from x', p_hid)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.set_posting_promoted(%L, true)', p_hid)) || ','
    || pg_temp.run_as(null, 'anon', format('select count(*)::text from public.replies where posting_id = %L', p_hid)));
  perform pg_temp.rec('blocked', 'R36 author cannot clear moderation state', array['42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set moderation_hidden_at = null where id = %L returning 1) select count(*)::text from x', p_hid)));
  perform pg_temp.rec('required', 'R37 existing private conversation: participant still reads it; admin reads nothing', array['1/0'],
    pg_temp.run_as(v_u, 'authenticated', format('select count(*)::text from public.messages where thread_id = %L', th)) || '/'
    || pg_temp.run_as(v_m, 'authenticated', format('select count(*)::text from public.messages where thread_id = %L', th)));

  -- ---------------- restore ----------------
  perform pg_temp.rec('blocked', 'R38 non-admin restores; admin restores without a reason', array['42501/CB422'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.admin_restore_posting(%L, ''[TEST] x'')', p_hid)) || '/'
    || pg_temp.run_as(v_m, 'authenticated', format('select public.admin_restore_posting(%L, '' '')', p_hid)));
  t := pg_temp.run_as(v_m, 'authenticated', format('select public.admin_restore_posting(%L, ''[TEST] fixed by author'')', p_hid));
  perform pg_temp.rec('required', 'R39 admin restores: visible again to signed-out; logged', array['restored/1/1'],
    t || '/' || pg_temp.run_as(null, 'anon', format('select count(*)::text from public.postings where id = %L', p_hid)) || '/'
    || (select count(*)::text from public.moderation_log where posting_id = p_hid and action = 'restore_posting'));
  perform pg_temp.rec('required', 'R39b posting_reaction_counts AFTER RESTORATION: totals are back for anon and authenticated', array['1/1/0,1/1/0'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt));
  -- p_del: one like. Counts visible while active; gone once hidden AND author-deleted; still gone after restore.
  cnt := format('select coalesce(string_agg(like_count || ''/'' || going_count || ''/'' || interested_count, '',''), ''none'') from public.posting_reaction_counts(array[%L]::uuid[])', p_del);
  perform pg_temp.rec('required', 'R40-pre posting_reaction_counts on the posting that will be hidden then deleted (before)', array['1/0/0,1/0/0'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt));
  perform pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] under review'')', p_del));
  perform pg_temp.rec('required', 'R40a author deletes their moderated posting', array['deleted'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.delete_own_posting(%L)', p_del)));
  perform pg_temp.rec('required', 'R40a2 posting_reaction_counts AFTER AUTHOR DELETION of a hidden posting: none for anon, user, author', array['none,none,none'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt) || ',' || pg_temp.run_as(v_a, 'authenticated', cnt));
  perform pg_temp.rec('required', 'R40b restoring it leaves it deleted and invisible', array['restored/0/true'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_restore_posting(%L, ''[TEST] review finished'')', p_del)) || '/'
    || pg_temp.run_as(null, 'anon', format('select count(*)::text from public.postings where id = %L', p_del)) || '/'
    || (select (deleted_at is not null)::text from public.postings where id = p_del));
  perform pg_temp.rec('required', 'R40b2 posting_reaction_counts after restoring an author-deleted posting: still none', array['none,none'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_u, 'authenticated', cnt));
  perform pg_temp.rec('blocked', 'R40c hiding an author-deleted posting', array['CB409'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] again'')', p_del)));
  perform pg_temp.run_as(v_m, 'authenticated', format('select public.admin_hide_posting(%L, ''[TEST] misleading date'')', p_end));
  perform pg_temp.run_as(v_m, 'authenticated', format('select public.admin_restore_posting(%L, ''[TEST] date was right'')', p_end));
  perform pg_temp.rec('required', 'R40d restored ended posting: visible, still ended, expiry unchanged', array['1/false/true'],
    pg_temp.run_as(null, 'anon', format('select count(*)::text from public.postings where id = %L', p_end)) || '/'
    || pg_temp.run_as(null, 'anon', format('select public.posting_is_active(%L)::text', p_end)) || '/'
    || (select (expires_at = v_end_expires)::text from public.postings where id = p_end));

  -- ---------------- dismiss ----------------
  select id into v_report from public.posting_reports where posting_id = p_rl[1] and reporter_id = v_r;
  perform pg_temp.rec('required', 'R41a admin dismisses a report; dismissing again is a no-op', array['dismissed/not_pending'],
    pg_temp.run_as(v_m, 'authenticated', format('select public.admin_dismiss_report(%L, ''[TEST] not spam'')', v_report)) || '/'
    || pg_temp.run_as(v_m, 'authenticated', format('select public.admin_dismiss_report(%L, null)', v_report)));
  perform pg_temp.rec('required', 'R41b dismissal logged; posting not hidden', array['1/true'],
    (select count(*)::text from public.moderation_log where report_id = v_report and action = 'dismiss_report') || '/'
    || (select (moderation_hidden_at is null)::text from public.postings where id = p_rl[1]));
  perform pg_temp.rec('required', 'R41c admin sees the history through admin_moderation_log (3 hides, 3 restores, 1 dismissal)', array['7'],
    pg_temp.run_as(v_m, 'authenticated', 'select count(*)::text from public.admin_moderation_log() where admin_username = ''cb_s8t_m'''));

  -- ---------------- audit log protection ----------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin
    set local role service_role;
    truncate public.moderation_log; t := 'truncated';
  exception when others then t := sqlstate; end;
  reset role;
  perform pg_temp.rec('blocked', 'R42 service_role reads / inserts / updates / deletes / truncates the log', array['42501,42501,42501,42501,42501'],
    pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.moderation_log') || ','
    || pg_temp.run_as(null, 'service_role', 'with x as (insert into public.moderation_log (action, admin_username, reason) values (''hide_posting'', ''forged'', ''[TEST] forged'') returning 1) select count(*)::text from x') || ','
    || pg_temp.run_as(null, 'service_role', 'with x as (update public.moderation_log set reason = ''[TEST] tampered'' returning 1) select count(*)::text from x') || ','
    || pg_temp.run_as(null, 'service_role', 'with x as (delete from public.moderation_log returning 1) select count(*)::text from x') || ','
    || t);
  begin
    update public.moderation_log set reason = '[TEST] tampered' where admin_username = 'cb_s8t_m'; t := 'updated';
  exception when others then t := sqlstate; end;
  perform pg_temp.rec('blocked', 'R43a owner UPDATE of an audit row (trigger)', array['42501'], t);
  begin
    delete from public.moderation_log where admin_username = 'cb_s8t_m'; t := 'deleted';
  exception when others then t := sqlstate; end;
  perform pg_temp.rec('blocked', 'R43b owner DELETE of audit rows (trigger)', array['42501'], t);
  begin
    truncate public.moderation_log; t := 'truncated';
  exception when others then t := sqlstate; end;
  perform pg_temp.rec('blocked', 'R43c owner TRUNCATE of the log (trigger)', array['42501'], t);
  -- The trigger also protects id and the references. (id is GENERATED ALWAYS, so the only UPDATE
  -- Postgres lets reach the trigger is "= default", which would assign a new id.)
  t := '';
  begin update public.moderation_log set id = default where admin_username = 'cb_s8t_m'; t := 'updated'; exception when others then t := sqlstate; end;
  t1 := '';
  begin update public.moderation_log set posting_id = null where admin_username = 'cb_s8t_m' and posting_id is not null; t1 := 'updated'; exception when others then t1 := sqlstate; end;
  t2 := '';
  begin update public.moderation_log set report_id = null where admin_username = 'cb_s8t_m' and report_id is not null; t2 := 'updated'; exception when others then t2 := sqlstate; end;
  perform pg_temp.rec('blocked', 'R43d owner changes an audit row''s id; manually NULLS a posting reference; manually nulls a report reference (targets still exist)',
    array['42501,42501,42501'], t || ',' || t1 || ',' || t2);
  t := '';
  begin update public.moderation_log set admin_id = null where admin_username = 'cb_s8t_m'; t := 'updated'; exception when others then t := sqlstate; end;
  t1 := '';
  begin update public.moderation_log set posting_id = p_act where admin_username = 'cb_s8t_m' and posting_id is distinct from p_act; t1 := 'updated'; exception when others then t1 := sqlstate; end;
  perform pg_temp.rec('blocked', 'R43e owner manually nulls the admin reference; re-points a reference at a different posting', array['42501,42501'], t || ',' || t1);
  perform pg_temp.rec('required', 'R43f none of those refused edits changed any audit row', array['7/7/0'],
    (select count(*)::text from public.moderation_log where admin_username = 'cb_s8t_m') || '/'
    || (select count(*)::text from public.moderation_log where admin_username = 'cb_s8t_m' and posting_id is not null and admin_id is not null) || '/'
    || (select count(*)::text from public.moderation_log where admin_username = 'cb_s8t_m' and action in ('hide_posting', 'restore_posting') and posting_id is null));

  -- ---------------- owner edit, promotion and delete ----------------
  perform pg_temp.rec('required', 'R44 author edits content of their active posting', array['1'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set title = ''[TEST] s8 active edited'', body = ''[TEST] body'' where id = %L returning 1) select count(*)::text from x', p_act)));
  perform pg_temp.rec('required', 'R45 phase A: direct is_promoted update still allowed (deployed code); function too', array['1/promoted/unpromoted'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set is_promoted = true where id = %L returning 1) select count(*)::text from x', p_act)) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select public.set_posting_promoted(%L, true)', p_act)) || '/'
    || pg_temp.run_as(v_a, 'authenticated', format('select public.set_posting_promoted(%L, false)', p_act)));
  perform pg_temp.rec('blocked', 'R46 promotion function: other user; ended posting', array['CB404,CB409'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.set_posting_promoted(%L, true)', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('select public.set_posting_promoted(%L, true)', p_end)));
  perform pg_temp.rec('required', 'R46b un-promoting an ended posting is allowed', array['unpromoted'],
    pg_temp.run_as(v_a, 'authenticated', format('select public.set_posting_promoted(%L, false)', p_end)));
  perform pg_temp.rec('blocked', 'R47 author changes pin, expiry, created_at, deletion, author, flyer, zone (column privileges)',
    array['42501,42501,42501,42501,42501,42501,42501'],
    pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set lat = 51.5 where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set expires_at = ''2099-01-01'' where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set created_at = ''2099-01-01'' where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set deleted_at = now() where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set author_id = %L where id = %L returning 1) select count(*)::text from x', v_u, p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set flyer_url = ''https://example.invalid/x.png'' where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set time_zone = ''UTC'' where id = %L returning 1) select count(*)::text from x', p_act)));
  perform pg_temp.rec('blocked', 'R48 another user edits it; author edits an ENDED posting', array['0,0'],
    pg_temp.run_as(v_u, 'authenticated', format('with x as (update public.postings set title = ''x'' where id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_a, 'authenticated', format('with x as (update public.postings set title = ''x'' where id = %L returning 1) select count(*)::text from x', p_end)));
  cnt := format('select coalesce(string_agg(like_count || ''/'' || going_count || ''/'' || interested_count, '',''), ''none'') from public.posting_reaction_counts(array[%L]::uuid[])', p_rl[4]);
  perform pg_temp.rec('required', 'R48b posting_reaction_counts on a never-hidden active posting (before author deletion)', array['1/0/0,1/0/0'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_r, 'authenticated', cnt));
  perform pg_temp.rec('blocked', 'R49 delete_own_posting by another user; signed out', array['CB404,42501'],
    pg_temp.run_as(v_u, 'authenticated', format('select public.delete_own_posting(%L)', p_rl[4])) || ','
    || pg_temp.run_as(null, 'anon', format('select public.delete_own_posting(%L)', p_rl[4])));
  perform pg_temp.rec('required', 'R50 owner deletes; again is a no-op; gone for everyone', array['deleted/already_deleted/0'],
    pg_temp.run_as(v_b, 'authenticated', format('select public.delete_own_posting(%L)', p_rl[4])) || '/'
    || pg_temp.run_as(v_b, 'authenticated', format('select public.delete_own_posting(%L)', p_rl[4])) || '/'
    || pg_temp.run_as(v_b, 'authenticated', format('select count(*)::text from public.postings where id = %L', p_rl[4])));
  perform pg_temp.rec('required', 'R50b posting_reaction_counts AFTER AUTHOR DELETION of an active posting: none for anon, user, author', array['none,none,none'],
    pg_temp.run_as(null, 'anon', cnt) || ',' || pg_temp.run_as(v_r, 'authenticated', cnt) || ',' || pg_temp.run_as(v_b, 'authenticated', cnt));

  -- ---------------- replies (written ONLY through submit_reply) ----------------
  t1 := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, '' [TEST] first reply '', ''6c5e0000-0000-4000-8000-0000000008f1'')::text', p_act));
  t2 := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] a different body on retry'', ''6c5e0000-0000-4000-8000-0000000008f1'')::text', p_act));
  perform pg_temp.rec('required', 'R51 reply on an active posting returns its id and stores the trimmed body; the same key again returns the SAME id and creates nothing',
    array['true/1/1/[TEST] first reply'],
    (t1 ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and t1 = t2)::text || '/'
    || (select count(*) from public.replies where posting_id = p_act and author_id = v_r) || '/'
    || (select count(*) from public.reply_submissions where user_id = v_r) || '/'
    || coalesce((select max(body) from public.replies where id::text = t1), 'no row'));
  perform pg_temp.rec('blocked', 'R52 blank, whitespace-only and over-1000 replies (validated before anything is counted)', array['CB422,CB422,CB413/1'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, '''', gen_random_uuid())::text', p_act)) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, E'' \t\n\u00a0'', gen_random_uuid())::text', p_act)) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, %L, gen_random_uuid())::text', p_act, repeat('x', 1001))) || '/'
    || (select count(*) from public.reply_submissions where user_id = v_r));
  perform pg_temp.rec('blocked', 'R53 DIRECT insert into replies: as the author, with a client-set created_at, as service_role, signed out', array['42501,42501,42501,42501'],
    pg_temp.run_as(v_r, 'authenticated', format('with x as (insert into public.replies (posting_id, author_id, body, client_id) values (%L, %L, ''[TEST] direct'', gen_random_uuid()) returning 1) select count(*)::text from x', p_act, v_r)) || ','
    || pg_temp.run_as(v_r, 'authenticated', format('with x as (insert into public.replies (posting_id, author_id, body, created_at) values (%L, %L, ''[TEST] backdated'', ''2020-01-01'') returning 1) select count(*)::text from x', p_act, v_r)) || ','
    || pg_temp.run_as(null, 'service_role', format('with x as (insert into public.replies (posting_id, author_id, body, client_id) values (%L, %L, ''[TEST] service'', gen_random_uuid()) returning 1) select count(*)::text from x', p_act, v_r)) || ','
    || pg_temp.run_as(null, 'anon', format('with x as (insert into public.replies (posting_id, author_id, body) values (%L, %L, ''[TEST] anon'') returning 1) select count(*)::text from x', p_act, v_r)));
  perform pg_temp.rec('blocked', 'R53b submit_reply: ENDED posting; signed out; unknown posting; missing client id', array['CB409,42501,CB404,CB400'],
    pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] late'', gen_random_uuid())::text', p_end)) || ','
    || pg_temp.run_as(null, 'anon', format('select public.submit_reply(%L, ''[TEST] anon'', gen_random_uuid())::text', p_act)) || ','
    || pg_temp.run_as(v_r, 'authenticated', 'select public.submit_reply(gen_random_uuid(), ''[TEST] nowhere'', gen_random_uuid())::text') || ','
    || pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] no key'', null)::text', p_act)));
  perform pg_temp.rec('required', 'R54 everyone reads replies on an active posting', array['1,1'],
    pg_temp.run_as(null, 'anon', format('select count(*)::text from public.replies where posting_id = %L', p_act)) || ','
    || pg_temp.run_as(v_u, 'authenticated', format('select count(*)::text from public.replies where posting_id = %L', p_act)));
  perform pg_temp.rec('blocked', 'R55 editing a reply; deleting someone else''s', array['42501,0'],
    pg_temp.run_as(v_r, 'authenticated', format('with x as (update public.replies set body = ''[TEST] edited'' where posting_id = %L returning 1) select count(*)::text from x', p_act)) || ','
    || pg_temp.run_as(v_u, 'authenticated', format('with x as (delete from public.replies where posting_id = %L returning 1) select count(*)::text from x', p_act)));
  -- Nine more (each retried once: retries are free), reaching the limit of 10 with R51's.
  for n in 1..9 loop
    t := format('6c5e0000-0000-4000-8000-000000000b%s', lpad(n::text, 2, '0'));
    rid := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, %L, %L)::text', p_act, '[TEST] burst ' || n, t));
    perform pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, %L, %L)::text', p_act, '[TEST] burst ' || n, t));
  end loop;   -- rid is now burst 9's reply id
  t := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] eleventh'', gen_random_uuid())::text', p_act));
  perform pg_temp.rec('blocked', 'R56 11th reply within 10 minutes (rate limit); retries did not count: replies 10, ledger 10', array['CB429/10/10'],
    t || '/' || (select count(*)::text from public.replies where author_id = v_r) || '/' || (select count(*)::text from public.reply_submissions where user_id = v_r));
  perform pg_temp.rec('required', 'R57 author of a reply deletes it', array['1'],
    pg_temp.run_as(v_r, 'authenticated', format('with x as (delete from public.replies where posting_id = %L and author_id = %L and body = ''[TEST] burst 9'' returning 1) select count(*)::text from x', p_act, v_r)));
  t := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] after delete'', gen_random_uuid())::text', p_act));
  perform pg_temp.rec('blocked', 'R57b DELETING a reply does not give the allowance back: still rate limited (replies 9, ledger 10)', array['CB429/9/10'],
    t || '/' || (select count(*)::text from public.replies where author_id = v_r) || '/' || (select count(*)::text from public.reply_submissions where user_id = v_r));
  perform pg_temp.rec('required', 'R57c a retry of an earlier submission at the limit returns its original id, creates nothing, counts nothing', array['true/9/10'],
    (pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] first reply'', ''6c5e0000-0000-4000-8000-0000000008f1'')::text', p_act)) = t1)::text || '/'
    || (select count(*)::text from public.replies where author_id = v_r) || '/' || (select count(*)::text from public.reply_submissions where user_id = v_r));
  perform pg_temp.rec('required', 'R57d a retry of the DELETED reply''s key returns its id and does not recreate it', array['true/0/9/10'],
    (pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] burst 9'', ''6c5e0000-0000-4000-8000-000000000b09'')::text', p_act)) = rid)::text || '/'
    || (select count(*)::text from public.replies where id::text = rid) || '/'
    || (select count(*)::text from public.replies where author_id = v_r) || '/' || (select count(*)::text from public.reply_submissions where user_id = v_r));
  perform pg_temp.rec('blocked', 'R57e the ledger is invisible to anon, authenticated and service_role', array['42501,42501,42501'],
    pg_temp.run_as(null, 'anon', 'select count(*)::text from public.reply_submissions') || ','
    || pg_temp.run_as(v_r, 'authenticated', 'select count(*)::text from public.reply_submissions') || ','
    || pg_temp.run_as(null, 'service_role', 'select count(*)::text from public.reply_submissions'));
  -- The allowance returns only with time: age the caller's ledger rows past the 10-minute window.
  update public.reply_submissions set created_at = now() - interval '11 minutes' where user_id = v_r;
  t := pg_temp.run_as(v_r, 'authenticated', format('select public.submit_reply(%L, ''[TEST] after the window'', gen_random_uuid())::text', p_act));
  perform pg_temp.rec('required', 'R57f once the ledger rows are older than 10 minutes a new reply is accepted (replies 10, ledger 11)', array['true/10/11'],
    (t ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')::text || '/'
    || (select count(*)::text from public.replies where author_id = v_r) || '/' || (select count(*)::text from public.reply_submissions where user_id = v_r));

  -- ---------------- cleanup (audit protection stays on) ----------------
  delete from auth.users where id = any (ids);   -- cascades profiles, the test admins row, postings, replies, reports, threads, messages

  select (select count(*) from public.postings) || '/' || (select count(*) from public.replies) || '/'
      || (select count(*) from public.posting_reports) || '/' || (select count(*) from public.admins) || '/'
      || (select count(*) from public.profiles) || '/' || (select count(*) from public.message_threads) || '/'
      || (select count(*) from public.messages) || '/' || (select count(*) from public.reply_submissions)
    into after_totals;
  select count(*) into log_after from public.moderation_log;
  select md5(coalesce((select string_agg(p::text, '|' order by p.id) from public.postings p), '') || '#'
          || coalesce((select string_agg(r::text, '|' order by r.id) from public.replies r), '') || '#'
          || coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m), '') || '#'
          || coalesce((select string_agg(x::text, '|' order by x.id) from public.message_threads x), '') || '#'
          || coalesce((select string_agg(l::text, '|' order by l.id) from public.moderation_log l where l.admin_username <> 'cb_s8t_m'), ''))
    into after_hash;
  perform pg_temp.rec('required', 'R58 totals unchanged (postings/replies/reports/admins/profiles/threads/messages)', array[before_totals], after_totals);
  perform pg_temp.rec('required', 'R59 pre-existing postings, replies, threads, messages and audit rows unchanged (every column)', array[before_hash], after_hash);
  perform pg_temp.rec('required', 'R60 retained test audit rows: exactly 7, all by cb_s8t_m, all reasons [TEST]-labelled or empty, no links left',
    array['7/7/true/0'],
    (log_after - log_before)::text || '/'
    || (select count(*)::text from public.moderation_log where admin_username = 'cb_s8t_m') || '/'
    || (select bool_and(reason is null or reason like '[TEST]%')::text from public.moderation_log where admin_username = 'cb_s8t_m') || '/'
    || (select count(*)::text from public.moderation_log where admin_username = 'cb_s8t_m'
          and (posting_id is not null or report_id is not null or admin_id is not null)));
  perform pg_temp.rec('required', 'R61 no test accounts or test admin grant remain; both log triggers enabled', array['0/0/O,O'],
    (select count(*) from auth.users where id = any (ids)) || '/' || (select count(*) from public.admins where user_id = any (ids)) || '/'
    || (select string_agg(tgenabled::text, ',' order by tgname) from pg_trigger where tgrelid = 'public.moderation_log'::regclass
          and tgname in ('moderation_log_append_only', 'moderation_log_no_truncate')));
end;
$$;

select n, kind, check_name, accept, actual, actual = any (accept) as pass from cb_s8r order by n;
