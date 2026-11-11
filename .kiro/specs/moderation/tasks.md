# Reporting, Moderation and Live Fixes — Tasks

Status: [ ] not started · [~] implemented, not yet verified everywhere it must be · [x] verified.
Release order and gates: design.md §11. Do not apply production SQL, push, deploy, grant a real admin or delete real accounts without approval. Preserve `cbsoc_qa_1110b` and its messages.

## 0. Plan and database review
- [x] 0.1 Read steering, specs and logs; inspect replies, posting page, owner controls, posting reads, RLS and grants.
- [x] 0.2 Reproduce F1–F3 on production; find F4 (author moved pin / extended expiry via the API). Disposable data removed.
- [x] 0.3 Spec: requirements, design, tasks. Decisions approved 2026-11-10 (design §14).
- [x] 0.4 SQL revised after review (audit-log protection, publish columns, server-set created_at/expiry, `set_posting_promoted` two-phase release, exact EXECUTE grants), then again after the second review: replies only through `submit_reply` with a durable ledger and a per-user lock; `posting_reaction_counts` hides moderated postings; `admin_hide_posting` validates the report id; reports/dismissals/hides take locks in one order; tighter audit trigger; explicit rollback revokes.
- [x] 0.5 Isolated run (embedded Postgres 17 + PostgREST 14.18): **52/52** including a multi-session concurrency suite; seven deliberate regressions each make it fail. Harness: `supabase/isolated-test/`.
- [x] 0.6 **Max:** reviewed the SQL.
- [x] 0.7 **Max:** phase A applied on production; 30 catalog checks and 97 role checks passed; cleanup and existing-data checks passed.

## 1. Live fixes
- [x] 1.1 Like label "Unlike this posting. N likes" when selected (F3). Detail page and cards use one helper; unit-tested; browser-checked.
- [x] 1.2 Replies end to end (F1): composer, list, delete, ended/hidden/deleted rules, limits. `submit_reply` RPC (not a table insert).
- [x] 1.3 Owner edit (F2): `/p/[id]/edit`, `PATCH /api/postings/[id]`, `validatePostingEdit`.
- [x] 1.4 Owner delete with confirmation (F2): posting page, profile cards, ended and moderated postings.
- [x] 1.5 `PromoteToggle` → `set_posting_promoted` (needed before phase B). Phase B itself is NOT applied.
- [x] 1.6 Card Like/Unlike on home, Following and profiles (requirements §3.4): 25/25 again on this branch; hidden-posting check done.

## 2. Reporting
- [x] 2.1 `src/lib/moderation.ts` + tests.
- [x] 2.2 Report API and component, all states (browser-verified on production).

## 3. Moderation
- [x] 3.1 Neutral not-found; author hidden notice; alerts cron excludes hidden; Friends activity drops hidden postings.
- [x] 3.2 `/admin` + admin APIs; dismiss/hide/restore; history. Browser-verified against the **isolated** database (27/27). **Not yet exercised on production:** needs the temporary admin (below).
- [x] 3.3 Admin link on the admin's own profile.

## 4. Verification and release
- [x] 4.1 typecheck, lint, unit tests (188), production build (outside OneDrive).
- [x] 4.2 REST/RLS suite with real JWTs against production phase A: 24/24.
- [~] 4.3 Browser suites on production phase A, local production build: non-admin roles done (reporting 24/24, owner/promote/Like 27/27, replies 21/21, hidden surfaces and social regression 22/22, Stage 4 messaging 75/75, cards 25/25, layout 0 overlaps). **Admin role on production: waiting for Max to grant the temporary admin.**
- [~] 4.4 Cleanup: done for everything except the disposable admin account and the kept `[TEST]` audit rows (none new from this run). Final cleanup after the admin run.
- [ ] 4.5 Logs; commit on the new branch (done locally, not pushed); protected preview. **Stop for approval** before push/merge.
- [ ] 4.6 After production deploy: **Max** applies phase B (`stage8b_promotion_lockdown.sql`); production smoke.
