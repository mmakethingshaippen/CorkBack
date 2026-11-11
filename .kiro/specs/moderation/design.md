# Reporting, Moderation and Live Fixes — Design

## 1. Findings (inspected and reproduced 2026-11-10)

Reproduced on production with disposable accounts (A viewer, B author) and `[TEST]` postings, all removed afterwards.

| # | Finding | Cause |
|---|---|---|
| F1 | "Replies / Be the first to reply" with no composer for viewer or author (0 fields, 0 buttons). | `src/app/p/[id]/page.tsx` renders static text. No code reads or writes `replies` anywhere in `src`. The table exists (schema.sql, day one), but its policies are looser than intended: public read of every reply (including on deleted postings), insert checks only the author, and there is no body rule or active-posting check. |
| F2 | No Edit/Delete on the author's posting page or profile, though the review form says "You can delete a posting at any time." | There is no edit or delete route or control. The only owner control is `PromoteToggle`. |
| F3 | Selected Like reads "Like this posting. 1 like" (pressed=true). | `PostingActions` hard-codes the `aria-label` prefix. |
| F4 | **Security:** through the database API an author moved a disposable posting's pin to London, set expiry to 2099 and set promotion. | `"postings author update" using (auth.uid() = author_id)` with table-wide UPDATE and no WITH CHECK, plus table-wide INSERT. It breaks the location rule and expiry, and would let an author clear any moderation flag stored on `postings`. |

Related observations:
- Every user-facing posting read goes through the session client, so RLS on `postings` is the single place to enforce visibility. `posting_is_active()` (security invoker), the message-thread insert policy, and the new replies policy all read `postings` through that policy, so they inherit the rule.
- Service-role reads bypass RLS. **The alerts cron** would email hidden postings unless it filters explicitly. The expiry cron only counts; the sign-up route reads profiles.
- There is no posting search. Town search only geocodes and user search returns usernames.
- `hidden_postings` (a personal hide list) is unrelated and left untouched.
- **Supabase default privileges** grant EXECUTE on new functions, and ALL on new tables, to `anon`, `authenticated` and `service_role` explicitly. So `revoke ... from public` is not enough, and every stage 8 object needs explicit revokes. The isolated run caught this; see §11.

## 2. Enforcement layers
1. **Database (authoritative).** RLS, column privileges, `SECURITY DEFINER` functions with pinned `search_path` that check the caller, triggers, CHECK constraints and partial unique indexes. Admin power exists only inside functions that call `cb_require_admin()`.
2. **Server routes.** Validate input, map errors to readable messages, and check `is_admin()` before rendering `/admin` (not-found for everyone else).
3. **UI.** Shows controls only to the right people. It is never relied on for authorization.

No service-role key is used in any new feature code.

## 3. Data model and privileges (`supabase/stage8_moderation.sql`, phase A)

### Posting columns: who may set them

| Column | INSERT (publish) | UPDATE (author) |
|---|---|---|
| `title, body, category_id, rsvp_url, event_date, event_time, end_date, end_time, place_label` | client | client (own active, visible posting) |
| `author_id` | client, but RLS forces `= auth.uid()` | — |
| `lat, lng` | client (the real location is client-supplied in any design; the publish route bounds the pin) | — |
| `time_zone` | client (the route stores only a zone the DB accepts) | — |
| `expiry` (preset) | client | — |
| `expires_at` | the column is granted (the deployed code sends it), but the **trigger overwrites it** with `now() + preset` | — |
| `created_at` | trigger sets `now()` | — |
| `id, is_promoted, deleted_at, moderation_hidden_at, flyer_url` | — (server-side) | — |
| `is_promoted` | — | phase A: client (deployed toggle). **Phase B: only `set_posting_promoted()`** |
| `deleted_at` | — | only `delete_own_posting()` |
| `moderation_hidden_at` | — | only `admin_hide_posting()` / `admin_restore_posting()` |

The preset table in the trigger matches `src/lib/domain.ts`: 24h, 3d, 7d, 14d, and 1m = 30 days. A CHECK bounds `expires_at <= created_at + 32 days`.

Likes, plans, follows and connections are unchanged by stage 8. Their `created_at` remains client-settable on the user's own rows; it is not shown publicly or used for ordering of other people's data. Noted for a later pass.

