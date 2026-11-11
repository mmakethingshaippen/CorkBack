-- CorkBack - Stage 8 - CONTROLLED ADMIN SETUP (for Max only; NOT run by the app or by Kiro)
--
-- Admin access can be granted ONLY here, by the project owner, in the Supabase
-- SQL editor. The app has no grant route, clients have no privileges on
-- public.admins, and no function writes to it.
--
-- Recommended before granting:
--  * Use your own account (strong unique password; you can reset it any time).
--  * Run stage8_moderation_verify_admin.sql and _verify_roles.sql first.
--
-- 1. Replace the placeholder with the username (not the email), then run.
do $$
declare
  v_username constant text := 'REPLACE_WITH_USERNAME';
  v_id uuid;
begin
  if v_username = 'REPLACE_WITH_USERNAME' then
    raise exception 'Edit v_username first. Nothing was changed.';
  end if;
  select id into v_id from public.profiles where username = v_username;
  if v_id is null then
    raise exception 'No profile with username %. Nothing was changed.', v_username;
  end if;
  insert into public.admins (user_id, granted_note)
  values (v_id, 'granted by the project owner in the SQL editor')
  on conflict (user_id) do nothing;
end $$;

-- 2. Current admins (usernames only).
select p.username, a.granted_at, a.granted_note
  from public.admins a join public.profiles p on p.id = a.user_id
 order by a.granted_at;

-- REVOKE (when needed): replace the username and run.
-- delete from public.admins where user_id = (select id from public.profiles where username = 'REPLACE_WITH_USERNAME');
