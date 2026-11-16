# Requirements Document

## Introduction

Five usability improvements to the CorkBack board, derived from the approved design and delivered as five stages that can each be built, verified and released on their own:

1. **Stage 1 (Requirement 1):** a compact category filter so the map is visible sooner on a 390 px phone.
2. **Stage 2 (Requirements 2 to 6):** nearby results with a radius, approximate distances, and bounded loading of the doorstep list.
3. **Stage 3 (Requirements 7 to 12):** category-specific posting fields, consistent expiry, protection of existing postings, and the alert job.
4. **Stage 4 (Requirements 13 to 16):** a category filter that applies to both maps and a bounded, server-capped world map.
5. **Stage 5 (Requirements 17 to 19):** automatic refresh of open message threads and an unread indicator that depends on a drafted SQL stage.

Requirement 20 applies to every stage (privacy, test data, scope and design tokens).

## Glossary

- **Board**: The home screen that shows the local map, the "On your doorstep" card list and the world map.
- **Category_Filter**: The compact control that selects one category or all categories for the Board.
- **Category_Panel**: The popover opened by the Category_Filter trigger.
- **Reference_Point**: The point from which nearby distance is measured. Its kind is one of town, device, home, saved or default.
- **Radius**: The nearby cut-off in miles. The options are 1, 3, 5, 10 and 25 miles. The default is 10 miles.
- **Nearby_Set**: The postings that match the selected category and lie within the Radius of the Reference_Point, computed by one function that feeds the pins, the cards and the heading.
- **Distance_Label**: The rounded, display-safe text on a card, such as "About 2.5 mi away".
- **Snapped_Bounds**: A bounding box whose edges are expanded outward to the next multiple of 0.1 degrees.
- **Map_Query**: The server-side read behind `GET /api/postings/map`, limited by Snapped_Bounds, an optional category and a server-fixed cap.
- **Pin_Cap**: The server-fixed limit of 300 results for a Map_Query in pins mode.
- **Card_Cap**: The server-fixed limit of 100 results for a Map_Query in cards mode.
- **Truncated_State**: The condition in which more postings matched than the cap allowed.
- **World_Map**: The "Explore the world" map on the Board.
- **Local_Map**: The map in the Board that shows the Nearby_Set.
- **Posting_Kind**: One of event, listing or event-optional, derived from the category slug.
- **Listing_Category**: One of Jobs, Housing and Real Estate, Sales, or Lost and Found.
- **Community_Category**: The Community category, whose Posting_Kind is event-optional.
- **Deadline**: The optional date a listing stays relevant until, stored in `end_date`.
- **Takedown_Time**: The time a posting leaves the Board, computed by the existing lifecycle rule as the earlier of `expires_at` and the event or deadline end in the posting's stored time zone.
- **Posting_Validator**: The publish and edit validation functions in `postingInput.ts`.
- **Posting_Form**: The review form used to publish and the edit form used to change a posting.
- **Alert_Job**: The cron route that matches active postings to saved alerts and sends alert emails.
- **Alert_Email**: The email built by `buildAlertEmail`.
- **Thread_View**: The open message thread screen.
- **Poller**: The pure module that schedules message refresh requests.
- **Unread_Service**: The unread count endpoint, the mark-read endpoint and the client hook that polls them.
- **Message_Reads_SQL**: The drafted `stage11_message_reads` files (migration, preflight, verify and rollback).
- **Geo_Index_SQL**: The optional drafted `stage12_postings_geo_index` files.
- **Fixture_Data**: Demo postings and stress sets that exist only in test code and the browser test harness.
- **Owner**: The project owner, who reviews and applies SQL and approves production deployment.

## Requirements

### Requirement 1: Compact category filter

**User Story:** As a visitor on a phone, I want a compact category filter, so that I can see the map without scrolling past ten category chips.

#### Acceptance Criteria

1. THE Category_Filter SHALL render exactly one trigger button that reads "Category: All" while "All categories" is selected and "Category: {category label}" while a single category is selected.
2. WHEN the viewer activates the trigger by click, tap, Enter or Space, THE Category_Filter SHALL open the Category_Panel as an overlay on the map, without changing the page layout height, that lists "All categories" first followed by every category in the defined order, with each category appearing exactly once.
3. WHEN the viewer presses Escape, clicks outside the Category_Panel, or selects a row, THE Category_Filter SHALL close the Category_Panel and return keyboard focus to the trigger.
4. WHILE the viewer is signed in, THE Category_Panel SHALL show a follow control on each category row, and THE Category_Filter SHALL show the follow control for the selected category next to the trigger.
5. WHILE the viewer is not signed in, THE Category_Filter SHALL show no follow control in the Category_Panel or next to the trigger.
6. WHEN the viewer selects a category, THE Board SHALL show only postings of that category on the Local_Map and in the card list, and WHEN the viewer selects "All categories", THE Board SHALL show postings of every category.
7. WHEN the viewer selects a category that has no postings, THE Board SHALL show an empty state with zero pins and zero cards, and THE Category_Filter SHALL keep that category selected.
8. WHEN the Board renders at a 390 by 844 pixel viewport, THE Board SHALL place the top edge of the Local_Map at or above 55 percent of the viewport height (at or above 464 px from the top of the viewport) and SHALL show at least 240 px of the Local_Map above the bottom navigation without scrolling.
9. WHEN the Board renders at 390 by 844 pixels and at 1280 by 800 pixels, THE Board SHALL show no horizontal scroll and SHALL keep every control reachable with a tap target of at least 44 px by 44 px.

### Requirement 2: Radius and reference point

**User Story:** As a visitor, I want to choose how far from a place I see postings, so that "On your doorstep" matches where I care about.

#### Acceptance Criteria

