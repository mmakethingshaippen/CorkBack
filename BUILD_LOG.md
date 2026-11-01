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
