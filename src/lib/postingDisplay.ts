import { resolveTimeZone, type LifecycleFields } from "./lifecycle";
import { fieldSpec, takedownInfo, type TakedownReason } from "./postingKinds";

/** Pure display helpers for the detail page and the card (no server imports). */

/** A calendar date ("YYYY-MM-DD") formatted without any time zone shift. */
export function formatDateOnly(d: string, opts: Intl.DateTimeFormatOptions): string {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export const TAKEDOWN_REASON_TEXT: Record<TakedownReason, string> = {
  expiry: "expiry",
  deadline: "deadline",
  event_end: "event ends",
};

/** "On the board until {date} ({reason})", with the date in the posting's stored time zone. */
export function onBoardUntilLine(p: LifecycleFields & { categorySlug: string }): string {
  const info = takedownInfo(p);
  const { timeZone } = resolveTimeZone(p);
  const date = info.at.toLocaleDateString("en-US", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return `On the board until ${date} (${TAKEDOWN_REASON_TEXT[info.reason]})`;
}

/**
 * The card's date text, or null for no date line. A listing with a Deadline reads "{prefix} {date}".
 * Otherwise the stored event date shows as before (legacy listings keep it). No date, no line.
 */
export function cardDateLabel(p: {
  categorySlug: string;
  eventDate: string | null;
  endDate?: string | null;
}): string | null {
  const spec = fieldSpec(p.categorySlug);
  const short: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  if (spec.kind === "listing" && p.endDate && spec.cardPrefix) {
    return `${spec.cardPrefix} ${formatDateOnly(p.endDate, short)}`;
  }
  return p.eventDate ? formatDateOnly(p.eventDate, short) : null;
}
