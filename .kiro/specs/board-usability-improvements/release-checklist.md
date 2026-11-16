# Release checklist: board usability improvements

Branch `feature/board-usability-improvements`. Nothing below has been run against production.
Each step waits for owner review: production SQL, the merge to `main` and the production deploy.

## 0. Before starting
- [ ] `origin/main` is still `c71951a`. The live production deployment is `dpl_ChvTDmc4xev6oJyoqjbqi5os4eaE` (built from `c71951a`) and is the code rollback target.
- [ ] Review the branch diff. The commits after `c71951a` are listed with `git log --oneline c71951a..origin/feature/board-usability-improvements`.
- [ ] Recheck the protected preview build of the final branch commit (see BUILD_LOG.md). It runs in demo mode with no database.

## 1. Code release (no SQL needed first)
The new code works without any of the new SQL. The unread badge and inbox dots stay hidden until stage 11 is applied: `/api/messages/unread` answers `{ supported: false }`.
1. [ ] Merge to `main` (fast-forward), then push once. Vercel's Git integration builds the production deployment.
2. [ ] Confirm production serves the merge commit (`vercel inspect https://corkback.vercel.app`, plus the GitHub commit status).
3. [ ] Production smoke test, signed out and signed in:
   - The board loads, the map is high on a phone, and the category filter and radius work.
   - A city search moves the centre, and cards show "About n mi away".
   - The world map shows pins and the caption.
   - A thread page updates by itself, and there is no unread badge yet.

## 2. SQL: stage 11 message reads (required for unread; apply AFTER step 1 passes)
Run in the Supabase SQL editor of project `djdmiqxzcgjdwcxqqrzk`, in this order:
1. [ ] `supabase/stage11_message_reads_preflight.sql`. Read-only; save the output.
   - Expect: `message_thread_reads` absent, `messages` and `message_threads` present, and backfill rows equal to the thread participants without a marker (2 per thread; at the 2026-11-16 baseline that was 3 threads, so 6).
2. [ ] `supabase/stage11_message_reads.sql`. One transaction. Any failed assertion rolls everything back and applies nothing.
3. [ ] `supabase/stage11_message_reads_verify_roles.sql`. Expect the last row `ALL CHECKS PASS` with `pass = true`. It rolls itself back and leaves no data.
4. [ ] In the app: the badge appears only for new messages from the other person, and clears after the thread is opened.

## 3. SQL deferred (do not run in this release)
- `supabase/stage12_postings_geo_index*.sql` is an optional performance index; the app gives identical results without it. If it is applied later, run preflight, then `stage12_postings_geo_index.sql`, then `_verify.sql`.
- `supabase/stage13_takedown_app_parity*.sql` is not needed now. The 2026-11-16 read-only inventory found 0 existing postings whose takedown would change, and 0 rows in the excluded zone set. It also makes `cb_safe_time_zone` stricter, so it gets its own review.

## 4. Live checks after release
Two signed-in test accounts on production (synthetic `[TEST]` data, cleaned up afterwards with the `scripts/avatar-e2e` cleanup pattern):
- [ ] Sign in; follow and unfollow a category from the category panel.
- [ ] Two-account thread: auto-refresh in both directions, the unread badge on the other account, and the badge clearing when the thread is opened (needs stage 11).
- [ ] Nearby radius filtering and a real geocoder search for Berkeley, and for Richmond under a Berkeley search.
- [ ] World map on real tiles with real data; CDN caching of `mode=pins` responses.
- [ ] Publish one listing in each listing category, and Community with and without a date; check the takedown lines on the form, detail and edit pages.
- [ ] Edit a listing that has a legacy event date (notice shown, nothing changes until Save).
- [ ] A listing alert email that reaches a test inbox only.

Needs a real phone:
- [ ] Background-tab pause of an open thread and resume on return.
- [ ] "Use my location" distances and the radius ring.
- [ ] Automatic location when permission was already granted; no prompt in a fresh browser.
- [ ] Touch use of the category panel, the radius control and world-map panning.

## 5. Rollback
Code and SQL roll back independently.
- **Code:** in Vercel, promote `dpl_ChvTDmc4xev6oJyoqjbqi5os4eaE` (Instant Rollback in the dashboard, or `vercel promote dpl_ChvTDmc4xev6oJyoqjbqi5os4eaE`). Then make `main` match with a revert commit (`git revert -m 1 <merge>`, or a revert of each commit for a fast-forward). Never force-push.
  - Posting rows are unaffected by code rollback: no migration touched them, and edits write only on Save.
- **Stage 11:** `supabase/stage11_message_reads_rollback.sql`. It drops only `message_thread_reads`, `cb_mark_thread_read` and `cb_unread_counts`. Messages and threads stay unchanged (verified locally).
  - The new code keeps working: unread answers `{ supported: false }` and the badge hides.
  - It discards read markers. Applying stage 11 again backfills every existing message as read.
  - Order with a code rollback: either order works, since the old code never uses these objects.
- **Stage 12 (only if applied later):** `supabase/stage12_postings_geo_index_rollback.sql` drops the index only.
- **Stage 13 (only if applied later):** `supabase/stage13_takedown_app_parity_rollback.sql` restores the stage 6 function bodies.
