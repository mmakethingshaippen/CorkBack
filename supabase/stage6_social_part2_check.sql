-- CorkBack - Stage 6 part 2 (Following) - READ-ONLY CHECK
--
-- Stage 2 needs NO schema or policy change. This single SELECT confirms the
-- existing follows rules the Follow feature relies on, and records the state of
-- the profile trigger (stage5_profile_trigger.sql) for the release gate.
-- It writes nothing. Do NOT apply stage5_profile_trigger.sql based on this.
--
-- Expected (from supabase/schema.sql):
--   F1 follows primary key (follower_id, followee_id)               -> no duplicates
--   F2 no_self_follow check                                         -> no self-follow
--   F3 policies: follows self read   SELECT  (follower or followee)
--                follows self write  INSERT  check follower = auth.uid()
--                follows self delete DELETE  using follower = auth.uid()
--      and no UPDATE/ALL policy (edges cannot be re-pointed)
--   F4 RLS enabled on follows
--   F5 info: triggers on auth.users and whether handle_new_user() exists
--      (2026-11-08 finding: creating auth users did not create profiles, so the
--      trigger is absent or not firing; the sign-up route creates profiles itself)

select 'F1 primary key' as check_name,
       coalesce((select string_agg(a.attname, ',' order by a.attname)
                 from pg_constraint c
                 join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
                 where c.conrelid = 'public.follows'::regclass and c.contype = 'p'), 'MISSING') as actual,
       'followee_id,follower_id' as expected
union all
select 'F2 self-follow check',
       coalesce((select pg_get_constraintdef(c.oid) from pg_constraint c
                 where c.conrelid = 'public.follows'::regclass and c.conname = 'no_self_follow'), 'MISSING'),
       'CHECK ((follower_id <> followee_id))'
union all
select 'F3 policies',
       coalesce((select string_agg(policyname || ' ' || cmd || ' using=' || coalesce(qual, '-') || ' check=' || coalesce(with_check, '-'),
                                   ' | ' order by policyname collate "C")
                 from pg_policies where schemaname = 'public' and tablename = 'follows'), 'NONE'),
       'self delete DELETE using follower; self read SELECT follower or followee; self write INSERT check follower; no UPDATE/ALL'
union all
select 'F4 RLS enabled',
       (select relrowsecurity::text from pg_class where oid = 'public.follows'::regclass),
       'true'
union all
select 'F5 info: auth.users triggers',
       coalesce((select string_agg(tgname || (case when tgenabled = 'D' then ' (disabled)' else '' end), ', ')
                 from pg_trigger where tgrelid = 'auth.users'::regclass and not tgisinternal), 'none'),
       'info only'
union all
select 'F5 info: public.handle_new_user() exists',
       (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace and proname = 'handle_new_user'),
       'info only';
