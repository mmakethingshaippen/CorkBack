-- CorkBack - Stage 9 - VERIFY (CATALOG + APPLICATION ROLES) - run AFTER stage9_category_follows.sql
--
-- Dedicated disposable accounts, created and deleted by this script:
--   A  6c5e0000-0000-4000-8000-00000000009a  cb-s9-a@corkback-test.invalid  cb_s9_a
--   B  6c5e0000-0000-4000-8000-00000000009b  cb-s9-b@corkback-test.invalid  cb_s9_b
-- No password, undeliverable email. Refuses to start if either exists, so
-- cleanup deletes only rows from this run. One atomic DO block: if anything
-- raises, everything rolls back, including the test accounts.
--
-- Expected: every row has pass = true.
-- IMPORTANT: a failed check does NOT raise an error. The script finishes normally and
-- shows pass = false on that row. Read the whole result and look for any pass = false.
-- The last row, SUMMARY, counts the failures above it and must show 0. An error is raised
-- only for a setup problem (test accounts already exist, profiles not created, or the
-- test users cannot create their own follow, e.g. missing grants); that rolls
-- everything back, including the test accounts.
--   V1-V8   catalog: table, columns, primary key, cascading foreign keys,
--           RLS on, exactly three policies (select, insert, delete; no update),
--           lower(username) unique index valid, authenticated can use the table
--   R1-R6   user A: insert own row ok; insert for B refused (42501); duplicate
--           refused (23505); ON CONFLICT DO NOTHING inserts 0 rows with no error
--           (the route's ignoreDuplicates path); unknown category refused (23503)
--   R7-R10  A sees only A's rows; A cannot delete B's row (0 rows, row survives);
--           A cannot update a row (0 rows, row unchanged); A deletes own row (1)
--   R11-R15 rename: A renames self (1); a name equal to B's ignoring case is
--           refused (23505); changing only the capitalization of own name works
--           (1); A cannot rename B (0 rows)
--   R16-R19 signed out (anon): insert refused (42501); sees 0 rows; delete 0
--           rows and B's rows survive; cannot rename anyone (0 rows)
--   R20-R23 cleanup: no test rows left; category_follows cascade removed;
--           totals of category_follows, follows, connections, alerts, profiles
--           and auth users equal before and after
create temp table if not exists cb_s9r (n serial, kind text, check_name text, accept text[], actual text);
truncate cb_s9r;

insert into cb_s9r (kind, check_name, accept, actual)
select 'catalog', 'V1 table exists with RLS enabled', array['true'],
       coalesce((select relrowsecurity::text from pg_class where oid = to_regclass('public.category_follows')), 'missing')
union all
select 'catalog', 'V2 columns (name:type:nullable) in order', array['user_id:uuid:NO,category_id:smallint:NO,created_at:timestamp with time zone:NO'],
       (select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by ordinal_position)
        from information_schema.columns where table_schema = 'public' and table_name = 'category_follows')
union all
select 'catalog', 'V3 created_at defaults to now()', array['now()'],
       (select column_default from information_schema.columns
        where table_schema = 'public' and table_name = 'category_follows' and column_name = 'created_at')
union all
select 'catalog', 'V4 primary key (user_id, category_id)', array['PRIMARY KEY (user_id, category_id)'],
       (select pg_get_constraintdef(oid) from pg_constraint where conrelid = to_regclass('public.category_follows') and contype = 'p')
union all
select 'catalog', 'V5 two foreign keys (profiles, categories), both ON DELETE CASCADE', array['2'],
       (select count(*)::text from pg_constraint
        where conrelid = to_regclass('public.category_follows') and contype = 'f' and confdeltype = 'c'
          and confrelid in ('public.profiles'::regclass, 'public.categories'::regclass))
union all
select 'catalog', 'V6 exactly three policies: DELETE, INSERT, SELECT (no UPDATE), all keyed on auth.uid() = user_id', array['DELETE,INSERT,SELECT|3'],
       (select string_agg(cmd, ',' order by cmd) || '|' || count(*) filter (where
                 replace(coalesce(qual, with_check, ''), ' ', '') ilike '%auth.uid()=user_id%')
        from pg_policies where schemaname = 'public' and tablename = 'category_follows')