### New objects

| Object | Purpose | anon / authenticated / service_role |
|---|---|---|
| `admins(user_id, granted_at, granted_note)` | Who is an admin. | none / none / **none** (no API key can grant admin) |
| `posting_reports` | Reason, details ≤ 1000, status, resolution; one pending per (posting, reporter). | none / select of own `id, posting_id, reason, status, created_at` / none |
| `moderation_log` | Action, posting, report, admin id + username snapshot, reason, time. Reason required for hide/restore. | none / none / none |
| `replies.client_id` + body rule + dedupe index | Public replies with idempotent sends. Written only through `submit_reply()`. | select (visible postings) / select, delete own (**no insert for any client role, service_role included**) / unchanged |
| `reply_submissions` | Durable rate-limit ledger: one row per accepted reply, no foreign key to replies or postings, so deleting a reply never returns allowance. Unique per (user, posting, client_id) for idempotent retries. | none / none / none |

**Audit log protection (exact):**
- `anon`, `authenticated` and `service_role` have no privileges at all on `moderation_log`.
- Admins write it only through the admin functions.
- The owner (`postgres`): row triggers refuse DELETE and any UPDATE of `id`, `action`, `admin_username`, `reason` or `created_at`; a reference (`posting_id`, `report_id`, `admin_id`) may only go from a value to null **and only when the row it pointed to no longer exists** (what ON DELETE SET NULL does). Manually nulling a reference whose target still exists, or re-pointing it, is refused. A statement trigger refuses TRUNCATE.
- **The owner can deliberately bypass this with DDL** (ALTER TABLE … DISABLE TRIGGER, DROP TRIGGER, DROP TABLE) or `session_replication_role = replica`. Hard-deleting a posting, report or profile also detaches the audit rows that pointed at it (by design of the foreign keys; the row, username and reason stay). Supabase's superuser can do anything. That is the maintenance path: an explicit, reviewed SQL-editor step. It protects against application roles and accidental edits, not against the database owner.

**Functions:**
- **Reporting:** `submit_posting_report` returns `created` or `already_reported`. It errors with 42501, CB404, CB400, CB413 and CB429.
- **Owner:** `delete_own_posting`, `set_posting_promoted` (author, visible, promote only while active; CB404/CB409), `my_hidden_posting_notice`.
- **Admin actions:** `admin_hide_posting`, `admin_restore_posting`, `admin_dismiss_report`.
- **Admin reads:** `admin_report_queue`, `admin_posting_detail`, `admin_moderation_log`. They return usernames only and never read messages.
- **Internal:** `cb_require_admin`, `cb_posting_state`, `cb_has_text`, and the trigger functions.
- **Replies:** `submit_reply(posting, body, client_id)` returns the reply id. It validates the body, requires an active visible posting, answers a retry of the same `(caller, posting, client_id)` with the original id (nothing created, nothing counted, even at the limit or after deletion), and enforces 10 per 10 minutes against `reply_submissions` under a per-user advisory lock. Errors: 42501, CB400, CB422, CB413, CB404, CB409, CB429. (This replaces the earlier `cb_reply_rate_ok()` policy helper, which counted live replies without serializing and gave the allowance back when replies were deleted.)
- **Aggregate counts:** `posting_reaction_counts` (Stage 1, SECURITY DEFINER) is replaced so hidden and deleted postings return no row to anyone.
- **Lock order** (all multi-lock functions): (1) the postings row (`FOR UPDATE` for hide/restore/promote, `FOR SHARE` for report and dismiss, the UPDATE in `delete_own_posting`), (2) the caller's advisory lock, (3) report/ledger rows. A report cannot be added after its posting is hidden or deleted; `admin_hide_posting` rejects a `report_id` that belongs to another posting (CB400) or does not exist (CB404) before changing anything.

**Execute grants are exact:** revoked from public, anon, authenticated and service_role, then granted to `authenticated` only where intended. `cb_has_text` is also granted to anon. The internal helpers and trigger functions stay owner-only, and `service_role` can't run any admin function.

