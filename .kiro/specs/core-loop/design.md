# Core Loop — Design

This document justifies the stack, defines the schema and the **day-one data model**, and maps the locked tokens and rules onto components. It covers Stage 1 (accounts, scan/review, post, map browse, posting page) while landing the schema for every later stage.

---

## 1. Stack and justification

| Concern | Choice | Why |
|---|---|---|
| App framework | **Next.js (App Router) + TypeScript** | Server Components + Route Handlers let flyer extraction and email sending run server-side only, keeping the Gemini and Resend keys off the client. One deploy target for UI + API. |
| Styling | **Tailwind CSS** | Tokens map cleanly to a tiny theme (see `tailwind.config.ts`). Enforces the restrained palette; no ad-hoc colors. |
| Hosting | **Vercel** | First-class Next.js hosting; required public app URL; cron for expiry sweeps. |
| Data + Auth | **Supabase (Postgres)** | Postgres gives relational integrity for the Follow/Connect/Like/plan graph. Supabase Auth provides **email login** with no full-name collection, matching the account model. Row Level Security enforces "public read, owner write." PostGIS enables geo queries for map bounds and alert radius. |
| Map | **MapLibre GL + free tiles** | Real interactive map, no API key, no proprietary tiles or Figma fragments in the repo. Custom style gives the darker-tan local-map look. |
| Flyer extraction | **Gemini (server-side only)** | Multimodal: image → structured JSON. Called only from a Route Handler; `GEMINI_API_KEY` never reaches the client. |
| Email alerts | **Resend** | Simple transactional email for Stage 2 radius alerts. Key stays server-side. |

No other paid service is locked without asking first.

### Trust boundary
Client → Next.js Route Handlers (server) → Gemini / Resend / Supabase service role. The browser only ever holds the Supabase **anon** key (RLS-guarded). Gemini, Resend, and the Supabase service-role key live only in server env.

---

## 2. Day-one data model

All entities and relations below are created on day one, even though the social and promotion surfaces ship in later stages. This satisfies requirement 8.

### Entities

- **profiles** — `id` (uuid, = auth user id), `username` (unique, 3–20, `^[A-Za-z0-9_]{3,20}$`), `created_at`. No full name. Email lives in the private auth table, never joined into public views.
- **categories** — `id`, `slug`, `label`. Seeded: Music, Sports, Clubs, Lost & Found, Meetup, Sale, Classes, Community (from the Figma chips).
- **postings** — `id`, `author_id → profiles`, `title`, `body`, `category_id → categories`, `flyer_url`, `rsvp_url` (nullable, at most one), `event_date` (nullable), `event_time` (nullable), `place_label` (free text, the nudged board/venue), `lat`, `lng` (the actual pinned location, bounded near the poster), `expires_at`, `is_promoted` (bool, always false in Stage 1; labeled on the listing when true), `created_at`, `deleted_at` (nullable, soft delete so pins vanish immediately).
- **likes** — `(posting_id, user_id)` unique. Postings only.
- **plans** — `(posting_id, user_id)` with `kind ∈ {going, interested}`. One row per user per posting.
- **follows** — `(follower_id, followee_id)`, one-way. Never implies a connect.
- **connections** — `(requester_id, addressee_id, status ∈ {pending, accepted})`, two-way. Never implies a follow.
- **hidden_postings** — `(user_id, posting_id)` so a user can hide a posting from their own view.
- **replies** — `(id, posting_id, author_id, body, created_at)` public comments on a posting. No Like on replies. (Private DMs are a Stage 3 table; schema stub noted, not built now.)
- **alerts** — `(id, user_id, category_id nullable, center_lat, center_lng, radius_miles, created_at)` for Stage 2; table created day one, UI later.

### Key invariants (enforced in code + DB, verified by property tests in later stages)
- **Username**: matches `^[A-Za-z0-9_]{3,20}$` and is unique.
- **Expiry**: `expires_at = created_at + preset`, preset ∈ {24h, 3d, 1w, 2w, 1m}. If `event_date` is set, effective takedown = `min(expires_at, end-of event_date)`.
- **Pin proximity**: stored `(lat,lng)` is within a bounded offset of the poster's captured location (short nudge only). Exact poster location is never exposed in any public API response.
- **Follow/Connect independence**: mutating a follow row never touches connections and vice versa.

### RLS posture
- `postings`, `profiles` (username only), `likes` counts, `replies`: public read.
- Writes to `postings`, `likes`, `plans`, `follows`, `connections`, `hidden_postings`, `replies`: authenticated, owner-scoped.
- Exact `lat/lng` precision: public reads receive the pinned location (already nudged); no separate "real device location" column is ever exposed.

---

## 3. Scan → review → publish flow

