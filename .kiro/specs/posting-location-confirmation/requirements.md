# Requirements Document

## Introduction

Today a CorkBack posting is pinned where the poster is standing when they publish. `ReviewForm` asks for device location and sends it as both `real` and `desired`, and `validatePostingInput` clamps the pin to 150 m of that point. A poster who scans a flyer at home therefore pins the event at their house. The flyer's venue and address are read by Gemini but used only as free text (`placeLabel`), and the edit page cannot change the pin at all.

This feature makes the posting pin represent **where the event or listing takes place**. The poster confirms or chooses that place on a map before publishing. An address read from a flyer is only a candidate. It can be a home, a return address or other personal information, so it is never published as the pin without the poster's confirmation. Device location becomes an explicit, optional shortcut. For a private home, the poster can publish an approximate pin and is told what visitors will see.

The feature replaces the locked rule in `.kiro/steering/location-rules.md` ("pinned where the poster actually is", with a 150 m bounded nudge). The owner has approved that replacement. The existing postings stay as they are until their owners edit and save them. The home page's browsing location stays separate from this flow.

Address lookup uses the public OpenStreetMap Nominatim service by default. Its usage policy allows at most 1 request per second for the whole application, not per server instance, and requires caching, attribution and an identifying User-Agent. The lookup therefore runs only when the poster taps a button, sends only the selected or typed address text, shares one throttle and one cache across all server instances through Supabase, and switches itself off, leaving manual pin placement, when any policy condition cannot be met.

Scope: scan, review, edit and detail pages, one new geocoder route with its shared throttle and cache, a new scan-extraction field, pure location modules, a new location picker, and one draft SQL stage (`stage14`). Out of scope: the home page's town search and "Use my location" behavior (which still call Nominatim directly and are not covered by the shared throttle, see the design), alerts, messaging, moderation and publishing the flyer image.

## Glossary

- **Posting_Location**: The stored pin (`lat`, `lng`), its precision, and the place label of one posting.
- **Pin**: The public point on the map for a posting.
- **Confirmed_Pin**: A Pin that the poster chose or confirmed in the Location_Picker with an explicit action.
- **Address_Candidate**: An address or place name read from the flyer by extraction. It has text, a kind hint (venue, contact, return, other or unknown) and no coordinates.
- **Place_Match**: One geocoder result for a text query: a display name, a point, an address summary and a match level (address or area).
- **Ambiguous_Matches**: A result set with two or more Place_Matches whose points are more than 250 m apart.
- **Location_Draft**: The poster's in-progress location in the Posting_Form: candidates, the selected match or point, the source of the point, the precision and the label state.
- **Pin_Source**: How the draft point was set: `flyer_candidate`, `search`, `pin` (placed or dragged on the map) or `device`.
- **Location_Picker**: The client component with a MapLibre map, place search, candidate list, draggable pin, "Use my location" and the private-home choice.
- **Device_Shortcut**: The "Use my location" button inside the Location_Picker. It is the only code in the posting flow that reads device location.
- **Browsing_Location**: The home board's reference point, its saved centre in `localStorage["corkback.mapCenter"]`, and the home page's "Use my location" and town search.
- **Geocoder_Service**: The new signed-in route `GET /api/geocode` that looks up places for the Location_Picker.
- **Precision**: One of `exact` (the Pin is the confirmed point), `approximate` (the Pin is offset from the confirmed point) or `unreviewed` (an existing posting whose pin was never confirmed).
- **Approximate_Pin**: A Pin computed in the browser as the confirmed point moved by a random distance of at least 150 m and at most 400 m in a random direction.
- **Approximation_Bounds**: The minimum of 150 m and the maximum of 400 m used for an Approximate_Pin.
- **Private_Home_Choice**: The poster's statement that the place is a private home or residence.
- **Location_Label**: The category-specific field name for the place (Event venue, Listing location, or Where it was lost or found).
- **Place_Label**: The public place text stored in `place_label`.
- **Derived_Label**: A Place_Label that the Location_Picker filled in from a Place_Match and the poster has not typed over.
- **Personal_Details_Warning**: The warning shown when a street address that is not the confirmed public place, a phone number or an email address appears in the title, details or Place_Label. It warns and asks for acknowledgement. It never changes the text.
- **Contact_Details**: A phone number or an email address found in text by the contact detector (`findContactDetails`).
- **Geocoder_Query**: The one text string sent to the geocoder: the address or place text the poster selected or typed, trimmed, with whitespace collapsed and cut to 200 characters.
- **Public_Nominatim**: The geocoder endpoint `https://nominatim.openstreetmap.org/search`. Any other `GEOCODER_URL` is a keyed provider.
- **Geocoder_Config**: The geocoder settings read from environment variables: `GEOCODER_URL`, `GEOCODER_USER_AGENT`, `GEOCODER_REFERER`, `GEOCODER_API_KEY`, `GEOCODER_API_KEY_PARAM`, `GEOCODER_CACHE_SECRET`, plus the existing Supabase variables.
- **Shared_Throttle**: The Supabase-backed slot counter (`cb_geocoder_take_slot`) that grants upstream request slots at least 1 second apart for the whole application.
- **Geocoder_Cache**: The Supabase table of geocoder results keyed by an HMAC of the normalized Geocoder_Query, shared by all server instances.
- **Search_Unavailable_State**: The state in which the Geocoder_Service makes no upstream request and the Location_Picker shows "Place search is `unavailable` right now. You can still place the pin on the map."
- **Legacy_Posting**: A posting that exists before this feature ships. Its Precision reads as `unreviewed`.
- **Posting_Validator**: `validatePostingInput` and `validatePostingEdit` in `src/lib/postingInput.ts`.
- **Posting_Form**: The review form used to publish and the edit form used to change a posting.
- **Location_SQL**: The drafted `stage14_posting_location*.sql` files (preflight, migration, verify and rollback). They add the posting precision column, the location update function, and the geocoder throttle and cache objects.
- **Preview_Build**: The local production build and the protected Vercel preview, both in demo mode with no database connection.
- **Owner**: The project owner, who reviews and applies SQL and approves the production deployment.