1. THE Board SHALL offer exactly five Radius options of 1, 3, 5, 10 and 25 miles, SHALL show the selected option as active, and SHALL select 10 miles as the Radius when no valid stored Radius exists.
2. IF a stored or supplied Radius value is not exactly one of 1, 3, 5, 10 or 25 (including empty, non-numeric, zero, negative, fractional or out-of-list values), THEN THE Board SHALL use 10 miles as the Radius, SHALL NOT show an error to the viewer, and SHALL leave the invalid stored value unused.
3. WHEN the viewer picks a place from a search result, THE Board SHALL set the Reference_Point to that place with kind town and the searched place name, and SHALL use that place as the centre for the Nearby_Set, distances, radius ring, heading and empty state regardless of the device location or the map position.
4. WHEN the viewer pans or zooms the Local_Map, THE Board SHALL keep the Reference_Point unchanged, and SHALL keep the Nearby_Set, distances, radius ring and heading unchanged.
5. WHEN the Board chooses a Reference_Point, THE Board SHALL use the first available of: the most recent explicit action in the current visit (a place search or "Use my location"), the saved centre, the signed-in alert home point, then Berkeley as the default.
6. WHEN the viewer changes the Radius, THE Board SHALL update the Nearby_Set, pins, cards, radius ring and heading to the new Radius, SHALL save the choice in the browser, and SHALL restore it on the next visit.
7. IF the browser cannot save or read the stored Radius, THEN THE Board SHALL keep using the Radius chosen in the current visit (or 10 miles if none was chosen) and SHALL continue to work without an error screen.
8. IF "Use my location" is denied, unavailable or fails to return a position within 10 seconds, THEN THE Board SHALL keep the current Reference_Point unchanged and SHALL show a message that the location could not be used.

### Requirement 3: Nearby set

**User Story:** As a visitor, I want the pins, the cards and the heading to describe the same postings, so that the Board never contradicts itself.

#### Acceptance Criteria

1. THE Board SHALL compute the Nearby_Set as exactly the postings that match the selected category (or every category when "All categories" is selected) and have a true distance from the Reference_Point of at most the Radius, where true distance is the unrounded great-circle distance in miles between the Reference_Point and the posting's stored pin, and a posting at exactly the Radius is included.
2. WHEN the Radius increases, THE Board SHALL include every posting that the smaller Radius included.
3. THE Board SHALL order the Nearby_Set with promoted postings first, then by ascending unrounded true distance, then by ascending posting id, and SHALL produce the same order for the same inputs on every computation.
4. THE Board SHALL draw the Local_Map pins, the card list and the heading count from the one Nearby_Set, so that the number of pins, the number of cards and the heading count are equal.
5. IF no posting matches the selected category within the Radius, THEN THE Board SHALL compute an empty Nearby_Set and SHALL show zero pins, zero cards and a heading count of 0.
6. WHEN the Reference_Point, the Radius, the selected category or the loaded postings change, THE Board SHALL recompute the Nearby_Set and update the pins, the cards and the heading count together in the same render.

### Requirement 4: Approximate distance on cards

**User Story:** As a visitor, I want each posting to show roughly how far away it is, so that I can judge whether it is worth the trip.

#### Acceptance Criteria

1. THE Board SHALL show exactly one Distance_Label on every card in the Nearby_Set, in the form "About {n} mi away", where {n} is the rounded distance in miles.
2. WHEN a posting's true distance from the Reference_Point is 0.5 mile or more and under 10 miles, THE Board SHALL round it to the nearest 0.5 mile, rounding an exact midpoint up (for example 2.25 becomes 2.5 and 9.75 becomes 10). THE Board SHALL write a whole-number result without a decimal ("About 3 mi away") and a half-mile result with one decimal ("About 2.5 mi away").
3. WHEN a posting's true distance is 10 miles or more, THE Board SHALL round it to the nearest whole mile, rounding an exact midpoint up, and SHALL write the result without a decimal (for example "About 12 mi away").
4. WHEN a posting's true distance is under 0.5 mile, THE Board SHALL show "Under 0.5 mi away" in place of the "About {n} mi away" form.
5. THE Board SHALL show a Distance_Label whose rounded value is no larger than the selected Radius for every posting in the Nearby_Set. This holds because membership uses the true distance (at most the Radius) and every Radius option is a whole number.
6. WHEN the Radius or the Reference_Point changes, THE Board SHALL recompute every Distance_Label from the new Reference_Point, and SHALL show no Distance_Label measured from the previous one.
7. THE Board SHALL build every Distance_Label and every heading from words and rounded mile values only. The text SHALL contain no latitude or longitude value of the Reference_Point or of any posting, and no distance finer than the rounding in criteria 2 to 4.
8. WHERE a card is rendered outside the Nearby_Set (for example on a profile or in the Following view), THE card SHALL show no Distance_Label.

### Requirement 5: Heading, radius ring and empty states

**User Story:** As a visitor, I want the Board to say what it is showing, so that I understand why a posting appears or does not.

#### Acceptance Criteria

1. THE Board SHALL show a heading in the form "{n} posting(s) · Within {r} mi of {label}", where {n} is the number of postings in the Nearby_Set, "posting" is used when {n} is 1 and "postings" otherwise, {r} is the selected Radius, and {label} is the Reference_Point label ("your location" for kind device, "your alert home" or the alert town name for kind home, "your saved map area" for kind saved, the searched place name for kind town, and "Berkeley" for kind default), for example "3 postings · Within 10 mi of Berkeley".
2. THE Local_Map SHALL draw a navy dashed ring whose radius equals the selected Radius, centred on the Reference_Point, as a layer separate from the viewer's accuracy area.
3. WHEN the viewer picks a place from a search result or changes the Radius, THE Local_Map SHALL adjust its view so that the whole ring is inside the visible map area.
4. WHEN the Nearby_Set is empty and a larger Radius option exists, THE Board SHALL show the empty state "Nothing within {radius} mi of {place}" with one navy button that offers the next larger Radius option, labelled "Try {next} mi" (1 to 3, 3 to 5, 5 to 10, 10 to 25).
5. WHEN the viewer activates the empty-state button, THE Board SHALL set the Radius to the offered value, save it in the browser, and recompute the heading, the ring and the Nearby_Set for that Radius.
6. IF the Nearby_Set is empty and the Radius is 25 miles, THEN THE Board SHALL show the empty state "Nothing within 25 mi of {place}" with no Radius button.
7. WHEN the Map_Query for the doorstep list reports the Truncated_State, THE Board SHALL show the notice "Showing the first 100 postings. Choose a smaller radius to see them all." in the card list, and WHEN the Map_Query does not report the Truncated_State, THE Board SHALL NOT show that notice.
8. WHILE the Reference_Point has kind device and the viewer has not searched a place or changed the Radius since the last device location, THE Local_Map SHALL keep its current street-level zoom and THE Board SHALL show a navy "Show full radius" button that, when activated, fits the whole ring in the visible map area.

