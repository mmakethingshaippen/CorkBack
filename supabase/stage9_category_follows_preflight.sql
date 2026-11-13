-- CorkBack - Stage 9 - PREFLIGHT (read-only) - run BEFORE stage9_category_follows.sql
--
-- Writes nothing. One result set. Expected (every row's "ok" is true):
--   categories     the 10 locked slugs present in public.categories ........ 10
--   cat_id_type    public.categories.id data type ........................... smallint
--   table          public.category_follows already exists ................... 0
--   policies       category_follows policies already exist .................. 0
--   lower_index    profiles_username_lower_key already exists ............... 0
--   unique         profiles.username case-sensitive unique constraint ....... 1
--   format         profiles username_format check ........................... 1
--   rls_profiles   RLS enabled on public.profiles ........................... true
--   self_update    "profiles self update" policy (UPDATE, auth.uid() = id) .. 1
--   col_update     authenticated may UPDATE profiles.username ............... true
--   model          public.follows has its 3 self policies (the pattern copied) 3
--   collisions     groups of usernames equal ignoring case .................. 0
--                  (if not 0, the names are listed; the migration will refuse
--                   to run until they are resolved)
--   badnames       usernames failing the format rule ........................ 0
--   info rows      totals and mixed-case usernames: no expected value
select kind, check_name, expected, actual, case when expected = 'info' then null else actual = expected end as ok from (
select 'categories' as kind, 'the 10 locked slugs present' as check_name, '10' as expected,
       (select count(*)::text from public.categories where slug in
         ('music','nightlife','sports','social-clubs','lost-found','housing','jobs','sale','classes','community')) as actual
union all
select 'cat_id_type', 'public.categories.id data type', 'smallint',
       (select data_type from information_schema.columns where table_schema = 'public' and table_name = 'categories' and column_name = 'id')
union all
select 'table', 'public.category_follows already exists', '0',
       (select count(*)::text from pg_class where relnamespace = 'public'::regnamespace and relname = 'category_follows')
union all
select 'policies', 'category_follows policies already exist', '0',
       (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'category_follows')
union all
select 'lower_index', 'profiles_username_lower_key already exists', '0',
       (select count(*)::text from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_lower_key')
union all
select 'unique', 'profiles.username case-sensitive unique constraint', '1',
       (select count(*)::text from pg_constraint c
        where c.conrelid = 'public.profiles'::regclass and c.contype = 'u'
          and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'username')]::int2[])
union all
select 'format', 'profiles username_format check', '1',
       (select count(*)::text from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and conname = 'username_format')
union all
select 'rls_profiles', 'RLS enabled on public.profiles', 'true',
       (select relrowsecurity::text from pg_class where oid = 'public.profiles'::regclass)
union all
select 'self_update', 'profiles self update policy (UPDATE, auth.uid() = id)', '1',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'profiles' and cmd = 'UPDATE'
          and replace(coalesce(qual, ''), ' ', '') ilike '%auth.uid()=id%')
union all
select 'col_update', 'authenticated may UPDATE profiles.username', 'true',
       has_column_privilege('authenticated', 'public.profiles', 'username', 'update')::text
union all
select 'model', 'public.follows self policies (pattern being copied)', '3',
       (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'follows')
union all
select 'collisions', 'groups of usernames equal ignoring case (names listed if any)', '0',
       coalesce((select count(*)::text || ' group(s): ' || string_agg(names, '; ' order by names)
                 from (select string_agg(username, ', ' order by username) as names
                       from public.profiles group by lower(username) having count(*) > 1) d), '0')
union all
select 'badnames', 'usernames failing the format rule', '0',
       (select count(*)::text from public.profiles where username !~ '^[A-Za-z0-9_]{3,20}$')
union all
select 'info', 'usernames with capital letters (info; they keep working, new ones are lowercase)', 'info',
       (select count(*)::text from public.profiles where username <> lower(username))
union all
select 'info', 'profiles / categories / follows (people) rows (info)', 'info',
       (select count(*) from public.profiles)::text || ' / ' || (select count(*) from public.categories)::text
       || ' / ' || (select count(*) from public.follows)::text
) t;
