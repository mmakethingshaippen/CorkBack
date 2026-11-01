# Kiro Usage Log

One entry per Kiro feature actually used in each stage, with what it did in this project.
The final writeup is built from this log, not from memory.

---

## Stage 0 — skeleton + governance (2026-11-01)

- **Steering docs** — Created four steering docs under `.kiro/steering/`: design tokens (full Foundations palette + Kalam rules), account model, location rules, and Follow/Connect independence. These load into every Kiro interaction so the locked rules are never re-litigated screen by screen.
- **Kiro IDE** — Used the Kiro IDE in the workspace to scaffold the project and author all files directly in the editor/workspace.

## Stage 1 — core-loop spec (2026-11-01)

- **Specs (spec-driven development)** — Wrote the core-loop spec (requirements → design → tasks) before any application code. The data model, account model, categories, and location rules are set on day one in the design doc even though social features ship later. A spec-driven vs. vibe-coding comparison will be written from this build's actual experience in the final writeup.

## Stage 1 — core loop (2026-11-01)

- **Property-based testing (fast-check)** — Wrote four property suites over the locked domain rules in `src/lib/domain.ts`: (1) username validity IFF `^[A-Za-z0-9_]{3,20}$`; (2) a posting always expires after its preset, and event-date takedown is never later than preset expiry; (3) a pin always stays within the nudge bound of the poster's real location; (4) Choice B card tilt is always 2–8° and adjacent cards never mirror. **What it caught:** the pin-nudge property found an overshoot when the nudged point crossed the antimeridian (fixed by replacing naive lat/lng interpolation with a geodesic bearing+destination offset), and the card-tilt property found an off-by-one that let the magnitude reach 8.9° instead of capping at 8° (fixed the modulo range). Both were real bugs surfaced before any screen was built.
- **Agent Hooks** — `typecheck-on-save` hook (`.kiro/hooks/typecheck-on-save.json`) runs `npm run typecheck` on every `.ts/.tsx` save, catching type regressions during the build without a manual step.

> Features planned for later stages and to be logged when actually used: Kiro Powers (if it fits the stack), Custom Agents (only if a real job needs one — otherwise the writeup states none was used), MCP (only if it enables a real feature — otherwise the writeup states none was used).

### Stage 1 additions (2026-11-01)

- **Specs (spec-driven)** — The `.kiro/specs/core-loop` requirements/design/tasks drove the whole build in order. Having the day-one data model and locked choices written down first meant no screen re-litigated a rule; components were built before screens exactly as the tasks ordered. (Spec-driven vs. vibe-coding comparison for the writeup: the property tests caught two bugs that a vibe-coded version would likely have shipped, because the invariants were written as rules first.)
- **Steering docs** — The always-on steering (tokens, account model, location rules, Follow/Connect independence) was the single source of truth for every component's colors, the one-dark-red-action rule, Choice A/B, and the Like-postings-only lock.
- **Kiro IDE tool** — Used throughout to scaffold, edit, run the build/tests, and verify the running app locally. (Only Kiro IDE used so far; Kiro CLI/Web/Crew not used this stage.)
- **Web search** — Used to confirm the patched Next.js version for CVE-2025-66478 before pinning dependencies.

## Stage 2 — radius email alerts (2026-11-01)

