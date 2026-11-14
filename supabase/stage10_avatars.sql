-- =====================================================================
-- SETUP ONLY: CorkBack stage 10 profile photos. Safe to rerun.
-- One transaction: any failed check aborts and applies nothing.
-- RECORD: applied by the owner in the Supabase SQL editor on 2026-11-13
-- (after a first apply + rollback; this rerun restored cb_set_avatar and the
-- narrowed grants). Keep this text identical to what was applied.
-- =====================================================================
begin;

-- 1) Bucket: create if absent. If present, VERIFY and abort on any difference.
do $$
declare b record;
begin
  select * into b from storage.buckets where id = 'avatars';
  if not found then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('avatars', 'avatars', true, 2097152, array['image/jpeg','image/png','image/webp']);
  elsif b.public is distinct from true
     or b.file_size_limit is distinct from 2097152
     or (select array_agg(t order by t) from unnest(coalesce(b.allowed_mime_types, '{}')) t)
          is distinct from array['image/jpeg','image/png','image/webp'] then
    raise exception 'avatars bucket exists with different settings (public=%, file_size_limit=%, allowed_mime_types=%). Fix by hand; this script does not change it.',
      b.public, b.file_size_limit, b.allowed_mime_types;
  end if;
end $$;

-- 2) Column + path constraint (own folder, uuid filename, jpg/png/webp).
alter table public.profiles add column if not exists avatar_path text;
alter table public.profiles drop constraint if exists profiles_avatar_path_format;
alter table public.profiles add constraint profiles_avatar_path_format check (
  avatar_path is null or (
    avatar_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$'
    and split_part(avatar_path, '/', 1) = id::text));

-- 3) Privileges on profiles.
--    Table-level revoke (also clears matching column grants), then an explicit
--    column-level revoke, then only the grants signup and username editing need.
revoke insert, update on public.profiles from public, anon, authenticated;
revoke insert (id, username, created_at, avatar_path),
       update (id, username, created_at, avatar_path)
  on public.profiles from public, anon, authenticated;
grant insert (id, username) on public.profiles to authenticated;  -- /welcome signup
grant update (username)     on public.profiles to authenticated;  -- username editing

-- 4) The only way to set avatar_path: service role only.
create or replace function public.cb_set_avatar(p_user uuid, p_path text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  old_path text;
  md jsonb;
  mt text;
  sz_text text;
  sz bigint;
begin
  if p_user is null or p_path is null or split_part(p_path, '/', 1) <> p_user::text then
    raise exception 'avatar_path_owner' using errcode = '42501';
  end if;

  select o.metadata into md
    from storage.objects o where o.bucket_id = 'avatars' and o.name = p_path;
  if not found then
    raise exception 'avatar_object_missing' using errcode = 'P0002';
  end if;

  mt := md ->> 'mimetype';
  sz_text := md ->> 'size';
  if mt is null or btrim(mt) = '' then
    raise exception 'avatar_object_invalid: missing mime type' using errcode = '22023';
  end if;
  if mt not in ('image/jpeg', 'image/png', 'image/webp') then
    raise exception 'avatar_object_invalid: mime type %', mt using errcode = '22023';
  end if;
  if sz_text is null or sz_text !~ '^[0-9]{1,10}$' then
    raise exception 'avatar_object_invalid: missing size' using errcode = '22023';
  end if;
  sz := sz_text::bigint;
  if sz < 1 or sz > 2097152 then
    raise exception 'avatar_object_invalid: size %', sz using errcode = '22023';
  end if;

  select avatar_path into old_path from public.profiles where id = p_user for update;
  if not found then
    raise exception 'avatar_no_profile' using errcode = 'P0002';
  end if;
  update public.profiles set avatar_path = p_path where id = p_user;
  return old_path;  -- the server deletes the old file through the Storage API
end $$;
revoke all on function public.cb_set_avatar(uuid, text) from public, anon, authenticated;
grant execute on function public.cb_set_avatar(uuid, text) to service_role;

-- 5) Restrictive policies: ANDed with any other policy, so no permissive
--    policy can let a client write the avatars bucket.
drop policy if exists "avatars no client insert" on storage.objects;
create policy "avatars no client insert" on storage.objects as restrictive
  for insert to anon, authenticated with check (bucket_id <> 'avatars');
