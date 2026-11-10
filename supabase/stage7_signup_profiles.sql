-- CorkBack - Stage 7 - sign-up creates its profile atomically - MIGRATION (review before applying)
--
-- Order: stage7_signup_profiles_preflight.sql -> this file -> stage7_signup_profiles_verify.sql
-- Rollback: stage7_signup_profiles_rollback.sql
--
-- Diagnosis (2026-11-09):
--   * No trigger creates profiles: an auth user created through the admin API
--     got no profile row (probe deleted afterwards). The preflight confirms this
--     from the catalog (auth.users triggers, public.handle_new_user()).
--   * The sign-up route creates the auth user first and the profile second, in
--     separate requests. Two sign-ups racing for one username (or a failed
--     profile write) left an auth user without a profile, and the app had no
--     way to recover it.
--   * Existing data: 5 auth users, 5 profiles, none missing (read-only check).
--
-- Fix: create the profile in the SAME transaction as the auth user.
--   * A valid requested username (sign-up metadata) becomes the profile.
--   * A taken username raises unique_violation, which aborts the auth insert:
--     Supabase Auth answers "Database error saving new user" and NO account is
--     created. The app maps this to "That username was just taken".
--   * No username, or an invalid one (e.g. a dashboard invite): the auth user
--     is created with no profile, and the owner chooses a username on /welcome
--     after signing in. No auto-generated public names.
--   * Unlike supabase/stage5_profile_trigger.sql (NOT applied, superseded), it
--     never silently changes the requested username, and it backfills nothing.
--
-- Compatibility: the app works with or without this migration. The sign-up
-- route still inserts the profile itself when none exists, and never
-- overwrites one. Earlier verify scripts and test setups that insert a profile
-- "on conflict (id) do nothing" after creating an auth user keep working.
-- Changes no existing row.

begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested text := new.raw_user_meta_data ->> 'username';
begin
  if requested is null or requested !~ '^[A-Za-z0-9_]{3,20}$' then
    return new; -- no valid username requested: chosen later on /welcome
  end if;
  -- A taken username raises unique_violation (23505) and aborts the sign-up.
  insert into public.profiles (id, username) values (new.id, requested);
  return new;
end;
$$;

comment on function public.handle_new_user() is
  'CorkBack stage 7: creates the profile for a new auth user from raw_user_meta_data.username in the same transaction; a taken username aborts the sign-up.';

-- Only the trigger calls it.
revoke all on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
