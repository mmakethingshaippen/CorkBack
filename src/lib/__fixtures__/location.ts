/**
 * Test-only fixtures for the posting location confirmation work
 * (Requirements 16.10, 17.1 to 17.4).
 *
 * Only `*.test.ts` files may import this module (enforced by
 * src/lib/fixtureGuard.test.ts). Never insert these into Supabase and never
 * add them to src/lib/seed.ts. Every id starts with `fx-`.
 *
 * The shapes are declared structurally here so this file imports no
 * production module and cannot drift into the app bundle.
 */

export interface FxLatLng {
  lat: number;
  lng: number;
}

export type FxCandidateKind = "venue" | "contact" | "return" | "other" | "unknown";

export interface FxAddressCandidate {
  text: string;
  kind: FxCandidateKind;
}

export interface FxPlaceMatch {
  id: string;
  name: string;
  addressLine: string;
  area: string;
  displayName: string;
  point: FxLatLng;
  level: "address" | "area";
}

export interface FxFlyer {
  id: string;
  title: string;
  placeLabel: string;
  addresses: FxAddressCandidate[];
}

export const FIXTURE_ID_PREFIX = "fx-";

/** Fixed reference point (Berkeley, CA). */
export const FX_ORIGIN: FxLatLng = { lat: 37.8715, lng: -122.273 };

/** A flyer whose only address looks like a private home. */
export const FX_FLYER_HOME: FxFlyer = {
  id: "fx-flyer-home",
  title: "Garage sale this Saturday",
  placeLabel: "Home",
  addresses: [{ text: "1427 Elm Street, Berkeley, CA 94704", kind: "unknown" }],
};

/** A flyer with a venue, a contact and a return address. */
export const FX_FLYER_THREE: FxFlyer = {
  id: "fx-flyer-three",
  title: "Spring bake sale",
  placeLabel: "Maple Hall",
  addresses: [
    { text: "200 Maple Avenue, Berkeley, CA 94710", kind: "venue" },
    { text: "PO Box 55, Oakland, CA 94601", kind: "contact" },
    { text: "88 Return Lane, Albany, CA 94706", kind: "return" },
  ],
};

/** A flyer with no address at all. */
export const FX_FLYER_NONE: FxFlyer = {
  id: "fx-flyer-none",
  title: "Lost tabby cat",
  placeLabel: "",
  addresses: [],
};

/** Two matches about 3 km apart (ambiguous). */
export const FX_MATCHES_AMBIGUOUS: FxPlaceMatch[] = [
  {
    id: "fx-node-1001",
    name: "Central Library",
    addressLine: "100 Main Street",
    area: "Downtown",
    displayName: "Central Library, 100 Main Street, Downtown",
    point: { lat: 37.8715, lng: -122.273 },
    level: "address",
  },
  {
    id: "fx-node-1002",
    name: "Central Library",
    addressLine: "100 Main Street",
    area: "Northside",
    displayName: "Central Library, 100 Main Street, Northside",
    point: { lat: 37.8985, lng: -122.273 },
    level: "address",
  },
];

/** Two matches about 40 m apart (not ambiguous). */
export const FX_MATCHES_CLOSE: FxPlaceMatch[] = [
  {
    id: "fx-node-2001",
    name: "Corner Cafe",
    addressLine: "5 Oak Street",
    area: "Midtown",
    displayName: "Corner Cafe, 5 Oak Street, Midtown",
    point: { lat: 37.8715, lng: -122.273 },
    level: "address",
  },
  {
    id: "fx-node-2002",
    name: "Corner Cafe Patio",
    addressLine: "5 Oak Street",
    area: "Midtown",
    displayName: "Corner Cafe Patio, 5 Oak Street, Midtown",
    point: { lat: 37.87186, lng: -122.273 },
    level: "address",
  },
];

/** An area-level match (a town or neighbourhood, no street). */
export const FX_MATCH_AREA: FxPlaceMatch = {
  id: "fx-relation-3001",
  name: "Riverton",
  addressLine: "",
  area: "Riverton",
  displayName: "Riverton, Example County",
  point: { lat: 37.9, lng: -122.3 },
  level: "area",
};

/** A street-level match with an address line and an area. */
export const FX_MATCH_STREET: FxPlaceMatch = {
  id: "fx-way-4001",
  name: "Maple Hall",
  addressLine: "200 Maple Avenue",
  area: "Westside",
  displayName: "Maple Hall, 200 Maple Avenue, Westside",
  point: { lat: 37.88, lng: -122.28 },
  level: "address",
};

/** Phone numbers and email addresses in the forms the detector must find. */
export const FX_CONTACT_STRINGS: string[] = [
  "510-555-0142",
  "(510) 555-0142",
  "510.555.0142",
  "510 555 0142",
  "+1 510 555 0142",
  "+1-510-555-0142",
  "5105550142",
  "call 510-555-0142 after 5",
  "jane.doe@example.com",
  "fx_user+tag@mail.example.org",
  "write to fx@example.net today",
];

/** Strings that look like contact details but are not. */
export const FX_LOOKALIKE_STRINGS: string[] = [
  "7:30",
  "7:30 pm",
  "2025-06-14",
  "06/14/2025",
  "June 14, 2025",
  "$1,250.00",
  "$5",
  "2025",
  "94704",
  "94704-1234",
  "Doors open at 6:00, tickets $15",
  "Saturday 10-2",
];
