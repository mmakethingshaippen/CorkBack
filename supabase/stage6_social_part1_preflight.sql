-- CorkBack - Stage 6 part 1 - PREFLIGHT (run BEFORE the migration)
--
-- Read-only: a single SELECT, no writes. Save the output; verify_admin prints
-- the same totals afterwards for comparison.
--
-- Expected, based on supabase/schema.sql in the repo and a read-only probe on
-- 2026-11-08 (2 postings, 5 profiles, 0 likes/plans/connections/follows):
--   rls        likes, plans, connections, postings: enabled=true forced=false
--   unique     likes.likes_pkey (posting_id, user_id)
--              plans.plans_pkey (posting_id, user_id)
--              connections.connections_pkey (requester_id, addressee_id)
--   policy     likes: likes public read, likes self write, likes self delete
--              plans: plans public read, plans self write, plans self update, plans self delete
--              connections: connections party read, connections requester insert,
--                           connections party update
--   flag       exactly these four (all removed by part 1):
--                likes public read, plans public read,
--                connections requester insert, connections party update
--              Anything else flagged: stop and review before running part 1.
--   grant      anon and authenticated: SELECT on postings = true
--   testacct   0 / 0 / 0 (the fixed test accounts used by verify_roles do not exist)
--   editor     auth.users insert/delete = true (needed by verify_roles to create
--              and remove its own disposable accounts)

with
baseline as (
  select 'baseline'::text as section, t.name as item, t.n::text as detail
  from (values
    ('postings',          (select count(*) from public.postings)),
    ('postings_active',   (select count(*) from public.postings where deleted_at is null)),
    ('likes',             (select count(*) from public.likes)),
    ('plans',             (select count(*) from public.plans)),
    ('connections',       (select count(*) from public.connections)),
    ('connections_accepted', (select count(*) from public.connections where status = 'accepted')),
    ('follows',           (select count(*) from public.follows)),
    ('profiles',          (select count(*) from public.profiles)),
    ('auth_users',        (select count(*) from auth.users)),
    ('message_threads',   (select count(*) from public.message_threads)),
    ('messages',          (select count(*) from public.messages)),
    ('replies',           (select count(*) from public.replies))
  ) as t(name, n)
),
reference as (
  select 'reference', 'ffe92f35',
         'event_date=' || coalesce(event_date::text, 'null')
         || ' expires_at=' || expires_at::text
         || ' deleted_at=' || coalesce(deleted_at::text, 'null')
  from public.postings where id = 'ffe92f35-622f-490e-a76a-e420088f0c61'
),
rls as (
  select 'rls', c.relname::text,
         'enabled=' || c.relrowsecurity || ' forced=' || c.relforcerowsecurity
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relname in ('likes', 'plans', 'connections', 'postings')
),
uniq as (
  select 'unique', cl.relname || '.' || con.conname,
         case con.contype when 'p' then 'primary key ' else 'unique ' end
           || '(' || string_agg(a.attname, ', ' order by k.ord) || ')'
  from pg_constraint con
  join pg_class cl on cl.oid = con.conrelid
  cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
  join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
  where cl.relnamespace = 'public'::regnamespace
    and cl.relname in ('likes', 'plans', 'connections')
    and con.contype in ('p', 'u')
  group by cl.relname, con.conname, con.contype
),
uniq_idx as (
  select 'unique_index', i.tablename || '.' || i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in ('likes', 'plans', 'connections')
    and i.indexdef ilike '%unique%'
),
pol as (
  select 'policy', p.tablename || ': ' || p.policyname,
         p.cmd || ' ' || p.permissive || ' roles=' || array_to_string(p.roles, ',')
           || ' using=' || coalesce(p.qual, '-')
           || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('likes', 'plans', 'connections')
),
flag as (
  select 'flag', p.tablename || ': ' || p.policyname,
         case
           when p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, '') ~* '^\(?\s*true\s*\)?$'
             then 'readable by everyone'
           when p.tablename = 'connections' and p.cmd in ('UPDATE', 'ALL')
             then 'client can change connection rows (status or parties)'
           when p.tablename = 'connections' and p.cmd = 'INSERT'
                and coalesce(p.with_check, '') not ilike '%pending%'
             then 'insert does not force status = pending'
           when p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
                and coalesce(p.qual, '') || coalesce(p.with_check, '') not ilike '%auth.uid()%'
             then 'write not tied to auth.uid()'
           when p.permissive = 'RESTRICTIVE'
             then 'restrictive policy present (review)'
         end
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename in ('likes', 'plans', 'connections')
),
grants as (
  select 'grant', r.rolname || ' ' || t.tbl,
         'select=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'SELECT')
         || ' insert=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'INSERT')
         || ' update=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'UPDATE')
         || ' delete=' || has_table_privilege(r.rolname, 'public.' || t.tbl, 'DELETE')
  from (values ('anon'), ('authenticated')) as r(rolname)
  cross join (values ('postings'), ('likes'), ('plans'), ('connections')) as t(tbl)
),
testacct as (
  select 'testacct', 'fixed test ids / emails / usernames already present',
         (select count(*) from auth.users where id in (
            '6c5e0000-0000-4000-8000-00000000000a',
            '6c5e0000-0000-4000-8000-00000000000b',
            '6c5e0000-0000-4000-8000-00000000000c'))::text
         || ' / ' ||
         (select count(*) from auth.users where email like 'cb-s6t-_@corkback-test.invalid')::text
         || ' / ' ||
         (select count(*) from public.profiles where username in ('cb_s6t_a', 'cb_s6t_b', 'cb_s6t_c'))::text
),
editor as (
  select 'editor', current_user::text,
         'auth.users insert=' || has_table_privilege('auth.users', 'INSERT')
         || ' delete=' || has_table_privilege('auth.users', 'DELETE')
         || ' can set role anon=' || pg_has_role('anon', 'MEMBER')
         || ' authenticated=' || pg_has_role('authenticated', 'MEMBER')
)
select * from baseline
union all select * from reference
union all select * from rls
union all select * from uniq
union all select * from uniq_idx
union all select * from pol
union all select * from flag where detail is not null
union all select * from grants
union all select * from testacct
union all select * from editor
order by 1, 2;
