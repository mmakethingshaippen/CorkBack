-- READ-ONLY preflight for stage10b_avatar_clear_and_rate_limit.sql. Changes nothing.
-- Expected before applying: cb_set_avatar present (service_role only),
-- avatar_path + constraint present, and none of the stage 10b objects present.
select 'cb_set_avatar' as item,
       coalesce((select p.oid::regprocedure::text || ' secdef=' || p.prosecdef || ' acl=' || coalesce(p.proacl::text, 'default')
                 from pg_proc p where p.oid = to_regprocedure('public.cb_set_avatar(uuid,text)')), 'ABSENT') as detail
union all
select 'avatar_path_constraint',
       coalesce((select pg_get_constraintdef(oid) from pg_constraint
                 where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_path_format'), 'absent')
union all
select 'cb_clear_avatar (expect ABSENT)',
       coalesce((select oid::regprocedure::text from pg_proc where oid = to_regprocedure('public.cb_clear_avatar(uuid)')), 'ABSENT')
union all
select 'cb_avatar_rate_check (expect ABSENT)',
       coalesce((select oid::regprocedure::text from pg_proc where oid = to_regprocedure('public.cb_avatar_rate_check(uuid)')), 'ABSENT')
union all
select 'avatar_uploads table (expect absent)',
       case when to_regclass('public.avatar_uploads') is null then 'absent' else 'present' end
union all
select 'profiles_column_acls',
       coalesce((select string_agg(attname || ': ' || attacl::text, '; ' order by attnum)
                 from pg_attribute where attrelid = 'public.profiles'::regclass
                   and attnum > 0 and not attisdropped and attacl is not null), 'none')
union all
select 'profiles_with_photo', (select count(*)::text from public.profiles where avatar_path is not null);