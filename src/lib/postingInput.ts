import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS, clampPinNudge, computeExpiresAt, type ExpiryPreset } from "./domain";

export interface ValidatedPosting {
  title: string;
  body: string;
  categorySlug: string;
  rsvpUrl: string | null;
  eventDate: string | null;
  eventTime: string | null;
  placeLabel: string;
  expiry: ExpiryPreset;
  expiresAt: Date;
  /** Bounded pin. The poster's raw location is never part of this result. */
  pin: { lat: number; lng: number };
}

export type ValidationResult =
  | { ok: true; value: ValidatedPosting }
  | { ok: false; error: string };

const isCoord = (c: unknown): c is { lat: number; lng: number } => {
  if (!c || typeof c !== "object") return false;
  const { lat, lng } = c as Record<string, unknown>;
  return (
    typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    typeof lng === "number" && Number.isFinite(lng) && lng >= -180 && lng <= 180
  );
};

/**
 * Validate a publish request body. Pure, so the rules (exactly one category,
 * at most one RSVP link, expiry presets, bounded pin) are unit-testable.
 */
export function validatePostingInput(b: unknown, now: Date): ValidationResult {
  if (!b || typeof b !== "object") return { ok: false, error: "Invalid request." };
  const r = b as Record<string, unknown>;

  if (typeof r.expiry !== "string" || !EXPIRY_PRESETS.includes(r.expiry as ExpiryPreset)) {
    return { ok: false, error: "Invalid expiry preset." };
  }
  const expiry = r.expiry as ExpiryPreset;

  // Exactly one category: a single known slug string (arrays etc. are rejected).
  const category = typeof r.categorySlug === "string"
    ? CATEGORIES.find((c) => c.slug === r.categorySlug)
    : undefined;
  if (!category) return { ok: false, error: "Choose exactly one valid category." };

  if (typeof r.title !== "string" || !r.title.trim()) {
    return { ok: false, error: "Title is required." };
  }
  if (!isCoord(r.real)) {
    return { ok: false, error: "Your current location is required to pin the posting." };
  }
  if (r.desired != null && !isCoord(r.desired)) {
    return { ok: false, error: "Invalid pin position." };
  }

  // At most one RSVP link: a single http(s) URL string, or nothing.
  let rsvpUrl: string | null = null;
  if (r.rsvpUrl != null && r.rsvpUrl !== "") {
    if (typeof r.rsvpUrl !== "string") return { ok: false, error: "Only one RSVP link is allowed." };
    const trimmed = r.rsvpUrl.trim();
    try {
      const u = new URL(trimmed);
      if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
    } catch {
      return { ok: false, error: "RSVP link must be a valid http(s) URL." };
    }
    if (/\s/.test(trimmed)) return { ok: false, error: "Only one RSVP link is allowed." };
    rsvpUrl = trimmed;
  }

  let eventDate: string | null = null;
  if (r.eventDate != null && r.eventDate !== "") {
    if (typeof r.eventDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(r.eventDate) || Number.isNaN(Date.parse(r.eventDate))) {
      return { ok: false, error: "Event date must be YYYY-MM-DD." };
    }
    eventDate = r.eventDate;
  }

  const real = r.real as { lat: number; lng: number };
  const desired = (r.desired as { lat: number; lng: number } | null | undefined) ?? real;

  return {
    ok: true,
    value: {
      title: r.title.trim().slice(0, 140),
      body: typeof r.body === "string" ? r.body : "",
      categorySlug: category.slug,
      rsvpUrl,
      eventDate,
      eventTime: typeof r.eventTime === "string" && r.eventTime ? r.eventTime : null,
      placeLabel: typeof r.placeLabel === "string" ? r.placeLabel : "",
      expiry,
      expiresAt: computeExpiresAt(now, expiry),
      pin: clampPinNudge(real, desired),
    },
  };
}
