-- CorkBack - Stage 7 - ROLLBACK
--
-- Removes the trigger and its function. Profiles are not touched: every profile
-- the trigger created stays, with its username. After rollback the app keeps
-- working: the sign-up route creates the profile itself when none exists, and
-- /welcome lets an account without a profile choose a username.

begin;
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
commit;

-- Check: expect 'none' and 0.
select coalesce((select string_agg(tgname, ', ') from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal), 'none') as auth_users_triggers,
       (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_new_user') as handle_new_user_functions;