### Requirement 6: Bounded loading of nearby postings

**User Story:** As a visitor, I want the nearby list to load quickly and privately, so that the page does not download every posting.

#### Acceptance Criteria

1. WHEN the Board page first loads, THE Board SHALL load its initial postings through one Map_Query in cards mode, using the Snapped_Bounds around the signed-in alert home point, or around Berkeley when no home point exists, at the default Radius of 10 miles and with no category, and SHALL limit the result to the Card_Cap of 100 postings.
2. WHEN the Reference_Point, the Radius or the selected category changes, THE Board SHALL send one Map_Query in cards mode whose request contains only the Snapped_Bounds, the category (when one is selected) and the mode, and SHALL NOT include the Reference_Point coordinates, the Radius value, a client-supplied limit, or any user identifier.
3. THE Snapped_Bounds of a Radius request SHALL contain every point whose true distance from the Reference_Point is at most the Radius, for each Radius option of 1, 3, 5, 10 and 25 miles.
4. WHEN the rows returned for a Radius request are not in the Truncated_State, THE Board SHALL compute a Nearby_Set whose postings and order are identical to the Nearby_Set computed from every active posting for the same category, Reference_Point and Radius.
5. WHEN a Radius request returns rows in the Truncated_State, THE Board SHALL compute the Nearby_Set from the returned rows only (at most 100) and SHALL show the Truncated_State message defined in Requirement 5.
6. IF a Map_Query for the nearby list fails or returns an error status, THEN THE Board SHALL keep the previously shown cards and pins, SHALL show an error message stating that nearby postings could not be loaded together with a retry button, and SHALL NOT fall back to loading every posting.
7. IF a response arrives for a request that is no longer the latest, or for a category, Reference_Point or Radius that is no longer selected, THEN THE Board SHALL discard it.

### Requirement 7: Category kinds and field specifications

**User Story:** As a poster, I want the form to ask for the fields that suit my category, so that I am not asked for event data on a job.

#### Acceptance Criteria

1. THE Posting_Form SHALL derive the Posting_Kind from the category slug: listing for Jobs, Housing and Real Estate, Sales, and Lost and Found; event-optional for Community; event for every other category (Music, Nightlife, Sports, Social Clubs, Classes).
2. IF the category slug is not one of the known categories, THEN THE Posting_Form SHALL treat it as event.
3. WHEN the poster selects or changes the category, THE Posting_Form SHALL replace the date and link labels with those of the new category and SHALL keep the entered Details text unchanged.
4. WHEN the category is a Listing_Category, THE Posting_Form SHALL show one optional Deadline field and one optional link field, and SHALL NOT show Event date, Time, End date, End time or Event place.
5. WHEN the category is an event category, THE Posting_Form SHALL show Event date, Time, End date, End time and Event place, and a link field labelled "RSVP link (optional)" whose public button reads "RSVP".
6. THE Posting_Form SHALL label the optional Deadline and the optional link, and THE detail page SHALL name the public button, for each Listing_Category as follows: Jobs uses "Apply by (optional)", "Application link (optional)" and button "Apply"; Housing and Real Estate uses "Available until (optional)", "Listing or contact link (optional)" and button "View listing"; Sales uses "Offer ends (optional)", "Listing link (optional)" and button "View listing"; Lost and Found uses "Keep this up until (optional)", "Contact link (optional)" and button "Contact".
7. WHEN the category is Community, THE Posting_Form SHALL show "Event date (optional)", Time, End date and End time, and a link field labelled "Link (optional)".
8. WHEN a Community posting has an event date, THE detail page SHALL show the "RSVP" button, and WHEN a Community posting has no event date and has a link, THE detail page SHALL show the "Learn more" button.
9. WHEN a posting has no link, THE detail page SHALL show no link button, whatever the category.
10. THE Posting_Form SHALL keep a Housing and Real Estate "available from" date in the Details text for this stage and SHALL NOT add a structured field, a separate input or a new column for it.

### Requirement 8: Listing validation

**User Story:** As a poster of a listing, I want a deadline instead of an event date, so that my listing comes down when it stops being relevant.

#### Acceptance Criteria

1. WHEN a listing is submitted with a Deadline in the format YYYY-MM-DD that is a real calendar date and is today or later in the posting's time zone, THE Posting_Validator SHALL accept it and SHALL return the Deadline as `endDate` with `eventDate`, `eventTime` and `endTime` null.
2. WHEN a listing is submitted with no Deadline, or with an empty Deadline, THE Posting_Validator SHALL accept it and SHALL return `endDate`, `eventDate`, `eventTime` and `endTime` all null.
3. IF a listing payload sets a non-empty `eventDate`, `eventTime` or `endTime`, THEN THE Posting_Validator SHALL reject it with "Listings use a deadline instead of an event date." and SHALL return no validated posting.
4. IF a listing Deadline is before today in the posting's time zone, THEN THE Posting_Validator SHALL reject it with "This deadline has already passed." and SHALL return no validated posting. A Deadline equal to today SHALL NOT be rejected.
5. IF a listing Deadline is not in the format YYYY-MM-DD or is not a real calendar date, THEN THE Posting_Validator SHALL reject it with an error message stating that the Deadline must be a date in the format YYYY-MM-DD and SHALL return no validated posting.
6. IF a listing Deadline is flagged as needing year confirmation and the poster has not confirmed it, THEN THE Posting_Validator SHALL reject it with the same year-confirmation error message that it returns for an unconfirmed event date, and WHEN the poster has confirmed it, THE Posting_Validator SHALL accept it under criteria 1 to 5.
7. WHEN an event category is submitted, THE Posting_Validator SHALL return the same accept or reject result, the same error message and the same validated values as it did before this feature for the same input.
8. WHEN the same listing input is validated for publish and for edit, THE Posting_Validator SHALL return the same accept or reject result and the same error message for the title, category, Deadline, event-field, action link and year-confirmation checks.
9. WHEN a scanned flyer for a listing category contains a date, THE Posting_Form SHALL pre-fill the Deadline field with that date, and WHEN the poster clears the field and submits, THE Posting_Form SHALL send no Deadline.
10. WHEN a scanned flyer for a listing category contains no date or a date that cannot be read as a real calendar date, THE Posting_Form SHALL leave the Deadline field empty.

