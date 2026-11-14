# Profile photo browser test

Drives real Microsoft Edge (headless, `playwright-core`) against a running CorkBack
build and the Supabase project in `.env.local`, with four disposable accounts:
`cbsoc_a_<hex>` (owner under test), `cbsoc_b_<hex>` (second account),
`cbsoc_r_<hex>` (rate limit) and `cbsoc_admin_<hex>` (moderation view; the owner
grants it with `supabase/stage8_test_admin.sql`). Email `@corkback-test.invalid`.

It WRITES to that database and its `avatars` bucket through the service role.
Always run cleanup. Uploads are rate-limited (5 per 10 minutes per account), so a
full rerun needs fresh accounts (`cleanup.mjs`, then `setup.mjs`).

```powershell
$d = "$env:TEMP\cb_avatar_e2e"; New-Item -ItemType Directory -Force $d | Out-Null
Copy-Item scripts\avatar-e2e\*.mjs $d; Set-Location $d
'{"private":true,"type":"module"}' | Set-Content package.json
npm install --no-audit --no-fund playwright-core@1.49.1 @supabase/supabase-js@2.47.10
$env:CB_REPO = "<repo>"            # .env.local and sharp are read from here
$env:CB_E2E_DIR = $d
$env:CB_BASE_URL = "http://localhost:3100"
# In the repo: npm run build ; npx next start -p 3100
node baseline.mjs   # counts + hashes (profiles incl. avatar_path, postings, every bucket object name)
node setup.mjs      # prints the temporary admin username; grant it before test.mjs
node test.mjs       # full suite -> results.json, shots\
node followup.mjs   # optional: reruns the message, admin, missing-file and username sections
node cleanup.mjs    # deletes only what setup recorded (objects first); prints MATCH vs baseline
```

- Fixtures (wide two-tone PNG, JPEG, WebP, GIF, SVG, text named .png, a >2 MiB PNG) are generated in `fixtures\`.
- Never call supabase-js `auth.signOut()` with the default scope in these scripts: it is global and ends the browser session too.
- Storage answers `HEAD` with `no-cache`; check cache headers with `GET`.
- The upload ledger (`avatar_uploads`) has no service-role access; its rows go with the profile (ON DELETE CASCADE). The admin grant goes the same way.
- Delete the scratch folder afterwards (it contains the test password).
