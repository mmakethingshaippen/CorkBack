# Implementation Plan: Profile Photos

## Overview

Build on branch `feature/profile-photos`: pure helpers first, then the sharp pipeline, the API route, the shared Avatar, the owner control, display everywhere, draft SQL (not applied), local database tests, and a live verification against the production Supabase project from a local dev server. No application deployment, no commit and no push without the owner's approval. Pending SQL (`cb_clear_avatar`, `avatar_uploads`, `cb_avatar_rate_check`) is written as drafts only: do not apply, user review required.

## Tasks

- [x] 0. Branch setup
  - [x] 0.1 Create the working branch
    - Run `git status` first and record any existing uncommitted changes without touching them
    - Create and switch to `feature/profile-photos` from `main` in the working tree with `git switch -c feature/profile-photos main`
    - Do not touch other branches. Make no commits unless the user asks
    - _Requirements: 11.7_

- [x] 1. Add the image dependency
  - [x] 1.1 Add sharp at an exact version
    - Add `"sharp": "0.35.5"` (no range) to `dependencies` in `package.json` with `npm install --save-exact sharp@0.35.5`
    - Run `npm ls sharp` and confirm exactly 0.35.5; if the version does not exist, stop and report instead of picking another
    - _Requirements: 3.1_
  - [x] 1.2 Smoke decode with sharp
    - In a throwaway script outside the repo (delete afterwards), create a 64 by 64 PNG with sharp, read its metadata, re-encode to WebP, and confirm `limitInputPixels` and the first-frame option behave as the design assumes
    - Record sharp's actual option names for animated input
    - _Requirements: 2.4, 2.9, 3.6_

- [x] 2. Library modules and pure tests
  - [x] 2.1 Create `src/lib/avatars/{constants,validate,path,url,errors}.ts`
    - Constants: bucket, 2 MiB, allowed types, `MAX_INPUT_PIXELS = 50_000_000`, `MIN_DIMENSION = 32`, 512, quality 85, orphan age 10 minutes
    - `precheckFile`, `checkDimensions`, `canManageAvatar`, `avatarControls`, `buildAvatarPath`, `parseAvatarPath`, `avatarUrl`, `avatarInitial`, and the error code table with user-facing text
    - Keep `url.ts` and `errors.ts` free of server-only imports so client components can use them
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.9, 2.10, 2.11, 4.4, 8.2, 8.3, 8.9, 12.1, 12.2, 12.3_
  - [x] 2.2 Write property test for the upload precheck
    - **Property 1: Upload precheck accepts exactly valid files**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.11**
  - [x] 2.3 Write property test for the dimension rule
    - **Property 2: Dimension rule**
    - **Validates: Requirements 2.9, 2.10**
  - [x] 2.4 Write property test for the path builder and parser
    - **Property 3: Avatar path builder and parser round trip**
    - **Validates: Requirements 4.4, 5.2, 7.1**
  - [x] 2.5 Write property test for the URL helper and fallback initial
    - **Property 9: Avatar URL and fallback**
    - **Validates: Requirements 8.2, 8.3, 8.9**
  - [x] 2.6 Write property test for control visibility
    - **Property 10: Control visibility**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 12.1, 12.2, 12.3**
  - [x] 2.7 Create `src/lib/avatars/process.ts` (server-only)
    - `import "server-only"`; `processAvatar` per the design: sharp with `limitInputPixels`, format sniffed from bytes (jpeg, png, webp only), dimension check, `.rotate()`, `.resize(512, 512, { fit: "inside", withoutEnlargement: true })`, `.webp({ quality: 85 })`, no metadata, first frame only
    - Map sharp pixel-limit errors to `too_many_pixels` and other decode errors to `not_an_image`
    - _Requirements: 2.4, 2.5, 2.9, 2.10, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [x] 2.8 Write property test for processed output invariants
    - **Property 4: Processed output invariants**
    - Generate tiny images (at most 64 pixels per side) in JPEG, PNG and WebP with EXIF orientation 1 to 8; 100 runs
    - **Validates: Requirements 3.1, 3.3, 3.4, 3.5, 3.7**
  - [x] 2.9 Write sharp fixture tests
    - Fixtures are built in the test, not committed: JPEG with GPS EXIF (output has no EXIF), a text file declared `image/png` rejected, SVG rejected, GIF rejected, pixel limit rejected, 31 by 31 rejected, orientation 6 swaps dimensions, animated WebP gives one frame
    - _Requirements: 2.4, 2.5, 2.9, 2.10, 3.2, 3.4, 3.6, 11.8_
  - [x] 2.10 Create `src/lib/avatars/storage.ts` (server-only)
    - Service-role Storage helpers taking an injected client: `uploadObject` (upsert false, `contentType: "image/webp"`, `cacheControl: "31536000"`), `removeObjects`, `listFolder`, and the pure `selectOrphans(objects, currentName, now)`
    - _Requirements: 7.1, 7.2, 7.6, 7.7_
  - [x] 2.11 Write property test for orphan selection
    - **Property 7: Orphan selection**
    - **Validates: Requirements 7.6**