## Requirements

### Requirement 1: The pin marks the event or listing

**User Story:** As a poster, I want my posting pinned where the event or listing takes place, so that visitors find the right place and not the spot where I scanned the flyer.

#### Acceptance Criteria

1. WHEN the poster publishes a posting, THE Posting_Validator SHALL require a Confirmed_Pin in the request.
2. THE Pin of a published posting SHALL equal the point of the Confirmed_Pin, or the Approximate_Pin computed from it when Precision is `approximate`.
3. WHEN the poster opens the scan page, the capture step or the review page, THE Posting_Form SHALL read no device location and SHALL show no location permission prompt.
4. WHEN a flyer scan finishes, THE Posting_Form SHALL leave the Location_Draft without a Confirmed_Pin.
5. IF a publish request has no Confirmed_Pin, THEN THE Posting_Validator SHALL reject the request with the message "Choose where this takes place on the map before publishing."
6. IF a publish request uses the retired fields `real` or `desired` instead of a Confirmed_Pin, THEN THE Posting_Validator SHALL reject the request with the message "Reload the page and choose where this takes place."
7. THE Posting_Validator SHALL accept a Pin at any distance from any other point, with no fixed distance limit between the Pin and the poster's device location.

### Requirement 2: Extract venue and addresses from the flyer

**User Story:** As a poster, I want the scan to read the venue and every address on the flyer, so that I can pick the right one instead of retyping it.

#### Acceptance Criteria

1. WHEN the scan route extracts a flyer, THE scan route SHALL return the existing fields and a list named `addresses` of Address_Candidate objects.
2. THE extraction prompt SHALL ask the model for every address or place name printed on the flyer and for a kind hint on each, with the values venue, contact, return, other and unknown.
3. THE scan route SHALL keep at most 5 Address_Candidates, each with text of at most 200 characters, a kind from the allowed values, and no two candidates with the same normalized text.
4. IF the model returns an `addresses` value that is missing, not a list, or contains non-text entries, THEN THE scan route SHALL return an empty list and SHALL still return the other extracted fields.
5. THE scan route SHALL keep returning `placeLabel` as the venue text on the flyer, so that an older review page keeps working.
6. THE scan route SHALL return no coordinates and SHALL call no geocoder.
7. WHEN the review page reads the extraction saved in `sessionStorage`, THE Posting_Form SHALL accept a saved extraction without `addresses` and SHALL treat it as an empty list.
8. IF the saved extraction is not valid JSON or fails field checks, THEN THE Posting_Form SHALL open with blank fields and SHALL show "We could not read the saved scan. Enter the details below."

### Requirement 3: Confirm that an address is the place

**User Story:** As a poster, I want to be asked whether an address on my flyer is really the place, so that a home address or return address never becomes the public pin.

#### Acceptance Criteria

1. THE Location_Picker SHALL list every Address_Candidate with its text and a "Find on map" button, and SHALL set no pin while the poster has not tapped a button.
2. WHEN the poster selects a Place_Match for a candidate, THE Location_Picker SHALL show the match on a map preview with a pin, and SHALL ask "Is this where the event or listing takes place?" with the buttons "Yes, use this place" and "No, choose another".
3. WHEN the poster taps "Yes, use this place", THE Location_Draft SHALL record a Confirmed_Pin at the point of the selected Place_Match with Pin_Source `flyer_candidate`.
4. WHEN the poster taps "No, choose another", THE Location_Draft SHALL discard the selected match, SHALL keep no Confirmed_Pin from it, and THE Location_Picker SHALL show the candidate list and the search box again.
5. WHILE the question "Is this where the event or listing takes place?" is unanswered, THE Posting_Form SHALL treat the Location_Draft as not confirmed and SHALL keep the publish action from sending a request.
6. WHEN the poster changes the selected match, moves the pin or picks another candidate after confirming, THE Location_Draft SHALL return to not confirmed until the poster confirms again.
7. WHERE a candidate has the kind contact or return, THE Location_Picker SHALL show the note "This looks like a contact or return address. It may be a home." next to that candidate.
8. THE Location_Picker SHALL show the question text exactly as "Is this where the event or listing takes place?" for every category.
9. WHERE the category is Lost and Found, THE Location_Picker SHALL show the line "For Lost and Found, this is where the item was lost or found." under the question.

