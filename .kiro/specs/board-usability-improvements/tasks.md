# Implementation Plan: Board Usability Improvements

## Overview

TypeScript on Next.js 15, React 19 and Supabase, tested with vitest and fast-check. Work happens on branch `feature/board-usability-improvements` in five stages, in order. Each stage is built, tested and verified in a real Microsoft Edge browser (playwright-core, as in `scripts/card-e2e` and `scripts/avatar-e2e`) before the next stage starts. Each stage ends with a checkpoint task.

**Stage 2 uses the Stage 4 map query.** The doorstep list loads its postings through `GET /api/postings/map` in `cards` mode. So the shared pieces are built at the start of Stage 2 (task 3): the pure `src/lib/mapBounds.ts` module with `selectForBounds`, the server `src/lib/mapQuery.ts`, and the route. Stage 4 then extends them with the world map (pins mode), the category filter on both maps, viewport loading, and the optional geo index draft. Nothing in Stage 4 changes the contract that Stage 2 depends on.

Rules that apply to every task (Requirement 20):

- No commits and no pushes unless the owner asks. Keep unrelated working-tree changes and `next-env.d.ts` out of this work. Run `git status` first and record what is already modified.
- Demo and verification postings exist only as test data (`src/lib/__fixtures__/board.ts`, `scripts/board-e2e/fixtures.mjs`). Never insert them into Supabase and never add them to `src/lib/seed.ts`.
- Browser checks run against a local production build (`npm run build`, then `next start`) with the Supabase variables set to empty strings in the process environment, at 390x844 and 1280x800, using mocked API responses and fixture data only. Do not publish postings, send messages, request location or camera permission, or change production data. Seed `localStorage["corkback.mapCenter"]` and stub `navigator.geolocation` in an init script. The user starts any long-running server themselves, or the harness starts and stops `next start` as the existing e2e scripts do. Do not start dev servers from the agent.
- Read `localStorage`, `window` and `Date.now()` only inside effects or event handlers in new or changed components (Requirement 20.9). Keep one dark-red main action per screen and use navy for secondary controls (Requirement 20.10).
- The React #418 hydration issue is out of scope.
- SQL files are drafts. They are tested only in the local embedded database under `supabase/isolated-test`, never against production.

## Tasks

- [x] 0. Setup, fixtures and browser harness
  - [x] 0.1 Create the working branch
    - Run `git status` and record existing uncommitted changes without touching them
    - Create and switch to `feature/board-usability-improvements` from `main`
    - Make no commits
    - _Requirements: 20.5, 20.7_
  - [x] 0.2 Create the fixture module and the fixture-data guard test
    - Create `src/lib/__fixtures__/board.ts` with generators and fixed fixtures (Berkeley, Richmond, listing categories, Community notices, many-posting sets). Every fixture id starts with `fx-`. Only `*.test.ts` files import it
    - Create `src/lib/fixtureGuard.test.ts` that fails if any `SEED_POSTINGS` id starts with `fx-`, or if any file under `src/` other than `*.test.ts` files and `src/lib/__fixtures__` imports `__fixtures__` or `scripts/board-e2e`
    - _Requirements: 20.5, 20.6_
  - [x] 0.3 Create the board browser harness and record the baseline
    - Create `scripts/board-e2e/` (`lib.mjs`, `fixtures.mjs`, `README.md`) following `scripts/card-e2e`: Playwright core driving installed Microsoft Edge, request interception for `/api/postings/map` and other mocked endpoints, empty Supabase variables, init script for `localStorage` and a stubbed `navigator.geolocation`, viewports 390x844 and 1280x800
    - Add shared checks: no horizontal scroll, tap targets at least 44 px (primary 50 px), exactly one dark-red main action
    - Run the baseline against the current build and record the measured map top edge and visible map height at 390x844 in `BUILD_LOG.md`. If Edge or Playwright cannot run, record exactly what is blocked and mark browser checks untested
    - _Requirements: 1.8, 1.9, 20.5, 20.10_

