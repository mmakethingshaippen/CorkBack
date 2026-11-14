# Implementation Plan: Password Reset

## Overview

Fix the password-reset flow so recovery links reach the reset form: canonical https origin, server-side code and token_hash exchange, a Site URL fallback on the homepage, and a recovery-only reset page.

## Tasks

Status key: [x] done and verified · [~] built, needs Max's participation to verify · [ ] not started.

- [x] 1. Diagnose: probe where Supabase sends recovery links (allowed, deployment URL, disallowed), reused links, and the deployed bundle's redirect. _(design: Root cause)_
- [x] 2. `src/lib/appUrl.ts` canonical origin + `safeNextPath`. _(Req 1.1, 5.3)_
- [x] 3. `src/lib/authRecovery.ts` recovery-AMR check. _(Req 2.3, 4.3)_
- [x] 4. `/auth/callback` server code exchange. _(Req 2.1, 2.3)_
- [x] 5. `/auth/confirm` server `token_hash` verification. _(Req 2.1)_
- [x] 6. Homepage Site URL fallback (server query redirect + client hash forwarder). _(Req 2.2)_
- [x] 7. Forgot form: canonical `redirectTo`, rate-limit errors. _(Req 1.1–1.3)_
- [x] 8. Reset page: all credential forms, recovery-only gate, form, mismatch, policy, loading, errors, expired/invalid states, success + sign-in. _(Req 3, 4)_
- [x] 9. Sign-in shows link errors forwarded from the auth routes. _(Req 6.1)_
- [x] 10. Typecheck, tests, build; deploy; live route checks with a throwaway account. _(all)_
- [~] 11. Full email-to-password-change test with a real inbox. Passed in Edge on build `eb59272` (real email → its link → form → change → sign in). One more real-email run is needed on the final build `4c1434f` (its only change is forcing https); Supabase rate-limited further emails (HTTP 429). _(Req 2.1)_
- [x] 12. Supabase dashboard + Vercel env: set `NEXT_PUBLIC_APP_URL` to https; confirm Site URL and Redirect URLs; optional token_hash template (needs Max). _(design: Root cause)_

## Notes

- Task 11 needs a real inbox and a person; Supabase rate-limited further recovery emails (HTTP 429), so the run on build `4c1434f` waits for the limit to clear.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1"] },
    { "id": 1, "tasks": ["2", "3"] },
    { "id": 2, "tasks": ["4", "5", "6", "7"] },
    { "id": 3, "tasks": ["8", "9"] },
    { "id": 4, "tasks": ["10", "12"] },
    { "id": 5, "tasks": ["11"] }
  ]
}
```n