union all
select 'catalog', 'V7 lower(username) unique index exists and is valid', array['true'],
       coalesce((select (i.indisunique and i.indisvalid)::text from pg_index i
                 where i.indexrelid = to_regclass('public.profiles_username_lower_key')), 'missing')
union all
select 'catalog', 'V8 authenticated has SELECT, INSERT, DELETE on the table', array['true,true,true'],
       has_table_privilege('authenticated', 'public.category_follows', 'select')::text || ',' ||
       has_table_privilege('authenticated', 'public.category_follows', 'insert')::text || ',' ||
       has_table_privilege('authenticated', 'public.category_follows', 'delete')::text;

do $$
declare
  v_a constant uuid := '6c5e0000-0000-4000-8000-00000000009a';
  v_b constant uuid := '6c5e0000-0000-4000-8000-00000000009b';
  test_ids constant uuid[] := array['6c5e0000-0000-4000-8000-00000000009a', '6c5e0000-0000-4000-8000-00000000009b']::uuid[];
  cat1 smallint; cat2 smallint;
  i1 int; t1 text;
  before_totals text; after_totals text;
begin
  if exists (select 1 from auth.users where id = any (test_ids) or email like 'cb-s9-_@corkback-test.invalid')
     or exists (select 1 from public.profiles where id = any (test_ids) or username ilike 'cb\_s9\_%') then
    raise exception 'Stage 9 test accounts already exist. Nothing was changed.';
  end if;
  select 'category_follows=' || (select count(*) from public.category_follows) || ' follows=' || (select count(*) from public.follows)
         || ' connections=' || (select count(*) from public.connections) || ' alerts=' || (select count(*) from public.alerts)
         || ' profiles=' || (select count(*) from public.profiles) || ' auth_users=' || (select count(*) from auth.users)
    into before_totals;
  select id into cat1 from public.categories where slug = 'music';
  select id into cat2 from public.categories where slug = 'nightlife';
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values
    ('00000000-0000-0000-0000-000000000000', v_a, 'authenticated', 'authenticated', 'cb-s9-a@corkback-test.invalid', '', '{}', '{"username":"cb_s9_a"}', now(), now()),
    ('00000000-0000-0000-0000-000000000000', v_b, 'authenticated', 'authenticated', 'cb-s9-b@corkback-test.invalid', '', '{}', '{"username":"cb_s9_b"}', now(), now());
  insert into public.profiles (id, username) values (v_a, 'cb_s9_a'), (v_b, 'cb_s9_b') on conflict (id) do nothing;
  if (select count(*) from public.profiles where (id, username) in ((v_a, 'cb_s9_a'), (v_b, 'cb_s9_b'))) <> 2 then
    raise exception 'Test profiles were not created with the expected usernames.';
  end if;

  -- ---------------- signed in as A ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_a, cat1); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R1 A follows a category as A', array['created'], t1);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_b, cat2); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R2 A cannot insert a row for B (RLS)', array['42501'], t1);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_a, cat1); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R3 duplicate (A, same category) is blocked', array['23505'], t1);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_a, cat1) on conflict (user_id, category_id) do nothing;
    get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R4 ON CONFLICT DO NOTHING (route ignoreDuplicates): 0 rows, no error', array['0'], t1);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_a, 32000); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R5 unknown category id is refused (foreign key)', array['23503'], t1);

  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_a, cat2); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R6 A follows a second category', array['created'], t1);

  -- B follows cat1 so A has someone else's row to try to touch.
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_b::text, true);
  begin set local role authenticated;
    insert into public.category_follows (user_id, category_id) values (v_b, cat1); reset role;
  exception when others then raise exception 'B could not follow its own category: %', sqlstate; end; reset role;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_a::text, true);

  begin set local role authenticated;
    select count(*) into i1 from public.category_follows; t1 := i1::text; select count(*) into i1 from public.category_follows where user_id = v_b;
    t1 := t1 || '/' || i1; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R7 A sees only A''s rows (visible / of B)', array['2/0'], t1);

  begin set local role authenticated;
    delete from public.category_follows where user_id = v_b; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R8 A cannot delete B''s row (0 rows) and it survives',
    array['0/1'], t1 || '/' || (select count(*) from public.category_follows where user_id = v_b));

  begin set local role authenticated;
    update public.category_follows set category_id = cat2 where user_id = v_a and category_id = cat1; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R9 rows cannot be updated (no UPDATE policy): 0 rows, row unchanged',
    array['0/1', '42501/1'], t1 || '/' || (select count(*) from public.category_follows where user_id = v_a and category_id = cat1));

  begin set local role authenticated;
    delete from public.category_follows where user_id = v_a and category_id = cat2; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R10 A unfollows own category (1 row)', array['1'], t1);

  -- Rename (username edit) on profiles, still as A.
  begin set local role authenticated;
    update public.profiles set username = 'cb_s9_a2' where id = v_a; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R11 A renames self (1 row)', array['1'], t1);

  begin set local role authenticated;
    update public.profiles set username = 'CB_S9_B' where id = v_a; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R12 a name equal to B''s ignoring case is refused (lower index)', array['23505'], t1);

  begin set local role authenticated;
    update public.profiles set username = 'CB_S9_A2' where id = v_a; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R13 A may change only the capitalization of own name (1 row)', array['1'], t1);

  begin set local role authenticated;
    update public.profiles set username = 'cb_s9_hijack' where id = v_b; get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R14 A cannot rename B (0 rows) and B keeps its name',
    array['0/cb_s9_b'], t1 || '/' || (select username from public.profiles where id = v_b));

  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R15 A''s own rows now: cat1 only (ids)',
    array[cat1::text], (select string_agg(category_id::text, ',') from public.category_follows where user_id = v_a));

  -- ---------------- signed out (anon, no claims) ----------------
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  begin set local role anon;
    insert into public.category_follows (user_id, category_id) values (v_a, cat2); t1 := 'created'; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R16 signed out cannot insert', array['42501'], t1);

  begin set local role anon;
    select count(*) into i1 from public.category_follows; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R17 signed out sees no rows', array['0', '42501'], t1);

  begin set local role anon;
    delete from public.category_follows where user_id = any (test_ids); get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R18 signed out cannot delete; the 2 rows survive',
    array['0/2', '42501/2'], t1 || '/' || (select count(*) from public.category_follows where user_id = any (test_ids)));

  begin set local role anon;
    update public.profiles set username = 'cb_s9_anon' where id = any (test_ids); get diagnostics i1 = row_count; t1 := i1::text; reset role;
  exception when others then t1 := sqlstate; end; reset role;
  insert into cb_s9r (kind, check_name, accept, actual) values ('roles', 'R19 signed out cannot rename anyone', array['0', '42501'], t1);

  -- ---------------- cleanup and totals ----------------
  delete from auth.users where id = any (test_ids);
  delete from public.profiles where id = any (test_ids);
  select (select count(*) from auth.users where id = any (test_ids)) || ',' || (select count(*) from public.profiles where id = any (test_ids)) into t1;
  insert into cb_s9r (kind, check_name, accept, actual) values ('admin', 'R20 no test users or profiles left', array['0,0'], t1);
  insert into cb_s9r (kind, check_name, accept, actual) values ('admin', 'R21 category_follows rows of the test users removed (cascade)', array['0'],
    (select count(*)::text from public.category_follows where user_id = any (test_ids)));
  select 'category_follows=' || (select count(*) from public.category_follows) || ' follows=' || (select count(*) from public.follows)
         || ' connections=' || (select count(*) from public.connections) || ' alerts=' || (select count(*) from public.alerts)
         || ' profiles=' || (select count(*) from public.profiles) || ' auth_users=' || (select count(*) from auth.users)
    into after_totals;
  insert into cb_s9r (kind, check_name, accept, actual) values ('admin', 'R22 totals after = before (' || before_totals || ')', array[before_totals], after_totals);
  insert into cb_s9r (kind, check_name, accept, actual) values ('admin', 'R23 alerts, follows and connections untouched by this feature', array['true'],
    (split_part(before_totals, ' ', 2) || split_part(before_totals, ' ', 3) || split_part(before_totals, ' ', 4)
     = split_part(after_totals, ' ', 2) || split_part(after_totals, ' ', 3) || split_part(after_totals, ' ', 4))::text);
end $$;

insert into cb_s9r (kind, check_name, accept, actual)
select 'summary', 'SUMMARY: number of rows above with pass = false', array['0'],
       (select count(*)::text from cb_s9r where actual is null or not (actual = any (accept)));

select n, kind, check_name, array_to_string(accept, ' | ') as accept, actual, actual = any (accept) as pass
from cb_s9r order by n;