- [x] 3. API route
  - [x] 3.1 Create `src/lib/avatars/service.ts` and `src/app/api/profile/avatar/route.ts`
    - `service.ts` (server-only) orchestrates with injected clients: session user, `cb_avatar_rate_check` before decode (429 with `Retry-After: 600`, any other failure 503), early content-length check, `precheckFile`, `processAvatar`, upload, `cb_set_avatar`, delete old object, sweep orphans, best-effort delete of the new object when `cb_set_avatar` fails
    - `removeAvatar` calls `cb_clear_avatar`, deletes the old object, and uses no rate allowance
    - `route.ts` exports `runtime = "nodejs"`, `POST` and `DELETE`; reads only the `file` field and the session; it is the only importer of `createAdminClient`
    - Response shape `{ ok, code?, message?, path?, url? }` with the status table from the design
    - _Requirements: 2.2, 2.3, 4.1, 4.2, 4.3, 4.4, 7.1, 7.2, 7.3, 7.4, 7.6, 7.7, 12.4, 12.5, 12.6, 12.8, 12.10, 13.1, 13.5, 13.6, 13.7, 13.9_
  - [x] 3.2 Add `import "server-only"` to `src/lib/supabase/server.ts`
    - Confirm no client component imports that file (typecheck and a build will show it)
    - _Requirements: 4.5_
  - [x] 3.3 Write property test for session-derived identity
    - **Property 5: Target user is always the session user**
    - Cover POST and DELETE, with foreign ids in body, query and headers, and the no-session case
    - **Validates: Requirements 4.1, 4.2, 4.3, 12.4, 12.5**
  - [x] 3.4 Write property test for failure safety
    - **Property 6: Failure never loses the current photo**
    - **Validates: Requirements 7.3, 7.4, 12.10**
  - [x] 3.5 Write property test for rate-check outcome mapping
    - **Property 8: Rate-check outcome mapping**
    - **Validates: Requirements 13.1, 13.5, 13.6, 13.7**
  - [x] 3.6 Write route example tests
    - Signed-out 401 for POST and DELETE, invalid type, 2 MiB + 1 byte, undecodable file, upload options (`upsert: false`, `image/webp`, cache control), DELETE never calls the rate check
    - Mock Supabase in the style of `src/app/api/category-follows/[slug]/route.test.ts`
    - _Requirements: 2.2, 2.3, 4.1, 7.7, 11.1, 13.9_