### Requirement 4: Match addresses to places

**User Story:** As a poster, I want CorkBack to find the places that match an address, so that I can check one on a map.

#### Acceptance Criteria

1. WHEN the poster taps "Find on map" for a candidate or submits the search box, THE Geocoder_Service SHALL look up that text and return at most 5 Place_Matches.
2. THE Location_Picker SHALL send text to the Geocoder_Service only after the poster taps "Find on map" or submits the search form, SHALL send no request while the poster types, SHALL offer no autocomplete or suggestions as the poster types, and SHALL keep at most one lookup in flight.
3. WHEN the Geocoder_Service returns more than one Place_Match and the set is Ambiguous_Matches, THE Location_Picker SHALL list all matches with their address summaries and SHALL show no pin until the poster selects one.
4. WHEN the Geocoder_Service returns exactly one Place_Match, or several that lie within 250 m of each other, THE Location_Picker SHALL propose the first match on the map preview and SHALL still ask the confirmation question.
5. WHEN a Place_Match has the match level area, THE Location_Picker SHALL show "This matched the area, not an exact address. Drag the pin to the exact spot."
6. IF the Geocoder_Service returns no Place_Match, THEN THE Location_Picker SHALL show "We could not find that address. Search another way or place the pin on the map." and SHALL keep the search box and the map available.
7. IF the Geocoder_Service is in the Search_Unavailable_State, fails, or times out after 8 seconds, THEN THE Location_Picker SHALL show "Place search is `unavailable` right now. You can still place the pin on the map." and SHALL keep manual pin placement, "Use my location" and publishing available.
8. WHEN the viewer is not signed in, THE Geocoder_Service SHALL return HTTP 401 and SHALL call no external geocoder.
9. IF the Shared_Throttle does not grant a slot within 3 seconds, THEN THE Geocoder_Service SHALL return HTTP 429 with the state `busy`, THE Location_Picker SHALL show "Place search is busy. Try again in a moment.", and THE Geocoder_Service SHALL make no upstream request.
10. THE Geocoder_Service SHALL take its endpoint from `GEOCODER_URL` with Public_Nominatim as the default, and SHALL take an optional provider key from `GEOCODER_API_KEY`, so that a keyed provider can replace Public_Nominatim without a code change.
11. THE Geocoder_Service SHALL write no query text and no result body to logs, and SHALL store the query only as the HMAC key of the Geocoder_Cache (Requirement 20).
12. THE Location_Picker SHALL show the attribution "© OpenStreetMap contributors" as a link to `https://www.openstreetmap.org/copyright` on the map and next to the search results (Requirement 19.4).
13. THE Geocoder_Service SHALL leave the home page's town search unchanged.
14. THE Geocoder_Service SHALL allow each signed-in user at most 20 lookups in 10 minutes as an additional limit, and WHEN a user exceeds the limit THE Geocoder_Service SHALL return HTTP 429 with the state `user_limit` and make no upstream request.

### Requirement 5: Search and place the pin by hand

**User Story:** As a poster, I want to search for a place or put the pin on the map myself, so that I can finish when the flyer has no address, a wrong address or an unclear one.

#### Acceptance Criteria

1. WHEN the flyer has no Address_Candidate, THE Location_Picker SHALL show the search box and the map and SHALL show "No address was found on the flyer. Search for the place or tap the map."
2. WHEN the poster taps the map while no pin is set, THE Location_Picker SHALL place a proposed pin at the tapped point with Pin_Source `pin` and SHALL ask the confirmation question.
3. WHEN the poster drags the pin, or taps the map while a pin is set, THE Location_Picker SHALL move the proposed pin to the new point with Pin_Source `pin`, SHALL discard any earlier Confirmed_Pin and SHALL ask the confirmation question again.
4. THE Location_Picker SHALL offer buttons that move the pin one step north, south, east or west, so that a keyboard user can place the pin without dragging.
5. WHEN the poster selects a search result, THE Location_Picker SHALL show the match on the map preview and SHALL ask the confirmation question, as for a candidate.
6. THE Location_Picker SHALL display no latitude or longitude values, and SHALL show the point only as a pin on the map and the Place_Label as text.
7. THE Location_Picker SHALL keep every control at a tap target of at least 44 px by 44 px at a 390 px viewport width.
8. THE Location_Picker SHALL use the MapLibre map style with the darker tan background and dark-red pins that the board uses.

### Requirement 6: Publishing without device location

**User Story:** As a poster, I want to publish without sharing my device location, so that I can post a flyer from anywhere without a permission prompt.

#### Acceptance Criteria

