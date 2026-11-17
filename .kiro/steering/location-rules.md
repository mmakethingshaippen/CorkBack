---
inclusion: always
---

# Location Rules — CorkBack

## Where a posting is pinned

- A posting is pinned **where the event or listing takes place**, as confirmed or chosen by the poster.
- An address read from a flyer is only a **candidate**. It can be a home, a return address or other personal information. It never becomes the pin until the poster confirms it ("Is this where the event or listing takes place?").
- If the address is missing, ambiguous or wrong, the poster searches for a place or places the pin on the map by hand.
- Device location is an **optional shortcut** ("Use my location"), used only when the poster taps it. Publishing works without it, and scanning a flyer never reads it.
- For a private home the poster can publish an **approximate pin** (150 to 400 m from the true spot, computed in the browser) and is told what visitors will see. The exact point is never sent to the server.
- The place label and the pin describe the same place. The location label fits the category: event venue, listing location, or where an item was lost or found.
- The old rule (pin where the poster actually is, within a 150 m bounded nudge) is retired. Existing postings keep their pins until their owners edit and save them.

## Privacy

- The user's exact location is **never shown publicly**. A device position becomes public only if the poster confirms it as the pin, and a private home can use an approximate pin instead.
- Location is never requested automatically in the posting flow. The home page's browsing location is a separate feature and stays separate.

## Alerts (defined here, built in Stage 2)

- Radius email alerts by category, with a home town or a point on the map.
- Radius from 1 mile to 25 miles, or a whole town.

## Map

- Real interactive map (MapLibre, free tiles). Never Figma map fragments.
- Local maps use a darker tan background so white roads and red pins pop.
- Pins are dark red.