- [x] 4. Shared Avatar, PosterHandle and queries
  - [x] 4.1 Create `src/components/ui/Avatar.tsx`
    - Client component: fixed width and height, `loading="lazy"`, `decoding="async"`, alt contains the username, `onError` fallback, Fallback_Avatar (white circle, 2px navy border, initial in Kalam Bold), round `object-cover`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_
  - [x] 4.2 Extend `PosterHandle` with optional `avatarPath` and `avatarSize`
    - Render `Avatar` as a sibling before the link only when the prop is provided; unchanged output otherwise
    - _Requirements: 8.1, 8.5_
  - [x] 4.3 Add `avatar_path` to every `profiles(username)` query in the inventory
    - `src/lib/postings.ts` (embed, `getProfileByUsername`, `Posting.authorAvatarPath`), `connections.ts`, `follows.ts`, `reactions.ts`, `moderationData.ts`, `src/app/api/postings/[id]/replies/route.ts`, `src/app/api/users/search/route.ts`, plus the matching types in `src/lib/types.ts` and `src/lib/replies.ts`
    - Confirm `anon` and `authenticated` can still select the column under the narrowed column grants (task 8.1 and 10.5 check it)
    - _Requirements: 8.1, 8.9_
  - [x] 4.4 Pass `avatarPath` at every `PosterHandle` call site
    - `PostingCard`, `p/[id]/page.tsx`, `Replies`, `PostingActions` attendance lists, `u/[username]/page.tsx` header, `following/page.tsx`, `friends/page.tsx`, `FriendsManager` (people, requests, search results)
    - Check each card and list at 390 px for overlap or horizontal scroll
    - _Requirements: 8.1, 8.7_
  - [x] 4.5 Show the viewer's avatar in the top bar
    - `getViewer` selects `avatar_path`; `TopBar` and `AuthControl` show the photo in the existing white, navy-bordered circle with the current icon as fallback
    - _Requirements: 8.1, 8.8_
  - [x] 4.6 Write Avatar and query coverage tests
    - Avatar fallback on null path and on `onError`, alt text, `PosterHandle` unchanged without the prop, and a source scan proving each inventory query selects `avatar_path`
    - _Requirements: 8.1, 8.3, 8.4, 8.5_

- [x] 5. AvatarUploader and profile integration
  - [x] 5.1 Create `src/components/ui/AvatarUploader.tsx`
    - Hidden file input behind a real button; client prechecks with specific messages; XHR upload with `upload.onprogress` progress bar; ref lock and disabled state; polite `aria-live` status and `role="alert"` errors; inline confirm for Remove
    - 50px controls, white with a 2px navy border, navy text, visible focus ring, no dark red; `router.refresh()` after success or removal
    - _Requirements: 1.1, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 12.1, 12.9, 12.10_
  - [x] 5.2 Integrate into `src/app/u/[username]/page.tsx`
    - Render `AvatarUploader` only when the existing `isSelf` check is true and the profile is not a Seed_Profile, passing the current `avatarPath`; show the Avatar for everyone
    - Confirm no change to username editing and no added dark-red action
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 10.1, 12.1, 12.2, 12.3_
  - [x] 5.3 Write AvatarUploader example tests
    - Labels for add and change, Remove visible only with a photo, precheck messages, progress and error states, disabled while uploading
    - _Requirements: 1.5, 1.6, 1.7, 2.1, 12.1, 12.2_

- [x] 6. Messages, inbox and admin queue
  - [x] 6.1 Add avatars to inbox and thread views
    - `/api/messages/threads` returns `otherAvatarPath`; `InboxList.tsx`, `inbox/[id]/page.tsx` header and `ThreadView.tsx` render `Avatar`
    - _Requirements: 8.1, 8.7_
  - [x] 6.2 Add avatars to the admin queue
    - New `lookupAvatarPaths(supabase, usernames)` in `src/lib/adminData.ts` using one `profiles` read; merge into report and detail data; `AdminQueue.tsx` renders `Avatar` for reporter, author and admin names. No SQL change
    - _Requirements: 8.1, 8.9_
  - [x] 6.3 Write tests for inbox and admin avatar data
    - Threads route returns `otherAvatarPath`; `lookupAvatarPaths` returns an empty map for an empty list and does not query
    - _Requirements: 8.1_

- [x] 7. Pending SQL drafts (do not apply; user review required)
  - [x] 7.1 Write `supabase/stage10b_avatar_clear_and_rate_limit.sql`
    - Header comment: "DRAFT. DO NOT APPLY. USER REVIEW REQUIRED."
    - Contents exactly as in the design: `cb_clear_avatar`, `avatar_uploads`, `cb_avatar_rate_check`, revokes and the assertion block
    - _Requirements: 12.6, 12.7, 13.2, 13.3, 13.4, 13.8_
  - [x] 7.2 Write `supabase/stage10b_avatar_clear_and_rate_limit_preflight.sql`
    - Read-only checks: `cb_set_avatar` exists with the expected grants, `profiles.avatar_path` and its constraint exist, neither new object exists yet. Header: do not apply without review
    - _Requirements: 9.1_
  - [x] 7.3 Write `supabase/stage10b_avatar_clear_and_rate_limit_rollback.sql`
    - Drops only `cb_avatar_rate_check(uuid)` and `cb_clear_avatar(uuid)`; keeps the table and its rows; notes that deployed code then fails closed so code rolls back first
    - _Requirements: 9.1, 9.4_
  - [x] 7.4 Write `supabase/stage10b_avatar_clear_and_rate_limit_verify.sql`
    - Assertions plus behavior checks inside a transaction that rolls back, in the style of `stage8_moderation_verify_roles.sql`
    - _Requirements: 11.2_

