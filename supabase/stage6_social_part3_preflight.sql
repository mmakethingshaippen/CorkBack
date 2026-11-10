-- CorkBack - Stage 6 part 3 - PREFLIGHT (run BEFORE the migration)
--
-- Read-only: a single SELECT, no writes. Save the output.
--
-- Expected (state after part 1, probe of 2026-11-08: 0 connections, 0 plans):
--   baseline    connection rows, accepted rows, plans, likes, follows, profiles, auth users
--   conflict    pairs with more than one row = 0, self rows = 0   (part 3 refuses to run otherwise)
--   policy      connections: connections party read (only)
--               plans: owner read, self insert active, self update active, self delete active
--   grant       authenticated on connections: select=true insert=true update=true delete=true
--               (table-level defaults; part 3 replaces INSERT/UPDATE with column grants)
--   function    viewer_is_friend_of: absent (0)
--   index       no connections_one_per_pair yet
--   trigger     info only: triggers on auth.users (release item 1; do not fix here)

with
baseline as (
  select 'baseline'::text as section, t.name as item, t.n::text as detail
  from (values
    ('connections',          (select count(*) from public.connections)),
    ('connections_accepted', (select count(*) from public.connections where status = 'accepted')),
    ('connections_pending',  (select count(*) from public.connections where status = 'pending')),
    ('plans',                (select count(*) from public.plans)),
    ('likes',                (select count(*) from public.likes)),
    ('follows',              (select count(*) from public.follows)),
    ('postings',             (select count(*) from public.postings)),
    ('profiles',             (select count(*) from public.profiles)),
    ('auth_users',           (select count(*) from auth.users)),
    ('messages',             (select count(*) from public.messages))
  ) as t(name, n)
),
conflict as (
  select 'conflict', 'pairs with more than one row',
         (select count(*) from (select 1 from public.connections
                                group by least(requester_id, addressee_id), greatest(requester_id, addressee_id)
                                having count(*) > 1) s)::text
  union all
  select 'conflict', 'self rows', (select count(*) from public.connections where requester_id = addressee_id)::text
),
pol as (
  select 'policy', p.tablename || ': ' || p.policyname,
         p.cmd || ' roles=' || array_to_string(p.roles, ',') || ' using=' || coalesce(p.qual, '-')
           || ' check=' || coalesce(p.with_check, '-')
  from pg_policies p
  where p.schemaname = 'public' and p.tablename in ('connections', 'plans')
),
grants as (
  select 'grant', r.rolname || ' connections',
         'select=' || has_table_privilege(r.rolname, 'public.connections', 'SELECT')
         || ' insert=' || has_table_privilege(r.rolname, 'public.connections', 'INSERT')
         || ' update=' || has_table_privilege(r.rolname, 'public.connections', 'UPDATE')
         || ' delete=' || has_table_privilege(r.rolname, 'public.connections', 'DELETE')
  from (values ('anon'), ('authenticated')) as r(rolname)
),
func as (
  select 'function', 'viewer_is_friend_of',
         (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'viewer_is_friend_of')::text
),
idx as (
  select 'index', i.indexname, i.indexdef
  from pg_indexes i
  where i.schemaname = 'public' and i.tablename = 'connections'
),
trig as (
  select 'trigger', 'auth.users triggers (info)',
         coalesce((select string_agg(tgname || case when tgenabled = 'D' then ' (disabled)' else '' end, ', ')
                   from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal), 'none')
)
select * from baseline
union all select * from conflict
union all select * from pol
union all select * from grants
union all select * from func
union all select * from idx
union all select * from trig
order by 1, 2;
