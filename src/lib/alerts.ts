import { haversineMeters } from "./domain";
import { isPostingActive } from "./lifecycle";

/**
 * Stage 2 — radius email alert matching. Pure, DB-free, testable.
 *
 * An alert matches a posting when ALL hold:
 *  - same category (alert.categorySlug === posting.categorySlug),
 *  - the posting pin is within the alert radius of the alert home point
 *    (or the alert is "whole town" → radius is unbounded by distance, matched
 *    by town rather than miles; see note below),
 *  - the posting is active (not expired, not past-event, not deleted),
 *  - the posting is not hidden by the alert owner,
 *  - the alert owner is NOT the poster (no self-notification).
 *
 * Privacy: the alert's home point and radius are never exposed to anyone but
 * the owner. These functions only decide match/no-match; they never surface the
 * alert's center or radius to a posting, the board, or another user's email.
 */

const METERS_PER_MILE = 1609.344;

export interface AlertRule {
  id: string;
  ownerId: string;
  categorySlug: string;
  centerLat: number;
  centerLng: number;
  /** null = "whole town" (no mile radius); otherwise 1..25 miles. */
  radiusMiles: number | null;
  /** Present when the home point was chosen as a town. */
  townName?: string | null;
}

export interface PostingForMatch {
  id: string;
  authorId: string;
  categorySlug: string;
  lat: number;
  lng: number;
  /** Already-active check is done by the caller for DB efficiency, but we also
   *  accept the fields to allow a pure end-to-end match in tests. */
  expiresAt: string;
  eventDate: string | null;
  endDate?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
  deletedAt: string | null;
}

/** Distance in miles between an alert home point and a posting pin. */
export function distanceMiles(alert: AlertRule, posting: { lat: number; lng: number }): number {
  return haversineMeters(
    { lat: alert.centerLat, lng: alert.centerLng },
    { lat: posting.lat, lng: posting.lng },
  ) / METERS_PER_MILE;
}

/**
 * Is the posting inside the alert's radius?
 * - A mile radius matches when distance <= radiusMiles.
 * - A "whole town" alert (radiusMiles === null) matches by town. Since postings
 *   do not carry a town code, we approximate a whole town with a generous cap so
 *   a town-wide alert still fires for postings in that town's vicinity. This cap
 *   is a matching detail only and is never shown to anyone.
 */
export const WHOLE_TOWN_CAP_MILES = 25;

export function withinRadius(alert: AlertRule, posting: { lat: number; lng: number }): boolean {
  const d = distanceMiles(alert, posting);
  const limit = alert.radiusMiles ?? WHOLE_TOWN_CAP_MILES;
  return d <= limit;
}

/**
 * Full match decision between one alert and one posting.
 * `hidden` = the alert owner has hidden this posting.
 * `now` lets tests pin time; defaults to current time.
 */
export function alertMatchesPosting(
  alert: AlertRule,
  posting: PostingForMatch,
  opts: { hidden?: boolean; now?: Date } = {},
): boolean {
  const now = opts.now ?? new Date();

  // No self-notification.
  if (alert.ownerId === posting.authorId) return false;

  // Category must match exactly (one category per alert).
  if (alert.categorySlug !== posting.categorySlug) return false;

  // Hidden postings never notify their hider.
  if (opts.hidden) return false;

  // Active: the shared lifecycle rule (expiry, event end in the posting's zone).
  if (!isPostingActive(posting, now)) return false;

  // Within the radius.
  if (!withinRadius(alert, posting)) return false;

  return true;
}
