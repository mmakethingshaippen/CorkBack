-- CorkBack - Stage 7 - VERIFY - run AFTER the migration
--
-- Catalog checks (V1-V4), then behaviour checks (R1-R7) using dedicated
-- disposable auth users that this script creates and deletes:
--   6c5e0000-0000-4000-8000-00000000007a .. 7e   cb-s7-?@corkback-test.invalid
-- No password, undeliverable email. Refuses to start if any exist. One atomic
-- DO block; R7 proves totals and existing profiles are unchanged afterwards.
-- Concurrency across sessions is tested separately from the app side.
--
-- Expected: every row has pass = true.

create temp table if not exists cb_s7v (n serial, check_name text, expected text, actual text);
truncate cb_s7v;

insert into cb_s7v (check_name, expected, actual)
select 'V1 trigger on_auth_user_created: AFTER INSERT FOR EACH ROW, enabled', 'yes',
       case when exists (select 1 from pg_trigger t
                         where t.tgrelid = 'auth.users'::regclass and t.tgname = 'on_auth_user_created' and not t.tgisinternal
                           and t.tgenabled <> 'D' and (t.tgtype & 1) = 1 and (t.tgtype & 2) = 0 and (t.tgtype & 4) = 4
                           and t.tgfoid = 'public.handle_new_user()'::regprocedure)
            then 'yes' else 'no' end
union all
select 'V2 handle_new_user is SECURITY DEFINER with search_path=''''', 'yes',
       case when (select prosecdef and coalesce(array_to_string(proconfig, ','), '') in ('search_path=""', 'search_path=')
                  from pg_proc where oid = 'public.handle_new_user()'::regprocedure) then 'yes' else 'no' end
union all
select 'V3 anon/authenticated cannot execute handle_new_user', 'false,false',
       has_function_privilege('anon', 'public.handle_new_user()', 'execute')::text || ',' ||
       has_function_privilege('authenticated', 'public.handle_new_user()', 'execute')::text
union all
select 'V4 only one trigger on auth.users', '1',
       (select count(*)::text from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal);

do $$
declare
  ids constant uuid[] := array['6c5e0000-0000-4000-8000-00000000007a', '6c5e0000-0000-4000-8000-00000000007b',
    '6c5e0000-0000-4000-8000-00000000007c', '6c5e0000-0000-4000-8000-00000000007d', '6c5e0000-0000-4000-8000-00000000007e']::uuid[];
  before_totals text; after_totals text; before_profiles text; after_profiles text;
  err text;
begin
  if exists (select 1 from auth.users where id = any (ids) or email like 'cb-s7-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (ids) or username like 'cb\_s7\_%') then
    raise exception 'Stage 7 test accounts already exist. Nothing was changed.';
  end if;
  select (select count(*) from auth.users) || '/' || (select count(*) from public.profiles) into before_totals;
  select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) into before_profiles from public.profiles p;

  -- R1 valid username -> exactly one profile with that username
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ids[1], 'authenticated', 'authenticated', 'cb-s7-a@corkback-test.invalid', '', '{}', '{"username":"cb_s7_taken"}', now(), now());
  insert into cb_s7v (check_name, expected, actual) values ('R1 new auth user with a valid username gets exactly one profile', '1',
    (select count(*)::text from public.profiles where id = ids[1] and username = 'cb_s7_taken'));

  -- R2 same username again -> 23505 and the second auth user does NOT exist
  begin
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', ids[2], 'authenticated', 'authenticated', 'cb-s7-b@corkback-test.invalid', '', '{}', '{"username":"cb_s7_taken"}', now(), now());
    err := 'no error';
  exception when unique_violation then err := '23505';
  end;
  insert into cb_s7v (check_name, expected, actual) values ('R2 taken username aborts the sign-up (error / auth row / profile)', '23505/0/0',
    err || '/' || (select count(*) from auth.users where id = ids[2]) || '/' || (select count(*) from public.profiles where id = ids[2]));

  -- R3 no username in metadata -> auth user created, no profile (chosen on /welcome)
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ids[3], 'authenticated', 'authenticated', 'cb-s7-c@corkback-test.invalid', '', '{}', '{}', now(), now());
  insert into cb_s7v (check_name, expected, actual) values ('R3 no username: auth user created, no profile', '1/0',
    (select count(*) from auth.users where id = ids[3]) || '/' || (select count(*) from public.profiles where id = ids[3]));

  -- R4 invalid username (space, too long) -> auth user created, no profile
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ids[4], 'authenticated', 'authenticated', 'cb-s7-d@corkback-test.invalid', '', '{}', '{"username":"bad name with spaces"}', now(), now());
  insert into cb_s7v (check_name, expected, actual) values ('R4 invalid username: auth user created, no profile', '1/0',
    (select count(*) from auth.users where id = ids[4]) || '/' || (select count(*) from public.profiles where id = ids[4]));

  -- R5 legacy pattern (auth user + profile insert "on conflict (id) do nothing") still yields one profile
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values ('00000000-0000-0000-0000-000000000000', ids[5], 'authenticated', 'authenticated', 'cb-s7-e@corkback-test.invalid', '', '{}', '{"username":"cb_s7_legacy"}', now(), now());
  insert into public.profiles (id, username) values (ids[5], 'cb_s7_legacy') on conflict (id) do nothing;
  insert into cb_s7v (check_name, expected, actual) values ('R5 legacy app/test insert after the trigger: still one profile', '1',
    (select count(*)::text from public.profiles where id = ids[5]));

  -- R6 the trigger never renames: R1's profile keeps the requested name
  insert into cb_s7v (check_name, expected, actual) values ('R6 no auto-suffixed usernames were created', '0',
    (select count(*)::text from public.profiles where username like 'cb\_s7\_taken\_%'));

  -- Cleanup (profiles cascade from auth.users), then R7.
  delete from auth.users where id = any (ids);
  select (select count(*) from auth.users) || '/' || (select count(*) from public.profiles) into after_totals;
  select md5(coalesce(string_agg(p::text, '|' order by p.id), '')) into after_profiles from public.profiles p;
  insert into cb_s7v (check_name, expected, actual) values
    ('R7a totals auth_users/profiles unchanged', before_totals, after_totals),
    ('R7b existing profiles unchanged (every column)', before_profiles, after_profiles),
    ('R7c no test rows remain', '0/0',
      (select count(*) from auth.users where id = any (ids)) || '/' || (select count(*) from public.profiles where id = any (ids)));
end;
$$;

select n, check_name, expected, actual, (actual = expected) as pass from cb_s7v order by n;
