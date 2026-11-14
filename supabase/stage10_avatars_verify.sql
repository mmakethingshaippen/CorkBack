-- VERIFY for stage10_avatars.sql. Run AFTER it is applied (and again after any
-- change to profiles, storage policies or the avatars bucket).
--
-- Everything runs in ONE transaction that is ROLLED BACK at the end: it creates
-- two temporary users, a profile for each and a few fake Storage rows, then
-- tries every attack with the real client roles. Nothing is kept. No real user
-- or file is read or changed. It raises an error at the first failed check; on
-- success the last result row says 'stage10 verify: all checks passed'.
--
-- Run it in the SQL editor (role postgres). If it errors, nothing was changed.
begin;

do $$
declare
  a uuid := gen_random_uuid();   -- the owner
  b uuid := gen_random_uuid();   -- another signed-in user
  pa text;                       -- a's valid photo path
  pb text;                       -- b's valid photo path
  gif text;
  big text;
  n int;
  got text;
  r text;
  p text;
  col text;
begin
  ---------------------------------------------------------------- static
  foreach r in array array['anon', 'authenticated'] loop
    for col in select attname::text from pg_attribute
               where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped loop
      foreach p in array array['INSERT', 'UPDATE'] loop
        if has_column_privilege(r, 'public.profiles', col, p)
           and not (r = 'authenticated' and ((p = 'INSERT' and col in ('id', 'username')) or (p = 'UPDATE' and col = 'username'))) then
          raise exception 'verify failed: % has % on profiles.%', r, p, col;
        end if;
      end loop;
    end loop;
    if has_function_privilege(r, 'public.cb_set_avatar(uuid,text)', 'EXECUTE') then
      raise exception 'verify failed: % can execute cb_set_avatar', r;
    end if;
    if not has_column_privilege(r, 'public.profiles', 'avatar_path', 'SELECT') then
      raise exception 'verify failed: % cannot read avatar_path', r;
    end if;
  end loop;
  if not exists (select 1 from storage.buckets where id = 'avatars' and public = true
                 and file_size_limit = 2097152
                 and allowed_mime_types @> array['image/jpeg','image/png','image/webp']
                 and array_length(allowed_mime_types, 1) = 3) then
    raise exception 'verify failed: avatars bucket settings differ from the approved ones';
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars no client %' and permissive = 'RESTRICTIVE') <> 3 then
    raise exception 'verify failed: restrictive avatar policies missing';
  end if;

  ---------------------------------------------------------------- fixtures (as postgres)
  insert into auth.users (id, aud, role, email) values
    (a, 'authenticated', 'authenticated', 'stage10-verify-a@invalid.example'),
    (b, 'authenticated', 'authenticated', 'stage10-verify-b@invalid.example');
  insert into public.profiles (id, username) values (a, 'zz_v10_a') on conflict (id) do nothing;
  insert into public.profiles (id, username) values (b, 'zz_v10_b') on conflict (id) do nothing;
  if (select count(*) from public.profiles where id in (a, b)) <> 2 then
    raise exception 'verify could not create its temporary profiles';
  end if;

  pa  := a::text || '/' || gen_random_uuid()::text || '.webp';
  pb  := b::text || '/' || gen_random_uuid()::text || '.webp';
  gif := a::text || '/' || gen_random_uuid()::text || '.webp';
  big := a::text || '/' || gen_random_uuid()::text || '.webp';
  insert into storage.objects (bucket_id, name, metadata) values
    ('avatars', pa,  '{"mimetype":"image/webp","size":1234}'),
    ('avatars', pb,  '{"mimetype":"image/webp","size":1234}'),
    ('avatars', gif, '{"mimetype":"image/gif","size":1234}'),
    ('avatars', big, '{"mimetype":"image/webp","size":99999999}');

  ---------------------------------------------------------------- cb_set_avatar rules (as postgres)
  if public.cb_set_avatar(a, pa) is not null then raise exception 'verify failed: first set should return null'; end if;
  if (select avatar_path from public.profiles where id = a) is distinct from pa then
    raise exception 'verify failed: cb_set_avatar did not store the path';
  end if;
  begin perform public.cb_set_avatar(a, pb);  raise exception 'verify failed: set accepted another user''s folder';
  exception when sqlstate '42501' then null; end;
  begin perform public.cb_set_avatar(a, a::text || '/' || gen_random_uuid()::text || '.webp'); raise exception 'verify failed: set accepted a missing object';
  exception when sqlstate 'P0002' then null; end;
  begin perform public.cb_set_avatar(a, gif); raise exception 'verify failed: set accepted image/gif';
  exception when sqlstate '22023' then null; end;
  begin perform public.cb_set_avatar(a, big); raise exception 'verify failed: set accepted an oversized object';
  exception when sqlstate '22023' then null; end;
  begin perform public.cb_set_avatar(a, 'https://example.com/x.png'); raise exception 'verify failed: set accepted an external URL';
  exception when sqlstate '42501' then null; end;
  begin update public.profiles set avatar_path = 'https://example.com/x.png' where id = a; raise exception 'verify failed: constraint accepted an external URL';
  exception when check_violation then null; end;
  if (select avatar_path from public.profiles where id = a) is distinct from pa then
    raise exception 'verify failed: a rejected call changed the photo';
  end if;

  ---------------------------------------------------------------- user b attacks user a (role authenticated)
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  begin update public.profiles set avatar_path = null where id = a; raise exception 'verify failed: b could write a''s avatar_path';
  exception when insufficient_privilege then null; end;
  begin update public.profiles set avatar_path = pb where id = b; raise exception 'verify failed: b could write his own avatar_path directly';
  exception when insufficient_privilege then null; end;
  begin insert into public.profiles (id, username, avatar_path) values (gen_random_uuid(), 'zz_v10_x', pa); raise exception 'verify failed: insert with avatar_path allowed';
  exception when insufficient_privilege then null; end;

  update public.profiles set username = 'zz_v10_hack' where id = a;   -- RLS: must touch 0 rows
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'verify failed: b changed a''s username'; end if;

  begin perform public.cb_set_avatar(b, pb); raise exception 'verify failed: authenticated can call cb_set_avatar';
  exception when insufficient_privilege then null; end;

  begin insert into storage.objects (bucket_id, name, metadata) values ('avatars', a::text || '/' || gen_random_uuid()::text || '.webp', '{"mimetype":"image/webp","size":10}');
        raise exception 'verify failed: b could upload into a''s folder';
  exception when insufficient_privilege then null; end;
  begin insert into storage.objects (bucket_id, name, metadata) values ('avatars', b::text || '/' || gen_random_uuid()::text || '.webp', '{"mimetype":"image/webp","size":10}');
        raise exception 'verify failed: b could upload into his own folder directly';
  exception when insufficient_privilege then null; end;

  begin update storage.objects set name = a::text || '/renamed.webp' where bucket_id = 'avatars' and name = pa; get diagnostics n = row_count;
        if n <> 0 then raise exception 'verify failed: b updated a''s object'; end if;
  exception when insufficient_privilege then null; end;
  begin delete from storage.objects where bucket_id = 'avatars' and name = pa; get diagnostics n = row_count;
        if n <> 0 then raise exception 'verify failed: b deleted a''s object'; end if;
  exception when insufficient_privilege then null; end;

  ---------------------------------------------------------------- anonymous visitor
  reset role;
  set local role anon;
  select avatar_path into got from public.profiles where id = a;
  if got is distinct from pa then raise exception 'verify failed: anon cannot read avatar_path (avatars would not display)'; end if;
  begin update public.profiles set avatar_path = null where id = a; raise exception 'verify failed: anon wrote avatar_path';
  exception when insufficient_privilege then null; end;
  begin delete from storage.objects where bucket_id = 'avatars' and name = pa; get diagnostics n = row_count;
        if n <> 0 then raise exception 'verify failed: anon deleted an object'; end if;
  exception when insufficient_privilege then null; end;

  ---------------------------------------------------------------- nothing was altered
  reset role;
  if (select avatar_path from public.profiles where id = a) is distinct from pa
     or (select username from public.profiles where id = a) <> 'zz_v10_a'
     or not exists (select 1 from storage.objects where bucket_id = 'avatars' and name = pa) then
    raise exception 'verify failed: an attack changed state';
  end if;
end $$;

select 'stage10 verify: all checks passed' as result;
rollback;
