-- CorkBack - Stage 9 - ROLLBACK
--
-- Drops the category_follows table (all category follows are deleted; its
-- policies go with it) and the lower(username) unique index. Dropping the index
-- reopens case-variant usernames at the database level; the app still
-- lowercases new usernames. Profiles, follows, alerts and postings are not touched.
-- After rollback the app keeps running: category reads fall back to an empty list
-- and the follow button shows an error if clicked.
begin;
drop table if exists public.category_follows;
drop index if exists public.profiles_username_lower_key;
commit;
-- Check: expect 0 and 0.
select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'category_follows') as category_follows_tables,
       (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'profiles_username_lower_key') as lower_username_indexes;
