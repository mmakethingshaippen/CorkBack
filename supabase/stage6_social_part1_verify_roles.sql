-- CorkBack - Stage 6 part 1 - VERIFY (APPLICATION ROLES) - run AFTER the migration
--
-- Runs policy and helper-function checks as the database roles the app uses:
-- anon (signed-out visitor) and authenticated (signed-in user), with JWT claims
-- set the way PostgREST sets them. Admin-only checks live in verify_admin.sql.
--
-- Test accounts: three DEDICATED, DISPOSABLE accounts, created by this script
-- and deleted by this script. They are identified explicitly:
--   A  6c5e0000-0000-4000-8000-00000000000a  cb-s6t-a@corkback-test.invalid  cb_s6t_a
--   B  6c5e0000-0000-4000-8000-00000000000b  cb-s6t-b@corkback-test.invalid  cb_s6t_b
--   C  6c5e0000-0000-4000-8000-00000000000c  cb-s6t-c@corkback-test.invalid  cb_s6t_c
-- They have no password and an unconfirmed, undeliverable (.invalid) email, so
-- nobody can sign in as them and no email is sent. No real account is used for
-- any reaction, plan, posting, or connection.
--
-- Safety:
--   - The script refuses to start if any of those ids, emails, or usernames
--     already exist, so everything it deletes was created by this run.
--   - All test postings are authored by A and titled "[TEST] stage6 part1 ...".
--   - Cleanup deletes only the three auth users above; their profiles,
--     postings, likes, plans, and connections go with them by cascade.
--   - Totals of all other rows are compared before and after (R27).
--   - Everything runs in one DO block, which is atomic: if anything errors,
--     nothing from this run is kept.
--
-- Result columns: accept = the acceptable outcomes; pass = actual is one of them.
-- "Required" checks must succeed with the intended value. An error is recorded
-- as "ERROR <sqlstate>" and fails the check. "Blocked" checks pass on either
-- "0 rows" or "denied 42501": both mean the caller got nothing.

create temp table if not exists cb_s6r (
  n          serial,
  kind       text,
  check_name text,
  accept     text[],
  actual     text
);
truncate cb_s6r;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-00000000000a';
  v_b constant uuid := '6c5e0000-0000-4000-8000-00000000000b';
  v_c constant uuid := '6c5e0000-0000-4000-8000-00000000000c';
  test_ids constant uuid[] := array[
    '6c5e0000-0000-4000-8000-00000000000a',
    '6c5e0000-0000-4000-8000-00000000000b',
    '6c5e0000-0000-4000-8000-00000000000c']::uuid[];
  v_cat smallint;
  p_active uuid; p_ended uuid; p_fallback uuid;
  before_totals text; after_totals text;
  i1 int; i2 int; i3 int;
  t1 text;
