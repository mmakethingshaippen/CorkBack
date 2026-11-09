-- CorkBack - Stage 6 part 3 - ROLLBACK (to the part 1 state)
--
-- Run only by hand, only if part 3 must be backed out. Never run it automatically.
--
-- Effect: returns to the part 1 state, which is MORE restrictive, not public:
--   - connections: client writes closed again (no insert/update/delete policy);
--     table-level INSERT/UPDATE grants restored to their defaults
--   - plans: owner-only read again (friends no longer see each other's plans)
--   - the one-per-pair index and viewer_is_friend_of() are dropped
-- Existing connection rows are KEPT (pending and accepted). The Friends page
-- would then show them but every action would fail with "not allowed".

begin;

drop policy if exists "plans self or friend read" on public.plans;
drop policy if exists "plans owner read"          on public.plans;
create policy "plans owner read" on public.plans
  for select to authenticated
  using (auth.uid() = user_id);

drop function if exists public.viewer_is_friend_of(uuid);

drop policy if exists "connections requester insert pending" on public.connections;
drop policy if exists "connections addressee accept"         on public.connections;
drop policy if exists "connections party delete"             on public.connections;

revoke insert (requester_id, addressee_id) on public.connections from authenticated;
revoke update (status) on public.connections from authenticated;
grant insert, update on public.connections to anon, authenticated;
grant delete on public.connections to anon;

drop index if exists public.connections_one_per_pair;
drop index if exists public.connections_addressee_idx;

commit;
