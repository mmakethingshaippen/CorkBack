# Board browser harness (board usability improvements)

Drives real Microsoft Edge (Playwright core, `channel: "msedge"`) against a local
production build. It uses mocked data only: no Supabase, no writes, no real
location or camera permission.

- `next start` is started and stopped by the harness (default port 3200, next free port if busy) with
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` set to empty strings,
  so the app serves seed data (`src/lib/seed.ts`).
- `GET /api/postings/map` is intercepted and answered from `fixtures.mjs` (`FX_POSTINGS`, ids start with `fx-`).
  Pass `opts.mapBody` or `opts.routes` to `newPage` for other responses.
- OSM tiles are answered with a blank PNG and the geocoder with `[]`.
- An init script seeds `localStorage["corkback.mapCenter"]` and replaces `navigator.geolocation` with a stub
  (`opts.geolocation = "denied"` makes it fail).
- Viewports: `mobile` 390x844 and `desktop` 1280x800.
- Shared checks in `lib.mjs`: `checkNoHorizontalScroll`, `checkTapTargets` (44 px, primary 50 px),
  `checkOneDarkRedAction`, plus `measureMap` (map top edge and visible height above the bottom nav).
  Checks return `{ name, pass, detail }` and do not throw.
- Fixtures here are test data. They must never go into Supabase or `src/lib/seed.ts`, and `src/` must not import them.

The dependency is NOT in `package.json`. Install it in a scratch folder outside the repo.

## Run (PowerShell)

```powershell
# 1. Build in seed mode from a scratch copy WITHOUT .env.local.
#    Empty process variables are not enough: Next still loads .env.local and its
#    values win, so a build or `next start` run inside the repo serves the real
#    Supabase project (verified: real posting ids and handles on the home page).
$src = (Get-Location).Path; $b = "$env:TEMP\cb_board_build"
if (Test-Path $b) { Remove-Item $b -Recurse -Force }
robocopy $src $b /E /XD node_modules .next .git .vercel .kiro /XF .env.local /NFL /NDL /NJH /NJS | Out-Null
cmd /c mklink /J "$b\node_modules" "$src\node_modules" | Out-Null
Set-Location $b
$env:NEXT_PUBLIC_SUPABASE_URL = ""; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = ""; $env:SUPABASE_SERVICE_ROLE_KEY = ""
npm run build
Set-Location $src

# 2. Scratch folder outside the repo, copy the scripts, install Playwright core.
$d = "$env:TEMP\cb_board_e2e"; New-Item -ItemType Directory -Force $d | Out-Null
Copy-Item scripts\board-e2e\*.mjs $d
Set-Location $d
'{"private":true,"type":"module"}' | Set-Content package.json
npm install --no-audit --no-fund playwright-core@1.49.1

