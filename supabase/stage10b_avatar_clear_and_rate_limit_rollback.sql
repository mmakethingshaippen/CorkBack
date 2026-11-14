-- =====================================================================
-- ROLLBACK for stage10b_avatar_clear_and_rate_limit.sql. Non-destructive.
-- Drops ONLY the two functions. Keeps the avatar_uploads table and its rows,
-- every photo, the bucket, avatar_path and all stage 10 protections.
-- After this, deployed code fails closed: uploads return 503 and Remove photo
-- returns 503, so roll the application code back first or at the same time.
-- =====================================================================
begin;
drop function if exists public.cb_avatar_rate_check(uuid);
drop function if exists public.cb_clear_avatar(uuid);

do $$
declare r text;
begin
  -- avatar_path must still be unwritable by clients after rollback.
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.profiles', 'avatar_path', 'INSERT')
       or has_column_privilege(r, 'public.profiles', 'avatar_path', 'UPDATE') then
      raise exception 'rollback assert failed: % can write profiles.avatar_path', r;
    end if;
  end loop;
end $$;
commit;
-- Deliberately left in place: public.avatar_uploads (and its rows). If the
-- table is ever to be removed, that is a separate, reviewed step.