begin
  -- 0. Guard: the fixed test accounts must not exist yet ------------------------
  if exists (select 1 from auth.users where id = any (test_ids)
                                         or email like 'cb-s6t-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (test_ids)
                                               or username in ('cb_s6t_a', 'cb_s6t_b', 'cb_s6t_c')) then
    raise exception 'Test accounts cb_s6t_a/b/c (or their ids/emails) already exist. Nothing was changed. Investigate before re-running.';
  end if;

  select 'postings=' || (select count(*) from public.postings)
         || ' likes=' || (select count(*) from public.likes)
         || ' plans=' || (select count(*) from public.plans)
         || ' connections=' || (select count(*) from public.connections)
         || ' follows=' || (select count(*) from public.follows)
         || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users)
         || ' message_threads=' || (select count(*) from public.message_threads)
         || ' messages=' || (select count(*) from public.messages)
         || ' replies=' || (select count(*) from public.replies)
    into before_totals;

  -- 1. Create the disposable accounts (profiles come from on_auth_user_created) --
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated',
     'cb-s6t-a@corkback-test.invalid', '', '{}'::jsonb, '{"username":"cb_s6t_a"}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated',
     'cb-s6t-b@corkback-test.invalid', '', '{}'::jsonb, '{"username":"cb_s6t_b"}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_c, 'authenticated', 'authenticated',
     'cb-s6t-c@corkback-test.invalid', '', '{}'::jsonb, '{"username":"cb_s6t_c"}'::jsonb, now(), now());

  -- If the profile trigger is missing, create the profiles directly.
  insert into public.profiles (id, username) values
    (v_a, 'cb_s6t_a'), (v_b, 'cb_s6t_b'), (v_c, 'cb_s6t_c')
  on conflict (id) do nothing;
  if (select count(*) from public.profiles
      where (id, username) in ((v_a, 'cb_s6t_a'), (v_b, 'cb_s6t_b'), (v_c, 'cb_s6t_c'))) <> 3 then
    raise exception 'Test profiles were not created with the expected usernames.';
  end if;

  -- 2. Fixtures (as the editor role) -----------------------------------------------
  select id into v_cat from public.categories order by id limit 1;

  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_a, '[TEST] stage6 part1 active', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day',
          'America/Los_Angeles')
  returning id into p_active;

  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone, event_date)
  values (v_a, '[TEST] stage6 part1 ended', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day',
          'America/Los_Angeles', current_date - 3)
  returning id into p_ended;

  -- No stored zone, event "today" in UTC-12: active under the shared fallback.
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, event_date)
  values (v_a, '[TEST] stage6 part1 fallback', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day',
          (now() at time zone 'Etc/GMT+12')::date)
  returning id into p_fallback;

  insert into public.likes (posting_id, user_id) values (p_active, v_a), (p_active, v_b), (p_ended, v_a);
  insert into public.plans (posting_id, user_id, kind) values
    (p_active, v_a, 'interested'), (p_active, v_b, 'going'), (p_ended, v_b, 'going');
  -- A and B: accepted connection (as if friends). C -> A: pending request.
  insert into public.connections (requester_id, addressee_id, status) values
    (v_a, v_b, 'accepted'), (v_c, v_a, 'pending');

  -- 3. anon: REQUIRED ---------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin
    set local role anon;
    select count(*) into i1 from public.postings where id in (p_active, p_ended, p_fallback);
    t1 := i1::text;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R1 anon can read the test postings', array['3'], t1);

  begin
    set local role anon;
    t1 := public.posting_is_active(p_active) || ',' || public.posting_is_active(p_ended) || ','
          || public.posting_is_active(p_fallback);
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R2 anon posting_is_active (active, ended, no-zone fallback)', array['true,false,true'], t1);

  begin
    set local role anon;
    select 'likes=' || like_count || ' going=' || going_count || ' interested=' || interested_count
      into t1 from public.posting_reaction_counts(array[p_active]);
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R3 anon posting_reaction_counts returns totals', array['likes=2 going=1 interested=1'], t1);

  begin
    set local role anon;
    t1 := public.cb_safe_time_zone('America/Los_Angeles') || ',' || public.cb_safe_time_zone(null);
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R4 anon cb_safe_time_zone', array['America/Los_Angeles,Etc/GMT+12'], t1);

  -- 4. anon: BLOCKED ----------------------------------------------------------------
  begin
    set local role anon;
    select count(*) into i1 from public.likes where posting_id in (p_active, p_ended);
    t1 := i1 || ' rows';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R5 anon reads likes rows', array['0 rows', 'denied 42501'], t1);

  begin
    set local role anon;
    select count(*) into i1 from public.plans where posting_id in (p_active, p_ended);
    t1 := i1 || ' rows';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R6 anon reads plans rows', array['0 rows', 'denied 42501'], t1);

  begin
    set local role anon;
    select count(*) into i1 from public.connections where v_a in (requester_id, addressee_id);
    t1 := i1 || ' rows';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R7 anon reads connections rows', array['0 rows', 'denied 42501'], t1);

  begin
    set local role anon;
    insert into public.likes (posting_id, user_id) values (p_active, v_c);
    t1 := 'inserted';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R8 anon inserts a like', array['denied 42501'], t1);

  -- 5. user A: REQUIRED -------------------------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin
    set local role authenticated;
    select count(*) into i1 from public.likes where posting_id in (p_active, p_ended) and user_id = v_a;
    select count(*) into i2 from public.plans where posting_id in (p_active, p_ended) and user_id = v_a;
    select count(*) into i3 from public.connections where v_a in (requester_id, addressee_id);
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R9 A reads own likes, own plan, own connections', array['2,1,2'], t1);

  begin
    set local role authenticated;
    -- Exactly the statement shapes the app's like route sends.
    insert into public.likes (posting_id, user_id) values (p_active, v_a) on conflict (posting_id, user_id) do nothing;
    get diagnostics i1 = row_count;
    delete from public.likes where posting_id = p_active and user_id = v_a;
    get diagnostics i2 = row_count;
    insert into public.likes (posting_id, user_id) values (p_active, v_a) on conflict (posting_id, user_id) do nothing;
    get diagnostics i3 = row_count;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R10 A like (repeat no-op), unlike, like again on an active posting', array['0,1,1'], t1);

  begin
    set local role authenticated;
    -- Exactly the statement shapes the app's plan route sends.
    insert into public.plans (posting_id, user_id, kind) values (p_active, v_a, 'going')
      on conflict (posting_id, user_id) do update set kind = excluded.kind;
    get diagnostics i1 = row_count;
    delete from public.plans where posting_id = p_active and user_id = v_a;
    get diagnostics i2 = row_count;
    insert into public.plans (posting_id, user_id, kind) values (p_active, v_a, 'interested')
      on conflict (posting_id, user_id) do update set kind = excluded.kind;
    get diagnostics i3 = row_count;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R11 A switch plan, clear plan, set plan on an active posting', array['1,1,1'], t1);

  begin
    set local role authenticated;
    select 'likes=' || like_count || ' going=' || going_count || ' interested=' || interested_count
      into t1 from public.posting_reaction_counts(array[p_active]);
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R12 authenticated posting_reaction_counts', array['likes=2 going=1 interested=1'], t1);

  begin
    set local role authenticated;
    t1 := public.cb_safe_time_zone('America/Los_Angeles');
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('required', 'R13 authenticated cb_safe_time_zone (publish route)', array['America/Los_Angeles'], t1);

  -- 6. user A: BLOCKED --------------------------------------------------------------
  begin
    set local role authenticated;
    select count(*) into i1 from public.likes where posting_id in (p_active, p_ended) and user_id <> v_a;
    select count(*) into i2 from public.plans where posting_id in (p_active, p_ended) and user_id <> v_a;
    t1 := i1 || ',' || i2;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R14 A reads others'' likes, and accepted-connection B''s plans', array['0,0'], t1);

  begin
    set local role authenticated;
    insert into public.likes (posting_id, user_id) values (p_ended, v_a) on conflict (posting_id, user_id) do nothing;
    t1 := 'no error';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  -- A already liked p_ended (fixture), so a conflict is possible; use a plan insert too.
  begin
    set local role authenticated;
    insert into public.plans (posting_id, user_id, kind) values (p_ended, v_a, 'going');
    t1 := t1 || ' / inserted';
    reset role;
  exception when insufficient_privilege then t1 := t1 || ' / denied 42501';
           when others then t1 := t1 || ' / ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  -- "no error" on the like is acceptable only as a no-op on A's existing fixture
  -- like (conflict skipped); R26/R27 confirm no extra rows. The plan insert has
  -- no existing row and must be denied.
  values ('blocked', 'R15 A likes / sets a plan on an ended posting',
          array['denied 42501 / denied 42501', 'no error / denied 42501'], t1);

  begin
    set local role authenticated;
    delete from public.likes where posting_id = p_ended and user_id = v_a;
    get diagnostics i1 = row_count;
    t1 := i1 || ' rows';
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R16 A removes own like on an ended posting', array['0 rows'], t1);

  -- 7. user B: BLOCKED (own plan on an ended posting) ------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin
    set local role authenticated;
    update public.plans set kind = 'interested' where posting_id = p_ended and user_id = v_b;
    get diagnostics i1 = row_count;
    delete from public.plans where posting_id = p_ended and user_id = v_b;
    get diagnostics i2 = row_count;
    select count(*) into i3 from public.plans where posting_id = p_active and user_id <> v_b;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R17 B switches / clears own plan on ended posting; reads accepted-connection A''s plan',
          array['0,0,0'], t1);

  -- 8. user C (no relationship): BLOCKED -------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);

  begin
    set local role authenticated;
    select count(*) into i1 from public.likes where posting_id in (p_active, p_ended);
    select count(*) into i2 from public.plans where posting_id in (p_active, p_ended);
    select count(*) into i3 from public.connections where v_c not in (requester_id, addressee_id);
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R18 C reads likes, plans, others'' connections', array['0,0,0'], t1);

  begin
    set local role authenticated;
    insert into public.likes (posting_id, user_id) values (p_active, v_a);
    t1 := 'inserted';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R19 C inserts a like as A', array['denied 42501'], t1);

  begin
    set local role authenticated;
    update public.plans set kind = 'going' where posting_id = p_active and user_id = v_a;
    get diagnostics i1 = row_count;
    delete from public.likes where posting_id = p_active and user_id = v_a;
    get diagnostics i2 = row_count;
    delete from public.plans where posting_id = p_active and user_id = v_b;
    get diagnostics i3 = row_count;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R20 C changes A''s plan, removes A''s like, removes B''s plan (rows)', array['0,0,0'], t1);

  -- 9. connections interim lock (until part 3) -------------------------------------
  -- C inserts a pending request.
  begin
    set local role authenticated;
    insert into public.connections (requester_id, addressee_id, status) values (v_c, v_b, 'pending');
    t1 := 'inserted';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R21 C inserts a pending connection', array['denied 42501'], t1);

  -- C inserts a self-accepted connection (the gap the lock closes).
  begin
    set local role authenticated;
    insert into public.connections (requester_id, addressee_id, status) values (v_c, v_b, 'accepted');
    t1 := 'inserted';
    reset role;
  exception when insufficient_privilege then t1 := 'denied 42501';
           when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R22 C inserts an accepted connection', array['denied 42501'], t1);

  -- C (requester of C -> A) accepts its own request, or re-points it at B.
  begin
    set local role authenticated;
    update public.connections set status = 'accepted' where requester_id = v_c and addressee_id = v_a;
    get diagnostics i1 = row_count;
    update public.connections set addressee_id = v_b where requester_id = v_c and addressee_id = v_a;
    get diagnostics i2 = row_count;
    delete from public.connections where requester_id = v_c and addressee_id = v_a;
    get diagnostics i3 = row_count;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R23 requester C self-accepts, re-points, deletes C->A (rows)', array['0,0,0'], t1);

  -- A (addressee of C -> A, and party to A -> B) tries the same.
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin
    set local role authenticated;
    update public.connections set status = 'accepted' where requester_id = v_c and addressee_id = v_a;
    get diagnostics i1 = row_count;
    update public.connections set addressee_id = v_c where requester_id = v_a and addressee_id = v_b;
    get diagnostics i2 = row_count;
    delete from public.connections where requester_id = v_a and addressee_id = v_b;
    get diagnostics i3 = row_count;
    t1 := i1 || ',' || i2 || ',' || i3;
    reset role;
  exception when others then t1 := 'ERROR ' || sqlstate;
  end;
  reset role;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('blocked', 'R24 A accepts C->A, re-points A->B at C, deletes A->B (rows)', array['0,0,0'], t1);

  -- Connections unchanged after all attempts (editor role).
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select string_agg(case requester_id when v_a then 'A' when v_b then 'B' when v_c then 'C' end || '->'
                    || case addressee_id when v_a then 'A' when v_b then 'B' when v_c then 'C' end
                    || ':' || status, ',' order by requester_id, addressee_id)
    into t1
  from public.connections
  where requester_id = any (test_ids) or addressee_id = any (test_ids);
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('admin', 'R25 test connections unchanged after all attempts', array['A->B:accepted,C->A:pending'], t1);

  -- 10. Cleanup: delete only the three test accounts (cascades their data) --------
  delete from auth.users where id = any (test_ids);
  delete from public.profiles where id = any (test_ids); -- no-op if the cascade already removed them

  select (select count(*) from auth.users where id = any (test_ids)) || ','
         || (select count(*) from public.profiles where id = any (test_ids)) || ','
         || (select count(*) from public.postings where author_id = any (test_ids)
                                                 or title like '[TEST] stage6 part1%') || ','
         || (select count(*) from public.likes where user_id = any (test_ids)
                                              or posting_id in (p_active, p_ended, p_fallback)) || ','
         || (select count(*) from public.plans where user_id = any (test_ids)
                                              or posting_id in (p_active, p_ended, p_fallback)) || ','
         || (select count(*) from public.connections where requester_id = any (test_ids)
                                                    or addressee_id = any (test_ids))
    into t1;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('admin', 'R26 no test rows left (auth users, profiles, postings, likes, plans, connections)',
          array['0,0,0,0,0,0'], t1);

  select 'postings=' || (select count(*) from public.postings)
         || ' likes=' || (select count(*) from public.likes)
         || ' plans=' || (select count(*) from public.plans)
         || ' connections=' || (select count(*) from public.connections)
         || ' follows=' || (select count(*) from public.follows)
         || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users)
         || ' message_threads=' || (select count(*) from public.message_threads)
         || ' messages=' || (select count(*) from public.messages)
         || ' replies=' || (select count(*) from public.replies)
    into after_totals;
  insert into cb_s6r (kind, check_name, accept, actual)
  values ('admin', 'R27 all other rows untouched: totals after = totals before (' || before_totals || ')',
          array[before_totals], after_totals);
end $$;

select n, kind, check_name, array_to_string(accept, ' | ') as accept, actual,
       actual = any (accept) as pass
from cb_s6r
order by n;
