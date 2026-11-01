# CorkBack — Setup

The app runs in two modes:

- **No credentials (default):** public browsing, the map, posting pages, and all UI render from seed data (`src/lib/seed.ts`). Sign-up / sign-in / scan / publish report "not configured" gracefully. This is how the Stage 1 build was verified live.
- **With credentials:** full accounts, flyer extraction, posting, and the expiry cron.

## 1. Environment

Copy `.env.example` to `.env.local` and fill in:

| Var | Where it is used |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser + server Supabase client (RLS-guarded) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only — the expiry cron sweep |
| `GEMINI_API_KEY` | Server only — flyer extraction (`/api/scan/extract`) |
| `RESEND_API_KEY` | Server only — radius email alerts (Stage 2) |
| `CRON_SECRET` | Protects `/api/cron/expire`; set the same value as the Vercel cron Authorization header |

Secrets never reach the client: only the `NEXT_PUBLIC_*` values are exposed to the browser.

## 2. Database

In the Supabase SQL editor, run `supabase/schema.sql`. It creates every day-one
table (profiles, categories, postings, likes, plans, follows, connections,
hidden_postings, replies, alerts), seeds the categories, and enables the RLS
policies (public read for browsing, owner-scoped writes).

## 3. Run

```
npm install
npm run dev     # http://localhost:3000
```

## 4. Verify

```
npm run typecheck   # types
npm test            # property-based tests (username, expiry, pin nudge, card tilt)
npm run build       # production build + lint
```

## 5. Deploy (Vercel)

Import the repo, add the same env vars in the Vercel project settings. `vercel.json`
registers the hourly expiry cron at `/api/cron/expire`.
