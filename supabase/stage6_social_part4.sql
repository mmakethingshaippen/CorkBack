-- CorkBack - Stage 6 (social) - PART 4 of 4 - Messaging integrity
--
-- Run order (Supabase SQL editor, project used by production):
--   1. supabase/stage6_social_part4_preflight.sql      read-only, BEFORE; save the output
--   2. this file                                        the migration
--   3. supabase/stage6_social_part4_verify_admin.sql   read-only, AFTER; all pass = true
--   4. supabase/stage6_social_part4_verify_roles.sql   AFTER; all pass = true
--
-- Why (reproduced on 2026-11-08 against the live database with disposable users):
--   - a user could create several threads with ANY user and no posting (the
--     unique key includes a nullable posting_id, and NULLs never collide)
--   - a message could be inserted with a backdated created_at (ordering)
--   - a blank message could be inserted directly
--   - double submits created duplicate messages (no idempotency key)
--
-- What this file changes:
--   messages
--     - client_id uuid (nullable). The app sends one id per send attempt and
--       reuses it on retry; unique (thread_id, sender_id, client_id) makes a
--       retried or double-submitted send a no-op. A NEW id is used when the
--       person intentionally sends again. Existing rows keep NULL (NULLs never
--       collide, so they are unaffected).
--     - check: body is 1..2000 characters AND contains at least one character
--       that is not whitespace. "Whitespace" is exactly the set JavaScript's
--       trim() removes (space, tab, LF, VT, FF, CR, NBSP, BOM, U+1680,
--       U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000), written as the
--       same class as MESSAGE_WHITESPACE_CLASS in src/lib/messaging.ts. The app
--       stores trimmed text, so everything it sends passes.
--     - clients may insert only (thread_id, sender_id, body, client_id):
--       id and created_at are always server-set; no UPDATE/DELETE privileges
--       (there were never update/delete policies: messages stay immutable)
--   message_threads
--     - a thread can only be STARTED by a signed-in user, with the AUTHOR of an
--       existing, non-deleted posting, about that posting (posting_id required).
--       With posting_id always set, the existing unique (posting_id, user_lo,
--       user_hi) means exactly one conversation per pair per posting.
--     - clients may insert only (posting_id, user_lo, user_hi); no UPDATE/DELETE
--   Read policies are unchanged (participants only). The "messages participant
--   insert" policy is unchanged (participant, sending as themselves).
--
-- What this file does NOT change: existing threads or messages (none modified),
-- likes, plans, follows, connections, postings, profiles.
--
-- Compatibility: production and the earlier previews start threads only from a
-- posting page, to the posting's author, and insert (posting_id, user_lo,
-- user_hi) and (thread_id, sender_id, body). Both still work.
-- Rollback (stage6_social_part4_rollback.sql) deliberately KEEPS client_id and
-- messages_client_dedupe: the Stage 4 app's ON CONFLICT target needs that index.
-- Safe to re-run. One transaction: any error leaves nothing applied.

begin;

-- 0. Refuse to run if existing rows would violate the new rule (same predicate
--    as the check below; the preflight reports the same count).
do $$
begin
  if exists (
    select 1 from public.messages
    where not (char_length(body) between 1 and 2000
               and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')
  ) then
    raise exception 'messages has a blank, whitespace-only, or over-2000-character body; resolve before part 4 (nothing was changed)';
  end if;
end $$;

-- 1. messages: idempotency key, body check.
alter table public.messages add column if not exists client_id uuid;

create unique index if not exists messages_client_dedupe
  on public.messages (thread_id, sender_id, client_id);

do $$
begin
  alter table public.messages
    add constraint messages_body_valid check (
      char_length(body) between 1 and 2000
      and body ~ '[^ \t\n\v\f\r\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]'
    );
exception when duplicate_object then null;
end $$;

-- 2. Column privileges: server-set id/created_at; no client updates or deletes.
revoke insert, update, delete on public.messages from anon, authenticated;
grant insert (thread_id, sender_id, body, client_id) on public.messages to authenticated;
grant select on public.messages to authenticated;

revoke insert, update, delete on public.message_threads from anon, authenticated;
grant insert (posting_id, user_lo, user_hi) on public.message_threads to authenticated;
grant select on public.message_threads to authenticated;

-- 3. Threads start only from a posting, with its author.
alter table public.message_threads enable row level security;
alter table public.messages enable row level security;

drop policy if exists "threads participant insert"      on public.message_threads;
drop policy if exists "threads start with posting author" on public.message_threads;

create policy "threads start with posting author" on public.message_threads
  for insert to authenticated
  with check (
    posting_id is not null
    and (auth.uid() = user_lo or auth.uid() = user_hi)
    and exists (
      select 1
      from public.postings p
      where p.id = posting_id
        and p.deleted_at is null
        and p.author_id <> auth.uid()
        and (p.author_id = user_lo or p.author_id = user_hi)
    )
  );

commit;