### Requirement 9: Community events and notices

**User Story:** As a poster in Community, I want to post either an event or a general notice, so that I only give a date when there is one.

#### Acceptance Criteria

1. WHEN a Community posting is submitted with no event date, no event time, no end date and no end time, THE Posting_Validator SHALL accept it and SHALL return the event date, event time, end date and end time as null.
2. IF a Community posting is submitted with an event time, an end date or an end time and without an event date, THEN THE Posting_Validator SHALL reject it with "Add an event date first, or clear the time fields.", SHALL save no change, and SHALL keep the poster's entered values in the Posting_Form.
3. WHEN a Community posting is submitted with an event date, THE Posting_Validator SHALL apply the same event rules as for an event category: the past-date check, the year confirmation, the end date not before the event date, and the end time rules.
4. IF a Community payload contains a Deadline, THEN THE Posting_Validator SHALL reject it with an error message indicating that Community postings use an event date and not a deadline, and SHALL save no change.
5. WHEN a Community posting has an event date, THE Board SHALL take the posting down at its Takedown_Time, which is the earlier of `expires_at` and the event end. The event end is the end date, or the event date if there is no end date, at the end time, or at 23:59:59.999 if there is no end time, in the posting's stored time zone.
6. WHEN a Community posting has no event date, THE Board SHALL take the posting down at `expires_at`, which the poster sets with the selected posting duration.
7. IF an edit removes the event date of a Community posting whose event end is at or before the current time, THEN THE Posting_Validator SHALL reject it with "This posting has ended. Clearing its date would put it back on the board.", SHALL leave the stored posting unchanged, and SHALL keep the poster's entered values in the edit form.
8. WHEN an edit adds an event date to a Community posting that has no event date, THE Board SHALL set a Takedown_Time that is the earlier of `expires_at` and the event end, and SHALL NOT set it later than the previous Takedown_Time, which was `expires_at`.

### Requirement 10: Consistent expiry explanation

**User Story:** As a poster, I want expiry explained the same way everywhere, so that I know when my posting comes down.

#### Acceptance Criteria

1. THE System SHALL compute `takedownInfo(p).at` as the same instant as the Takedown_Time returned by the existing lifecycle rule for every posting, whether the posting has an event date, a Deadline, both, or neither.
2. THE System SHALL return the `takedownInfo(p).reason` value as exactly one of "expiry", "deadline" or "event_end". The value SHALL be "deadline" WHEN the Takedown_Time comes from the end date of a listing, "event_end" WHEN it comes from the end of an event or of a Community posting's event date, and "expiry" WHEN it comes from `expires_at`.
3. IF `expires_at` and the event or deadline end are the same instant, THEN THE System SHALL return the reason "expiry".
4. WHEN the review form shows the expiry chips, THE review form SHALL show the line "Comes down on {date}: {reason}" directly under the chips, with {date} in the pin's time zone. THE review form SHALL also show a note that the exact takedown time uses the pin's time zone.
5. WHILE a posting is active, THE detail page SHALL show "On the board until {date}" followed by the reason, with {date} in the posting's stored time zone and the reason taken from `takedownInfo(p).reason`.
6. WHEN the owner changes a date, time or expiry choice in the edit form, THE edit form SHALL update the takedown line within 200 ms, using the same wording and rules as the review form.
7. IF the recomputed Takedown_Time in the edit form is earlier than the Takedown_Time saved for the posting, THEN THE edit form SHALL show a note of at most 120 characters saying that the posting will come down earlier, and SHALL keep every entered value. THE edit form SHALL NOT show the note when the recomputed time is the same or later.
8. WHEN the card shows a listing that has a Deadline, THE card SHALL show one line "{prefix} {date}", where {prefix} is the listing category's card prefix (for example "Apply by"). IF a listing has no Deadline, or a Community posting has no event date, THEN THE card SHALL show no date line.
9. THE database function `posting_takedown_at` SHALL return the same instant as the application Takedown_Time for every listing row and Community row, including rows whose takedown date falls on a daylight saving change in the stored time zone, and for a row with only `end_date`, only `event_date`, or neither.
10. THE System SHALL store a listing Deadline in `end_date` and the action link in `rsvp_url`, SHALL add no column, and SHALL make no schema change.

### Requirement 11: Protecting existing postings

**User Story:** As a poster with an existing posting, I want nothing to change unless I save, so that my posting is not altered behind my back.

#### Acceptance Criteria

