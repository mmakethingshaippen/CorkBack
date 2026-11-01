-- CorkBack Stage 3 — private messaging (direct messages).
-- Additive, idempotent. Apply AFTER schema.sql in the Supabase SQL editor.
-- Does NOT touch auth, profiles, alerts, scan, map, or posting tables.
-- Public replies are unchanged. No Like on messages. No group threads,
-- attachments, or email notices.

-- ---------------------------------------------------------------------------
-- message_threads — a private 1:1 thread between exactly two users, optionally
-- anchored to the posting it was started from. Participants are stored as an
-- ordered pair (user_lo < user_hi) so a pair has at most one thread per posting
-- and the unique constraint prevents duplicates.
-- ---------------------------------------------------------------------------
create table if not exists public.message_threads (
  id          uuid primary key default gen_random_uuid(),
  posting_id  uuid references public.postings(id) on delete set null,
  user_lo     uuid not null references public.profiles(id) on delete cascade,
  user_hi     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint threads_ordered check (user_lo < user_hi),
  constraint threads_unique_pair_posting unique (posting_id, user_lo, user_hi)
);

create index if not exists message_threads_lo_idx on public.message_threads (user_lo);
create index if not exists message_threads_hi_idx on public.message_threads (user_hi);

-- ---------------------------------------------------------------------------
-- messages — one row per message in a thread.
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid not null references public.message_threads(id) on delete cascade,
  sender_id   uuid not null references public.profiles(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists messages_thread_idx on public.messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Row Level Security — PARTICIPANT-ONLY. A third user sees nothing.
-- ---------------------------------------------------------------------------
alter table public.message_threads enable row level security;
alter table public.messages        enable row level security;

-- Helper predicate inlined in each policy: the current user is one of the two
-- thread participants.

-- Threads: a participant may read their own threads.
create policy "threads participant read" on public.message_threads
  for select using (auth.uid() = user_lo or auth.uid() = user_hi);

-- Threads: a user may create a thread only if they are one of the two
-- participants (prevents creating a thread between two other people).
create policy "threads participant insert" on public.message_threads
  for insert with check (auth.uid() = user_lo or auth.uid() = user_hi);

-- Messages: a participant of the parent thread may read its messages.
create policy "messages participant read" on public.messages
  for select using (
    exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and (auth.uid() = t.user_lo or auth.uid() = t.user_hi)
    )
  );

-- Messages: a participant may send a message, and only as themselves.
create policy "messages participant insert" on public.messages
  for insert with check (
    auth.uid() = sender_id
    and exists (
      select 1 from public.message_threads t
      where t.id = messages.thread_id
        and (auth.uid() = t.user_lo or auth.uid() = t.user_hi)
    )
  );

-- No update/delete policies: messages are immutable for the contest (no edit,
-- no delete, no Like). A third user has no policy that grants any access, so
-- RLS denies them by default.
