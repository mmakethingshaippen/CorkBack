// Browser-test fixtures for the board harness. TEST DATA ONLY: never insert these
// into Supabase and never add them to src/lib/seed.ts. Every id starts with "fx-".

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

export const BERKELEY = { lat: 37.8715, lng: -122.273 };
export const RICHMOND = { lat: 37.9358, lng: -122.3478 };

/** Value seeded into localStorage["corkback.mapCenter"]. */
export const SAVED_CENTER = { ...BERKELEY, zoom: 13, town: "Berkeley" };

/** Position the stubbed navigator.geolocation reports (Berkeley, 20 m accuracy). */
export const STUB_POSITION = { latitude: BERKELEY.lat, longitude: BERKELEY.lng, accuracy: 20 };

const base = {
  body: "Fixture posting for browser tests.",
  flyerUrl: null,
  rsvpUrl: null,
  eventDate: null,
  eventTime: null,
  expiry: "1m",
  expiresAt: "2099-01-01T00:00:00.000Z",
  isPromoted: false,
  authorUsername: "fx_poster",
  likeCount: 0,
  goingCount: 0,
  interestedCount: 0,
  createdAt: "2026-11-01T10:00:00.000Z",
};

export const FX_POSTINGS = [
  { ...base, id: "fx-berkeley-music", title: "FX Berkeley music night", categorySlug: "music", placeLabel: "Berkeley (fixture)", ...BERKELEY },
  { ...base, id: "fx-berkeley-lost", title: "FX Lost cat Berkeley", categorySlug: "lost-found", placeLabel: "Berkeley (fixture)", lat: 37.8725, lng: -122.268 },
  { ...base, id: "fx-richmond-market", title: "FX Richmond market", categorySlug: "community", placeLabel: "Richmond (fixture)", ...RICHMOND },
];

/** Body for a mocked GET /api/postings/map response. */
export function mapResponse(items = FX_POSTINGS, truncated = false) {
  return { items, truncated };
}

/** A 1x1 transparent PNG, served for every map tile request. */
export const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
