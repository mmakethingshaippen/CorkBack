# Reporting, Moderation and Live Fixes — Requirements

Add posting reports and a small protected admin moderation dashboard, and fix three issues reproduced on https://corkback.vercel.app on 2026-11-10, plus a fourth found while reproducing them. Theme, colors, Kalam typography, the account model, the password-reset flow, existing accounts, postings, threads and messages are preserved. This is not a general account-management system.

EARS phrasing. "Visible" means not author-deleted and not hidden by moderation. "Active" means visible and not ended (social design §3). Roles: **admin**, **author** (owns the posting), **reporter**, **unrelated user**, **signed-out visitor**.

## 1. Reporting
1. THE SYSTEM SHALL show a "Report posting" control on posting pages to signed-in users who are not the author; signed-out visitors SHALL see a sign-in prompt instead.
2. THE report form SHALL offer exactly: Spam or scam, Inappropriate content, Misleading information, Personal information, Duplicate, Other; with optional details up to 1000 characters.
3. THE form SHALL show submitting, success, already-reported and failure states, keep the entered details on failure, and ignore repeat submits while one is in flight.
4. A reporter SHALL have at most one pending report per posting (database-enforced); a repeat SHALL be answered as "already reported", not as an error and not as a second report.
5. THE SYSTEM SHALL enforce rate limits in the database: at most 5 reports per reporter in 10 minutes and 20 in 24 hours.
6. Reports SHALL be insertable only through the reporting function (no direct table writes), only for visible postings, never for one's own posting.
7. Reporter identities and report details SHALL be readable only by admins. Authors and other users SHALL NOT learn who reported a posting or what they wrote. A reporter MAY see that they reported a posting (reason, status, date).
8. THE SYSTEM SHALL NEVER hide a posting automatically, including based on report count.

