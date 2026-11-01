import type { ExpiryPreset } from "./domain";

/** A posting as surfaced to the public map and posting page. */
export interface Posting {
  id: string;
  title: string;
  body: string;
  categorySlug: string;
  flyerUrl: string | null;
  rsvpUrl: string | null;
  eventDate: string | null; // ISO date
  eventTime: string | null;
  placeLabel: string;
  lat: number;
  lng: number;
  expiry: ExpiryPreset;
  expiresAt: string; // ISO datetime
  isPromoted: boolean;
  authorUsername: string;
  likeCount: number;
  createdAt: string;
}

/** Structured fields returned by server-side Gemini flyer extraction. */
export interface ExtractedFlyer {
  title: string;
  eventDate: string | null;
  eventTime: string | null;
  placeLabel: string;
  categorySlug: string;
  rsvpUrl: string | null;
  body: string;
}