**Policies:**
- **postings read:** `deleted_at is null and moderation_hidden_at is null`, for everyone, including the author and admins on the table itself.
- **postings insert:** author only, nothing pre-deleted or pre-hidden.
- **postings edit:** the author, on an active, visible posting.
- **replies read:** `exists(visible posting)`.
- **replies insert:** no policy and no privilege; only `submit_reply()`.
- **replies delete:** own replies only.

## 4. Visibility rule, surface by surface

| Surface | How hidden/deleted postings are excluded |
|---|---|
| Home map + rail, world map, profiles (including your own), Following | Reads through RLS. |
| Friends activity | Plans with a posting embed. The embed is null for hidden postings and the row is dropped (to be checked in code; a test covers it). |
| Direct link `/p/[id]` | `getPosting` returns null, so the segment's `not-found.tsx` shows a neutral notice (HTTP 404). If the viewer is the author and `my_hidden_posting_notice` returns a row: "Hidden by CorkBack moderators", the reason, and a Delete control. |
| Likes, plans, replies writes | `posting_is_active()` is false through RLS. |
| New message threads | The insert policy's posting subquery is under RLS. Existing threads stay private to participants. |
| Alerts emails | **Code change:** the cron adds `.is("moderation_hidden_at", null)`. |
| Reports | `submit_posting_report` requires a visible posting. |

## 5. Reporting
- **UI.** "Report posting" (outline button; one dark-red main action per screen) opens an inline panel: six reason radios, optional details (≤ 1000, live counter), Submit and Cancel. States:
  - submitting
  - success: "Thanks, your report was sent to CorkBack moderators. The poster won't see who reported it."
  - already reported
  - rate limited
  - failure, with details kept
  - signed out: "Sign in to report"
  - hidden for the author
  
  It shows "You reported this" when a pending report exists. Re-reporting is allowed after the earlier report is resolved.
- **API.** `POST /api/postings/[id]/report {reason, details}` calls `submit_posting_report`, mapped to 200/400/401/404/413/429. A ref lock in the component prevents double submits; the database makes concurrent ones idempotent.

## 6. Admin dashboard (`/admin`)
- **Gate.** The server page calls `is_admin`, and `notFound()` otherwise.
- **Queue.** Pending · Resolved · All tabs, reason filter, 50 per page.
- **Report cards:**
  - Reason, date, reporter @username and details.
  - Posting title linking to a context panel (body, place, dates, author, state badge, history).
  - Pending count for the same posting.
- **Actions:**
  - **Dismiss:** optional note.
  - **Hide:** required reason, then a confirm step whose button is the dark-red main action.
  - **Restore:** required reason.
  
  Each is idempotent (`already_hidden`, `not_hidden`, `not_pending`). A "Recent actions" list shows the log; `[TEST]` entries from verification appear labelled.
- **API.** `GET /api/admin/reports`, `GET /api/admin/postings/[id]` and `POST /api/admin/actions` check `is_admin` and return 404 otherwise; the functions check again.
- **Discoverability.** An "Admin" link on the admin's own profile only. It's cosmetic.
- **Keyboard.** Native controls, confirm steps move focus and Escape cancels, navy focus rings. Stacked at 390 px, two-column at 1280 px.

## 7. Replies
- **Server read:** oldest first, limit 200, through RLS, author @username.
- **Composer:** the Stage 4 composer pattern (ref lock, idempotency key per draft, sessionStorage draft, clear after save, all states).
- **`POST /api/postings/[id]/replies`:** `rpc("submit_reply", {p_posting_id, p_body, p_client_id})`. No client role can insert into `replies` directly, so the rate limit cannot be bypassed. A retry of the same `clientId` returns the original reply id (nothing created or counted again); the route then reads the reply back under RLS.
- **`DELETE /api/replies/[id]`:** confirmed in the UI.
- No likes on replies (locked). Plain text, `whitespace-pre-wrap` and `break-words`.

## 8. Owner edit, promotion and delete
- **Controls.** The author sees "Edit" (navy link) and "Delete posting" (neutral) in the "Posted by" card, and "Edit · Delete" on their own profile cards.
- **`/p/[id]/edit`.** Server-checks the author and an active, visible posting. Same fields and validation as publishing (`validatePostingEdit` shares rules with `validatePostingInput`). Pin, expiry and flyer are shown read-only. Saving goes through `PATCH /api/postings/[id]`, under RLS and column privileges.
- **Promotion.** `PromoteToggle` moves from `POST /api/postings/promote` (direct update) to `rpc("set_posting_promoted")`. The route keeps its URL and readable errors.
- **Delete.** An inline confirm: "Delete this posting? It comes off the map and your profile now. This can't be undone." It calls `DELETE /api/postings/[id]`, which runs `delete_own_posting`, then redirects to the profile with a status message.