- [x] 1. Stage 1: Compact category filter
  - [x] 1.1 Create `src/lib/nearby.ts` with `filterByCategory`
    - Pure function: null returns the input, a slug returns only postings of that category
    - _Requirements: 1.6_
  - [x] 1.2 Write property test for the category filter
    - **Property 1: Category filter is a pure subset**
    - **Validates: Requirements 1.6**
  - [x] 1.3 Create `src/components/ui/CategoryFilter.tsx`
    - Client component with props `{ value, onChange, followed, signedIn }`: one navy-bordered trigger reading "Category: All" or "Category: {label}", `aria-haspopup`, `aria-expanded`, `aria-controls`
    - Popover overlays the map (no layout height change), lists "All categories" then each category once in `CATEGORIES` order, closes on Escape, outside click or selection and returns focus to the trigger. Panel contents render only while open
    - Each row has a select button (selected style dark red, `aria-pressed`) and the existing `CategoryFollowButton`, shown only when signed in. The selected category's follow control also shows next to the trigger when signed in
    - Tap targets at least 44 px
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.9, 20.10, 20.11_
  - [x] 1.4 Integrate into `HomeMap` and compact the header
    - Replace the 10 chip rows with `CategoryFilter`, keep `activeCategory` state in `HomeMap`, filter pins and cards with `filterByCategory`, keep the empty state with the category still selected
    - Hide the cork band subtitle below `sm`, group search, "Use my location" and the filter in one wrapping row, change the map height to `h-72 sm:h-96`
    - _Requirements: 1.6, 1.7, 1.8, 1.9_
  - [x] 1.5 Write the Stage 1 browser script
    - `scripts/board-e2e/stage1.mjs` at both viewports: map top edge at or above 55 percent of viewport height and at least 240 px of map above the bottom nav at 390x844, panel open and close by click, Enter, Space, Escape and outside click, focus returns to the trigger, follow controls absent when signed out, no horizontal scroll, tap targets
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.7, 1.8, 1.9_

- [x] 2. Checkpoint: Stage 1 verified
  - Run the Stage 1 tests, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
  - Run `scripts/board-e2e/stage1.mjs` in Microsoft Edge at 390x844 and 1280x800 against `next start` with mocked data only
  - Record every check as pass, fail or untested in `BUILD_LOG.md`, including the baseline comparison, and note what still needs a live two-account or device test (signed-in follow behaviour with a real account)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Stage 2 foundation: shared bounded map query (extended in Stage 4)
  - [x] 3.1 Create `src/lib/mapBounds.ts`
    - `MAP_CAPS` (pins 300, cards 100), `SNAP_DEGREES` 0.1, `parseBounds`, `snapBoundsOutward`, `boundsForRadius`, `pointInBounds` (edges inclusive), `selectForBounds` (category filter, bounds filter, order promoted first then newest then id descending, cap, `truncated`)
    - _Requirements: 6.3, 13.1, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.13_
  - [x] 3.2 Write property test for bounds parsing and snapping
    - **Property 33: Bounds parsing and snapping**
    - **Validates: Requirements 6.3, 13.3, 13.13**
  - [x] 3.3 Write property tests for bounded selection
    - **Property 31: Every returned posting lies inside the bounds**
    - **Validates: Requirements 13.5, 13.6, 13.7**
    - **Property 17: Map query result is bounded** (the `selectForBounds` part: `items.length <= cap`)
    - **Validates: Requirements 13.4**
  - [x] 3.4 Create `src/lib/mapQuery.ts` and `src/app/api/postings/map/route.ts`
    - `queryPostingsInBounds({ bounds, category, mode })`: filters `deleted_at`, `moderation_hidden_at`, `expires_at > now`, lat and lng range, optional category via inner join, order promoted first then `created_at` desc then id desc, `limit cap + 1`, then `isPostingActive` to drop ended events, `withCounts` and viewer likes only for returned rows
    - Route: public GET, `bounds` required, `category` must be a known slug, `mode` is `pins` (default when omitted) or `cards`, 400 on invalid bounds, category or mode with no rows, client cap or limit ignored, `Cache-Control` `public, s-maxage=30, stale-while-revalidate=60` for pins and `private, no-store` for cards, a server error status with `Cache-Control: no-store`, zero postings and a generic error body on failure, seed mode through `selectForBounds` over `SEED_POSTINGS`, no per-user logging of bounds
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9, 13.10, 13.11, 13.12, 20.2_
  - [x] 3.5 Write property test and route tests for the map query
    - **Property 17: Map query result is bounded** (route and `queryPostingsInBounds` against a stubbed Supabase client: never more than `MAP_CAPS[mode]`, requests at most `cap + 1` rows, ignores hand-made `limit` and `cap` parameters)
    - **Validates: Requirements 13.4**
    - Route example tests in the style of `category-follows/[slug]/route.test.ts`: 400 for missing, malformed, inverted, out-of-range and antimeridian bounds, unknown category, invalid mode; default mode is pins; cache headers per mode; failure gives a server error status, `no-store` and no internal detail; seed mode matches `selectForBounds`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.10, 13.11, 13.12_
  - [x] 3.6 Load the initial board postings through the capped query
    - In `src/app/page.tsx` replace the `listActivePostings()` call with the cards-mode query for the snapped box around the signed-in alert home point, or Berkeley, at 10 miles and no category; pass the result to `HomeMap`. The page no longer loads every active posting
    - Leave `listActivePostings` in place for its other callers (for example `follows.ts`) and do not change them
    - _Requirements: 6.1, 13.14_

