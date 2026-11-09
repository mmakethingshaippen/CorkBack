-- CorkBack - Stage 6 part 4 - ROLLBACK
--
-- WARNING: RESTORES THE EARLIER, LOOSER MESSAGING RULES.
--   After running it, a signed-in user can again create threads with any user
--   and no posting (including duplicates), insert backdated or whitespace-only
--   messages, and edit/delete privileges return to the table defaults (there
--   are still no update/delete policies, so RLS keeps blocking those).
-- Run only by hand, only if part 4 must be backed out. Never run it automatically.
--
-- KEPT ON PURPOSE (additive; the Stage 4 app depends on them):
--   - messages.client_id column
--   - messages_client_dedupe unique index on (thread_id, sender_id, client_id)
--   The Stage 4 send uses ON CONFLICT (thread_id, sender_id, client_id), which
--   needs that unique index. Keeping both lets the Stage 4 app keep working,
--   and keeps retry/double-submit dedupe, after this rollback. Removing them is
--   only safe after the app is reverted to a pre-Stage-4 build; that is a
--   separate, deliberate step and is not part of this file.
-- Also kept: every existing thread and message (no rows are changed).

begin;

drop policy if exists "threads start with posting author" on public.message_threads;
drop policy if exists "threads participant insert"        on public.message_threads;
create policy "threads participant insert" on public.message_threads
  for insert with check (auth.uid() = user_lo or auth.uid() = user_hi);

revoke insert (thread_id, sender_id, body, client_id) on public.messages from authenticated;
revoke insert (posting_id, user_lo, user_hi) on public.message_threads from authenticated;
grant insert, update, delete on public.messages to anon, authenticated;
grant insert, update, delete on public.message_threads to anon, authenticated;

alter table public.messages drop constraint if exists messages_body_valid;

-- Intentionally NOT dropped: public.messages.client_id, public.messages_client_dedupe.

commit;
