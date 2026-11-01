# CorkBack — Demo Video Plan (draft, not yet recorded)

Target length: **under 3:00**. One continuous screen recording with voiceover. No third-party trademarks, no copyrighted music. Record on the live Vercel URL once deployed. Show the scan flow end to end and the map, plus alerts, messaging, and the promoted label.

## Shot list and timing (total ~2:50)

1. **Open — public map, no account (0:00–0:25)**
   - Land on the live home page signed out. Pan the interactive map; show posting pins and the "On your doorstep" rail (London / Berlin / Mexico City sample postings).
   - Open one posting page (no login wall). Point out title, date, time, place, category, poster @handle.
   - VO: "CorkBack turns paper flyers into a public local map. Anyone can browse with no account."

2. **Scan flow end to end (0:25–1:15)** — the required highlight
   - Sign in (email). Tap **Scan a flyer** (dark-red main action).
   - Capture/choose the test flyer. Show the server extraction returning structured fields.
   - Review screen: title, date, time, place, category, optional RSVP, expiry preset, "use my current location" pin block. Edit one field to show it is editable.
   - Tap **Publish to the map**. Land on the new posting page; show the new pin on the map.
   - VO: "A photo of a flyer becomes a structured posting. You review every field before anything goes public, and it pins where you are."

3. **Alerts (1:15–1:45)**
   - Go to **Set an alert**. Create one: a category, a home point (town), a radius (or whole town).
   - Show the alert in the list. VO: "Radius email alerts. When a matching posting appears nearby, you get one email. Your home point and radius stay private."
   - (Optional B-roll: the Resend dashboard showing a delivered alert email — only if a verified sender is configured by record time.)

4. **Messaging (1:45–2:15)**
   - From a posting page, tap **Message @poster**. Send a private message.
   - Open the **Inbox**, open the thread, reply. VO: "Private 1:1 messages with the poster. Only the two of you can read the thread — it never shows on the board."

5. **Promoted label (2:15–2:40)**
   - On your own posting, tap **Promote**. Return to the home rail: show the **Promoted** label and the posting sitting first in its area and category.
   - VO: "A poster can promote their own posting — a label and top placement in its area and category, while it is live. No payment."

6. **Close (2:40–2:50)**
   - Back to the map. VO: "CorkBack — the world, posted locally. Built with Kiro."

## Recording checklist
- Use the live Vercel URL (set `NEXT_PUBLIC_APP_URL` first so links in any shown email are correct).
- Use only sample/seed content or real flyer content you supply — no invented businesses/people.
- Remove any test accounts/threads/postings created during the take before the final cut, or use the seed sample content.
- Keep under 3:00. Upload to YouTube, set to public.
