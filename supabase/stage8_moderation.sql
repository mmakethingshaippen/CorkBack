-- CorkBack - Stage 8 - reporting, admin moderation, public replies, owner edit/delete - MIGRATION
-- REVIEW BEFORE APPLYING. Spec: .kiro/specs/moderation/design.md
--
-- Order: stage8_moderation_preflight.sql -> this file -> stage8_moderation_verify_admin.sql
--        -> stage8_moderation_verify_roles.sql.  Rollback: stage8_moderation_rollback.sql
--
-- Additive and safe for the currently deployed code (6289a7e): it never reads
-- the new tables; its publish insert, promote update and reads still work.
--
-- This is PHASE A. It keeps the deployed promote toggle working (authors keep
-- UPDATE on is_promoted). PHASE B (stage8b_promotion_lockdown.sql) removes that
-- privilege and is applied only AFTER the new code (which promotes through
-- set_posting_promoted) is in production. Release order: design.md section 11.
--
-- What it does
--  1. postings.moderation_hidden_at: moderation state SEPARATE from author
--     deletion (deleted_at) and from expiry/event end. Only admin functions set it.
--  2. Postings read policy excludes moderated rows for everyone. Maps, feeds,
--     profiles, Following, Friends, direct links, likes/plans checks and new
--     message threads all read through this policy, so exclusion is consistent.
--  3. Publishing (INSERT): clients may supply only the columns the publish
--     route sends. id, created_at, is_promoted, deleted_at, moderation state and
--     flyer_url are server-side. A trigger sets created_at = now() and computes
--     expires_at from the chosen preset (same table as src/lib/domain.ts), so a
--     client can't choose its own expiry or backdate.
--  4. Editing (UPDATE): authors may change only content fields (and, until
--     phase B, is_promoted), only on their own active, visible postings. Pin,
--     author, expiry, timestamps, deletion and moderation are not updatable.
--     This closes live finding F4 (author moved a pin / extended expiry via the
--     API). Soft delete goes through delete_own_posting(); promotion through
--     set_posting_promoted().
--  5. Reports: private table, inserted only through submit_posting_report(),
--     which enforces sign-in, visibility, not-own-posting, one pending report
--     per reporter and posting, and rate limits. No automatic hiding, ever.
--  6. Admins: table with no privileges for anon, authenticated or service_role.
--     is_admin() is the only window. Admin functions check it themselves and
--     write an append-only audit log. Nothing here can make anyone an admin
--     (owner-only: stage8_admin_grant.sql).
--  7. Replies: written ONLY through submit_reply() (no direct INSERT for any
--     client role). It validates the body, requires an active visible posting,
--     is idempotent per (user, posting, client_id), and enforces the rate limit
--     (10 per 10 minutes) against a durable ledger, public.reply_submissions,
--     under a per-user advisory lock. Concurrent requests are serialized, and
--     deleting a reply does not give the allowance back.
--  8. posting_reaction_counts() (a Stage 1 SECURITY DEFINER aggregate) is
--     replaced so moderated postings return no row. Stage 1 filtered only
--     deleted_at, so it kept returning like/going/interested totals for a
--     hidden posting to anyone who knew its id.
--  Messages and message_threads are not touched; admins get no message access.
--
-- Lock order (every function that takes more than one lock follows it, so
-- concurrent calls cannot deadlock):
--    1. the postings row         (FOR UPDATE: hide, restore, promote; FOR SHARE: report,
--                                  dismiss; the UPDATE in delete_own_posting)
--    2. the caller's advisory lock  (per-user: 'cb_report:' / 'cb_reply:')
--    3. posting_reports / reply_submissions rows
-- FOR SHARE conflicts with hide's FOR UPDATE and with delete_own_posting's
-- UPDATE, so a report can never be added to a posting that has become hidden or
-- deleted: the reporter waits, re-checks the posting after the other
-- transaction commits, and gets CB404. Reporters do not block each other.
--
-- Who can change the audit log (moderation_log)
--  * anon, authenticated, service_role: no privileges at all (no select,
--    insert, update, delete or truncate). service_role is revoked explicitly,
--    because Supabase grants it everything on new tables and it bypasses RLS.
--  * Admins write it only indirectly, through the admin functions.
--  * The table owner (postgres): UPDATE, DELETE and TRUNCATE are refused by
--    triggers while they are enabled. An UPDATE may not change id, action,
--    admin_username, reason or created_at. A reference (posting_id, report_id,
--    admin_id) may only change from a value to null, and only when the row it
--    pointed to no longer exists, which is exactly what the foreign keys'
--    ON DELETE SET NULL does. Manually nulling a reference to a row that still
--    exists is refused.
--  * Limits, stated plainly: the owner CAN deliberately bypass all of this with
--    DDL (ALTER TABLE ... DISABLE TRIGGER, DROP TRIGGER, DROP TABLE) or by
--    running with session_replication_role = replica, and Supabase's superuser
--    can do anything. The owner can also hard-delete a posting, report or
--    profile, which (by design of the foreign keys) detaches the audit rows that
--    pointed to it; the audit row itself, with the admin's username and reason,
--    stays. That is the maintenance path: an explicit, reviewed step in the SQL
--    editor, never routine DML. This protects against application roles and
--    accidental edits, not against the database owner.

