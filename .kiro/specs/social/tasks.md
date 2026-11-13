# Social Features and Live Fixes — Tasks

Status: [ ] not started · [~] implemented, not verified on deployed site · [x] verified.
Stop for Max's approval after the plan and after each stage. No production deploy without final approval.

## Stage 1 — Likes, plans, lifecycle
- [x] 1.1 Migration `supabase/stage6_social_part1.sql` (+ `_preflight`, `_verify`, `_rollback`): postings `time_zone`/`end_date`/`end_time`; lifecycle functions; `posting_reaction_counts()`; likes and plans owner-only read; writes require an active posting. Friends' plan visibility moved to part 3: existing connections policies let a user insert their own `accepted` row. **Applied by Max (admin 23/23, roles 27/27).**
- [x] 1.2 `src/lib/lifecycle.ts`: IANA zone, explicit end, end-of-day, UTC−12 fallback; unit + property tests.
- [x] 1.3 Rule applied in map, profile, alerts, posting page; ended-posting read-only view; cron no longer soft-deletes.
- [x] 1.4 `PUT /api/postings/[id]/like` and `/plan` (desired state, idempotent, 400/401/404/409/403).
- [x] 1.5 Server-read viewer state, counts, and friends' plans on the posting page; counts on cards.
- [x] 1.6 Reaction controls: optimistic + pending lock + rollback + error; accessible names, `aria-pressed`; visibility explanation.
- [~] 1.7 Publish rejects past dates (posting time zone); year-less scans require confirmation; optional end date/time. **Remaining:** the optional end date/time fields have no recorded browser run (past-date rejection and year-less confirmation were browser-verified, 40/40).
- [x] 1.8 Scan back link "Back to map" (review page "Back to scan").
- [x] 1.9 Done on 2026-11-08:
  - Migration part 1 applied by Max (admin 23/23, roles 27/27).
  - Browser verification in real Edge, two sessions, against a local production build of the exact preview source and the live database: 40/40 checks, plus 4 true-burst rapid-click checks.
  - Preview `dpl_Fxb4ui2tP7hyFxmT9Bz5E5XrrQyt`: source byte-identical to the tested build. Not browser-tested on the preview URL itself, because Deployment Protection is on and no bypass exists.
  - Disposable data removed. **Stopped for approval before Stage 2.**

## Stage 2 — Following
- [x] 2.1 No migration needed. The existing PK prevents duplicates, `no_self_follow` blocks self-follows, and the self read/write/delete policies have no UPDATE. `supabase/stage6_social_part2_check.sql` is a read-only catalog check. The `followee_id` index was dropped from scope because feed queries use the PK's leading column.
- [x] 2.2 `PUT /api/follows/[username]` (desired state; 400 self/invalid, 401, 404). `FollowButton` (Follow/Unfollow with the handle in the name, pending lock, rollback, messages) on profiles and the posting author section. Placeholder copy removed.
- [x] 2.3 `/following`: signed-out, error, not-following, nothing-active, and feed states; `loading.tsx`; "You follow" list. `PostingCardGrid` keeps tilted cards from overlapping at desktop widths.
- [x] 2.4 Verified 2026-11-08, local production build of the exact preview source against the live DB: REST/RLS with real user JWTs 16/16; two-session Edge suite 40/40. Preview `dpl_8SJHk17KK4ngCWjHCCbgXKJipCjk` source byte-identical. Disposable data removed. **Stopped for approval before Stage 3.**

## Outstanding (carried)
- Direct verification on the protected preview URLs (needs Max to sign in to Vercel; no bypass secret will be added).
- Real-phone testing.
- Release gate: verify normal sign-up creates exactly one usable profile.
  - Finding: auth users created through the admin API got no profile row, so the `on_auth_user_created` trigger is absent or not firing. The sign-up route creates the profile itself with the admin client, and its comment wrongly credits a trigger.
  - Not verified: an end-to-end sign-up, and the username-race case (profile insert 23505 after the auth user exists).
  - Do not apply `stage5_profile_trigger.sql` blindly. Run `stage6_social_part2_check.sql` F5 first.
- Home rail uses the same one-column tilted-card grid as the old Following/profile; check it at desktop widths.

## Stage 3 — Friends
- [x] 3.1 Migration part 3 **applied by Max; verify_admin and verify_roles passed**: `supabase/stage6_social_part3.sql` (+ `_preflight`, `_verify_admin`, `_verify_roles`, `_rollback`).
  - One row per pair in either direction (unique least/greatest index); `no_self_connect` kept.
  - Column grants: clients may insert only the participants and update only status, so participants are immutable.
  - Policies: requester-insert pending, recipient-only pending→accepted, either-party delete.
  - `viewer_is_friend_of()`; plans "self or friend on active posting" read. Likes stay owner-only.
- [x] 3.2 `POST /api/connections` (send/cancel/accept/decline/remove; idempotent repeats; 409 `incoming_exists` / `already_friends` / `state_changed`, including the simultaneous-reciprocal 23505 case) and `GET /api/users/search` (signed-in, prefix, escaped, 20 max, usernames only).
- [x] 3.3 `/friends`: search with loading/empty/error states; incoming, outgoing and friends lists with per-row pending and confirm-before-remove; friends' plans on active postings; loading.tsx; signed-out and error states. `ConnectButton` on profiles, separate from Follow. Posting plan text updated.
- [x] 3.4 Verified 2026-11-08 against a local production build of the exact preview source and the live DB:
  - REST/RLS with real user JWTs: 21/21, including 10 rounds of truly concurrent reciprocal inserts.
  - Three-session Edge suite (A, B, unrelated C): 51/51.
  - Found and fixed: an expired-session message vanished because the hook refreshed into the signed-out view.
  - Preview deployed; not browser-tested directly (protected). **Stopped for approval before Stage 4.**

## Release items (before production)
1. Sign-up creates exactly one usable profile, and a username or profile-creation failure doesn't strand the account. Diagnose the `on_auth_user_created` trigger (part 2 check F5 / part 3 preflight `trigger`) before proposing any fix. Don't apply `stage5_profile_trigger.sql` blindly.
2. Homepage card overlap at desktop and mobile widths: check, and fix if reproduced.
3. Test the protected previews directly once Max signs in to Vercel. Never weaken Deployment Protection or add a bypass secret.

## Stage 4 — Messaging
- [ ] 4.1 Reproduce the composer issue in a browser and record the cause.
- [ ] 4.2 Migration part 4: `messages.client_id` + unique index.
- [ ] 4.3 Composer: success, clear, navigate; draft kept on failure; dedupe.
- [ ] 4.4 Verify both participants, replies both ways, ordering, persistence, duplicate prevention, outsider blocked; real-time only if tested. Logs. **Stop for final approval before production deploy.**
