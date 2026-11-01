# CorkBack — Kiro Writeup (draft)

> Draft built from `KIRO_USAGE_LOG.md` and `BUILD_LOG.md`. Names each Kiro feature actually used, names discrete external help honestly, and states the Figma/app-code timeline. Not final copy.

## What CorkBack is

CorkBack is a civic board, not a social dashboard. It turns a photo of a paper flyer into a structured posting pinned on a public local map. Anyone can browse the map and open postings with no account; an account (email only) is required to post, reply, set alerts, or message. Built as a Next.js (App Router) + TypeScript app on Vercel, with Supabase (Postgres + RLS + email auth), MapLibre (free tiles), Gemini for server-side flyer extraction, and Resend for radius email alerts.

## Design timeline (stated plainly)

**The Figma design existed before the contest window. All application code was built inside the window.** The Figma file was used only as visual reference (screen-by-screen PNGs and an icon set); no Figma texture swatch was shipped in the app, and the cork texture is generated procedurally in CSS. The design tokens (Paper, Card, Board, Ink, Dark red, Deep navy; Kalam type) were copied into steering and enforced in code.

## How Kiro was used (by feature actually used)

- **Spec-driven development (Kiro Specs).** Each stage began with a spec (requirements → design → tasks) before code. The core-loop spec set the data model, account model, categories, and location rules on day one, even though social features shipped in later stages. Building components before screens, in the task order, came straight from the spec. In practice, writing the invariants as rules first (not vibe-coding) is what let property tests catch two real bugs before any screen existed.
- **Steering docs.** Four always-on steering files (design tokens, account model, location rules, Follow/Connect independence) were the single source of truth across every stage: the one-dark-red-action rule, Choice A (cork only on header bands/empty states), Choice B (uneven 2–8° card tilt), the Like-postings-only lock, and the Follow/Connect independence were never re-litigated screen by screen.
- **Agent Hooks.** A `typecheck-on-save` hook ran `npm run typecheck` on every `.ts/.tsx` save, catching type regressions during the build without a manual step.
- **Property-based testing (fast-check) + unit tests (vitest).** Property suites over the locked domain rules caught a pin-nudge overshoot at the antimeridian (fixed with a geodesic offset) and a card-tilt off-by-one that exceeded 8° (fixed the range). Later stages added focused suites: alert matching (inside/outside radius, wrong category, no-duplicate), messaging (participant-only, third user blocked, public browsing unchanged), and promotion placement (promoted-first within area+category, ordinary order unchanged, ends at expiry). Final suite: 57 tests.
- **Kiro IDE.** Used throughout to scaffold, edit, run builds/tests, and verify the running app live.
- **Web search (Kiro).** Used once to confirm the patched Next.js version for CVE-2025-66478 before pinning dependencies, and to confirm the current Gemini model id.

Kiro tools used: **Kiro IDE** only. Kiro CLI, Kiro Web, and Kiro Crew were not used.

## Features not used (stated honestly)

- **Kiro Powers:** none used.
- **MCP:** none used — no feature needed a tool that MCP would have enabled.
- **Custom agents:** none used — no step in this build needed one.

## Third-party services (named)

- **Supabase** — Postgres, Row Level Security (participant-only messaging, owner-scoped writes, public read for browsing), and email auth.
- **MapLibre GL** — interactive map with free OpenStreetMap raster tiles; no proprietary map assets shipped.
- **Gemini** — server-side flyer extraction only. The exact model verified and used is **`gemini-3.5-flash-lite`** (older flash models were shut down or blocked for the key; this one returned title/date/time/place reliably). The API key is server-only and never logged.
- **Resend** — radius email alerts, server-side. For production, a **verified Resend sending domain is still required**; the `onboarding@resend.dev` sender used in testing was for testing only.
- **OpenStreetMap Nominatim** — free town-name geocoding for alerts (no key).

## Discrete external help (named honestly)

- **ChatGPT — discrete debugging help, scan fix only.** ChatGPT helped harden the scan route's error handling, timeout, and API-key redaction during the scan fix. Kiro was the main builder and reviewer; every change was reviewed and verified live by Kiro, and the change was recorded in `BUILD_LOG.md`.
- **Kilo — not used.** No Kilo discrete fix was performed in this build; the build log records none. (The Kilo handoff protocol was available but not exercised.)

## Spec-driven vs. vibe-coding (from this build)

Writing the locked rules as specs and pure functions first made the hard parts testable before any UI existed. The property tests caught two geometry/boundary bugs that a vibe-coded version would likely have shipped. The cost was up-front discipline; the payoff was that each later stage (alerts, messaging, promotion) slotted into a data model that already anticipated it, with no rebuilds.

## Contest categories

- **Category:** Resurrection.
- **Bonus:** Best Student Project (student details to be completed in the Devpost form).

## Submission checklist (prep status)

- Public app URL: pending Vercel deploy (see `DEMO_PLAN.md` / BUILD_LOG for the deploy steps).
- Public GitHub repo with `.kiro/` at the root and an OSS license: prepared, not yet pushed.
- Demo video under 3:00 showing scan end-to-end + map + alerts + messaging + promoted label: planned in `DEMO_PLAN.md`, not yet recorded.
- This writeup: to be finalized from this draft.