1. WHEN the poster has a Confirmed_Pin, THE Posting_Form SHALL allow publishing with no device location permission requested, granted or denied.
2. WHERE the browser has no geolocation API, THE Location_Picker SHALL still allow search and manual pin placement, and THE Posting_Form SHALL allow publishing.
3. WHEN the poster denies the location permission, or the position request times out or fails, THE Location_Picker SHALL show "We could not get your location. You can search or place the pin on the map." and SHALL keep the existing draft unchanged.
4. IF the poster denied the location permission earlier, THEN THE Location_Picker SHALL keep search, candidates and manual pin placement fully available.
5. THE Posting_Form SHALL show no message that tells the poster to allow location in order to publish.

### Requirement 7: "Use my location" is an optional shortcut

**User Story:** As a poster who is at the venue, I want a "Use my location" button, so that I can drop the pin where I am, and I want a flyer scanned at home never to pin my house.

#### Acceptance Criteria

1. THE Location_Picker SHALL offer a button labeled "Use my location" with the hint "Optional. Only use this if you are at the place now."
2. WHEN the poster taps "Use my location", THE Device_Shortcut SHALL request one device position, and THE Device_Shortcut SHALL be the only code in the posting flow that reads device location.
3. WHEN the device position arrives, THE Location_Picker SHALL move the map and a proposed pin to that point with Pin_Source `device`, SHALL discard any earlier Confirmed_Pin and SHALL ask the confirmation question.
4. WHEN the proposed or confirmed pin has Pin_Source `device`, THE Location_Picker SHALL show "This pin is where you are now. If this is your home, choose private home below."
5. WHEN a flyer is scanned, loaded from `sessionStorage` or restored after a reload, THE Posting_Form SHALL read no device location and SHALL not set a Pin_Source `device` point.
6. WHEN the Device_Shortcut succeeds or fails, THE Posting_Form SHALL leave `localStorage["corkback.mapCenter"]` and the home page's saved radius unchanged.
7. WHEN the Browsing_Location changes on the home page, THE Location_Picker SHALL not use that point as a pin, as a starting centre, or as a candidate.
8. THE Location_Picker SHALL start its map at the confirmed point or the selected match when one exists, and otherwise at a fixed default view that does not depend on device location, the saved centre or the Browsing_Location.
9. THE posting-location modules SHALL import nothing from `boardStorage`, `geoPermission`, `HomeMap` or `nearby`.

### Requirement 8: Location labels by category

**User Story:** As a poster and as a visitor, I want the place described in words that fit the posting, so that an event venue, a listing location and a lost-and-found spot each read correctly.

#### Acceptance Criteria

1. WHERE the category is an event category, or Community with an event date, THE Posting_Form and THE posting detail page SHALL label the place "Event venue".
2. WHERE the category is Community without an event date, THE Posting_Form and THE posting detail page SHALL label the place "Location".
3. WHERE the category is Jobs, Housing and Real Estate, or Sales, THE Posting_Form and THE posting detail page SHALL label the place "Listing location".
4. WHERE the category is Lost and Found, THE Posting_Form SHALL label the place "Where it was lost or found", and THE posting detail page SHALL label it "Lost or found near".
5. WHEN the poster changes the category, THE Posting_Form SHALL update the Location_Label and the hint text and SHALL keep the Location_Draft unchanged.
6. THE label function SHALL return a non-empty Location_Label for every category in `CATEGORIES`, with and without an event date.
7. THE Place_Label field SHALL use the hint "This text is shown to visitors. The pin shows the same place on the map." in place of "This is the text on the flyer, not the map pin."

### Requirement 9: Private homes and the approximate pin

**User Story:** As a poster at a private home, I want to publish an approximate pin, so that visitors find the area without seeing my exact address.

#### Acceptance Criteria

1. THE Location_Picker SHALL offer a checkbox "This place is a private home" for every category.
2. WHEN the poster checks "This place is a private home", THE Location_Picker SHALL compute an Approximate_Pin from the Confirmed_Pin and SHALL show the Approximate_Pin and an approximate-area circle on the map preview.
3. WHEN the Approximate_Pin is shown, THE Location_Picker SHALL show "Visitors will see a pin about a quarter mile (400 m) from this place, not the exact spot. The street address is not shown. Name the area, such as a neighborhood or street, and leave out the house number."
4. THE Approximate_Pin SHALL lie at least 150 m and at most 400 m from the Confirmed_Pin, and SHALL never equal the Confirmed_Pin.
5. WHEN the poster publishes with Precision `approximate`, THE Posting_Form SHALL send the Approximate_Pin as the Pin and SHALL send no exact point.
6. WHILE Precision is `approximate`, THE Posting_Form SHALL keep the same Approximate_Pin while the poster edits other fields, and SHALL compute a new Approximate_Pin only when the poster moves the Confirmed_Pin or checks the box again.
7. WHEN the poster checks the private-home box and the Derived_Label holds a street address, THE Location_Picker SHALL replace the Derived_Label with an area name built from the neighborhood, suburb or town of the match, written as "Near {area}".
8. WHEN the poster unchecks "This place is a private home", THE Location_Picker SHALL return Precision to `exact` and SHALL show the Confirmed_Pin as the Pin.
9. THE Posting_Validator SHALL accept the field `precision` with the values `exact` and `approximate`, and SHALL reject any other value.
10. WHERE a posting has Precision `approximate`, THE posting detail page SHALL show "Approximate location. The exact address is not shown."
11. WHERE a posting has Precision `exact` or `unreviewed`, THE posting detail page SHALL show no approximate-location note.

