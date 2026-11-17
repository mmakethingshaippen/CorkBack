import { eventEnd, postingTakedown, type LifecycleFields } from "./lifecycle";

/**
 * Posting kinds (pure, no server-only imports). One constant per kind, so
 * moving a category between kinds is a one-line change. Unknown slugs are events.
 */
export type PostingKind = "event" | "listing" | "event-optional";

export const LISTING_SLUGS = ["jobs", "housing", "sale", "lost-found"] as const;
export const EVENT_OPTIONAL_SLUGS = ["community"] as const;

export function categoryKind(slug: string): PostingKind {
  if ((LISTING_SLUGS as readonly string[]).includes(slug)) return "listing";
  if ((EVENT_OPTIONAL_SLUGS as readonly string[]).includes(slug)) return "event-optional";
  return "event";
}

export interface FieldSpec {
  kind: PostingKind;
  /** Event date, time, end date and end time are shown (event, event-optional). */
  showsEventFields: boolean;
  /** The event date is not required to submit (event-optional and listing). */
  eventDateOptional: boolean;
  deadlineLabel: string | null;
  deadlineHint: string | null;
  /** Card and alert email prefix, e.g. "Apply by". */
  cardPrefix: string | null;
  actionLabel: string;
  actionHint: string;
  actionButton: string;
}

const LISTING_SPECS: Record<
  (typeof LISTING_SLUGS)[number],
  { deadlineLabel: string; cardPrefix: string; actionLabel: string; actionButton: string; deadlineHint: string }
> = {
  jobs: {
    deadlineLabel: "Apply by (optional)",
    cardPrefix: "Apply by",
    actionLabel: "Application link (optional)",
    actionButton: "Apply",
    deadlineHint: "The last day to apply. Your posting comes down after it.",
  },
  housing: {
    deadlineLabel: "Available until (optional)",
    cardPrefix: "Available until",
    actionLabel: "Listing or contact link (optional)",
    actionButton: "View listing",
    deadlineHint: "The last day this is available. Your posting comes down after it.",
  },
  sale: {
    deadlineLabel: "Offer ends (optional)",
    cardPrefix: "Offer ends",
    actionLabel: "Listing link (optional)",
    actionButton: "View listing",
    deadlineHint: "The last day of the offer. Your posting comes down after it.",
  },
  "lost-found": {
    deadlineLabel: "Keep this up until (optional)",
    cardPrefix: "Keep up until",
    actionLabel: "Contact link (optional)",
    actionButton: "Contact",
    deadlineHint: "The last day to keep this posted. Your posting comes down after it.",
  },
};

/** hasEventDate matters only for event-optional: "RSVP" with a date, "Learn more" without. */
export function fieldSpec(slug: string, opts?: { hasEventDate?: boolean }): FieldSpec {
  const kind = categoryKind(slug);
  if (kind === "listing") {
    const l = LISTING_SPECS[slug as (typeof LISTING_SLUGS)[number]];
    return {
      kind,
      showsEventFields: false,
      eventDateOptional: true,
      deadlineLabel: l.deadlineLabel,
      deadlineHint: l.deadlineHint,
      cardPrefix: l.cardPrefix,
      actionLabel: l.actionLabel,
      actionHint: "One link, starting with http:// or https://.",
      actionButton: l.actionButton,
    };
  }
  if (kind === "event-optional") {
    return {
      kind,
      showsEventFields: true,
      eventDateOptional: true,
      deadlineLabel: null,
      deadlineHint: null,
      cardPrefix: null,
      actionLabel: "Link (optional)",
      actionHint: "One link, starting with http:// or https://.",
      actionButton: opts?.hasEventDate ? "RSVP" : "Learn more",
    };
  }
  return {
    kind,
    showsEventFields: true,
    eventDateOptional: false,
    deadlineLabel: null,
    deadlineHint: null,
    cardPrefix: null,
    actionLabel: "RSVP link (optional)",
    actionHint: "One link, starting with http:// or https://.",
    actionButton: "RSVP",
  };
}

export interface LocationLabels {
  /** Label on the posting form. */
  field: string;
  /** Label in front of the place on the posting detail page. */
  detail: string;
  hint: string;
}

const LOCATION_HINT = "This text is shown to visitors. The pin shows the same place on the map.";

/** Category-specific wording for the place. Unknown slugs are events. */
export function locationLabels(slug: string, opts: { hasEventDate: boolean }): LocationLabels {
  const hint = LOCATION_HINT;
  if (slug === "lost-found") {
    return { field: "Where it was lost or found", detail: "Lost or found near", hint };
  }
  const kind = categoryKind(slug);
  if (kind === "listing") return { field: "Listing location", detail: "Listing location", hint };
  if (kind === "event-optional" && !opts.hasEventDate) {
    return { field: "Location", detail: "Location", hint };
  }
  return { field: "Event venue", detail: "Event venue", hint };
}

export type TakedownReason = "expiry" | "deadline" | "event_end";
export interface TakedownInfo {
  at: Date;
  reason: TakedownReason;
}

/** Same rule as postingTakedown, plus which side won. Ties name "expiry". */
export function takedownInfo(p: LifecycleFields & { categorySlug: string }): TakedownInfo {
  const at = postingTakedown(p);
  const end = eventEnd(p);
  if (end && end.getTime() < new Date(p.expiresAt).getTime()) {
    return { at, reason: categoryKind(p.categorySlug) === "listing" ? "deadline" : "event_end" };
  }
  return { at, reason: "expiry" };
}
