// Browser-test fixtures for the posting location harness. TEST DATA ONLY: never insert these
// into Supabase and never add them to src/lib/seed.ts. Every id starts with "fx-".
// Mirrors src/lib/__fixtures__/location.ts (which only vitest files may import).

export const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

export const BERKELEY = { lat: 37.8715, lng: -122.273 };
/** A saved HOME browsing centre far from every fixture match (the picker must ignore it). */
export const SAVED_BOARD_CENTER = { lat: 40.7128, lng: -74.006, zoom: 12, town: "New York" };
/** What the stubbed navigator.geolocation reports when granted (never a fixture match). */
export const STUB_POSITION = { latitude: 37.8044, longitude: -122.2712, accuracy: 20 };

// ---------------------------------------------------------------- flyers (response of /api/scan/extract)
const flyerBase = {
  eventDate: null,
  eventTime: null,
  categorySlug: "community",
  rsvpUrl: null,
  body: "Fixture flyer for browser tests.",
  eventDateYearPrinted: false,
};

export const FX_FLYER_HOME = {
  ...flyerBase,
  title: "Garage sale this Saturday",
  placeLabel: "Home",
  addresses: [{ text: "1427 Elm Street, Berkeley, CA 94704", kind: "unknown" }],
};
export const FX_FLYER_THREE = {
  ...flyerBase,
  title: "Spring bake sale",
  placeLabel: "Maple Hall",
  addresses: [
    { text: "200 Maple Avenue, Berkeley, CA 94710", kind: "venue" },
    { text: "PO Box 55, Oakland, CA 94601", kind: "contact" },
    { text: "88 Return Lane, Albany, CA 94706", kind: "return" },
  ],
};
export const FX_FLYER_NONE = { ...flyerBase, title: "Lost tabby cat", categorySlug: "lost-found", placeLabel: "", addresses: [] };

// ---------------------------------------------------------------- geocoder matches (response of /api/geocode)
export const FX_MATCH_STREET = {
  id: "fx-way-4001",
  name: "Maple Hall",
  addressLine: "200 Maple Avenue",
  area: "Westside",
  displayName: "Maple Hall, 200 Maple Avenue, Westside",
  point: { lat: 37.88, lng: -122.28 },
  level: "address",
};
/** Two matches about 3 km apart (ambiguous). */
export const FX_MATCHES_AMBIGUOUS = [
  { id: "fx-node-1001", name: "Central Library", addressLine: "100 Main Street", area: "Downtown", displayName: "Central Library, 100 Main Street, Downtown", point: { lat: 37.8715, lng: -122.273 }, level: "address" },
  { id: "fx-node-1002", name: "Central Library", addressLine: "100 Main Street", area: "Northside", displayName: "Central Library, 100 Main Street, Northside", point: { lat: 37.8985, lng: -122.273 }, level: "address" },
];

/** Canned geocoder answers: [status, body]. */
export const GEOCODE_ANSWERS = {
  street: [200, { state: "ok", matches: [FX_MATCH_STREET] }],
  ambiguous: [200, { state: "ok", matches: FX_MATCHES_AMBIGUOUS }],
  empty: [200, { state: "ok", matches: [] }],
  busy: [429, { state: "busy", error: "Place search is busy. Try again in a moment." }],
  badGateway: [502, { state: "unavailable", error: "Place search is unavailable right now." }],
  unavailable: [503, { state: "unavailable", error: "Place search is unavailable right now." }],
  refused: [422, { state: "query_refused", error: "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name." }],
};

// ---------------------------------------------------------------- canned posting-route answers
export const POSTING_ANSWERS = {
  postOk: [200, { id: "fx-posting-new" }],
  patchOk: [200, { id: "fx-posting-1" }],
  locationFailed: [500, { error: "Your other changes were saved, but the location was not.", code: "location_failed" }],
  retryOk: [200, { id: "fx-posting-1" }],
  retryFailed: [500, { error: "The location was not saved. Try again.", code: "location_failed" }],
};

/** Phone numbers, emails and look-alikes (mirrors the vitest fixtures). */
export const FX_CONTACT_STRINGS = ["510-555-0142", "(510) 555-0142", "+1 510 555 0142", "jane.doe@example.com"];
export const FX_LOOKALIKE_STRINGS = ["7:30", "2025-06-14", "06/14/2025", "$1,250.00", "2025", "94704", "94704-1234"];

/** A 1x1 transparent PNG, served for every map tile request. */
export const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
