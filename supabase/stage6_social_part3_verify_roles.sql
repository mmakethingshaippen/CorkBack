-- CorkBack - Stage 6 part 3 - VERIFY (APPLICATION ROLES) - run AFTER the migration
--
-- Runs the friendship rules as the roles the app uses (anon, authenticated) with
-- JWT claims set as PostgREST sets them.
--
-- Dedicated disposable accounts, created and deleted by this script:
--   A  6c5e0000-0000-4000-8000-00000000003a  cb-s6t3-a@corkback-test.invalid  cb_s6t3_a
--   B  6c5e0000-0000-4000-8000-00000000003b  cb-s6t3-b@corkback-test.invalid  cb_s6t3_b
--   C  6c5e0000-0000-4000-8000-00000000003c  cb-s6t3-c@corkback-test.invalid  cb_s6t3_c  (unrelated third user)
-- No password, undeliverable email: nobody can sign in as them, no email is sent.
-- The script refuses to start if any of these ids/emails/usernames exist, so
-- cleanup deletes only rows created by this run. One atomic DO block: if anything
-- errors, nothing from the run is kept. R29 compares all totals before/after.
--
-- "required" checks must succeed with the intended value (errors fail them).
-- "blocked" checks pass only on the listed denial outcomes.

create temp table if not exists cb_s6r3 (n serial, kind text, check_name text, accept text[], actual text);
truncate cb_s6r3;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-00000000003a';
  v_b constant uuid := '6c5e0000-0000-4000-8000-00000000003b';
  v_c constant uuid := '6c5e0000-0000-4000-8000-00000000003c';
  test_ids constant uuid[] := array['6c5e0000-0000-4000-8000-00000000003a',
    '6c5e0000-0000-4000-8000-00000000003b', '6c5e0000-0000-4000-8000-00000000003c']::uuid[];
  v_cat smallint; p_active uuid; p_ended uuid;
  before_totals text; after_totals text;
  i1 int; i2 int; t1 text;
