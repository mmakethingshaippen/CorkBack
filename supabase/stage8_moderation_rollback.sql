-- CorkBack - Stage 8 - ROLLBACK (privacy-preserving)
--
-- Revert the app to the stage-7 code FIRST (it never calls these functions).
--
-- What this removes: every stage 8 function (reporting, owner delete, the
-- author notice, all admin actions and reads, is_admin, submit_reply).
--
-- What it deliberately KEEPS, because removing it would widen access:
--  * Hidden postings stay hidden: the postings read policy keeps excluding
--    moderation_hidden_at, so a posting hidden for personal information does
--    not become public again. To un-hide one by hand (SQL editor, owner):
--      update public.postings set moderation_hidden_at = null where id = '<posting id>';
--  * posting_reaction_counts keeps its stage 8 body (no row for hidden or
--    deleted postings). Restoring the Stage 1 body would publish like/going/
--    interested totals for hidden postings again; the signature is unchanged,
--    so the reverted app still works.
--  * posting_reports, moderation_log, admins and reply_submissions stay, with
--    NO client access. The reporter's column-level SELECT grants are revoked
--    EXPLICITLY below (and verified by the check at the end), not only through
--    dropping the read policy. Data is kept for the record; see the optional purge.
--  * Replies: direct INSERT stays closed to every client role and there is no
--    reply function after this rollback. The app has no reply UI yet, so
--    nothing breaks; reopening replies is an owner decision (it would need a
--    new INSERT policy or a restored submit_reply, with its rate limit).
--  * The narrowed author INSERT/UPDATE privileges, the publish trigger
--    (server-set created_at and preset expiry) and the expiry bound stay:
--    restoring the old privileges would let authors move pins, backdate and
--    extend expiry again. The reverted (6289a7e) code works with them; this is
--    exercised by the isolated compatibility test. If phase B was applied and
--    the app is reverted, re-grant is_promoted (see stage8b_promotion_lockdown.sql).
--  * The stricter replies rules stay (no reads on deleted/hidden postings).
-- Messages and threads were never changed.

begin;

drop function if exists public.submit_posting_report(uuid, public.report_reason, text);
drop function if exists public.delete_own_posting(uuid);
drop function if exists public.set_posting_promoted(uuid, boolean);
drop function if exists public.my_hidden_posting_notice(uuid);
drop function if exists public.admin_hide_posting(uuid, text, uuid);
drop function if exists public.admin_restore_posting(uuid, text);
drop function if exists public.admin_dismiss_report(uuid, text);
drop function if exists public.admin_report_queue(text, public.report_reason, integer, integer);
drop function if exists public.admin_posting_detail(uuid);
drop function if exists public.admin_moderation_log(uuid, integer);
drop function if exists public.cb_posting_state(public.postings);
drop function if exists public.cb_require_admin();
drop function if exists public.is_admin();
drop function if exists public.submit_reply(uuid, text, uuid);

-- Reports become owner-only (SQL editor) as well. The column grants made by the
-- migration are revoked explicitly first, then everything on the table.
revoke select (id, posting_id, reason, status, created_at) on public.posting_reports from anon, authenticated;
revoke all on public.posting_reports from anon, authenticated;
drop policy if exists "reports reporter reads own" on public.posting_reports;
revoke all on public.reply_submissions from anon, authenticated, service_role;

commit;

-- Check: expect 0 functions, false for every client-access column, true for the two exclusions.
-- The access columns use has_any_column_privilege, so a leftover COLUMN-level grant shows as true.
select
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
     and proname in ('submit_posting_report', 'delete_own_posting', 'set_posting_promoted', 'my_hidden_posting_notice', 'admin_hide_posting',
                     'admin_restore_posting', 'admin_dismiss_report', 'admin_report_queue', 'admin_posting_detail',
                     'admin_moderation_log', 'cb_posting_state', 'cb_require_admin', 'is_admin', 'submit_reply')) as stage8_functions_left,
  (select coalesce(bool_or(has_any_column_privilege(r, t, 'select,insert,update,references')
                           or has_table_privilege(r, t, 'select,insert,update,delete,truncate')), false)
     from unnest(array['anon', 'authenticated']) r,
          unnest(array['public.posting_reports', 'public.moderation_log', 'public.admins', 'public.reply_submissions']) t) as clients_can_read_moderation_data,
  (select coalesce(bool_or(has_column_privilege(r, 'public.posting_reports', a.attname, 'select')), false)
     from unnest(array['anon', 'authenticated']) r, pg_attribute a
    where a.attrelid = 'public.posting_reports'::regclass and a.attnum > 0 and not a.attisdropped) as clients_can_read_any_report_column,
  (select coalesce(bool_or(has_any_column_privilege(r, 'public.replies', 'insert')), false)
     from unnest(array['anon', 'authenticated', 'service_role']) r) as anyone_can_insert_replies_directly,
  (select qual ilike '%moderation_hidden_at IS NULL%' from pg_policies
    where schemaname = 'public' and tablename = 'postings' and policyname = 'postings public read') as hidden_still_excluded,
  (select prosrc ilike '%moderation_hidden_at is null%' from pg_proc
    where oid = to_regprocedure('public.posting_reaction_counts(uuid[])')) as reaction_counts_still_exclude_hidden;

-- OPTIONAL PURGE (destructive, irreversible). Only if Max decides the moderation
-- records should not be kept. Uncomment deliberately; it is not part of rollback.
-- begin;
-- drop table if exists public.moderation_log, public.posting_reports, public.admins, public.reply_submissions;  -- DROP is owner DDL; triggers don't apply
-- drop function if exists public.cb_moderation_log_append_only();
-- drop type if exists public.moderation_action_kind, public.report_status, public.report_reason;
-- commit;