## 9. Like accessible name (approved)
- Unselected: `aria-label="Like this posting. N likes"`, `aria-pressed="false"`.
- Selected: `aria-label="Unlike this posting. N likes"`, `aria-pressed="true"`. The visible "Liked · N" is unchanged. Unit-tested helper.

## 10. Admin setup
- **Real admins:** `stage8_admin_grant.sql`. Max edits one username and runs it as the owner. It refuses the placeholder or an unknown username. **Not authorized yet.**
- **Verification admin (approved: one disposable account, verification only):** `stage8_test_admin.sql`, also owner-run.
  - It refuses anything except a `cbsoc_admin_<6 hex>` account created in the last 24 hours with a disposable test email.
  - Its revoke block is required after testing and leaves 0 temporary admins.
  - The account's audit entries are kept, labelled with its username and `[TEST]` reasons.
- No app route, API or function writes `admins`, and no client or service key has privileges on it.

## 11. Release order and evidence

### Isolated compatibility run (no Docker; `supabase/isolated-test/`)
Embedded PostgreSQL 17.11 (UTF-8) plus **PostgREST 14.18**, the version production reports, with Supabase-like roles, auth and default privileges. It ran the production migration chain, then the deployed code's (`6289a7e`) exact query-builder calls with real JWTs.

**Latest result 2026-11-11: 52/52** (the 35 below, now with `submit_reply`, the hardened `posting_reaction_counts`, report-id validation, and a 17-check multi-session suite: concurrent replies and reports, report vs hide/delete lock ordering with `pg_blocking_pids`, dismiss vs hide, a stress round with no deadlocks). Seven deliberate regressions each fail the suite. `verify_roles` has 97 checks. The text below is the original 2026-11-10 run.

**Original result 2026-11-10: 35/35:**
- **Deployed code works before stage 8, after phase A and after rollback:** publish (category lookup, zone RPC, insert-select), anon reads, promote toggle on/off, another user can't promote, likes/plans upserts and deletes, starting a thread and sending a message.
- **After phase A:** the publish trigger stored a 7-day expiry for `1w` regardless of the client value.
- **After phase B:** the deployed direct promote is refused (42501), as designed, and the new code's `set_posting_promoted` works.
- preflight guards ok; verify_admin **24/24**; verify_roles **73/73**.
- **Rollback:** removes the functions, leaves no client access, and keeps hidden postings excluded.
- The migration re-applied after rollback without error (idempotent).
- Both setup scripts refuse their placeholders. The test-admin script refuses a real account, grants a fresh disposable one (which then can use admin functions), and its revoke leaves 0.

**Bugs this run found and fixed before review** (the parser checks had passed):
1. Default EXECUTE grants made internal and admin helpers callable by anon. Now exact revokes and grants.
2. The replies rate limit inside a replies policy caused 42P17. Now `cb_reply_rate_ok()`.
3. Three verify checks read state before their action ran (scalar sub-select evaluated first).

**Limits:** production's exact Postgres minor version and any untracked manual production changes aren't reproduced; the production preflight covers that. PostgREST on Windows sometimes exits at startup, so the harness retries and reports the attempt.

### Order (each step needs Max's go-ahead)
1. **Max:** review the SQL files.
2. **Max:** run `stage8_moderation_preflight.sql` on production and send me the output.
3. **Max:** apply `stage8_moderation.sql` (phase A), then `_verify_admin.sql` and `_verify_roles.sql`. The deployed `6289a7e` keeps working (shown above). Verify_roles leaves 7 labelled `[TEST]` audit rows by `cb_s8t_m`.
4. **Kiro:** implement on a new branch from `origin/main` (§12), verify locally against production (phase A) with disposable accounts. **Max:** run `stage8_test_admin.sql` for the disposable admin I name, then the revoke block after the admin tests.
5. **Kiro:** protected preview; Max signs in to Vercel; preview tests.
6. **Max approves:** push, PR, checks, merge, so production gets the new code.
7. **Max:** apply `stage8b_promotion_lockdown.sql` (phase B) and confirm its check row (false/true/true).
8. **Kiro:** production smoke (reporting, moderation with the test admin re-granted, replies, edit, delete, promote, regression). Disposable cleanup.
9. **Later, separately:** Max grants a real admin with `stage8_admin_grant.sql` when ready.

