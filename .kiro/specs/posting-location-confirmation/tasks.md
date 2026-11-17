# Implementation Plan: Posting Location Confirmation

## Overview

TypeScript on Next.js 15, React 19, Supabase and MapLibre, tested with vitest and fast-check. Work happens on branch `feature/posting-location-confirmation`, created from `main` at `40ac4ad`, in six stages. Each stage ends with a checkpoint task. The browser stage uses a scratch harness in `scripts/location-e2e/`, in the pattern of `scripts/board-e2e/`.

Stage order: pure modules first (draft state machine, approximate pin, normalizers, contact and leak detection, geocoder query and config, labels), then the server contracts (validators, routes, geocoder route with its shared store, scan route), then the stage 14 SQL with its local database tests, then the UI, then the browser checks, then the release preparation.

Stages 0 to 6 are complete. Stage 7 (tasks 13 to 15) is a follow-up on the same branch that routes the home-page search and the alerts lookup through the shared `/api/geocode` service (adding a `purpose` parameter and an anonymous place-search path), adds a shared additive anonymous rate limit in a new, additive `stage15` migration, keeps a private-home address off public Nominatim, audits approximate-mode privacy and copy, corrects the release checklist against the actual SQL object names, and re-verifies the branch and refreshes the protected preview. Stage 7 does not reopen stages 0 to 6 or the stage 14 SQL.

Rules that apply to every task (Requirements 16, 17, 19, 20):

- No SQL is applied to any production database. The stage 14 SQL (preflight, migration, role-based verify, rollback) is prepared and exercised only in the local embedded database under `supabase/isolated-test` (`CB_ISO_DIR`). The production migration, the production deployment and the setting of production environment variables stay pending the Owner's review.
- Work on `feature/posting-location-confirmation`. Run `git status` first and record what is already modified. Leave unrelated working-tree changes alone. Keep `next-env.d.ts` and `supabase/.temp/` out of every commit: stage files by explicit path, and check `git diff --cached --name-only` before each commit. Do not edit `.gitignore` for this. Commit locally at checkpoints only. Do not push, and do not touch `main`.
- Add no dependency to `package.json`. Playwright core is installed in a scratch folder outside the repo.
- Demo and test data (flyers, matches, postings, contact strings) live only in `src/lib/__fixtures__/location.ts` and `scripts/location-e2e/fixtures.mjs`. Never put them in `src/lib/seed.ts` or in any database.
- No test and no harness contacts a real geocoder or a production service. Route tests stub `fetch` and the geocoder store. Browser checks run against a local production build made from a copy without `.env.local`, with mocked scan, geocoder and posting routes, a stubbed `navigator.geolocation`, and a local mock Supabase. The harness starts and stops `next start` itself. Do not start dev servers from the agent.
- The new location modules import nothing from `boardStorage`, `geoPermission`, `HomeMap` or `nearby` (Requirement 7.9). Read `window`, `localStorage` and `navigator` only in effects and event handlers. The posting flow stays independent of the home browsing location.
- Existing postings stay unchanged until their owners edit and save them (Requirement 13.1). The migration touches no existing row.
- Keep one dark-red main action per screen. "Yes, use this place" and the other picker buttons are navy or neutral (Requirement 14.8).
- Every property-based test is required. Each runs at least 100 iterations (Requirement 17.7), except the database concurrency property (task 5.5), which runs 100 randomized rounds against the isolated database.
- Public Nominatim is disabled whenever a policy condition cannot be met (Requirement 19.7). The route then makes no upstream call, and manual pin placement and publishing keep working.
- The steering file `.kiro/steering/location-rules.md` was updated together with this spec (Requirement 15). Task 7.7 checks that it still matches the code.

## Tasks

- [x] 0. Setup and fixtures
  - [x] 0.1 Create the working branch
    - Run `git status` and record existing uncommitted changes without touching them
    - Confirm `main` and `origin/main` are at `40ac4ad`, then run `git switch -c feature/posting-location-confirmation 40ac4ad`
    - Confirm that `next-env.d.ts` and `supabase/.temp/` show as modified or untracked only, and that no later `git add` includes them
    - _Requirements: 16.5, 16.8_
  - [x] 0.2 Create the fixture module and extend the fixture guard
    - Create `src/lib/__fixtures__/location.ts` with fixed fixtures: a flyer with a home-looking address, a flyer with three addresses (venue, contact, return), a flyer with none, two matches 3 km apart (ambiguous), two matches 40 m apart, an area-level match, a street-level match with `addressLine` and `area`, a list of phone and email strings, and a list of look-alike strings (times, dates, prices, years, postcodes). Fixture ids start with `fx-`. Only `*.test.ts` files import the module
    - Extend `src/lib/fixtureGuard.test.ts` so the guard also covers the new fixture file and allows `src/lib/__testing__/legacyClamp.ts` to be imported only by tests and `__testing__` code
    - _Requirements: 16.10, 17.1, 17.2, 17.3, 17.4_