### Requirement 10: The place text and the pin agree

**User Story:** As a visitor, I want the place name and the pin to describe the same place, so that the name never points one way and the pin another.

#### Acceptance Criteria

1. WHEN the poster selects a Place_Match, THE Location_Picker SHALL fill the Place_Label with the match name and street, and SHALL mark the label as a Derived_Label.
2. WHEN the poster types in the Place_Label, THE Location_Picker SHALL mark the label as typed and SHALL not change it again on its own.
3. WHEN the poster moves the pin more than 100 m from the point of a Derived_Label, THE Location_Picker SHALL clear that label and SHALL show "The pin moved, so the place name was cleared. Add a name for the new spot."
4. WHEN the poster selects a different Place_Match while the label is a Derived_Label, THE Location_Picker SHALL replace the label with the name of the new match.
5. WHEN the poster selects a different Place_Match while the label is typed, THE Location_Picker SHALL keep the typed label and SHALL show "Your place name was kept. Check that it matches the pin."
6. WHEN a posting is published or saved, THE Posting_Validator SHALL store the Place_Label as submitted, trimmed and cut to 140 characters.
7. WHERE Precision is `approximate`, THE Location_Picker SHALL show the "Near {area}" label or the typed label, and SHALL warn through Requirement 11 when the label holds the confirmed street address.

### Requirement 11: Warn about personal details

**User Story:** As a poster, I want a warning when a street address, phone number or email address is in my posting text, so that I do not publish personal details by accident and can still keep public venue or organizer details on purpose.

#### Acceptance Criteria

1. WHEN the title, details or Place_Label contain the normalized text of an Address_Candidate that is not the confirmed public place, THE Posting_Form SHALL show the Personal_Details_Warning that names the address and the field.
2. WHEN the title, details or Place_Label contain a street address pattern that matches no Address_Candidate, THE Posting_Form SHALL show the Personal_Details_Warning, except for the street address of the confirmed place while Precision is `exact`.
3. WHERE Precision is `approximate`, THE Posting_Form SHALL treat the street address of the confirmed place as personal and SHALL show the Personal_Details_Warning when the text contains it.
4. WHILE a Personal_Details_Warning is shown, THE Posting_Form SHALL require the poster to check "I checked this. Anything personal is removed. Public venue or organizer details can stay." before the publish action sends a request.
5. WHEN the poster removes the flagged text, THE Posting_Form SHALL remove the warning and SHALL drop the check requirement.
6. THE Posting_Form SHALL show the warning text "Your posting includes a street address, phone number or email address that may be personal. You can keep public venue or organizer contact details. Remove anything that belongs to a home or a private person."
7. WHEN the title, details or Place_Label contain a phone number or an email address found by the contact detector, THE Posting_Form SHALL show the Personal_Details_Warning that names the field and the kind (phone number or email address), regardless of the confirmed place and of Precision.
8. THE contact detector SHALL not report as a phone number a time such as "7:30", a date such as "2025-06-14" or "06/14/2025", a price such as "$1,250.00", a year such as "2025", a five-digit postcode, or a postcode with four-digit extension such as "94704-1234".
9. THE contact detector SHALL report a phone number written with 10 digits or more in the common separated forms ("510-555-0142", "(510) 555-0142", "510.555.0142", "+1 510 555 0142"), and a seven-digit local number written with a hyphen or dot ("555-0142").
10. THE Posting_Form SHALL show "The flyer photo is not published. Only the text you see here goes public." on the review page.
11. WHERE a posting carries a published flyer image, THE Posting_Form SHALL show "The flyer image shows these addresses: {list}. They stay visible on the image. Crop or hide them first." for every Address_Candidate of kind contact, return or unknown.
12. THE Personal_Details_Warning SHALL warn and require acknowledgement only, and SHALL never change, remove, mask or block the poster's text, including legitimate public venue or organizer addresses, phone numbers and email addresses.

### Requirement 12: Server rules for the pin

**User Story:** As the Owner, I want the server to check every pin it stores, so that a bad request cannot store a wrong or invalid location.

#### Acceptance Criteria

1. WHEN a publish request carries `location`, THE Posting_Validator SHALL require `location.lat` and `location.lng` to be finite numbers with latitude from -90 to 90 and longitude from -180 to 180.
2. THE Posting_Validator SHALL require `location.confirmed` to be the boolean `true` and `location.source` to be one of `flyer_candidate`, `search`, `pin` or `device`.
3. THE Posting_Validator SHALL return the submitted point unchanged as the Pin, with no clamp and no rounding.
4. THE Posting_Validator SHALL compute the time zone from the Pin with `timeZoneForPin`, and the route SHALL store it by the existing rule that keeps only zones the database accepts.
5. THE Posting_Validator SHALL judge past-event and listing-deadline checks in the time zone of the Pin.
6. THE publish route SHALL store `location_precision` with the value from the validated request.
7. THE publish route SHALL store no device position, no Pin_Source and no candidate text.
8. THE domain module SHALL no longer export `clampPinNudge` or `MAX_NUDGE_METERS`, and no application code SHALL call them.
9. IF `location` is present but invalid, THEN THE Posting_Validator SHALL reject the request with the message "The pin position is not valid. Move the pin and try again."

