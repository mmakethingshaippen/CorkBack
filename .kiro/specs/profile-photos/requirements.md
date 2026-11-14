# Requirements Document

## Introduction

Profile photos let each CorkBack user add, change or remove one photo on their own profile at `/u/[username]`. The photo appears through one shared Avatar component wherever a user's @handle appears (including message threads and the admin queue), with an initial-letter fallback when there is no photo or the image fails to load. Only the account owner can change or remove their own photo. All writes go through a server route that derives the user from the verified session, rate-limits the attempt, validates the image, re-encodes it as a metadata-free 512 px WebP, and records the stored path through a service-role-only database function. Removing a photo clears the path through a second service-role-only function. Clients cannot write the photo column or the Storage bucket directly.

Two database additions (`cb_clear_avatar`, and the `avatar_uploads` ledger with `cb_avatar_rate_check`) are drafted in this spec and are NOT applied. They require user review before anyone applies them.

The theme, design tokens, Kalam typography, the account model (username is the only public name, email stays private), username editing, the password-reset flow, and all existing accounts, postings, replies, threads and messages are preserved. Out of scope: cropping or editing tools, GIF or animated avatars, admin changes to other users' photos, social-login avatars, and photo moderation (a possible follow-up only).

EARS phrasing. Roles: **owner** (the signed-in user viewing their own profile), **other user** (signed in, viewing someone else's profile), **admin** (an other user with moderation access), **signed-out visitor**.

## Glossary

- **CorkBack**: The Next.js 15 App Router web application deployed at corkback.vercel.app.
- **Profile_Page**: The page at `/u/[username]` showing a user's handle and postings.
- **Owner**: The signed-in user whose verified session user id equals the profile row id (the existing `isSelf` check: `viewer.id === profile.id`).
- **Seed_Profile**: A demo profile whose id starts with `seed-`.
- **Photo_Control**: The "Add profile photo" / "Change profile photo" control on the Profile_Page.
- **Avatar**: The shared UI component that renders a user's profile photo or the Fallback_Avatar.
- **Fallback_Avatar**: A white circle with a deep-navy border showing the first letter of the username.
- **Avatar_Route**: The server route `POST /api/profile/avatar` that accepts a photo upload for the session user.
- **Session_User**: The user returned by `supabase.auth.getUser()` on the server for the current request.
- **Avatar_Path**: The value of `profiles.avatar_path`, of the form `<user uuid>/<uuid>.(jpg|png|webp)`; null means no photo.
- **Avatars_Bucket**: The public-read Supabase Storage bucket `avatars`.
- **Set_Avatar_Function**: The database function `public.cb_set_avatar(p_user uuid, p_path text)`, SECURITY DEFINER, executable by `service_role` only.
- **Allowed_Format**: JPEG, PNG or WebP.
- **Size_Limit**: 2 MiB (2,097,152 bytes).
- **Image_Processor**: The server-side `sharp` library, pinned exactly to version 0.35.5.
- **Max_Input_Pixels**: 50,000,000 decoded pixels (about 8192 by 6144), applied through the Image_Processor `limitInputPixels` option. This value is a proposal held in one constant and the project owner can adjust it.
- **Min_Input_Dimension**: 32 pixels, the smallest accepted width and height.
- **Output_Size**: 512 by 512 pixels, the bounding box for the stored photo.
- **Client_Roles**: The Postgres roles `anon` and `authenticated`.
- **Remove_Control**: The "Remove photo" control on the Profile_Page.
- **Clear_Avatar_Function**: The pending database function `public.cb_clear_avatar(p_user uuid) returns text`, SECURITY DEFINER, executable by `service_role` only, which sets Avatar_Path to null and returns the previous Avatar_Path.
- **Avatar_Ledger**: The pending table `public.avatar_uploads` recording one row per upload attempt that reaches processing.
- **Rate_Check_Function**: The pending database function `public.cb_avatar_rate_check(p_user uuid) returns void`, SECURITY DEFINER, executable by `service_role` only.
- **Attempt_Limits**: At most 5 upload attempts per user in 10 minutes and at most 20 per user in 24 hours.

## Requirements

### Requirement 1: Owner-only photo control

**User Story:** As a signed-in user, I want to add or change a photo on my own profile, so that neighbours can recognise me beside my username.

#### Acceptance Criteria

1. WHILE the Session_User is the Owner of a non-Seed_Profile, THE Profile_Page SHALL show the Photo_Control labelled "Add profile photo" when Avatar_Path is null and "Change profile photo" when Avatar_Path is set.
2. WHILE the viewer is a signed-out visitor or an other user, THE Profile_Page SHALL render the profile without the Photo_Control.
3. WHILE the viewer is an admin viewing a profile that the admin does not own, THE Profile_Page SHALL render the profile without the Photo_Control.
4. WHILE the profile is a Seed_Profile, THE Profile_Page SHALL render the profile without the Photo_Control.
5. WHILE an upload is in progress, THE Photo_Control SHALL show upload progress and SHALL ignore further submissions until the upload finishes.
6. WHEN an upload succeeds, THE Photo_Control SHALL show a success state and THE Profile_Page SHALL display the new photo.
7. IF an upload fails, THEN THE Photo_Control SHALL show a specific error message naming the cause (unsupported format, file over 2 MB, unreadable image, image too large in pixels, image too small, too many attempts, not signed in, service unavailable, or a server failure) and SHALL keep the current photo displayed.
8. THE Photo_Control SHALL use navy or neutral styling as a secondary control, SHALL be operable by keyboard with visible focus, SHALL announce progress and results in an aria-live region, and SHALL be usable at 390 px and 1280 px widths.
9. THE Photo_Control SHALL use design tokens and SHALL add no dark-red main action to the Profile_Page.

### Requirement 2: Accepted formats and size

**User Story:** As the project owner, I want only small, standard image formats accepted, so that storage stays bounded and unsafe file types never reach users.

#### Acceptance Criteria

1. WHEN the Owner selects a file, THE Photo_Control SHALL reject, before uploading, any file whose type is not an Allowed_Format or whose size exceeds the Size_Limit, and SHALL show the matching error message.
2. WHEN the Avatar_Route receives a file whose declared type is not an Allowed_Format, THE Avatar_Route SHALL reject the request with a 4xx status and an unsupported-format message.
3. WHEN the Avatar_Route receives a file larger than the Size_Limit, THE Avatar_Route SHALL reject the request with a 4xx status and a file-too-large message.
4. WHEN the Avatar_Route receives a file, THE Avatar_Route SHALL determine the real format from the file bytes with the Image_Processor and SHALL reject the file with a 4xx status when the real format is not an Allowed_Format, including GIF and SVG.
5. IF the Image_Processor cannot decode the file, THEN THE Avatar_Route SHALL reject the request with a 4xx status and an unreadable-image message.
6. THE Avatars_Bucket SHALL enforce the Size_Limit and an allowed MIME list of `image/jpeg`, `image/png` and `image/webp`.
7. THE Set_Avatar_Function SHALL reject an object whose stored MIME type is missing, blank or outside the allowed MIME list.
8. THE Set_Avatar_Function SHALL reject an object whose stored size is missing, non-numeric, zero or greater than the Size_Limit.
9. IF the decoded image exceeds Max_Input_Pixels, THEN THE Avatar_Route SHALL reject the request with status 422 and a message naming the pixel limit, and SHALL NOT downscale the image automatically.
10. IF the decoded image is smaller than Min_Input_Dimension in width or height, THEN THE Avatar_Route SHALL reject the request with status 422 and a too-small message.
11. THE Avatar_Route SHALL check the Size_Limit before decoding any image.

### Requirement 3: Metadata stripping and re-encoding

**User Story:** As a user, I want location data removed from my photo, so that my exact location is never public.

#### Acceptance Criteria

1. WHEN the Avatar_Route accepts an image, THE Avatar_Route SHALL re-encode the image with the Image_Processor before storing the image.
2. THE Avatar_Route SHALL store re-encoded images that contain no EXIF metadata, including no GPS data.
3. THE Avatar_Route SHALL store every re-encoded image as WebP with content type `image/webp` and a size no greater than the Size_Limit.
4. THE Avatar_Route SHALL apply the EXIF orientation of the input before removing metadata.
5. THE Avatar_Route SHALL resize each image to fit inside the Output_Size, preserving aspect ratio, without upscaling an image already smaller than the Output_Size.
6. WHEN the input is an animated image, THE Avatar_Route SHALL encode the first frame only.
7. FOR ALL accepted inputs, THE stored image dimensions SHALL be no greater than the Output_Size in either dimension (invariant).

### Requirement 4: Session-derived identity on the server

**User Story:** As a user, I want my photo to be changeable only by me, so that nobody can impersonate me with a different picture.

#### Acceptance Criteria

1. IF a request reaches the Avatar_Route without a valid session, THEN THE Avatar_Route SHALL respond with status 401 and SHALL leave Storage and the database unchanged.
2. THE Avatar_Route SHALL derive the target user exclusively from the Session_User.
3. WHEN a request to the Avatar_Route carries a user id, username or storage path in the body, query string or headers, THE Avatar_Route SHALL ignore those values and SHALL write only to the Session_User's profile and Storage folder.
4. THE Avatar_Route SHALL build the object path as `<Session_User id>/<random uuid>.webp`.
5. THE CorkBack server code SHALL keep the service-role credential in server-only modules and SHALL expose the service-role credential through no `NEXT_PUBLIC_` variable.

### Requirement 5: Database protection of the photo column

**User Story:** As the project owner, I want the database to refuse direct photo changes, so that cross-account changes fail even if the interface is bypassed.

#### Acceptance Criteria

1. THE `profiles` table SHALL have a nullable `avatar_path` text column, where null means no photo.
2. THE `profiles` table SHALL enforce a check constraint that a non-null Avatar_Path matches `<uuid>/<uuid>.(jpg|png|webp)` and that the first path segment equals the row's id.
3. IF a Client_Role attempts to insert or update `avatar_path` directly through the database API, THEN THE database SHALL refuse the write.
4. THE database SHALL keep `authenticated` able to insert `(id, username)` on `profiles` for the `/welcome` signup path and able to update `username`.
5. IF a Client_Role calls the Set_Avatar_Function, THEN THE database SHALL refuse the call.
6. WHEN the Set_Avatar_Function is called with a path whose first segment differs from `p_user`, THE Set_Avatar_Function SHALL reject the call and leave the profile unchanged.
7. WHEN the Set_Avatar_Function is called with a path that has no matching object in the Avatars_Bucket, THE Set_Avatar_Function SHALL reject the call and leave the profile unchanged.
8. WHEN the Set_Avatar_Function accepts a call, THE Set_Avatar_Function SHALL lock the profile row, set Avatar_Path to the new path, and return the previous Avatar_Path.

### Requirement 6: Storage protection

**User Story:** As the project owner, I want the photo bucket to refuse direct client writes, so that no user can upload into, overwrite or delete another user's folder.

#### Acceptance Criteria

1. THE Avatars_Bucket SHALL allow public read of stored photos.
2. IF a Client_Role attempts to insert an object in the Avatars_Bucket, THEN THE Storage service SHALL refuse the insert through a restrictive policy.
3. IF a Client_Role attempts to update an object in the Avatars_Bucket, THEN THE Storage service SHALL refuse the update through a restrictive policy.
4. IF a Client_Role attempts to delete an object in the Avatars_Bucket, THEN THE Storage service SHALL refuse the delete through a restrictive policy.

### Requirement 7: Replacement, cleanup and persistence

**User Story:** As a user, I want a new photo to replace my old one cleanly, so that the right photo shows after refresh and old files do not pile up.

#### Acceptance Criteria

1. WHEN the Avatar_Route stores a photo, THE Avatar_Route SHALL use a new unique filename so that the public URL differs from every previous photo URL for that user.
2. WHEN the Set_Avatar_Function succeeds and returns a previous Avatar_Path, THE Avatar_Route SHALL delete the previous object through the Storage API.
3. IF validation or the Set_Avatar_Function fails after the new object was uploaded, THEN THE Avatar_Route SHALL delete the newly uploaded object through the Storage API and SHALL leave the current Avatar_Path and current photo unchanged.
4. IF an upload fails at any step, THEN THE CorkBack system SHALL keep the user's current photo stored and displayed.
5. WHEN the Owner refreshes any page after a successful upload, THE Avatar SHALL show the new photo.
6. WHEN the Avatar_Route has replaced a photo, THE Avatar_Route SHALL delete, through the Storage API, objects in the Session_User's folder that are not the current Avatar_Path and are older than 10 minutes.
7. THE Avatar_Route SHALL upload each object with upsert disabled and a long-lived immutable Cache-Control header.

### Requirement 8: Consistent display with fallback

**User Story:** As a visitor, I want to see the same photo beside a user's handle everywhere, so that I can recognise people across the board.

#### Acceptance Criteria

1. THE CorkBack system SHALL render user photos through one shared Avatar component on the Profile_Page, posting cards, the posting detail page, replies, the Following list, the Friends page (friends, requests, search results and attendance), the posting attendance lists, the inbox list, the message thread header, the admin queue and posting detail, and every other place that renders PosterHandle.
2. WHEN a user has an Avatar_Path, THE Avatar SHALL display the photo from the Avatars_Bucket public URL.
3. WHEN a user has no Avatar_Path, THE Avatar SHALL display the Fallback_Avatar.
4. IF the photo fails to load, THEN THE Avatar SHALL display the Fallback_Avatar.
5. THE Avatar SHALL use alt text containing the username and SHALL show no name other than the username.
6. THE Avatar SHALL reveal no email address and no exact location.
7. THE Avatar SHALL keep posting cards, replies and lists usable at 390 px width with no overlap or horizontal scrolling.
8. WHILE a user is signed in, THE top bar profile icon SHALL show the viewer's Avatar.
9. THE CorkBack system SHALL build every photo URL from one helper using `NEXT_PUBLIC_SUPABASE_URL` and the Avatar_Path.

### Requirement 9: Rollback

**User Story:** As the project owner, I want a safe rollback, so that I can back out the change without losing photos or widening access.

#### Acceptance Criteria

1. THE CorkBack repository SHALL provide a separate rollback SQL file for the profile-photo database changes.
2. THE rollback SQL file SHALL keep stored photos, the Avatars_Bucket and the `avatar_path` column.
3. THE rollback SQL file SHALL leave `avatar_path` unwritable by Client_Roles.
4. THE rollback SQL for the pending additions SHALL drop only the Clear_Avatar_Function and the Rate_Check_Function and SHALL keep Avatar_Ledger rows.

### Requirement 10: Regression

**User Story:** As an existing user, I want my account and username editing to keep working, so that the new feature does not break anything I already use.

#### Acceptance Criteria

1. WHEN the Owner edits their username after the profile-photo changes are applied, THE Profile_Page SHALL save the new username as it did before.
2. WHEN a new user completes `/welcome` after the profile-photo changes are applied, THE CorkBack system SHALL create the profile row with id and username.
3. THE profile-photo database changes SHALL be additive and safe for the currently deployed code.

### Requirement 11: Verification before any claim

**User Story:** As the project owner, I want the feature proven on real accounts, so that I only ship what has been shown to work.

#### Acceptance Criteria

1. THE CorkBack test suite SHALL include automated Avatar_Route tests for: signed-out request returning 401; an authenticated request carrying another user's id in body, query or headers writing only to the Session_User's profile and folder; and rejection of an invalid type, an oversized file and an undecodable file.
2. WHERE an isolated local database is available, THE verification SHALL test the column grants, the Set_Avatar_Function, the Clear_Avatar_Function and the Rate_Check_Function behaviour in that database.
3. THE live verification SHALL use two disposable accounts and check first upload, replacement, removal, invalid file types, oversized files, fallback display, persistence after refresh, avatar consistency across the listed pages, and mobile layout at 390 px.
4. THE live verification SHALL confirm that the second account cannot alter the first account's photo through the interface, through a REST `profiles` PATCH of `avatar_path`, through an RPC call to `cb_set_avatar` or `cb_clear_avatar`, or through Storage upload, overwrite or delete in the first account's folder.
5. THE live verification SHALL include a username-editing regression check.
6. THE verification SHALL record each check in BUILD_LOG.md as pass, fail or untested, with no credentials, tokens, emails or passwords.
7. THE CorkBack project SHALL be deployed with these changes only after explicit approval from the project owner.
8. THE CorkBack test suite SHALL include a sharp fixture test proving that a JPEG with GPS EXIF yields stored output with no EXIF.
9. THE live verification of the Rate_Check_Function and the Clear_Avatar_Function SHALL stay untested until the project owner has reviewed and applied the pending SQL.

### Requirement 12: Remove photo

**User Story:** As a signed-in user, I want to remove my photo, so that my profile returns to the initial-letter avatar.

#### Acceptance Criteria

1. WHILE the Session_User is the Owner of a non-Seed_Profile and Avatar_Path is set, THE Profile_Page SHALL show the Remove_Control.
2. WHILE Avatar_Path is null, THE Profile_Page SHALL render without the Remove_Control.
3. WHILE the viewer is a signed-out visitor, an other user or an admin viewing a profile the admin does not own, THE Profile_Page SHALL render without the Remove_Control.
4. WHEN the Owner activates the Remove_Control, THE Avatar_Route SHALL handle `DELETE /api/profile/avatar` and SHALL derive the target user exclusively from the Session_User.
5. IF a `DELETE` request reaches the Avatar_Route without a valid session, THEN THE Avatar_Route SHALL respond with status 401 and SHALL leave Storage and the database unchanged.
6. WHEN the Avatar_Route removes a photo, THE Avatar_Route SHALL call the Clear_Avatar_Function, which SHALL lock the profile row, set Avatar_Path to null and return the previous Avatar_Path.
7. IF a Client_Role calls the Clear_Avatar_Function, THEN THE database SHALL refuse the call.
8. WHEN the Clear_Avatar_Function succeeds and returns a previous Avatar_Path, THE Avatar_Route SHALL delete the previous object through the Storage API.
9. WHEN removal succeeds, THE Avatar SHALL display the Fallback_Avatar and SHALL keep displaying it after a refresh.
10. IF removal fails, THEN THE Remove_Control SHALL show an error message and THE Avatar SHALL keep the current photo.

### Requirement 13: Upload rate limit

**User Story:** As the project owner, I want upload attempts limited per user on the server, so that nobody can burn image-processing capacity.

#### Acceptance Criteria

1. WHEN an authenticated upload request reaches processing, THE Avatar_Route SHALL call the Rate_Check_Function before decoding the image.
2. THE Rate_Check_Function SHALL take a per-user advisory lock and SHALL count Avatar_Ledger rows for that user inside the lock.
3. IF the user has 5 or more ledger rows in the previous 10 minutes or 20 or more in the previous 24 hours, THEN THE Rate_Check_Function SHALL raise error code `CB429`.
4. IF the counts are below the Attempt_Limits, THEN THE Rate_Check_Function SHALL insert one ledger row.
5. THE Avatar_Route SHALL count every attempt that passes authentication and reaches processing, including attempts that later fail.
6. IF the Rate_Check_Function raises `CB429`, THEN THE Avatar_Route SHALL respond with status 429, a clear message and a `Retry-After` header.
7. IF the Rate_Check_Function is unavailable or raises any other error, THEN THE Avatar_Route SHALL respond with status 503 and a clear message and SHALL NOT process the image.
8. THE Rate_Check_Function SHALL be executable by `service_role` only, and Client_Roles SHALL hold no privilege on the Avatar_Ledger.
9. THE Remove_Control request SHALL require authentication and SHALL consume no Avatar_Ledger allowance.
