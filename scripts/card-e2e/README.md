# Card reactions browser test (Like / Going / Interested on posting cards)

Drives real Microsoft Edge against a running CorkBack build, with two disposable
accounts and `[TEST]` postings created through the Supabase service role.
It checks cards on home, Following and profiles: no navigation on react,
persistence across refresh and sign-out, detail-page agreement, two-account
totals, exclusive Going/Interested, rapid taps, failed saves, ended and
moderator-hidden postings, signed-out view, keyboard use, 390 px and 1280 px layouts.

It WRITES to the database named in `.env.local` (service role). Run it only
against the project you intend to test, and always run cleanup. The "hidden"
case needs Stage 8 phase A (`moderation_hidden_at`) to be applied.

The scripts are plain ES modules, kept in the repo but not part of the app build.
Their two dependencies are NOT in `package.json`; install them in a scratch folder.

## Run (PowerShell)

```powershell
# 1. Scratch folder outside the repo; copy the scripts there so imports resolve.
$d = "$env:TEMP\cb_cards_e2e"; New-Item -ItemType Directory -Force $d | Out-Null
Copy-Item scripts\card-e2e\*.mjs $d
Set-Location $d
'{"private":true,"type":"module"}' | Set-Content package.json
npm install --no-audit --no-fund playwright-core@1.49.1 @supabase/supabase-js@2.47.10

# 2. Point at the repo's env file (service role key) and at the build under test.
$env:CB_ENV_FILE = "<repo>\.env.local"
$env:CB_E2E_DIR  = $d                      # state.json, shots\, results.json go here
$env:CB_BASE_URL = "http://localhost:3100" # default

# 3. In another terminal, in the repo:  npm run build ; npx next start -p 3100

node baseline.mjs   # row counts + hashes before
node setup.mjs      # 2 users, 4 [TEST] postings, A follows B
node test.mjs       # PASS/FAIL lines; 2026-11-11 run: 62 checks (see report)
node cleanup.mjs    # deletes ONLY what setup recorded; compares with baseline
```

Notes:
- `CB_BASE_URL` can point at another origin, but a protected Vercel preview needs
  a login or bypass secret, which these scripts do not handle.
- Accounts are `cbsoc_a_<hex>` / `cbsoc_b_<hex>` with `@corkback-test.invalid` email.
- Rapid-tap checks dispatch clicks synchronously; Playwright's own `click()` is queued.
- If a run is interrupted, `cleanup.mjs` still works from `state.json`
  (setup saves state before each create).
- Cleanup's comparison covers counts and hashes of `postings` and `profiles`; other
  sessions writing during the run will show up as a mismatch, so read the output.
- Delete the scratch folder yourself afterwards (it contains the test password).