### Requirement 13: Edit the location and keep existing postings unchanged

**User Story:** As an owner of an existing posting, I want to check and correct its location when I choose to, so that an old pin at my house can be fixed and nothing changes until I save.

#### Acceptance Criteria

1. THE migration SHALL change no existing posting row, and the Location_SQL SHALL leave `lat`, `lng`, `place_label`, `time_zone` and every other existing column value unchanged for every existing row.
2. WHEN the owner opens the edit page of a Legacy_Posting, THE Posting_Form SHALL show the current pin on a map and the current Place_Label, and SHALL write nothing until the owner selects "Save changes".
3. WHERE a posting has Precision `unreviewed`, THE edit page SHALL show "This pin was set from where the posting was published. Check that it marks where this takes place."
4. THE edit page SHALL offer "Change location" and SHALL open the Location_Picker with the current pin shown, with no Confirmed_Pin recorded and no device location read.
5. WHEN the owner saves without changing the location, THE edit request SHALL carry no `location` field, and THE edit route SHALL update no `lat`, `lng`, `time_zone` or `location_precision`.
6. WHEN the owner saves a changed location, THE edit route SHALL validate it with the publish rules, SHALL store the new Pin, the Precision and the time zone of the new Pin, and SHALL return an error that names the failed step when the update does not apply.
7. WHEN the owner changes the location, THE edit form SHALL recompute the takedown line with the time zone of the new Pin before saving, and SHALL show the existing note when the posting comes down earlier.
8. THE edit route SHALL judge event dates in the time zone of the new Pin when the owner changes the location, and in the stored time zone otherwise.
9. THE database SHALL allow only the author of an active, visible posting to change its location, through one function, and SHALL grant no direct update of `lat`, `lng` or `time_zone` to clients.
10. WHEN the owner saves a changed location with Precision `approximate`, THE edit route SHALL store the Approximate_Pin that the form sent and SHALL receive no exact point.
11. THE edit page SHALL replace the text "The pin, how long the posting stays on the board, and the flyer image can't be changed. To change them, delete this posting and publish a new one." with text that says the location can be changed and the duration and flyer image cannot.
12. THE database function that changes a location SHALL run as one atomic statement, so that WHEN the function fails, THE posting SHALL keep its previous `lat`, `lng`, `time_zone` and `location_precision` unchanged, with no partial update.
13. IF the content update succeeds and the location update fails, THEN THE edit form SHALL show "Your other changes were saved, but the location was not." with a "Retry" button, SHALL keep the poster's chosen pin and Precision in the Location_Draft, and SHALL not ask the poster to choose the place again.
14. WHEN the poster taps "Retry", THE edit form SHALL send a request that carries only the location block and no content fields, and WHEN that request succeeds THE edit form SHALL show the saved state and remove the Retry button.

### Requirement 14: Corrected copy

**User Story:** As a poster and a visitor, I want the screens to describe the new behavior accurately, so that no text says the posting pins where the poster stands.

#### Acceptance Criteria

1. THE scan page SHALL replace the block "Your permission, your pin" with "Your flyer, your place" and the text "You choose where this takes place on the map. We do not read your location when you scan. Nothing goes public until you select Publish."
2. THE review page SHALL replace the block "Your current pin" with the Location_Picker and SHALL remove the texts "Your flyer pins near where you are, not at a venue read from the paper." and "Pin set near your current location."
3. THE review page SHALL replace the status "Allow your current location to place the pin before publishing." with "Choose where this takes place on the map before publishing."
4. THE review page SHALL replace the Place hint "This is the text on the flyer, not the map pin." with the hint from Requirement 8.7.
5. THE edit page SHALL replace the pin note "The pin stays where it was placed when you published. Your exact location is never shown publicly." with the text from Requirement 13.3 or, for a confirmed posting, "The pin marks where this takes place."
6. THE posting detail page SHALL show the Location_Label from Requirement 8 in front of the Place_Label.
7. THE application code, tests, `DEMO_PLAN.md` and `README.md` SHALL contain none of the phrases "pins where you are", "not at a venue read from the paper", "Pin set near your current location" and "Your flyer pins near where you are".
8. THE posting-location copy SHALL use plain language and SHALL follow `design-tokens.md`: Kalam, one dark-red main action per screen, navy for the other buttons, and 44 px tap targets.

### Requirement 15: Replace the locked location rule

**User Story:** As the Owner, I want the steering rule to match the new behavior, so that future work follows the approved rule.

#### Acceptance Criteria