# 3. Run (the harness starts and stops next start itself).
$env:CB_REPO = "$env:TEMP\cb_board_build"   # the seed-mode copy, not the repo
$env:CB_E2E_DIR = $d          # shots\ and results JSON go here
node baseline.mjs
```

Remove the junction before deleting the build copy (`cmd /c rmdir "$b\node_modules"`), so the
real `node_modules` is not deleted.

Optional: `CB_BASE_URL` uses a server you already started (not stopped by the harness),
`CB_PORT` sets the first port to try, `CB_EDGE` sets the Edge path.

## Stage 2 (`stage2.mjs`)

Run it the same way as `baseline.mjs` (`node stage2.mjs`). Extra harness options used by it:
`opts.mapHandler(url)` answers `/api/postings/map` per request (`{ status?, body, delayMs? }`),
`opts.geocoderBody` is the canned place-search answer (the real geocoder is never contacted;
`geocodeRequests` lists what was asked), and `opts.position` sets the stubbed device position.
`window.__geoCalls` counts calls to the stubbed geolocation.

The page uses the server-rendered list (seed mode, empty around Berkeley) whenever the snapped
request key equals the default Berkeley 10 mi key, so fixture responses are only used for
other keys. The script therefore uses a "Berkeley" reference 2.2 km south of the default
point and asserts that its snapped box differs. The mock mimics `selectForBounds` (inclusive snapped bounds,
category, cap 100) and deliberately returns a posting just outside 10 mi that lies inside
the coarse box, so the browser's exact distance filter is what excludes it.

## Stage 3 (`stage3.mjs`)

Needs a different scratch build: the review, detail and edit pages are server-rendered from Supabase
(and the review and edit pages need a signed-in viewer), so `stage3.mjs` starts a tiny local mock
Supabase on `127.0.0.1:3299` (`CB_MOCK_PORT`) and the build must be made with the same URL, since
`NEXT_PUBLIC_*` values are inlined at build time:

```powershell
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3299"; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "fx-anon-key"; $env:SUPABASE_SERVICE_ROLE_KEY = "fx-service-key"
npm run build   # in the scratch copy WITHOUT .env.local, as in step 1 above
```

The mock answers `/auth/v1/user` and `/rest/v1/postings?id=eq.<id>` for the `fx` rows in the script and an
empty result for everything else. The browser carries a fake `sb-127-auth-token` session cookie for the
review and edit pages. `POST /api/postings` is intercepted and fails the run if ever called, and
`PATCH /api/postings/:id` is answered with a mocked 400. Nothing real is contacted or written.
Run `node stage3.mjs` with the same `CB_REPO` and `CB_E2E_DIR` as the other scripts.

## Stage 4 (`stage4.mjs`)

Same seed-mode scratch build as `baseline.mjs` (no `.env.local`, empty Supabase variables). Run `node stage4.mjs`
with the same `CB_REPO` and `CB_E2E_DIR`. `CB_ONLY=S,D2` runs only the named scenarios (S, T, D1, D2, D2b, D3, D4, P, P2, G).

`/api/postings/map` is answered per page by a mock that filters the fixtures by the requested snapped bounds and
category and caps pins at 300 and cards at 100 (`truncated` when more match). One-shot overrides (delay, HTTP 500,
network error, extra posting) are queued per mode. An init script wraps `fetch` to record when each map request starts,
is aborted and settles, and a 10 ms poller records "Updating…", the retry button and the pins. The network log of every
page is checked: only snapped bounds (0.1 grid), optional category and mode, and none of the viewer's coordinates.
The world map is panned with real mouse drags (a 175 ms hold before release stops inertia, then a 3 px pointer move,
because headless Edge otherwise delays MapLibre's `moveend` until the next pointer event).

## Stage 5a (`stage5a.mjs`)

Checks the automatic thread refresh on `/inbox/[id]`. It needs the same scratch build as Stage 3: the thread page is
server-rendered and needs a signed-in participant, so the script starts a local mock Supabase on
`127.0.0.1:3299` (`CB_MOCK_PORT`) and the build must use the same URL (`NEXT_PUBLIC_*` values are inlined at build time):

```powershell
# Step 1 above (copy without .env.local, junction node_modules), then in the copy:
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:3299"; $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = "fx-anon-key"; $env:SUPABASE_SERVICE_ROLE_KEY = "fx-service-key"
npm run build
# Run from the scratch e2e folder with CB_REPO and CB_E2E_DIR set as above:
node stage5a.mjs
```

In the browser only `GET /api/messages` (answered from an in-memory list with an inclusive `after` filter),
`/api/messages/unread` (`{supported:false}`) and `/api/messages/read` (200) are mocked. `POST /api/messages` and
`/api/messages/reply` are intercepted and fail the run if called. `page.clock` runs minutes of polling in seconds, and a
fetch wrapper stamps each poll with the page's virtual `Date.now()`, so intervals are measured in virtual time.

## Stage 5b (`stage5b.mjs`)

Same scratch build, mock Supabase and `page.clock` approach as Stage 5a (build with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:3299`,
no `.env.local`). Only `GET /api/messages/unread` (ok, `{supported:false}`, 401 or 500 per scenario) and
`POST /api/messages/read` (records the body, answers 200) are mocked for the feature, plus the page data
(`/api/messages/threads`, `GET /api/messages`). Signed-out scenarios simply omit the session cookie. Sends fail the run.
`CB_ONLY=A,B` runs only the named scenarios (A, B, C, D, D2, E, E2, F, G).

```powershell
# After the Stage 5a-style build (same env), from the scratch e2e folder:
$env:CB_REPO = "$env:TEMP\cb_board_build"; $env:CB_E2E_DIR = "$env:TEMP\cb_board_e2e"
node stage5b.mjs
# Clean up: remove the junction first so the real node_modules is not deleted.
cmd /c rmdir "$env:TEMP\cb_board_build\node_modules"
Remove-Item "$env:TEMP\cb_board_build" -Recurse -Force
```

The harness starts and stops `next start` itself and leaves no server running.
