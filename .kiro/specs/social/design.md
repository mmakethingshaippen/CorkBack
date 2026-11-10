# Social Features and Live Fixes — Design

## 1. Findings (inspection on 2026-11-08, read-only)

| Issue | Actual cause |
|---|---|
| 3, 4. Like and Going reset on refresh | `PostingActions` keeps like/plan in local React state only. There is no API route and no Supabase write anywhere (`from("likes")`/`from("plans")` appear nowhere in `src`). The live database has **0 likes and 0 plans**. The refresh shows the true server value. The write did not fail; it was never attempted. |
| 6. Ended posting offers Going | Posting `ffe92f35…` has `event_date = 2024-11-16` (a year-less flyer most likely assigned the wrong year) and a 24-hour `expires_at` that has also passed. The map and profiles filter with `isActive`, but `getPosting` (direct URL) checks only `deleted_at`, and the page renders reactions unconditionally. `validatePostingInput` accepts past event dates. |
| 7. Like accessible name is a number | The button's only text is the icon plus the count. |
| 8. Scan back link | `TopBar back={{ href: "/", label: "Scan a flyer" }}`. |
| 1, 2. Placeholders | `/following`, `/friends`, the profile, and the posting page contain placeholder copy; there are no follow or connection reads or writes. |
| 5. Composer | Storage and RLS are sound (the thread survived refresh). `MessagePoster` calls `router.push` on success; the reported "stays in composer" needs browser reproduction (Stage 4). There is no duplicate-send guard beyond a disabled button. |

**Database / RLS gaps found:**
- `plans public read using (true)`: any visitor with the public key can read every user's plans. This contradicts the friends-only attendance visibility in the steering doc.
- `likes public read using (true)`: who-liked-what is publicly readable.
- `connections party update`: either party can set `status`, so a requester could accept their own request.
- `connections`: no DELETE policy (cancel, decline, and remove are impossible); PK `(requester_id, addressee_id)` allows both A→B and B→A.
- `likes`/`plans` insert checks don't require the posting to be active.
- `isActive` ends events at 23:59 in the **server** timezone (UTC on Vercel), i.e. about 4 pm in California.

## 2. Architecture

- Mutations go through Next.js route handlers using the existing **public anon server client with the user's session cookies**. RLS is the enforcement layer; route handlers add validation and readable errors. **No service-role key in any feature code.**
- Reads for the current viewer (liked? plan? follows? friendship status?) happen server-side on each request (pages are already dynamic). After a mutation, the client calls `router.refresh()` to reconcile with the server.
- Aggregate counts (likes, going, interested) come from a `SECURITY DEFINER` SQL function `posting_reaction_counts(uuid[])` that returns counts only, so likes/plans rows can be private while counts stay public.
- Each reaction control is a small client component holding `{ serverState, optimisticState, pending, error }`. A click while `pending` is ignored. Requests send the **desired state** (`PUT /api/postings/[id]/like {liked:true}`, `PUT /api/postings/[id]/plan {kind:"going"|"interested"|null}`), so retries are idempotent.

## 3. Posting lifecycle

- **One rule:** `isPostingActive(posting, now)` in `src/lib/domain.ts`, used by every list, the posting page, and every reaction API.
- **Event end (approved):** in the posting's IANA time zone. New postings store `time_zone`, looked up from the pin at publish with `@photostructure/tz-lookup` (offline, pinned 11.7.0). At read time ONLY the stored zone is used, in both the app and the database, so they agree at the same instant (no pin lookup at read time; the publish route stores a zone only if `cb_safe_time_zone` accepts it). Older postings with no stored zone use the fallback until a separately reviewed backfill. If an explicit `end_date`/`end_time` exists it is used; otherwise the event ends at 23:59:59.999 local on the event day. A posting comes down at the earlier of that and `expires_at`. **Fallback:** if lookup fails (or the stored zone is invalid), use `Etc/GMT+12` (UTC−12), the last zone where any day ends, so a posting never ends early; it may end up to a day late. The database mirrors the same rule (`posting_takedown_at`, `cb_safe_time_zone`) for write checks. Nothing estimates an offset from longitude.
- **Expiry cron:** no longer soft-deletes ended postings (they keep their read-only page); `deleted_at` means author deletion only.
- **Ended posting view (direct URL):** show the posting with an "This posting has ended" notice, details, and final counts. No Like, Going, or Interested controls; reaction APIs return 409. Messaging the poster stays available (lost-and-found follow-ups). Owners still see Promote/Delete if present.
- **Publish validation:** reject an event date earlier than today in the posting's time zone, or an explicit end already passed. **Year-less scans (approved):** extraction returns `eventDateYearPrinted`; unless it is explicitly `true`, the review form shows a "Check the year" notice and a required confirmation checkbox, and the server rejects an unconfirmed date (`dateNeedsConfirmation` without `dateConfirmed`).
- **Existing ended posting `ffe92f35…`:** left untouched; it will render as ended.