1. THE feature SHALL include no migration, script or startup task that modifies an existing posting row, so that every stored column of every existing posting is identical before and after the feature is deployed until its Owner saves an edit.
2. THE detail page and card SHALL show the stored `event_date` and `event_time` of an existing Listing_Category posting exactly as they showed them before this feature, and SHALL show the category's new action button label ("Apply" or "View listing" or "Contact") in place of "RSVP".
3. WHEN the owner opens the edit form for a Listing_Category posting that has a stored `event_date`, THE edit form SHALL pre-fill the Deadline field with that `event_date` and SHALL show a notice that names the stored date and states that saving replaces the event date with the Deadline, and THE edit form SHALL write nothing to the posting until the owner saves.
4. WHEN the owner cancels or leaves the edit form without saving, THE PATCH route SHALL receive no request and every stored column of the posting SHALL remain unchanged.
5. WHEN the owner saves a posting, THE PATCH route SHALL write `event_date`, `event_time`, `end_date` and `end_time` in one update according to the Posting_Kind of the saved category: for a listing only `end_date` set to the Deadline (or null) with the other three null, for an event as before this feature, and for event-optional the event rules when an event date is given and all four null otherwise.
6. WHEN the owner saves an event posting after changing its category to a Listing_Category, THE edit form SHALL show a notice before saving that the event time and end time will be removed, and THE PATCH route SHALL set `event_time` and `end_time` to null only on that save.
7. WHEN the owner saves a posting and the link field value equals the stored `rsvp_url`, THE PATCH route SHALL leave `rsvp_url` unchanged, and WHEN the link field value differs, THE PATCH route SHALL write the new value after the existing http(s)-only link validation.
8. WHEN the owner saves a Listing_Category posting that has a stored legacy `event_date` and the edit form displayed the replacement notice in that session, THE PATCH route SHALL set `event_date` to null, and IF the edit form did not display the notice, THEN THE PATCH route SHALL leave the stored `event_date` unchanged.
9. IF the PATCH route rejects a save with a validation error, THEN THE PATCH route SHALL leave every stored column of the posting unchanged and THE edit form SHALL keep the values the owner entered.

### Requirement 12: Alert job for listings and notices

**User Story:** As a subscriber to alerts, I want alerts to handle listings and notices correctly, so that I see the right posting with the right date.

#### Acceptance Criteria

1. WHEN the Alert_Job evaluates a listing that has a Deadline and no event date, THE Alert_Job SHALL treat the listing as matchable until 23:59:59.999 on the Deadline day in the posting's stored time zone, and SHALL NOT match it at or after `expires_at`, whichever of the two comes first.
2. WHEN the Alert_Job evaluates a Community posting that has no event date and no `end_date`, THE Alert_Job SHALL treat the posting as matchable until `expires_at`, and SHALL NOT match it at or after `expires_at`.
3. WHEN the Alert_Job evaluates a Community posting that has an event date, THE Alert_Job SHALL apply the same Takedown_Time rule that the Board uses for events, which is the earlier of `expires_at` and the event end, where the event end is `end_date` (or the event date if `end_date` is empty) at `end_time` (or 23:59:59.999 if `end_time` is empty) in the posting's stored time zone.
4. WHEN the Alert_Job builds an Alert_Email for a listing that has a Deadline, THE Alert_Email SHALL show one date line made of the category's card prefix and the Deadline in short month and day form, for example "Apply by Dec 1".
5. WHEN the Alert_Job builds an Alert_Email for a Community posting without an event date, or for a listing without a Deadline, THE Alert_Email SHALL contain no date line.
6. THE Alert_Email SHALL NOT contain the text "null", "undefined" or "Invalid Date" in its subject, plain-text body or HTML body for any combination of missing or present `event_date`, `event_time`, `end_date` and `end_time`.
7. IF a posting's date value cannot be parsed as a valid date, THEN THE Alert_Email SHALL omit the date line and THE Alert_Job SHALL still send the Alert_Email and continue with the remaining postings.
8. WHEN the Alert_Job builds an Alert_Email for a posting, THE Alert_Job SHALL pass the posting's `endDate` and `categorySlug` to the Alert_Email builder, in addition to the values it already passes.
9. THE feature SHALL add an entry to `BUILD_LOG.md` stating that the Alert_Job reads every active posting and loops alerts by postings, recorded as a scale follow-up outside this feature, and SHALL make no change to how the Alert_Job selects postings.

### Requirement 13: Bounded map query

**User Story:** As the site owner, I want map reads to be bounded on the server, so that the page cost does not grow with the whole database.

#### Acceptance Criteria

1. THE Map_Query endpoint SHALL be public (no sign-in required) and read-only, SHALL require a `bounds` parameter, SHALL accept an optional `category` parameter, and SHALL accept an optional `mode` parameter whose only valid values are `pins` and `cards`.
2. WHEN the request omits `mode`, THE Map_Query endpoint SHALL use `pins` mode.
3. IF `bounds` is missing, malformed (not four finite decimal numbers for south, west, north and east), inverted (south greater than north, or west greater than east), out of range (latitude outside -90 to 90 or longitude outside -180 to 180), or would wrap the antimeridian, or IF `category` is not one of the known categories, or IF `mode` is any value other than `pins` or `cards`, THEN THE Map_Query endpoint SHALL respond with status 400, return zero postings, and leave stored data unchanged.
4. THE Map_Query SHALL use the Pin_Cap (300) for pins mode and the Card_Cap (100) for cards mode, SHALL ignore any cap or limit value supplied by the client, and SHALL read at most the cap plus one row from the data source.
5. THE Map_Query SHALL return only postings whose location lies inside the Snapped_Bounds of the requested bounds (edges inclusive) and, when a `category` is given, only postings of that category.
6. WHEN more postings match than the cap allows, THE Map_Query SHALL return exactly the first cap postings in the order of criterion 8 with `truncated` true.
7. WHEN the number of matching postings is less than or equal to the cap, THE Map_Query SHALL return every matching posting with `truncated` false.
8. THE Map_Query SHALL order results by promoted first, then newest creation time first, then id descending, and SHALL exclude postings that are deleted, hidden by moderation, past their expiry time, or whose event has ended.
9. THE Map_Query SHALL compute reply, like, going and interested counts and the viewer's like state only for the returned rows (at most the cap), and SHALL perform no per-row counting for rows beyond the cap.
10. WHEN the Map_Query endpoint answers a request in pins mode, THE Map_Query endpoint SHALL send the response header `Cache-Control: public, s-maxage=30, stale-while-revalidate=60`; WHEN it answers in cards mode, THE Map_Query endpoint SHALL send `Cache-Control: private, no-store`.
11. WHERE Supabase is not configured, THE Map_Query endpoint SHALL answer from the seed postings using the same selection function (bounds, category, exclusions, ordering, cap and `truncated` rules) as the Supabase path.
12. IF the data source fails or times out while the Map_Query reads, THEN THE Map_Query endpoint SHALL respond with a server error status, return zero postings, send `Cache-Control: no-store`, and expose no internal error detail to the client.
13. THE Map_Query SHALL snap request bounds outward to a 0.1 degree grid so that the snapped box contains the original box, SHALL clamp the snapped box to latitude -90 to 90 and longitude -180 to 180, and SHALL produce an identical box when an already snapped box is snapped again.
14. THE Board page SHALL NOT load every active posting into the page, and SHALL load at most the Card_Cap (100) postings for its initial render.

