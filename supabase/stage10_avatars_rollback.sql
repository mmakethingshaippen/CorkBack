-- =====================================================================
-- ROLLBACK for stage10_avatars.sql. Non-destructive by default.
--
-- ORDER: if stage10b_avatar_clear_and_rate_limit.sql was applied, run
-- stage10b_avatar_clear_and_rate_limit_rollback.sql FIRST. Roll the application
-- code back first or at the same time: with cb_set_avatar gone, uploads fail
-- (HTTP 500 "couldn't save", current photo kept) and photos already stored keep
-- displaying because they are only a column and public files.
--
-- Part 1 (runs): drops cb_set_avatar, the only way the column is written.
-- It deliberately KEEPS every protection and all data: the bucket and its
-- files, profiles.avatar_path and its values, the path constraint, the
-- narrowed profiles grants and the three restrictive Storage policies. Keeping
-- the grants and policies means that rolling back never re-opens direct client
-- writes to avatar_path or to the bucket.
--
-- Part 2 (commented out, separate review): fully removes the feature.
-- DESTRUCTIVE and not undoable. Read the notes before uncommenting anything.
-- =====================================================================
begin;

drop function if exists public.cb_set_avatar(uuid, text);

do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_column_privilege(r, 'public.profiles', 'avatar_path', 'INSERT')
       or has_column_privilege(r, 'public.profiles', 'avatar_path', 'UPDATE') then
      raise exception 'rollback assert failed: % can write profiles.avatar_path', r;
    end if;
  end loop;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'avatars no client %' and permissive = 'RESTRICTIVE') <> 3 then
    raise exception 'rollback assert failed: restrictive avatar policies are missing';
  end if;
end $$;

commit;

-- ---------------------------------------------------------------------
-- Part 2: FULL REMOVAL (do not run unless you really want the feature and all
-- photos gone). Do it in this order, one step at a time:
--
--  a) Delete the files first through the Storage API or the dashboard
--     (Storage > avatars > select all > delete). Deleting rows from
--     storage.objects with SQL does NOT delete the files and is not supported.
--  b) Then, in the SQL editor:
--
--     begin;
--     drop policy if exists "avatars no client insert" on storage.objects;
--     drop policy if exists "avatars no client update" on storage.objects;
--     drop policy if exists "avatars no client delete" on storage.objects;
--     alter table public.profiles drop constraint if exists profiles_avatar_path_format;
--     alter table public.profiles drop column if exists avatar_path;   -- deletes every stored path
--     commit;
--
--  c) Delete the empty bucket in the dashboard (Storage > avatars > delete).
--
-- The narrowed grants on public.profiles (insert: id, username; update:
-- username) are left as they are on purpose: they are what sign-up and username
-- editing need, and they keep the table safer than the project defaults.
-- ---------------------------------------------------------------------
