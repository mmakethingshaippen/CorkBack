-- CorkBack day-one schema. Apply in the Supabase SQL editor (or via `supabase db push`).
-- Design source: .kiro/specs/core-loop/design.md §2. All entities land on day one;
-- social/promotion/alert UIs ship in later stages.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ---------------------------------------------------------------------------
-- profiles  (username is the ONLY public name; email stays in auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text not null unique,
  created_at  timestamptz not null default now(),
  -- Username rule (LOCKED): 3-20 chars, letters/numbers/underscore only.
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- ---------------------------------------------------------------------------
-- categories  (text chips in code; seeded from the Figma chips)
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id     smallint generated always as identity primary key,
  slug   text not null unique,
  label  text not null
);

insert into public.categories (slug, label) values
  ('music',        'Music'),
  ('sports',       'Sports'),
  ('clubs',        'Clubs'),
  ('lost-found',   'Lost & Found'),
  ('meetup',       'Meetup'),
  ('sale',         'Sale'),
  ('classes',      'Classes'),
  ('community',    'Community')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- postings
-- Expiry preset is stored so property tests can assert expires_at = created + preset.
-- lat/lng is the PINNED location (already nudged, bounded near the poster). The
-- poster's raw device location is never stored or exposed.
-- ---------------------------------------------------------------------------
do $$ begin
  create type expiry_preset as enum ('24h', '3d', '1w', '2w', '1m');
exception when duplicate_object then null; end $$;

create table if not exists public.postings (
  id           uuid primary key default gen_random_uuid(),
  author_id    uuid not null references public.profiles(id) on delete cascade,
  title        text not null,
  body         text not null default '',
  category_id  smallint not null references public.categories(id),
  flyer_url    text,
  rsvp_url     text,                              -- at most one external link
  event_date   date,
  event_time   text,
  place_label  text not null default '',          -- nudged board/venue label (free text)
  lat          double precision not null,
  lng          double precision not null,
  expiry       expiry_preset not null,
  expires_at   timestamptz not null,
  is_promoted  boolean not null default false,    -- always false in Stage 1
  created_at   timestamptz not null default now(),
  deleted_at   timestamptz                        -- soft delete; pins vanish immediately
);

create index if not exists postings_active_idx
  on public.postings (expires_at)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- likes  (POSTINGS ONLY — locked. There is deliberately no replies/comments like table.)
-- ---------------------------------------------------------------------------
create table if not exists public.likes (
  posting_id  uuid not null references public.postings(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (posting_id, user_id)
);

-- ---------------------------------------------------------------------------
-- plans  (Going / Interested) — one row per user per posting
-- ---------------------------------------------------------------------------
do $$ begin
  create type plan_kind as enum ('going', 'interested');
exception when duplicate_object then null; end $$;

create table if not exists public.plans (
  posting_id  uuid not null references public.postings(id) on delete cascade,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        plan_kind not null,
  created_at  timestamptz not null default now(),
  primary key (posting_id, user_id)
);

-- ---------------------------------------------------------------------------
-- follows  (ONE-WAY, independent of connections)
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id  uuid not null references public.profiles(id) on delete cascade,
  followee_id  uuid not null references public.profiles(id) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

-- ---------------------------------------------------------------------------
-- connections  (TWO-WAY friend request/accept, independent of follows)
-- ---------------------------------------------------------------------------
do $$ begin
  create type connection_status as enum ('pending', 'accepted');
exception when duplicate_object then null; end $$;

create table if not exists public.connections (
  requester_id  uuid not null references public.profiles(id) on delete cascade,
  addressee_id  uuid not null references public.profiles(id) on delete cascade,
  status        connection_status not null default 'pending',
  created_at    timestamptz not null default now(),
  primary key (requester_id, addressee_id),
  constraint no_self_connect check (requester_id <> addressee_id)
);

-- ---------------------------------------------------------------------------
-- hidden_postings  (a user hides a posting from their own view)
-- ---------------------------------------------------------------------------
create table if not exists public.hidden_postings (
  user_id     uuid not null references public.profiles(id) on delete cascade,
  posting_id  uuid not null references public.postings(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (user_id, posting_id)
);

-- ---------------------------------------------------------------------------
-- replies  (PUBLIC comments on a posting — day one. No like count anywhere.)
-- ---------------------------------------------------------------------------
create table if not exists public.replies (
  id          uuid primary key default gen_random_uuid(),
  posting_id  uuid not null references public.postings(id) on delete cascade,
  author_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- alerts  (radius email alerts — table lands day one; UI ships Stage 2)
-- ---------------------------------------------------------------------------
create table if not exists public.alerts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  category_id   smallint references public.categories(id),  -- null = all categories
  center_lat    double precision not null,
  center_lng    double precision not null,
  radius_miles  numeric not null check (radius_miles >= 1 and radius_miles <= 25),
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Public read for browsing surfaces; writes are authenticated + owner-scoped.
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.postings        enable row level security;
alter table public.likes           enable row level security;
alter table public.plans           enable row level security;
alter table public.follows         enable row level security;
alter table public.connections     enable row level security;
alter table public.hidden_postings enable row level security;
alter table public.replies         enable row level security;
alter table public.alerts          enable row level security;

-- profiles: anyone may read the public username; a user writes only their own row.
create policy "profiles public read"   on public.profiles for select using (true);
create policy "profiles self insert"   on public.profiles for insert with check (auth.uid() = id);
create policy "profiles self update"   on public.profiles for update using (auth.uid() = id);

-- categories: public read; no client writes (seeded by migration).
create policy "categories public read" on public.categories for select using (true);

-- postings: public read of non-deleted rows; author owns writes.
create policy "postings public read"   on public.postings for select using (deleted_at is null);
create policy "postings author insert" on public.postings for insert with check (auth.uid() = author_id);
create policy "postings author update" on public.postings for update using (auth.uid() = author_id);

-- likes (postings only): public read of counts; user owns their like.
create policy "likes public read"      on public.likes for select using (true);
create policy "likes self write"       on public.likes for insert with check (auth.uid() = user_id);
create policy "likes self delete"      on public.likes for delete using (auth.uid() = user_id);

-- plans: public read (attendance counts); user owns their plan.
create policy "plans public read"      on public.plans for select using (true);
create policy "plans self write"       on public.plans for insert with check (auth.uid() = user_id);
create policy "plans self update"      on public.plans for update using (auth.uid() = user_id);
create policy "plans self delete"      on public.plans for delete using (auth.uid() = user_id);

-- replies: public read; author owns writes.
create policy "replies public read"    on public.replies for select using (true);
create policy "replies author insert"  on public.replies for insert with check (auth.uid() = author_id);
create policy "replies author delete"  on public.replies for delete using (auth.uid() = author_id);

-- follows: a user manages only their own follow edges.
create policy "follows self read"      on public.follows for select using (auth.uid() = follower_id or auth.uid() = followee_id);
create policy "follows self write"     on public.follows for insert with check (auth.uid() = follower_id);
create policy "follows self delete"    on public.follows for delete using (auth.uid() = follower_id);

-- connections: both parties may read; requester creates, either party updates (accept).
create policy "connections party read" on public.connections for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
create policy "connections requester insert" on public.connections for insert with check (auth.uid() = requester_id);
create policy "connections party update" on public.connections for update using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- hidden_postings: strictly private to the user.
create policy "hidden self all"        on public.hidden_postings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- alerts: strictly private to the user.
create policy "alerts self all"        on public.alerts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