- [x] 4. Stage 2: Nearby radius, distance, heading and bounded doorstep loading
  - [x] 4.1 Extend `src/lib/nearby.ts` with the nearby model
    - `RADIUS_OPTIONS_MILES`, `DEFAULT_RADIUS_MILES` (10), `METERS_PER_MILE`, `ReferenceKind`, `BoardReference`, `parseRadius`, `milesBetween`, `roundApproxMiles`, `formatApproxDistance`, `referenceLabel`, `radiusPhrase`, `referenceAfterSearch`, `buildBoardView` (membership by true distance, order promoted first then distance then id, `truncated` passthrough)
    - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 4.1, 4.2, 4.3, 4.4, 5.1_
  - [x] 4.2 Write property tests for the nearby set
    - **Property 2: Nearby equals category and radius**
    - **Validates: Requirements 3.1**
    - **Property 3: Radius is monotone**
    - **Validates: Requirements 3.2**
    - **Property 4: Pins and cards come from one set**
    - **Validates: Requirements 3.4**
    - **Property 5: Nearest-first ordering within groups**
    - **Validates: Requirements 3.3**
  - [x] 4.3 Write property tests for distance rounding and labels
    - **Property 6: Distance rounding is bounded and consistent with the radius**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.5**
    - **Property 7: Distance labels are coarse and carry no coordinates**
    - **Validates: Requirements 4.4, 4.7, 20.1, 20.4**
    - **Property 9: Zero distance reads as under half a mile**
    - **Validates: Requirements 4.4**
  - [x] 4.4 Write property tests for radius parsing, search centre and heading
    - **Property 8: Radius parsing falls back to the default**
    - **Validates: Requirements 2.2**
    - **Property 25: A place search sets the centre**
    - **Validates: Requirements 2.3**
    - **Property 26: Heading states the centre and radius**
    - **Validates: Requirements 2.1, 5.1**
  - [x] 4.5 Create the `useMapPostings` hook and its pure request model
    - `src/lib/useMapPostings.ts` plus a pure `mapRequestModel` (sequence numbers, abort, stale-response guard) usable without React: builds requests that carry only snapped bounds, category and mode; aborts the previous request; ignores responses that are not the latest or whose category no longer matches; supports a 400 ms debounce option for the world map
    - _Requirements: 6.2, 6.6, 6.7, 15.3, 15.4, 15.5, 20.2_
  - [x] 4.6 Write property tests for nearby loading and request contents
    - **Property 34: Nearby loading never loses a point inside the radius**
    - **Validates: Requirements 6.3, 6.4**
    - **Property 36: Map request carries only snapped bounds**
    - **Validates: Requirements 6.2, 20.2**
    - **Property 35: Stale responses never overwrite newer ones**
    - **Validates: Requirements 15.4, 15.5, 6.7**
  - [x] 4.7 Create `RadiusSelect` and the saved-centre and radius storage
    - `src/components/ui/RadiusSelect.tsx` with the five options (1, 3, 5, 10, 25), active option shown
    - Storage helpers: radius under `corkback.radiusMiles` (invalid values ignored), `SavedCenter` gains optional `kind` (old values read as `town` with a name, else `saved`); read and write only in effects or handlers; storage failures fall back to the in-visit value without an error
    - _Requirements: 2.1, 2.2, 2.5, 2.6, 2.7, 20.9_
  - [x] 4.8 Wire `HomeMap` to the nearby view
    - Hold reference, radius and category; choose the reference in the order explicit action, saved centre, alert home, Berkeley; a place search sets `referenceAfterSearch`; panning never changes it; "Use my location" failure or 10 s timeout keeps the reference and shows a message
    - Fetch through `useMapPostings` (cards mode, snapped radius box, category) and compute one `buildBoardView`; draw pins, cards and the heading "{n} posting(s) · Within {r} mi of {label}" from it; draw the navy dashed radius ring as its own layer; fit the ring on search or radius change; keep street zoom on device location and show the navy "Show full radius" button (only while the reference is the device location and the viewer has not since searched or changed the radius)
    - Empty state "Nothing within {r} mi of {place}" with the navy "Try {next} mi" button (1 to 3, 3 to 5, 5 to 10, 10 to 25); at 25 mi the same text shows with no button; truncated notice "Showing the first 100 postings. Choose a smaller radius to see them all."; on fetch failure keep previous cards and pins, show an error with a retry button, never fall back to loading everything; use the server-safe reference on first render
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.8, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.2, 6.4, 6.5, 6.6, 6.7, 20.1, 20.3_
  - [x] 4.9 Add the distance label to the card and grid
    - `PostingCard` takes optional `distanceLabel`, rendered in the metadata line; `PostingCardGrid` takes optional `distanceLabels` keyed by id. Callers outside the nearby list pass nothing and render unchanged
    - _Requirements: 4.1, 4.8_
  - [x] 4.10 Write the Stage 2 browser script
    - `scripts/board-e2e/stage2.mjs` with fixtures: search "Berkeley" with a fixture Richmond posting at 10 mi shows the card with "About n mi away" and the heading "Within 10 mi of Berkeley", hidden at 5 mi; pins equal cards; ring drawn; "Show full radius"; empty state and "Try" button; a 100+ fixture response shows the truncated notice; the request URL carries only snapped bounds and category; failed request keeps previous cards and shows retry; no horizontal scroll at both viewports
    - _Requirements: 2.3, 3.4, 4.1, 5.1, 5.2, 5.4, 5.7, 6.2, 6.6_

