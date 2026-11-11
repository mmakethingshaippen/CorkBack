-- CorkBack - Stage 8 - PREFLIGHT (read-only) - run BEFORE stage8_moderation.sql
--
-- Writes nothing. Expected values are in the `expect` column; `ok` is true when
-- the value matches (info rows have ok = null). Send me the full output.

with
names as (
  select 'objects' as kind, 'stage 8 objects already present (expect none)' as check_name,
         coalesce(string_agg(n, ', ' order by n), 'none') as actual, 'none' as expect
    from (
      select 'table ' || c.relname as n from pg_class c
       where c.relnamespace = 'public'::regnamespace and c.relname in ('admins', 'posting_reports', 'moderation_log', 'reply_submissions')
      union all
      select 'type ' || t.typname from pg_type t
       where t.typnamespace = 'public'::regnamespace and t.typname in ('report_reason', 'report_status', 'moderation_action_kind')
      union all
      select 'function ' || p.proname from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('is_admin', 'cb_require_admin', 'cb_has_text', 'submit_posting_report', 'delete_own_posting',
                           'set_posting_promoted', 'my_hidden_posting_notice', 'admin_hide_posting', 'admin_restore_posting',
                           'admin_dismiss_report', 'admin_report_queue', 'admin_posting_detail', 'admin_moderation_log',
                           'cb_posting_state', 'cb_reply_rate_ok', 'submit_reply', 'cb_moderation_log_append_only', 'cb_postings_publish_defaults')
      union all
      select 'trigger ' || t.tgname from pg_trigger t
       where not t.tgisinternal and t.tgname in ('postings_publish_defaults', 'moderation_log_append_only', 'moderation_log_no_truncate')
      union all
      select 'column postings.moderation_hidden_at' from information_schema.columns
       where table_schema = 'public' and table_name = 'postings' and column_name = 'moderation_hidden_at'
      union all
      select 'column replies.client_id' from information_schema.columns
       where table_schema = 'public' and table_name = 'replies' and column_name = 'client_id'
    ) x
),
agg as (
  -- Stage 8 replaces posting_reaction_counts (SECURITY DEFINER; Stage 1 filtered only deleted_at).
  -- CREATE OR REPLACE needs the live signature and result columns to match, so check them here.
  select 'aggregate', 'posting_reaction_counts live result columns (guard; stage 8 replaces the body)',
         coalesce((select pg_get_function_result(p.oid) from pg_proc p
                    where p.oid = to_regprocedure('public.posting_reaction_counts(uuid[])')), 'MISSING'),
         'TABLE(posting_id uuid, like_count integer, going_count integer, interested_count integer)'
  union all
  select 'aggregate', 'posting_reaction_counts live: security definer / mentions deleted_at / mentions moderation_hidden_at (info; expect true / true / false before stage 8)',
         coalesce((select p.prosecdef::text || ' / ' || (p.prosrc ilike '%deleted_at%')::text || ' / ' || (p.prosrc ilike '%moderation_hidden_at%')::text
                     from pg_proc p where p.oid = to_regprocedure('public.posting_reaction_counts(uuid[])')), 'MISSING'), null
  union all
  select 'aggregate', 'posting_reaction_counts live body md5 (info)',
         coalesce((select md5(p.prosrc) from pg_proc p where p.oid = to_regprocedure('public.posting_reaction_counts(uuid[])')), 'MISSING'), null
  union all
  select 'aggregate', 'posting_reaction_counts live body (info)',
         coalesce((select regexp_replace(p.prosrc, '\s+', ' ', 'g') from pg_proc p where p.oid = to_regprocedure('public.posting_reaction_counts(uuid[])')), 'MISSING'), null
  union all
  select 'aggregate', 'other SECURITY DEFINER functions in public that mention postings (info; each must exclude moderated rows or be admin-only)',
         coalesce((select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
                    where p.pronamespace = 'public'::regnamespace and p.prosecdef
                      and p.prosrc ~* '\mpostings\M' and p.proname <> 'posting_reaction_counts'), 'none'), null
),
deps as (
  select 'deps', 'stage 6 functions used by stage 8 (posting_is_active, posting_takedown_at)',
         (select count(*)::text from pg_proc where pronamespace = 'public'::regnamespace
           and proname in ('posting_is_active', 'posting_takedown_at')), '2'
),
data as (
  select 'data', 'postings expiring > 32 days after creation (guard; expect 0)',
         (select count(*)::text from public.postings where expires_at > created_at + interval '32 days'), '0'
  union all
  select 'data', 'replies with blank/whitespace-only or > 1000-char bodies (guard; expect 0)',
         (select count(*)::text from public.replies
           where not (char_length(body) between 1 and 1000
                      and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')), '0'
  union all
  select 'data', 'replies rows (info)', (select count(*)::text from public.replies), null
  union all
  select 'data', 'postings: total / deleted / active-not-deleted (info)',
         (select count(*) || ' / ' || count(*) filter (where deleted_at is not null) || ' / '
                 || count(*) filter (where deleted_at is null and now() < public.posting_takedown_at(expires_at, event_date, end_date, end_time, time_zone))
            from public.postings), null
),
pol as (
  select 'policy', 'postings policies now (info; stage 8 replaces read/insert/update)',
         coalesce((select string_agg(policyname || ' [' || cmd || ']', '; ' order by policyname)
                     from pg_policies where schemaname = 'public' and tablename = 'postings'), 'none'), null
  union all
  select 'policy', 'replies policies now (info; stage 8 replaces all three)',
         coalesce((select string_agg(policyname || ' [' || cmd || ']', '; ' order by policyname)
                     from pg_policies where schemaname = 'public' and tablename = 'replies'), 'none'), null
),
priv as (
  select 'privilege', 'authenticated has table-wide UPDATE on postings today (info; stage 8 narrows to content columns)',
         has_table_privilege('authenticated', 'public.postings', 'update')::text, null
  union all
  select 'privilege', 'authenticated can UPDATE postings.lat today (info; stage 8 removes)',
         has_column_privilege('authenticated', 'public.postings', 'lat', 'update')::text, null
  union all
  select 'privilege', 'authenticated can UPDATE postings.expires_at today (info; stage 8 removes)',
         has_column_privilege('authenticated', 'public.postings', 'expires_at', 'update')::text, null
  union all
  select 'privilege', 'authenticated can INSERT postings.created_at / is_promoted today (info; stage 8 removes both)',
         has_column_privilege('authenticated', 'public.postings', 'created_at', 'insert')::text || ' / '
         || has_column_privilege('authenticated', 'public.postings', 'is_promoted', 'insert')::text, null
  union all
  select 'privilege', 'service_role default privileges on new public tables (info; stage 8 revokes them on its private tables)',
         coalesce((select string_agg(distinct privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
                    where grantee = 'service_role' and table_schema = 'public' and table_name = 'postings'), 'none'), null
),
trig as (
  select 'trigger', 'triggers on postings and replies (info)',
         coalesce((select string_agg(c.relname || '.' || t.tgname, ', ' order by c.relname, t.tgname)
                     from pg_trigger t join pg_class c on c.oid = t.tgrelid
                    where c.relnamespace = 'public'::regnamespace and c.relname in ('postings', 'replies') and not t.tgisinternal), 'none'), null
),
totals as (
  select 'totals', 'baseline: postings / replies / profiles / threads / messages (info)',
         (select count(*) from public.postings) || ' / ' || (select count(*) from public.replies) || ' / '
         || (select count(*) from public.profiles) || ' / ' || (select count(*) from public.message_threads) || ' / '
         || (select count(*) from public.messages), null
)
select kind, check_name, actual, expect, case when expect is null then null else actual = expect end as ok
  from (select * from names union all select * from agg union all select * from deps union all select * from data union all select * from pol
        union all select * from priv union all select * from trig union all select * from totals) all_rows;
