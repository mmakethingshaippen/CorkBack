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
  /** Optional explicit end (local to the posting's time zone). */
  endDate?: string | null; // ISO date
  endTime?: string | null; // "HH:MM" or "HH:MM:SS"
  /** IANA zone stored at publish; older postings have none (looked up from the pin). */
  timeZone?: string | null;
  placeLabel: string;
  lat: number;
  lng: number;
  expiry: ExpiryPreset;
  expiresAt: string; // ISO datetime
  isPromoted: boolean;
  authorUsername: string;
  /** Aggregate counts only. Who liked / who plans to go is never part of a posting. */
  likeCount: number;
  goingCount: number;
  interestedCount: number;
  createdAt: string;
  /** Whether the CURRENT viewer liked it (their own saved like; never anyone else's). Absent when signed out. */
  viewerLiked?: boolean;
  /** The CURRENT viewer's own Going/Interested choice (never anyone else's). Absent when signed out. */
  viewerPlan?: PlanKind | null;
  /** Server time the viewer state and counts were read (ISO); see src/lib/likeStore.ts. */
  viewerStateAt?: string;
}

export type PlanKind = "going" | "interested";

export interface ReactionCounts {
  likes: number;
  going: number;
  interested: number;
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
  /**
   * True only when the flyer itself prints the year. When false or missing, the
   * year was guessed and the review form makes the poster confirm the full date.
   */
  eventDateYearPrinted?: boolean;
}
