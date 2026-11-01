---
inclusion: always
---

# Location Rules — CorkBack

## Where a posting is pinned

- A posting is pinned **where the poster actually is**, not at a venue read from the paper.
- A short nudge to the exact board or venue is allowed.
- The pin must **stay near the real location** (bounded offset — covered by a property-based test in a later stage).

## Privacy

- The user's exact location is **never shown publicly**.
- Location is requested before publishing so the flyer pins where the poster is.

## Alerts (defined here, built in Stage 2)

- Radius email alerts by category, with a home town or a point on the map.
- Radius from 1 mile to 25 miles, or a whole town.

## Map

- Real interactive map (MapLibre, free tiles). Never Figma map fragments.
- Local maps use a darker tan background so white roads and red pins pop.
- Pins are dark red.