### Requirement 14: Category filter on both maps and map captions

**User Story:** As a visitor, I want the category filter to affect both maps, so that the page does not look broken.

#### Acceptance Criteria

1. WHEN a category is selected, THE Board SHALL send that category's slug as the `category` value in the Local_Map request and in the World_Map request, and WHEN "All categories" is selected, THE Board SHALL send no `category` value in either request.
2. WHEN the viewer changes the selected category, THE Board SHALL show the new category's postings on the Local_Map and the World_Map without a page reload, and SHALL show no pin of the previous category on either map after both responses have been applied.
3. IF a response arrives for a category that is no longer selected, THEN THE Board SHALL discard it, SHALL leave the pins and caption of the currently selected category unchanged, and SHALL show no error message.
4. THE World_Map caption SHALL have the form "Explore the world · {category} · {n} postings in view", where {category} is the selected category's name or "All categories" and {n} is the number of pins currently drawn in the World_Map's view, for example "Explore the world · Sports · 3 postings in view". WHEN {n} is 1, THE World_Map caption SHALL use "1 posting in view".
5. WHILE the World_Map is in the Truncated_State, THE World_Map caption SHALL read "Showing 300 of many postings in this view. Zoom in to see more." in place of the posting count.
6. WHEN the World_Map has 0 postings in view for a selected category, THE World_Map SHALL show "No {category} postings in this view." and a navy "Show all categories" button with a tap target of at least 44 px.
7. WHEN the viewer activates the "Show all categories" button, THE Board SHALL set the selection to "All categories" and SHALL send no `category` value in the Local_Map request and the World_Map request.
8. THE World_Map caption SHALL NOT show a posting total other than the number of pins drawn in view or the 300 pin limit stated in the Truncated_State caption.

### Requirement 15: World map loading behaviour

**User Story:** As a visitor, I want the world map to stay responsive while I pan, so that it neither flickers nor shows stale pins.

#### Acceptance Criteria

1. WHEN the World_Map first renders, THE World_Map SHALL create exactly one map instance, and THE World_Map SHALL NOT create another map instance for the lifetime of that mount, including when results, category or viewport change.
2. WHEN a result set arrives, THE World_Map SHALL add a marker for each posting id not currently shown, SHALL remove each marker whose posting id is absent from the new result set, and SHALL leave markers whose posting id is in both sets in place without recreating them.
3. WHEN the viewer pans or zooms the World_Map, THE World_Map SHALL restart a 400 ms debounce timer and, when the timer expires with no further pan or zoom, SHALL send exactly one request for the current viewport.
4. WHEN a new request is sent while a previous request is still in flight, THE World_Map SHALL abort the previous request.
5. IF a response arrives from a request that is not the most recently sent request, THEN THE World_Map SHALL ignore it and SHALL leave the displayed pins, the "Updating…" label and the retry button unchanged.
6. IF a request fails by network error, timeout or a non-success response, THEN THE World_Map SHALL keep all current pins and SHALL show a retry button within 1 second of the failure.
7. IF a request is aborted by the World_Map itself because a newer request replaced it, THEN THE World_Map SHALL NOT treat it as a failure and SHALL NOT show the retry button.
8. WHEN the viewer activates the retry button, THE World_Map SHALL hide the retry button and send one request for the current viewport.
9. WHILE a request has been in flight for more than 300 ms, THE World_Map SHALL show an "Updating…" label and SHALL keep the previous pins displayed.
10. WHEN the latest request succeeds, fails or is aborted without a replacement, THE World_Map SHALL hide the "Updating…" label.

### Requirement 16: Optional geographic index draft

**User Story:** As the Owner, I want a reviewed index draft, so that map reads stay fast as the table grows.

#### Acceptance Criteria

1. THE feature SHALL provide Geo_Index_SQL as four separate files: a preflight script, a migration script, a verify script and a rollback script.
2. THE Geo_Index_SQL preflight script SHALL be read-only and SHALL report the postings row count, whether the index `postings_active_geo_idx` already exists, the column types of `lat` and `lng`, and the existing indexes on the postings table.
3. THE Geo_Index_SQL migration script SHALL create exactly one index, `postings_active_geo_idx`, on the `lat` and `lng` columns of the postings table, limited to rows where `deleted_at` is null and `moderation_hidden_at` is null, and SHALL run in a single transaction.
4. THE Geo_Index_SQL migration script SHALL contain no statement that inserts, updates or deletes a row, and SHALL be safe to run twice, so that a second run leaves the same single index and changes no row.
5. THE Geo_Index_SQL migration script SHALL NOT include `expires_at > now()` in the index condition.
6. THE Geo_Index_SQL migration script SHALL include a comment telling the Owner that `create index concurrently`, run outside a transaction, may suit a large table.
7. WHEN the Owner runs the Geo_Index_SQL verify script, THE verify script SHALL report whether `postings_active_geo_idx` exists and is valid, and whether its condition matches the Map_Query filters for deleted and moderation-hidden postings.
8. WHEN the Owner runs the Geo_Index_SQL rollback script, THE rollback script SHALL drop `postings_active_geo_idx` if it exists and SHALL change no row, and running it when the index is absent SHALL cause no error.
9. THE Board SHALL return the same Map_Query results, in the same order and with the same `truncated` value, whether or not the Owner has applied the Geo_Index_SQL.
10. IF the index `postings_active_geo_idx` does not exist, THEN THE Board and the Map_Query endpoint SHALL operate without error and without any message shown to visitors.
11. THE feature SHALL write the Geo_Index_SQL files as drafts only, and SHALL NOT apply them to any database.

