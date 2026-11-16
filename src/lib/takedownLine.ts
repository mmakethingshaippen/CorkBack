import { FALLBACK_TIME_ZONE, isValidTimeZone } from "./lifecycle";
import { takedownInfo, type TakedownReason } from "./postingKinds";

/**
 * The "Comes down on {date}: {reason}" line shared by the review form and the
 * edit form (Requirement 10.4, 10.6: same wording and rules). Pure.
 */

/** Shown under the line wherever the exact time depends on the pin's zone. */
export const TAKEDOWN_ZONE_NOTE = "The exact time uses your pin's time zone.";

export const TAKEDOWN_REASON_TEXT: Record<TakedownReason, string> = {
  expiry: "the time you chose to keep it on the board ends",
  deadline: "your deadline passes",
  event_end: "the event ends",
};

export interface TakedownLineInput {
  categorySlug: string;
  /** The expiry instant (now + chosen preset in the review form; stored value in the edit form). */
  expiresAt: Date | string;
  /** Listings: leave null and pass the Deadline as endDate. */
  eventDate?: string | null;
  endDate?: string | null;
  endTime?: string | null;
  /** The pin's IANA zone, or null/undefined before a pin exists (calendar dates in UTC-12 are then shown). */
  timeZone?: string | null;
}

export interface TakedownLine {
  at: Date;
  reason: TakedownReason;
  /** e.g. "Comes down on Friday, December 5, 2025: the event ends" */
  text: string;
}

export function formatTakedownDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(at);
}

export function takedownLine(p: TakedownLineInput): TakedownLine {
  const zone = isValidTimeZone(p.timeZone) ? p.timeZone : null;
  const info = takedownInfo({
    categorySlug: p.categorySlug,
    expiresAt: typeof p.expiresAt === "string" ? p.expiresAt : p.expiresAt.toISOString(),
    eventDate: p.eventDate ?? null,
    endDate: p.endDate ?? null,
    endTime: p.endTime ?? null,
    timeZone: zone,
    lat: 0,
    lng: 0,
  });
  const date = formatTakedownDate(info.at, zone ?? FALLBACK_TIME_ZONE);
  return { at: info.at, reason: info.reason, text: `Comes down on ${date}: ${TAKEDOWN_REASON_TEXT[info.reason]}` };
}
