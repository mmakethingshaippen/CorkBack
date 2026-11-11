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

Mutation check: set `CB_SQL_DIR` to a scratch copy of `supabase/` with one deliberate regression and run `run.mjs`.
Seven regressions (no share lock in `submit_posting_report`, `posting_reaction_counts` ignoring moderation, no report-owner
check in `admin_hide_posting`, the old audit trigger, no posting lock in `admin_dismiss_report`, rate limit counted on
`replies` instead of the ledger, no per-user lock in `submit_reply`) each made the run fail.

Limits: production's exact Postgres minor version and any untracked manual
changes in production are not reproduced. The production preflight is the
check for that. PostgREST on Windows sometimes exits with code 3 at startup;
the harness retries up to three times and reports the attempt.