1. THE steering file `.kiro/steering/location-rules.md` SHALL state that the pin is the location of the event or listing, confirmed or chosen by the poster.
2. THE steering file SHALL state that device location is only an optional shortcut and that an extracted address is a candidate that needs confirmation.
3. THE steering file SHALL keep the Privacy, Alerts and Map sections, and SHALL change only the lines that contradict the new rule.
4. THE test for the retired 150 m clamp in `src/lib/domain.test.ts` and `src/lib/postingInput.test.ts` SHALL be removed and replaced by the properties of this feature.
5. THE frozen oracle `src/lib/__testing__/postingInputBaseline.ts` SHALL stay a test-only copy of the validator before this feature, with its own copy of the clamp, and no application code SHALL import it.

### Requirement 16: Safe release

**User Story:** As the Owner, I want the SQL and the release kept separate and reviewable, so that nothing reaches production before I approve it.

#### Acceptance Criteria

1. THE Location_SQL SHALL be additive only: one new column on `postings`, a re-grant of the insert columns that includes the new column, the function `cb_update_posting_location`, the throttle table and function (`cb_geocoder_throttle`, `cb_geocoder_take_slot`), and the cache table and purge function (`cb_geocoder_cache`, `cb_geocoder_purge_cache`).
2. THE Location_SQL SHALL consist of a preflight, a migration, a verify and a rollback file in the pattern of `supabase/stage11_message_reads*.sql`.
3. THE implementation SHALL apply no SQL to any production database, and SHALL prepare and test the Location_SQL (preflight, migration, role-based verify ending with an `ALL CHECKS PASS` row and a rollback of its own transaction, and rollback) only in the local isolated database under `supabase/isolated-test`.
4. THE implementation SHALL run browser checks only against the Preview_Build with mocked APIs, and SHALL contact no production database and no real geocoder.
5. THE implementation SHALL commit to a new branch `feature/posting-location-confirmation` and SHALL leave `main` unchanged.
6. THE implementation SHALL end with a release checklist that lists the SQL order, the code release, the live checks and the rollback, and SHALL leave the production migration and deployment pending the Owner's review.
7. THE Preview_Build SHALL run in demo mode with the Supabase variables empty, and SHALL stay protected by Vercel Deployment Protection.
8. THE implementation SHALL keep `next-env.d.ts` and `supabase/.temp/` out of every commit.
9. THE implementation SHALL add no runtime dependency and no test dependency to `package.json`.
10. THE implementation SHALL keep demo and test postings in test data only, and SHALL add none to `src/lib/seed.ts` or to any database.

### Requirement 17: Focused tests

**User Story:** As the Owner, I want tests for the risky scenarios, so that I can trust the change.

#### Acceptance Criteria

1. THE test suite SHALL include a scenario "scanning at home": a flyer scanned with a home-looking address and no device position leaves the Location_Draft unconfirmed and publishes nothing.
2. THE test suite SHALL include a scenario "multiple addresses": three candidates produce a list, no pin, and a Confirmed_Pin only from the candidate the poster confirms.
3. THE test suite SHALL include a scenario "no address": an empty candidate list leads to search or manual placement and a successful publish payload.
4. THE test suite SHALL include a scenario "ambiguous matches": matches more than 250 m apart show no pin until one is selected.
5. THE test suite SHALL include a scenario "denied location permission": a denied or failed device request keeps the draft unchanged and publishing still succeeds with a manual pin.
6. THE test suite SHALL include a scenario "corrected pin": a pin dragged after a candidate confirmation discards the confirmed point, clears a stale Derived_Label, blocks publishing until the poster confirms again, and then publishes the dragged point.
7. THE test suite SHALL run at least 100 iterations for each property-based test.
8. THE test suite SHALL include a scenario "location save failure": a failed location update after a successful content update preserves the previous location, keeps the chosen pin in the Location_Draft, shows "Your other changes were saved, but the location was not.", and a retry sends only the location block.
9. THE test suite SHALL include scenarios for contact details: phone numbers and email addresses in the title, details and Place_Label trigger the Personal_Details_Warning, public venue contact details stay unchanged in the text, and times, dates, prices, years and postcodes do not trigger it.
10. THE test suite SHALL include scenarios "search `unavailable`" (geocoder disabled: no upstream request, manual pin publishes) and "query refused" (a query with a phone number or email address sends nothing).
11. THE browser harness SHALL cover the six scenarios at 390 by 844 and 1280 by 800 pixels against the Preview_Build with a mocked geocoder and a stubbed `navigator.geolocation`.

### Requirement 18: Send only the selected address to the geocoder

**User Story:** As a poster, I want only the address I chose to be sent to the map search service, so that my flyer text, phone number and email address stay private.

#### Acceptance Criteria

