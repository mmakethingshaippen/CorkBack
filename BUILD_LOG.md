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