- [x] 5. Checkpoint: Stage 2 verified
  - Run the Stage 2 tests, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
  - Run `scripts/board-e2e/stage1.mjs` and `stage2.mjs` in Microsoft Edge at 390x844 and 1280x800 against `next start` with mocked data only; do not request location
  - Record results in `BUILD_LOG.md` and list what still needs a live device test ("Use my location" distances on a real phone, the radius ring on real tiles)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Stage 3: Category-specific posting fields
  - [x] 6.1 Create `src/lib/postingKinds.ts`
    - `PostingKind`, `LISTING_SLUGS`, `EVENT_OPTIONAL_SLUGS`, `categoryKind` (unknown slug is event), `fieldSpec(slug, { hasEventDate })` with the labels and button texts from the design table, `takedownInfo` built on the existing `postingTakedown` (reason `expiry`, `deadline` or `event_end`; ties name `expiry`)
    - _Requirements: 7.1, 7.2, 7.5, 7.6, 7.7, 7.8, 10.1, 10.2, 10.3_
  - [x] 6.2 Write property test and examples for kinds and field specs
    - **Property 10: Category kinds are total and correct**
    - **Validates: Requirements 7.1, 7.2, 7.6, 7.7, 7.8**
    - Example tests for every label and button text in Requirement 7.6 and 7.7
    - _Requirements: 7.5, 7.6, 7.7, 7.8_
  - [x] 6.3 Write property tests for takedown information
    - **Property 13: Takedown matches the lifecycle rule**
    - **Validates: Requirements 10.1, 10.2, 10.3**
    - **Property 28: Community takedown follows the date**
    - **Validates: Requirements 9.5, 9.6**
  - [x] 6.4 Add the listing and Community branches to `src/lib/postingInput.ts`
    - Listing: accept optional `deadline`, return `endDate` and null `eventDate`, `eventTime`, `endTime`; reject event fields ("Listings use a deadline instead of an event date."), past deadline in the posting's zone ("This deadline has already passed.", today allowed), bad format, unconfirmed year
    - Community: no event date means time, end date and end time must be null ("Add an event date first, or clear the time fields."); with an event date use the event rules; reject a `deadline`; edit rejects clearing the date of an ended posting ("This posting has ended. Clearing its date would put it back on the board.")
    - Event categories return exactly what they did before; publish and edit share the same checks; return shapes unchanged
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2, 9.3, 9.4, 9.7, 9.8_
  - [x] 6.5 Write property tests for listing validation
    - **Property 11: Listing validation**
    - **Validates: Requirements 8.1, 8.3, 8.4**
    - **Property 12: Event categories are unchanged** (existing event tests keep passing, plus a generated regression comparison)
    - **Validates: Requirements 8.7**
    - **Property 14: Publish and edit validate alike**
    - **Validates: Requirements 8.8**
  - [x] 6.6 Write property tests for Community validation and edits
    - **Property 27: Community validation**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4**
    - **Property 29: Community edit cannot revive an ended posting**
    - **Validates: Requirements 9.7, 9.8**
  - [x] 6.7 Make `PATCH /api/postings/[id]` write date fields by kind
    - Write `event_date`, `event_time`, `end_date` and `end_time` in one update by Posting_Kind (listing: only `end_date`; event: as before; event-optional: event rules or all four null); leave `rsvp_url` unchanged when the link equals the stored value, else write after the existing http(s) validation; clear a legacy `event_date` only when the client reports the replacement notice was shown; clear `event_time` and `end_time` on an event to listing change; a validation error leaves every stored column unchanged
    - _Requirements: 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_
  - [x] 6.8 Write property test and route tests for edit writes
    - **Property 16: Edit never changes data silently**
    - **Validates: Requirements 11.7, 11.8**
    - Route example tests with a stubbed Supabase client: write set per kind, event to listing change, validation error writes nothing, cancel sends no request
    - _Requirements: 11.4, 11.5, 11.6, 11.9_
  - [x] 6.9 Update `ReviewForm`
    - Fields and labels from `fieldSpec` on every category or date change; hidden fields keep typed values in state but only the current kind's fields are sent; Community date optional with its hint and Time, End date and End time disabled until a date exists; "Place (optional)" for listings; takedown line "Comes down on {date}: {reason}" under the expiry chips with the pin time zone note; scanned flyer date pre-fills the Deadline for listings, clearable, left empty when unreadable
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 8.9, 8.10, 9.2, 10.4_
  - [x] 6.10 Update `EditPostingForm`
    - Same field logic; takedown line recomputed within 200 ms of any change; shorter-takedown note of at most 120 characters; legacy event-date notice naming the stored date with the Deadline pre-filled and nothing written until save; event to listing notice before saving; Community clearable date; entered values kept on validation errors
    - _Requirements: 9.7, 9.8, 10.6, 10.7, 11.3, 11.4, 11.6, 11.9_
  - [x] 6.11 Update the detail page, card and grid
    - `src/app/p/[id]/page.tsx`: "On the board until {date}" with the reason from `takedownInfo`, deadline row for listings, action button text from `fieldSpec` ("RSVP" or "Learn more" for Community), no button without a link; `PostingCard` shows "{prefix} {date}" for a listing with a Deadline and no date line for a date-less Community posting or a listing without a Deadline; stored legacy `event_date` and `event_time` keep showing as before
    - _Requirements: 7.8, 7.9, 10.5, 10.8, 11.1, 11.2_
  - [x] 6.12 Write the Stage 3 browser script
    - `scripts/board-e2e/stage3.mjs` with mocked responses only (no publishing): form fields and labels per category, Community with and without a date (button text, takedown line, card with no date line), deadline and link labels, detail page rows, edit notice for a legacy-date fixture, ended-Community clear-date rejection from a mocked 400, no horizontal scroll, one dark-red action
    - _Requirements: 7.3, 7.4, 7.5, 7.6, 7.7, 9.5, 9.6, 9.7, 10.4, 10.5, 11.3_

