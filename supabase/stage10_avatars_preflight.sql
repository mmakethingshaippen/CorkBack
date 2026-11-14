-- READ-ONLY preflight for stage10_avatars.sql (profile photos: bucket, column,
-- grants, restrictive Storage policies, cb_set_avatar). Changes nothing; run it
-- in the Supabase SQL editor and read every row.
--
-- stage10_avatars.sql was already applied by the owner on 2026-11-13, so this
-- file is also a "what is live right now" report. Expected state when applied:
--   bucket            avatars | public=true | 2097152 | image/jpeg,image/png,image/webp
--   avatar_path       column present, constraint profiles_avatar_path_format present
--   column_acls       avatar_path has NO insert/update grant to anon or authenticated
--   cb_set_avatar     present, SECURITY DEFINER, executable by service_role only
--   restrictive       three policies "avatars no client insert|update|delete"
--   permissive_for_avatars  none (nothing may let a client write the bucket)
-- Before first apply (clean project) the first five rows read ABSENT / none.

select 'bucket' as item,
       coalesce((select 'public=' || public || ' | limit=' || coalesce(file_size_limit::text, 'none')
                        || ' | mime=' || coalesce(array_to_string(allowed_mime_types, ','), 'any')
                 from storage.buckets where id = 'avatars'), 'ABSENT') as detail
union all
select 'avatar_path column',
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path'), 'ABSENT')
union all
select 'avatar_path constraint',
       coalesce((select pg_get_constraintdef(oid) from pg_constraint
                 where conrelid = 'public.profiles'::regclass and conname = 'profiles_avatar_path_format'), 'ABSENT')
union all
select 'profiles column write grants (anon/authenticated)',
       coalesce((select string_agg(r || ' ' || p || ' ' || a.attname, '; ' order by r, p, a.attname)
                 from pg_attribute a
                 cross join (values ('anon'), ('authenticated')) roles(r)
                 cross join (values ('INSERT'), ('UPDATE')) privs(p)
                 where a.attrelid = 'public.profiles'::regclass and a.attnum > 0 and not a.attisdropped
                   and has_column_privilege(r, 'public.profiles', a.attname, p)), 'none')
union all
select 'cb_set_avatar',
       coalesce((select p.oid::regprocedure::text || ' secdef=' || p.prosecdef
                        || ' service_role=' || has_function_privilege('service_role', p.oid, 'EXECUTE')
                        || ' authenticated=' || has_function_privilege('authenticated', p.oid, 'EXECUTE')
                        || ' anon=' || has_function_privilege('anon', p.oid, 'EXECUTE')
                 from pg_proc p where p.oid = to_regprocedure('public.cb_set_avatar(uuid,text)')), 'ABSENT')
union all
select 'rls enabled (profiles, storage.objects, storage.buckets)',
       (select string_agg(c.relname || '=' || c.relrowsecurity, ', ' order by c.relname)
        from pg_class c where c.oid in ('public.profiles'::regclass, 'storage.objects'::regclass, 'storage.buckets'::regclass))
union all
select 'restrictive avatar policies (expect 3)',
       (select count(*)::text from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'avatars no client %' and permissive = 'RESTRICTIVE')
union all
select 'ALL policies on storage.objects (review: none may grant clients writes to avatars)',
       coalesce((select string_agg(policyname || ' [' || permissive || ' ' || cmd || ' to ' || array_to_string(roles, '/') || ']', E'\n' order by policyname)
                 from pg_policies where schemaname = 'storage' and tablename = 'objects'), 'none')
union all
select 'profiles with a photo', (select count(*)::text from public.profiles where avatar_path is not null)
union all
select 'objects in avatars bucket', (select count(*)::text from storage.objects where bucket_id = 'avatars')
union all
select 'photo rows pointing at a missing object (expect 0)',
       (select count(*)::text from public.profiles p
        where p.avatar_path is not null
          and not exists (select 1 from storage.objects o where o.bucket_id = 'avatars' and o.name = p.avatar_path));
