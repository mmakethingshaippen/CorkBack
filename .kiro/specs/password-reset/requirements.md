# Password Reset — Requirements

Fix the production bug where a Supabase recovery link opens the CorkBack homepage instead of a new-password form. Theme, colors, fonts, account model, and existing accounts/data are unchanged.

Requirements use EARS phrasing.

## 1. Request a reset email
1. WHEN a visitor submits their email on `/forgot-password`, THE SYSTEM SHALL call `supabase.auth.resetPasswordForEmail` with an explicit `redirectTo` on the canonical production origin (`https://corkback.vercel.app`), never the current browser origin.
2. THE SYSTEM SHALL show "Check your email" after submitting and SHALL NOT return the user to sign-in.
3. WHEN Supabase rejects the request (for example, rate limited), THE SYSTEM SHALL show the reason.

## 2. Land on the new-password form
1. WHEN a user opens a valid recovery link, THE SYSTEM SHALL show the new-password form, whichever of these the link delivers: a PKCE `code`, a `token_hash`, or implicit `#access_token` tokens.
2. WHEN recovery credentials arrive on the homepage (the Supabase Site URL fallback), THE SYSTEM SHALL forward them to the recovery flow instead of showing the homepage.
3. THE SYSTEM SHALL NOT send a recovery session to the homepage after exchanging credentials.

## 3. Set a new password
1. THE SYSTEM SHALL show New password and Confirm password fields, password guidance, a loading state, and useful errors.
2. WHEN the two passwords differ, THE SYSTEM SHALL show an error and SHALL NOT submit.
3. THE SYSTEM SHALL submit through `supabase.auth.updateUser({ password })`.
4. WHEN the update succeeds, THE SYSTEM SHALL show a confirmation and a clear route back to sign-in.

## 4. Bad links
1. WHEN a link is expired, invalid, or already used, THE SYSTEM SHALL explain that plainly and offer a way to request another email.
2. WHEN the recovery page is refreshed during a valid recovery session, THE SYSTEM SHALL still show the form; with no recovery session, it SHALL show the bad-link state.
3. WHEN a normally signed-in user (not recovering) opens the page, THE SYSTEM SHALL NOT offer the reset form.

## 5. Security
1. THE SYSTEM SHALL NOT log recovery tokens, codes, or passwords.
2. THE SYSTEM SHALL use only the public Supabase client and anon key for the flow; the service-role key SHALL NOT be used or exposed.
3. Redirect targets taken from the URL SHALL be limited to same-site relative paths.

## 6. Unchanged behaviour
1. Ordinary email sign-in SHALL keep working.
