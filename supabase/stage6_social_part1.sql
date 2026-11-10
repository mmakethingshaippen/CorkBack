-- CorkBack - Stage 6 (social) - PART 1 of 4 - likes, plans, posting lifecycle
--
-- Run order (Supabase SQL editor, project used by production):
--   1. supabase/stage6_social_part1_preflight.sql      read-only, BEFORE; save the output
--   2. this file                                        the migration
--   3. supabase/stage6_social_part1_verify_admin.sql   read-only, AFTER; all pass = true
--   4. supabase/stage6_social_part1_verify_roles.sql   AFTER; all pass = true
--
-- What this file changes:
--   - postings: adds three nullable columns: time_zone, end_date, end_time,
--     plus a check that end_date is not before event_date. No row is updated.
--   - adds functions:
--       cb_safe_time_zone(text)          stored zone if valid, else 'Etc/GMT+12'
--       posting_takedown_at(...)         same rule as src/lib/lifecycle.ts
--       posting_is_active(uuid)          used by the likes/plans write policies
--       posting_reaction_counts(uuid[])  public aggregate counts only (no user ids)
--   - likes: read becomes owner-only; insert/delete require an active posting.
--   - plans: read becomes owner-only; insert/update/delete require an active posting.
--   - connections (interim, until part 3): client writes are closed.
--       Removed: "connections requester insert" (did not force status = pending,
--       so a user could create an accepted connection with anyone) and
--       "connections party update" (let the requester accept their own request,
--       and let either party re-point the row at a third user).
--       Kept: "connections party read". No code writes connections today
--       (0 rows); part 3 adds the reviewed request/accept/remove policies.
--
-- What this file does NOT change:
--   - follows, messages, message_threads, replies, profiles, postings policies.
--   - Friends' plan visibility (part 3).
--   - Any existing row, including reference posting ffe92f35.
--
-- Time zone rule, identical in the app and the database: only the stored
-- postings.time_zone is used. NULL, malformed, or unknown -> 'Etc/GMT+12'
-- (UTC-12, the last zone where any day ends, so nothing ends early). Postings
-- that exist before this migration have NULL and use the fallback until a
-- separately reviewed backfill sets time_zone.
--
-- Prerequisites (already applied in production): schema.sql, stage2_alerts.sql,
-- stage3_messaging.sql, stage5_categories.sql, stage5_profile_trigger.sql.
-- likes and plans have primary key (posting_id, user_id): the preflight confirms it.
--
-- Safe to re-run. One transaction: any error leaves nothing applied.

begin;

-- 1. postings: optional explicit end and the posting's IANA time zone

alter table public.postings add column if not exists time_zone text;
alter table public.postings add column if not exists end_date  date;
alter table public.postings add column if not exists end_time  time;

do $$
begin
  alter table public.postings
    add constraint postings_end_not_before_start
    check (end_date is null or event_date is null or end_date >= event_date);
exception when duplicate_object then null;
end $$;

-- 2. Lifecycle functions

-- Stored zone if it matches the zone-name pattern (same regex as the app's
-- ZONE_NAME_RE) and Postgres accepts it; otherwise 'Etc/GMT+12'.
create or replace function public.cb_safe_time_zone(p_tz text)
returns text
language plpgsql
stable
set search_path = pg_catalog
as $$
begin
  if p_tz is null or p_tz !~ '^[A-Za-z][A-Za-z0-9_+-]*(/[A-Za-z0-9_+-]+)*$' then
    return 'Etc/GMT+12';
  end if;
  perform now() at time zone p_tz;
  return p_tz;
exception when others then
  return 'Etc/GMT+12';
end;
$$;

