# Social Features and Live Fixes — Requirements

Complete Likes, Going/Interested, Following, Friends, and messaging feedback, and fix the issues reproduced on https://corkback.vercel.app on 2026-11-08. Theme, colors, Kalam typography, account model, the password-reset flow, existing accounts, postings, and the existing message thread are preserved.

EARS phrasing. "Active" means: not deleted, `expires_at` in the future, and (if it has an event date) the event day has not ended (see design §3).

## Stage 1 — Likes, plans, posting lifecycle

### 1.1 Likes
1. WHEN a signed-in user likes an active posting, THE SYSTEM SHALL store exactly one like for that user and posting, and the like SHALL persist across refresh, sign-out, and sign-in.
2. WHEN the user unlikes, THE SYSTEM SHALL remove their like.
3. THE SYSTEM SHALL show the true like count and whether the viewer has liked it, read from the server on every page load.
4. Like SHALL remain postings-only (no likes on replies or messages).

### 1.2 Plans (Going / Interested)
1. A signed-in user SHALL have at most one plan per posting: Going, Interested, or none.
2. THE SYSTEM SHALL support choosing, switching, and clearing a plan, persisting across refresh and sessions.
3. THE SYSTEM SHALL show the viewer's selected plan and public aggregate counts (number Going, number Interested).

### 1.3 Mutation behaviour
1. WHILE a reaction request is in flight, THE SYSTEM SHALL ignore further clicks on that control (no duplicate writes).
2. THE SYSTEM SHALL update the control optimistically, show a pending state, and on failure SHALL roll back and show an error.
3. Server operations SHALL be idempotent (they set a desired state, not toggle), so retries cannot double-count.
4. Signed-out users and other users SHALL NOT be able to create, change, or delete someone else's like or plan (enforced in the database, not only the UI).

### 1.4 Accessibility
1. The Like control SHALL have a descriptive accessible name (e.g. "Like this posting, 3 likes") and expose its selected state.
2. Plan controls SHALL expose their selected state and a descriptive name.

### 1.5 Posting lifecycle
1. THE SYSTEM SHALL apply one expiry rule everywhere: map, home rail, profiles, Following feed, Friends activity, direct posting URLs, and the reaction APIs.
2. WHEN a direct URL opens an inactive (ended) posting, THE SYSTEM SHALL show it read-only with a clear "This posting has ended" notice, keep its details and its final like and plan counts visible, and SHALL NOT offer Like, Going, or Interested.
3. THE SYSTEM SHALL reject like/plan writes on inactive or deleted postings server-side.
4. WHEN a posting is published with an event date that has already passed, THE SYSTEM SHALL reject it with a clear message (see design §3 for the year-less flyer decision).

### 1.6 Navigation
1. The Scan page back link SHALL read "Back to map".

## Stage 2 — Following
1. A signed-in user SHALL be able to Follow and Unfollow other users from their profile and from a posting's author section.
2. THE SYSTEM SHALL prevent self-follows and duplicate follows (database-enforced).
3. The Following page SHALL list active postings from followed users, newest first.
4. The Following page SHALL show loading, error, signed-out, empty (no follows), and empty (follows but no active postings) states.
5. Following SHALL NOT create, change, or remove a friendship, and vice versa.

## Stage 3 — Friends
1. A signed-in user SHALL be able to search other users by public username.
2. THE SYSTEM SHALL support send, cancel (requester), accept and decline (recipient only), and remove (either friend).
3. The Friends page SHALL show incoming requests, outgoing requests, and accepted friends.
4. THE SYSTEM SHALL prevent self-requests, duplicates, and conflicting reciprocal requests (database-enforced).
5. Only the recipient SHALL be able to accept or decline a request (database-enforced).
6. THE SYSTEM SHALL show friends' Going/Interested on active postings per the privacy policy in design §5, and SHALL NEVER expose emails, private locations, or messages.

## Stage 4 — Messaging
1. Existing message storage and the existing thread SHALL be preserved.
2. WHEN a message is sent from a posting, THE SYSTEM SHALL confirm success, clear the composer, and navigate to the saved conversation.
3. WHEN sending fails, THE SYSTEM SHALL keep the draft and show a useful error.
4. Rapid repeat sends SHALL NOT create duplicate messages.
5. Both participants SHALL see the thread in their inbox, read it in chronological order, and reply in both directions, persisting across refresh and sessions.
6. Non-participants and signed-out users SHALL NOT read or post to a thread (database/server-enforced).
7. Real-time updates SHALL NOT be claimed unless tested between separate sessions.

## Cross-cutting
1. Keep CorkBack colors, Kalam typography, and visual style; work on desktop and mobile widths.
2. No credentials, tokens, emails, or passwords in commits or logs.
3. Database changes SHALL be additive, idempotent migrations that are safe for the currently deployed code.
