-- CorkBack Stage 2 — radius email alerts.
-- Additive, idempotent migration. Apply AFTER schema.sql in the Supabase SQL
-- editor. Extends the existing `alerts` table and adds a dedupe table.
-- Does NOT touch auth, profiles, map, scan, or posting tables.

-- ---------------------------------------------------------------------------
-- Extend `alerts` for the "whole town" option and an optional town-name label.
-- The day-one table already has: id, user_id, category_id (null = all),
-- center_lat, center_lng, radius_miles (1-25), created_at.
--
-- Spec: an alert has one category, one home point (town name OR map point), and
-- one radius (1-25 miles OR a whole town). We model "whole town" as
-- radius_miles IS NULL. We keep a center point always (a town resolves to a
-- center), and store the town label when the user picked a town.
-- ---------------------------------------------------------------------------
alter table public.alerts add column if not exists town_name text;

-- Relax the radius constraint: allow NULL (= whole town) OR 1..25 miles.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.alerts'::regclass and conname = 'alerts_radius_miles_check'
  ) then
    alter table public.alerts drop constraint alerts_radius_miles_check;
  end if;
end $$;

alter table public.alerts alter column radius_miles drop not null;

alter table public.alerts
  add constraint alerts_radius_range
  check (radius_miles is null or (radius_miles >= 1 and radius_miles <= 25));

-- ---------------------------------------------------------------------------
-- sent_alerts — dedupe ledger. One row per (posting, alert) pair ensures each
-- pair is emailed at most once, even if the sweep runs again.
-- ---------------------------------------------------------------------------
create table if not exists public.sent_alerts (
  alert_id    uuid not null references public.alerts(id) on delete cascade,
  posting_id  uuid not null references public.postings(id) on delete cascade,
  sent_at     timestamptz not null default now(),
  primary key (alert_id, posting_id)
);

alter table public.sent_alerts enable row level security;

-- Only the owner of the alert can read their own sent ledger. Writes happen via
-- the service role (the sweep), which bypasses RLS; no client insert policy.
create policy "sent_alerts owner read" on public.sent_alerts
  for select using (
    exists (
      select 1 from public.alerts a
      where a.id = sent_alerts.alert_id and a.user_id = auth.uid()
    )
  );