-- Earlier of expiry and event end. Event end = explicit end_date/end_time when
-- either is set, otherwise 23:59:59.999 on the event day, in the posting's zone.
create or replace function public.posting_takedown_at(
  p_expires_at timestamptz,
  p_event_date date,
  p_end_date   date,
  p_end_time   time,
  p_time_zone  text
)
returns timestamptz
language sql
stable
set search_path = pg_catalog, public
as $$
  select least(
    p_expires_at,
    case
      when coalesce(p_end_date, p_event_date) is null then null
      else (coalesce(p_end_date, p_event_date)
              + coalesce(p_end_time, time '23:59:59.999'))
           at time zone public.cb_safe_time_zone(p_time_zone)
    end
  )
$$;

-- Security invoker: reads postings through the existing public-read policy
-- (non-deleted rows only), so it reveals nothing a visitor cannot already see.
create or replace function public.posting_is_active(p_posting_id uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.postings p
    where p.id = p_posting_id
      and p.deleted_at is null
      and now() < public.posting_takedown_at(
            p.expires_at, p.event_date, p.end_date, p.end_time, p.time_zone)
  )
$$;

-- The RLS policies below call these as the signed-in user, and the app calls
-- cb_safe_time_zone at publish. Grant explicitly rather than relying on defaults.
grant execute on function public.cb_safe_time_zone(text) to anon, authenticated;
grant execute on function public.posting_takedown_at(timestamptz, date, date, time, text) to anon, authenticated;
grant execute on function public.posting_is_active(uuid) to anon, authenticated;

-- Aggregate counts for up to 500 non-deleted postings. SECURITY DEFINER so the
-- totals stay public while individual likes/plans rows are private. Returns
-- numbers only, never user ids.
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
$$;

revoke all on function public.posting_reaction_counts(uuid[]) from public;
grant execute on function public.posting_reaction_counts(uuid[]) to anon, authenticated;

-- 3. likes policies

alter table public.likes enable row level security;

drop policy if exists "likes public read"        on public.likes;
drop policy if exists "likes self write"         on public.likes;
drop policy if exists "likes self delete"        on public.likes;
drop policy if exists "likes owner read"         on public.likes;
drop policy if exists "likes self insert active" on public.likes;
drop policy if exists "likes self delete active" on public.likes;

create policy "likes owner read" on public.likes
  for select to authenticated
  using (auth.uid() = user_id);

create policy "likes self insert active" on public.likes
  for insert to authenticated
  with check (auth.uid() = user_id and public.posting_is_active(posting_id));

create policy "likes self delete active" on public.likes
  for delete to authenticated
  using (auth.uid() = user_id and public.posting_is_active(posting_id));

-- 4. plans policies

alter table public.plans enable row level security;

drop policy if exists "plans public read"         on public.plans;
drop policy if exists "plans self write"          on public.plans;
drop policy if exists "plans self update"         on public.plans;
drop policy if exists "plans self delete"         on public.plans;
drop policy if exists "plans owner read"          on public.plans;
drop policy if exists "plans self or friend read" on public.plans;
drop policy if exists "plans self insert active"  on public.plans;
drop policy if exists "plans self update active"  on public.plans;
drop policy if exists "plans self delete active"  on public.plans;

create policy "plans owner read" on public.plans
  for select to authenticated
  using (auth.uid() = user_id);

create policy "plans self insert active" on public.plans
  for insert to authenticated
  with check (auth.uid() = user_id and public.posting_is_active(posting_id));

create policy "plans self update active" on public.plans
  for update to authenticated
  using (auth.uid() = user_id and public.posting_is_active(posting_id))
  with check (auth.uid() = user_id and public.posting_is_active(posting_id));

create policy "plans self delete active" on public.plans
  for delete to authenticated
  using (auth.uid() = user_id and public.posting_is_active(posting_id));

-- 5. connections: interim lock on client writes (until part 3)

alter table public.connections enable row level security;

drop policy if exists "connections requester insert" on public.connections;
drop policy if exists "connections party update"     on public.connections;

-- "connections party read" is unchanged (each party sees only rows they are in).

commit;
