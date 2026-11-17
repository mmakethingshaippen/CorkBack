# Location browser harness (posting location confirmation)

Drives real Microsoft Edge (Playwright core, `channel: "msedge"`) against a local production build.
Same pattern as `scripts/board-e2e/`. Nothing real is contacted: no production Supabase
(`djdmiqxzcgjdwcxqqrzk`), no real Nominatim, no real geolocation prompt.

| File | Purpose |
|---|---|
| `lib.mjs` | Mock Supabase (`startMock`), `startServer`, `launchEdge`, `newPage` (all mocks and the recorder `h`), `dragMouse`, shared checks |
| `fixtures.mjs` | Test data: flyers, geocoder matches, canned route answers, contact and look-alike strings. Never goes into `src/` or a database |
| `smoke.mjs` | Plumbing check (task 9.1). Scenario checks are `scenarios.mjs` (9.2) and `pages.mjs` (9.3) |

## What is mocked

- **Supabase**: `startMock()` listens on `127.0.0.1:3299` (`CB_MOCK_PORT`). It answers `/auth/v1/user`, `postings` rows by id
  (pass `postingRow(n, overrides)` objects) and an empty result for everything else. RPC calls (`cb_geocoder_take_slot`,
  the cache functions, `cb_update_posting_location`) are answered empty and listed in `mock.rpcs`; the browser flows should never reach the feature's RPCs.
  The build must be made with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3299` (inlined at build time).
- **Geocoder**: the browser intercepts `GET /api/geocode` and answers from `GEOCODE_ANSWERS`
  (`street`, `ambiguous`, `empty`, `busy` 429, `badGateway` 502, `unavailable` 503, `refused` 422), or from a function set on `h.geocode`
  (optionally `{ answer, delayMs }`). Every request URL and its `q` is recorded in `h.geocodeRequests`.
  `next start` gets empty `GEOCODER_*` variables, so the route's own config check is disabled and it cannot make an upstream call
  even if a request reached it. (The route requires an `https` endpoint, so a local http mock cannot stand in for the upstream.)
  A direct browser call to any non-local host, including `nominatim.*`, is blocked and listed in `h.external`.
- **Scan**: `/api/scan/extract` answers `{ extracted: opts.flyer }`; the same flyer is seeded into `sessionStorage["corkback.extracted"]` on `/scan/review`.
- **Posting routes**: `POST /api/postings`, `PATCH /api/postings/:id` and `PATCH /api/postings/:id/location` record the parsed body
  (`h.posts`, `h.patches`, `h.retries`) and answer a canned result chosen with `h.postAnswer`, `h.patchAnswer`, `h.retryAnswer`
  (`POSTING_ANSWERS` keys: `postOk`, `patchOk`, `locationFailed`, `retryOk`, `retryFailed`, or a `[status, body]` pair). Settable between steps.
- **Tiles**: `tile.openstreetmap.org` gets a blank PNG.
- **Geolocation**: `opts.geolocation` is `"granted"`, `"denied"` or `"absent"` per context; `opts.permission` is `"prompt"` (never asked, default),
  `"granted"` or `"denied"` for `navigator.permissions.query`. `await h.geoCalls()` returns the stub call count (must be 0 unless the shortcut was tapped).
- **Session**: a fake `sb-127-auth-token` cookie (signed in as `fx_owner`) unless `opts.signedIn === false`.
- `checkNothingExternal(h, mock)` fails if `h.external` is non-empty or the mock saw `cb_geocoder_*` or `cb_update_posting_location`
  (layout RPCs such as `cb_unread_counts` are normal page traffic and are ignored).

Viewports: `mobile` 390x844, `desktop` 1280x800. Shared checks return `{ name, pass, detail }` and do not throw:
`checkNoHorizontalScroll`, `checkTapTargets`, `checkOneDarkRedAction`, `checkNothingExternal`.

## Run (PowerShell)

The dependency is NOT in `package.json`. Build and run from scratch copies in `%TEMP%`, never from the repo (a build inside
the repo loads `.env.local` and would serve the real Supabase project).

```powershell
# 1. Scratch copy WITHOUT .env.local, node_modules junction, build against the mock URL.
$src = (Get-Location).Path; $b = "$env:TEMP\cb_location_build"
if (Test-Path $b) { cmd /c rmdir "$b\node_modules" 2>$null; Remove-Item $b -Recurse -Force }
robocopy $src $b /E /XD node_modules .next .git .vercel .kiro /XF .env.local /NFL /NDL /NJH /NJS | Out-Null
cmd /c mklink /J "$b\node_modules" "$src\node_modules" | Out-Null
Set-Location $b
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3299"; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "fx-anon-key"; $env:SUPABASE_SERVICE_ROLE_KEY = "fx-service-key"
npm run build
if (-not (Test-Path "$b\.next\BUILD_ID")) { throw "build failed: no .next\BUILD_ID" }
Set-Location $src

# 2. Scratch folder for the scripts, Playwright core installed there.
$d = "$env:TEMP\cb_location_e2e"; New-Item -ItemType Directory -Force $d | Out-Null
Copy-Item scripts\location-e2e\*.mjs $d
Set-Location $d
'{"private":true,"type":"module"}' | Set-Content package.json
npm install --no-audit --no-fund playwright-core@1.49.1

# 3. Run (the script starts and stops the mock and next start itself; one process at a time).
$env:CB_REPO = $b; $env:CB_E2E_DIR = $d
Remove-Item "$d\smoke.json" -ErrorAction SilentlyContinue
node smoke.mjs

# 4. Clean up. Remove the junction first so the real node_modules is not deleted.
cmd /c rmdir "$b\node_modules"
Remove-Item $b -Recurse -Force
```

Optional: `CB_BASE_URL` uses a server you started, `CB_EDGE` sets the Edge path, `CB_MOCK_PORT` moves the mock
(the build must use the same URL). Results are written to `$CB_E2E_DIR\<name>.json`, screenshots to `shots\`.
