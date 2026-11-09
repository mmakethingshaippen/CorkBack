-- CorkBack - Stage 6 (social) - PART 3 of 4 - Friends (connections) and friends-only plans
--
-- Run order (Supabase SQL editor, project used by production):
--   1. supabase/stage6_social_part3_preflight.sql      read-only, BEFORE; save the output
--   2. this file                                        the migration
--   3. supabase/stage6_social_part3_verify_admin.sql   read-only, AFTER; all pass = true
--   4. supabase/stage6_social_part3_verify_roles.sql   AFTER; all pass = true
--
-- Prerequisite: part 1 applied and verified (it closed connections writes and
-- made plans owner-only). Part 2 had no database change.
--
-- What this file changes (connections):
--   - At most ONE row per pair of users, in either direction:
--     unique index on (least(requester_id, addressee_id), greatest(...)).
--     This blocks duplicates AND conflicting reciprocal requests (A->B and B->A).
--     The existing no_self_connect check still blocks self-requests.
--   - Participants can never be changed by a client: table-level INSERT/UPDATE
--     are replaced by column grants. Clients may insert only (requester_id,
--     addressee_id), so status always starts at its default 'pending', and may
--     update only (status).
--   - Policies (all to authenticated):
--       insert: the requester is the caller and status = 'pending'
--       update: only the RECIPIENT (addressee), only pending -> accepted
--       delete: either participant (cancel, decline, remove friend)
--     "connections party read" is unchanged.
--   - Index on addressee_id for the incoming list.
--
-- What this file changes (plans):
--   - viewer_is_friend_of(uuid): true only when the CALLER and that user have an
--     ACCEPTED connection. Security invoker: it reads connections through the
--     party-read policy, so it can never reveal other people's friendships.
--   - plans read becomes: own rows, or an accepted friend's rows on an ACTIVE
--     posting. It is evaluated on every query, so removing a friendship revokes
--     access immediately. Likes stay owner-only (unchanged).
--
-- What this file does NOT change: likes, follows, messages, message_threads,
-- replies, profiles, postings, alerts. No existing row is modified.
--
-- Compatibility:
--   - Production (4c1434f + cron hotfix) never reads or writes connections or
--     plans rows, so it is unaffected.
--   - Stage 1/2 preview builds already read friends' plans through RLS; after
--     this they start showing accepted friends' plans, as designed.
--   - Note: part 1's verify_roles check R14/R17 expected an accepted connection
--     to reveal NO plans. That is intentionally no longer true after part 3.
--
-- Safe to re-run. One transaction: any error leaves nothing applied.

begin;

-- 0. Refuse to run if existing rows would violate the new pair rule.
do $$
begin
  if exists (
    select 1
    from public.connections
    group by least(requester_id, addressee_id), greatest(requester_id, addressee_id)
    having count(*) > 1
  ) then
    raise exception 'connections has more than one row for a pair of users; resolve before part 3 (nothing was changed)';
  end if;
end $$;

-- 1. One connection per pair, either direction; incoming-list index.
create unique index if not exists connections_one_per_pair
  on public.connections (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists connections_addressee_idx on public.connections (addressee_id);

-- 2. Participants are immutable for clients (column-level privileges).
revoke insert, update on public.connections from anon, authenticated;
grant insert (requester_id, addressee_id) on public.connections to authenticated;
grant update (status) on public.connections to authenticated;
grant select, delete on public.connections to authenticated;
revoke delete on public.connections from anon;

-- 3. Policies.
alter table public.connections enable row level security;

drop policy if exists "connections requester insert"         on public.connections; -- removed by part 1
drop policy if exists "connections party update"             on public.connections; -- removed by part 1
drop policy if exists "connections requester insert pending" on public.connections;
drop policy if exists "connections addressee accept"         on public.connections;
drop policy if exists "connections party delete"             on public.connections;

create policy "connections requester insert pending" on public.connections
  for insert to authenticated
  with check (auth.uid() = requester_id and status = 'pending');

create policy "connections addressee accept" on public.connections
  for update to authenticated
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status = 'accepted');

create policy "connections party delete" on public.connections
  for delete to authenticated
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- 4. Friends-only plan visibility.
create or replace function public.viewer_is_friend_of(p_other uuid)
returns boolean
language sql
stable
set search_path = pg_catalog, public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.connections c
    where c.status = 'accepted'
      and (
        (c.requester_id = auth.uid() and c.addressee_id = p_other)
        or (c.addressee_id = auth.uid() and c.requester_id = p_other)
      )
  )
$$;

grant execute on function public.viewer_is_friend_of(uuid) to anon, authenticated;

alter table public.plans enable row level security;

drop policy if exists "plans owner read"          on public.plans;
drop policy if exists "plans self or friend read" on public.plans;

create policy "plans self or friend read" on public.plans
  for select to authenticated
  using (
    auth.uid() = user_id
    or (public.viewer_is_friend_of(user_id) and public.posting_is_active(posting_id))
  );

commit;