- [x] 7. Stage 3: Alert job check and fix
  - [x] 7.1 Write the alert matching tests first
    - In `src/lib/alerts.test.ts` (extend the existing file): a listing with a Deadline matches until the end of the deadline day in its zone and never past `expires_at`; a Community notice with no event date matches until `expires_at`; a Community posting with an event date follows the event rule. Report anything surprising; change `src/lib/alerts.ts` only if a test shows it is wrong, using the shared lifecycle rule
    - _Requirements: 12.1, 12.2, 12.3_
  - [x] 7.2 Fix `buildAlertEmail` and the cron route
    - `src/lib/email.ts`: use `fieldSpec(slug).cardPrefix` for listings ("Apply by Dec 1"), keep "Date: ..." for events, omit the date line for date-less Community postings and listings without a Deadline, omit it and still send when a date cannot be parsed
    - `src/app/api/cron/alerts/route.ts`: pass `endDate` and `categorySlug` to the builder; do not change how postings are selected
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_
  - [x] 7.3 Write property test and examples for the alert email
    - **Property 30: Alert job handles listings and notices**
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6**
    - Example tests: no "null", "undefined" or "Invalid Date" in subject, text or HTML for any missing or present date combination; unparseable date omits the line and the job continues; route passes `endDate` and `categorySlug`
    - _Requirements: 12.4, 12.5, 12.6, 12.7, 12.8_
  - [x] 7.4 Record the alert job scale follow-up in `BUILD_LOG.md`
    - Add an entry stating that the alert job reads every active posting and loops alerts by postings, recorded as a scale follow-up outside this feature; make no change to how the job selects postings
    - _Requirements: 12.9_
  - [x] 7.5 Write the isolated database takedown check
    - Add `supabase/isolated-test/takedown.mjs`: load the existing `public.posting_takedown_at(timestamptz, date, date, time, text)`, defined in `supabase/stage6_social_part1.sql`, and compare it with `postingTakedown` for generated listing and Community rows, including zones across daylight saving changes, rows with only `end_date`, only `event_date`, or neither
    - The check runs only in the isolated local embedded PostgreSQL harness (`supabase/isolated-test`), never against production
    - Make no SQL change unless the check finds a mismatch. If it does, write the fix as a reviewed draft stage (with the usual "DRAFT. DO NOT APPLY. USER REVIEW REQUIRED." header) and do not apply it
    - **Property 15: Database and app agree on listing takedown (D)**
    - **Validates: Requirements 10.9**
    - _Requirements: 10.9, 10.10_