## 2. Admin moderation
1. `/admin` SHALL be available only to admins; everyone else (including signed-out visitors) SHALL get the standard not-found page. Authorization SHALL be enforced on the server and in the database (RLS, privileges, function checks); hiding the link is not a control.
2. THE dashboard SHALL list pending and resolved reports, newest first, filterable by status and reason, with posting context (title, author username, state: active/ended/hidden/deleted by author, body and dates on demand) and report details (reason, details, reporter username, date).
3. Admins SHALL be able to dismiss a report (optional note), hide a posting (required reason), and restore a hidden posting (required reason).
4. Every moderation action SHALL be recorded in an append-only audit log with the action, posting, report (if any), administrator, timestamp and reason. `anon`, `authenticated` and `service_role` SHALL have no privileges on it; the owner's UPDATE, DELETE and TRUNCATE SHALL be refused by triggers. The owner can still bypass this only by deliberate DDL (disable/drop trigger, drop table), and Supabase's superuser can always; that is the documented maintenance path. Verification SHALL NOT disable this protection; test entries are kept, clearly labelled.
5. Moderation state SHALL be separate from author deletion and from expiry/event end. Restoring SHALL NOT restore an author-deleted posting and SHALL NOT make an ended posting active.
6. Hidden postings SHALL be excluded consistently from the home map and rail, the world map, Following, Friends activity, profiles (including the author's own list), alerts emails, likes/plans/replies writes and new message threads, and from public direct links.
7. A direct link to a hidden or deleted posting SHALL show a neutral "This posting isn't available" notice that does not reveal whether it was moderated. The author SHALL see that their posting was hidden by moderators and the moderator's stated reason, and SHALL still be able to delete it.
8. Moderation access SHALL NOT grant access to private message contents. Existing conversations stay readable only by their participants.
9. Users SHALL NEVER be able to make themselves (or anyone) admins, and no API key (including the server's service key) SHALL be able to write the admin list. Admin access is granted only by the project owner in the SQL editor: `stage8_admin_grant.sql` for real admins, and `stage8_test_admin.sql` for the one approved disposable verification account (refuses anything else; revoke afterwards is required).

## 3. Live fixes
### 3.1 Public replies (reproduced: "Be the first to reply" with no composer for any signed-in account)
1. Signed-in users SHALL be able to post a public reply on an active posting: 1–1000 characters, not whitespace-only, with submitting/success/failure states, draft kept on failure, and no duplicates from double submits or retries.
2. Replies SHALL be listed oldest first with the author's @username and time, on active and ended postings; not on deleted or hidden postings. Signed-out visitors SHALL read replies and see a sign-in prompt to reply.
3. New replies SHALL be rejected on ended, deleted or hidden postings and beyond 10 replies per user in 10 minutes (database-enforced).
4. A reply's author SHALL be able to delete it after confirming. Replies SHALL NOT be editable. Replies SHALL NOT have likes (locked).

### 3.2 Owner edit and delete (reproduced: no Edit/Delete on the posting page or profile)
1. The author SHALL see Edit and Delete on their posting page and on each of their postings on their own profile; nobody else SHALL.
2. Edit SHALL allow title, details, category, RSVP link, event date/time and end date/time, and place label, with the same validation as publishing (e.g. no past dates). The pin location, expiry, flyer and author SHALL NOT be editable. Only active, visible postings are editable.
3. Delete SHALL require confirmation, soft-delete the posting (author deletion), and remove it everywhere. It SHALL work for active, ended and hidden postings.
4. These rules SHALL be enforced in the database (column privileges, policies, function checks), not only in the UI.
5. **(found while reproducing)** Clients SHALL NOT choose or change protected posting fields through the database API: id, ownership, pin after publishing, created_at, expiry beyond the chosen preset, deletion, moderation state, flyer, and (after phase B) promotion outside `set_posting_promoted`. On publish, created_at and expires_at SHALL be set by the database from the preset. Expiry SHALL be bounded by the longest preset.
6. Promotion SHALL stay behind its authorized operation (author only, visible posting, promote only while active). The deployed toggle keeps working until the new code ships (two-phase release, design §11).

### 3.3 Like accessible name (reproduced: selected Like still reads "Like this posting")
1. WHEN the viewer has liked a posting, THE Like control's accessible name SHALL be "Unlike this posting. N likes" with `aria-pressed="true"` (approved); unselected stays "Like this posting. N likes" with `aria-pressed="false"`. The visible "Liked · N" is unchanged.

### 3.4 Like/Unlike on posting cards (home, Following, profiles)
1. Posting cards SHALL replace the decorative heart and count with an accessible Like toggle, using the shared `PostingCard` component.
2. Cards SHALL show the viewer's saved like state and the public total, read on the server for each page load.
3. The toggle SHALL reuse the authenticated, idempotent `PUT /api/postings/[id]/like` route: immediate update, extra clicks ignored while saving, rollback with a visible error when saving fails.
4. Pressing the toggle SHALL NOT open the posting. The title and author links SHALL keep working, and no button SHALL be nested inside a link.
5. Liked: a filled heart, `aria-label` "Unlike this posting. N likes", `aria-pressed="true"`. Not liked: an outline heart, "Like this posting. N likes", `aria-pressed="false"`. Touch targets at least 44 × 44 px.
6. Signed-out visitors SHALL see the total and a "Sign in to like" link.
7. Cards follow the existing reaction restrictions. Lists show only active, visible postings, and a posting that ends or becomes unavailable while open is refused by the server, so the card rolls back, explains, and closes the control. Moderation-hidden postings are excluded from lists by the phase A visibility rule.
8. Card and detail page SHALL agree after navigation (including back/forward) and after refresh.

## 4. Cross-cutting
1. Keep the CorkBack design tokens; one dark-red main action per screen; usable at 390 px and 1280 px; all controls reachable and operable by keyboard with visible focus; dialogs/confirm steps manage focus.
2. Database changes SHALL be additive, safe for the currently deployed code, and come with a read-only preflight, verification scripts and a rollback that never widens access.
3. No credentials, tokens, emails or passwords in commits, logs or reports.
4. Verification SHALL use disposable accounts and `[TEST]` content only, and report exactly what remains afterwards.