**Rollback:**
- **Code reverted after phase B:** re-grant `is_promoted` (the commented line in phase B).
- **Stage 8 rollback:** `stage8_moderation_rollback.sql`. It never widens access and keeps hidden postings hidden.

## 12. Implementation plan (files)
- **Libraries:**
  - `src/lib/moderation.ts`: reasons, labels, RPC error mapping.
  - `src/lib/replies.ts`: body rule shared with the DB class, and read helpers.
  - `src/lib/postingInput.ts`: `validatePostingEdit`.
  - `src/lib/reactionLabels.ts`: Like label.
- **API:**
  - `api/postings/[id]/report` (POST)
  - `api/postings/[id]/replies` (POST)
  - `api/replies/[id]` (DELETE)
  - `api/postings/[id]` (PATCH, DELETE)
  - `api/postings/promote` (to the RPC)
  - `api/admin/reports`, `api/admin/postings/[id]`, `api/admin/actions`
- **Pages:**
  - `p/[id]/page.tsx`: report, replies, owner controls, author hidden notice
  - `p/[id]/not-found.tsx`
  - `p/[id]/edit/page.tsx`
  - `admin/page.tsx` + `loading.tsx`
  - `u/[username]/page.tsx`: owner card footer, admin link
- **Components:** `ReportPosting`, `Replies`, `OwnerControls`, `EditPostingForm`, `admin/*`; `PostingActions` (label); `PromoteToggle` (RPC).
- **Cron:** `api/cron/alerts` excludes hidden. The expire cron is unchanged.
- **Tests:** unit tests for each helper; REST/RLS and five-role browser suites (§13).

## 12a. Card Like/Unlike (requirements §3.4) — implemented 2026-11-10, needs no SQL
- **Server.** `attachViewerLikes(postings, viewerId)` (`src/lib/postings.ts`) adds `viewerLiked` and `viewerStateAt` with one RLS read of the viewer's own likes (`getViewerLikedIds`). The home page, Following and profiles call it, and pass `signedIn` through `HomeMap` and `PostingCardGrid` to `PostingCard`.
- **Card.** `PostingCard` is not a link. Its footer holds the author link and `CardLike`, a sibling button outside the title link.
  - **Signed in:** `useLike` (optimistic, in-flight lock, rollback, `likeErrorMessage`) calls the existing `PUT /api/postings/[id]/like`.
  - **Signed out:** the total plus a "Sign in to like" link (44 px target).
  - **Ended/unavailable mid-session:** a 409 or 404 closes the control with an explanation.
- **Shared wording.** `likeButtonLabel` ("Like/Unlike this posting. N likes") is used by the card and the detail page. The filled heart is `fill="currentColor"`.
- **Consistency.** `src/lib/likeStore.ts` keeps the last confirmed like per posting for this tab, with the like route's server timestamp (`at`, added to its response). Pages pass their server read time (`stateAt`). A confirmed entry wins only over an older render (back/forward from the router cache); a fresh render, which may include other people's likes, always wins. The detail page's `PostingActions` reads and writes the same store.
- **Verified 2026-11-10** on a local production build against the live database, disposable accounts and `[TEST]` postings: **25/25**.
  - signed-out view
  - immediate update before the save returns
  - persistence after refresh on home, Following and profiles
  - detail consistency through title link, Back and Forward
  - two accounts' counts both ways, including a fresh render beating an older confirmation
  - 500 and network failures roll back with visible errors, and a retry saves once
  - 6-click burst sends 1 request
  - keyboard: Tab reaches it with a visible ring; Enter likes and Space unlikes without navigating
  - 390 px: 50 × 46 button, 55 px-tall sign-in link, touch tap doesn't navigate, no button inside any link, no overflow
  - author link works
  - ended posting not listed; ending or removal while open is refused and explained
  
  Card overlap re-measured at 390/768/1280: 0. Unit tests 167/167; production build passes.