- [x] 8. Isolated local database test
  - [x] 8.1 Extend `supabase/isolated-test` for avatars
    - Add a stub `storage` schema (`storage.objects`), the `profiles.avatar_path` column, constraint and narrowed grants, and a `cb_set_avatar` equivalent to the applied one, then load the drafts from task 7
    - Assert: grants and RLS; `anon` and `authenticated` can still select `avatar_path`; direct `avatar_path` writes refused; `cb_clear_avatar` returns the old path and nulls it; unknown user raises CB404; clients refused on both functions; sixth attempt in 10 minutes and 21st in 24 hours raise CB429; a concurrent burst counts exactly; rollback keeps ledger rows
    - Runs only against the local embedded PostgreSQL; never against production
    - _Requirements: 5.3, 5.4, 5.5, 9.3, 9.4, 11.2, 12.6, 12.7, 13.2, 13.3, 13.8_

- [x] 9. Static checks
  - [x] 9.1 Run typecheck, lint and tests
    - `npm run typecheck`, `npm run lint`, `npm test`; fix failures in the new code only
    - _Requirements: 11.1_
  - [x] 9.2 Run the production build
    - `npm run build` (build outside OneDrive if the existing notes require it); confirm `sharp` loads in the Node runtime route and no client bundle imports server-only modules
    - _Requirements: 4.5, 11.1_

- [x] 10. Live verification (local `next dev` against the production Supabase project; no deployment)
  - [x] 10.1 Create two disposable accounts and record a baseline
    - Use the Supabase admin API with `email_confirm: true`; follow the stage 8 and 9 cleanup pattern in `BUILD_LOG.md` (baseline counts and hashes of `postings` and `profiles`, `[TEST]` labels, delete only what setup recorded)
    - Keep credentials out of the repo and logs. The user starts `npm run dev`; do not start a long-running server from the agent
    - _Requirements: 11.3_
  - [x] 10.2 Prepare the browser harness
    - Read `scripts/card-e2e/README.md`; reuse its approach (Playwright core driving installed Microsoft Edge, scratch folder outside the repo). If Edge or Playwright cannot run, document exactly what is blocked and mark the browser checks untested
    - _Requirements: 11.3_
  - [x] 10.3 Run the upload checks in the browser
    - First upload, replacement (new URL, old object gone), invalid types (GIF, SVG, text renamed PNG), over 2 MB, undecodable file, fallback and failed-image display, refresh persistence, Remove photo (BLOCKED until the pending SQL is applied)
    - _Requirements: 1.5, 1.6, 1.7, 2.1, 7.1, 7.2, 7.5, 8.3, 8.4, 11.3_
  - [x] 10.4 Check avatar consistency and mobile width
    - The photo appears on the profile, cards, posting page, replies, Following, Friends (friends, requests, search, attendance), attendance lists, inbox, thread header, admin queue (if an admin is available, otherwise untested) and the top bar; check 390 px and 1280 px for overlap and horizontal scroll
    - _Requirements: 8.1, 8.7, 8.8, 11.3_
  - [x] 10.5 Run cross-account checks with direct calls
    - With the second account's JWT: REST PATCH of the first account's `profiles.avatar_path`, RPC `cb_set_avatar` and `cb_clear_avatar`, Storage insert, update and delete in the first account's folder, and an anonymous select of `avatar_path`; all writes must be refused and the read must succeed
    - _Requirements: 5.3, 5.5, 6.2, 6.3, 6.4, 11.4_
  - [x] 10.6 Run the username-edit and sign-up regression
    - Rename the first account's username and confirm it saves; confirm profile creation at `/welcome` still works
    - _Requirements: 10.1, 10.2, 11.5_
  - [x] 10.7 BLOCKED: live rate-limit test
    - Blocked until the owner reviews and applies the pending SQL. Then: five attempts in 10 minutes succeed or fail by validity, the sixth returns 429 with `Retry-After`; a failed attempt consumed allowance; with the function missing the route returns 503
    - _Requirements: 13.1, 13.3, 13.5, 13.6, 13.7, 11.9_
  - [x] 10.8 BLOCKED: live Remove photo test
    - Blocked until the owner reviews and applies the pending SQL. Then: remove returns the fallback, persists after refresh, deletes the old object, and the second account cannot call `cb_clear_avatar`
    - _Requirements: 12.4, 12.6, 12.7, 12.8, 12.9, 11.9_
  - [x] 10.9 Clean up
    - Delete only the disposable accounts, their Storage objects and `[TEST]` data; compare counts and hashes with the baseline; delete the scratch folder containing the test password
    - _Requirements: 11.3_

