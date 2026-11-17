# Release checklist: posting location confirmation

Branch `feature/posting-location-confirmation`. Nothing below has been run against production.
Every item is unchecked and pending owner review. Each step waits for owner approval: production SQL, the merge to `main` and the production deploy.

## 0. Current state and before starting
- [ ] `origin/main` and the live production deployment are both at `40ac4ad`. The deployment is `dpl_9PELR85c5x7oYKsYuYegUzeTQvBN` and is the code rollback target.
- [ ] Stage 11 (message reads) is applied. Stage 12 (geo index) and stage 13 (takedown parity) are deferred and are not part of this release.
- [ ] Review the branch diff: `git log --oneline 40ac4ad..origin/feature/posting-location-confirmation`.
- [ ] `git diff --name-only main` does not list `next-env.d.ts` or `supabase/.temp/`.
- [ ] Recheck the protected preview build of the final branch commit (see BUILD_LOG.md).

## 1. Order of work
SQL first, then code. The new code writes `location_precision` and calls `cb_update_posting_location`, so stage 14 must exist before it ships. The old code keeps working with stage 14 applied, so the SQL step is safe to do on its own.

1. Step 2: stage 14 SQL.
2. Step 3: Vercel environment variables (can be done any time before step 4; search stays off until they are set).
3. Step 4: code release.
4. Steps 5 to 7: smoke checks, live checks, phone checks.

## 2. SQL: stage 14 posting location
Run in the Supabase SQL editor of project `djdmiqxzcgjdwcxqqrzk`, in this order:
1. [ ] `supabase/stage14_posting_location_preflight.sql`. Read-only; save the output.
   - `supabase db query --read-only` rejects the file's own `BEGIN`. Run its SELECT body read-only, or paste the file into the SQL editor.
   - Expect from the production read-only inventory: `postings` has 4 rows (re-check the count), and every stage 14 object is absent (the `location_precision` column, `cb_update_posting_location`, the geocoder cache and throttle tables, `cb_geocoder_take_slot`).
   - The preflight also shows the `authenticated` INSERT grant on `postings`. It must be exactly the stage 8 column list, because the migration refuses to run otherwise. If it differs, stop and ask.
2. [ ] `supabase/stage14_posting_location.sql`. One transaction. A failed assertion rolls everything back and applies nothing.
3. [ ] `supabase/stage14_posting_location_verify.sql`, right after the migration. Expect the last row `ALL CHECKS PASS`. Check V2 expects every existing posting to be `unreviewed`, so run it before any new-code posting is saved.
4. [ ] Confirm the old code still works: production board loads and a posting detail opens.

## 3. Vercel environment variables (Production)
Add before enabling place search. Never commit values.
- [ ] `GEOCODER_USER_AGENT`: an identifying app name and version plus a contact (for example `CorkBack/1.0 (contact: you@example.com)`).
- [ ] `GEOCODER_CACHE_SECRET`: at least 32 characters, generated (for example `openssl rand -base64 48`). Not stored in the repo or logs.
- [ ] Optional: `GEOCODER_URL`, `GEOCODER_REFERER`, `GEOCODER_API_KEY`, `GEOCODER_API_KEY_PARAM` (only for a different provider).
- [ ] The Supabase URL and service role key already exist and are also required by the geocoder.

Without these variables, place search is disabled and manual pin placement still works. That is an acceptable launch state; search can be enabled later by adding the variables and redeploying.

Nominatim policy:
- One request per second across the whole app, enforced by `cb_geocoder_take_slot`.
- Attribution is shown next to results.
- No autocomplete: a search runs only on an explicit action.

## 4. Code release
1. [ ] Merge to `main` (fast-forward), then push once. Vercel's Git integration builds the production deployment.
2. [ ] Confirm production serves the merge commit (`vercel inspect https://corkback.vercel.app`, plus the GitHub commit status).
3. [ ] If the environment variables were added after the build, redeploy so they apply.

## 5. Production smoke checks
Use synthetic `[TEST]` data and two test accounts with Resend simulated-delivery addresses `delivered+<name>@resend.dev`. Clean up afterwards with the `scripts/avatar-e2e` cleanup pattern.

The six scenarios:
- [ ] Publish from a flyer address candidate: the candidate is shown as "Is this where the event or listing takes place?", and nothing is pinned until confirmed.
- [ ] Publish a private home with an approximate pin: the form says what visitors will see, and the pin is 150 to 400 m from the true spot. The exact point is not in the network request.
- [ ] Edit a legacy posting and save it.
- [ ] Change a location across a time zone and check the takedown lines.
- [ ] Place search returns results with attribution.
- [ ] The same search repeated is served from the cache.

Also:
- [ ] With the geocoder variables unset (preview environment or a temporary check), search shows the unavailable message and manual pin placement still publishes.
- [ ] Legacy postings keep their pins and are unchanged until their owners edit and save them.
- [ ] A posting with an approximate pin shows the approximate-location note on its detail page.
- [ ] Edit page: a failed location save shows Retry, and Retry succeeds without losing the draft.
- [ ] Scanning a flyer never asks for device location.
- [ ] Home board browsing location is unchanged: it still behaves as before and is independent of the posting flow.

## 6. Live checks
- [ ] Sign in with both test accounts and publish one `[TEST]` posting in each of a listing and an event category.
- [ ] Location label fits the category (event venue, listing location, lost or found).
- [ ] Exact device location is not visible in the posting, the API response or the database row.

## 7. Phone checks (need a real device)
- [ ] "Use my location" shortcut works only when tapped and fills the candidate pin.
- [ ] Permission denied: a clear message appears, and manual placement and search still work.
- [ ] Map drag and pin placement on touch, without the page scrolling instead.

## 8. Residual risk
- The home page town search and the alerts lookup still call Nominatim directly from browsers, outside the shared `cb_geocoder_take_slot` throttle. Heavy use could push the app over the 1 request per second policy. Owner decision pending.

## 9. Rollback
Code and SQL roll back independently. Roll code back first, then SQL.
- **Code:** in Vercel, promote `dpl_9PELR85c5x7oYKsYuYegUzeTQvBN` (Instant Rollback in the dashboard, or `vercel promote dpl_9PELR85c5x7oYKsYuYegUzeTQvBN`). Then make `main` match with a revert commit (`git revert -m 1 <merge>`, or a revert of each commit for a fast-forward). Never force-push.
- **Stage 14:** `supabase/stage14_posting_location_rollback.sql`, only after the code is rolled back, because the new code depends on `location_precision` and `cb_update_posting_location`.
  - The old code works with or without stage 14, so a SQL rollback is rarely needed.
  - Postings saved with the new code keep their pins; the rollback removes the precision marker, so approximate pins are no longer labeled.
- **Stage 12 and 13:** not applied, nothing to roll back.
