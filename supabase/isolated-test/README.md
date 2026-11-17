# Isolated stage 8 test (no Docker, no production access)

Runs the production migration chain, the stage 8 SQL and the deployed code's
database calls against a throwaway local database:

- embedded PostgreSQL 17 (npm `embedded-postgres@17.11.0-beta.19`), UTF-8
- PostgREST **14.18** (the version production reports), Windows binary
- Supabase-like roles (`anon`, `authenticated`, `service_role`, `authenticator`,
  non-superuser `postgres` owner), `auth.users`, `auth.uid()` and Supabase's
  default privileges (`bootstrap.sql`)
- the deployed code's (`6289a7e`) exact supabase-js/postgrest-js calls for
  publish, reads, promote, likes/plans and messaging, with HS256 JWTs

Sequence (`run.mjs`): migrations → deployed calls → preflight → stage 8 phase A
→ verify_admin → verify_roles → deployed calls → phase B → deployed calls (the
direct promote must now be refused) + the new promotion function → phase B
re-grant + stage 8 rollback → deployed calls → owner-only setup scripts refuse
placeholders → phase A again (idempotent) → temporary test admin grant/revoke.

## Setup (once, in a folder outside OneDrive)

```powershell
$d = "$env:TEMP\cb-iso"; New-Item -ItemType Directory -Force $d | Out-Null; Set-Location $d
'{"private":true}' | Set-Content package.json
npm install --no-audit --no-fund embedded-postgres@17.11.0-beta.19 @supabase/supabase-js@2.47.10
node node_modules\@embedded-postgres\windows-x64\scripts\hydrate-symlinks.js
Invoke-WebRequest https://github.com/PostgREST/postgrest/releases/download/v14.18/postgrest-v14.18-windows-x86-64.zip -OutFile postgrest.zip
Expand-Archive postgrest.zip -DestinationPath postgrest
```

## Run

```powershell
$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\run.mjs
```

Result on 2026-11-11: **52/52 passed** (verify_admin 29/29, verify_roles 97/97, plus 17 multi-session checks).

`concurrency.mjs` runs last (the sequence above, then step 8). It opens many real connections and asserts: 24 simultaneous
replies by one user give exactly 10 accepted; deleting replies does not return allowance; retries of an accepted key
return the original id at the limit; 12 simultaneous reports give exactly 5; a report started while a hide or an author
delete is uncommitted waits (checked with `pg_blocking_pids`) and is then refused with nothing written; a hide started
while a report is uncommitted waits and then resolves that report; dismiss vs hide in both orders; a stress round of
hide / two dismissals / report / delete / restore with no deadlocks. It creates and deletes users, so run it only here.

