-- CorkBack - Stage 6 part 1 - ROLLBACK
--
-- WARNING: THIS RESTORES THE PREVIOUS PUBLIC-READ BEHAVIOR AND THE PREVIOUS
-- CONNECTIONS WRITE GAPS.
--   After running it:
--   - anyone with the public anon key can again read every user's likes and
--     plans (who liked what, who is going where);
--   - likes and plans can again be written on ended postings;
--   - any signed-in user can again insert an 'accepted' connection with anyone,
--     and a requester can again accept their own request or re-point a row.
--
-- Do not run this as part of a normal deployment, and never run it automatically.
-- Run it only by hand, only if part 1 must be backed out, and only after
-- deciding that these regressions are acceptable while it is in place.
--
-- What it restores: the day-one likes, plans, and connections policies from
-- supabase/schema.sql.
-- What it keeps: the postings columns (time_zone, end_date, end_time), the
-- end-date check, the four functions, and their grants. The Stage 6 app code
-- reads those columns and calls posting_reaction_counts; dropping them would
-- break posting pages.

begin;

drop policy if exists "likes owner read"         on public.likes;
drop policy if exists "likes self insert active" on public.likes;
drop policy if exists "likes self delete active" on public.likes;
drop policy if exists "likes public read"        on public.likes;
drop policy if exists "likes self write"         on public.likes;
drop policy if exists "likes self delete"        on public.likes;

create policy "likes public read" on public.likes for select using (true);
create policy "likes self write"  on public.likes for insert with check (auth.uid() = user_id);
create policy "likes self delete" on public.likes for delete using (auth.uid() = user_id);

drop policy if exists "plans owner read"         on public.plans;
drop policy if exists "plans self insert active" on public.plans;
drop policy if exists "plans self update active" on public.plans;
drop policy if exists "plans self delete active" on public.plans;
drop policy if exists "plans public read"        on public.plans;
drop policy if exists "plans self write"         on public.plans;
drop policy if exists "plans self update"        on public.plans;
drop policy if exists "plans self delete"        on public.plans;

create policy "plans public read" on public.plans for select using (true);
create policy "plans self write"  on public.plans for insert with check (auth.uid() = user_id);
create policy "plans self update" on public.plans for update using (auth.uid() = user_id);
create policy "plans self delete" on public.plans for delete using (auth.uid() = user_id);

drop policy if exists "connections requester insert" on public.connections;
drop policy if exists "connections party update"     on public.connections;

create policy "connections requester insert" on public.connections
  for insert with check (auth.uid() = requester_id);
create policy "connections party update" on public.connections
  for update using (auth.uid() = requester_id or auth.uid() = addressee_id);

commit;