## 4. Following
- Table `follows` exists (PK prevents duplicates, CHECK prevents self-follow). Add an index on `followee_id`.
- `PUT /api/follows/[username] {following: boolean}`.
- `FollowButton` on profiles and the posting author section (hidden on your own profile/postings and for signed-out users, who see "Sign in to follow").
- `/following`: active postings where `author_id in (my followees)`, newest first, rendered with the existing `PostingCard`.
- Independence: follow code never touches `connections`; a test asserts this.

## 5. Friends
**Schema changes (migration `stage6_social.sql`):**
- Unique index on `(least(requester_id, addressee_id), greatest(requester_id, addressee_id))`, so at most one connection per pair, whichever direction.
- Replace `connections party update` with `connections addressee accept`: `using (auth.uid() = addressee_id and status = 'pending') with check (status = 'accepted')`.
- Add `connections party delete`: either party may delete (cancel, decline, remove).
- Index on `addressee_id`.

**Actions (`/api/connections`):** send (insert pending); if the other user already sent a request, the API returns `409 incoming_exists` and the UI offers Accept instead of creating a conflicting row. Cancel = requester deletes pending; Accept = addressee updates; Decline = addressee deletes pending; Remove = either deletes accepted.

**Search:** `profiles` username prefix search (`ilike 'q%'`, min 2 characters, limit 20, excludes self). Returns usernames only.

**Privacy policy for attendance (proposed):**
- Your own plans: visible to you.
- An accepted friend's plans: visible to you, on **active** postings only, as `@username · Going|Interested · posting title, date, place label` (the posting's public place, never the user's location).
- Everyone else (including people you only follow): aggregate counts only.
- Never exposed: emails, device location, home point, alerts, messages.
- Enforced by RLS: `plans` select becomes `auth.uid() = user_id OR is_friend(auth.uid(), user_id)` where `is_friend` is a `SECURITY DEFINER STABLE` function over accepted connections. Counts come from `posting_reaction_counts`.

**Likes privacy (proposed):** `likes` select becomes owner-only; counts via the function. *(Decision for Max: keep likes publicly readable instead.)*

## 6. Messaging (Stage 4)
- Keep tables and the existing thread. Add `messages.client_id uuid` (nullable) plus a unique index `(thread_id, sender_id, client_id)`. The composer generates `client_id` once per draft; a repeated send returns the existing message instead of inserting a duplicate.
- Composer: on success show "Sent", clear the draft, navigate to `/inbox/[threadId]`; on failure keep the text, show the error, re-enable Send. Draft also saved to `sessionStorage` per posting.
- Reproduce the reported "stays in composer" in a real browser before changing navigation.
- Thread view: refetch on window focus and after send. No real-time claim unless verified across two sessions.

## 7. Migrations and deployment safety
- `supabase/stage6_social.sql`: additive and idempotent (indexes, policies, functions, `client_id`). It must be applied by Max in the Supabase SQL editor (no DDL access from the repo). The shared database means it affects production immediately; every change is compatible with the currently deployed code (deployed code never reads or writes plans, follows, or connections; its like-count embed already shows 0).
- Per stage: verify on a local production build (`next start`) against the live Supabase project, then on a Vercel **preview** deployment. Production deploy only after final approval.

## 8. Verification method
- Two independent Edge sessions (playwright-core in a temp folder, outside the repo) signed in as two fresh, clearly labeled test accounts (`cbsoc_a_…`, `cbsoc_b_…`) and fresh `[TEST]` postings. All are removed afterwards and residue is counted.
- Each mutation is checked after refresh **and** after signing out and back in, from both sides where relevant.
- Negative checks with raw API/REST calls: signed-out mutations, user B changing user A's like/plan/follow/connection, requester self-accepting, reading another pair's thread.
- Typecheck, unit tests (domain rules, idempotent state helpers), production build, and screenshots at 390 px and 1280 px.
- @testing (credentials supplied by Max, read from environment at run time, never written) is used only for a final check on the referenced posting.