### Requirement 17: Automatic thread refresh

**User Story:** As a user in an open conversation, I want new messages to appear on their own, so that I do not have to press refresh.

#### Acceptance Criteria

1. WHILE a thread is open and the tab is visible, THE Poller SHALL start the next request 5 seconds (±15 percent jitter) after the previous request completes, except that WHILE 120 seconds or more have passed since the last new message was received (or since the thread was opened, if none has arrived), THE Poller SHALL use 15 seconds (±15 percent jitter) instead.
2. WHEN a poll returns at least one message that was not already shown, THE Poller SHALL reset the quiet timer and return to the 5-second interval.
3. WHILE the tab is hidden, THE Poller SHALL make no requests. WHEN the tab becomes visible while a thread is open, THE Poller SHALL make one request within 1 second, provided none is in flight, and then resume the interval in criterion 1.
4. IF a request fails (network error, timeout, or any status other than 2xx, 401 and 404), THEN THE Poller SHALL schedule the next request after the current interval (5 or 15 seconds) multiplied by 2 to the power of the consecutive failure count (the count is capped at 10 for this calculation). The delay SHALL be at least 1 second and at most 60 seconds, with ±15 percent jitter applied before the cap. THE Thread_View SHALL show the text "Reconnecting…" and SHALL keep all messages already displayed.
5. WHEN a request succeeds after one or more failures, THE Poller SHALL reset the failure count to 0, and THE Thread_View SHALL remove the "Reconnecting…" text.
6. IF a request returns status 401 or 404, THEN THE Poller SHALL make no further requests until the Thread_View is closed and reopened, and THE Thread_View SHALL show the existing signed-out state for 401 or the existing not-found state for 404, keeping no "Reconnecting…" text.
7. THE Poller SHALL have at most 1 request in flight at any time. IF a poll trigger (timer, visibility change, focus or message send) occurs while a request is in flight, THEN THE Poller SHALL not start a second request.
8. THE Thread_View SHALL send `after` set to the unmodified `created_at` string of the newest message currently shown, and THE messages endpoint SHALL return messages in the thread whose `created_at` is at or after that value (inclusive, so that messages with an identical timestamp are not missed). WHEN the thread has no messages shown, THE Thread_View SHALL omit `after`.
9. WHEN overlapping or out-of-order batches arrive, THE Thread_View SHALL show each message id exactly once, sorted by `created_at` ascending and then by id ascending.
10. THE Thread_View SHALL keep the "Check for new messages" button, with the text "Updates automatically while this page is open." shown beside it. WHEN the button is pressed, THE Thread_View SHALL make one immediate request, provided none is in flight.
11. IF `after` is longer than 40 characters or is not a parseable timestamp, THEN THE messages endpoint SHALL respond with status 400, return no messages, and leave stored data unchanged.

### Requirement 18: Unread indicator

**User Story:** As a user, I want to see which conversations have new messages, so that I do not miss replies.

#### Acceptance Criteria

1. IF the Message_Reads_SQL is not applied (the unread table or either unread function is missing), THEN THE Unread_Service SHALL respond to the count request with `supported: false` and no counts, THE Unread_Service client SHALL send no further count requests for the rest of the page session, and THE Board SHALL show no badge, dot or "Unread" text.
2. IF the unread count request fails for a reason other than the Message_Reads_SQL being missing or the viewer being signed out, THEN THE Unread_Service client SHALL keep the last known counts, SHALL NOT set `supported` to false, and SHALL retry at the next scheduled refresh.
3. WHILE the Message_Reads_SQL is applied, THE Unread_Service SHALL return, for each thread in which the viewer is a participant, a count of messages sent by the other participant with `created_at` later than the viewer's read marker for that thread, or a count of all of the other participant's messages when the viewer has no marker for that thread, together with a total equal to the sum of the per-thread counts.
4. THE Unread_Service SHALL NOT count a message sent by the viewer as unread, and sending a message SHALL leave the sender's unread count for that thread unchanged.
5. WHEN the Thread_View renders new messages from the other participant while the document is visible, THE Thread_View SHALL send one mark-read request for that thread with `upTo` equal to the stored `created_at` of the newest message shown, and SHALL skip the request when `upTo` is not later than the last value it sent for that thread.
6. WHEN a mark-read request is received, THE Unread_Service SHALL set the viewer's read marker for that thread to the later of the existing marker and `upTo`, SHALL NOT set a marker later than the server time, and SHALL NOT change the marker of any other user.
7. WHEN a mark-read request succeeds, THE Thread_View SHALL dispatch a `cb:unread-changed` event, and THE Unread_Service client SHALL refresh the counts within 1 second of that event.
8. WHERE unread is supported and the total is 1 or more, THE bottom navigation SHALL show a badge on Messages with the total, showing "9+" when the total is 10 or more, and SHALL set the accessible label of the Messages link to "Messages, N unread", where N is the exact total (for example "Messages, 3 unread", and "Messages, 12 unread" when the badge shows "9+").
9. WHERE unread is supported and the total is 0, THE bottom navigation SHALL show no badge and SHALL set the accessible label of the Messages link to "Messages".
10. WHERE unread is supported, THE inbox list SHALL mark each thread with a count of 1 or more with a dot, a bold handle and visually hidden text "Unread", and SHALL show none of the three on a thread with a count of 0.
11. IF the viewer is signed out, THEN THE Unread_Service client SHALL send no further requests after the first response with a 401 status, and THE Board SHALL show no badge or marker.
12. WHILE the viewer is signed in, the document is visible and unread is supported, THE Unread_Service client SHALL request counts once after mount, on window focus, and every 60 seconds, and SHALL send no requests while the document is hidden.