- **Specs/steering** — Stage 2 built against the day-one data model and the locked steering: the always-on `location-rules` (radius 1–25 miles or whole town; exact location private) and `account-model` (email private, alerts require sign-in) drove the alert fields and privacy rules directly.
- **Kiro IDE** — Used to extend the schema, write the pure matching logic, the Resend integration, the CRON-guarded sweep, and the alerts screen; and to run typecheck/tests/build and the live route checks.
- **Unit testing (vitest)** — Added `src/lib/alerts.test.ts` with the four required cases (match inside radius, no email outside radius, no email for a different category, no duplicate across repeated sweeps) plus owner/hidden/expired/past-event/whole-town. Writing the matcher as a pure function first (same approach as Stage 1's domain rules) kept the sweep thin and the rules testable without a DB or a live email.
- **Third-party tools introduced this stage:** Resend (transactional email, server-side only) and the free OpenStreetMap Nominatim geocoder (town name → center, no key). MapLibre/Supabase/Gemini unchanged. No new Kiro Powers/MCP/custom agents were needed this stage.
- **Discrete external help:** none this stage (ChatGPT's discrete help was limited to the earlier scan fix, already logged).

### Stage 2 live email acceptance (2026-11-01)

- **Resend (email) — verified live.** A matching posting sent exactly one email (Resend accepted, `sent=1`), a wrong-category posting sent none, and a repeat sweep sent no duplicate (`sent=0, skipped=1`). Used Resend's safe `delivered@resend.dev` recipient and `onboarding@resend.dev` sender for the test so no real user was emailed. Keys read from `.env.local` only and never logged.
- **Supabase service role + CRON** — the sweep ran via the CRON_SECRET-guarded route using the service role to match across users and write the `sent_alerts` dedupe ledger.
- **Env-only fix** — the single issue found live (unverified From domain) was resolved by setting `ALERTS_FROM_EMAIL`, with no application code change — the code already read that variable.

## Stage 3 — private messaging (2026-11-01, code complete; live pending migration)

- **Specs/steering** — Built against the day-one model and the `follow-connect-independence` steering: messaging adds no Like, does not touch Follow/Connect, and keeps public replies separate from private threads.
- **Kiro IDE** — Authored the RLS migration, pure messaging helpers, API routes, and inbox/thread UI; ran typecheck/tests/build.
- **Unit testing (vitest)** — Added `src/lib/messaging.test.ts` (9): participant-only access, a third user blocked, public browsing unchanged (the public Posting type carries no message/thread field), plus pairing and body validation. Encoding the participant rule as a pure function mirrors the DB RLS and lets the "third user blocked" guarantee be tested without a database.
- **No new third-party tools** this stage. No Kiro Powers/MCP/custom agents needed.
- **Live step pending** — the two-account send/reply + third-user-blocked live test is blocked until `stage3_messaging.sql` is applied in Supabase (DDL cannot be run from the REST service-role key).

### Stage 3 live verification (2026-11-01)

- **Supabase (Postgres + RLS + Auth) — verified live.** Three real accounts proved the participant-only guarantee end to end: both participants read and replied; a third account got 0 messages, a 403 on reply, and no thread in its inbox. Public browsing of the posting page (unauthenticated) showed no message text. RLS on `message_threads`/`messages` is the enforcement; the pure helpers mirror it.
- **Kiro IDE** — Drove the live scenario through the running dev server's API with real auth sessions, ran the gates, and performed cleanup. One test-harness fix (correct @supabase/ssr cookie format); no application code changed for the live test. The only app code change this stage was a lint-warning fix in ThreadView, after which typecheck/tests/build were re-run green.
- **No real user emailed or touched:** all test users were throwaway (msgtest_*) and fully removed after the run.

## Stage 4 — promoted postings (2026-11-01)

- **Specs/steering** — Reused the day-one `is_promoted` field (set in the Stage 1 data model) instead of adding a column, honoring "extend only if a field is missing." The locked design-tokens steering kept the label and owner control to existing tokens (deep navy / neutral), no new color.
- **Kiro IDE** — Wrote the pure placement logic, the owner-only promote API, the owner UI control, and wired promoted-first ordering into the postings read path; ran the gates and the live two-account test.
- **Unit testing (vitest)** — Added `src/lib/promotion.test.ts` (7). Encoding placement as a pure, group-local stable sort let the "promoted first in same area+category / ordinary order unchanged / no cross-area or cross-category leapfrog / ends at expiry" rules be tested deterministically without a DB. Promotion's no-effect on alerts is also covered by the existing alert matcher ignoring `is_promoted`.
- **Supabase RLS — verified live.** Owner-only promotion proven: a non-owner got 403, the owner succeeded, and removal reverted the flag. Public (signed-out) browsing showed the Promoted label and top placement.
- **No payment/billing** introduced (contest scope). No new third-party tools, Powers, MCP, or custom agents this stage.

## Stage 5 — polish, seed, deploy prep, demo + writeup prep (2026-11-01)

- **Kiro IDE** — Swept the whole app for placeholder text, dead buttons, broken links, and mobile-layout breaks; fixed only what the sweep found (dead Share/Report controls → working ShareButton / removed; dead home search input removed; seed placeholder URL nulled). Ran the gates after fixes (57 tests, typecheck, build all green).
- **Steering (design tokens)** — The polish stayed inside the locked palette (navy link / neutral), no new color, no texture swatch.
- **Deploy** — Vercel is not linked on this machine; stopped and reported the exact steps rather than guessing (no key printed).
- **Prep deliverables** — `DEMO_PLAN.md` (sub-3:00 shot list) and `WRITEUP_DRAFT.md` (built from this log) prepared. Writeup names Kiro features used, names ChatGPT discrete help (scan fix) honestly, states Kilo unused, states the Figma-before/code-inside timeline, and names Resurrection + Best Student Project.
- **No new third-party tools, Powers, MCP, or custom agents** this stage.