begin
  if exists (select 1 from auth.users where id = any (test_ids) or email like 'cb-s6t3-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (test_ids) or username in ('cb_s6t3_a', 'cb_s6t3_b', 'cb_s6t3_c')) then
    raise exception 'Test accounts cb_s6t3_a/b/c already exist. Nothing was changed.';
  end if;

  select 'postings=' || (select count(*) from public.postings) || ' likes=' || (select count(*) from public.likes)
         || ' plans=' || (select count(*) from public.plans) || ' connections=' || (select count(*) from public.connections)
         || ' follows=' || (select count(*) from public.follows) || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users) || ' messages=' || (select count(*) from public.messages)
    into before_totals;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated', 'cb-s6t3-a@corkback-test.invalid', '', '{}', '{"username":"cb_s6t3_a"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated', 'cb-s6t3-b@corkback-test.invalid', '', '{}', '{"username":"cb_s6t3_b"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_c, 'authenticated', 'authenticated', 'cb-s6t3-c@corkback-test.invalid', '', '{}', '{"username":"cb_s6t3_c"}', now(), now());
  insert into public.profiles (id, username) values (v_a, 'cb_s6t3_a'), (v_b, 'cb_s6t3_b'), (v_c, 'cb_s6t3_c')
  on conflict (id) do nothing;
  if (select count(*) from public.profiles where (id, username) in ((v_a, 'cb_s6t3_a'), (v_b, 'cb_s6t3_b'), (v_c, 'cb_s6t3_c'))) <> 3 then
    raise exception 'Test profiles were not created with the expected usernames.';
  end if;

  select id into v_cat from public.categories order by id limit 1;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone)
  values (v_c, '[TEST] stage6 part3 active', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles')
  returning id into p_active;
  insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone, event_date)
  values (v_c, '[TEST] stage6 part3 ended', v_cat, 37.8716, -122.2727, '24h', now() + interval '1 day', 'America/Los_Angeles', current_date - 3)
  returning id into p_ended;
  insert into public.plans (posting_id, user_id, kind) values (p_active, v_b, 'going'), (p_ended, v_b, 'interested');
  insert into public.likes (posting_id, user_id) values (p_active, v_b);

  -- ---------------- as A ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_b); get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 (kind, check_name, accept, actual) values ('required', 'R1 A sends a request to B (columns: parties only)', array['1'], t1);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_b); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R2 duplicate request A->B', array['23505'], t1);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id, status) values (v_a, v_c, 'accepted'); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R3 A inserts an already-accepted connection', array['42501'], t1);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_a); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R4 A requests itself', array['23514'], t1);

  begin set local role authenticated;
    update public.connections set status = 'accepted' where requester_id = v_a and addressee_id = v_b; get diagnostics i1 = row_count;
    t1 := i1 || ' rows'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R5 requester A accepts its own request', array['0 rows'], t1);

  begin set local role authenticated;
    select count(*) into i1 from public.plans where user_id = v_b;
    t1 := i1 || ',' || public.viewer_is_friend_of(v_b); reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R6 pending request reveals no plans; not friends (plans, is_friend)', array['0,false'], t1);

  -- ---------------- as B (recipient) ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_b, v_a); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R7 reciprocal request B->A while A->B is pending', array['23505'], t1);

  begin set local role authenticated;
    update public.connections set requester_id = v_c where requester_id = v_a and addressee_id = v_b; t1 := 'updated'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R8 B changes the requester (participant change)', array['42501'], t1);

  begin set local role authenticated;
    update public.connections set addressee_id = v_c where requester_id = v_a and addressee_id = v_b; t1 := 'updated'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R9 B changes the addressee (participant change)', array['42501'], t1);

  -- ---------------- as C (unrelated) ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);

  begin set local role authenticated;
    update public.connections set status = 'accepted' where requester_id = v_a and addressee_id = v_b; get diagnostics i1 = row_count;
    delete from public.connections where requester_id = v_a and addressee_id = v_b; get diagnostics i2 = row_count;
    t1 := i1 || ',' || i2; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R10 C accepts / deletes the A->B request (rows)', array['0,0'], t1);

  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_c); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R11 C creates a request as A', array['42501'], t1);

  begin set local role authenticated;
    select count(*) into i1 from public.connections where v_c not in (requester_id, addressee_id); t1 := i1 || ' rows'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R12 C reads connections it is not part of', array['0 rows'], t1);

  -- ---------------- anon ----------------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  begin set local role anon;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_c); t1 := 'inserted'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R13 anon creates a request', array['42501'], t1);
  begin set local role anon;
    t1 := public.viewer_is_friend_of(v_b)::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R14 anon can call viewer_is_friend_of (false)', array['false'], t1);

  -- ---------------- B accepts ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin set local role authenticated;
    update public.connections set status = 'accepted' where requester_id = v_a and addressee_id = v_b and status = 'pending';
    get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R15 recipient B accepts (rows)', array['1'], t1);

  begin set local role authenticated;
    update public.connections set status = 'pending' where requester_id = v_a and addressee_id = v_b; get diagnostics i1 = row_count;
    t1 := i1 || ' rows'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R16 accepted friendship cannot be reverted to pending', array['0 rows'], t1);

  -- ---------------- friends: A sees B's plans on ACTIVE postings only ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin set local role authenticated;
    select count(*) into i1 from public.plans where user_id = v_b and posting_id = p_active;
    select count(*) into i2 from public.plans where user_id = v_b and posting_id = p_ended;
    t1 := i1 || ',' || i2 || ',' || public.viewer_is_friend_of(v_b); reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R17 friend A sees B''s plan on active posting, not ended (active, ended, is_friend)', array['1,0,true'], t1);

  begin set local role authenticated;
    select count(*) into i1 from public.likes where user_id = v_b; t1 := i1 || ' rows'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R18 friend A still cannot see B''s likes', array['0 rows'], t1);

  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);
  begin set local role authenticated;
    select count(*) into i1 from public.plans where user_id = v_b;
    t1 := i1 || ',' || public.viewer_is_friend_of(v_a) || ',' || public.viewer_is_friend_of(v_b); reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R19 unrelated C: no plans; not friends with A or B', array['0,false,false'], t1);

  begin set local role authenticated;
    delete from public.connections where requester_id = v_a and addressee_id = v_b; get diagnostics i1 = row_count;
    t1 := i1 || ' rows'; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'blocked', 'R20 C removes the A-B friendship', array['0 rows'], t1);

  select count(*) into i1 from public.follows where follower_id = any (test_ids) or followee_id = any (test_ids);
  insert into cb_s6r3 values (default, 'admin', 'R21 friendship created no follows', array['0'], i1::text);

  -- ---------------- A removes the friendship: access revoked immediately ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin set local role authenticated;
    delete from public.connections where requester_id = v_a and addressee_id = v_b and status = 'accepted';
    get diagnostics i1 = row_count;
    select count(*) into i2 from public.plans where user_id = v_b;
    t1 := i1 || ',' || i2 || ',' || public.viewer_is_friend_of(v_b); reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R22 A removes friend B; B''s plans hidden at once (deleted, plans, is_friend)', array['1,0,false'], t1);

  -- ---------------- decline and cancel ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_c::text, true);
  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_c, v_a); get diagnostics i1 = row_count;
    insert into public.connections (requester_id, addressee_id) values (v_c, v_b); get diagnostics i2 = row_count;
    t1 := i1 || ',' || i2; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R23 C sends requests to A and B', array['1,1'], t1);

  begin set local role authenticated;
    delete from public.connections where requester_id = v_c and addressee_id = v_b and status = 'pending'; get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R24 C cancels its request to B', array['1'], t1);

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);
  begin set local role authenticated;
    delete from public.connections where requester_id = v_c and addressee_id = v_a and status = 'pending'; get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R25 A declines C''s request', array['1'], t1);

  -- After removal, a new request between A and B is allowed again.
  begin set local role authenticated;
    insert into public.connections (requester_id, addressee_id) values (v_a, v_b); get diagnostics i1 = row_count;
    t1 := i1::text; reset role;
  exception when others then t1 := 'ERROR ' || sqlstate; end; reset role;
  insert into cb_s6r3 values (default, 'required', 'R26 A can request B again after removal', array['1'], t1);

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  select coalesce(string_agg(case requester_id when v_a then 'A' when v_b then 'B' else 'C' end || '->'
         || case addressee_id when v_a then 'A' when v_b then 'B' else 'C' end || ':' || status, ',' order by requester_id, addressee_id), 'none')
    into t1 from public.connections where requester_id = any (test_ids) or addressee_id = any (test_ids);
  insert into cb_s6r3 values (default, 'admin', 'R27 final test connections', array['A->B:pending'], t1);

  -- ---------------- cleanup: only the three test accounts (cascade) ----------------
  delete from auth.users where id = any (test_ids);
  delete from public.profiles where id = any (test_ids);
  select (select count(*) from auth.users where id = any (test_ids)) || ',' || (select count(*) from public.profiles where id = any (test_ids))
         || ',' || (select count(*) from public.postings where author_id = any (test_ids) or title like '[TEST] stage6 part3%')
         || ',' || (select count(*) from public.plans where user_id = any (test_ids))
         || ',' || (select count(*) from public.likes where user_id = any (test_ids))
         || ',' || (select count(*) from public.connections where requester_id = any (test_ids) or addressee_id = any (test_ids))
         || ',' || (select count(*) from public.follows where follower_id = any (test_ids) or followee_id = any (test_ids))
    into t1;
  insert into cb_s6r3 values (default, 'admin', 'R28 no test rows left (users, profiles, postings, plans, likes, connections, follows)', array['0,0,0,0,0,0,0'], t1);

  select 'postings=' || (select count(*) from public.postings) || ' likes=' || (select count(*) from public.likes)
         || ' plans=' || (select count(*) from public.plans) || ' connections=' || (select count(*) from public.connections)
         || ' follows=' || (select count(*) from public.follows) || ' profiles=' || (select count(*) from public.profiles)
         || ' auth_users=' || (select count(*) from auth.users) || ' messages=' || (select count(*) from public.messages)
    into after_totals;
  insert into cb_s6r3 values (default, 'admin', 'R29 all other rows untouched (before: ' || before_totals || ')', array[before_totals], after_totals);
end $$;

select n, kind, check_name, array_to_string(accept, ' | ') as accept, actual, actual = any (accept) as pass
from cb_s6r3 order by n;
