# Core Loop — Requirements

The core loop is Stage 1 of CorkBack: **accounts, scan and review, post, map browse, and posting page.** Social features (Follow, Connect, Friends, messaging), alerts, and promoted postings are later stages — but the data model for them is set on day one (see design.md).

Requirements use EARS phrasing ("WHEN … THE SYSTEM SHALL …"). Each requirement maps to an acceptance check that must be verified live before Stage 1 is signed off.

---

## 1. Public browsing (no account wall)

**User story:** As a visitor with no account, I want to browse the map and open postings, so that I can see what is happening locally without signing up.

### Acceptance criteria
1. WHEN a visitor with no account opens the app, THE SYSTEM SHALL show the public map and nearby postings without prompting for login.
2. WHEN a visitor opens any posting, THE SYSTEM SHALL show the full posting page (flyer, title, category, date, place, poster handle, public Like count) without requiring an account.
3. WHEN a visitor attempts to post, reply, Like, set a plan, or set an alert, THE SYSTEM SHALL prompt for sign-in and SHALL NOT perform the action until signed in.

## 2. Accounts (email only)

**User story:** As a new user, I want to sign up with email and a public username, so that I can post and interact while keeping my real name and email private.

### Acceptance criteria
1. WHEN a user signs up, THE SYSTEM SHALL require email and a username and SHALL NOT collect a full name.
2. THE SYSTEM SHALL keep email private and SHALL never display it publicly.
3. THE SYSTEM SHALL treat the username as the only public name.
4. WHEN a username is submitted, THE SYSTEM SHALL accept it only if it is 3–20 characters, contains only letters, numbers, and underscores, has no spaces, and is unique; otherwise THE SYSTEM SHALL reject it with a specific reason.
5. THE SYSTEM SHALL offer email login only. Social login SHALL NOT appear in Stage 1.
6. THE SYSTEM SHALL NOT provide a demo-login frame, a Board-view frame, or a Board/Map toggle.

## 3. Scan and review (flyer → structured posting)

**User story:** As a signed-in user, I want to photograph a paper flyer and have it become a structured posting I can review and edit before publishing, so that posting is fast but accurate.

### Acceptance criteria
1. WHEN a signed-in user starts a scan, THE SYSTEM SHALL let them capture a photo or choose an existing photo.
2. WHEN a flyer photo is submitted, THE SYSTEM SHALL extract structured fields (title, event date, time, event place, suggested category, optional RSVP link) server-side via Gemini.
3. THE SYSTEM SHALL present a human review step showing every extracted field as editable before anything is published.
4. THE SYSTEM SHALL NOT publish or make anything public until the user explicitly selects Publish.
5. WHEN the user requests location before publishing, THE SYSTEM SHALL request the poster's current location and pin the posting there (see location rules), not at the venue read from the flyer.
6. THE SYSTEM SHALL never send the Gemini API key to the client.

## 4. Post (create a posting)

**User story:** As a signed-in user, I want to publish a reviewed flyer as a posting with a category, expiry, and optional RSVP link, so that it appears on the public map.

### Acceptance criteria
1. THE SYSTEM SHALL require every posting to have exactly one category.
2. THE SYSTEM SHALL allow at most one external RSVP link per posting, added only if the poster chooses.
3. WHEN the poster picks an expiry, THE SYSTEM SHALL offer presets of 24 hours, 3 days, 1 week, 2 weeks, and 1 month.
4. WHEN a posting is an event and its event date passes, THE SYSTEM SHALL take the posting down even if the expiry preset has not elapsed.
5. THE SYSTEM SHALL pin the posting at the poster's actual location with only a short nudge allowed to the exact board/venue, and the pin SHALL stay near the real location.
6. WHEN the poster chooses to delete a posting, THE SYSTEM SHALL remove it at any time.
7. THE SYSTEM SHALL NOT reveal the poster's exact location publicly.

## 5. Map browse

**User story:** As any user, I want an interactive local map with posting pins, so that I can explore what is posted around me.

### Acceptance criteria
1. THE SYSTEM SHALL render a real interactive map (MapLibre, free tiles), not static Figma fragments.
2. THE SYSTEM SHALL show dark-red pins for postings at their pinned locations.
3. THE SYSTEM SHALL show only non-expired postings on the map.
4. WHEN a user selects a pin, THE SYSTEM SHALL let them open that posting page.
5. THE SYSTEM SHALL style local maps with a darker-tan background so white roads and red pins stand out.

## 6. Posting page

**User story:** As any user, I want a full posting page, so that I can read the flyer details and (if signed in) act on it.

### Acceptance criteria
1. THE SYSTEM SHALL show the flyer thumbnail, title, category, date, place, poster handle, and public Like count.
2. THE SYSTEM SHALL show the poster as an `@handle` that links to their profile (deep-navy link role).
3. WHEN a signed-in user Likes a posting, THE SYSTEM SHALL record the Like and update the count; Like applies to postings only (never comments/replies).
4. WHEN a signed-in user sets a plan, THE SYSTEM SHALL record Going or Interested.
5. WHEN a visitor with no account views the page, THE SYSTEM SHALL show a "Sign in to take part" affordance instead of active controls.
6. THE SYSTEM SHALL label promotion only on a posting's own listing (no promotion in Stage 1; the field exists in the model).

## 7. Design fidelity (locked choices)

### Acceptance criteria
1. THE SYSTEM SHALL use only Paper, Card white, Board, Ink, Dark red, and the limited-role Deep navy (design-tokens.md).
2. THE SYSTEM SHALL use exactly one dark-red main action per screen.
3. THE SYSTEM SHALL render all product text in Kalam (Regular/Bold).
4. THE SYSTEM SHALL show cork only on header bands and empty states (Choice A), generated procedurally in CSS — no image asset.
5. THE SYSTEM SHALL tilt cards unevenly between 2° and 8° in varied directions, with no mirrored pair and no uniform rule (Choice B).
6. THE SYSTEM SHALL recreate the wordmark as text (Kalam Bold, "Back" dark red, navy label, white wordmark text) — no vector wordmark file.
7. THE SYSTEM SHALL build categories as text chips in code (white chip, navy border, selected = dark red).

## 8. Data model on day one

### Acceptance criteria
1. THE SYSTEM SHALL define, on day one, entities and relations for: users, postings, categories, location, Follow, Connect, Like, Going, Interested, and hidden postings — even though social features ship in later stages (see design.md schema).

---

## Out of scope for Stage 1 (later stages, gated by live verification)
- Alerts (Stage 2), messaging (Stage 3), promoted postings (Stage 4), polish + seed + demo (Stage 5).
- Social UI surfaces (Following view, Friends attendance, profiles beyond a basic poster profile link target) are built when their stage arrives; only the schema lands now.
