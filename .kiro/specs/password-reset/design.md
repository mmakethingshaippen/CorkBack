# Password Reset — Design

## Root cause (confirmed by probe on 2026-11-03)

Supabase validates `redirect_to` when the link is clicked. If the URL is not on the allow-list, Supabase silently sends the user to the **Site URL**, which is `https://corkback.vercel.app/` (the homepage). Probes showed:

| Requested redirect | Where Supabase sent the user |
|---|---|
| `https://corkback.vercel.app/auth/reset-password` | the reset page (honored) |
| `https://cork-back-…-max-082a.vercel.app/auth/reset-password` (a Vercel deployment URL) | `https://corkback.vercel.app/` (homepage) |
| `https://example.org/not-allowed` | `https://corkback.vercel.app/` (homepage) |

Repo-side causes:
1. `ForgotPasswordForm` built `redirectTo` from `process.env.NEXT_PUBLIC_APP_URL || window.location.origin`. The deployed client bundle does **not** contain the app URL, so it used the browser origin. A reset requested from any non-canonical address fell back to the homepage.
2. The homepage had no handler for recovery credentials (`?code`, `?token_hash`, `#access_token`, `#error_code`), so any fallback dead-ended there.
3. The reset page exchanged the PKCE code only in the browser and could not read implicit hash tokens or link errors (the `@supabase/ssr` browser client is PKCE-only and ignores the hash).

A Supabase email template that links to `{{ .SiteURL }}` rather than the verification URL would cause the same symptom. It cannot be read from the repo, so it is covered by dashboard instructions and by the homepage fallback.

## Flow

```
/forgot-password ──resetPasswordForEmail(redirectTo=https://corkback.vercel.app/auth/reset-password)──▶ email
email link (default template) ─▶ Supabase /verify ─▶ /auth/reset-password?code=…  ─▶ forwards to /auth/callback
email link (recommended template) ─▶ /auth/confirm?token_hash=…&type=recovery ─▶ verifyOtp ─▶ /auth/reset-password
Site URL fallback ─▶ /?code=… | /?token_hash=… | /#access_token=… ─▶ forwarded into the same routes
/auth/callback  (server)  exchangeCodeForSession(code) ─▶ recovery session ─▶ /auth/reset-password
/auth/confirm   (server)  verifyOtp({ type, token_hash }) ─▶ /auth/reset-password
/auth/reset-password (client) ─▶ require a session whose AMR includes "recovery" ─▶ form ─▶ updateUser({ password }) ─▶ signOut ─▶ "Password updated" + Sign in
```

## Components
- `src/lib/appUrl.ts`: canonical origin helper. Uses `NEXT_PUBLIC_APP_URL` when present; uses the browser origin only on localhost; otherwise `https://corkback.vercel.app`. Also provides `safeNextPath()` against open redirects.
- `src/lib/authRecovery.ts`: reads the session JWT `amr` claim to tell a recovery session from a normal sign-in. Decodes locally; never logged.
- `src/app/auth/callback/route.ts`: server PKCE code exchange (reads the verifier cookie set by the browser client), then redirects by `next` or by AMR.
- `src/app/auth/confirm/route.ts`: server `verifyOtp` for `token_hash` links. Works on any device or browser because it needs no stored code verifier.
- `src/app/page.tsx` + `src/components/auth/AuthHashForwarder.tsx`: the Site URL fallback. The server redirects `?code` and `?token_hash`; a client component forwards hash tokens and errors.
- `src/app/auth/reset-password/ResetPasswordForm.tsx`: phases `checking → ready → saving → saved`, or `expired` / `invalid` / `signed-in-not-recovering`.

## Password policy
Supabase does not expose its minimum length on the public settings endpoint (default 6). The form requires at least 8 characters (stricter than the server is safe) and shows server errors such as a weak or reused password.

## Logging
No `console.*` calls in any of these files. Error text shown to users comes from Supabase messages, which contain no tokens.