1. THE Location_Picker SHALL send a lookup only when the poster taps "Find on map" for a candidate or submits the place search form.
2. THE Location_Picker SHALL send as the Geocoder_Query only the text of the selected candidate or the text typed in the search box, trimmed, with runs of whitespace collapsed and cut to 200 characters.
3. THE upstream geocoder request SHALL carry the Geocoder_Query as its only free-text value, together with fixed format parameters, the provider key when configured, the User-Agent and the Referer, and SHALL carry no flyer text, title, details, user id, email address or phone number.
4. IF the Geocoder_Query contains a phone number or an email address found by the contact detector, THEN THE Location_Picker SHALL refuse to send it and THE Geocoder_Service SHALL return HTTP 422 with the state `query_refused`, and neither SHALL make an upstream request.
5. WHEN a query is refused, THE Location_Picker SHALL show "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name." and SHALL leave the search box unchanged so the poster can edit it.
6. THE Geocoder_Service SHALL apply the same trimming, length cap and contact check on the server as on the client, so that a request that bypasses the client is also refused.
7. THE Location_Picker SHALL show "Searching sends only this address text to a public map search service." under the search form and the candidate list.

### Requirement 19: Public Nominatim usage policy

**User Story:** As the Owner, I want the app to follow the Nominatim usage policy, so that the free service is not abused and the app is not blocked.

#### Acceptance Criteria

1. THE Geocoder_Service SHALL send at most 1 upstream request per second across the whole application, counting all server instances, through the Shared_Throttle (Requirement 20).
2. THE Geocoder_Service SHALL store and reuse results in the shared Geocoder_Cache (Requirement 20), and SHALL make no upstream request for a query that has an unexpired cached result.
3. THE Geocoder_Service SHALL send a User-Agent header taken from `GEOCODER_USER_AGENT`, SHALL send a Referer header taken from `GEOCODER_REFERER` or, when that is empty, from `NEXT_PUBLIC_APP_URL`, and SHALL treat a User-Agent without an application name, a version and a contact (an email address or an https URL) as not configured.
4. THE Location_Picker SHALL show the attribution "© OpenStreetMap contributors" as a link to `https://www.openstreetmap.org/copyright` inside the map attribution control and next to the list of search results.
5. THE Location_Picker SHALL send no request while the poster types and SHALL offer no autocomplete.
6. THE Geocoder_Service SHALL read its provider from `GEOCODER_URL`, and WHEN `GEOCODER_URL` names a host other than the Public_Nominatim host THE Geocoder_Service SHALL append `GEOCODER_API_KEY` as the query parameter named by `GEOCODER_API_KEY_PARAM` (default `key`) when the key is set.
7. IF any of the following is true, THEN THE Geocoder_Service SHALL enter the Search_Unavailable_State and make no upstream request: `GEOCODER_USER_AGENT` is missing or invalid; `GEOCODER_CACHE_SECRET` is missing or shorter than 32 characters; `GEOCODER_URL` is not an https URL; `NEXT_PUBLIC_SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` is missing; the Shared_Throttle call fails or is not installed; the Geocoder_Cache read fails.
8. IF the Geocoder_Cache write fails after a successful upstream response, THEN THE Geocoder_Service SHALL still return the results and SHALL log only the error code.
9. WHILE the Geocoder_Service is in the Search_Unavailable_State, THE Location_Picker SHALL keep manual pin placement, "Use my location" and publishing working, and THE Geocoder_Service SHALL return HTTP 503 with the state `unavailable`.
10. THE Geocoder_Service SHALL leave the home page's town search and the alerts town lookup unchanged, and THE design SHALL record that these two direct Nominatim calls are outside the shared throttle.

### Requirement 20: Shared throttle and cache in Supabase

**User Story:** As the Owner, I want the throttle and the cache shared across all server instances and kept private, so that the 1 request per second limit holds on Vercel and a searched home address is not kept longer than needed.

#### Acceptance Criteria

1. THE Location_SQL SHALL provide the function `cb_geocoder_take_slot`(`p_max_wait_ms`) that, in one atomic statement, reserves the next upstream slot and returns the slot time and the wait in milliseconds, or returns no row when the wait would exceed `p_max_wait_ms`.
2. WHEN concurrent callers invoke `cb_geocoder_take_slot`, THE function SHALL grant slots at least 1000 ms apart, and SHALL leave a spacing of 1100 ms between consecutive slots to absorb network jitter.
3. WHEN the Shared_Throttle returns no row, THE Geocoder_Service SHALL answer the state `busy` and SHALL not wait longer than 3000 ms for a granted slot.
4. THE Geocoder_Cache SHALL key each row by the hex HMAC-SHA256 of the normalized Geocoder_Query and the provider host, computed with the server secret `GEOCODER_CACHE_SECRET`, and SHALL never store the plain query.
5. THE Geocoder_Cache SHALL store the normalized results, an expiry no later than 24 hours after creation (enforced by a table constraint), and no user id, no email address and no other identifying value.
6. THE Geocoder_Service SHALL ignore an expired row and SHALL delete expired rows through `cb_geocoder_purge_cache`, called after each cache write and by the hourly expiry sweep.
7. THE throttle and cache objects SHALL have row level security enabled with no policies, SHALL grant all privileges and execute rights to `service_role` only, and SHALL revoke every privilege from `PUBLIC`, `anon` and `authenticated`.
8. THE Geocoder_Service SHALL reach the Shared_Throttle and the Geocoder_Cache only with the server-side service role key, and SHALL never expose that key to the browser.