- [x] 1. Stage 1: Pure location modules
  - [x] 1.1 Preserve the validator oracle before the clamp is removed
    - Create `src/lib/__testing__/legacyClamp.ts` with a byte-for-byte copy of `MAX_NUDGE_METERS`, `clampPinNudge` and its private helpers from `src/lib/domain.ts`, with a header comment that it is a test-only copy
    - Change the import line of `src/lib/__testing__/postingInputBaseline.ts` to take `clampPinNudge` from `./legacyClamp`. Change nothing else in the baseline
    - Run `npx vitest run src/lib/postingInput.listing.test.ts` and confirm it still passes
    - _Requirements: 15.5_
  - [x] 1.2 Create `src/lib/geocode.ts`
    - `LatLng`, `PlaceMatch`, `MatchLevel`, `AMBIGUOUS_METERS = 250`, `normalizeNominatim`, `matchLevel`, `isAmbiguous` as in the design (the URL builder lives in `geocodeQuery.ts`)
    - `normalizeNominatim` never throws, drops rows with invalid coordinates, keeps at most 5, removes rows within 25 m of an earlier row with the same display name. `address.house_number` or a venue-type `category` gives level `address`, everything else `area`
    - Use `haversineMeters` from `src/lib/domain.ts`
    - _Requirements: 4.1, 4.3, 4.5_
  - [x] 1.3 Write property test for geocoder normalizing and ambiguity
    - **Property 6: Geocoder results are normalized and ambiguity is order-independent**
    - **Validates: Requirements 4.1, 4.3, 4.5**
    - File: `src/lib/geocode.test.ts`
  - [x] 1.4 Create `src/lib/addressCandidates.ts`
    - `AddressCandidate`, `CandidateKind`, `normalizeAddressCandidates`, `normalizeAddressText`, `parseStoredExtraction`, `serializeExtraction`, `MAX_CANDIDATES`, `MAX_CANDIDATE_TEXT`
    - Add the optional `addresses?: AddressCandidate[]` field to `ExtractedFlyer` in `src/lib/types.ts`
    - _Requirements: 2.3, 2.4, 2.7, 2.8_
  - [x] 1.5 Write property tests for candidates and the saved extraction
    - **Property 4: Address candidates are bounded and well-formed**
    - **Property 5: Saved extraction round trip**
    - **Validates: Requirements 2.3, 2.4, 2.7, 2.8**
    - File: `src/lib/addressCandidates.test.ts`
  - [x] 1.6 Create `src/lib/contactDetails.ts`
    - `findContactDetails` and `hasContactDetails` with the email pattern, the phone patterns, the boundary rules and the look-alike exclusions (times, dates, prices, years, five-digit and ZIP+4 postcodes) from the design. Never throws, never changes its input
    - _Requirements: 11.7, 11.8, 11.9, 18.4_
  - [x] 1.7 Write property test for contact detection
    - **Property 19: Phone numbers and email addresses are found, and ordinary numbers are not**
    - **Validates: Requirements 11.7, 11.8, 11.9**
    - File: `src/lib/contactDetails.test.ts`, with generated phone and email strings in each listed form, generated look-alikes, and exact-string examples for `7:30`, `2025-06-14`, `06/14/2025`, `$1,250.00`, `2025`, `94704`, `94704-1234`, `510-555-0142`, `(510) 555-0142`, `+1 510 555 0142`, `555-0142`
  - [x] 1.8 Create `src/lib/postingLocation.ts`
    - Types, constants (`APPROX_MIN_METERS = 150`, `APPROX_MAX_METERS = 400`, `STALE_LABEL_METERS = 100`, `DEFAULT_VIEW`), `emptyDraft`, `locationReducer` (including `search_failed` and `location_save_failed`, which change only `notice`), `publishableLocation`, `publicPin`, `approximatePin`, `circleRing`, `nudgePin`, `locationNote`, with the reducer rules from the design
    - In `src/lib/domain.ts`, export `destinationPoint` (the existing private helper). Do not remove the clamp yet
    - Import only from `domain.ts`, `geocode.ts` and `addressCandidates.ts`
    - _Requirements: 1.4, 3.1, 3.3, 3.4, 3.5, 3.6, 4.3, 4.4, 4.7, 5.2, 5.3, 5.4, 6.3, 7.3, 7.8, 9.2, 9.4, 9.5, 9.6, 9.7, 9.8, 9.10, 9.11, 10.1, 10.2, 10.3, 10.4, 10.5, 13.13, 19.9_
  - [x] 1.9 Write property tests for the draft state machine
    - **Property 7: Only "Yes" confirms, and it confirms exactly the proposal**
    - **Property 8: The publish payload comes only from the confirmed point**
    - **Property 10: The approximate pin is stable and does not leak the exact point**
    - **Property 12: The place label and the pin agree**
    - **Validates: Requirements 1.4, 3.1, 3.3, 3.4, 3.5, 3.6, 4.3, 4.4, 4.7, 5.2, 5.3, 6.3, 7.3, 9.5, 9.6, 9.7, 9.8, 10.1, 10.2, 10.3, 10.4, 10.5, 13.4, 13.13, 19.9**
    - File: `src/lib/postingLocation.draft.test.ts`, with generated event sequences checked against a small reference model
  - [x] 1.10 Write property tests for the approximate pin and the nudge
    - **Property 9: The approximate pin stays inside its bounds and is never the exact point**
    - **Property 11: A pin nudge moves the point by the step**
    - **Validates: Requirements 5.4, 9.2, 9.4**
    - File: `src/lib/postingLocation.geo.test.ts`
  - [x] 1.11 Add `locationLabels` to `src/lib/postingKinds.ts`
    - `locationLabels(slug, { hasEventDate })` returning `{ field, detail, hint }` as in the design table
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_
  - [x] 1.12 Write property test for location labels
    - **Property 14: Every category has a location label**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.6**
    - File: `src/lib/postingKinds.location.test.ts`
  - [x] 1.13 Create `src/lib/addressLeaks.ts`
    - `findAddressLeaks` (street addresses, candidates, and phone and email through `findContactDetails`), `canPublishWithLeaks`, `imageAddressWarning`, using `normalizeAddressText` from `addressCandidates.ts` and the street pattern from the design
    - The function reads its input and never changes it
    - _Requirements: 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.10, 11.11, 11.12_
  - [x] 1.14 Write property test for address leaks
    - **Property 13: Address leaks are found in any field and nowhere else**
    - **Validates: Requirements 10.7, 11.1, 11.2, 11.3, 11.4, 11.5, 11.7, 11.12**
    - File: `src/lib/addressLeaks.test.ts`, including an assertion that the three input strings are unchanged and that a public venue address, phone number and email stay in the text
  - [x] 1.15 Create `src/lib/deviceLocation.ts`
    - `requestDeviceLocation(nav?)` makes one `getCurrentPosition` call (timeout 10 s, `maximumAge: 0`) and maps errors to `unsupported`, `denied`, `unavailable` and `timeout`. It saves nothing to storage
    - This is the only file in the posting flow that references `navigator.geolocation`
    - _Requirements: 6.2, 6.3, 7.2, 7.6_
  - [x] 1.16 Create `src/lib/geocodeQuery.ts`
    - `prepareGeocodeQuery` (trim, collapse whitespace, cap at 200, refuse `too_short` and `contains_contact`), `buildGeocodeUrl` (only `q` as free text, fixed format parameters, optional provider key), `normalizeForCache`, `cacheKey` (hex HMAC-SHA256 over provider host and normalized query, with `node:crypto`; the file is server and test only, and the picker imports only `prepareGeocodeQuery` from a browser-safe split `geocodeQueryPrepare.ts` if the bundler needs it)
    - _Requirements: 18.2, 18.3, 18.4, 18.6, 19.6, 20.4_
  - [x] 1.17 Write property tests for the geocoder query and cache key
    - **Property 18: The upstream request carries only the prepared query** (unit part)
    - **Property 20: A query with contact details is refused and sends nothing** (unit part)
    - **Property 23: The cache key is an HMAC and never contains the query** (key part)
    - **Validates: Requirements 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 20.4**
    - Files: `src/lib/geocodeQuery.test.ts` and `src/lib/geocodeQuery.cache.test.ts`
  - [x] 1.18 Create `src/lib/geocoderConfig.ts`
    - `resolveGeocoderConfig(env)` and `isValidUserAgent` as in the design: disabled unless Supabase URL and service key, an `https` endpoint, a valid User-Agent with a contact, and a cache secret of at least 32 characters are present. Never throws, never returns the secret in a reason
    - _Requirements: 19.3, 19.6, 19.7, 19.9_
  - [x] 1.19 Write property test for the disabled configuration
    - **Property 24: Disabled, busy and refused requests make no upstream call** (config part)
    - **Validates: Requirements 19.7, 19.9**
    - File: `src/lib/geocoderConfig.test.ts`, with generated environments that each break at least one condition, and examples of valid and invalid User-Agent strings
  - [x] 1.20 Write the focused scenario tests
    - `src/lib/postingLocation.scenarios.test.ts`: scanning at home (no device position, no proposal, `publishableLocation` is `null`), multiple addresses (three candidates, confirm only the venue), no address (empty list, tap, confirm, valid payload), ambiguous matches (3 km apart, no proposal until selected), denied location permission (stub navigator, `device_failed`, manual pin publishes), corrected pins (candidate confirmed, pin dragged 400 m, `confirmed` is `null`, derived label cleared, publish refused, new confirm publishes the dragged point), search unavailable (`search_failed` leaves the draft and a manual pin publishes), query refused (a flyer line containing a phone number is not sent), location save failure (`location_save_failed` keeps the chosen pin and the payload), contact details (phone and email in each field warn, venue contact text is unchanged, look-alikes do not warn)
    - Add `deviceLocation` example tests with a stub navigator for granted, denied, unavailable, timeout and absent
    - _Requirements: 6.2, 6.3, 7.5, 11.7, 11.8, 13.13, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8, 17.9, 17.10_