1. **Capture** (`/scan`): camera or choose-photo. Mirrors `scan_capture_a_flyer`. Dark-red "Capture & review" is the one main action; "Choose from photos" is secondary.
2. **Extract** (server Route Handler `POST /api/scan/extract`): upload image to storage, call Gemini with a JSON schema prompt, return `{title, event_date, event_time, place_label, category_slug, rsvp_url?}`. Key is server-only. Nothing is public yet.
3. **Review** (`/scan/review`): mirrors `scan_review_ready_to_publish`. Every field editable. Category chips, expiry presets (24h/3d/1w/2w/1m), optional RSVP link, "Use my current pin — Location allowed" block. Dark-red "Publish to the map" is the one main action.
4. **Publish** (`POST /api/postings`): requests/confirms current location, computes `expires_at`, writes the posting, redirects to its posting page. Only now is it public.

---

## 4. Screen map (Figma reference → route)

| Figma reference | Route | Notes |
|---|---|---|
| `home_map_public` | `/` | Public map + "On your doorstep" / "A little further afield" posting rails. Scan a flyer (dark red) + Set an alert (navy). |
| `scan_capture_a_flyer` | `/scan` | Capture/choose. |
| `scan_review_ready_to_publish` | `/scan/review` | Editable extracted fields. |
| `published_on_the_map` | `/` (signed-in) | "You're on the board" confirmation band. |
| `posting_london_concert` | `/p/[id]` | Event posting (An evening of quiet sounds). |
| `posting_berlin_lost_cat` | `/p/[id]` | Lost & Found (Miso is missing). |
| `posting_mexico_city_market` | `/p/[id]` | Community (Mercado del barrio). |
| `foundations_paper_and_ink` | n/a | Token source (steering). |
| `desktop_local_map` | `/` (desktop) | Desktop layout, Discovery sidebar stays Paper. |

Social screens (`following_*`, `friends_*`, `poster_profile_*`) and `alerts_setup` are later stages; `/u/[username]` exists only as the navy `@handle` link target with a minimal poster profile in Stage 1.

---

## 5. Component inventory (built before screens)

Primitives carrying the tokens:
- **Wordmark** — text, Kalam Bold, "Back" dark red, navy label, white text. No vector file.
- **Card** — white surface, Board border, 13px corners, **uneven tilt 2°–8°** via a deterministic-but-varied per-id rotation (no mirrored pair, no uniform rule — Choice B).
- **CorkBand** — procedural cork header/empty-state wrapper (Choice A), `.cork-band`.
- **CategoryChip** — white chip, navy border; selected = dark red fill.
- **PrimaryAction** — dark red, 50px radius; exactly one per screen.
- **SecondaryAction** — navy or neutral.
- **Field** — white, 2px navy border.
- **Pin** — dark red map marker.
- **PosterHandle** — navy `@handle` link.
- **PlanControls** — Going / Interested.
- **LikeButton** — postings only.
- **SignInToTakePart** — the no-account affordance.
- **BottomNav** — Map · Following · Scan · Friends · Alerts (Scan centered).

### Card tilt algorithm (Choice B)
A card's rotation is derived from its id so it is stable across renders but visually irregular: hash the id → map into [2°, 8°], pick sign from a different bit, and skip any value that would mirror the previous card's angle. No two adjacent cards form a mirrored pair; there is no uniform step.

---

## 6. Icon handling (components-before-screens)

Pick **one canonical SVG per icon** and delete duplicates from the assets folder. Canonical set: search, map, users, bell, scan line, layers, flag, share, copy, send, eye off, reply, chevron down, arrow left, message circle, calendar days, clock, map pin, image, camera, external link, eye, circle user round, radius handle, pin, posting card pin, empty-state note pin, London pin, CB pin C. **Do not ship** phone status-bar art (iOS wifi/battery/signal) or map illustration fragments (Main streets, Residential streets, Regent Canal, Continents, Neighbourhood sun, Sound waves). Categories are text chips; there is no category icon set.

Since Stage 1 recreates icons as needed and the Figma file stays out of the repo, icons are added as clean inline SVG components under `src/components/icons/` as each is actually used — no bulk import of the 82 files.

---

## 7. Verification plan (live, before Stage 1 sign-off)

1. `npm run typecheck` and `npm run build` pass.
2. Visitor (no account) loads `/`, sees the map + pins, opens a posting — no login prompt.
3. Visitor action (Like/post/reply/alert) is gated to sign-in.
4. Sign-up enforces the username rule and never asks for a full name; email never shown.
5. Scan: photo → Gemini extraction → editable review → Publish creates a public posting pinned near the poster, with the chosen category and expiry.
6. Event posting with a past event date does not show on the map.
7. Map pins are dark red; local map background is darker tan.
8. Posting page shows all required fields and the navy `@handle`.
9. Token/Choice audit: one dark-red action per screen, cork only on bands/empty states, cards tilt 2–8° unevenly, Kalam everywhere.

Property-based tests (land the first one during Stage 1 implementation): username validator against `^[A-Za-z0-9_]{3,20}$`; expiry = created + preset; pin stays within the bounded offset.
