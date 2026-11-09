import type { Posting } from "./types";

/**
 * Seed postings = real SAMPLE content modeled on the Figma posting examples
 * (London concert, Berlin lost cat, Mexico City market). Used as a live,
 * no-credentials fallback so the map and posting pages render, and as the
 * Stage 5 seed. Coordinates are approximate public neighbourhood points, not
 * real device locations. No invented businesses/people/contact details: handles
 * and places are the Figma sample identities, and no placeholder URLs are
 * shipped (rsvpUrl is null unless a real link is supplied). To add real
 * campus-board postings, replace/extend this list with real flyer content.
 */
export const SEED_POSTINGS: Posting[] = [
  {
    id: "london-quiet-sounds",
    title: "An evening of quiet sounds",
    body: "An intimate evening of acoustic music and careful listening beneath the chapel arches. Tickets £12. Ages 18+. Step-free access via the side entrance; message the poster about access.",
    categorySlug: "music",
    flyerUrl: null,
    rsvpUrl: null,
    eventDate: "2026-11-13",
    eventTime: "19:30",
    placeLabel: "Union Chapel, Compton Terrace, London N1 2UN",
    lat: 51.5465,
    lng: -0.1035,
    expiry: "1m",
    expiresAt: "2026-12-01T00:00:00.000Z",
    isPromoted: false,
    authorUsername: "northlondonnotes",
    likeCount: 38,
    goingCount: 0,
    interestedCount: 0,
    createdAt: "2026-10-28T10:00:00.000Z",
  },
  {
    id: "berlin-miso-missing",
    title: "Miso is missing",
    body: "Grey tabby, white chin, red collar. Last seen near Kollwitzplatz, Prenzlauer Berg. Shy and may be hiding in a courtyard or cellar. Please message with any sightings: street, time, and a photo if you can.",
    categorySlug: "lost-found",
    flyerUrl: null,
    rsvpUrl: null,
    eventDate: null,
    eventTime: null,
    placeLabel: "Near Kollwitzplatz, 10405 Berlin, Germany",
    lat: 52.5376,
    lng: 13.4188,
    expiry: "2w",
    expiresAt: "2026-11-24T00:00:00.000Z",
    isPromoted: false,
    authorUsername: "lenahoffmann",
    likeCount: 17,
    goingCount: 0,
    interestedCount: 0,
    createdAt: "2026-10-24T18:00:00.000Z",
  },
  {
    id: "mexico-mercado-barrio",
    title: "Mercado del barrio",
    body: "Puestos de vecinos, comida casera y música. El mejor tianguis del Piso Río de Janeiro, Roma. Entrada libre.",
    categorySlug: "community",
    flyerUrl: null,
    rsvpUrl: null,
    eventDate: "2026-11-15",
    eventTime: "10:00",
    placeLabel: "Plaza Río de Janeiro, Mexico City",
    lat: 19.4185,
    lng: -99.1618,
    expiry: "1w",
    expiresAt: "2026-11-16T00:00:00.000Z",
    isPromoted: false,
    authorUsername: "colectivoroma",
    likeCount: 24,
    goingCount: 0,
    interestedCount: 0,
    createdAt: "2026-11-01T09:00:00.000Z",
  },
];

export function findSeedPosting(id: string): Posting | undefined {
  return SEED_POSTINGS.find((p) => p.id === id);
}
