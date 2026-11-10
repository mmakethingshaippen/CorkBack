-- CorkBack - Stage 7 - PREFLIGHT (read-only) - run BEFORE the migration
--
-- Writes nothing. Expected:
--   trigger      auth.users triggers: none (or report what exists; do not apply
--                the migration if something other than on_auth_user_created is
--                there until we've reviewed it)
--   function     public.handle_new_user(): 0 (if 1, its md5 is shown; the
--                migration would replace it)
--   unique       profiles.username unique constraint: 1
--   format       profiles username_format check: 1
--   policy       "profiles self insert" (INSERT, auth.uid() = id): 1 (used by /welcome)
--   orphans      auth users without a profile: 0
--   ghosts       profiles without an auth user: 0
--   names        existing usernames failing the format rule: 0
--   meta         auth users whose metadata username is missing/invalid: info
--   totals       info: auth users / profiles

select 'trigger' as kind, 'auth.users triggers' as check_name,
       coalesce((select string_agg(tgname || case when tgenabled = 'D' then ' (disabled)' else '' end, ', ' order by tgname)
                 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal), 'none') as actual
union all
select 'function', 'public.handle_new_user() count / md5',
       (select count(*)::text || coalesce(' md5=' || string_agg(md5(pg_get_functiondef(p.oid)), ','), '')
        from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'handle_new_user')
union all
select 'unique', 'profiles.username unique constraint',
       (select count(*)::text from pg_constraint c
        where c.conrelid = 'public.profiles'::regclass and c.contype = 'u'
          and c.conkey = array[(select attnum from pg_attribute where attrelid = 'public.profiles'::regclass and attname = 'username')]::int2[])
union all
select 'format', 'profiles username_format check',
       (select count(*)::text from pg_constraint where conrelid = 'public.profiles'::regclass and contype = 'c' and conname = 'username_format')
union all
select 'policy', 'profiles self insert (INSERT, auth.uid() = id)',
       (select count(*)::text from pg_policies
        where schemaname = 'public' and tablename = 'profiles' and cmd = 'INSERT'
          and replace(coalesce(with_check, ''), ' ', '') ilike '%auth.uid()=id%')
union all
select 'orphans', 'auth users without a profile',
       (select count(*)::text from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id))
union all
select 'ghosts', 'profiles without an auth user',
       (select count(*)::text from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id))
union all
select 'names', 'usernames failing the format rule',
       (select count(*)::text from public.profiles where username !~ '^[A-Za-z0-9_]{3,20}$')
union all
select 'meta', 'auth users with missing/invalid metadata username (info)',
       (select count(*)::text from auth.users
        where coalesce(raw_user_meta_data ->> 'username', '') !~ '^[A-Za-z0-9_]{3,20}$')
union all
select 'totals', 'auth_users / profiles (info)',
       (select count(*) from auth.users)::text || ' / ' || (select count(*) from public.profiles)::text;
