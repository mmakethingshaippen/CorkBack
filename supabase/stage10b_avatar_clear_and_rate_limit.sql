-- =====================================================================
-- DRAFT. DO NOT APPLY. USER REVIEW REQUIRED.
-- CorkBack stage 10b: Remove photo + upload rate limit. Safe to rerun.
-- Requires stage10_avatars.sql (already applied). One transaction: any
-- failed check aborts and applies nothing.
-- =====================================================================
begin;

-- 0) Prerequisites from stage 10 must be present.
do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_path') then
    raise exception 'prerequisite missing: profiles.avatar_path (apply stage10_avatars.sql first)';
  end if;
  if to_regprocedure('public.cb_set_avatar(uuid,text)') is null then
    raise exception 'prerequisite missing: cb_set_avatar (apply stage10_avatars.sql first)';
  end if;
end $$;

-- 1) Clear a photo. service_role only; the route passes the SESSION user id.
--    Returns the old path (null when there was none) so the server can delete
--    the file through the Storage API after this commits.
create or replace function public.cb_clear_avatar(p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_old text;
begin
  if p_user is null then
    raise exception 'user required' using errcode = 'CB400';
  end if;
  select avatar_path into v_old from public.profiles where id = p_user for update;
  if not found then
    raise exception 'profile not found' using errcode = 'CB404';
  end if;
  update public.profiles set avatar_path = null where id = p_user;
  return v_old;
end $$;
revoke all on function public.cb_clear_avatar(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cb_clear_avatar(uuid) to service_role;

-- 2) Upload-attempt ledger (same pattern as reply_submissions). No client
--    access at all; written only by cb_avatar_rate_check. Rows older than 24
--    hours are never read and may be purged by the owner at any time.
create table if not exists public.avatar_uploads (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index if not exists avatar_uploads_recent_idx on public.avatar_uploads (user_id, created_at desc);
alter table public.avatar_uploads enable row level security;
revoke all on public.avatar_uploads from public, anon, authenticated, service_role;

-- 3) Rate check: serialize per user, count, then record this attempt.
--    5 attempts per 10 minutes and 20 per 24 hours. Every attempt that reaches
--    image processing counts, including ones that later fail validation.
create or replace function public.cb_avatar_rate_check(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then
    raise exception 'user required' using errcode = 'CB400';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('cb_avatar:' || p_user::text, 0));
  if (select count(*) from public.avatar_uploads
       where user_id = p_user and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.avatar_uploads
          where user_id = p_user and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate limited' using errcode = 'CB429';
  end if;
  insert into public.avatar_uploads (user_id) values (p_user);
end $$;
revoke all on function public.cb_avatar_rate_check(uuid) from public, anon, authenticated, service_role;
grant execute on function public.cb_avatar_rate_check(uuid) to service_role;

-- 4) Assertions on the ACTUAL resulting state (IF/RAISE, not ASSERT, so they
--    cannot be switched off). Any failure aborts everything.
do $$
declare
  r text;
  f text;
  col text;
  p text;
begin
  foreach f in array array['public.cb_clear_avatar(uuid)', 'public.cb_avatar_rate_check(uuid)', 'public.cb_set_avatar(uuid,text)'] loop
    if not exists (select 1 from pg_proc where oid = f::regprocedure and prosecdef) then
      raise exception 'assert failed: % missing or not SECURITY DEFINER', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then
      raise exception 'assert failed: service_role cannot execute %', f;
    end if;
    foreach r in array array['anon', 'authenticated'] loop
      if has_function_privilege(r, f, 'EXECUTE') then
        raise exception 'assert failed: % can execute %', r, f;
      end if;
    end loop;
    if exists (select 1 from pg_proc x cross join lateral aclexplode(coalesce(x.proacl, acldefault('f', x.proowner))) a
               where x.oid = f::regprocedure and a.grantee = 0) then
      raise exception 'assert failed: PUBLIC can execute %', f;
    end if;
  end loop;

  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach p in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if has_table_privilege(r, 'public.avatar_uploads', p) then
        raise exception 'assert failed: % has % on avatar_uploads', r, p;
      end if;
    end loop;
  end loop;
  if not (select relrowsecurity from pg_class where oid = 'public.avatar_uploads'::regclass) then
    raise exception 'assert failed: RLS disabled on avatar_uploads';
  end if;

  -- Stage 10 guarantees still hold: profiles columns writable exactly as allowed.
  foreach r in array array['anon', 'authenticated'] loop
    for col in select attname::text from pg_attribute
               where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped loop
      foreach p in array array['INSERT', 'UPDATE'] loop
        if has_column_privilege(r, 'public.profiles', col, p)
           and not (r = 'authenticated' and ((p = 'INSERT' and col in ('id', 'username')) or (p = 'UPDATE' and col = 'username'))) then
          raise exception 'assert failed: % has % on profiles.%', r, p, col;
        end if;
      end loop;
    end loop;
    if not has_column_privilege(r, 'public.profiles', 'avatar_path', 'SELECT') then
      raise exception 'assert failed: % cannot read profiles.avatar_path (avatars would not display)', r;
    end if;
  end loop;
end $$;

commit;