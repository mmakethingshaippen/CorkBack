# Implementation Plan: Core Loop

## Overview

Implementation plan for Stage 1. Components are built before screens. Each task cites the requirements it satisfies. Do not start coding until Max approves the plan and spec. Verify the stage live before Stage 2.

Status key: [x] done & verified locally · [~] built, needs live verification with credentials · [ ] not started.

## Tasks

- [x] 1. Project + infra wiring
  - [x] 1.1 Confirm skeleton builds (`npm install`, `typecheck`, `build`). _(Req 7)_
  - [x] 1.2 Add Supabase client (browser anon + server service-role) and env wiring from `.env.example`. _(Req 2, 8)_
  - [x] 1.3 Create the database schema + RLS policies from design §2 (`supabase/schema.sql`). Seed categories. _(Req 8, all)_ — SQL authored; apply in Supabase to go live.

- [x] 2. Design-system components (before screens)
  - [x] 2.1 Wordmark (text, Kalam Bold, "Back" dark red, navy label). _(Req 7.6)_
  - [x] 2.2 Card with uneven 2–8° tilt algorithm (Choice B). _(Req 7.5)_
  - [x] 2.3 CorkBand (procedural cork, header/empty-state only — Choice A). _(Req 7.4)_
  - [x] 2.4 CategoryChip, PrimaryAction (one dark-red per screen), SecondaryAction, Field (2px navy border). _(Req 7.1, 7.2, 7.7)_
  - [x] 2.5 BottomNav, PosterHandle, LikeButton (in PostingActions), PlanControls, SignInToTakePart, Pin (MapView marker). _(Req 1, 6)_
  - [x] 2.6 Canonical inline SVG icons; no phone status-bar art or map fragments. _(design §6)_

- [x] 3. Accounts (email only)
  - [x] 3.1 Username validator + **property-based test** (passes). _(Req 2.4)_
  - [x] 3.2 Sign-up / sign-in (email only, no full name, email private). _(Req 2.1–2.3, 2.5)_ — UI + API built; needs Supabase to complete a real signup live.
  - [x] 3.3 "Sign in to take part" gating for write actions (visitor paths verified live). _(Req 1.3, 6.5)_
  - [x] 3.4 No demo-login / Board-view / Board-Map toggle exists. _(Req 2.6)_

- [x] 4. Scan and review
  - [x] 4.1 `/scan` capture-or-choose screen (+ visitor gate). _(Req 3.1)_
  - [x] 4.2 Server route `POST /api/scan/extract` calling Gemini (key server-only). _(Req 3.2, 3.6)_ — built; needs GEMINI_API_KEY to extract live.
  - [x] 4.3 `/scan/review` editable fields, category chips, expiry presets, optional RSVP, current-pin block. _(Req 3.3, 4.1–4.3)_
  - [x] 4.4 "Nothing public until Publish" enforced (publish is a separate explicit step). _(Req 3.4)_

- [x] 5. Post (create + lifecycle)
  - [x] 5.1 `POST /api/postings`: location + `expires_at` + bounded pin + write. **Property tests pass** (expiry; pin within bound). _(Req 4.1–4.5, 4.7)_ — needs Supabase to write a real row live.
  - [x] 5.2 Event-date takedown (min(expiry, event end)) — in `effectiveTakedown`, property-tested. _(Req 4.4)_
  - [x] 5.3 Delete-anytime via soft delete (schema + query filter). _(Req 4.6)_
  - [x] 5.4 Expiry sweep (Vercel cron, secret-protected) — route + `vercel.json`. _(Req 5.3)_

- [x] 6. Map browse
  - [x] 6.1 MapLibre map, free tiles, darker-tan local style. _(Req 5.1, 5.5)_
  - [x] 6.2 Dark-red pins for active postings; click → posting page. _(Req 5.2–5.4)_
  - [x] 6.3 Home `/` public: map + rails, Scan (dark red) + Set an alert (navy), no account wall (verified live). _(Req 1.1, 7.1–7.3)_

- [x] 7. Posting page `/p/[id]`
  - [x] 7.1 Flyer details, category, date, place, navy `@handle`, public Like count (verified live). _(Req 6.1, 6.2)_
  - [x] 7.2 Signed-in: Like (postings only), Going/Interested. Visitor: "Sign in to take part" (verified live). _(Req 6.3–6.5)_
  - [x] 7.3 Minimal `/u/[username]` poster-profile link target (verified live). _(Req 6.2)_
  - [x] 7.4 Promotion label slot (hidden in Stage 1; field exists). _(Req 6.6)_

- [x] 8. Agent hook in the build
  - [x] 8.1 `typecheck-on-save` hook used; logged in KIRO_USAGE_LOG.md. _(Kiro features)_

- [ ] 9. Stage 1 live verification
  - [x] 9.1 Public/no-credential paths verified live (`next start`): browsing, map, posting page, gates, 404, API safety.
  - [ ] 9.1b Credentialed paths (real sign-up/in, Gemini extract, real publish, cron sweep) — pending Max's Supabase/Gemini keys + `schema.sql` (see SETUP.md).
  - [x] 9.2 BUILD_LOG.md and KIRO_USAGE_LOG.md updated. Stop for Max verification before Stage 2.

## Task Dependency Graph

Components are built before screens, and the live verification comes last.

```text
1 Project + infra wiring
├── 2 Design-system components
│   ├── 4 Scan and review          (also needs 3)
│   ├── 6 Map browse               (also needs 5)
│   └── 7 Posting page             (also needs 3 and 5)
├── 3 Accounts (email only)
│   ├── 4 Scan and review
│   ├── 5 Post (create + lifecycle) (also needs 4)
│   └── 7 Posting page
└── 8 Agent hook in the build
9 Stage 1 live verification        (needs 1 through 8)
```

## Notes

### Logged for later stages (not Stage 1)

Alerts (Stage 2), messaging + private DMs (Stage 3), promoted postings (Stage 4), polish + seed real boards + demo video + writeup (Stage 5). Additional property tests, Kiro Powers, MCP, and custom agents are added only when a real job in those stages needs them; otherwise the final writeup states none was used.