drop policy if exists "avatars no client update" on storage.objects;
create policy "avatars no client update" on storage.objects as restrictive
  for update to anon, authenticated using (bucket_id <> 'avatars') with check (bucket_id <> 'avatars');
drop policy if exists "avatars no client delete" on storage.objects;
create policy "avatars no client delete" on storage.objects as restrictive
  for delete to anon, authenticated using (bucket_id <> 'avatars');

-- 6) Assertions on the ACTUAL resulting state. Any failure aborts everything.
do $$
declare
  r text;
  col text;
  p text;
  has_it boolean;
  allowed boolean;
begin
  -- Every column, both client roles, INSERT and UPDATE: exactly the allowed set.
  foreach r in array array['anon', 'authenticated'] loop
    for col in select attname::text from pg_attribute
               where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped loop
      foreach p in array array['INSERT', 'UPDATE'] loop
        has_it := has_column_privilege(r, 'public.profiles', col, p);
        allowed := (r = 'authenticated' and ((p = 'INSERT' and col in ('id', 'username'))
                                          or (p = 'UPDATE' and col = 'username')));
        if has_it and not allowed then
          raise exception 'assert failed: % has % on profiles.%', r, p, col;
        end if;
        if allowed and not has_it then
          raise exception 'assert failed: % lacks required % on profiles.%', r, p, col;
        end if;
      end loop;
    end loop;
    if has_function_privilege(r, 'public.cb_set_avatar(uuid,text)', 'EXECUTE') then
      raise exception 'assert failed: role % can execute cb_set_avatar', r;
    end if;
  end loop;

  -- PUBLIC pseudo-role (grantee 0): table, any column, and the function.
  if exists (select 1 from pg_class c cross join lateral aclexplode(c.relacl) a
             where c.oid = 'public.profiles'::regclass and a.grantee = 0)
     or exists (select 1 from pg_attribute t cross join lateral aclexplode(t.attacl) a
             where t.attrelid = 'public.profiles'::regclass and t.attacl is not null and a.grantee = 0)
     or exists (select 1 from pg_proc f
             cross join lateral aclexplode(coalesce(f.proacl, acldefault('f', f.proowner))) a
             where f.oid = 'public.cb_set_avatar(uuid,text)'::regprocedure and a.grantee = 0) then
    raise exception 'assert failed: PUBLIC holds a privilege on profiles or cb_set_avatar';
  end if;

  -- Function exists and only service_role can run it.
  if not exists (select 1 from pg_proc where oid = 'public.cb_set_avatar(uuid,text)'::regprocedure and prosecdef) then
    raise exception 'assert failed: cb_set_avatar missing or not SECURITY DEFINER';
  end if;
  if not has_function_privilege('service_role', 'public.cb_set_avatar(uuid,text)', 'EXECUTE') then
    raise exception 'assert failed: service_role cannot execute cb_set_avatar';
  end if;

  -- RLS on everything this design relies on.
  if exists (select 1 from pg_class
             where oid in ('public.profiles'::regclass, 'storage.objects'::regclass, 'storage.buckets'::regclass)
               and not relrowsecurity) then
    raise exception 'assert failed: RLS disabled on profiles, storage.objects or storage.buckets';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars no client %' and permissive = 'RESTRICTIVE') <> 3 then
    raise exception 'assert failed: restrictive avatar policies missing';
  end if;

  -- Bucket has exactly the approved settings.
  if not exists (select 1 from storage.buckets where id = 'avatars' and public = true
                 and file_size_limit = 2097152
                 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']
                 and array_length(allowed_mime_types, 1) = 3) then
    raise exception 'assert failed: avatars bucket settings differ';
  end if;
end $$;

commit;