begin;

-- 0. Guards (nothing is changed if these fail; run the preflight to see details).
do $$
begin
  if exists (select 1 from public.postings where expires_at > created_at + interval '32 days') then
    raise exception 'A posting expires more than 32 days after creation; review before stage 8 (nothing was changed)';
  end if;
  if exists (
    select 1 from public.replies
    where not (char_length(body) between 1 and 1000
               and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
  ) then
    raise exception 'replies has a blank or over-1000-character body; review before stage 8 (nothing was changed)';
  end if;
end $$;

-- 1. Types.
do $$ begin
  create type public.report_reason as enum ('spam_scam', 'inappropriate', 'misleading', 'personal_info', 'duplicate', 'other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.report_status as enum ('pending', 'dismissed', 'actioned');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.moderation_action_kind as enum ('dismiss_report', 'hide_posting', 'restore_posting');
exception when duplicate_object then null; end $$;

-- 2. Moderation state on postings, and bounded expiry.
alter table public.postings add column if not exists moderation_hidden_at timestamptz;
create index if not exists postings_moderation_hidden_idx on public.postings (id) where moderation_hidden_at is not null;

do $$ begin
  alter table public.postings
    add constraint postings_expiry_bounded check (expires_at <= created_at + interval '32 days');
exception when duplicate_object then null; end $$;

-- 2b. Public aggregate counts must not describe moderated postings.
-- Stage 1 created this SECURITY DEFINER function (it bypasses the postings
-- policy, so the policy change below does not reach it) and filtered only on
-- deleted_at. Same signature, columns and grants; the only change is the
-- moderation filter. Ordinary callers (anon, authenticated, including the
-- posting's author and admins) get no row for a hidden or deleted posting.
create or replace function public.posting_reaction_counts(p_ids uuid[])
returns table (posting_id uuid, like_count integer, going_count integer, interested_count integer)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    p.id,
    (select count(*)::int from public.likes l  where l.posting_id = p.id),
    (select count(*)::int from public.plans pl where pl.posting_id = p.id and pl.kind = 'going'),
    (select count(*)::int from public.plans pl where pl.posting_id = p.id and pl.kind = 'interested')
  from public.postings p
  where p.id = any (p_ids[1:500])
    and p.deleted_at is null
    and p.moderation_hidden_at is null
$$;
revoke all on function public.posting_reaction_counts(uuid[]) from public;
grant execute on function public.posting_reaction_counts(uuid[]) to anon, authenticated;

-- 3. Postings policies and column privileges.
alter table public.postings enable row level security;

drop policy if exists "postings public read" on public.postings;
create policy "postings public read" on public.postings
  for select
  using (deleted_at is null and moderation_hidden_at is null);

drop policy if exists "postings author insert" on public.postings;
create policy "postings author insert" on public.postings
  for insert to authenticated
  with check (auth.uid() = author_id and deleted_at is null and moderation_hidden_at is null);

drop policy if exists "postings author update" on public.postings;
drop policy if exists "postings author edit" on public.postings;
create policy "postings author edit" on public.postings
  for update to authenticated
  using (auth.uid() = author_id and deleted_at is null and moderation_hidden_at is null
         and public.posting_is_active(id))
  with check (auth.uid() = author_id and deleted_at is null and moderation_hidden_at is null);

-- INSERT: exactly the columns the publish route sends (src/app/api/postings/route.ts).
revoke insert on public.postings from anon, authenticated;
grant insert (author_id, title, body, category_id, rsvp_url, event_date, event_time, end_date, end_time,
              time_zone, place_label, lat, lng, expiry, expires_at)
  on public.postings to authenticated;

-- Server-set publishing fields, whatever the client sent: created_at is now(),
-- expires_at is now() + the preset (src/lib/domain.ts PRESET_MS: 1m = 30 days).
create or replace function public.cb_postings_publish_defaults()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.created_at := now();
  new.expires_at := now() + case new.expiry
    when '24h' then interval '24 hours'
    when '3d'  then interval '3 days'
    when '1w'  then interval '7 days'
    when '2w'  then interval '14 days'
    when '1m'  then interval '30 days'
  end;
  return new;
end;
$$;
drop trigger if exists postings_publish_defaults on public.postings;
create trigger postings_publish_defaults
  before insert on public.postings
  for each row execute function public.cb_postings_publish_defaults();

-- UPDATE: content fields only, plus is_promoted UNTIL PHASE B (the deployed
-- promote toggle updates it directly). NOT updatable: pin (lat/lng), author,
-- expiry, created_at, flyer_url, time_zone, deleted_at, moderation_hidden_at.
revoke update on public.postings from anon, authenticated;
grant update (title, body, category_id, rsvp_url, event_date, event_time, end_date, end_time, place_label, is_promoted)
  on public.postings to authenticated;

-- 4. Admins (no client access at all).
create table if not exists public.admins (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  granted_at   timestamptz not null default now(),
  granted_note text
);
alter table public.admins enable row level security;
-- service_role too: no API key (including the server's service key) can grant admin.
revoke all on public.admins from anon, authenticated, service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid())
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Internal: the calling admin's id, or raise 42501.
create or replace function public.cb_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke all on function public.cb_require_admin() from public;

-- Non-blank text (same whitespace class as messages and the app's trim()).
create or replace function public.cb_has_text(p text)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p is not null and p ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
$$;
grant execute on function public.cb_has_text(text) to anon, authenticated;

-- 5. Reports (private).
create table if not exists public.posting_reports (
  id              uuid primary key default gen_random_uuid(),
  posting_id      uuid not null references public.postings(id) on delete cascade,
  reporter_id     uuid not null references public.profiles(id) on delete cascade,
  reason          public.report_reason not null,
  details         text,
  status          public.report_status not null default 'pending',
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id) on delete set null,
  resolution_note text,
  constraint posting_reports_details_len check (details is null or char_length(details) <= 1000),
  constraint posting_reports_note_len    check (resolution_note is null or char_length(resolution_note) <= 500),
  constraint posting_reports_resolution  check ((status = 'pending') = (resolved_at is null))
);
create unique index if not exists posting_reports_one_pending
  on public.posting_reports (posting_id, reporter_id) where status = 'pending';
create index if not exists posting_reports_queue_idx on public.posting_reports (status, created_at desc);
create index if not exists posting_reports_reporter_idx on public.posting_reports (reporter_id, created_at desc);

alter table public.posting_reports enable row level security;
revoke all on public.posting_reports from anon, authenticated, service_role;
-- A reporter may see that they reported a posting (reason, status, date) - never anyone else's.
grant select (id, posting_id, reason, status, created_at) on public.posting_reports to authenticated;
drop policy if exists "reports reporter reads own" on public.posting_reports;
create policy "reports reporter reads own" on public.posting_reports
  for select to authenticated
  using (reporter_id = auth.uid());

-- 6. Append-only moderation audit log.
create table if not exists public.moderation_log (
  id             bigint generated always as identity primary key,
  action         public.moderation_action_kind not null,
  posting_id     uuid references public.postings(id) on delete set null,
  report_id      uuid references public.posting_reports(id) on delete set null,
  admin_id       uuid references public.profiles(id) on delete set null,
  admin_username text not null,
  reason         text,
  created_at     timestamptz not null default now(),
  constraint moderation_log_reason_len check (reason is null or char_length(reason) <= 500),
  constraint moderation_log_reason_required check (action = 'dismiss_report' or public.cb_has_text(reason))
);
create index if not exists moderation_log_posting_idx on public.moderation_log (posting_id, created_at desc);
alter table public.moderation_log enable row level security;
revoke all on public.moderation_log from anon, authenticated, service_role;

-- Rows can't be deleted or truncated (including by the owner while the triggers
-- are enabled). An UPDATE may not touch id, action, admin_username, reason or
-- created_at. The only permitted change is a reference (posting_id, report_id,
-- admin_id) going from a value to null because the row it pointed to is gone,
-- which is what ON DELETE SET NULL does. Nulling a reference whose target still
-- exists, or pointing it somewhere else, is refused.
create or replace function public.cb_moderation_log_append_only()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception 'moderation_log is append-only' using errcode = '42501';
  end if;
  if new.id is distinct from old.id
     or new.action is distinct from old.action
     or new.admin_username is distinct from old.admin_username
     or new.reason is distinct from old.reason
     or new.created_at is distinct from old.created_at then
    raise exception 'moderation_log is append-only' using errcode = '42501';
  end if;
  if new.posting_id is distinct from old.posting_id
     and (new.posting_id is not null or exists (select 1 from public.postings where id = old.posting_id)) then
    raise exception 'moderation_log is append-only (posting reference)' using errcode = '42501';
  end if;
  if new.report_id is distinct from old.report_id
     and (new.report_id is not null or exists (select 1 from public.posting_reports where id = old.report_id)) then
    raise exception 'moderation_log is append-only (report reference)' using errcode = '42501';
  end if;
  if new.admin_id is distinct from old.admin_id
     and (new.admin_id is not null or exists (select 1 from public.profiles where id = old.admin_id)) then
    raise exception 'moderation_log is append-only (admin reference)' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists moderation_log_append_only on public.moderation_log;
create trigger moderation_log_append_only
  before update or delete on public.moderation_log
  for each row execute function public.cb_moderation_log_append_only();
drop trigger if exists moderation_log_no_truncate on public.moderation_log;
create trigger moderation_log_no_truncate
  before truncate on public.moderation_log
  for each statement execute function public.cb_moderation_log_append_only();

-- 7. Reporting.
-- Returns 'created' or 'already_reported'. Errors: 42501 signed out,
-- CB404 not found/not visible, CB400 own posting, CB413 details too long, CB429 rate limited.
create or replace function public.submit_posting_report(p_posting_id uuid, p_reason public.report_reason, p_details text default null)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_author uuid;
  v_details text := case when public.cb_has_text(p_details) then btrim(p_details) else null end;
begin
  if v_uid is null then raise exception 'sign in to report' using errcode = '42501'; end if;
  if p_reason is null then raise exception 'reason required' using errcode = 'CB400'; end if;
  if v_details is not null and char_length(v_details) > 1000 then raise exception 'details too long' using errcode = 'CB413'; end if;
  -- Lock order step 1: share-lock the posting row. This waits for an admin hide
  -- (FOR UPDATE) or an author delete (UPDATE) in progress; once they commit the
  -- row no longer matches and the report is refused. Hide/delete in turn wait
  -- for this transaction, so a pending report is always seen (and actioned) by
  -- a hide that follows. Reporters do not block each other.
  select author_id into v_author from public.postings
   where id = p_posting_id and deleted_at is null and moderation_hidden_at is null
   for share;
  if not found then raise exception 'posting not available' using errcode = 'CB404'; end if;
  if v_author = v_uid then raise exception 'own posting' using errcode = 'CB400'; end if;

  -- Lock order step 2: one reporter at a time, so concurrent bursts count correctly.
  perform pg_advisory_xact_lock(hashtextextended('cb_report:' || v_uid::text, 0));
  if exists (select 1 from public.posting_reports
              where posting_id = p_posting_id and reporter_id = v_uid and status = 'pending') then
    return 'already_reported';
  end if;
  if (select count(*) from public.posting_reports where reporter_id = v_uid and created_at > now() - interval '10 minutes') >= 5
     or (select count(*) from public.posting_reports where reporter_id = v_uid and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'rate limited' using errcode = 'CB429';
  end if;
  insert into public.posting_reports (posting_id, reporter_id, reason, details)
  values (p_posting_id, v_uid, p_reason, v_details);
  return 'created';
end;
$$;
revoke all on function public.submit_posting_report(uuid, public.report_reason, text) from public;
grant execute on function public.submit_posting_report(uuid, public.report_reason, text) to authenticated;

-- 8. Owner soft delete. Returns 'deleted' or 'already_deleted'; CB404 if not the author.
-- Works on active, ended and moderated postings. Never touches moderation state.
create or replace function public.delete_own_posting(p_posting_id uuid)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'sign in' using errcode = '42501'; end if;
  update public.postings set deleted_at = now()
   where id = p_posting_id and author_id = v_uid and deleted_at is null;
  if found then return 'deleted'; end if;
  if exists (select 1 from public.postings where id = p_posting_id and author_id = v_uid) then return 'already_deleted'; end if;
  raise exception 'not found' using errcode = 'CB404';
end;
$$;
revoke all on function public.delete_own_posting(uuid) from public;
grant execute on function public.delete_own_posting(uuid) to authenticated;

-- 8b. Promotion: the authorized operation (same rules as /api/postings/promote).
-- Author only; never on deleted or moderated postings; promoting requires an
-- active posting, un-promoting is allowed once it has ended.
-- Returns 'promoted' / 'unpromoted'. Errors: 42501 signed out, CB404 not the
-- author's visible posting, CB409 promoting an ended posting.
create or replace function public.set_posting_promoted(p_posting_id uuid, p_promoted boolean)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_uid uuid := auth.uid(); v_row public.postings%rowtype;
begin
  if v_uid is null then raise exception 'sign in' using errcode = '42501'; end if;
  if p_promoted is null then raise exception 'promoted must be true or false' using errcode = 'CB400'; end if;
  select * into v_row from public.postings
   where id = p_posting_id and author_id = v_uid and deleted_at is null and moderation_hidden_at is null
   for update;
  if not found then raise exception 'not found' using errcode = 'CB404'; end if;
  if p_promoted and now() >= public.posting_takedown_at(v_row.expires_at, v_row.event_date, v_row.end_date, v_row.end_time, v_row.time_zone) then
    raise exception 'posting has ended' using errcode = 'CB409';
  end if;
  update public.postings set is_promoted = p_promoted where id = p_posting_id;
  return case when p_promoted then 'promoted' else 'unpromoted' end;
end;
$$;
revoke all on function public.set_posting_promoted(uuid, boolean) from public;
grant execute on function public.set_posting_promoted(uuid, boolean) to authenticated;

-- 9. The author's view of their own moderated posting: when it was hidden and
-- the moderator's stated reason. Never reveals reporters or report details.
create or replace function public.my_hidden_posting_notice(p_posting_id uuid)
returns table (hidden_at timestamptz, reason text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.moderation_hidden_at,
         (select l.reason from public.moderation_log l
           where l.posting_id = p.id and l.action = 'hide_posting'
           order by l.created_at desc limit 1)
    from public.postings p
   where p.id = p_posting_id and p.author_id = auth.uid()
     and p.deleted_at is null and p.moderation_hidden_at is not null
$$;
revoke all on function public.my_hidden_posting_notice(uuid) from public;
grant execute on function public.my_hidden_posting_notice(uuid) to authenticated;

-- 10. Admin actions. Each checks is_admin, runs in one transaction, and logs.
-- Errors: 42501 not admin, CB422 missing reason, CB404 posting or report not found,
-- CB400 report belongs to another posting, CB409 author-deleted.
create or replace function public.admin_hide_posting(p_posting_id uuid, p_reason text, p_report_id uuid default null)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_admin uuid := public.cb_require_admin(); v_row public.postings%rowtype; v_reason text := btrim(p_reason); v_report_posting uuid;
begin
  if not public.cb_has_text(p_reason) or char_length(v_reason) > 500 then raise exception 'reason required (1-500 characters)' using errcode = 'CB422'; end if;
  -- Lock order step 1: the posting row. Reporters and dismissals wait here.
  select * into v_row from public.postings where id = p_posting_id for update;
  if not found then raise exception 'posting not found' using errcode = 'CB404'; end if;
  -- A supplied report must exist and belong to THIS posting. Checked before any
  -- change (and before the already_hidden early return), so a wrong report id
  -- never alters either posting or any report.
  if p_report_id is not null then
    select posting_id into v_report_posting from public.posting_reports where id = p_report_id;
    if not found then raise exception 'report not found' using errcode = 'CB404'; end if;
    if v_report_posting <> p_posting_id then raise exception 'report belongs to another posting' using errcode = 'CB400'; end if;
  end if;
  if v_row.deleted_at is not null then raise exception 'deleted by its author' using errcode = 'CB409'; end if;
  if v_row.moderation_hidden_at is not null then return 'already_hidden'; end if;
  update public.postings set moderation_hidden_at = now() where id = p_posting_id;
  update public.posting_reports
     set status = 'actioned', resolved_at = now(), resolved_by = v_admin, resolution_note = v_reason
   where posting_id = p_posting_id and status = 'pending';
  insert into public.moderation_log (action, posting_id, report_id, admin_id, admin_username, reason)
  values ('hide_posting', p_posting_id, p_report_id, v_admin, (select username from public.profiles where id = v_admin), v_reason);
  return 'hidden';
end;
$$;

-- Restoring clears ONLY the moderation state: an author-deleted posting stays
-- deleted, and an ended posting stays ended (deleted_at and expiry untouched).
create or replace function public.admin_restore_posting(p_posting_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_admin uuid := public.cb_require_admin(); v_row public.postings%rowtype; v_reason text := btrim(p_reason);
begin
  if not public.cb_has_text(p_reason) or char_length(v_reason) > 500 then raise exception 'reason required (1-500 characters)' using errcode = 'CB422'; end if;
  select * into v_row from public.postings where id = p_posting_id for update;
  if not found then raise exception 'posting not found' using errcode = 'CB404'; end if;
  if v_row.moderation_hidden_at is null then return 'not_hidden'; end if;
  update public.postings set moderation_hidden_at = null where id = p_posting_id;
  insert into public.moderation_log (action, posting_id, admin_id, admin_username, reason)
  values ('restore_posting', p_posting_id, v_admin, (select username from public.profiles where id = v_admin), v_reason);
  return 'restored';
end;
$$;

create or replace function public.admin_dismiss_report(p_report_id uuid, p_note text default null)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_admin uuid := public.cb_require_admin(); v_note text := case when public.cb_has_text(p_note) then btrim(p_note) else null end; v_posting uuid;
begin
  if v_note is not null and char_length(v_note) > 500 then raise exception 'note too long' using errcode = 'CB422'; end if;
  -- Lock order step 1 (same as hide and report): the posting row, BEFORE the
  -- report row. Without this, dismiss (report row, then the log's foreign key
  -- on the posting) and hide (posting row, then the report rows) could wait on
  -- each other and deadlock.
  select posting_id into v_posting from public.posting_reports where id = p_report_id;
  if found then perform 1 from public.postings where id = v_posting for share; end if;
  update public.posting_reports
     set status = 'dismissed', resolved_at = now(), resolved_by = v_admin, resolution_note = v_note
   where id = p_report_id and status = 'pending'
  returning posting_id into v_posting;
  if not found then
    if exists (select 1 from public.posting_reports where id = p_report_id) then return 'not_pending'; end if;
    raise exception 'report not found' using errcode = 'CB404';
  end if;
  insert into public.moderation_log (action, posting_id, report_id, admin_id, admin_username, reason)
  values ('dismiss_report', v_posting, p_report_id, v_admin, (select username from public.profiles where id = v_admin), v_note);
  return 'dismissed';
end;
$$;

-- 11. Admin reads. Usernames only (never emails). Never touch messages.
create or replace function public.cb_posting_state(p public.postings)
returns text
language sql
stable
set search_path = pg_catalog, public
as $$
  select case
    when p.deleted_at is not null then 'deleted_by_author'
    when p.moderation_hidden_at is not null then 'hidden'
    when now() >= public.posting_takedown_at(p.expires_at, p.event_date, p.end_date, p.end_time, p.time_zone) then 'ended'
    else 'active'
  end
$$;
revoke all on function public.cb_posting_state(public.postings) from public;

create or replace function public.admin_report_queue(
  p_status text default 'pending', p_reason public.report_reason default null,
  p_limit integer default 50, p_offset integer default 0)
returns table (
  report_id uuid, reason public.report_reason, details text, status public.report_status,
  created_at timestamptz, resolved_at timestamptz, resolution_note text, resolved_by_username text,
  reporter_username text, posting_id uuid, posting_title text, posting_author_username text,
  posting_state text, posting_pending_reports integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.cb_require_admin();
  if p_status not in ('pending', 'resolved', 'all') then raise exception 'status must be pending, resolved or all' using errcode = 'CB422'; end if;
  return query
  select r.id, r.reason, r.details, r.status, r.created_at, r.resolved_at, r.resolution_note,
         rb.username, rp.username, p.id, p.title, ap.username,
         public.cb_posting_state(p),
         (select count(*)::int from public.posting_reports r2 where r2.posting_id = p.id and r2.status = 'pending')
    from public.posting_reports r
    join public.postings p on p.id = r.posting_id
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles ap on ap.id = p.author_id
    left join public.profiles rb on rb.id = r.resolved_by
   where (p_status = 'all' or (p_status = 'pending') = (r.status = 'pending'))
     and (p_reason is null or r.reason = p_reason)
   order by r.created_at desc, r.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_posting_detail(p_posting_id uuid)
returns table (
  id uuid, title text, body text, category_slug text, place_label text, event_date date, event_time text,
  end_date date, end_time time, created_at timestamptz, expires_at timestamptz, author_username text,
  state text, hidden_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.cb_require_admin();
  return query
  select p.id, p.title, p.body, c.slug, p.place_label, p.event_date, p.event_time, p.end_date, p.end_time,
         p.created_at, p.expires_at, a.username, public.cb_posting_state(p), p.moderation_hidden_at
    from public.postings p
    left join public.categories c on c.id = p.category_id
    left join public.profiles a on a.id = p.author_id
   where p.id = p_posting_id;
end;
$$;

create or replace function public.admin_moderation_log(p_posting_id uuid default null, p_limit integer default 100)
returns table (id bigint, action public.moderation_action_kind, posting_id uuid, posting_title text,
               report_id uuid, admin_username text, reason text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.cb_require_admin();
  return query
  select l.id, l.action, l.posting_id, p.title, l.report_id, l.admin_username, l.reason, l.created_at
    from public.moderation_log l
    left join public.postings p on p.id = l.posting_id
   where p_posting_id is null or l.posting_id = p_posting_id
   order by l.created_at desc, l.id desc
   limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;



-- 12. Public replies.
alter table public.replies add column if not exists client_id uuid;
do $$ begin
  alter table public.replies
    add constraint replies_body_valid check (
      char_length(body) between 1 and 1000
      and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]');
exception when duplicate_object then null; end $$;
create unique index if not exists replies_client_dedupe on public.replies (posting_id, author_id, client_id);
create index if not exists replies_posting_created_idx on public.replies (posting_id, created_at, id);
create index if not exists replies_author_recent_idx on public.replies (author_id, created_at desc);

alter table public.replies enable row level security;
revoke insert, update, delete on public.replies from anon, authenticated;
-- Replies are created ONLY by submit_reply(): no client role, and not the
-- server's service key, may insert directly (that would skip the rate limit
-- and the ledger). service_role keeps its other privileges.
revoke insert on public.replies from service_role;
grant select on public.replies to anon, authenticated;
grant delete on public.replies to authenticated;

-- Durable rate-limit accounting. One row per accepted submission, written only
-- by submit_reply(). It has NO foreign key to replies or postings, so deleting
-- a reply (or its posting) never removes the row and never returns allowance.
-- It cascades only with the account (profiles). Rows older than 24 hours are
-- never read and may be purged by the owner at any time.
create table if not exists public.reply_submissions (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  posting_id  uuid not null,
  client_id   uuid not null,
  reply_id    uuid not null,
  created_at  timestamptz not null default now(),
  constraint reply_submissions_once unique (user_id, posting_id, client_id)
);
create index if not exists reply_submissions_recent_idx on public.reply_submissions (user_id, created_at desc);
alter table public.reply_submissions enable row level security;
revoke all on public.reply_submissions from anon, authenticated, service_role;

drop policy if exists "replies public read" on public.replies;
drop policy if exists "replies read on visible postings" on public.replies;
-- The subquery reads postings through ITS policy, so replies on deleted or
-- moderated postings are not readable. Ended postings keep their replies.
create policy "replies read on visible postings" on public.replies
  for select
  using (exists (select 1 from public.postings p where p.id = posting_id));

-- No INSERT policy exists on purpose: with RLS on, no client role can insert.
drop policy if exists "replies author insert" on public.replies;
drop policy if exists "replies author insert on active postings" on public.replies;

-- Submit a reply. Returns the reply id.
--  * Idempotent: the same (caller, posting, client_id) returns the original
--    reply id. A retry creates nothing and is not counted again, even if the
--    caller is at the limit, and even if the reply was deleted since (it is not
--    recreated). The body of a retry is ignored.
--  * Rate limit: 10 accepted submissions per caller per 10 minutes, counted in
--    reply_submissions under a per-user advisory lock held to the end of the
--    transaction, so concurrent requests are serialized and counted exactly.
--    Deleting replies does not change the count.
--  * Needs READ COMMITTED (PostgREST's default): the count must see the commit
--    of the request that held the lock before us.
-- Errors: 42501 signed out, CB400 missing client_id, CB422 blank body,
-- CB413 over 1000 characters, CB404 posting not available (deleted, hidden or
-- unknown), CB409 posting has ended, CB429 rate limited.
create or replace function public.submit_reply(p_posting_id uuid, p_body text, p_client_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_uid uuid := auth.uid();
  v_body text := btrim(p_body);
  v_id uuid;
begin
  if v_uid is null then raise exception 'sign in to reply' using errcode = '42501'; end if;
  if p_client_id is null or p_posting_id is null then raise exception 'posting and client id required' using errcode = 'CB400'; end if;
  if not public.cb_has_text(p_body) then raise exception 'reply is empty' using errcode = 'CB422'; end if;
  if char_length(v_body) > 1000 then raise exception 'reply too long' using errcode = 'CB413'; end if;

  perform pg_advisory_xact_lock(hashtextextended('cb_reply:' || v_uid::text, 0));

  select reply_id into v_id from public.reply_submissions
   where user_id = v_uid and posting_id = p_posting_id and client_id = p_client_id;
  if found then return v_id; end if;

  if not exists (select 1 from public.postings
                  where id = p_posting_id and deleted_at is null and moderation_hidden_at is null) then
    raise exception 'posting not available' using errcode = 'CB404';
  end if;
  if not public.posting_is_active(p_posting_id) then raise exception 'posting has ended' using errcode = 'CB409'; end if;

  if (select count(*) from public.reply_submissions
       where user_id = v_uid and created_at > now() - interval '10 minutes') >= 10 then
    raise exception 'rate limited' using errcode = 'CB429';
  end if;

  insert into public.replies (posting_id, author_id, body, client_id)
  values (p_posting_id, v_uid, v_body, p_client_id)
  returning id into v_id;
  insert into public.reply_submissions (user_id, posting_id, client_id, reply_id)
  values (v_uid, p_posting_id, p_client_id, v_id);
  return v_id;
end;
$$;

drop policy if exists "replies author delete" on public.replies;
create policy "replies author delete" on public.replies
  for delete to authenticated
  using (auth.uid() = author_id);

-- 13. Exact EXECUTE grants for every stage 8 function. Supabase's default
-- privileges grant EXECUTE on new functions to anon, authenticated and
-- service_role explicitly, so "revoke ... from public" is not enough.
do $$
declare f text;
begin
  -- Revoke from everyone first.
  foreach f in array array[
    'public.is_admin()', 'public.cb_require_admin()', 'public.cb_has_text(text)',
    'public.submit_posting_report(uuid, public.report_reason, text)', 'public.delete_own_posting(uuid)',
    'public.set_posting_promoted(uuid, boolean)', 'public.my_hidden_posting_notice(uuid)',
    'public.admin_hide_posting(uuid, text, uuid)', 'public.admin_restore_posting(uuid, text)',
    'public.admin_dismiss_report(uuid, text)', 'public.admin_report_queue(text, public.report_reason, integer, integer)',
    'public.admin_posting_detail(uuid)', 'public.admin_moderation_log(uuid, integer)',
    'public.cb_posting_state(public.postings)', 'public.submit_reply(uuid, text, uuid)',
    'public.cb_moderation_log_append_only()', 'public.cb_postings_publish_defaults()'] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f);
  end loop;
  -- Signed-in callers. Each admin_* function checks is_admin itself.
  foreach f in array array[
    'public.is_admin()', 'public.submit_posting_report(uuid, public.report_reason, text)', 'public.delete_own_posting(uuid)',
    'public.set_posting_promoted(uuid, boolean)', 'public.my_hidden_posting_notice(uuid)',
    'public.admin_hide_posting(uuid, text, uuid)', 'public.admin_restore_posting(uuid, text)',
    'public.admin_dismiss_report(uuid, text)', 'public.admin_report_queue(text, public.report_reason, integer, integer)',
    'public.admin_posting_detail(uuid)', 'public.admin_moderation_log(uuid, integer)',
    'public.submit_reply(uuid, text, uuid)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
  -- Pure text check; harmless for anyone.
  execute 'grant execute on function public.cb_has_text(text) to anon, authenticated';
  -- cb_require_admin, cb_posting_state and the trigger functions stay owner-only.
end $$;

commit;