- [x] 2. Checkpoint - Stage 1
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Stage 2: Server contracts
  - [x] 3.1 Switch `validatePostingInput` to the location block and retire the clamp
    - In `src/lib/postingInput.ts`, read `location` (finite coordinates in range, `confirmed === true`, `source` from the allowed list, `precision` `exact` or `approximate`). Return `pin` equal to the submitted point, `precision`, and `timeZone = timeZoneForPin(pin)`. Reject missing, unconfirmed, malformed and retired `real` and `desired` input with the messages in the design. Use the new pin zone for the listing and event date checks
    - Delete `MAX_NUDGE_METERS`, `clampPinNudge` and `bearingRad` from `src/lib/domain.ts` and fix the file comment. Keep `haversineMeters` and `destinationPoint`
    - Update the existing tests: remove the "pin nudge rule" block from `domain.test.ts` and the clamp and raw-location tests from `postingInput.test.ts`, change `real` to `location` in `postingInput.test.ts`, `postingInput.kinds.test.ts`, `postingInput.community.test.ts`, `postingInput.listing.test.ts` (add the adapter that maps `location` to `real` and `desired` for the baseline call) and `postingEdit.test.ts`
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 9.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.8, 12.9, 15.4, 15.5_
  - [x] 3.2 Write property tests for the publish validator
    - **Property 1: Publish requires a confirmed, valid location block**
    - **Property 2: The submitted point is the pin, the zone follows the pin**
    - **Property 3: Date rules are judged in the zone of the pin** (publish part)
    - **Validates: Requirements 1.1, 1.2, 1.5, 1.6, 1.7, 9.9, 12.1, 12.2, 12.3, 12.4, 12.5, 12.9**
    - File: `src/lib/postingLocation.validate.test.ts`
  - [x] 3.3 Add the optional location block to `validatePostingEdit`
    - Extract `validateLocationBlock` in `src/lib/postingInput.ts` and use it from `validatePostingInput`, `validatePostingEdit` and the retry route. Accept the same `location` shape in the edit. Return `location: { pin, precision, timeZone } | null` in `ValidatedEdit`. Run the date checks in `location.timeZone` when present and in `ctx.timeZone` otherwise. Return the stored values untouched when `location` is absent
    - _Requirements: 13.5, 13.6, 13.8_
  - [x] 3.4 Write property tests for the edit validator
    - **Property 3: Date rules are judged in the zone of the pin** (edit part)
    - **Property 17: An edit with a location returns the new pin, precision and zone** (validator part)
    - **Validates: Requirements 12.5, 13.6, 13.8**
    - File: `src/lib/postingLocation.edit.test.ts`
  - [x] 3.5 Update `POST /api/postings`
    - Insert `location_precision` from the validated request, keep the zone check, store no `source`, device position or candidate text. Update the route comment
    - _Requirements: 12.4, 12.6, 12.7_
  - [x] 3.6 Update `PATCH /api/postings/[id]`
    - Pass the new-pin zone into the validator context when a `location` is present. Run the content update first. Then, only when `location` is present, call `rpc("cb_update_posting_location", { p_posting_id, p_lat, p_lng, p_time_zone, p_precision })`. Map function errors: `CB404` and `CB409` to 409 `unavailable`, `22023` to 400 `invalid`, anything else to 500 `location_failed` with the message "Your other changes were saved, but the location was not."
    - Leave `lat`, `lng`, `time_zone` and `location_precision` out of the content update
    - _Requirements: 13.5, 13.6, 13.8, 13.9, 13.10, 13.12, 13.13_
  - [x] 3.7 Create `PATCH /api/postings/[id]/location` (the Retry path)
    - `src/app/api/postings/[id]/location/route.ts`: body `{ location }` only. Reject any other key with 400. Validate with `validateLocationBlock`, require a signed-in user, call `cb_update_posting_location` once, and map errors as in 3.6. Write no content column
    - _Requirements: 13.6, 13.9, 13.12, 13.14_
  - [x] 3.8 Write route tests for the publish, edit and retry routes
    - **Property 16: An edit without a location touches no pin column**
    - **Property 17: An edit with a location returns the new pin, precision and zone** (route part)
    - **Property 25: A failed location save keeps the chosen pin, and Retry sends only the location** (route part)
    - **Validates: Requirements 12.6, 12.7, 13.5, 13.6, 13.10, 13.12, 13.13, 13.14**
    - Files: `src/app/api/postings/route.location.test.ts` (new), `src/app/api/postings/[id]/route.edit.test.ts` (extend, keep the existing `EDITABLE` assertion; add the RPC failure case with the exact message and the content update made) and `src/app/api/postings/[id]/location/route.test.ts` (new; only `location` accepted, no content write, error mapping)
  - [x] 3.9 Create `src/lib/geocodeUserCap.ts`
    - `createUserCap` with an injected clock, per server instance, as in the design. Do not create the token gate or the in-memory TTL cache
    - _Requirements: 4.14_
  - [x] 3.10 Write property test for the per-user cap
    - **Property 15: The per-user cap never exceeds its limit**
    - **Validates: Requirements 4.14**
    - File: `src/lib/geocodeUserCap.test.ts`
  - [x] 3.11 Create `src/lib/geocoderStore.ts`
    - `GeocoderStore` and `createGeocoderStore(client)`: `takeSlot` (calls `cb_geocoder_take_slot`, returns `wait_ms` or `null` for no row, throws on error), `cacheGet` (unexpired rows only), `cachePut` (24 h expiry, keys `key_hash`, `results`, `expires_at` only, then calls the purge, returns `{ ok, code }`), `purgeExpired`. Server only, service role client only
    - _Requirements: 19.1, 19.2, 19.8, 20.1, 20.3, 20.4, 20.5, 20.6, 20.8_
  - [x] 3.12 Create `GET /api/geocode`
    - `src/app/api/geocode/route.ts` in the order of the design: 401 signed out, config check (503 `unavailable`, no store and no upstream call), `prepareGeocodeQuery` (400 or 422 `query_refused`), user cap (429 `user_limit`), cache read (hit returns, error gives 503), `takeSlot(3000)` (null gives 429 `busy`, error gives 503), sleep the returned wait, one `fetch` with `User-Agent`, `Accept-Language` and `Referer`, 8 s abort, 502 on failure, `normalizeNominatim`, `cachePut`, 200 `ok`. Log only the state and status, never the query, key or body
    - Leave the home page town search and `api/alerts/route.ts` unchanged
    - _Requirements: 4.1, 4.7, 4.8, 4.9, 4.10, 4.11, 4.13, 4.14, 18.3, 18.4, 18.6, 19.1, 19.2, 19.3, 19.6, 19.7, 19.8, 19.9, 19.10, 20.3, 20.8_
  - [x] 3.13 Write the geocode route tests
    - **Property 18: The upstream request carries only the prepared query** (route part)
    - **Property 20: A query with contact details is refused and sends nothing** (route part)
    - **Property 22: A cache hit makes no upstream call**
    - **Property 23: The cache key is an HMAC and never contains the query** (row part)
    - **Property 24: Disabled, busy and refused requests make no upstream call** (route part)
    - **Validates: Requirements 4.7, 4.8, 4.9, 4.11, 4.14, 18.3, 18.4, 18.6, 19.2, 19.3, 19.6, 19.7, 19.8, 19.9, 20.3, 20.5, 20.6**
    - File: `src/app/api/geocode/route.test.ts`, with a stubbed `GeocoderStore` and `fetch`, plus the example cases listed in the design (signed out, short query, success, timeout, network error, non-200, failed cache write, keyed provider, console spies)
  - [x] 3.14 Add the cache purge to the hourly expiry sweep
    - In `src/app/api/cron/expire/route.ts` call `purgeExpired()` after the existing work, report the count, and log a failure by code without failing the sweep. Extend `route.test.ts` in that folder
    - _Requirements: 20.6_
  - [x] 3.15 Add the geocoder variables to `.env.example`
    - Add `GEOCODER_URL`, `GEOCODER_USER_AGENT`, `GEOCODER_REFERER`, `GEOCODER_API_KEY`, `GEOCODER_API_KEY_PARAM` and `GEOCODER_CACHE_SECRET` with comments and empty values. Set none of them anywhere
    - _Requirements: 19.3, 19.6, 19.7_
  - [x] 3.16 Add `addresses` to the scan route
    - In `src/app/api/scan/extract/route.ts` extend the prompt, return `addresses: normalizeAddressCandidates(parsed.addresses)`, keep `placeLabel` and the "Do not invent a location pin" line. `parsePlainLines` returns no addresses
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_
  - [x] 3.17 Update the scan route tests
    - `src/app/api/scan/extract/route.test.ts`: expect `addresses` in the response (`[]` for old-style model output), add a case with three addresses and one with a malformed `addresses` value, assert one `fetch` call only and no coordinates, assert the prompt names `addresses` and the five kinds
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [x] 4. Checkpoint - Stage 2
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Stage 3: Stage 14 SQL and local database tests
  - [x] 5.1 Write the stage 14 preflight and migration
    - `supabase/stage14_posting_location_preflight.sql` (read-only; expects every stage 14 object absent; prints the row count and the `md5` of `id, lat, lng, place_label, time_zone` ordered by id) and `supabase/stage14_posting_location.sql` (one transaction), in the style of `stage11_message_reads*.sql` with the same DRAFT header
    - The migration creates exactly this object list: column `postings.location_precision` (default `unreviewed`, check), the re-granted insert columns, `cb_update_posting_location` (security definer, `set search_path = ''`, author-only, active and visible, one atomic update, execute to `authenticated` only), table `cb_geocoder_throttle` (one row), function `cb_geocoder_take_slot(integer)` (1100 ms spacing, atomic update, bound capped at 5000 ms, execute to `service_role` only), table `cb_geocoder_cache` (HMAC key check, jsonb array check, 24 h expiry check, no user column), function `cb_geocoder_purge_cache()` (execute to `service_role` only)
    - On the three geocoder tables and two functions: RLS enabled with no policies, `revoke all … from public, anon, authenticated`, grants to `service_role` only. Assertions inside; any failure rolls everything back. Additive only; changes no existing row
    - _Requirements: 13.1, 13.9, 13.12, 16.1, 16.2, 16.3, 20.1, 20.2, 20.4, 20.5, 20.7_
  - [x] 5.2 Write the role-based verify
    - `supabase/stage14_posting_location_verify.sql` in the style of `supabase/stage11_message_reads_verify_roles.sql`: a single transaction, the `pg_temp.run_as(uid, role, sql)` helper with JWT claims, disposable fixture users and postings with fixed ids (refuse to start if they exist), one result row per check with an overall first row, the checks listed in the design, a final row `ALL CHECKS PASS`, and `ROLLBACK`. Include the `md5` comparison with the preflight value, the atomic-failure check, the `anon` and `authenticated` refusals on all geocoder objects, the `service_role` access, the no-policy and RLS-on checks, the TTL and key-format constraints, and the slot spacing and bound checks
    - _Requirements: 13.1, 13.9, 13.12, 16.2, 16.3, 20.1, 20.2, 20.4, 20.5, 20.7_
  - [x] 5.3 Write the rollback
    - `supabase/stage14_posting_location_rollback.sql`: drop the geocoder functions and tables and `cb_update_posting_location`, restore the stage 8 insert grant list, drop the column. Safe to run twice
    - _Requirements: 16.2, 16.3_
  - [x] 5.4 Create the isolated database harness script
    - `supabase/isolated-test/location.mjs` in the pattern of `messagereads.mjs` and `twoaccount.mjs`: read `CB_ISO_DIR` and `CB_SQL_DIR`, start the embedded PostgreSQL and PostgREST, load `bootstrap.sql` and the production migration chain through stage 8, then run preflight, migration, verify (require the `ALL CHECKS PASS` row and that the transaction rolled back), the `md5` before and after, rollback, a check that every stage 14 object is gone and the insert grants are back, and the migration again. Add PostgREST checks with an author JWT and another user's JWT for `cb_update_posting_location`, and with the `anon` and `authenticated` roles against the geocoder tables and functions (all refused). Print `PASS` and `FAIL` lines and exit non-zero on any failure
    - Add the script and its run line to `supabase/isolated-test/README.md`
    - _Requirements: 16.2, 16.3, 20.7_
  - [x] 5.5 Write the database property tests
    - **Property 21: Slot grants are at least 1 second apart across concurrent callers**
    - **Property 25: A failed location save keeps the chosen pin, and Retry sends only the location** (database part: an invalid `cb_update_posting_location` call leaves the row's `md5` equal)
    - **Validates: Requirements 13.12, 19.1, 20.1, 20.2, 20.3**
    - File: `supabase/isolated-test/location.mjs` (extend). Property 21 opens real parallel connections, runs 100 randomized rounds of N from 1 to 12 callers and a random bound from 0 to 5000 ms, resets the throttle row between rounds as the owner, and asserts sorted `slot_at` gaps of at least 1000 ms, `wait_ms` within the bound, no row beyond the bound, and a non-decreasing `next_slot_at`
  - [x] 5.6 Run the local database tests and record the results
    - Set up `CB_ISO_DIR` as in `supabase/isolated-test/README.md`, run `node supabase\isolated-test\location.mjs` and the existing `run.mjs` to confirm nothing regressed, and record the commands, the counts and the result in `BUILD_LOG.md`. If the local database cannot run, record exactly what is blocked and mark the SQL untested. Apply nothing to production
    - _Requirements: 16.3, 16.6_

- [x] 6. Checkpoint - Stage 3
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Stage 4: User interface and copy
  - [x] 7.1 Create the picker map style and the picker action helpers
    - `src/components/map/pickerMapStyle.ts` (the board's tan style; tile source `attribution` set to the link `<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>`) and `src/components/map/locationPickerActions.ts` (pure functions the handlers call: build the lookup from `prepareGeocodeQuery`, ignore a lookup while one is in flight, map route states to `search_failed` kinds and messages, build the Retry body). Add `src/components/map/locationPickerActions.test.ts`: no request on typing, refused query makes no `fetch`, one in-flight lookup, state to message mapping
    - Import nothing from the board modules
    - _Requirements: 4.2, 4.6, 4.7, 4.9, 18.1, 18.4, 18.5, 19.4, 19.5_
  - [x] 7.2 Create the location picker
    - `src/components/map/LocationPicker.tsx`: candidate list with "Find on map", search form, match list, map with a draggable dark-red pin, approximate-area circle, confirmation bar with the exact question and the buttons "Yes, use this place" (navy) and "No, choose another", four nudge buttons, "Use my location" with its hint and failure message, private-home checkbox with the explanation, Place_Label field with the category hint, the linked attribution on the map and next to the results, the note "Searching sends only this address text to a public map search service.", and the busy, unavailable and refused messages. It calls `/api/geocode` only from the "Find on map" and search-submit handlers through the helpers of 7.1, with no autocomplete and no request while typing. Start view: the confirmed point, the selected match, or `DEFAULT_VIEW`. Tap targets of at least 44 px
    - Import nothing from the board modules
    - _Requirements: 3.1, 3.2, 3.4, 3.7, 3.8, 3.9, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.9, 4.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.3, 6.4, 7.1, 7.2, 7.3, 7.4, 7.7, 7.8, 9.1, 9.2, 9.3, 10.3, 10.5, 18.1, 18.5, 18.7, 19.4, 19.5, 19.9_
  - [x] 7.3 Wire the review form
    - In `src/app/scan/review/ReviewForm.tsx` replace the location block, `requestLocation`, `coords`, `real` and `desired` with `useReducer(locationReducer, emptyDraft())` and the picker. Read the saved scan with `parseStoredExtraction` and show the unreadable-scan message. Send `location: publishableLocation(draft)`. Refuse to send without it and show "Choose where this takes place on the map before publishing." Show the personal-details warning (street addresses, phone numbers, email addresses; names the field and kind; says public venue or organizer details can stay) and the acknowledgement checkbox from `findAddressLeaks`, never editing the fields, and the "flyer photo is not published" line. Use `locationLabels` for the Place field label and hint. Compute the takedown preview zone from `publicPin(draft)`
    - _Requirements: 1.3, 1.4, 1.5, 2.7, 2.8, 6.1, 6.5, 8.5, 8.7, 10.6, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.10, 11.12, 14.2, 14.3, 14.4_
  - [x] 7.4 Update the scan page copy
    - `ScanCapture.tsx`: replace "Your permission, your pin" with "Your flyer, your place" and the new text. `scan/page.tsx` and `scan/review/page.tsx`: keep the headings, update the review intro so it no longer implies a location read
    - _Requirements: 1.3, 14.1_
  - [x] 7.5 Update the detail page and the precision read
    - `src/lib/postings.ts`: add `getLocationPrecision(supabase, id)` (separate read, not in `POSTING_COLUMNS`; on error log the code and return `unreviewed`). `src/lib/types.ts`: add `locationPrecision?`. `src/app/p/[id]/page.tsx`: show `{locationLabels.detail}` in front of the place and `locationNote(precision)` when it is not `null`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.10, 9.11, 14.6_
  - [x] 7.6 Update the edit form and page
    - `EditPostingForm.tsx` and `edit/page.tsx`: read-only map of the current pin, notice by precision, "Change location" opening the picker with `existing_loaded`, `location` sent only when `publishableLocation(draft)` is non-null, approximate postings show the checked and disabled private-home box, takedown line from the zone of the new pin, replace the "can't be changed" pin copy and the Place hint
    - Two-step save: on a `location_failed` answer dispatch `location_save_failed`, show "Your other changes were saved, but the location was not." with a "Retry" button, keep the chosen pin and precision in the draft, and on Retry send `PATCH /api/postings/[id]/location` with only the location block built by the helper from 7.1. On success remove the Retry button and show the saved state. Pressing "Save changes" again sends the combined request with the same kept location
    - _Requirements: 8.5, 8.7, 13.2, 13.3, 13.4, 13.5, 13.7, 13.10, 13.11, 13.12, 13.13, 13.14, 14.5_
  - [x] 7.7 Clean up the remaining copy and check the steering file
    - Replace the old wording in `DEMO_PLAN.md` and `README.md` (if present). Check that `.kiro/steering/location-rules.md` has the new "Where a posting is pinned" section and the changed Privacy bullet, and that Alerts and Map are unchanged
    - _Requirements: 14.7, 15.1, 15.2, 15.3_
  - [x] 7.8 Write the guard test
    - `src/lib/locationGuards.test.ts`: the location modules and `LocationPicker.tsx` import none of `boardStorage`, `geoPermission`, `HomeMap`, `nearby`. `navigator.geolocation` appears only in `deviceLocation.ts` within the posting flow. `clampPinNudge` and `MAX_NUDGE_METERS` are not exported by `domain.ts` and not referenced outside `__testing__`. The retired phrases are absent from `src`, `README.md` and `DEMO_PLAN.md` (the guard test file itself is excluded from the scan, and builds the phrases from fragments). `package.json` has no new dependency. `geocoderStore.ts` and `SUPABASE_SERVICE_ROLE_KEY` are not referenced from any file under `src/components` or any `"use client"` file. `LocationPicker.tsx` has no `onChange` handler that calls `fetch`
    - _Requirements: 4.2, 7.2, 7.7, 7.9, 12.8, 14.7, 16.9, 19.5, 20.8_

- [x] 8. Checkpoint - Stage 4
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Stage 5: Browser checks
  - [x] 9.1 Create the browser harness
    - `scripts/location-e2e/` with `lib.mjs`, `fixtures.mjs` and `README.md`, following `scripts/board-e2e/`: Playwright core with Edge, scratch build without `.env.local`, local mock Supabase on `127.0.0.1:3299`, interception of `/api/scan/extract`, `/api/geocode` (matches, empty, 429 `busy`, 502, 503 `unavailable`, 422 `query_refused`; record every request URL), OSM tiles, `POST /api/postings`, `PATCH /api/postings/:id` and `PATCH /api/postings/:id/location` (record the body, answer a canned success or a canned `location_failed`), geolocation stub (granted, denied, absent, call counter), viewports 390x844 and 1280x800, shared checks (no horizontal scroll, tap targets, one dark-red action)
    - _Requirements: 16.4, 17.11_
  - [x] 9.2 Write the scenario checks
    - `scripts/location-e2e/scenarios.mjs`: scanning at home, multiple addresses, no address, ambiguous matches, denied location permission, corrected pins (real mouse drags for the pin), search unavailable (503 then manual pin and publish), query refused (a typed phone number sends no request and shows the message), and the edit save failure (canned `location_failed`, message and Retry shown, chosen pin kept, the Retry request body has only `location`). Each asserts the recorded body, the confirmation question text, that every geocoder request URL holds only the selected address text, and a geolocation call count of 0 unless the shortcut was tapped
    - _Requirements: 1.3, 3.2, 3.8, 4.2, 4.7, 5.2, 5.3, 6.1, 6.3, 7.5, 13.13, 13.14, 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8, 17.10, 17.11, 18.1, 18.4, 18.5_
  - [x] 9.3 Write the page and privacy checks
    - `scripts/location-e2e/pages.mjs`: private-home preview text and circle, no latitude or longitude text on screen, the personal-details warning (street address, phone number, email) blocks Publish until acknowledged and leaves the text unchanged, look-alike numbers do not warn, the attribution link points to `https://www.openstreetmap.org/copyright` on the map and next to results, `localStorage["corkback.mapCenter"]` unchanged after the shortcut, the picker start view ignores a saved board centre, a legacy edit page sends no request before Save and shows the unreviewed notice, an edit that changes the location sends one `location` block, the detail page labels for each category kind and the approximate note, and the corrected copy on the scan, review, edit and detail pages
    - _Requirements: 7.6, 7.7, 8.1, 8.2, 8.3, 8.4, 9.3, 9.10, 9.11, 11.4, 11.7, 11.8, 11.12, 13.2, 13.3, 13.5, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 17.9, 17.11, 19.4_
  - [x] 9.4 Run the harness and record the results
    - Build in a scratch copy without `.env.local`, install Playwright core in a scratch folder, run `scenarios.mjs` and `pages.mjs`, remove the `node_modules` junction before deleting the copy, and record the results in `BUILD_LOG.md`. If Edge or Playwright cannot run, record exactly what is blocked and mark browser checks untested
    - _Requirements: 16.4, 17.11_

- [x] 10. Checkpoint - Stage 5
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Stage 6: Release preparation
  - [x] 11.1 Run the full checks
    - `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Fix failures that come from this change. Run `git diff --name-only main` and confirm that `next-env.d.ts` and `supabase/.temp/` are not part of the branch diff. Record the counts in `BUILD_LOG.md`
    - _Requirements: 16.5, 16.8, 16.9_
  - [x] 11.2 Write the release checklist
    - `.kiro/specs/posting-location-confirmation/release-checklist.md` in the shape of the board spec's checklist: the branch and the code rollback target, the Vercel environment variables to set first (`GEOCODER_USER_AGENT` with a contact, `GEOCODER_CACHE_SECRET` of at least 32 random characters, optional `GEOCODER_URL`, `GEOCODER_REFERER`, `GEOCODER_API_KEY` and `GEOCODER_API_KEY_PARAM`), SQL first (preflight, migration, verify with `ALL CHECKS PASS`, with the expected output and the `md5` comparison), then the code release, production smoke tests, live checks with disposable accounts and `[TEST]` postings (a publish from a candidate, a private-home publish, an edit of a legacy posting, a changed location across a time zone, a place search, a repeated search served from the cache, a search with the variables unset showing the unavailable message and a working manual pin), real-phone checks (device shortcut, permission denied, map drag on touch), and rollback in the order code first and SQL second
    - Note the residual risk that the home page town search and the alerts lookup call Nominatim directly and are outside the shared throttle
    - Note that the production migration, the production environment variables and the production deployment are pending the Owner's review
    - _Requirements: 16.6, 19.10_
  - [x] 11.3 Prepare the protected preview
    - Build a Vercel preview of the final branch commit in demo mode: Supabase variables empty, no `GEMINI_API_KEY`, no geocoder variables, no production connection. Confirm Deployment Protection is on, and record the deployment id, the commit and the protection status in `BUILD_LOG.md`. Do not deploy to production, do not merge to `main`, do not apply SQL
    - _Requirements: 16.4, 16.6, 16.7_

- [x] 12. Final checkpoint - Ensure all tests pass, ask the user if questions arise.
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Stage 7: One geocoder for every lookup, private-home safety, approximate-mode audit
  - Stages 0 to 6 are complete and are NOT reopened. This stage starts from `feature/posting-location-confirmation` at `e0bf7d1` (a direct child of `origin/main` at `40ac4ad`). Keep working on that branch. Add no dependency. Keep `next-env.d.ts` and `supabase/.temp/` out of every commit. New SQL (stage15) is additive, tested only in `supabase/isolated-test`, and stays pending the Owner's review.
  - [x] 13.1 Confirm the branch is current before Stage 7 work
    - Run `git fetch`, then `git log --oneline origin/main..HEAD` and `git log --oneline HEAD..origin/main`. Confirm HEAD (`e0bf7d1` or later) contains every `origin/main` commit (`40ac4ad`) and that `HEAD..origin/main` is empty. Local `main` being behind at `7a273b5` is irrelevant. Record the result in `BUILD_LOG.md`. Make no change to `main`
    - _Requirements: 16.5_
  - [x] 13.2 Add the purpose resolver and the anonymous-id helper
    - Add a small pure `resolvePurpose(raw: string | null): "place" | "posting"` (any value other than `place` resolves to `posting`) in `src/lib/geocodeQuery.ts` or a new `src/lib/geocodePurpose.ts`. Add a server helper to read the client IP from `x-forwarded-for` (first entry), else `x-real-ip`, else a fixed fallback string, and to compute the Anonymous_Client_Id as `cacheKey(ip, "anon", secret)` (reuse the HMAC helper). The raw IP is used only to compute the id and is never stored or logged
    - _Requirements: 21.1, 21.8, 21.11_
  - [x]* 13.3 Write property tests for the purpose resolver and the anonymous id
    - **Property 26: Auth depends only on the resolved purpose** (resolver part)
    - **Property 29: The anonymous client id is an IP HMAC that never contains the IP**
    - **Validates: Requirements 21.1, 21.8, 21.11**
    - Files: `src/lib/geocodeQuery.cache.test.ts` (extend) and/or `src/lib/geocodeAnonId.test.ts`
  - [x] 13.4 Extend the geocoder store with the anonymous limit
    - In `src/lib/geocoderStore.ts` add `takeAnonSlot(clientHash)` (calls `cb_geocoder_take_anon_slot`, returns its boolean, throws on any database error so the route fails closed) and `purgeAnonExpired()` (calls `cb_geocoder_purge_anon_limit`). Call `purgeAnonExpired` best-effort inside `cachePut` alongside `purgeExpired`. Server only, service role client only
    - _Requirements: 24.3, 24.5, 24.7, 24.8_
  - [x] 13.5 Extract the shared lookup core
    - Create `src/lib/geocodeLookup.ts` (server only) with `runGeocodeLookup({ query, privateHome, config, store })` that runs the private-home guard, cache read, `takeSlot`, one upstream `fetch`, `normalizeNominatim` and `cachePut`, returning `{ state, matches? }`. Move this core out of `src/app/api/geocode/route.ts` so the route wrapper keeps only auth, purpose, query prep and the rate limits. Behavior for the existing signed-in path is unchanged
    - _Requirements: 21.6, 21.7, 22.1, 22.4, 22.7_
  - [x] 13.6 Update the geocode route for purpose, anonymous limit and the private-home guard
    - In `src/app/api/geocode/route.ts`: parse `purpose` with `resolvePurpose`; for `purpose=posting` keep the 401 and the per-user cap; for `purpose=place` skip the sign-in gate and, after query prep and the private-home guard, compute the Anonymous_Client_Id and call `store.takeAnonSlot(anonId)` (false → 429 `rate_limited`, throw/missing → 503 `unavailable`, both with no upstream call). Refuse a private-home-flagged query with 422 `private_home_refused` when `config.publicNominatim` is true, deciding from config only. Then call `runGeocodeLookup`. Log only `[geocode] <state> <status> <purpose>` — never the IP, the id, the query, the key or the body
    - _Requirements: 21.2, 21.3, 21.6, 21.9, 21.10, 21.12, 22.1, 22.4, 22.7, 24.8_
  - [x]* 13.7 Write route tests for purpose, throttle/cache sharing, the private-home guard and the anonymous limit
    - **Property 26: Auth depends only on the resolved purpose** (route part)
    - **Property 27: Every upstream call is throttled, and the cache is shared across callers and purposes**
    - **Property 28: A private-home lookup is refused from config alone when the provider is public Nominatim**
    - **Property 30: The anonymous limit and a missing limit store both stop upstream traffic**
    - **Validates: Requirements 21.2, 21.3, 21.6, 21.7, 21.9, 21.10, 22.1, 22.3, 22.4, 22.7, 24.8**
    - File: `src/app/api/geocode/route.test.ts` (extend; stub `takeAnonSlot`, generate purpose, sign-in state, config and store states; add console-spy cases for Requirements 21.12 and 23.5)
  - [x] 13.8 Route the home-page search through the shared service
    - In `src/components/map/HomeMap.tsx` replace the direct `nominatim.openstreetmap.org` fetch in `searchTown` with `fetch("/api/geocode?purpose=place&q=" + encodeURIComponent(q))`, read `matches[0].point` on `state === "ok"`, keep the "Showing {q}" flow and `writeSavedCenter`, and map empty/`rate_limited`/`busy`/`unavailable` to the existing unavailable message. No autocomplete; the search still runs only on submit. `HomeMap` imports no server-only module and stays a client component
    - _Requirements: 21.4, 21.13, 21.14_
  - [x] 13.9 Route the alerts town lookup through the shared service
    - In `src/app/api/alerts/route.ts` replace `geocodeTown`'s direct Nominatim fetch with `runGeocodeLookup({ query, privateHome: false, config: resolveGeocoderConfig(process.env), store: createGeocoderStore(createAdminClient()) })` and resolve the center from `matches[0].point`. When the config is disabled, keep the existing "Could not find a town…" error so a map point still works. No `nominatim` literal remains
    - _Requirements: 21.5, 21.6, 21.7_
  - [x] 13.10 Private-home behavior and approximate-mode copy in the picker
    - In `src/components/map/LocationPicker.tsx`: before any private-home lookup, show the explanation "A private home address is not sent to a public map search service. Place the pin on the map, or use Use my location if you are there." When a private-home lookup returns `private_home_refused`, switch that place to manual placement only. Add the separate warning "A flyer image or words in your posting can still show an address. The approximate pin does not hide what the image or text says." Audit and reword the private-home explanation (Requirement 9.3) and the detail approximate note (Requirement 9.10) so no wording claims the pin guarantees anonymity, keeping "about a quarter mile (400 m)" and "The street address is not shown". These notes are navy/neutral, not the dark-red action
    - _Requirements: 22.2, 22.3, 22.5, 22.6, 23.6, 23.7, 23.8_
  - [x] 13.11 Update the detail-page approximate note copy
    - In `src/app/p/[id]/page.tsx` reword the approximate-location note so it describes an approximate area without claiming anonymity, consistent with `locationNote` in `src/lib/postingLocation.ts`. Keep "The exact address is not shown." Update `locationNote` text if needed
    - _Requirements: 23.6, 23.8, 9.10, 9.11_
  - [x]* 13.12 Property test the approximate-mode surfaces and extend the guard test
    - **Property 31: An approximate posting exposes only the approximate pin on every surface**
    - **Validates: Requirements 23.1, 23.2, 23.3**
    - Files: `src/lib/postingLocation.draft.test.ts` or `src/lib/postingLocation.geo.test.ts` (extend) and `src/app/api/postings/route.location.test.ts` (stored-row surface)
    - Extend `src/lib/locationGuards.test.ts`: no `src` file fetches `nominatim.openstreetmap.org` (zero occurrences in `HomeMap.tsx` and `alerts/route.ts`); `HomeMap.tsx` imports no `geocoderStore`, `geocodeLookup` or `server-only`; the location modules import nothing from `HomeMap`; the approximate copy contains no anonymity-guarantee phrasing and still contains the kept statements
    - _Requirements: 21.4, 21.5, 21.14, 23.1, 23.2, 23.6_
  - [x] 13.13 Write the stage15 SQL (preflight, migration, verify, rollback)
    - `supabase/stage15_geocoder_anon_limit_preflight.sql` (read-only; expects every stage15 object absent; confirms the stage 14 objects are present and unchanged), `supabase/stage15_geocoder_anon_limit.sql` (one transaction; additive; refuses to start if any stage 14 object is missing; creates `cb_geocoder_anon_limit` table, `cb_geocoder_take_anon_slot(text,integer,integer)` and `cb_geocoder_purge_anon_limit()` with RLS on, no policies, `revoke all from public, anon, authenticated`, grants to `service_role` only; asserts stage 14 is unchanged via an inventory check), `supabase/stage15_geocoder_anon_limit_verify.sql` (role-based, `ALL CHECKS PASS`, rolls itself back; checks the anon/authenticated refusals, service_role access, RLS/no-policy, the column list, the hex key check, the 30/window limit and the purge), and `supabase/stage15_geocoder_anon_limit_rollback.sql` (drops only the stage15 objects; safe to run twice). DRAFT headers like stage 14
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6, 24.9_
  - [x] 13.14 Extend the isolated-database harness for stage15
    - Extend `supabase/isolated-test/location.mjs` to run the stage15 preflight, migration, verify (require `ALL CHECKS PASS` and a self-rollback), a stage 14 inventory/`md5` check before and after (unchanged), the rollback, and the migration again (re-runnable). Add PostgREST/role checks: `anon` and `authenticated` refused on the stage15 table and both functions; `service_role` allowed. Update `supabase/isolated-test/README.md`
    - _Requirements: 24.2, 24.6, 24.9_
  - [x]* 13.15 Write the stage15 database property tests
    - **Property 32: The anonymous slot limit is atomic and resets per window (isolated database)**
    - **Property 33: The anonymous-limit purge deletes only expired rows (isolated database)**
    - **Validates: Requirements 24.1, 24.3, 24.5, 21.9**
    - File: `supabase/isolated-test/location.mjs` (extend). Property 32 opens real connections, runs 100 randomized rounds of hit sequences per hashed id (including concurrent callers for one id) with window resets, and asserts at most 30 trues per window, separate counting per id, and reset after the window. Property 33 generates rows with varied `window_start` and asserts the purge deletes exactly the expired rows
  - [x] 13.16 Run the local database and unit tests and record the results
    - Set `CB_ISO_DIR` as in `supabase/isolated-test/README.md`, run `node supabase\isolated-test\location.mjs` and the existing `run.mjs`, and run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`. Record the commands, counts and results in `BUILD_LOG.md`. If the local database cannot run, record exactly what is blocked and mark the stage15 SQL untested. Apply nothing to production
    - _Requirements: 24.9, 16.3_
  - [x] 13.17 Correct the release checklist against the SQL
    - In `.kiro/specs/posting-location-confirmation/release-checklist.md` verify every stage 14 object name against `supabase/stage14_posting_location*.sql` and correct any mismatch. The actual stage 14 objects are: column `postings.location_precision`; function `public.cb_update_posting_location(uuid, double precision, double precision, text, text)`; table `public.cb_geocoder_throttle`; function `public.cb_geocoder_take_slot(integer)`; table `public.cb_geocoder_cache`; function `public.cb_geocoder_purge_cache()`. Add the stage15 files to the SQL order (preflight, migration, verify, rollback) after stage 14. Fix stale deployment ids and URLs: the current production and code rollback target is `dpl_9PELR85c5x7oYKsYuYegUzeTQvBN` at commit `40ac4ad`; the protected preview is `dpl_BxD3BA8ABE31cKAAHK7vA6cMjghh`. Add `GEOCODER` env-var notes for the anonymous limit if any are new. Update the residual-risk section to say the home and alerts lookups now go through the shared throttle
    - _Requirements: 16.1, 16.2, 16.6, 19.10, 24.2_
  - [~] 13.18 Verify the branch includes origin/main and prior release fixes, and refresh the protected preview
    - Re-run the branch verification of 13.1 at merge time: confirm `feature/posting-location-confirmation` contains current `origin/main` and all previous release fixes, and report any differences (`git log --oneline HEAD..origin/main` must be empty; list anything that is not). Then build a fresh Vercel preview of the final branch commit in demo mode (Supabase and geocoder variables empty, no production connection), confirm Deployment Protection is on, and record the deployment id, the commit and the protection status in `BUILD_LOG.md`. The protected preview is `dpl_BxD3BA8ABE31cKAAHK7vA6cMjghh` until refreshed. Do not deploy to production, do not merge to `main`, do not apply SQL
    - _Requirements: 16.4, 16.5, 16.6, 16.7_

- [~] 14. Checkpoint - Stage 7
  - Ensure all tests pass, ask the user if questions arise.

- [~] 15. Final checkpoint - Stage 7
  - Ensure all tests pass (unit, isolated-database, and the browser harness if it can run), confirm nothing was applied to production and `main` is untouched, and ask the user if questions arise.

## Notes

- Every test task is required, including the property tests. Each task names the requirements it covers, and each property test names its design property.
- The SQL must be applied before the code release. Old code works with the new SQL, and new code does not work without it. With the geocoder variables unset or the SQL missing, search is disabled and publishing still works.
- Production migration, production environment variables and production deployment stay pending the Owner's review.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["0.1"] },
    { "id": 1, "tasks": ["0.2", "1.1", "1.2", "1.4", "1.6", "1.11", "1.15", "3.9", "5.1"] },
    { "id": 2, "tasks": ["1.3", "1.5", "1.7", "1.8", "1.12", "1.13", "1.16", "1.18", "3.10", "3.15", "3.16", "5.2"] },
    { "id": 3, "tasks": ["1.9", "1.10", "1.14", "1.17", "1.19", "3.1", "3.11", "3.17", "5.3", "7.1"] },
    { "id": 4, "tasks": ["1.20", "3.2", "3.3", "3.12", "3.14", "5.4"] },
    { "id": 5, "tasks": ["3.4", "3.5", "3.6", "3.7", "3.13", "5.5", "7.2"] },
    { "id": 6, "tasks": ["3.8", "5.6", "7.3", "7.4", "7.5"] },
    { "id": 7, "tasks": ["7.6", "7.7"] },
    { "id": 8, "tasks": ["7.8", "9.1"] },
    { "id": 9, "tasks": ["9.2", "9.3"] },
    { "id": 10, "tasks": ["9.4"] },
    { "id": 11, "tasks": ["11.1"] },
    { "id": 12, "tasks": ["11.2"] },
    { "id": 13, "tasks": ["11.3"] },
    { "id": 14, "tasks": ["13.1", "13.2", "13.4", "13.13"] },
    { "id": 15, "tasks": ["13.3", "13.5", "13.14"] },
    { "id": 16, "tasks": ["13.6", "13.9", "13.15"] },
    { "id": 17, "tasks": ["13.7", "13.8", "13.10", "13.11"] },
    { "id": 18, "tasks": ["13.12", "13.17"] },
    { "id": 19, "tasks": ["13.16"] },
    { "id": 20, "tasks": ["13.18"] }
  ]
}
```