- [x] 8. Checkpoint: Stage 3 verified
  - Run the Stage 3 tests and `supabase/isolated-test/takedown.mjs`, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
  - Run the stage 1 to 3 browser scripts in Microsoft Edge at 390x844 and 1280x800 against `next start` with mocked data only; do not publish anything
  - Record results in `BUILD_LOG.md` and list what still needs a live test (a real posting in each listing category, edit and takedown line on production data, by the owner)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Stage 4: Filter on both maps, world map loading and geo index draft
  - [x] 9.1 Add `worldCaption` to `src/lib/nearby.ts`
    - Forms: "Explore the world · {category} · {n} postings in view" (singular "1 posting in view"), "Showing 300 of many postings in this view. Zoom in to see more." when truncated; never claims a total
    - _Requirements: 14.4, 14.5, 14.8_
  - [x] 9.2 Write property test for the world caption
    - **Property 18: World caption is accurate**
    - **Validates: Requirements 14.1, 14.4, 14.5, 14.8**
  - [x] 9.3 Refactor `MapView` to one map instance with marker sync
    - Create the map once, never call `map.remove()` on data change, keep a `Map<id, Marker>` and add, remove or leave markers by id through a pure `diffMarkers` helper, no refit on data change after the first load, report `moveend` bounds through `onBoundsChange`, `maxBounds` and `renderWorldCopies: false`
    - _Requirements: 15.1, 15.2_
  - [x] 9.4 Create `WorldMapSection` and move the world map under the shared category state
    - Client component using `useMapPostings({ mode: "pins" })` with a 400 ms debounce on `moveend`, the selected category sent on both the local and world requests (none for all categories), caption from `worldCaption`, "Updating…" after 300 ms with previous pins kept, retry button within 1 s of a failure (not for self-aborted requests), empty state "No {category} postings in this view." with the navy "Show all categories" button (44 px), `Show all categories` clears the category on both maps
    - `src/app/page.tsx` stops rendering `MapView` and loading world postings; `HomeMap` renders the section
    - _Requirements: 14.1, 14.2, 14.3, 14.6, 14.7, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 13.14_
  - [x] 9.5 Write marker sync and world map state tests
    - Example tests for `diffMarkers` (adds new ids, removes absent ids, leaves common ids untouched) and for the state transitions of the world map model (loading label, error with retry, self-abort is not an error)
    - _Requirements: 15.1, 15.2, 15.6, 15.7, 15.8, 15.9, 15.10_
  - [x] 9.6 Write property test for the category filter on both maps
    - **Property 32: Category filter is respected by both maps**
    - **Validates: Requirements 13.5, 14.1, 14.2, 14.3**
  - [x] 9.7 Write the stage12 geo index SQL drafts (do not apply)
    - `supabase/stage12_postings_geo_index_preflight.sql` (read-only: row count, whether `postings_active_geo_idx` exists, `lat` and `lng` types, existing indexes), `supabase/stage12_postings_geo_index.sql` (one transaction, `create index if not exists postings_active_geo_idx on public.postings (lat, lng) where deleted_at is null and moderation_hidden_at is null`, no row change, no `expires_at > now()`, comment about `create index concurrently` for a large table), `supabase/stage12_postings_geo_index_verify.sql` (index exists and is valid, predicate matches the query filters), `supabase/stage12_postings_geo_index_rollback.sql` (`drop index if exists`). Each header says "DRAFT. DO NOT APPLY. USER REVIEW REQUIRED."
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.11_
  - [x] 9.8 Test the geo index drafts in the isolated database
    - Add `supabase/isolated-test/geoindex.mjs` (local embedded PostgreSQL only): run preflight, migration twice, verify, rollback twice; assert a single index, no row changes, safe repeat runs, rollback without the index causes no error; include a mutation check as in `avatars.mjs`; confirm the map query returns the same rows with and without the index
    - _Requirements: 16.2, 16.3, 16.4, 16.7, 16.8, 16.9, 16.10_
  - [x] 9.9 Write the Stage 4 browser script
    - `scripts/board-e2e/stage4.mjs` with fixtures and request interception: selecting Sports drops Community pins on both maps, caption text, empty-category state and "Show all categories", a 5,000-posting fixture capped at 300 shows "Zoom in to see more", panning issues one debounced request and aborts the earlier one, a slow stale response is ignored, retry after a failed request, network log shows no request without snapped bounds and no coordinates of the viewer
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 15.3, 15.4, 15.5, 15.6, 15.8, 20.2_

