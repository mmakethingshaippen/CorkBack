import tzlookup from "@photostructure/tz-lookup";

/**
 * Posting lifecycle: ONE rule for when a posting ends, used by the map, profiles,
 * feeds, direct posting URLs, and the reaction APIs. The database mirrors the
 * same rule in `public.posting_takedown_at` (supabase/stage6_social_part1.sql).
 *
 * A posting ends at the EARLIER of:
 *   1. its expiry preset (`expires_at`), and
 *   2. its event end, in the posting's IANA time zone:
 *      - an explicit end (end_date and/or end_time) when present, otherwise
 *      - the end of the event day (23:59:59.999 local time).
 *
 * Time zone: ONLY the IANA zone stored on the posting (`time_zone`, computed
 * from the pin at publish). The app and the database must agree at the same
 * instant, so neither side looks anything up at read time:
 *   - stored zone passes ZONE_NAME_RE and the runtime accepts it -> use it
 *   - otherwise (null, malformed, unknown) -> FALLBACK_TIME_ZONE
 * The database applies the identical rule in public.cb_safe_time_zone.
 *
 * Fallback: `Etc/GMT+12` (UTC−12), the last zone on Earth where any calendar
 * day ends, so a posting never ends EARLY because its zone is unknown. It can
 * end late: up to 4 h for a California pin, up to 26 h in the worst case.
 * Postings published before Stage 6 have no stored zone and use the fallback
 * until a separately reviewed backfill sets `time_zone`.
 */

export const FALLBACK_TIME_ZONE = "Etc/GMT+12";

/** Same pattern as the database's cb_safe_time_zone. */
export const ZONE_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;

export interface LifecycleFields {
  expiresAt: string;
  eventDate: string | null;
  endDate?: string | null;
  endTime?: string | null;
  timeZone?: string | null;
  lat: number;
  lng: number;
  deletedAt?: string | null;
}

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !ZONE_NAME_RE.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** IANA zone for a pin, or null if the lookup fails. Used at PUBLISH only. */
export function timeZoneForPin(lat: number, lng: number): string | null {
  try {
    const tz = tzlookup(lat, lng);
    return isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

/**
 * The zone the lifecycle rule uses for a posting, and whether it fell back.
 * Stored zone only: the pin is deliberately NOT consulted here (see top).
 */
export function resolveTimeZone(p: Pick<LifecycleFields, "timeZone">): {
  timeZone: string;
  fallback: boolean;
} {
  if (isValidTimeZone(p.timeZone)) return { timeZone: p.timeZone, fallback: false };
  return { timeZone: FALLBACK_TIME_ZONE, fallback: true };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

/** "HH:MM" or "HH:MM:SS" (24-hour). */
export function isClockTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/** Offset (ms) of `tz` from UTC at the given instant. */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(new Date(utcMs))) parts[p.type] = p.value;
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Convert a wall-clock time in `tz` to an instant. */
export function wallTimeToInstant(
  date: string,
  time: { h: number; m: number; s: number; ms: number },
  tz: string,
): Date {
  const m = DATE_RE.exec(date);
  if (!m) throw new Error("Invalid date");
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], time.h, time.m, time.s, time.ms);
  let guess = wall - tzOffsetMs(wall, tz);
  guess = wall - tzOffsetMs(guess, tz); // second pass settles DST transitions
  return new Date(guess);
}

const END_OF_DAY = { h: 23, m: 59, s: 59, ms: 999 };

function parseClock(s: string): { h: number; m: number; s: number; ms: number } {
  const m = TIME_RE.exec(s)!;
  return { h: +m[1], m: +m[2], s: m[3] ? +m[3] : 0, ms: 0 };
}

/** Event end instant, or null when the posting has no event date. */
export function eventEnd(p: LifecycleFields): Date | null {
  const date = p.endDate || p.eventDate;
  if (!date || !isIsoDate(date)) return null;
  const { timeZone } = resolveTimeZone(p);
  const hasExplicitEnd = Boolean(p.endDate) || Boolean(p.endTime);
  const time = hasExplicitEnd && p.endTime && isClockTime(p.endTime) ? parseClock(p.endTime) : END_OF_DAY;
  return wallTimeToInstant(date, time, timeZone);
}

/** When the posting comes down: the earlier of expiry and the event end. */
export function postingTakedown(p: LifecycleFields): Date {
  const expires = new Date(p.expiresAt);
  const end = eventEnd(p);
  return end && end.getTime() < expires.getTime() ? end : expires;
}

export function isPostingActive(p: LifecycleFields, now: Date = new Date()): boolean {
  if (p.deletedAt) return false;
  return now.getTime() < postingTakedown(p).getTime();
}

/** Calendar date ("YYYY-MM-DD") of an instant in `tz`. */
export function localDate(now: Date, tz: string): string {
  const parts: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now)) {
    parts[p.type] = p.value;
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}