- [x] 11. Record results
  - [x] 11.1 Add the `BUILD_LOG.md` entry
    - List every check as pass, fail or untested, including the BLOCKED ones, the pending SQL status (drafted, not applied), and the pixel limit proposal; no credentials, tokens, emails or passwords
    - Do not claim the feature works until upload, refresh and cross-account checks pass; no deployment without user approval
    - _Requirements: 11.6, 11.7_

- [x] 12. Owner request: preview and square crop (added after the first pass)
  - [x] 12.1 Write `src/lib/avatars/crop.ts` (pure) and `crop.test.ts`
    - Fractions relative to the oriented image; clamp; `cropToPixels` always square and inside the image; `parseCrop` rejects malformed input
    - _Requirements: 1.10, 1.11, 3.5, 3.5a, 3.7_
  - [x] 12.2 Apply the crop on the server
    - `processAvatar(input, crop?)`: `rotate()`, `extract()`, `resize(512, 512, inside, withoutEnlargement)`; route reads the `crop` field, 400 `invalid_crop` before any database or Storage call; existing process and route tests updated to square output
    - _Requirements: 3.4, 3.5, 3.5a_
  - [x] 12.3 `AvatarCropper` and uploader flow
    - Circular preview, drag, arrow keys, zoom slider, Save photo / Cancel; upload only on Save; Cancel upload, 60 s timeout, network error keep the current photo
    - _Requirements: 1.5, 1.10, 1.11, 1.12_
  - [x] 12.4 Stage 10 review files
    - `stage10_avatars_preflight.sql` (read-only), `stage10_avatars_verify.sql` (rolls back), `stage10_avatars_rollback.sql` (non-destructive); all run and mutation-checked in `supabase/isolated-test/avatars.mjs` (70/70)
    - _Requirements: 9.1, 9.4, 11.2_
## Notes

- Every test task is required here because Requirement 11 demands the listed tests; none is marked optional.
- Sub-tasks 7.x write SQL drafts only. Nothing is applied to any database by this plan except the explicit local isolated database in 8.1.
- No application deployment, commit or push happens without the owner's approval.
- `MAX_INPUT_PIXELS` is a proposal in one constant; adjust it in `src/lib/avatars/constants.ts` if the owner prefers another limit.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["1.1"] },
    { "id": 2, "tasks": ["1.2", "2.1", "7.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "2.10", "7.2", "7.3", "7.4"] },
    { "id": 4, "tasks": ["2.8", "2.9", "2.11", "3.1", "3.2", "4.1"] },
    { "id": 5, "tasks": ["3.3", "3.4", "3.5", "3.6", "4.2", "4.3", "5.1", "8.1"] },
    { "id": 6, "tasks": ["4.4", "4.5"] },
    { "id": 7, "tasks": ["4.6", "5.2", "6.1", "6.2"] },
    { "id": 8, "tasks": ["5.3", "6.3"] },
    { "id": 9, "tasks": ["9.1"] },
    { "id": 10, "tasks": ["9.2"] },
    { "id": 11, "tasks": ["10.1"] },
    { "id": 12, "tasks": ["10.2"] },
    { "id": 13, "tasks": ["10.3"] },
    { "id": 14, "tasks": ["10.4", "10.5", "10.6"] },
    { "id": 15, "tasks": ["10.7", "10.8"] },
    { "id": 16, "tasks": ["10.9"] },
    { "id": 17, "tasks": ["11.1"] }
  ]
}
```