`takedown.mjs` (design Property 15, Requirement 10.9) compares `public.posting_takedown_at` and
`cb_safe_time_zone` from `stage6_social_part1.sql` with the app's `postingTakedown` (`src/lib/lifecycle.ts`), to the
millisecond, for about 7,600 seeded rows. The rows cover listings (only `end_date`, with or without `end_time`) and
Community postings (no dates, only `event_date`, or with `end_date`/`end_time`), on and around daylight saving days.
They use every zone name in `pg_timezone_names`, plus null, malformed, abbreviation and POSIX-style names. The script
cuts the two function definitions out of the stage file and runs them. The TypeScript runs as-is: sucrase (already in
the repo's `node_modules`) transpiles it in memory, and nothing is written or reimplemented. Run it with
`$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\takedown.mjs`. To check a draft fix, also set
`$env:CB_TAKEDOWN_DRAFT = "stage13_takedown_app_parity.sql"`. The script applies the draft twice, compares, then applies
`_rollback.sql` and checks that the stage 6 definitions come back exactly.
Result on the current stage 6 SQL: 458 mismatches. These are local end times in a daylight saving gap or overlap,
`end_time` with fractions or 24:00, and pattern-valid zone names that Postgres reads as an abbreviation or POSIX rule.
With the stage 13 draft: 0 mismatches and a rollback PASS. 304 rows are reported as a known limit and do not fail:
PST, CET, EET, MET and WET, which only the app accepts and which tz-lookup never returns.

Mutation check: set `CB_SQL_DIR` to a scratch copy of `supabase/` with one deliberate regression and run `run.mjs`.
Seven regressions (no share lock in `submit_posting_report`, `posting_reaction_counts` ignoring moderation, no report-owner
check in `admin_hide_posting`, the old audit trigger, no posting lock in `admin_dismiss_report`, rate limit counted on
`replies` instead of the ledger, no per-user lock in `submit_reply`) each made the run fail.

Limits: production's exact Postgres minor version and any untracked manual
changes in production are not reproduced. The production preflight is the
check for that. PostgREST on Windows sometimes exits with code 3 at startup;
the harness retries up to three times and reports the attempt.

`geoindex.mjs` (Requirement 16, task 9.8) tests the stage 12 geo index drafts (`stage12_postings_geo_index*.sql`, not
applied anywhere). It builds minimal `public.postings` and `public.categories` tables with the real column names and
types and seeds 5,000 rows (a dense Bay Area cluster, rows across the US, deleted, hidden and expired rows, promoted
rows, shared `created_at` values). It runs the preflight, the migration twice, verify, and the rollback twice (also with
no index present), and asserts exactly one index, a stable definition, and an unchanged md5 hash of every row after each
step. A SQL version of the map query (inclusive lat/lng range, deleted/hidden null, `expires_at > now()`, optional
category join, `is_promoted desc, created_at desc, id desc`, limit 101) runs for ten boxes before the index, with it
(default planner and `enable_seqscan = off`, checking the plan names the index) and after rollback; the id lists must
match exactly. Mutation checks: five wrong indexes (missing either condition, an `expires_at` predicate, not partial,
columns reversed) make both verify and the migration fail; a modified row, a deleted row and a migration variant that
updates a row each change the hash. Run it with `$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\geoindex.mjs`.
Result: **54 passed, 0 failed**. The drafts needed no fix.

`messagereads.mjs` (Requirement 19, task 12.2, design Property 24) tests the stage 11 message reads drafts
(`stage11_message_reads*.sql`, not applied anywhere). It loads the production files for the prerequisite schema
(`schema.sql`, `stage3_messaging.sql`, `stage6_social_part4.sql`), seeds three threads with messages (one thread has none), then
runs: the preflight, rollback on the unmigrated database, the migration twice (same marker rows, messages and threads
unchanged), `verify_roles` (ALL CHECKS PASS, no data left behind), grants and RLS checks (anon has no access, a third
user sees nothing and cannot mark, an earlier timestamp leaves the marker, a future timestamp stores server time), the
backfill (every pre-existing thread at 0 unread, the empty thread returns a 0 row), and the rollback (table, functions and
policies gone, messages and threads unchanged). Property 24 generates 60 random worlds (seeded; `CB_SEED`, `CB_RUNS`):
threads, messages and mark calls (earlier, later, equal to a message time, future, and from non-participants). It compares the
stored markers and every user's `cb_unread_counts()` rows, zeros included, with `unreadCount` and `advanceMarker` from
`src/lib/unread.ts` (transpiled in memory with sucrase). Mutation checks apply seven broken variants (counts own messages,
`>=`, marker can move back, no server-clock cap, third user reads counts, non-participant can mark, backfill marks nothing
read); each makes Property 24 or the backfill check fail. Run it with
`$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\messagereads.mjs`. Result: **67 passed, 0 failed**.
Two draft bugs were found and fixed in `stage11_message_reads_verify_roles.sql`: check V3 required `anon` to have no
SELECT on `messages` and `message_threads`, but Supabase's default privileges give `anon` SELECT (RLS denies the rows), so it now
checks only INSERT, UPDATE and DELETE; and V7, V9 and V10 read the stored marker in the same SQL statement that wrote it,
so the sub-select used the old snapshot, and the mark now runs in its own statement first.

## twoaccount.mjs (stage 11 with two accounts and thread auto-refresh)

`$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\twoaccount.mjs`

This is a local run only: embedded PostgreSQL 17 and PostgREST 14.18 on this machine, with no Next.js server, Supabase Auth or browser. It applies the production chain and then the stage 11 preflight, migration and verify_roles files. Synthetic users `iso_alex` and `iso_blair` (plus `iso_casey` as a third user) talk to PostgREST with their own JWTs.

What it reuses from the app:
- The shipped client logic: `createPoller`, `mergeMessages` and the `unread.ts` helpers, transpiled in memory.
- The route database calls and ThreadView's run and mark-read logic, copied from those files.

What it covers:
- The backfill.
- Unread counts and badge text.
- First load without `after`, then cursor polls.
- Auto-refresh in both directions.
- Unread clearing.
- The hidden-tab pause.
- Same-timestamp and same-millisecond messages.
- Third-user and anonymous denial.
- Marker monotonicity and the server-time clamp.
- No overlapping requests.
- Rollback: unread answers `{ supported: false }` and messages are unchanged.

Result on 2026-11-16: 30 passed, 0 failed. It found a precision bug in `advanceMarker` and `unreadCount`, which compared timestamps at millisecond precision while Postgres stores microseconds. The bug is fixed in `src/lib/unread.ts` and covered by `unread.micro.test.ts`.

## location.mjs (stage 14 posting location)

`$env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\location.mjs`

Local run only: embedded PostgreSQL 17 and PostgREST 14.18 on this machine. The script refuses to start (exit 2) if an
environment variable names the production project or a hosted database host. It loads the production chain through stage 8,
seeds three synthetic postings, then runs the stage 14 preflight, the migration (twice), `verify` (requires the
`ALL CHECKS PASS` row and checks that its transaction rolled back), an `md5` of the posting rows before and after, PostgREST
checks (the author JWT updates its posting, another user's JWT gets `CB404`, an invalid precision gets `22023`, and `anon` and
`authenticated` are refused on the geocoder tables and functions), the rollback (every stage 14 object gone, the stage 8 insert
grants back exactly, run twice), and the migration again. It prints `PASS` and `FAIL` lines and exits non-zero on any failure.
Smoke run: 40 passed, 0 failed. The database property tests (task 5.5) extend this file.
