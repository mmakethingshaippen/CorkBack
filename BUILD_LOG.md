# CorkBack Build Log

Every entry records the date, the tool used, the feature built or fixed, and how it was verified live.
Kilo entries are labeled "Kilo discrete fix" with the file changed and the reason named.

---

## 2026-11-01 — Kiro — Stage 0: project skeleton + governance

- Created the Next.js (App Router) + TypeScript + Tailwind skeleton in the repo root.
- Created the `.kiro/` folder (steering docs, hooks) — kept in the repo, explicitly excluded from `.gitignore`.
- Baked the Foundations design tokens into `tailwind.config.ts` and `src/app/globals.css`.
- Implemented the procedural cork texture (`.cork-band`) in CSS — no image asset, no license question. Choice A: cork on header bands and empty states only.
- Added `BUILD_LOG.md`, `KIRO_USAGE_LOG.md`, MIT `LICENSE`, `README.md`, `.env.example`.
- Security: npm flagged `next@15.1.3` as vulnerable to CVE-2025-66478 (CVSS 10.0 RCE in the React Server Components protocol, affects App Router + React 19). Pinned to the patched `next@15.1.9` and `react`/`react-dom@19.0.3` before proceeding.
- Verification (live, local): `npm install` OK (403 packages), `npm run typecheck` passes, `npm run build` succeeds (routes `/` and `/_not-found` prerendered). One non-blocking ESLint warning: custom font loaded via `<link>` in `layout.tsx`; to be replaced with `next/font/google` when Kalam is wired properly in Stage 1.

## 2026-11-01 — Kiro — Stage 1: core-loop spec

- Authored the core-loop spec under `.kiro/specs/core-loop/` (requirements.md, design.md, tasks.md).
- No application features built. Awaiting Max approval of the plan and spec before writing the full app.
- Verification: spec review only; no live app behavior to verify at this stage.

## 2026-11-01 — Kiro — Stage 1 build: core loop

- **Locks recorded first:** updated `follow-connect-independence.md` steering — Like is postings-only (no like on replies/comments even though `replies` exists); `replies` is a public comment table day one; private DMs stay a Stage 3 stub.
- **Font:** switched Kalam to `next/font/google` (self-hosted, no runtime request to Google). The earlier lint warning is gone.
- **Data model (schema):** `supabase/schema.sql` creates all day-one tables (profiles, categories, postings, likes, plans, follows, connections, hidden_postings, replies, alerts) + RLS (public read for browsing, owner-scoped writes) + seeded categories.
- **Domain core + property tests:** `src/lib/domain.ts` with four fast-check property suites. The tests CAUGHT two real bugs before any screen was built: (1) pin-nudge overshoot across the antimeridian — fixed with a geodesic bearing/destination offset; (2) card-tilt off-by-one letting magnitude reach 8.9° — fixed the modulo range. All 9 tests pass.
- **Components before screens:** Wordmark (text), Card (Choice B tilt), CorkBand (Choice A), CategoryChip, actions (one dark-red primary), Field (2px navy), BottomNav, PosterHandle, PostingCard, PostingActions, SignInToTakePart, TopBar, inline canonical icons (no status-bar art, no map fragments), MapView (MapLibre free tiles, darker-tan, dark-red pins).
- **Screens + routes:** `/` (public map + rails, no account wall), `/p/[id]` (posting page), `/sign-in`, `/sign-up` (email-only, username rule, no full name), `/scan` + `/scan/review` (capture → server Gemini extract → editable review → publish), `/u/[username]` (profile link target), and `/following` `/friends` `/alerts` nav targets. API routes: auth sign-in/up, postings create (expiry + pin clamp), scan extract (Gemini key server-only), cron expire (secret-protected). `vercel.json` hourly cron.
- **Seed/fallback:** `src/lib/seed.ts` (London/Berlin/Mexico City, matching Figma) powers a no-credentials live mode so browsing is verifiable immediately and doubles as Stage 5 seed content.
- **Verification (live, local):**
  - `npm run typecheck` ✓, `npm test` ✓ (9/9 property tests), `npm run build` ✓ (16 routes, no lint errors).
  - `next start` on :3000 — home `/` returns 200 with no account wall, both actions, all three seed postings, sign-in link. `/p/london-quiet-sounds` 200 with title, RSVP, poster `@handle` → `/u/...` profile link, "Sign in to take part" gate, Replies section. `/scan` shows the sign-in gate for visitors. `/sign-up` shows the username rule hint. Missing posting → 404. `/u/northlondonnotes` 200 with independent Follow/Connect.
  - API safety: invalid username → 400 with specific reason (server re-validates); valid username without DB → 501 graceful; posting without DB → 501 graceful; cron without secret → 401.
- **Not yet verifiable without credentials (requires Max to provide Supabase/Gemini/Resend):** real sign-up/sign-in, live Gemini extraction, real publish writing a row, and the cron sweep against live data. The code paths exist and are typed/built; they report "not configured" until keys + `schema.sql` are in place (see SETUP.md). This is the live end-to-end check to run before Stage 2.

## 2026-11-01 — Kiro — Fix: home page crash after Supabase credentials added

- **Symptom:** with `.env.local` present, `/` threw an Unhandled Runtime Error — a raw Supabase error object was thrown (`if (error) throw error`), which Next couldn't render.
- **Real cause (logged to terminal):** `PGRST201` — "Could not embed because more than one relationship was found for 'postings' and 'profiles'". The `.select("… profiles(username) … likes(count)")` embed was ambiguous: `postings` reaches `profiles` via `author_id` and transitively through `likes`/`plans`/`hidden_postings`. (The schema was applied; this was not a missing-table error.)
- **Root-cause fix:** disambiguated the embeds by naming the FKs — `profiles!postings_author_id_fkey(username)` and `likes!likes_posting_id_fkey(count)` — in both `listActivePostings` and `getPosting`.
- **Readable errors instead of crashes:** added `toReadableError()` in `src/lib/postings.ts` that logs the structured Postgrest `{code, message, details, hint}` to the server terminal and throws a real `Error` with an actionable message (special-casing schema-not-applied codes). Added `src/app/error.tsx` root boundary, and made `/` catch a postings-load failure to show an inline banner so the rest of the page still renders.
- **Verification:** reproduced the 500 and captured `PGRST201` in the terminal; after the fix `GET / 200` (dev on :3001 and prod `next start` on :3100), empty-state renders since the DB has no rows yet, no error logged. `npm run typecheck` ✓, `npm test` ✓ (9/9), `npm run build` ✓.

## 2026-11-01 — Kiro — Scan model change to gemini-3.5-flash-lite + plain-line fallback