### Requirement 19: Message reads SQL drafts

**User Story:** As the Owner, I want reviewed SQL for unread tracking, so that I decide when it reaches production.

#### Acceptance Criteria

1. THE feature SHALL provide Message_Reads_SQL consisting of exactly four files in the `supabase` folder: `stage11_message_reads_preflight.sql`, `stage11_message_reads.sql`, `stage11_message_reads_verify_roles.sql` and `stage11_message_reads_rollback.sql`.
2. THE `stage11_message_reads_preflight.sql` file SHALL be read-only, SHALL change no row, table or function, and SHALL report whether `message_thread_reads` already exists and whether the `messages` and `message_threads` tables it depends on exist.
3. THE `stage11_message_reads.sql` file SHALL create a `message_thread_reads` table that holds at most one read marker per combination of thread and user.
4. THE `message_thread_reads` table SHALL have row-level security enabled, and SHALL let an authenticated user select, insert and update only rows whose user is that user and whose thread that user participates in.
5. THE Message_Reads_SQL SHALL create a mark-read function that accepts a thread id and a timestamp, and that sets the marker to the greatest of the existing marker and the supplied timestamp, capped at the server clock time of the call.
6. WHEN the mark-read function is called with a timestamp earlier than the existing marker, THE mark-read function SHALL leave the stored marker unchanged and SHALL return without error.
7. WHEN the mark-read function is called with a timestamp later than the server clock time of the call, THE mark-read function SHALL store the server clock time instead.
8. IF the caller of the mark-read function is not a participant of the thread, THEN THE mark-read function SHALL store no marker and SHALL raise an error, and no row of `message_thread_reads` SHALL change.
9. THE Message_Reads_SQL SHALL create an unread-count function that returns, for each thread the caller participates in, the number of messages sent by the other participant after the caller's marker, or all of that participant's messages when the caller has no marker, and that excludes the caller's own messages.
10. THE Message_Reads_SQL SHALL deny the anon role every privilege on `message_thread_reads` and execute on both functions, and SHALL deny an authenticated user who is not a participant of a thread any read or write of that thread's markers and any unread count for it.
11. THE `stage11_message_reads_verify_roles.sql` file SHALL check, for the anon role, a participant and a third user, that the privileges in criterion 10 hold, and SHALL report each check as pass or fail without leaving data changed.
12. WHEN the `stage11_message_reads.sql` file runs, THE Message_Reads_SQL SHALL insert one marker for every existing thread participant, set to the `created_at` of the latest message in the thread from either participant or, when the thread has no message, to the thread's `created_at`, so that every message that exists at migration time counts as read, and SHALL insert nothing for a pair that already has a marker.
13. THE Message_Reads_SQL SHALL insert, update or delete no row of `messages` or `message_threads`, and SHALL change no column, constraint, policy or privilege on them.
14. IF `stage11_message_reads.sql` is run twice against the same database, THEN THE second run SHALL complete without error and SHALL leave `message_thread_reads` with the same rows as after the first run.
15. THE `stage11_message_reads_rollback.sql` file SHALL drop only the objects created by `stage11_message_reads.sql`, SHALL leave `messages` and `message_threads` row counts and contents unchanged, and SHALL complete without error when run on a database where the migration was not applied.
16. THE feature SHALL test the Message_Reads_SQL in an isolated database that holds no production data, covering the preflight, migration, role verification, a second migration run and rollback, and SHALL NOT run the Message_Reads_SQL against the production database.
17. THE Message_Reads_SQL SHALL be additive only, SHALL contain no statement that drops, truncates or alters an existing object other than those it creates, and SHALL drop objects only in the rollback file.

### Requirement 20: Privacy, scope, test data and design tokens

**User Story:** As the Owner, I want privacy, scope and visual rules held across all stages, so that the feature fits CorkBack's rules.

#### Acceptance Criteria

1. THE Board SHALL keep the viewer's exact Reference_Point coordinates and device location coordinates in the browser only.
2. WHEN THE Board requests postings from the server, THE Board SHALL send only the Snapped_Bounds and the selected category (or no category for all categories), with no Reference_Point coordinates, device coordinates, Radius value, username or email in the request URL, query string or body.
3. THE Board SHALL show no exact poster location, no full name and no email on any new label, caption, heading, Distance_Label or card text.
4. IF a new label, caption, heading or Distance_Label would contain latitude or longitude digits of a posting, the Reference_Point or the device location, THEN THE Board SHALL omit those digits and show only a rounded Distance_Label or a place name.
5. THE feature SHALL keep Fixture_Data in test files and the browser test harness only, and SHALL NOT insert it into Supabase or into `src/lib/seed.ts`.
6. THE feature SHALL include an automated test that fails IF any posting id in `src/lib/seed.ts` starts with `fx-`, OR IF any file outside test files and the browser test harness imports Fixture_Data.
7. THE feature SHALL deliver all SQL as drafted files only (including Message_Reads_SQL and Geo_Index_SQL), SHALL leave the Owner to review and apply every SQL file, and SHALL NOT run a migration against, or deploy to, a production environment.
8. THE feature SHALL leave the React #418 hydration issue out of scope.
9. THE feature SHALL NOT read `localStorage`, `window` or `Date.now()` during the render phase of any new or changed component, and SHALL read them only inside effects or event handlers.
10. THE Board SHALL show exactly one dark-red main action on each screen, SHALL use navy for every secondary control, and SHALL limit new interface colours to the design-token Paper, Ink, Board, Card white, dark red and deep navy values, with no additional interface colour.
11. THE feature SHALL keep Follow and Connect independent, so that a Follow action creates no Connect and a Connect acceptance creates no Follow.
12. THE feature SHALL NOT show a Like count or a Like action on any reply, comment or message in the UI or API.