- **Not yet verified:** moderation-hidden postings (needs phase A), a real phone, and the protected preview or production.

## 12b. Implemented (branch `feature/moderation-ui`, from `origin/main` 6289a7e)
- **Libraries:** `moderation.ts` (reasons, report/admin input validation, error mapping), `replies.ts` (body rule shared with the DB class, error mapping, list helpers), `moderationData.ts` and `adminData.ts` (server reads as the signed-in viewer; no service key), `validatePostingEdit` + `parseRsvpUrl` in `postingInput.ts`.
- **API:** `POST /api/postings/[id]/report`, `POST /api/postings/[id]/replies`, `DELETE /api/replies/[id]`, `PATCH`/`DELETE /api/postings/[id]`, `/api/postings/promote` (now `set_posting_promoted`), `GET /api/admin/reports`, `GET /api/admin/postings/[id]`, `POST /api/admin/actions`. Admin routes answer 404 to everyone who isn't an admin.
- **Pages/components:** posting page (report, replies, owner controls, author's hidden notice), `p/[id]/not-found.tsx` (neutral), `p/[id]/edit`, `admin/page.tsx` + `AdminQueue`, profile owner controls and admin link, `ReportPosting`, `Replies`, `OwnerControls`.
- **Decisions made while building:** (1) `/admin` has **no** `loading.tsx`: a streamed loading shell makes a non-admin's not-found a 200, and the 404 status is part of "does not exist for you". (2) The hide confirm is the dark-red action and only one action panel can be open, so the admin screen keeps a single dark-red action; Delete confirms use a dark-red outline. (3) The thread page for a conversation about a hidden posting still opens for its two participants but omits the link to the posting. (4) A reply retry whose reply was deleted meanwhile returns the old id and does not recreate it.
- **Known, pre-existing:** an intermittent React #418 hydration error appears on some signed-in page loads. It reproduces identically on a build of `origin/main` without these changes, so it is not from this work. It can briefly blank a page after load; tests wait for it to settle.

## 13. Verification plan (after phase A is applied)
- **Static:** typecheck, lint, unit tests, and a production build outside OneDrive.
- **REST with real JWTs (disposable accounts):**
  - protected-field writes refused
  - self-made admin refused
  - reports and log unreadable by non-admins
  - `/api/admin/*` returns 404 for non-admins
  - concurrent duplicate reports leave one row
  - rate limits
  - replies dedupe
- **Browser (local production build, then the protected preview), five roles:** disposable admin (via `stage8_test_admin.sql`), author, reporter, unrelated user, signed-out visitor. Covered:
  - all reporting states
  - `/admin` 404 for every non-admin role
  - dismiss, hide and restore with the audit trail
  - hidden posting absent from every surface; direct link neutral; author notice
  - restore: an author-deleted posting stays deleted, an ended posting stays ended
  - existing conversation private, and the admin can't read it
  - replies, edit, delete, promote, and the Like label
  - regression of likes/plans, follow, friends, messaging
  - keyboard-only pass
  - 390 and 1280 px layouts (emulated; a real phone stays unverified)
- **Cleanup:**
  - Delete disposable accounts and `[TEST]` content.
  - Revoke the test admin.
  - Keep the labelled `[TEST]` audit rows (report their count).
  - Compare totals and full-row hashes of existing data.
  - Preserve `cbsoc_qa_1110b` and its messages (Max's audit).

## 14. Decisions (approved 2026-11-10)
1. Admins see the reporter's @username, never email.
2. The author sees the moderator's reason on their hidden posting.
3. Rate limits: reports 5 per 10 min and 20 per 24 h; replies 10 per 10 min.
4. Re-reporting is allowed after resolution.
5. Ended postings: replies readable, closed to new ones.
6. Report details are optional for every reason.
7. Like label "Unlike this posting. N likes" when selected.
8. One disposable admin for verification only; no real admin yet.

## 15. Out of scope (noted for later)
- Reporting or moderating individual replies.
- Appeals, notifications, admin-management UI, bulk actions.
- Server-verified pin location (inherently client-supplied).
- Client-settable `created_at` on likes/plans/follows/connections.