- **Main builder & reviewer:** Kiro. **Discrete debugging help:** ChatGPT (hardened the scan route's error handling, timeout, and key redaction during the prior scan fix). All changes reviewed and verified live by Kiro.
- **Root motivation:** `gemini-3.8-flash` was persistently overloaded (503 "high demand") and slow, repeatedly hitting the 45s timeout. The scan returned a readable 504 but could not complete a live extraction.
- **AI Studio result (screenshot transcription — NOT verbatim JSON).** On the same cropped JPG, the reporter tested the lite model in AI Studio; it worked instantly and returned plain `key: value` lines (not JSON):
  - title: COMMUNITY PICKLEBALL SOCIAL
  - date: SATURDAY, NOVEMBER 16
  - time: 9:00 AM to 12:00 PM
  - place: RIVERSIDE PARK COURTS, 120 PARK AVE
  - category: Community Event
  (Transcribed from a screenshot; the dash in the screenshot was written as "to" to keep the no-dash rule. Treated as reported, not as a verbatim API payload.)
- **Change (one place only):** scan config model default `gemini-3.8-flash` → `gemini-3.5-flash-lite` in `src/app/api/scan/extract/route.ts` (still overridable via `GEMINI_MODEL`). Updated the one matching assertion in `src/app/api/scan/extract/route.test.ts`. Endpoint, image handling, auth, profiles, and map code unchanged.
- **Plain-line handling:** the app still *enforces* JSON via `responseMimeType: application/json` and a strengthened prompt. Because AI Studio showed this model can emit plain lines in free-form mode, I added a `parsePlainLines()` fallback used only if `JSON.parse` fails (maps title/date/time/place/category lines to the ExtractedFlyer shape). Added a scan test covering the AI-Studio-style plain-line response. This answers the "handle plain lines OR enforce JSON" question with both: JSON primary, plain-line salvage as a safety net.
- **Scope confirmed:** only scan files + scan tests changed (route.ts, route.test.ts; the earlier scan-flow client ScanCapture.tsx from the prior fix). No git repo existed, so scope was confirmed by file inspection and modified-time grouping.
- **Verification:** `npm run typecheck` ✓, `npm test` ✓ (32/32), `npm run build` ✓. One server restarted (prod `next start` :3100). One live scan of the same cropped JPG → HTTP 200 in ~1.9s, returning title "An evening of quiet sounds", date 2026-11-13, time 19:30, place "UNION CHAPEL, LONDON N1 2UN", category music. Review form reads exactly these fields (title/eventDate/eventTime/placeLabel), so the review screen shows title, date, time, and place.

## 2026-11-01 — Kiro — Correction: Stage 1 live verification & scan test labeling (per Max)

Correcting the record. Stage 1 is verified live on the dev server (reported by Max):

- **Gate test (the scan acceptance test):** the cropped **pickleball** JPG, scanned on the **dev server**. This is the official scan gate test and it PASSED (returned title, date, time, place, category).
- **Publish check:** PASSED on the dev server (per Max).
- **Separate earlier test (NOT the gate):** the "own flyer" scan that returned the **Union Chapel** result ("An evening of quiet sounds", 2026-11-13, 19:30, Union Chapel). This was a separate developer test on a prod `next start` server, not the acceptance gate. The prior log entry that showed the Union Chapel result was that separate test, not the gate.
- **Test flyers are out of the repo:** confirmed no image/flyer files are tracked (`git ls-files` shows none) and none sit in the working tree outside node_modules/.next. Test flyers were always generated into the OS temp dir; generator scripts were deleted. Nothing to remove.

## 2026-11-01 — Kiro — Stage 2: radius email alerts

Main builder & reviewer: Kiro. Built Stage 2 only — no messaging, no promoted postings, no Stage 1 rebuild.

- **Keys checked first (presence only, never printed):** from `.env.local` — `CRON_SECRET` present, `GEMINI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`NEXT_PUBLIC_SUPABASE_URL` present. **`RESEND_API_KEY` is MISSING.** Per instruction, I did not guess, invent, or send any test email.
- **Alert fields:** one category (`category_id`), one home point (`center_lat`/`center_lng`, optional `town_name` label; a town name is geocoded to a center via free OSM Nominatim, or "use my current location" sets a map point), one radius (`radius_miles` 1–25, or NULL = whole town). Users can create multiple alerts. Home point and radius are private — shown only to the owner on `/alerts`, never on the board, a posting page, or in any email. User email stays private.
- **Schema:** extended the EXISTING `alerts` table via `supabase/stage2_alerts.sql` (additive, idempotent): added `town_name`, relaxed the radius check to allow NULL (whole town). Added a new `sent_alerts (alert_id, posting_id)` dedupe ledger with RLS (owner read; writes via service role). No change to auth, profiles, map, scan, or posting tables.
- **Matching (`src/lib/alerts.ts`, pure/testable):** a posting matches when same category, inside radius, active (not expired/past-event/deleted), not hidden by the owner, and NOT the owner's own posting. Whole-town uses a 25-mile cap for matching (never shown to anyone).
- **Email (`src/lib/email.ts`, Resend, server only):** email contains posting title, date, time, place, and a link to the posting page — nothing about the alert's location/radius or any other user's email. `RESEND_API_KEY` read server-side only, never logged.
- **Sweep (`/api/cron/alerts`, CRON_SECRET-guarded):** service-role read of active postings + all alerts, matches, dedupes against `sent_alerts`, sends one email per new (alert, posting) pair, records it. Cron added to `vercel.json` (every 15 min).
- **Screen (`/alerts`):** signed-in users create/list/delete alerts (no edit flow). Visitors see the sign-in gate. "Set an alert" stays deep navy (secondary); tokens/Kalam/Paper panels/2px navy fields unchanged; no Figma texture swatch.
- **Tests (41 total, 3 files):** added `src/lib/alerts.test.ts` (9) — match inside radius, NO email outside radius, NO email for a different category, NO duplicate when the sweep runs again, plus owner/hidden/expired/past-event/whole-town. typecheck ✓, tests ✓ (41/41), build ✓ (`/alerts`, `/api/alerts`, `/api/cron/alerts` present).
- **Live verification (one dev server, :3001; `.env.local` loaded):**
  - `/api/alerts` unauthenticated → 401 (alerts need sign-in; public browsing unchanged). ✓
  - sweep with wrong secret → 401. ✓
  - sweep with the correct `CRON_SECRET` → **501 "RESEND_API_KEY is not configured"** — the guard fires before any email is attempted, so no email is sent to anyone. ✓
  - **BLOCKED (not done):** the full live email acceptance — create a test alert, publish a matching posting, confirm the email in Resend logs/test inbox, then publish a non-matching posting and confirm no email — because `RESEND_API_KEY` is absent. This is the one remaining Stage 2 acceptance item and it is blocked solely on that key.
- **To finish live verification:** add `RESEND_API_KEY` (and optionally `ALERTS_FROM_EMAIL`, `NEXT_PUBLIC_APP_URL`) to `.env.local`, apply `supabase/stage2_alerts.sql`, restart one server, then run the match/no-match email test.

## 2026-11-01 — Kiro — Stage 2 live email acceptance: PASSED

RESEND_API_KEY added to `.env.local` (present, len 36; never printed). `stage2_alerts.sql` applied by Max. One dev server only (:3200) after stopping/killing a stray `node` on :3000 and clearing an OneDrive `.next` EBUSY lock once.

- **From-address fix (env only, no code change):** the first live sweep returned `sent=0` with a single error — Resend rejected the default `alerts@corkback.app` From domain ("domain is not verified"). The code already reads `ALERTS_FROM_EMAIL`; added `ALERTS_FROM_EMAIL=onboarding@resend.dev` (Resend's sanctioned test sender) to `.env.local` and restarted one server. No application code changed.
- **Test method:** seeded a throwaway alert owner using Resend's safe recipient `delivered@resend.dev` (no real inbox) so no email went to a real user; the real account was the *poster* (owner ≠ poster → no self-notify). Alert = music / central London / 5 mi. Matching posting = music ~1 mi away. Non-matching posting = sports (wrong category), same location. Verified via the sweep result and the `sent_alerts` ledger (ground truth). Test data and the throwaway script were deleted after the run.
- **Results (live):**
  - Fresh sweep after clearing the ledger: **`sent=1, skipped=0, errcount=0`** — exactly one email accepted by Resend for the MATCH posting.
  - `sent_alerts` ledger: MATCH = 1 row, NOMATCH = 0 rows — the wrong-category posting produced no email.
  - Repeat sweep (no change): **`sent=0, skipped=1, errcount=0`** — no duplicate email; the already-sent pair was skipped.
- **Acceptance: PASSED** — create alert ✓, matching posting emails once ✓, non-matching posting sends nothing ✓, re-run sends no duplicate ✓. Email contains title/date/time/place + posting link; alert home point/radius and user email never included.
- **Final gates:** `npm run typecheck` ✓, `npm test` ✓ (41/41), `npm run build` ✓.
- **Note:** for production, verify a real sending domain in Resend and set `ALERTS_FROM_EMAIL` to an address on it (and `NEXT_PUBLIC_APP_URL` to the deployed URL for correct email links).

## 2026-11-01 — Kiro — Commit 74004f5 file audit (precondition for Stage 3)

Asked to name the "third file" in commit 74004f5. Verified with `git diff-tree --name-status -r 74004f5` and `git show --name-only`: the commit contains **exactly two files**, both modified — `BUILD_LOG.md` and `KIRO_USAGE_LOG.md`. There is no third file (no add/rename/delete, file count = 2). The earlier report naming only those two was accurate. No secret is involved because no other file exists in the commit. (The large multi-file Stage 2 code commit was the earlier 2f13bf1; `.env.local` is gitignored and was never committed.)

## 2026-11-01 — Kiro — Stage 3: private messaging (code complete; live blocked on migration)

Built messaging only. No promoted postings. No changes to alerts/scan/map/auth/profiles, no posting-table changes, public replies untouched, no Like on messages/replies, Follow/Connect untouched, no group threads/attachments/email notices.

- **Schema (`supabase/stage3_messaging.sql`, additive/idempotent):** `message_threads` (1:1, ordered pair `user_lo < user_hi`, optional `posting_id`, unique per pair+posting) and `messages` (thread_id, sender_id, body). RLS is PARTICIPANT-ONLY: a user may read/insert a thread or its messages only if they are one of the two participants; messages immutable (no update/delete/Like); a third user has no grant → denied by default.
- **Domain (`src/lib/messaging.ts`, pure/tested):** orderedPair, isParticipant, counterpart, canAccessThread, validateMessageBody.
- **API:** `POST/GET /api/messages` (start-or-find thread + send; fetch thread messages), `POST /api/messages/reply` (reply by threadId, participant-checked), `GET /api/messages/threads` (inbox list, own threads only). Recipient resolved by username so user ids stay off the public posting page.
- **UI:** `MessagePoster` on the posting page (signed-in only, hidden on own posting, message text never shown on the page/board); `/inbox` (own threads only) and `/inbox/[id]` (thread + reply, non-participant → notFound).
- **Checks:** `npm run typecheck` ✓, `npm test` ✓ (50/50 — added 9 messaging tests: participant-only access, third user blocked, public browsing unchanged, pairing, body validation), `npm run build` ✓ (fixed a react-hooks/exhaustive-deps warning in ThreadView; one transient OneDrive `.next` lock cleared by removing `.next`).
- **LIVE VERIFICATION BLOCKED:** `stage3_messaging.sql` is NOT yet applied — the `message_threads`/`messages` tables do not exist (confirmed via the service role). I cannot run DDL with the REST service-role key, and there is no direct Postgres URL in `.env.local`. The two-account send/reply + third-user-blocked live test needs the migration applied in the Supabase SQL editor (same as Stage 1/2 migrations).
- **NOT COMMITTED** — per the rule "commit only if all checks pass," the required live verification is incomplete, so no Stage 3 commit was made. Code is staged-ready and awaiting the migration + live test.
- **To finish:** apply `supabase/stage3_messaging.sql` in Supabase, then run the live two-account test on one dev server, then commit.

## 2026-11-01 — Kiro — Stage 3 live verification: PASSED

Migration `stage3_messaging.sql` applied (tables `message_threads` + `messages` confirmed present via service role). One dev server only (:3200); `.next` cleared first; no other server running.

- **Scenario (3 real accounts A/B/C, driven through the running API with real @supabase/ssr auth cookies):**
  - Account A posted a posting.
  - Account B sent a private message from that posting page → `200`, thread created.
  - Account A read the thread (saw B's message) and replied in the inbox → both `200`.
  - Account B re-read → saw both messages (count 2). Both A and B inboxes contain the thread.
  - **Third account C blocked:** reading the thread returned 0 messages (RLS hides), replying returned **403**, and C's inbox did **not** contain the thread.
  - **Public browsing unchanged:** the posting page loaded (200) for an unauthenticated request and contained **no message text** (checked for both the message and the reply strings).
  - Result object: `{b_send:200, a_read:200/1, a_reply:200, b_read:200/2, c_sees:0, c_reply:403, c_inbox_has_thread:false, a_inbox:true, b_inbox:true, public_has_message_text:false}`.
- **Test-harness fix (one fix, not app code):** the first run returned 401 on every call because the harness built the wrong auth-cookie format. Fixed to the `@supabase/ssr` format (`sb-<ref>-auth-token = base64-<base64(session JSON)>`); re-run passed. No application code changed for this.
- **Cleanup:** removed 3 test users (+ profiles), their thread and messages, and A's posting. Independent recount: residual test postings 0, test profiles 0, test auth users 0; total threads 0, total messages 0. Throwaway harness deleted.
- **Gates after the only code change this stage (the ThreadView exhaustive-deps warning fix from the build step):** `npm run typecheck` ✓, `npm test` ✓ (50/50), `npm run build` ✓ (no warnings).

## 2026-11-01 — Kiro — Stage 4: promoted postings (label + placement only)

Built promotion only. No polish/seed/demo/writeup, no other feature. No changes to messaging/alerts/scan/map/auth/profiles, no messaging-table/alert-sweep/scan-route changes. No payment, Stripe, checkout, billing, or price — label + placement only.

- **Schema:** NONE needed. The `postings` table already has `is_promoted boolean not null default false` (added day-one in Stage 1, confirmed present live). No `stage4_promoted.sql` written. Used the existing field.
- **Ownership:** `POST /api/postings/promote` sets/clears `is_promoted` on the caller's OWN live posting only. A non-owner is blocked (RLS `postings author update` + explicit 403). Refuses to promote a deleted or expired posting.
- **Lifetime:** promotion is effective only while the posting is live — `listActivePostings` only returns active (non-expired, non-deleted, event-not-past) postings, so an expired/deleted posting never appears promoted. `isEffectivelyPromoted(flag, active)` encodes this.
- **Placement:** `src/lib/promotion.ts` `orderWithPromoted` does a STABLE, group-local sort — within each (area, category) group a promoted posting sorts ahead of ordinary peers; group order and ordinary relative order are otherwise unchanged. Area = coarse ~0.1° bucket so a promoted posting does not leapfrog a different area or category. Applied in `listActivePostings` (both the Supabase and seed paths).
- **Label (public, no account):** already shown on the board rail and map-list card (`PostingCard`) and on the posting page (`/p/[id]`) — both render server-side with no auth gate.
- **Owner control UI:** `PromoteToggle` on the posting page, shown only to the owner (`isOwnPosting`), deep-navy action + neutral removal — existing tokens only, no new color, no texture swatch.
- **No alert effect:** promotion does not call the alert sweep or change matching; the alert sweep and `src/lib/alerts.ts` are untouched. A test asserts promotion alone produces no alert email (match logic ignores `is_promoted`).
- **Tests (57 total, 5 files):** added `src/lib/promotion.test.ts` (7) — promoted first in same area+category, ordinary order unchanged, no leapfrog across category, no leapfrog across area, group-local promotion, promotion effective only while live (expiry ends it), area bucketing. `npm run typecheck` ✓, `npm test` ✓ (57/57), `npm run build` ✓ (no warnings).
- **Live verification (one dev server :3200; .next cleared; no other server):** two accounts A/B, ordinary posting created BEFORE the promoted one so default order would rank it first.
  - B (non-owner) promote attempt → **403**. A (owner) promote → **200**; `is_promoted` true on the promoted posting, false on the ordinary.
  - Public home (signed OUT): 200, **Promoted label present**, promoted posting appears **before** the ordinary one (`promo_before_ordinary_public=true`).
  - Posting page (signed out): promoted page has the label, ordinary page has **no** label.
  - B signed-IN home: label present, promoted-before-ordinary true (same server-rendered list).
  - Owner A removed promotion → 200, `is_promoted` back to false.
  - Cleanup: 2 test users + profiles + both postings removed; independent recount residual postings/profiles/authUsers all 0. Throwaway harness deleted.

## 2026-11-01 — Kiro — Stage 5: polish, seed, deploy prep, demo + writeup prep

No new feature. Polish fixes only where the sweep found a problem; existing tokens only; no new color; no Figma texture swatch.

- **Sweep findings + fixes:**
  - Dead "Share" controls (posting-page header + PostingActions row) had no handler → replaced with a working `ShareButton` (Web Share API, clipboard copy fallback). Existing tokens (navy link / neutral button).
  - Dead "Report" control on the posting-page header → removed (no report feature exists; it was a broken promise).
  - Dead home search input ("Search any town worldwide" with no behavior) → removed (building search would be a new feature, out of scope).
  - Seed placeholder URL `https://example.com/quiet-sounds` → nulled (no real link supplied; shipping a fake link avoided).
  - No placeholder text/TODOs, no broken links, and no static mobile-layout break found. Deferred-feature placeholders (`/following`, `/friends`, disabled Follow/Connect) are honestly labeled and kept — not dead buttons.
- **Verification after fixes:** `npm run typecheck` ✓, `npm test` ✓ (57/57), `npm run build` ✓ (no warnings).
- **Deploy to Vercel — BLOCKED (not linked).** No `.vercel/` dir, no `project.json`, and the Vercel CLI is not installed/authenticated on this machine. Per instruction I stopped rather than guess. Steps for Max are in the report and WRITEUP_DRAFT. `NEXT_PUBLIC_APP_URL` must be set to the live URL after linking; the live device checks (Part 3) depend on the deploy and were therefore deferred.
- **Resend production note:** a VERIFIED Resend sending domain is still required for production alert emails; `onboarding@resend.dev` was testing-only.
- **Seed:** kept the 3 real SAMPLE postings modeled on the Figma examples (London music, Berlin lost-and-found, Mexico City community) — content already in the seed, no invented businesses/people/contact details, no placeholder URLs. Adding real campus-board postings requires Max to supply real flyer content. Seed count = 3. No test data is shipped in the app (test users/postings from prior live runs were removed).
- **Demo plan:** `DEMO_PLAN.md` — a shot list under 3:00 covering scan end-to-end + map + alerts + messaging + promoted label. Not recorded.
- **Writeup draft:** `WRITEUP_DRAFT.md` — built from KIRO_USAGE_LOG.md; names each Kiro feature used; names ChatGPT discrete help (scan fix) and states Kilo was not used; states Figma design existed before the window and app code inside it; names Resurrection + Best Student Project. The exact Gemini model id verified/used (`gemini-3.5-flash-lite`) is named in this log.
- **Repo check:** prepared (not pushed) — see the report for the staged list and the confirmations (.env.local/node_modules/.next excluded; .kiro + LICENSE included; no key in any staged file; no test flyer in the repo; build log names the model id).

## 2026-11-01 — Kiro — Stage 5 live-findings fixes (live URL: https://corkback.vercel.app)

No new feature, no search built. Fixes verified on the local build against the LIVE database (same Supabase as prod); the deployed site still runs the prior build because Vercel is not linked here (cannot redeploy) — the fixes are committed and ready to deploy.

1. **Writeup:** removed every Kilo mention from WRITEUP_DRAFT.md (Kilo did nothing; no Kilo code in repo). Kept the ChatGPT note (one discrete scan fix). Kiro remains main builder.
2. **Heading:** home map heading was hardcoded "Near you, London" → now derived from the real posting's place ("Near Riverside Park Courts - 120 Park Ave"), matching the map center (which already centers on the first posting). No posting/business/person invented; no seed cities loaded into the live DB (live DB correctly has exactly one real Berkeley posting by mculbeaux).
3. **Empty card:** root cause was the single tilted `Card` (rotate -5.8°) having no vertical clearance, so its rotated top corner overlapped the map above it and read as an empty white wedge (the heart+0 was its own footer). Fix: tilted cards get `my-3` clearance and the rail's top padding bumped to `pt-8`. Live HTML confirms exactly ONE fully-populated card renders — there was never a second/empty card in the DOM.
4. **Posting page (investigated first):** the one real posting has `event_date = null`, `flyer_url = null`, `rsvp_url = null` in the data — so date, flyer, and RSVP are **genuinely absent, not a render bug**; time and place are present and render. Reported plainly; invented nothing. Separately fixed a real rendering GAP: the page never rendered `flyerUrl` at all — added a guarded `<img>` so a posting that HAS a flyer now shows it. Date already renders when present.
5. **Inbox nav:** added a Messages link (`/inbox`, message-circle icon) to BottomNav. Signed-in user reaches the inbox; signed-out visitor still sees the sign-in gate (verified: gate present signed-out, absent signed-in).
6. **Follow/Connect:** investigated — there is NO follow/connect API or working UI anywhere (only the day-one `follows`/`connections` tables exist); the feature was never built in earlier stages. Building it now would be a new feature (forbidden). So I did not build it; instead removed the disabled dead buttons and the misleading "ships in a later stage" note (a false promise), replacing with a plain "Follow and Connect are not part of this release" on both the profile and posting pages.
7. **Signed-in live check (local build + live DB, one dev server):** home 200 with Messages nav + Promoted label; signed-in inbox has no gate; signed-out inbox gated. Two throwaway test accounts + one promoted test posting created and then fully removed — residual test postings/profiles/auth users all 0; the one real Berkeley posting intact. (Phone/desktop check against the deployed URL is pending a redeploy, since the live site predates these fixes.)
8. **Scan model:** code uses `gemini-3.5-flash-lite` (matches the build log). One live scan on the DEPLOYED app (https://corkback.vercel.app/api/scan/extract) returned HTTP 200 with title, date (2026-11-15), time (09:00), and place (CENTER STREET, BERKELEY CA). ✓
- **Env note during runs:** cleared a OneDrive `.next` EBUSY lock once (environment issue, not a code defect); restarted one server.
- **Gates:** typecheck ✓, tests ✓ (57/57), build ✓, no warnings.

## 2026-11-03 — Kiro — Signed-in defects fixed + deployed (live: https://corkback.vercel.app)

Fixed the five Nov-3 signed-in defects, deployed to production, and verified each on the live site. No test data left behind.

**Files changed**
- `src/app/api/auth/sign-up/route.ts` — create the profiles row with the service-role admin client at sign-up (works with email confirmation on, when the new user has no session so an RLS insert would be blocked); pass `username` as auth metadata; set `emailRedirectTo` to NEXT_PUBLIC_APP_URL / request origin (live URL).
- `src/lib/supabase/server.ts` — added `createAdminClient()` (service-role, server-only).
- `supabase/stage5_profile_trigger.sql` — NEW: `handle_new_user()` trigger on auth.users as a defense-in-depth backstop + backfill (optional; the route fix already works without it). Could not be applied from here (DDL needs the SQL editor); the route's admin insert makes it non-blocking.
- `src/app/u/[username]/page.tsx` — query `profiles` by username; `notFound()` when absent; show the real username + the user's active postings.
- `src/app/not-found.tsx` — NEW: themed 404 for unknown routes / notFound() (e.g. unknown username).
- `src/lib/postings.ts` — added `getProfileByUsername()` and `listPostingsByUsername()`.
- `src/app/scan/page.tsx` — added an "Enter posting details manually" link to the working review form; capture/choose already surface clear errors.
- `src/app/scan/review/page.tsx` — copy now covers scan AND manual entry.
- `src/components/ui/TopBar.tsx` — now async; renders `AuthControl` by default so every page shows session state.
- `src/components/ui/AuthControl.tsx` — NEW: signed-in profile chip + working Sign out; signed-out Sign in.
- `src/app/api/auth/sign-out/route.ts` — NEW: sign-out endpoint.
- `src/app/page.tsx` — dropped the custom header `right` (TopBar handles it).

**Data remediation (live):** 2 orphaned auth users from the Nov-3 failed sign-ups had no profile row — backfilled derived `user_xxxx` usernames via the admin client. After: 3 auth users, 0 missing profiles. The real `mculbeaux` account untouched.

**Live verification (deployed site, each fix):**
1. Sign-up via the deployed `/api/auth/sign-up`: 200, auth user created, **profile row created with matching username**, sign-in works, and **alert save → 200** (alerts.user_id FK no longer fails).
2. Nonexistent username `/u/nobody_xyz_404` → **404** (themed not-found); real profile `/u/mculbeaux` → 200 with handle; a throwaway user's posting showed on their profile.
3. `/scan` links to the manual form; `/scan/review` (signed-in) → 200, not the gate, shows "Make the details clear" + manual hint (the form is a client component).
4. Signed-out header shows **Sign in** (no Sign out); signed-in header shows **Sign out** on every page.
5. Vercel `NEXT_PUBLIC_APP_URL` confirmed = the live URL (not localhost); the sign-up route uses it for `emailRedirectTo`. NOTE: the email link base also depends on Supabase dashboard **Site URL / allowed redirect URLs** — set those to `https://corkback.vercel.app` if not already (dashboard setting, not in code).

**Note on current data:** the real "Community Pickleball Social" posting is expired (expires_at 2026-11-02) and soft-deleted, so the live home/profile correctly show no active postings right now — not a regression. The profile-shows-postings path was verified with a throwaway active posting, then cleaned up.

**Cleanup:** all throwaway verification users/postings/alerts removed; independent recount = 0 residual; harnesses deleted.

**Gates:** `npm run typecheck` ✓, `npm test` ✓ (57/57), `npm run build` ✓. Deployed to production (aliased to corkback.vercel.app).

## 2026-11-03 — Kiro — Home map location + full 10-category list (live: https://corkback.vercel.app)

Edited the existing app only. Theme, colors, fonts, account model, and scan flow unchanged. No live postings added for the new categories (only category rows).

**1. Home map — local-first (`src/components/map/HomeMap.tsx` NEW; `src/app/page.tsx`; `src/lib/auth.ts`).**
- Centering order on load: (1) saved town/center in localStorage → center there; else (2) `navigator.geolocation.getCurrentPosition` — allowed → fly to location at street zoom (15), show a **Near me** button that returns to that location, and save the center; denied/unavailable/timeout (8s) → (3) the signed-in user's alert home town (`getViewerHomePoint()`), else (4) **Berkeley** (37.8715, -122.273). Never blocks browsing.
- **Town search box above the map** → OSM Nominatim geocode → `flyTo` + save the town in localStorage.
- The **world map is now a secondary "Explore the world" section** (reuses the existing `MapView`), not the starting view.
- Exact user location is used only to center the map (and saved to localStorage client-side); it is never rendered as public text and never attached to a posting. Confirmed no `latitude`/`longitude`/`getCurrentPosition` strings in server HTML.
- Scan a flyer stays dark red; Set an alert stays deep navy.

**2. Categories — full 10 (`src/lib/categories.ts`; `supabase/stage5_categories.sql`).**
- List, in order: Music, Nightlife, Sports, Social Clubs, Lost and Found, Housing and Real Estate, Jobs, Sales, Classes, Community. No duplicates. Merges reflected: old Clubs + Meetup → Social Clubs; Sale → Sales.
- `src/lib/categories.ts` is the single source for all four surfaces (home filter, scan review, alert choice, posting display). Added category rows to the DB via admin upsert (new slugs: nightlife, social-clubs, housing, jobs; relabel sale→Sales, lost-found→"Lost and Found"). Legacy `clubs`/`meetup` rows kept for FK safety but not shown; no live posting uses them.
- Added a **category filter** to the home page (in HomeMap) that filters both pins and the rail.

**Verification.**
- Build gates: typecheck ✓, tests ✓ (57/57), build ✓, no warnings. Deployed to production (aliased corkback.vercel.app).
- Categories: all 10 present in the home filter (live), and in scan review + alerts (verified via a signed-in throwaway user — both pages 200, not gated, all 10 labels in each page bundle; user removed, 0 residual). Posting display uses the same source. No old "Meetup"/"Lost & Found" chips remain.
- Map: OSM geocoder resolves Berkeley (37.871,-122.273 = the fallback) and another town (Portland, Oregon 45.520,-122.674). Saved center/town persists across reload (localStorage key `corkback.mapCenter`, read first on load). Location allowed → street zoom + Near me + save; denied/timeout → alert-home-town-or-Berkeley fallback, non-blocking. (Browser permission allow/deny is client-side; logic implemented and structurally verified; the geocode + fallback constants verified against live data.)
- No exact user location shown publicly.
- No test data left behind.

## 2026-11-03 — Kiro — "Use my location" button on the home map (live: https://corkback.vercel.app)

Edited the existing app only (`src/components/map/HomeMap.tsx`). Theme, colors, fonts, account model, and scan flow unchanged.

- Added a **Use my location** button directly under the town search box, **left aligned**, styled like a category chip (white with a 2px navy border; `border-2 border-deep-navy bg-white text-deep-navy`).
- On tap: asks the browser for location **once** (`getCurrentPosition`). On allow → center the map at **street level** (zoom 15), **save that center** in localStorage (`corkback.mapCenter`), and set the line under the map to **"Showing near you"**.
- On deny / unavailable / timeout → **stay on Berkeley** (the map is not moved) and never block browsing; a non-blocking note is shown.
- **Requirement 5:** the user's location is kept in `myLocationRef`, so after a town search, tapping **Use my location returns the map to the saved user location** (street zoom, re-saved) without re-prompting. If no prior fix exists, it requests one.
- Privacy: the exact location is used only to center the map and is saved only to localStorage (client-side). It is **never shown publicly** and **no pin is added for the user** (pins are drawn only for postings).
- Verification: typecheck ✓, tests ✓ (57/57), build ✓, no warnings. Button present with chip styling on the live site; no user coordinates / "Showing near you" leak in server HTML (set only after a client tap). Allow/deny and return-after-search are client geolocation interactions, implemented as specified and verified by code + the live render.

## 2026-11-03 — Kiro — "Use my location": fresh high-accuracy fix each tap (live: https://corkback.vercel.app)

Edited `src/components/map/HomeMap.tsx` only. Theme, colors, fonts, account model, and scan flow unchanged.

- **Fresh fix every tap:** removed the "reuse saved center / myLocationRef shortcut" on tap; each tap now calls geolocation with `enableHighAccuracy: true, timeout: 10000, maximumAge: 0`. The saved center is never used on tap.
- **Accuracy refinement:** uses `watchPosition` with a 10 s cap. The first reading ≤ 50 m stops sampling immediately; if the first reading is coarser than 50 m it keeps sampling for up to 10 s and uses the reading with the lowest accuracy number (smallest metres).
- **Zoom + note:** centers on the best fix — accuracy ≤ 30 m → zoom 17; > 30 m → zoom 15 and a small note "Location is approximate." Sets the under-map line to "Showing near you."
- **Save:** clears the old saved center (`localStorage.removeItem`) before saving ONLY the best reading.
- **Deny / unavailable / timeout:** stays on Berkeley (map not moved), shows a non-blocking note, never blocks browsing.
- **Privacy unchanged:** exact location used only to center the map, saved only on the device, never shown publicly, no pin added for the user.
- Verification: typecheck ✓, tests ✓ (57/57), build ✓, no warnings. Button live on production (200). The multi-sample accuracy flow and the phone-outdoors "move and re-tap recenters" behavior are real-device geolocation interactions, implemented as specified and verified by code + the live render.

## 2026-11-03 — Kiro — Viewer location dot on the home map (live: https://corkback.vercel.app)

Edited `src/components/map/HomeMap.tsx` only. Theme, colors, fonts, account model, and scan flow unchanged.

- **Viewer dot:** when the map is "showing near you", draw one small **navy dot (#1F2E4D) with a white ring** at the viewer location (a MapLibre `div` marker). Drawn from the same client-side location used to center the map.
- **Browser-only / private:** the dot is created client-side only; it is never sent to the server, never saved as a posting, and never shown to any other user.
- **Hide/show rules:** a town search hides the dot and its circle (`hideViewerDot()` in `searchTown`); it reappears only when **Use my location** is tapped (and on the on-load allowed path, which is also "showing near you"). The floating "Near me" recenter does not redraw it.
- **Posting pins unchanged:** postings remain dark-red teardrop pins (#8C2B1F); the viewer dot is navy, so it can never look like a posting.
- **Accuracy circle:** when accuracy > 30 m, the "Location is approximate." note stays and a **soft navy fill circle** (GeoJSON polygon sized to the accuracy in metres, 12% opacity) is drawn around the dot so the uncertainty is visible; ≤ 30 m draws no circle.
- Cleanup: the viewer marker is removed on unmount.
- Verification: typecheck ✓, tests ✓ (57/57), build ✓, no warnings. Live on production (200), button present; no coordinates/notes in server HTML (the dot + notes are client-only). The dot render, its hide-on-search / show-on-tap behaviour, and the accuracy circle are real-device geolocation interactions, implemented as specified and verified by code + the live render.

## 2026-11-03 — Kiro — Password reset flow (live: https://corkback.vercel.app)

Fixed the broken "forgot password" (it had no reset page and sent no email). Theme, colors, and account model unchanged.

**Files added/changed**
- `src/app/sign-in/page.tsx` — added a "Forgot password?" link → `/forgot-password`.
- `src/app/forgot-password/page.tsx` + `ForgotPasswordForm.tsx` — NEW. Email field → Supabase `resetPasswordForEmail(email, { redirectTo })` with `redirectTo = <NEXT_PUBLIC_APP_URL or origin>/auth/reset-password` (i.e. `https://corkback.vercel.app/auth/reset-password` in prod). On submit shows **"Check your email"** and does NOT loop back to sign-in.
- `src/app/auth/reset-password/page.tsx` + `ResetPasswordForm.tsx` — NEW. On mount, exchanges the PKCE `code` from the email link via `exchangeCodeForSession` (with a `getSession()` fallback), then lets the user set a new password via `updateUser({ password })`, signs out of the recovery session, and points them to sign in. Invalid/expired link shows a clear "request a new link" state.

**Redirect URL check (item 5):** `NEXT_PUBLIC_APP_URL` is the live URL (not localhost). Verified via the admin `generateLink({ type: recovery, redirectTo })` that the recovery link's effective `redirect_to` is exactly `https://corkback.vercel.app/auth/reset-password` — Supabase honored it, so the live URL is in the allowed redirect list (a non-allowed URL would be rewritten to the Site URL). `@supabase/ssr` browser client is `flowType: "pkce"`, so the link carries `?code=` which the reset page exchanges.

**Verification (item 6):** typecheck ✓, build ✓ (routes `/forgot-password` and `/auth/reset-password` present), tests ✓ (57/57). Live reset test with a throwaway account: recovery link redirect = live reset page; set a new password; **sign-in with the NEW password succeeds and the OLD password is rejected**. (The PKCE code exchange is browser-only — the verifier is set on the forgot page and read on the reset page in the same browser; the headless harness proved the redirect target + password-change + sign-in, which is everything except the browser-held verifier step.) Live pages confirmed: sign-in has the Forgot link; `/forgot-password` serves the email form; `/auth/reset-password` serves the set-password page. Test user removed (0 residual).

## 2026-11-06 — Kiro — Password-reset fix: recovery links landed on the homepage (live: https://corkback.vercel.app)

Spec: `.kiro/specs/password-reset/` (requirements, design, tasks). Theme, colors, fonts, account model, and existing data unchanged.

**Root cause (confirmed in a real browser on production).** The production Vercel env `NEXT_PUBLIC_APP_URL` is `http://corkback.vercel.app` (**http**). The forgot form sent `redirect_to=http://corkback.vercel.app/auth/reset-password`. Supabase only honours allow-listed URLs and silently falls back to the **Site URL** (`https://corkback.vercel.app/`, the homepage). The homepage ignored the credentials, so users saw the board. Probes also showed that any non-canonical origin (such as a Vercel deployment URL) falls back the same way. My previous turn's check had read only the redirect parameter inside the link, not the actual destination, and looked for the https string only, so it missed this.

**Fixes (commits 49ed62a, eb59272, 4c1434f):**
- `src/lib/appUrl.ts` (new): `normalizeAppUrl`/`getAppUrl` force https and a bare origin for non-local hosts; `safeNextPath` blocks open redirects.
- `src/lib/authRecovery.ts` (new): recovery detection. Live finding: this project records recovery sessions as `amr: ["otp"]` (not `recovery`), so the auth routes set a 15-minute `cb_recovery` cookie; a bare `?code` counts as recovery when `recovery_sent_at` is within the last hour.
- `src/app/auth/callback/route.ts` (new): server PKCE `exchangeCodeForSession` with the public anon client.
- `src/app/auth/confirm/route.ts` (new): server `verifyOtp` for `token_hash` links (works cross-device).
- `src/app/page.tsx` + `src/components/auth/AuthHashForwarder.tsx` (new): Site URL fallback. The homepage forwards `?code`, `?token_hash`, `#access_token`, and `#error_code` into the flow.
- `src/app/auth/reset-password/ResetPasswordForm.tsx`: handles every credential form; form only for recovery sessions; New/Confirm password, 8-character minimum with guidance, loading state, mismatch/reuse errors; expired, invalid, other-browser, and already-signed-in states with "Send a new reset email"; success clears the marker, signs out, and links to sign-in.
- `src/app/forgot-password/ForgotPasswordForm.tsx`: canonical https `redirectTo`; friendly rate-limit message.
- `src/app/sign-in/page.tsx`: explains link errors forwarded from the auth routes.
- `src/app/api/auth/sign-up/route.ts`: confirmation redirect also normalized (it had the same http defect).
- `src/lib/authRecovery.test.ts` (new): 12 tests (recovery detection, recent recovery, https normalization, open-redirect guard).
- No `console.*` calls; no service-role key in any flow code (it was used only by throwaway test scripts to create and delete test users).

**Checks.** Clean-worktree builds (to exclude another session's uncommitted posting/scan work): typecheck ✓, tests 69/69 ✓, build ✓; deployed `4c1434f`. Browser E2E in real Edge against production:
- Build eb59272: **real recovery email received; its actual link opened the new-password form**; mismatch and 8-character errors shown; refresh kept the form; update succeeded; new password signed in through the real form; old password rejected.
- Build 4c1434f: the deployed form sends `redirect_to=https://corkback.vercel.app/auth/reset-password` (captured in the browser). Minted recovery links (Site URL fallback, a Vercel deployment URL, the default `/verify` link, `token_hash`) all open the form with no tokens left in the URL. The reported-bug path (link → homepage) completed a password change and the new password signed in. A reused link shows "This link has expired" with "Send a new reset email". A direct visit is explained; a signed-in non-recovering user is not offered the form; ordinary sign-in works (HTTP 200).
- **Not yet verified on 4c1434f: a fresh real email.** Supabase returned HTTP 429 (email rate limit) after repeated test sends; the form showed the correct "wait a minute" message.
- Cleanup: 0 residual test users; all accounts have profiles; real accounts untouched. One unrelated yopmail account created 2026-11-06 02:59 UTC was not created by these tests and was left alone.

**Needs Max:** set the Vercel `NEXT_PUBLIC_APP_URL` to `https://corkback.vercel.app` and redeploy; confirm the Supabase Site URL and Redirect URLs; optionally switch to the token_hash template; run one real reset email on the live site.

## Nov 8: social features, planning only (2026-11-08)

Spec: `.kiro/specs/social/` (requirements, design, tasks). No code changed yet; waiting for Max's approval before Stage 1.

**Findings from inspection (code, schema/RLS, read-only live DB probe):**
- Like and Going/Interested lose their state on refresh because `src/components/ui/PostingActions.tsx` keeps them in React state only. Nothing in `src` writes to `likes`, `plans`, `follows`, or `connections`, and the live tables have 0 rows each.
- The ended posting (ffe92f35) still offers Going because its `event_date` is 2024-11-16 and `getPosting` filters only `deleted_at`, not expiry. `effectiveTakedown` also uses the server timezone (UTC). Publishing accepts past event dates.
- RLS gaps: `connections` has no DELETE policy, and its UPDATE policy lets the requester accept their own request. `likes` and `plans` are publicly readable.
- Following and Friends are placeholder pages. The Scan back-link reads "Scan a flyer" but goes to `/`.
- Message composer: the code navigates to the thread on success. The reported "no confirmation" bug is not reproduced yet; that's scheduled for Stage 4.

**Plan:** 4 stages (likes/plans/expiry → follow → friends → messaging). One additive migration `supabase/stage6_social.sql`, which Max applies part by part in the Supabase SQL editor.

## Nov 8: Stage 1 migration review package (2026-11-08)

Nothing applied or deployed yet. These files are waiting for Max's review.
- **Migration:** `supabase/stage6_social_part1.sql`.
- **Pre/post checks:** `_preflight`, `_verify_admin` (catalog and functions only), `_verify_roles` (anon/authenticated, using three disposable accounts the script creates and removes).
- **Rollback:** `_rollback`, labeled as restoring the old public reads.
- **Connections lock:** part 1 now closes connections writes until part 3. The existing insert and update policies allowed self-accepted friendships and re-pointing a row at a third user.
- **Time zones:** the app no longer looks up a zone from the pin at read time. The app and the database both use only the stored zone, falling back to UTC−12.
- **Cron:** the deployed expiry cron soft-deleted posting ae1d5b7a at 2026-11-03 17:58 UTC. It will delete ffe92f35 on its next run, 2026-11-09 between 17:00 and 17:59 UTC on the Hobby plan.
- **Hotfix:** prepared on branch `hotfix/cron-read-only`, based on deployed commit 4c1434f, with one file changed. It passes typecheck, 74 tests, and build. A local run returned 401/401/200 with `deleted: 0`, and ffe92f35 was unchanged afterwards. Not deployed.
- **Main tree:** typecheck passes, 121/121 tests.

## Nov 8: cron-only hotfix deployed to production (2026-11-08)

Max approved deploying only the read-only expiry route.
- **Pre-check:** production was `dpl_3ubwPnJcWNoH17bPstnw4gAtukVG`, with `gitCommitSha` 4c1434f. All of its deployed source files were byte-identical to 4c1434f. The only difference was the untracked build cache `tsconfig.tsbuildinfo`. Nothing newer existed to preserve.
- **Commit:** `e1b99f45b31139cc7844764030d1ea48d422beca` on `hotfix/cron-read-only`, based on 4c1434f. It changes `src/app/api/cron/expire/route.ts` (read-only count, no soft-delete) and adds `route.test.ts`.
- **Deployment:** `dpl_3sds7ZQP5FdhEysgMt31ZJe9tp6N`, at https://cork-back-hy29ky8eo-max-082a.vercel.app, aliased to https://corkback.vercel.app. The API reports `gitCommitSha` e1b99f45. Its file tree differs from the previous deployment only in route.ts (hash matches the hotfix file), the added route.test.ts, and the dropped tsbuildinfo.
- **Live checks:**
  - No header: 401. Wrong secret: 401. Both visible in the request logs.
  - `vercel crons run /api/cron/expire` at 22:12:07 UTC: user agent `vercel-cron/1.0`, HTTP 200.
  - Posting rows before and after were identical; ffe92f35 still has `deleted_at = null`.
- **Not included:** Stage 1 and d63b8d8. The main branch doesn't contain e1b99f45 yet. The main tree's uncommitted route.ts is identical, so Stage 1 includes the same change.

## Nov 8: Stage 1 browser verification and preview (2026-11-08)

- **Migration:** Max applied part 1. verify_admin passed 23/23 (plus 2 info rows) and verify_roles 27/27, with zero residue and totals matching the baseline.
- **Preview:** https://cork-back-l4atti1nw-max-082a.vercel.app (`dpl_Fxb4ui2tP7hyFxmT9Bz5E5XrrQyt`, target preview).
  - Built from a clean export of the working tree (tracked plus untracked, gitignored files excluded).
  - Includes the cron hotfix byte for byte, and the deployed files match the tested export (136 of 136).
  - Only `NEXT_PUBLIC_SUPABASE_URL` and the anon key were passed, for this deployment only. Project env vars and settings are unchanged, and no service-role key went to the preview.
  - Deployment Protection is on for previews and no bypass secret exists, so the preview needs a Vercel login.
- **Checks:** typecheck, lint, 121/121 tests, production build.
- **Browser verification:** real Edge, two separate contexts, disposable accounts `cbsoc_a_571667` and `cbsoc_b_571667`, run against a local `next start` of the same source and the live database.
  - Main suite: 40/40 checks.
  - Covered: publish (past date rejected, zone stored), year-less confirmation (UI and server), accessible names, like and plan persistence across refresh and sign-out/sign-in, switch/clear, cross-session totals, network, 500 and expired-session failure with rollback, ended posting (no controls, 409, no writes, off the map and profile, messaging kept), 390 and 1280 layouts, Scan back link, and @testing read-only on ffe92f35 (zero like/plan requests).
  - Rapid clicks: the first rapid-click check failed because Playwright queues clicks, and the diagnosis showed the app was behaving correctly. A replacement test dispatching the clicks synchronously passed 4/4: each burst sent one request and produced at most one row.
- **Finding:** the `on_auth_user_created` trigger is not active in the database (the profiles weren't created automatically). The sign-up route creates profiles itself, so the app works. The test setup did the same.
- **Cleanup:** 3 [TEST] postings and 2 users deleted. Residue is zero in every table. Totals: postings 2, profiles 5, likes/plans/connections/follows 0. ffe92f35 is unchanged.

## Nov 8: Stage 2, Following (2026-11-08)

- **Git:** created `feature/social` from main d63b8d8 and merged `hotfix/cron-read-only` with `--no-ff` (merge 4e0f563), so deployed commit e1b99f45 is preserved in the branch history. main and origin/main are unchanged; nothing was pushed. Stage 1 and Stage 2 work is still uncommitted on the branch. The hotfix branch and worktree are kept.
- **Database:** no change. The existing follows rules already prevent duplicates (PK) and self-follows (CHECK), and RLS only lets a user add or remove their own edges, with no UPDATE policy. `supabase/stage6_social_part2_check.sql` is a read-only confirmation and includes the profile-trigger state.
- **Code:**
  - `PUT /api/follows/[username]`, idempotent desired state.
  - `FollowButton` on profiles and the posting author section, replacing the placeholder copy.
  - `/following` with signed-out, error, empty, nothing-active and feed states, a loading state, and a "You follow" list.
  - Pure `followState` helpers with property tests.
  - `PostingCardGrid`: a 1280 px screenshot showed a full-width tilted card covering the cork band and a heading; responsive columns fixed it, and a geometry check now asserts 0 overlaps at 390 and 1280 px.
- **Checks:** typecheck, lint, 126/126 unit tests, production build. REST permissions with real JWTs: 16/16. Two-session Edge suite: 40/40. Covered:
  - persistence across refresh and sign-out/sign-in
  - feed content and the empty, nothing-active and loading states
  - self-follow and API validation
  - rapid clicks (1 request) and failure rollbacks
  - one-way follows, with no connection rows created
- **Preview:** https://cork-back-kpbs8gt2g-max-082a.vercel.app (`dpl_8SJHk17KK4ngCWjHCCbgXKJipCjk`). It is byte-identical to the tested source (143/143) and protected; it was not browser-tested directly.
- **Cleanup:** 3 [TEST] postings and 3 accounts deleted. Residue is zero, totals match baseline, and ffe92f35 is unchanged. An empty `%TEMP%\cb_s2` folder tree remains, locked by Windows; it has no files.
- **Profile trigger (recorded accurately):** auth users created via the admin API received no profile row, so the `on_auth_user_created` trigger is absent or not firing in this database. That's an observation, not a catalog confirmation; F5 in the part 2 check confirms it. The sign-up route creates profiles itself. Release gate: verify a normal sign-up creates exactly one usable profile, and don't apply `stage5_profile_trigger.sql` blindly.

## Nov 8: Stage 3, Friends (2026-11-08)

- **Git:** on `feature/social`, Stage 1 (f4cade7), Stage 2 (3f367db) and docs (b6174f9) were committed separately. The Stage 1 commit was built from Stage 1 versions of two mixed files and checked on its own: typecheck, lint, 121 tests, build. The cron hotfix merge 4e0f563 is preserved. Nothing pushed; main untouched.
- **Database:** Max applied part 3; its admin and role checks passed. What it enforces:
  - one row per pair of users in either direction
  - no self-requests
  - participants can't be changed (column grants)
  - only the recipient accepts
  - either participant can delete
  - friends see plans only on active postings; likes stay owner-only
- **Code:**
  - `POST /api/connections` (send/cancel/accept/decline/remove; idempotent; 409 incoming_exists/already_friends/state_changed).
  - `GET /api/users/search` (signed-in, prefix, `_` escaped, usernames only).
  - `/friends`: search, three lists, friends' plans, loading/empty/error/signed-out states.
  - `ConnectButton` on profiles, separate from Follow.
- **Checks:**
  - typecheck, lint, 132/132 unit tests, production build
  - REST with real JWTs: 21/21. Simultaneous A→B/B→A inserts always left exactly one pending row (10/10 rounds), and the requester and outsiders can't accept, change participants, read or delete.
  - Three-session Edge suite: 51/51.
- **Edge suite coverage:**
  - search validation, self excluded, literal underscore
  - send, cancel, decline and accept, persisting across refresh and sign-out/in
  - stale accept after cancel; simultaneous clicks from two sessions (3 rounds: one pending row, both UIs agree)
  - friends' plans on active postings only; likes stay private
  - follow independent both ways
  - unrelated C sees nothing
  - removal revoking on the next load, including a stale tab
  - rapid clicks (1 request); network, 500 and expired-session failures
  - signed-out states; 390/1280 layouts; loading state
- **Bug found and fixed:** on an expired session, the action hook refreshed into the signed-out view and the "sign in again" message disappeared. It now keeps the message and doesn't refresh on 401.
- **Cleanup:** disposable accounts and [TEST] postings deleted; zero residue; totals at baseline; ffe92f35 unchanged.

## 2026-11-11: Stage 8 implementation (branch `feature/moderation-ui`, from `origin/main` 6289a7e; not pushed)
- **Second SQL review addressed first** (files in `supabase/`, phase A since applied by Max: 30 catalog + 97 role checks passed):
  - replies only through `submit_reply` with a durable ledger and a per-user lock;
  - `posting_reaction_counts` no longer returns rows for hidden postings;
  - `admin_hide_posting` rejects a report id from another posting;
  - report / dismiss / hide share one lock order, so a report cannot be added after its posting is hidden or deleted;
  - tighter audit trigger, explicit rollback revokes.
  Isolated run 52/52 with a multi-session concurrency suite; seven deliberate regressions each fail it (one produced 17 deadlock errors).
- **Built:** reporting (panel, API, all states), `/admin` (queue, filters, details, dismiss/hide/restore, recent actions), public replies (composer, list, delete, limits), owner Edit/Delete (posting page, profile cards, ended and moderated postings), `PromoteToggle` through `set_posting_promoted`, the author's "hidden by moderators" notice, a neutral not-found for postings, alerts cron excluding hidden postings. Card Like/Unlike and the "Unlike" label were already on this branch.
- **Checks:** typecheck, lint, 188 unit tests, production build (outside OneDrive).
- **Verification against production phase A** (local production build, live database, disposable accounts, hidden state simulated with a service-role update on [TEST] postings):
  - REST/RLS with real JWTs: 24/24
  - browser: reporting 24/24, owner edit/delete/promote/Like label 27/27, replies 21/21, hidden surfaces and social regression 22/22
  - Stage 4 messaging 75/75 and card Likes 25/25 re-run
  - card overlap 0 at 390/768/1280 with owner controls
- **Admin dashboard:** 27/27 in a real browser against the real build with an **isolated** database (embedded Postgres + PostgREST behind a stub of the two Supabase endpoints). Not yet run on production: waiting for Max to grant the temporary admin.
- **Bugs found and fixed while building:** `/admin` with a `loading.tsx` answered a non-admin's not-found with 200 (removed); Report focus was lost after Escape/Cancel (trigger not mounted while open); a validation message renamed Send to "Try again"; two of my edits to the posting page were lost to a parallel-write race and caught by the suite.
- **Pre-existing, not fixed:** intermittent React #418 on signed-in page loads; reproduces on a build of `origin/main`.
- **Cleanup:** all disposable users and [TEST] data deleted; existing rows byte-identical (hash), totals at baseline, `ffe92f35` unchanged. Left: one disposable admin-test account (no admin rights yet).

## 2026-11-12: Card reactions, admin-test status, corrected release checklist (branch `feature/moderation-ui`, commit 0ae43bf; not pushed)
- **Built:** Like / Going / Interested on posting cards (home, Following, profiles) using the existing like and plan routes; harness in `scripts/card-e2e/`.
- **Verified (local production build + live database, disposable accounts, Edge):** 60/60 harness checks. Cleanup matched the baseline counts and hashes.
- **Preview:** https://cork-back-c5upfb720-max-082a.vercel.app (`dpl_7dJgowMeE8qBt2JJpVeGUEiCr55S`, source = 0ae43bf). It is built and protected (unauthenticated requests get 302). **No functional test was run on the preview.**
- **Temporary admin accounts (both gone):** `cbsoc_admin_f5d559` was deleted by something other than this work (not attributed). `cbsoc_admin_a5eb62` was created for the production admin test, granted and revoked by Max, then deleted.
- **CORRECTION to the release checklist:** after the revoke, `is_admin()` returned false for `cbsoc_admin_a5eb62`. That only shows the revoke worked. **It did not test the production admin dashboard**, and the grant was never exercised in a browser.
- **PENDING, not verified on production (do not call Stage 8 fully verified until all are done with an authorized test account):**
  - admin queue (list, filters, details)
  - dismiss a report
  - hide a posting
  - restore a posting
  - audit entries (`moderation_log`) written for each action
  - non-admin access to `/admin` and the admin functions refused
  - The 27/27 admin dashboard run was against an **isolated** database, not production.
- **Not done:** push, merge, production deploy, Phase B.

## 2026-11-12: Stage 8 released, Phase B applied, admin checklist reconciled (`main` at 4e0d934)
- **Release:** `feature/moderation-ui` was fast-forwarded into `main` (820079a to 4e0d934; no PR, `gh` was not signed in). Vercel's Git integration built production from it (`dpl_3Xe1mqMYXPsfRnFjSBG3wFCDiWso`, aliased to corkback.vercel.app). Smoke test: `/` 200, `/sign-in` 200, `/admin` signed out 404, bogus posting 404, cron without secret 401. The protected preview (c5upfb720) was never tested directly.
- **Phase B** (`stage8b_promotion_lockdown.sql`) was run by Max after the deploy; its check returned false / true / true.
- **Promotion on the live site after Phase B** (23/23; disposable owner + non-owner, one [TEST] posting, real Edge against corkback.vercel.app):
  - Promote and Remove promotion both work through the UI and persist after a refresh; the public Promoted label appears and disappears with it.
  - Direct client `UPDATE` of `is_promoted` is refused (42501 permission denied), alone and mixed with an allowed column, for the owner and for anonymous clients. Owner content edits still work.
  - `set_posting_promoted` and the API route refuse a non-owner and an anonymous caller. Cleanup matched the baseline counts and hashes.
- **Admin checklist, reconciled with evidence.** Tested on **2026-11-12 about 18:15 UTC**, with a real Edge browser driven against a **local production build of `feature/moderation-ui` (81d9942) connected to the live production database**, using the disposable account `cbsoc_admin_b46df9` that Max granted and revoked in the SQL editor:
  - queue: pending and Resolved tabs list the reports; DONE
  - dismiss a report; DONE
  - hide a posting (empty reason refused; hidden from the public; the author sees the notice and reason); DONE
  - restore a posting (empty reason refused; flag cleared); DONE
  - audit entries for dismiss, hide and restore with the admin username and reasons, shown on the page and returned by `admin_moderation_log`; admins cannot edit or delete log rows through the API; DONE
  - non-admin refusal: signed-out visitors and three non-admin accounts get 404 at `/admin` and are refused by all five admin functions and by direct reads of `moderation_log` and `admins`; DONE
  - **Still PENDING:** the reason filters and the "Posting details" panel were not exercised on production (only in the isolated 27/27 run), and `/admin` has **not** been exercised as an admin on the deployed site corkback.vercel.app (only its signed-out 404 was checked). Neither has been done with an authorized account against the deployed site.
- **Temporary admin grants:** the grant was revoked by Max and `is_admin()` returned false for the test account before it was deleted. Afterwards no `cbsoc_admin_*` profile or auth user exists, and `admins.user_id` cascades on profile delete. `public.admins` cannot be read with the service key, so Kiro did not enumerate admins. Max ran the admins listing query in the SQL editor afterwards and it returned **no rows**, so no admin grants of any kind existed at that point.
- **Not done:** granting Max's personal account admin (held on purpose). The [TEST] audit rows stay in `moderation_log`, which is append-only.

## 2026-11-12: Deployed /admin verified as a real admin (supersedes the two "still PENDING" items above)
- **Grant:** Max granted his own account (`mculbeaux`) in the SQL editor using the `stage8_admin_grant.sql` block. The grant is **kept**; cleanup never touched it. After cleanup his `/admin` still returned 200.
- **How:** Max signed in himself in an Edge window started with remote debugging and a throwaway profile; Kiro attached over CDP and never saw or stored his password. Target: **https://corkback.vercel.app** (deployment `dpl_3Xe1mqMYXPsfRnFjSBG3wFCDiWso`, `main` at 4e0d934). Test data: three disposable accounts (reporter, poster, non-admin), three `[TEST] Live admin ...` postings, three `[TEST]` reports (spam_scam, inappropriate, misleading). The queue held only those three cards, so no real report was in reach; only cards with a `[TEST] Live admin` title were ever clicked.
- **Result: 52/52 passed.**
  - admin session: `/admin` 200 with the Moderation heading, signed in as `mculbeaux`
  - queue: all three reports listed as Pending
  - reason filters: Spam or scam, Inappropriate content, Misleading information each show only their own report; Personal information shows none; Any reason restores all three
  - Posting details: collapsed to open to collapsed, shows title, body and "No moderation history", "View posting" link correct, and after a hide the history shows the hide with its reason
  - dismiss with a note: leaves Pending, listed as Dismissed under Resolved, posting not hidden
  - hide: empty reason refused, then hidden; signed-out visitors get 404; the author sees "Hidden by CorkBack moderators" with the reason; report listed as Actioned
  - restore: empty reason refused, then restored; visible to signed-out visitors again
  - audit: dismiss, hide and restore entries by `@mculbeaux` with their reasons appear in Recent actions
  - non-admin denial: three non-admin accounts and a signed-out visitor get 404 at `/admin`, and the three accounts are refused by all five admin functions; the posting was untouched by the probes
- **Not covered in this run:** "admins cannot edit or delete audit rows through the API" (needs an admin API token, which was not taken from Max's session). It was verified earlier with the disposable admin `cbsoc_admin_b46df9`.
- **Cleanup:** only the three disposable accounts and their `[TEST]` postings and reports were deleted. Postings and profiles counts and hashes match the pre-test baseline; no leftovers from this run. The older `cbsoc_qa_1110b` account and the "CorkBack feature check" posting predate this work and were left alone. The `[TEST]` audit rows stay in `moderation_log` (append-only).
- **Checklist status:** queue, filters, Posting details, dismiss, hide, restore, audit entries and non-admin denial are all verified on the deployed site as a real admin.
## 2026-11-13: Stage 9: follow categories and edit username
- **Release:** commit `b1373c4` (on top of `a63ae62` and `e0ec7d9`), fast-forwarded into `main` (4e0d934 to b1373c4; no PR, `gh` is not signed in). Vercel's Git integration built production once: `dpl_Ez9zMywqaDQbvfMa5KPFPT3XCM3G`, aliased to corkback.vercel.app. GitHub's Vercel status for `b1373c4` links to that deployment.
- **What shipped:** a Follow/Unfollow button beside each category chip on the Map and Alerts; the Following page lists followed categories and merges their active postings into the feed (a posting whose author and category are both followed appears once); owner-only inline username rename on the profile (`PATCH /api/profile/username`, 400 invalid, 401 signed out, 409 `username_taken`); new usernames are saved lowercase. Category follows are a feed follow and do not touch alerts or alert email.
- **Database (run by Max in production Supabase, not re-run by Kiro):** `stage9_category_follows.sql` (table with self-only RLS, explicit authenticated SELECT/INSERT/DELETE grants, and a `lower(username)` unique index guarded against case collisions). Max pasted the SQL output. **Verify: all 31 check rows `pass = true`, SUMMARY 0; leftover check 0 / 0 / 0.** **The preflight output available to Kiro was captured after the migration was applied** (its `table`, `policies` and `lower_index` rows were `false` because those objects already existed; every precondition row was `true`, including `collisions = 0` and `badnames = 0`). **There is no record of a passing before-migration preflight.**
- **Local check (production build of `b1373c4` against the live database, real Edge, two disposable accounts, [TEST] postings): 52/52.** Map and Alerts follow/unfollow, persistence across refresh and sign-out/sign-in, Following feed (add, remove, no duplicate), rapid clicks (6 clicks, 1 save), network/500/401 failures roll back with a message, unknown and retired slugs 404, bad body 400, signed-out 401, mobile 390px and desktop 1280px layout, rename (new URL, old URL 404, case-insensitive clash 409, invalid names 400, unauthorized PATCH 401, postings/follows/friends/messages still on the same account). An earlier run had 14 failures from a test-script bug (it read the screen-reader label as part of the button text); the app and database agreed throughout. Cleaned up, fixed, and rerun from fresh data.
- **Production smoke test (corkback.vercel.app, same suite): 51/52.** The one failure, M2, was a test timing mistake: it read the database 500 ms after the click, but a production save takes about 0.9 to 1.7 s. A **timing follow-up on production passed 4/4** (follow, unfollow, follow, unfollow Nightlife; the button, the PUT response and the database row agreed each time).
- **Cleanup:** each of the three runs deleted only its two disposable accounts, their [TEST] postings and the message thread. Zero residue each time; hashes of every pre-existing profile, posting, follow, connection, category follow and alert unchanged; totals back at baseline (profiles 6, auth users 6, follows 1, category_follows 0, alerts 0). The `mculbeaux` admin grant, `cbsoc_qa_1110b` and the "CorkBack feature check" posting were not touched.
- **Preview not tested:** `dpl_4D4bCVNJeFi4Uw1iYnsMnW4cGp1P` (https://cork-back-ms50h7jkk-max-082a.vercel.app, built from `b1373c4`, passed only the public Supabase URL and anon key) is protected; unauthenticated requests get a 302 to Vercel SSO and no bypass secret was created. Only its build, source and protection were confirmed.
- **Not changed:** the unrelated `tasks.md` edits and `next-env.d.ts` stay uncommitted.

## Profile photos (branch `feature/profile-photos`), 2026-11-13: verified on the production database from a local build

- **Code:** server-mediated avatar upload and remove (`/api/profile/avatar`), shared `Avatar` with initial fallback, owner-only `AvatarUploader` with preview and square crop (`AvatarCropper`, `src/lib/avatars/crop.ts`), cancel and 60 s timeout. The server applies the crop (`rotate`, `extract`, `resize` to at most a 512 px square WebP, metadata stripped). Avatars on profile, top bar, posting cards and pages, replies, friends attendance, Following, Friends (lists, requests, search), inbox, thread header and admin queue.
- **Database (run by Max in production Supabase):** `stage10_avatars.sql` (applied earlier) and `stage10b_avatar_clear_and_rate_limit.sql`. Max reported: both preflights as expected, `stage10 verify: all checks passed`, `stage10b verify: all checks passed`, 10b applied without error. Kiro did not run SQL in production.
- **Static checks:** typecheck, lint, 272 unit and property tests, `next build`. Isolated local Postgres (`supabase/isolated-test/avatars.mjs`): 70/70, including the new stage 10 preflight, verify (mutation-checked) and rollback.
- **Browser (production build on localhost:3100, real Edge, production Supabase, four disposable accounts, `scripts/avatar-e2e`):** run 1, 169 of 185 passed. All 16 failures were traced to the harness: a supabase-js `signOut()` with the default global scope ended account B's browser session, so B's later DELETE, message and report got 401 and the inbox, thread and admin checks had no data. In addition: a cache-header check used HEAD (Storage answers HEAD with `no-cache`; GET is `public, max-age=31536000`, CDN HIT), a transient sign-in timeout, a username-field selector, and the known React #418. After fixing the harness, `followup.mjs` reran those sections with the same accounts: 54 of 55 passed. The one failure was the known React #418 (`/inbox`).
  - Passed: crop preview (proportions kept, zoom, drag and arrow keys, clamped inside the image), Cancel sends nothing, upload, stored square 512 WebP with no EXIF and the chosen crop, circle display, persistence after refresh, sign-out and sign-in, replace (new URL, old object deleted, no stale image), rapid clicks (one POST), Cancel upload, network error, 60 s timeout (photo kept), GIF, SVG, over 2 MB, text renamed .png (UI and API, from the bytes), malformed crop 400, Remove with Keep photo and confirm, Remove persists, missing file falls back on profile, top bar and posting, username edit keeps the photo, rate limit (failed attempts count, 6th is 429 with `Retry-After: 600`, UI message, Remove still works).
  - Denied, with A's path and object unchanged after every attempt: B and a signed-out visitor through the API (401, foreign ids ignored, DELETE scoped to self); REST PATCH of `avatar_path` (A's row, an external URL, clearing); RPC `cb_set_avatar`, `cb_clear_avatar`, `cb_avatar_rate_check`; Storage upload, overwrite, update, move and delete in A's folder, and direct upload into B's own folder. Anonymous read of `avatar_path` works; `profiles` exposes no email.
  - Layout: 1280 px and 390 px, no horizontal scroll on any surface; the cropper fits a 390 px screen, with 50 px controls.
- **Cleanup:** deleted Storage objects first, then the rows and the four accounts. The admin grant and the `avatar_uploads` rows went with the profiles (ON DELETE CASCADE). Counts and hashes of postings, profiles (including `avatar_path`) and every bucket object name match the baseline (MATCH true); 0 test accounts or objects left. An interrupted first attempt (one upload) was cleaned the same way before the run. The scratch folder holding the test password is deleted. No moderation actions were taken, so `moderation_log` is unchanged.
- **Known, pre-existing:** intermittent React #418 on signed-in loads (1 in about 60 loads in a repeat test). It reproduces on `origin/main` (Stage 8 entry above) and is not from this work.
- **Not changed:** `next-env.d.ts` stays uncommitted.
## 2026-11-13: Stage 10 profile photos released (`main` at 296f623)

- **Status:** Stage 10 profile photos complete (all tasks in `.kiro/specs/profile-photos/tasks.md` done). React #418 is tracked separately below and is not part of this feature.

- **Preview (Git integration, `feature/profile-photos`):** `dpl_AUjMhnfkah92XXcuuFw1h1q3VTx9`, https://cork-back-429ps4mnc-max-082a.vercel.app (alias `cork-back-git-feature-profile-photos-max-082a.vercel.app`). Built from 296f623 (Vercel `githubCommitSha` filter and the GitHub commit status both point to this deployment), Ready. Protected: unauthenticated requests to `/`, `/api/profile/avatar` and the branch alias get a 302 to Vercel SSO. Deployment Protection and the Preview env were not changed; Preview has no env vars, so the preview was not tested functionally.
- **Main:** `origin/main` was still 47e1f0c before the push; fast-forwarded 47e1f0c..296f623 (commits 940adf4 and 296f623, 73 files). The fast-forward includes three spec-bookkeeping edits from 940adf4 (`password-reset/tasks.md`, `password-reset/tasks.meta.json`, `social/tasks.md`), approved by Max. `next-env.d.ts` was not included.
- **Production (Git integration):** `dpl_GZ3B5gK61FdKL43pY5jhaCfRoELw`, target production, Ready, aliased to https://corkback.vercel.app, GitHub status success for 296f623. A signed-out `DELETE /api/profile/avatar` returns 401 `signed_out`.
- **Production smoke test (corkback.vercel.app, real Edge, disposable accounts): 43/43.** Crop and upload (stored as a 512 px square WebP, no EXIF, the cropped half), refresh persistence in the profile and top bar, replacement (new URL, old object deleted), removal (fallback after refresh, path null, folder empty), missing-file fallback on the profile and posting author. Denied for B: REST PATCH (42501), `cb_clear_avatar` RPC (42501), Storage overwrite (RLS) and delete (no effect), and B's DELETE affects only B. Signed-out POST 401. A's photo was shown to B on the profile, posting author, Following, Friends, inbox and thread header at 1280 px and 390 px, with no horizontal scroll. No page errors in this run.
- **Cleanup:** the disposable accounts, their Storage objects, the [TEST] postings and the message thread were deleted. Counts and hashes (postings, profiles including `avatar_path`, every bucket object name) match the baseline; 0 test auth users or objects left; auth users total 6. The `mculbeaux` profile is unchanged (profiles hash). Admin grants are not readable with the service role, and nothing in cleanup touches another user's grant; see the SQL check below.

## Known issue (pre-existing, separate from Stage 10): intermittent React #418

- Hydration mismatch (`args[]=HTML`) on some signed-in page loads: about 1 in 60 loads in a repeat test on the Stage 10 build, seen on `/` and `/inbox`, and none in the 43-check production smoke run. First recorded in Stage 8 and reproduced on a build of `origin/main` then. Not fixed and deliberately not bundled with Stage 10. Next step: reproduce on a dev build for the non-minified message and fix it in its own change.

## Board usability improvements
### Task 0.3: browser harness and baseline (branch `feature/board-usability-improvements`, nothing committed)
- **Harness:** `scripts/board-e2e/` (`lib.mjs`, `fixtures.mjs`, `baseline.mjs`, `README.md`). Playwright core 1.49.1 (installed in `%TEMP%\cb_board_e2e`, not in `package.json`) driving installed Microsoft Edge, headless. Mocks `/api/postings/map`, OSM tiles and the geocoder; init script seeds `localStorage["corkback.mapCenter"]` and stubs `navigator.geolocation`; viewports 390x844 and 1280x800. The harness starts and stops `next start` itself (port 3200); no server was left running. Shared checks: no horizontal scroll, tap targets (44 px, primary 50 px), exactly one dark-red main action, map geometry.
- **Finding about empty Supabase variables:** setting the three variables to empty strings in the build and `next start` environment does NOT give seed mode inside the repo. Next still loads `.env.local` and its values win. The first run served real project data (a real posting UUID and real handles on the home page). That run only read data (server-side page render), wrote nothing, and its results were discarded. Fix: build and run from a scratch copy of the repo without `.env.local` (README step 1), which serves `src/lib/seed.ts` data (handles `@lenahoffmann`, `@colectivoroma`). The `.next` in the repo was rebuilt once by the first attempt; `next-env.d.ts` was restored with `git restore` and is unchanged.
- **Baseline (current build, seed mode, saved map center seeded, location stub OK):**

| Measure | 390x844 | 1280x800 |
|---|---|---|
| Map top edge | 552 px (65.4% of 844) | 408 px (51.0% of 800) |
| Map height (element) | 256 px (`h-64`) | 256 px |
| Bottom nav top | 783 px | 739 px |
| Visible map height above bottom nav | 231 px | 256 px |
| Horizontal scroll | none | none |
| Dark-red main actions | 2 ("Scan a flyer" and the bottom-nav "Scan" circle) | 2 |
| Tap targets under 44 px | 20 elements: Sign in 43x20, Use my location 32 high, 10 category chips 32 high, 2 author handles 29 to 33 high, 5 bottom-nav links 40 high | same |
| Primary "Scan a flyer" height | 48 px (target 50) | 48 px |
| Page errors | none | none |

- **Against Stage 1 targets (Requirement 1.8):** at 390x844 the map top is 65.4% (target at or below 55%) and 231 px is visible (target at least 240 px), so both fail on the current build, as expected before Stage 1.
- **Status:** browser checks ran in Edge, no block. Raw results: `%TEMP%\cb_board_e2e\baseline.json`, screenshots in `%TEMP%\cb_board_e2e\shots\`. The baseline "two dark-red actions" and tap-target failures are the pre-change state, not regressions.

### Stage 1 (compact category filter)
- **Fixes after the first `stage1.mjs` run (all in Requirement 1.3 and 1.9):** (1) the panel overflowed the viewport (anchored left of the trigger, 352 px wide). `CategoryFilter` now measures the panel when it opens and shifts it left so it stays 16 px inside the viewport at both widths. (2) Outside click closed on `pointerdown` but the browser's default mousedown focus change then moved focus away. Focus now returns to the trigger on the next task (`setTimeout 0`). (3) `HomeMap` drew pins in `map.once("load")` from the unfiltered list. It now reads the latest filtered list from a ref, so pins match the filter even when load fires after a category change.
- **Baseline vs after (390x844, seed mode, same harness):**

| Measure | Baseline | After Stage 1 | Target |
|---|---|---|---|
| Map top edge | 552 px (65.4%) | 332 px (39.3%) | at or below 55% |
| Map height | 256 px | 288 px (`h-72`) | n/a |
| Visible map above bottom nav | 231 px | 288 px | at least 240 px |

  At 1280x800 the map top is 308 px (38.5%, baseline 408 px) and the map is 384 px high (informational, no threshold).
- **Commands and results:** `npm run typecheck` PASS. `npm run lint` PASS (no warnings or errors; `next lint` deprecation notice only). `npm test` PASS (29 files, 278 tests, includes the Property 1 filter test and the fixture guard). `npm run build` PASS, run in the scratch copy without `.env.local` (seed mode, empty Supabase variables) so the real project is never read. `node stage1.mjs` against `next start` from that copy, Edge headless, mocked data only, no location or camera: 28 checks at 390x844 and 27 at 1280x800, all PASS. Checks cover: map position and visible height, one trigger "Category: All", open by click, Enter and Space, close by Escape, outside click, second click and selection (focus returns to the trigger each time), panel list order, overlay with no layout shift, panel inside the viewport, no follow control when signed out, filtered pins equal cards, empty category keeps the selection and shows the empty state, selected row dark red, no horizontal scroll with the panel closed and open, tap targets of the feature controls at least 44 px, one dark-red main action, no page errors. Results: `%TEMP%\cb_board_e2e\stage1.json`.
- **Pre-existing, not Stage 1 failures:** under-44 px elements: top-bar Sign in (43x20), author handles (29 to 33 high), five bottom-nav links (40 high). The bottom-nav "Scan" circle is a second dark-red action that existed in the baseline.
- **Untested, needs a live check:** signed-in follow and unfollow from the panel and next to the trigger with a real account (the harness runs signed out); the filter on a real phone (touch, tiles, real data); one more look at panel placement on a real narrow device.
- **Cleanup:** no server left running; the scratch build copy's contents were removed (junction removed with `rmdir` first, real `node_modules` intact); an empty `%TEMP%\cb_board_build` folder remains, locked by Windows, and can be deleted after a restart. No commits or pushes. `next-env.d.ts` unchanged.

### Stage 2 (nearby radius and distance)
- **Owner's pre-coding containment check (recorded as agreed):** `boundsForRadius` uses the exact spherical longitude half-width `asin(sin(d/R) / cos(lat))` plus a 1e-7° margin, latitude half-width `d/R`, and the same Earth radius as `haversineMeters`. Near the poles and across the antimeridian it uses the full longitude range. `snapBoundsOutward` only expands (0.1° grid, idempotent). The server filter is inclusive. The browser's `buildBoardView` is the final exact filter. Tests: `mapBounds.snap.test.ts` (600-run containment at exactly the radius and at radius − 0.01 mi, all bearings, latitude −85..85, Berkeley in 8 directions); `nearby.view.test.ts` (edge fixtures inside, at and outside the radius, Berkeley and 60°N); `nearbyLoading.test.ts` Property 34 (500-run end-to-end pipeline `buildMapRequest` → `parseBounds` → snap → `selectForBounds` → `buildBoardView`, no posting within the radius lost); route and `mapQuery` edge tests (a posting exactly on the box edge and one exactly 10 mi to the NE are returned).
- **Caps kept:** 300 pins and 100 cards. The map query reads pages of cap + 1 rows (up to 4 pages), drops ended events, and sets `truncated` if the page limit is hit. This deviates from the design's single read, to avoid short pages after ended events are dropped.
- **Interim, until Stage 4:** the "Explore the world" map shows the same capped nearby list, not every posting.
- **Behaviour notes:** the automatic location request on load (no saved centre) is preserved. An explicit search or "Use my location" is never overwritten by a late automatic result. When the client's request equals the server's initial request, the server list is used without a refetch.
- **Harness changes (script only, no product code changed, no regression found):** the `HomeMap` rewrite in 4.8 broke three `stage1.mjs` assumptions. (1) With the default saved centre the page now uses the server-rendered list (empty in seed mode around Berkeley), so pins and cards were 0. Stage 1 now seeds a saved centre 2.2 km south of Berkeley (same trick as `stage2.mjs`) so the mocked fixtures are fetched. (2) The empty-state text is now "Nothing within {r} mi of {place}". (3) The selected radius option ("10 mi", `aria-checked="true"`) is dark red like a selected category chip and was counted as a second main action; the dark-red check now skips `aria-checked="true"` as well as `aria-pressed="true"`. With fixture cards on screen, the card title link (39 to 40 px high, `PostingCard`, unchanged) is classed as pre-existing under-44 px next to author handles and bottom nav.
- **Checks (current working tree, branch `feature/board-usability-improvements`, nothing committed):**
| Check | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (no warnings or errors) |
| `npm test` (includes all Stage 1 and 2 property and unit tests, Properties 1 to 9, 25, 26, 31 to 36 as scheduled) | PASS, 42 files, 382 tests |
| `npm run build` in a scratch copy without `.env.local`, empty Supabase variables (never against real Supabase) | PASS |
| `node stage1.mjs` (Edge headless, `next start` from the scratch build, mocked data, location stub only) | PASS: 29 of 29 at 390x844, 28 of 28 at 1280x800 |
| `node stage2.mjs` (same setup) | PASS: 138 checks (4 preconditions, 68 at 390x844, 66 at 1280x800), none failed |
  Stage 2 script covers: search "Berkeley" shows the fixture Richmond card as "About 7 mi away" under "Within 10 mi of Berkeley", hidden at 5 mi, exact-distance filter drops the just-outside posting that is inside the coarse box, pins equal cards, ring drawn, "Show full radius", empty state and "Try" button, 100+ response shows the truncated notice, request URLs carry only snapped bounds, category and `mode=cards`, failed request keeps previous cards with a retry, no horizontal scroll (including 100 cards), no page errors. Results: `%TEMP%\cb_board_e2e\stage1.json` and `stage2.json`.
- **Location:** no real location or camera permission requested; geolocation is the harness stub. The real geocoder was never contacted (canned answer).
- **Still needs a live test:** "Use my location" distances on a real phone; the radius ring and "Show full radius" on real tiles; signed-in viewer likes on fetched cards; real search geocoder results for Berkeley and Richmond; the automatic-location precedence on a real device (late automatic fix versus a search typed first).
- **Cleanup:** no server left running; scratch build removed (junction removed with `cmd /c rmdir` first, real `node_modules` intact); an empty `%TEMP%\cb_board_build` folder may remain and can be deleted after a restart. `next-env.d.ts` was changed by the typecheck/lint run (added a `.next/types/routes.d.ts` reference) and restored with `git restore`. No commits or pushes.

### Stage 3 notes
- **Alert job scale follow-up (outside this feature, Requirement 12.9):** `src/app/api/cron/alerts/route.ts` reads every active posting in one query (`deleted_at` null, `moderation_hidden_at` null, `expires_at` in the future), reads every alert, then runs a nested loop: for each alert it fetches that owner's hidden set and email, then calls `alertMatchesPosting` (`src/lib/alerts.ts`) against every posting, with one `sent_alerts` lookup per matching pair. Work grows as alerts x postings and nothing narrows postings by category or distance before matching. This feature makes no change to how the job selects postings. Follow-up for later: select postings per alert (category and bounding box in the query, or a spatial index) and batch the hidden-set and `sent_alerts` lookups.
- **Takedown parity check (task 7.5):** `supabase/isolated-test/takedown.mjs` compared the existing production function `public.posting_takedown_at` (`stage6_social_part1.sql`) with the app's `postingTakedown` over 7,594 generated listing and Community rows. Result: 458 mismatches, all pre-existing and not caused by this feature.
  1. End times inside daylight saving gaps or overlaps in real zones differ by one hour (the app is one hour earlier).
  2. Unusual `end_time` values (fractional seconds, `24:00`). The app's validators only accept `HH:MM`, so these cannot be written through the app.
  3. Zone strings Postgres accepts as abbreviations or POSIX rules (`UTC+5`, `CET`, `Factory`, ...) that the app rejects. `tz-lookup` always returns Area/City names, so the app never stores these.
- **Draft fix, NOT applied:** `supabase/stage13_takedown_app_parity.sql` with `supabase/stage13_takedown_app_parity_rollback.sql` (renamed from stage11 to avoid colliding with the planned stage 11 message-reads files; untracked). Loaded in the throwaway database it gives 0 mismatches except 304 rows using `PST`, `CET`, `EET`, `MET`, `WET`, which the app cannot store. Re-checked after the rename: without the draft, exit 1 with 458 mismatches; with `CB_TAKEDOWN_DRAFT=stage13_takedown_app_parity.sql`, exit 0 with 0 mismatches, 304 known-limit rows, and the rollback restores the stage 6 definitions exactly.
- **Owner decision needed:** the draft also makes `cb_safe_time_zone` stricter for names without `/` (a fixed allow-list). That changes which zones the database accepts and needs owner review. Requirement 10.9 (database agrees with app) is therefore not met in production until the owner reviews and applies stage13, or accepts the pre-existing one-hour DST-edge difference.

### Stage 3 (category-specific fields and expiry): checkpoint (task 8)
Branch `feature/board-usability-improvements`, nothing committed or pushed. Never contacted the real Supabase project, nothing published.

- **Commands and results:**
| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (no warnings or errors; `next lint` deprecation notice only) |
| `npm test` (includes the Stage 3 Properties 10 to 16, 27 to 30, alert tests, `route.edit.test.ts`) | PASS, 52 files, 460 tests |
| `npm run build` in a scratch copy without `.env.local` (seed mode, empty Supabase variables) | PASS |
| `npm run build` in the same scratch copy with the mock URL `http://127.0.0.1:3299` (needed by `stage3.mjs`, README "Stage 3") | PASS |
| `node stage1.mjs` (Edge headless, `next start` from the seed-mode build, mocked data) | PASS |
| `node stage2.mjs` (same build) | PASS |
| `node stage3.mjs` (mock-URL build, local mock Supabase on 127.0.0.1:3299) | PASS: 176 checks across 390x844 and 1280x800, 0 failed |
| `node supabase\isolated-test\takedown.mjs` without the draft | exit 1 as expected: 7,594 rows, 458 mismatches (same as "Stage 3 notes") |
| Same with `CB_TAKEDOWN_DRAFT=stage13_takedown_app_parity.sql` | exit 0: 0 mismatches, 304 known-limit rows (PST, CET, EET, MET, WET), rollback restores the stage 6 definitions exactly |
| `node supabase\isolated-test\avatars.mjs` | 70 passed, 0 failed (no regression) |
- **Test environment note:** the first `npm test` run had 1 failure in `src/lib/avatars/avatars.test.ts` (Property 9, avatar URL for an invalid path) because my shell still had `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3299` exported from the Stage 3 build. With the three variables cleared, all 460 tests pass. No code change. The avatar test depends on the process environment; run `npm test` with those variables unset.
- **Per-category labels verified in Edge (`stage3.mjs`, review form):** events (music, nightlife, sports, social-clubs, classes): Event date (required), Time, End date/time, Event place, RSVP link (optional). Jobs: "Apply by (optional)", "Application link (optional)". Housing: "Available until (optional)", "Listing or contact link (optional)". For sale: "Offer ends (optional)", "Listing link (optional)". Lost and found: "Keep this up until (optional)", "Contact link (optional)". Listings show no event date, time or end fields and no "Without an end, an event comes down..." sentence. Community: date optional, with its hint; Time, End date and End time disabled until a date exists; button text by category and "RSVP" or "Learn more" for Community.
- **Takedown wording verified:** review and edit forms "Comes down on {date}: {phrase}" (for example "your deadline passes", "the time you chose to keep it on the board ends"); detail page "On the board until {date} (expiry|deadline|event ends)" per design.md. Listing without a Deadline reads "(expiry)"; Community with a date reads "(event ends)", without a date "(expiry)" and no date row. Cards: "Apply by Jun 15" for a listing with a Deadline, "Dec 5" for Community with a date, no date line for date-less Community or a listing without a Deadline. A stored legacy `event_date` and `event_time` still show.
- **PATCH contract (`PATCH /api/postings/[id]`):** the client sends `deadline` and `replaceLegacyEventDate`. Date fields are written by kind in one update. A legacy `event_date` on a listing is kept unless the client reports that the replacement notice was shown. Event to listing change clears `event_time` and `end_time`. A validation error writes nothing. Covered by `route.edit.test.ts` and Property 16 against a stubbed client. In the browser the PATCH is a mocked 400 only.
- **Alert email fix (task 7.2):** listings read "Apply by Dec 1" (`fieldSpec(slug).cardPrefix`), events keep "Date: ...", date-less Community postings and listings without a Deadline omit the date line, an unparseable date omits the line and the email still sends. The cron route passes `endDate` and `categorySlug`; how postings are selected is unchanged.
- **Takedown parity finding (Requirement 10.9):** the production `posting_takedown_at` differs from the app's `postingTakedown` on 458 of 7,594 generated rows (DST gap and overlap hours, odd `end_time` values, zone strings only Postgres accepts). Draft fix `supabase/stage13_takedown_app_parity.sql` (+ rollback) is NOT applied. **Owner decision:** the draft makes `cb_safe_time_zone` stricter for names without `/` (a fixed allow-list). Until the owner reviews and applies it, or accepts the one-hour DST-edge difference, Requirement 10.9 is unmet in production. This is not a Stage 3 regression.
- **Interpretation recorded (Requirement 7.4 vs design):** listings show "Place (optional)" (design table) while Requirement 7.4 says no "Event place" field. I read it as: the general place field stays with the listing label, and the event-specific fields (Event place, event date, time, end) are hidden. Browser check confirms the listing field list is exactly Title, deadline label, Place (optional), Details, link label.
- **Untested in a browser (mocked only):** real Supabase RLS and session handling on the review and edit pages (a fake `sb-127-auth-token` cookie and a local mock were used), the real `PATCH` 400 for an ended Community clear-date and for validation errors (mocked response; server logic covered by unit and property tests), publishing (`POST /api/postings` is intercepted and fails the run if called), real scan of a flyer with a deadline (scanned date was a mocked response), real alert email delivery.
- **Still needs a live test by the owner (production data, nothing was run):**
  1. A real posting in each listing category (jobs, housing, for sale, lost and found) with and without a Deadline: review labels, takedown line, card, detail page.
  2. A real Community posting with and without a date: button text, takedown line, card with no date line.
  3. Edit of a legacy-date listing (the notice, Deadline pre-filled, nothing saved until Save, legacy date kept or replaced as shown) and an event to listing change.
  4. Takedown lines on existing production postings (detail page "On the board until ...", reason), and the ended-Community clear-date rejection with a real ended posting.
  5. A real alert email for a listing ("Apply by ...") and for a date-less Community notice.
  6. Review of `stage13_takedown_app_parity.sql` (owner decision above).
- **Cleanup:** no server left running (ports 3200 and 3299 free); scratch build contents removed (junction removed with `cmd /c rmdir` first, real `node_modules` intact; an empty `%TEMP%\cb_board_build` folder may remain and can be deleted after a restart). `next-env.d.ts` was changed by the typecheck/lint/build run and restored with `git restore`. No commits or pushes. `tasks.meta.json`: the stale `stage11_takedown_app_parity` reference was replaced with `stage13_takedown_app_parity` (text only).

### Stage 4 (both-map category filter and bounded world map)
Checkpoint (task 10). Branch `feature/board-usability-improvements`, nothing committed or pushed. Never contacted the real Supabase project.

- **Fix 1, world map crash at load (found by `stage4.mjs`, task 9.9):** the board page threw "Cannot read properties of null (reading '0')" in both viewports. MapLibre 6.17.0 throws inside `map.resize()` -> `constrainInternal` -> `setZoom` -> `_calcMatrices` when the map is created with `maxBounds`. Choice: drop `maxBounds` (design.md does not require it), keep `renderWorldCopies: false`, add `minZoom: 1` so the world is not shown several times, and keep clamping the bounds passed to `onBoundsChange` to +-180 / +-90 (`readBounds` in `src/components/map/MapView.tsx`). Clamping is what matters for requests, because `/api/postings/map` rejects wrapped or out-of-range boxes. The "set maxBounds after first load" option was not used: it keeps the same MapLibre code path and is harder to prove safe. `HomeMap.tsx` (local map) does not set `maxBounds`, so it was not affected.
- **Fix 2, caption count (Req 14.4):** `{n}` in "Explore the world · {category} · {n} postings in view" was the number of pins returned for the snapped box, which is slightly larger than the visible view. It is now `countInView(items, bounds)` (`src/lib/mapBounds.ts`): the pins whose lat/lng lies inside the map's actual unsnapped view, edges inclusive, recomputed on every `moveend`. All returned pins are still drawn. The truncated caption is unchanged. Unit and property tests: `src/lib/mapBounds.view.test.ts`.
- **Script updates (assertion changes only, no product failure hidden):**
  - `stage4.mjs` scenario T: the zoomed-in caption is now checked against the drawn markers whose centre lies inside the map container (strict and loose counts with 1.5 px tolerance, because marker positions are rounded to whole pixels), not against all drawn markers.
  - `stage2.mjs`: since Stage 4 the world map sends `mode=pins` requests. The mock answers them (cap 300) and records them apart from the local-map cards log. Every request in both modes is still shape-checked (0.1 grid bounds, optional category, mode, nothing else).
- **Commands and results:**

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (no warnings or errors; `next lint` deprecation notice only) |
| `npm test` (three Supabase variables cleared) | PASS, 57 files, 484 tests |
| `node supabase\isolated-test\geoindex.mjs` (`CB_ISO_DIR=%TEMP%\cb-iso`) | 54 passed, 0 failed |
| `node supabase\isolated-test\avatars.mjs` | 70 passed, 0 failed |
| `npm run build`, scratch copy without `.env.local`, empty Supabase variables (seed mode) | PASS |
| `npm run build`, scratch copy without `.env.local`, mock URL `http://127.0.0.1:3299` (for `stage3.mjs`) | PASS |
| `node stage1.mjs` (Edge, 390x844 and 1280x800, `next start`, mocked data) | PASS, 57 checks, 0 failed |
| `node stage2.mjs` | PASS, 138 checks, 0 failed |
| `node stage3.mjs` (mock-URL build, local mock Supabase) | PASS, 176 checks, 0 failed |
| `node stage4.mjs` (current tree, no line removed from the scratch copy) | PASS, 156 checks, 0 failed |

- **Run note:** the first full `stage4.mjs` run on a busy machine failed D1 (the harness's own pan gaps were 445 and 364 ms, and 1044 and 635 ms, above the 400 ms debounce, so two requests were expected behaviour) and P2/G (`next start` refused connections late in the run). `CB_ONLY=D1,P2,G` passed, and the next full run passed every check with gaps of 351 and 326 ms. No code change for these.
- **Caps:** 300 pins and 100 cards kept, with the owner-confirmed truncated caption "Showing 300 of many postings in this view. Zoom in to see more."
- **World map no longer loads every posting:** the page HTML embeds 0 posting objects for the world map (`stage4.mjs` P: 16,671 bytes, `postingObjs: 0`). Pins are fetched per view with a 400 ms debounce; an earlier request is aborted when a new one starts, and a stale response is ignored.
- **Geo index:** `supabase/stage12_postings_geo_index.sql` (with preflight, verify and rollback files) is drafted and tested in the throwaway database (`geoindex.mjs`, 54/54). It is **NOT applied** to production.
- **Still needs live checks:**
  1. The world map on real OSM tiles with real data across the globe (pan, zoom, category, caption count, truncated caption).
  2. CDN caching of `/api/postings/map` pins responses on Vercel.
  3. Real pan and zoom on a phone.
  4. Applying stage12 after owner review, then the verify script on production.
- **Cleanup:** no server left running. Scratch builds `%TEMP%\cb_t10_seed` and `%TEMP%\cb_t10_mock` removed (junction removed with `cmd /c rmdir` first; real `node_modules` intact). `next-env.d.ts` restored with `git checkout`. No commits or pushes.

## Board usability improvements: final verification

Task 13 (final checkpoint), 2026-11-15, branch `feature/board-usability-improvements`, run on the current working tree (nothing committed, nothing pushed). `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` were cleared in the shell. The real Supabase project was never contacted: the DB checks ran in the throwaway database (`CB_ISO_DIR=%TEMP%\cb-iso`), and the builds and browser runs used scratch copies without `.env.local`.

| Command / script | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS (no warnings or errors; `next lint` deprecation notice only) |
| `npm test` | PASS, 64 files, 529 tests |
| `node supabase\isolated-test\messagereads.mjs` | PASS, 67 passed, 0 failed |
| `node supabase\isolated-test\geoindex.mjs` | PASS, 54 passed, 0 failed |
| `node supabase\isolated-test\avatars.mjs` | PASS, 70 passed, 0 failed |
| `node supabase\isolated-test\takedown.mjs` (stage 6 SQL, no draft) | exit 1 as expected: 458 mismatches of 7,594 rows (pre-existing) |
| `node supabase\isolated-test\takedown.mjs` with `CB_TAKEDOWN_DRAFT=stage13_takedown_app_parity.sql` | PASS, exit 0: 0 mismatches, rollback restores the stage 6 definitions; 304 rows are the known limit (WET, EET, PST, CET, MET) |
| `node supabase\isolated-test\run.mjs` (README still applies; ran in about 54 s; includes the concurrency suite) | PASS, 52/52 |
| `npm run build`, scratch copy, no `.env.local`, empty Supabase variables (seed mode) | PASS |
| `npm run build`, scratch copy, no `.env.local`, mock URL `http://127.0.0.1:3299` | PASS |
| `node stage1.mjs` (Edge, 390x844 and 1280x800, `next start`, mocked data) | PASS, 57 checks, 0 failed |
| `node stage2.mjs` | PASS, 138 checks, 0 failed |
| `node stage3.mjs` (mock-URL build, local mock Supabase) | PASS, 176 checks, 0 failed |
| `node stage4.mjs` | PASS, 156 checks, 0 failed (final full run) |
| `node stage5a.mjs` (mock-URL build) | PASS, 123 checks, 0 failed |
| `node stage5b.mjs` (mock-URL build) | PASS, 131 checks, 0 failed |

Check counts for the browser scripts are PASS lines across both viewports. Live checks listed below are UNTESTED.

### Run notes

- **`stage4.mjs` assertion change (legitimate):** checks P and P2 asserted that the page load makes no `/api` request other than `/api/postings/map`. Since Stage 5b, BottomNav polls `GET /api/messages/unread` (a signed-out visitor gets 401 and the poll stops). The two checks now ignore that one endpoint. They still fail on any other `/api` call, including any `/api/postings` call besides the map request.
- **`stage4.mjs` D1 is timing-sensitive:** it makes three real mouse pans with gaps that must each stay under the 400 ms debounce. On this busy machine two full runs failed D1 on gaps such as 445 and 370 ms (the harness's own pan gaps, so two requests is correct behaviour), and one run lost `next start` partway (connection refused), which failed later scenarios. `CB_ONLY=D1,D3,D4,P,P2,G` passed on both viewports, and the next full run passed 156/156. No product code changed for this.
- A stale `stage5a` process and its `next start` were left over from an interrupted earlier command and were stopped before the final runs. Every script result above is from a run on its own.

### SQL status (nothing applied anywhere)

| Draft | Files | Test | Status |
|---|---|---|---|
| `stage11_message_reads` | 4 (migration, preflight, verify_roles, rollback) | isolated 67/67 | **NOT applied.** The unread indicator ships dark until it is applied (`/api/messages/unread` answers `{supported:false}` and nothing shows). |
| `stage12_postings_geo_index` | 4 (migration, preflight, verify, rollback) | isolated 54/54 | **NOT applied.** Optional: map queries work without the index. |
| `stage13_takedown_app_parity` | 2 (migration, rollback) | `takedown.mjs`: 458 mismatches without it, 0 with it | **NOT applied.** Fixes a pre-existing one-hour difference at daylight saving edges between `posting_takedown_at` and the app's `postingTakedown`, and makes `cb_safe_time_zone` stricter. Owner decision. |

### Notable decisions and deviations

- **Map query paging:** the map query reads up to 4 pages of cap + 1 rows so that the truncated flag and the caps (300 pins, 100 cards) hold after the exact distance filter.
- **`maxBounds` removed:** MapLibre 6.17 crashed with it set, so the world map has no pan limit.
- **Auto-location on load kept:** the home page still asks for the device position on load, as before. Location stays in the browser and never goes into a request (`stage4.mjs` G).
- **Listing "Place (optional)" kept:** listing forms keep the optional place field.
- **Detail page expiry reasons:** the detail page shows the reason "(expiry|deadline|event ends)" per the design.
- **Unread SQL uses `security definer` functions:** stage11 counts and marks through definer functions, so a third user sees nothing and cannot mark (checked in `messagereads.mjs`).
- **Unread handle weight:** the unread handle uses `font-extrabold` (800) and a read handle is already `font-bold` (700, `src/app/inbox/InboxList.tsx` line 81). Kalam is loaded at 400 and 700 only (`src/app/layout.tsx`), so 800 renders the same as 700 and the weight alone shows no difference. The visible unread marker is the dark-red dot plus the hidden "Unread" text for screen readers.

### Still needs live tests (UNTESTED)

1. A real two-account message thread: automatic refresh between two browsers, and mark-read clearing the badge after stage11 is applied.
2. Background-tab pause of thread polling on a real phone.
3. The unread badge after the owner applies stage11, then runs `stage11_message_reads_verify_roles.sql`.
4. "Use my location" distances and the radius ring on a real phone.
5. The real geocoder for Berkeley and Richmond.
6. The world map on real tiles with real data, and CDN caching of `/api/postings/map` pins on Vercel.
7. A real posting in each listing category and in Community, with and without a date.
8. Editing a legacy-date listing.
9. A real alert email for a listing.
10. Signed-in follow from the category panel.

### Cleanup

No server left running. Scratch builds `%TEMP%\cb_fin_seed` and `%TEMP%\cb_fin_mock` removed after rmdir of the `node_modules` junctions. An older scratch folder `%TEMP%\cb_board_build` (no junction, real `node_modules` intact) could not be deleted because Windows reports it in use; it is outside the repo and can be removed later. `next-env.d.ts` restored with `git checkout`. No commits or pushes.

## Board usability improvements: preview preparation (2026-11-16)

- **Diff review (89 new and 21 changed files, branch `feature/board-usability-improvements`):** no secrets. The only key-like strings are fake test values (`fx-anon-key`, `test-service-key`, empty strings in the harness README). No generated files: no `.next`, no `node_modules`, no logs, screenshots or result JSON. `next-env.d.ts` is excluded. Fixtures stay out of the app: `src/lib/__fixtures__` and `src/lib/__testing__` are imported only by `*.test.ts` files (checked by search and by `fixtureGuard.test.ts`), and nothing under `src/` imports `scripts/board-e2e`. `src/lib/seed.ts` is unchanged. Production code changes reviewed: `page.tsx` loads only the capped cards query; `BottomNav` polls the unread count (dark until stage 11 is applied); the alert cron passes `endDate`; `postings.ts` only exports existing helpers.
- **Automatic location changed:** the board now reads the device location by itself ONLY when the browser already reports `granted` for geolocation (`navigator.permissions.query`, new `src/lib/geoPermission.ts`). For `prompt`, `denied`, no Permissions API or any error it makes no request and waits for "Use my location", so the page never shows a permission prompt on its own. A search or a "Use my location" tap now blocks the automatic result from the moment it starts (previously only after a search succeeded), so a late device fix can never override a searched city.
  - Checks: typecheck, lint, `npm test` 65 files / 532 tests (new `geoPermission.test.ts`). Production build (seed-mode scratch copy, no `.env.local`). Edge at 390x844 and 1280x800: stage1 57/57, stage2 150/150 (138 before; new: B "prompt" makes no request, C "granted" requests once, E "denied" makes no request, F a 4 s delayed fix after a Berkeley search leaves the heading, saved centre and cards on Berkeley), stage4 156/156. Harness: `newPage` gains `permission` and `geoDelayMs`. Earlier results for stage3 (176), stage5a (123), stage5b (131) and the isolated database tests stand; those code paths are unchanged.
- **stage13 read-only production inventory** (project `djdmiqxzcgjdwcxqqrzk`, 2026-11-16 15:03 UTC; one PostgREST GET of id, category, dates, end_time, time_zone and moderation columns, no titles or locations; comparison in a throwaway local Postgres):
  - 4 postings (1 on the board now). Stored zones: `America/Los_Angeles` x2, null x2 (pre-Stage 6, fall back to Etc/GMT+12 on both sides).
  - Zones without "/": 0. Rows in the excluded known-limit set (PST, CET, EET, MET, WET; the 304 generated rows): 0.
  - Live function = app for 4/4; draft = app for 4/4; **postings whose takedown the draft would change: 0.**
  - So the 458 generated mismatches are not present in current data. The draft matters only for future rows whose end time falls in a daylight saving gap/overlap hour (one hour difference) or for zone strings the app never stores. Recommendation: not a prerequisite for this release; review stage13 on its own.
- **Remaining live tests (unchanged list plus one):** real two-account thread (auto-refresh between two browsers, mark-read clearing the badge after stage 11); background-tab pause on a real phone; unread badge after the owner applies stage11; "Use my location" distances and the radius ring on a real phone; **automatic location on a phone where permission was already granted, and no prompt on a fresh browser**; real geocoder for Berkeley and Richmond; world map on real tiles with real data and CDN caching of pins; a real posting in each listing category and Community with and without a date; edit of a legacy-date listing; a real alert email for a listing; signed-in follow from the category panel.

## Board usability improvements: staging verification blocked (2026-11-16)

- **Goal:** point the protected preview (commit 9250695, `dpl_AGS2CctDws1dHsVri9PCq1cFDygM`) at a separate staging Supabase project with synthetic postings and two test accounts, apply stage11 there, and run the two-account checks.
- **Finding:** no staging project exists. The Supabase CLI (v3.1.0, signed in) lists two active projects in org `ddpjsydibwhursisqogq`: `launchpad` (orijcqnfdxyvqiqjhdlh) and `CorkBack` production (djdmiqxzcgjdwcxqqrzk). The Free plan allows 2 active projects across every organization where the owner is an Owner or Admin, so a third needs `launchpad` paused, a paid plan, or a project the owner creates.
- **Decision (Max):** stop here. Nothing was created or changed: no Supabase project, no Vercel environment variable, no redeploy, no SQL applied anywhere. The preview stays in demo mode (Vercel's Supabase, Resend, cron and app-URL variables are Production-only).
- **Still blocked until staging exists:** sign-in and category follow/unfollow; two-account message auto-refresh; unread indicators clearing (needs stage11 applied to staging); listing creation and editing; Community with and without a date; listing alert emails to test accounts only.
- **Setup notes for later:** a Preview-scoped, branch-scoped Supabase URL and keys (never the production values); a Preview-scoped Resend key and `ALERTS_FROM_EMAIL`, plus test-account addresses that can receive or simulate delivery (`@corkback-test.invalid` cannot receive mail); a Preview `CRON_SECRET` to trigger the alert job by hand; staging Auth site and redirect URLs for the preview domain; and either a Vercel login or a "Protection Bypass for Automation" secret, so the browser harness can reach the protected preview.
- **Real-phone checks (needed with or without staging):** background-tab pause of an open thread; "Use my location" distances and the radius ring; automatic location where permission was already granted, and no prompt in a fresh browser; touch use of the category panel, radius control and world-map pan.

## Board usability improvements: local two-account stage 11 check and release checklist (2026-11-16)

- **Scope (owner):** the preview stays in demo mode. No staging project, no pausing `launchpad`, no plan change, no production connection. Everything below is **local only**: embedded PostgreSQL 17 plus PostgREST 14.18 on this machine, plus local production builds in real Edge with mocked APIs. It is **not** a hosted-preview test: no Vercel, no Supabase Auth, no real browsers talking to a real database.
- **New `supabase/isolated-test/twoaccount.mjs`: 30 passed, 0 failed.** It covers stage 11 applied in the documented order (preflight, migration, verify_roles `ALL CHECKS PASS`) and two synthetic accounts with their own JWTs through PostgREST. It uses the shipped poller, merge and unread code, and copies the route and ThreadView database calls.
  - Pre-stage-11 history is backfilled as read.
  - Two messages from A give B "2" and "Messages, 2 unread"; A's own messages never count.
  - B's first load has no cursor; later polls send the exact `created_at` string.
  - A's new message appears in B's open thread in 0.8 s; B's reply appears in A's in 0.2 s; no duplicates.
  - Unread clears for both after their open tabs mark read.
  - A hidden tab makes no requests; it shows 1 unread, then clears on return.
  - Same-timestamp messages are shown once.
  - A third user and anonymous are refused.
  - An earlier marker never lowers the stored one; a future marker is clamped to server time.
  - At most one request is in flight per tab.
  - After rollback, unread answers `{ supported: false }` and messages are unchanged.
- **Bug found and fixed:** `advanceMarker` and `unreadCount` in `src/lib/unread.ts` compared timestamps with `Date.parse`, which keeps milliseconds only. Postgres compares `created_at > marker` in microseconds.
  - Effect: a message from the other person in the same millisecond as the last mark, but later in microseconds, was shown yet never marked read, so the badge stuck at 1.
  - Fix: microsecond comparison with `compareInstants` and `parseInstantMicros`.
  - Tests: `unread.micro.test.ts`, 5 tests including a 500-run property.
- **Re-runs after the fix:**
  - typecheck and lint pass.
  - `npm test`: 66 files, 537 tests.
  - `messagereads.mjs`: 67/67.
  - Mock-Supabase scratch build; Edge `stage5b.mjs` 128 checks and `stage5a.mjs` 120 checks, 0 failed at 390x844 and 1280x800.
  - Earlier results for stages 1 to 4, geoindex, avatars, run.mjs and takedown stand, since that code is unchanged.
- **Not verified anywhere yet (needs production after release, or a staging project):**
  - Supabase Auth sign-in and the session cookie.
  - Category follow and unfollow while signed in.
  - Two real browsers on a hosted deployment.
  - Real geocoder results.
  - The world map on real tiles and data.
  - Real listing and Community publishing and editing.
  - Real alert emails.
- **Release checklist:** `.kiro/specs/board-usability-improvements/release-checklist.md`. It has the exact SQL paths and order, the deferred stages, the live checks (with the real-phone ones separated), and the rollback steps.
  - Code rollback target: production deployment `dpl_ChvTDmc4xev6oJyoqjbqi5os4eaE` (`c71951a`).
  - Production SQL, the merge and the production deploy remain pending owner review.

## Release 2026-11-16: board usability improvements on production

- **Merge:** `main` was still `c71951a`; fast-forwarded to `168ab7e` (no conflicts) and pushed once. Vercel production `dpl_HENMGLhNWYWnNcNPSNC6LxQ2kkw7` built it, aliased to https://corkback.vercel.app.
- **Production smoke test (Edge, 390x844 and 1280x800, synthetic `[TEST]` posting and two test accounts with Resend simulated-delivery addresses):**
  - Board loads (200), map top 332 px on a phone, no horizontal scroll.
  - Category filter: Community sent on both maps.
  - Berkeley search: heading "Within 10 mi of Berkeley", `[TEST]` card "Under 0.5 mi away". Radius 5 changes the heading. Richmond search: "Within 10 mi of Richmond, California" with the Berkeley `[TEST]` card "About 6 mi away".
  - Bounded map requests all 200; no location request without permission; signed-out unread asks once (401) then stops.
  - Sign-in works; follow and unfollow Sales from the panel save and remove the row.
  - Unread answered `{supported:false}` before stage 11 (no badge). The existing thread shows its messages, and a reply from B (real route) appeared in A's open thread in 6 s without reload, with `after` polling.
- **Release regression found:** the world map opened on London at zoom 3 (MapView's default when it has no postings). Before this release it was handed every posting and fitted to them. On production, where the postings are in California, it showed "Explore the world · All categories · 0 postings in view". The caption itself was correct (a mojibake check in the smoke script was a harness bug).
  - **Fix forward (small, not a rollback):** `MapView` takes an optional `initialView`, and `WorldMapSection` opens on the whole world (`center [-30, 25]`, zoom 1). The first capped pin request then covers every region, and the existing fit-once logic zooms to the returned pins, as before the release. Test: `worldStartView.test.ts`.
  - Harness: `stage4.mjs` S and D3 now expect "exactly the pins the last response returned for the visible view" and a caption count equal to the pins inside the map. On a wide screen the whole-world view also holds the Berkeley fixtures.
  - Checks: typecheck, lint, `npm test` 67 files / 539 tests. `vitest.config.ts` `testTimeout: 30000`: three property tests had timed out at the 5 s default on a busy machine, with no counterexamples. Seed-mode build; Edge stage4 156/156, stage2 150/150, stage1 57/57.