- [x] 10. Checkpoint: Stage 4 verified
  - Run the Stage 4 tests and `supabase/isolated-test/geoindex.mjs`, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
  - Run the stage 1 to 4 browser scripts in Microsoft Edge at 390x844 and 1280x800 against `next start` with mocked data only
  - Record results in `BUILD_LOG.md`; note that the geo index SQL is drafted, not applied, and list what still needs live checks (world map on real tiles with real data)
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Stage 5a: Thread auto-refresh (no schema change)
  - [x] 11.1 Create `src/lib/messagePolling.ts`
    - `PollConfig`, `DEFAULT_POLL`, `pollDelayMs` (5 s, 15 s after 120 s quiet, backoff capped at 10 doublings, jitter 15 percent applied before the 1 s to 60 s clamp), `PollOutcome`, `createPoller` with injected `run`, `isHidden`, `now`, `setTimer`, `clearTimer`, `random`; one request in flight, no requests while hidden, `poke()`, stop on a `stop` outcome
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_
  - [x] 11.2 Write property test for poll delays
    - **Property 21: Poll delay is bounded and backs off**
    - **Validates: Requirements 17.1, 17.2, 17.4**
  - [x] 11.3 Write property test for the poller
    - **Property 22: Poller never overlaps or runs while hidden** (fake clock)
    - **Validates: Requirements 17.3, 17.5, 17.6, 17.7**
  - [x] 11.4 Add the `after` cursor to `GET /api/messages`
    - Optional `after` of at most 40 characters that `Date.parse` accepts, otherwise 400 with no messages and no change; add `.gte("created_at", after)`; participant check unchanged; first load without `after` returns the whole thread
    - Route example tests in the style of `category-follows/[slug]/route.test.ts`: 400 for overlong and unparseable `after`, inclusive bound, no `after` returns all
    - _Requirements: 17.8, 17.11_
  - [x] 11.5 Write property tests for message merge and the cursor
    - **Property 19: Message merge is idempotent and duplicate-free** (`mergeMessages`, tests only)
    - **Validates: Requirements 17.9**
    - **Property 20: Cursor fetch equals full fetch** (fake server with colliding timestamps)
    - **Validates: Requirements 17.8**
  - [x] 11.6 Run the poller in `ThreadView`
    - `run` fetches with `after` set to the unmodified `created_at` of the newest shown message (omitted when none), merges with `mergeMessages`, maps 401 and 404 to `stop` with the existing states, other failures to `retry`; show "Reconnecting…" while failing and remove it on success, keeping messages; `poke()` on visibility, focus and send; keep the "Check for new messages" button with the text "Updates automatically while this page is open." making one immediate request when none is in flight
    - _Requirements: 17.1, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9, 17.10_
  - [x] 11.7 Write the Stage 5a browser script
    - `scripts/board-e2e/stage5a.mjs` with mocked `/api/messages` responses only (no live accounts, no sending): new message appears without a reload, no duplicate, hidden tab pauses requests and one request follows on return, errors show "Reconnecting…" and back off, 401 and 404 states, no horizontal scroll
    - _Requirements: 17.1, 17.3, 17.4, 17.5, 17.6, 17.9_

- [x] 12. Stage 5b: Unread indicator and stage11 message reads SQL drafts
  - [x] 12.1 Write the stage11 message reads SQL drafts (do not apply)
    - `supabase/stage11_message_reads_preflight.sql` (read-only; reports whether `message_thread_reads` exists and whether `messages` and `message_threads` exist, and the backfill row count), `supabase/stage11_message_reads.sql` (one transaction, additive only: `message_thread_reads` with one row per thread and user, row level security with own-row select, insert and update only for threads the user takes part in, `cb_mark_thread_read` monotone and clamped to server time, raising for non-participants, `cb_unread_counts` counting only the other participant's messages after the marker, anon denied, backfill of one marker per existing participant at the thread's latest message `created_at`, or the thread's `created_at` when it has no message, skipping pairs that already have a marker, no change to `messages` or `message_threads`, safe to run twice), `supabase/stage11_message_reads_verify_roles.sql` (checks anon, a participant and a third user, reports pass or fail, leaves no data changed), `supabase/stage11_message_reads_rollback.sql` (drops only what the migration created, safe when not applied). Each header says "DRAFT. DO NOT APPLY. USER REVIEW REQUIRED."
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.11, 19.12, 19.13, 19.14, 19.15, 19.17_
  - [x] 12.2 Test the message reads SQL in the isolated database
    - Add `supabase/isolated-test/messagereads.mjs` (local embedded PostgreSQL only, never production): run preflight, migration, role verification, a second migration run (same rows) and rollback (messages and threads unchanged, and rollback on an unmigrated database); assert grants and RLS, a third user sees nothing, anon has no access, non-participant mark-read raises, earlier timestamp leaves the marker, future timestamp stores server time, backfill leaves existing threads at zero unread; include a mutation check as in `avatars.mjs`
    - **Property 24: Unread SQL matches the model (D)**
    - **Validates: Requirements 19.4, 19.5, 19.6, 19.7, 19.8, 19.9, 19.10, 19.12**
    - _Requirements: 19.14, 19.15, 19.16_
  - [x] 12.3 Create `src/lib/unread.ts`
    - Pure helpers: unread model for a viewer and marker, badge text ("9+" at 10 or more), accessible label ("Messages, N unread" or "Messages"), total from per-thread counts, and the client stop rules (`supported: false`, 401)
    - _Requirements: 18.3, 18.4, 18.8, 18.9, 18.11_
  - [x] 12.4 Write property test for unread counting
    - **Property 23: Unread count is exact and monotone**
    - **Validates: Requirements 18.3, 18.4, 18.6**
  - [x] 12.5 Create `GET /api/messages/unread` and `POST /api/messages/read`
    - Unread returns `{ supported, total, byThread }` using `cb_unread_counts`; missing table or function (`42P01`, `PGRST202`, `PGRST205`) returns `{ supported: false }` with status 200; other failures return an error status without changing the supported flag; 401 when signed out
    - Read calls `cb_mark_thread_read` with the `upTo` value sent by the client; never lowers or moves past server time; affects only the caller
    - Route tests with a stubbed Supabase client for each outcome
    - _Requirements: 18.1, 18.2, 18.3, 18.5, 18.6, 18.11_
  - [x] 12.6 Add the client unread hook, nav badge, inbox markers and mark-read
    - `useUnreadCount`: one fetch after mount, on window focus, on the `cb:unread-changed` window event (refresh within 1 s) and every 60 s while visible; none while hidden; stops after `supported: false` or a 401; on any other failure keeps the last counts, leaves `supported` unchanged and retries at the next scheduled refresh
    - `BottomNav`: dark-red badge with the total, or "9+" at 10 or more; Messages link `aria-label` "Messages, N unread" with the exact total N (for example "Messages, 12 unread" under a "9+" badge), or "Messages" with no badge at 0, from `unread.ts`; `InboxList`: dot, bold handle and visually hidden "Unread" for counts of 1 or more
    - `ThreadView`: one mark-read request with `upTo` equal to the newest shown `created_at` when new messages from the other person render while visible, skipped when not advanced, then dispatch `cb:unread-changed`
    - Nothing shows when unread is unsupported
    - _Requirements: 18.1, 18.2, 18.5, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12, 20.12_
  - [x] 12.7 Write the Stage 5b browser script
    - `scripts/board-e2e/stage5b.mjs` with mocked `/api/messages/unread` and `/api/messages/read` only: badge "9+" and accessible label, inbox markers, no badge when unsupported, no repeated requests after a 401, no requests while hidden, no horizontal scroll
    - _Requirements: 18.1, 18.8, 18.9, 18.10, 18.11, 18.12_

- [x] 13. Final checkpoint: Stage 5 verified
  - Run the Stage 5 tests and `supabase/isolated-test/messagereads.mjs`, then `npm run typecheck`, `npm run lint`, `npm test` and `npm run build`
  - Run all browser scripts in Microsoft Edge at 390x844 and 1280x800 against `next start` with mocked data only
  - Record results in `BUILD_LOG.md`: every check as pass, fail or untested, the stage11 and stage12 SQL as drafted and not applied, and what still needs a live two-account or device test (a real two-account thread, background-tab pause on a phone, unread badge after the owner applies the SQL, location distances on a real phone, a real posting in each listing category)
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tests are required here (none are optional) because the owner asked for focused tests on the changed behaviour.
- Property numbers refer to the Correctness Properties in `design.md`. Properties 15 and 24 run in the isolated local database, not in vitest.
- Applying any SQL (`stage11_message_reads*.sql`, `stage12_postings_geo_index*.sql`), production migrations, pushing and deployment are out of scope for this plan. They are a separate owner review. Until the owner applies the stage11 SQL, the unread indicator ships dark.
- The React #418 hydration issue is out of scope.
- No commits or pushes happen unless the owner asks.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2", "0.3"] },
    { "id": 2, "tasks": ["1.1"] },
    { "id": 3, "tasks": ["1.2", "1.3"] },
    { "id": 4, "tasks": ["1.4"] },
    { "id": 5, "tasks": ["1.5"] },
    { "id": 6, "tasks": ["3.1", "4.1"] },
    { "id": 7, "tasks": ["3.2", "3.3", "3.4", "4.2", "4.3", "4.4", "4.7"] },
    { "id": 8, "tasks": ["3.5", "3.6", "4.5", "4.9"] },
    { "id": 9, "tasks": ["4.6", "4.8"] },
    { "id": 10, "tasks": ["4.10"] },
    { "id": 11, "tasks": ["6.1", "7.1"] },
    { "id": 12, "tasks": ["6.2", "6.3", "6.4", "7.2"] },
    { "id": 13, "tasks": ["6.5", "6.6", "6.7", "7.3", "7.4", "7.5"] },
    { "id": 14, "tasks": ["6.8", "6.9", "6.10", "6.11"] },
    { "id": 15, "tasks": ["6.12"] },
    { "id": 16, "tasks": ["9.1", "9.3", "9.7"] },
    { "id": 17, "tasks": ["9.2", "9.4", "9.5", "9.6", "9.8"] },
    { "id": 18, "tasks": ["9.9"] },
    { "id": 19, "tasks": ["11.1", "11.4", "11.5", "12.1", "12.3"] },
    { "id": 20, "tasks": ["11.2", "11.3", "11.6", "12.2", "12.4", "12.5"] },
    { "id": 21, "tasks": ["11.7", "12.6"] },
    { "id": 22, "tasks": ["12.7"] }
  ]
}
```
