import { CATEGORIES } from "./categories";
import { EXPIRY_PRESETS, computeExpiresAt, type ExpiryPreset } from "./domain";
import { FALLBACK_TIME_ZONE, eventEnd, isClockTime, isIsoDate, localDate, timeZoneForPin } from "./lifecycle";
import { categoryKind } from "./postingKinds";

const isBlank = (v: unknown) => v == null || v === "";

/**
 * Listing branch: only an optional `deadline`, stored as endDate. Shared by publish and edit.
 * `tz` is the posting's own zone. Returns the deadline (or null) or an error.
 */
function checkListingDeadline(
  r: Record<string, unknown>,
  tz: string | null,
  now: Date,
): { ok: true; deadline: string | null } | { ok: false; error: string } {
  if (!isBlank(r.eventDate) || !isBlank(r.eventTime) || !isBlank(r.endTime)) {
    return { ok: false, error: "Listings use a deadline instead of an event date." };
  }
  if (isBlank(r.deadline)) return { ok: true, deadline: null };
  if (!isIsoDate(r.deadline)) return { ok: false, error: "Deadline must be a date in the format YYYY-MM-DD." };
  if (r.dateNeedsConfirmation === true && r.dateConfirmed !== true) {
    return {
      ok: false,
      error: "The flyer did not show a year. Check the full event date, including the year, and confirm it.",
    };
  }
  if (r.deadline < localDate(now, tz ?? FALLBACK_TIME_ZONE)) {
    return { ok: false, error: "This deadline has already passed." };
  }
  return { ok: true, deadline: r.deadline };
}

/** Community branch pre-checks, shared by publish and edit. Event rules then apply as for events. */
function checkCommunityFields(
  r: Record<string, unknown>,
  eventDate: string | null,
  endDate: string | null,
  endTime: string | null,
): string | null {
  if (!isBlank(r.deadline)) return "Community postings use an event date, not a deadline.";
  if (!eventDate && (endDate || endTime || !isBlank(r.eventTime))) {
    return "Add an event date first, or clear the time fields.";
  }
  return null;
}

export interface ValidatedPosting {
  title: string;
  body: string;
  categorySlug: string;
  rsvpUrl: string | null;
  eventDate: string | null;
  eventTime: string | null;
  endDate: string | null;
  /** "HH:MM", local to the posting's time zone. */
  endTime: string | null;
  /** IANA zone from the pin; null if lookup failed (lifecycle falls back to UTC−12). */
  timeZone: string | null;
  placeLabel: string;
  expiry: ExpiryPreset;
  expiresAt: Date;
  /** The confirmed pin, exactly as submitted. */
  pin: { lat: number; lng: number };
  /** "approximate" when the poster published a private-home pin. */
  precision: "exact" | "approximate";
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

const PIN_SOURCES = ["flyer_candidate", "search", "pin", "device"] as const;

/**
 * Check the `location` block of a publish request: a confirmed, in-range point with a known
 * source and precision. The retired `real` and `desired` fields are rejected.
 */
export function validateLocationBlock(
  r: Record<string, unknown>,
): { ok: true; pin: { lat: number; lng: number }; precision: "exact" | "approximate" } | { ok: false; error: string } {
  const loc = r.location;
  if (loc == null) {
    if (r.real != null || r.desired != null) {
      return { ok: false, error: "Reload the page and choose where this takes place." };
    }
    return { ok: false, error: "Choose where this takes place on the map before publishing." };
  }
  const bad = { ok: false as const, error: "The pin position is not valid. Move the pin and try again." };
  if (typeof loc !== "object" || Array.isArray(loc)) return bad;
  const l = loc as Record<string, unknown>;
  if (l.confirmed !== true) {
    return { ok: false, error: "Choose where this takes place on the map before publishing." };
  }
  const { source, precision } = l;
  if (!isCoord(l)) return bad;
  if (typeof source !== "string" || !(PIN_SOURCES as readonly string[]).includes(source)) return bad;
  if (precision !== "exact" && precision !== "approximate") return bad;
  return { ok: true, pin: { lat: l.lat, lng: l.lng }, precision };
}

/**
 * Validate a publish request body. Pure, so the rules (exactly one category,
 * at most one RSVP link, expiry presets, confirmed pin) are unit-testable.
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
  const loc = validateLocationBlock(r);
  if (!loc.ok) return loc;
  const pin = loc.pin;
  const precision = loc.precision;
  const timeZone = timeZoneForPin(pin.lat, pin.lng);

  const rsvp = parseRsvpUrl(r.rsvpUrl);
  if (!rsvp.ok) return rsvp;
  const rsvpUrl = rsvp.value;

  const kind = categoryKind(category.slug);
  if (kind === "listing") {
    const d = checkListingDeadline(r, timeZone, now);
    if (!d.ok) return d;
    return {
      ok: true,
      value: {
        title: r.title.trim().slice(0, 140),
        body: typeof r.body === "string" ? r.body : "",
        categorySlug: category.slug,
        rsvpUrl,
        eventDate: null,
        eventTime: null,
        endDate: d.deadline,
        endTime: null,
        timeZone,
        placeLabel: typeof r.placeLabel === "string" ? r.placeLabel : "",
        expiry,
        expiresAt: computeExpiresAt(now, expiry),
        pin,
        precision,
      },
    };
  }

  let eventDate: string | null = null;
  if (r.eventDate != null && r.eventDate !== "") {
    if (!isIsoDate(r.eventDate)) {
      return { ok: false, error: "Event date must be YYYY-MM-DD." };
    }
    eventDate = r.eventDate;
  }

  // A scanned date whose year was not printed must be confirmed by the poster.
  if (eventDate && r.dateNeedsConfirmation === true && r.dateConfirmed !== true) {
    return {
      ok: false,
      error: "The flyer did not show a year. Check the full event date, including the year, and confirm it.",
    };
  }

  let endDate: string | null = null;
  if (r.endDate != null && r.endDate !== "") {
    if (!isIsoDate(r.endDate)) return { ok: false, error: "End date must be YYYY-MM-DD." };
    endDate = r.endDate;
  }
  let endTime: string | null = null;
  if (r.endTime != null && r.endTime !== "") {
    if (!isClockTime(r.endTime)) return { ok: false, error: "End time must be HH:MM (24-hour)." };
    endTime = r.endTime.slice(0, 5);
  }
  if (kind === "event-optional") {
    const e = checkCommunityFields(r, eventDate, endDate, endTime);
    if (e) return { ok: false, error: e };
  }
  if ((endDate || endTime) && !eventDate) {
    return { ok: false, error: "Add the event date before an end date or time." };
  }
  if (endDate && eventDate && endDate < eventDate) {
    return { ok: false, error: "The end date is before the event date." };
  }

  const expiresAt = computeExpiresAt(now, expiry);

  // Reject past events, judged in the posting's own time zone.
  if (eventDate) {
    const today = localDate(now, timeZone ?? FALLBACK_TIME_ZONE);
    if (eventDate < today && !(endDate && endDate >= today)) {
      return {
        ok: false,
        error: "This event date has already passed. Check the date, including the year.",
      };
    }
    const end = eventEnd({ expiresAt: expiresAt.toISOString(), eventDate, endDate, endTime, timeZone, ...pin });
    if (end && end.getTime() <= now.getTime()) {
      return { ok: false, error: "This event has already ended. Check the end date and time." };
    }
  }

  return {
    ok: true,
    value: {
      title: r.title.trim().slice(0, 140),
      body: typeof r.body === "string" ? r.body : "",
      categorySlug: category.slug,
      rsvpUrl,
      eventDate,
      eventTime: typeof r.eventTime === "string" && r.eventTime ? r.eventTime : null,
      endDate,
      endTime,
      timeZone,
      placeLabel: typeof r.placeLabel === "string" ? r.placeLabel : "",
      expiry,
      expiresAt,
      pin,
      precision,
    },
  };
}

/** At most one RSVP link: a single http(s) URL string, or nothing. Shared by publish and edit. */
export function parseRsvpUrl(v: unknown): { ok: true; value: string | null } | { ok: false; error: string } {
  if (v == null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: "Only one RSVP link is allowed." };
  const trimmed = v.trim();
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("scheme");
  } catch {
    return { ok: false, error: "RSVP link must be a valid http(s) URL." };
  }
  if (/\s/.test(trimmed)) return { ok: false, error: "Only one RSVP link is allowed." };
  return { ok: true, value: trimmed };
}

/** The content an author may change after publishing. Pin, expiry, flyer, zone and author are NOT editable. */
export interface ValidatedEdit {
  title: string;
  body: string;
  categorySlug: string;
  rsvpUrl: string | null;
  eventDate: string | null;
  eventTime: string | null;
  endDate: string | null;
  endTime: string | null;
  placeLabel: string;
  /** The new pin, precision and zone when the edit carries a location; null leaves the stored location untouched. */
  location: { pin: { lat: number; lng: number }; precision: "exact" | "approximate"; timeZone: string | null } | null;
}

/** What an edit is judged against: the stored posting, which the edit cannot change. */
export interface EditContext {
  expiresAt: string;
  timeZone: string | null;
  lat: number;
  lng: number;
  /** Stored event fields; only used to stop an ended Community posting being revived by clearing its date. */
  eventDate?: string | null;
  endDate?: string | null;
  endTime?: string | null;
}

export type EditValidationResult = { ok: true; value: ValidatedEdit } | { ok: false; error: string };

/**
 * Validate an edit request. Same rules as publishing for the shared fields
 * (one valid category, one http(s) RSVP link, ISO dates, end after start, no
 * past events judged in the posting's own time zone), minus everything that is
 * fixed at publish (pin, expiry preset, flyer). Pure, so it is unit-testable.
 */
export function validatePostingEdit(b: unknown, ctx: EditContext, now: Date): EditValidationResult {
  if (!b || typeof b !== "object") return { ok: false, error: "Invalid request." };
  const r = b as Record<string, unknown>;

  const category = typeof r.categorySlug === "string" ? CATEGORIES.find((c) => c.slug === r.categorySlug) : undefined;
  if (!category) return { ok: false, error: "Choose exactly one valid category." };
  if (typeof r.title !== "string" || !r.title.trim()) return { ok: false, error: "Title is required." };

  const rsvp = parseRsvpUrl(r.rsvpUrl);
  if (!rsvp.ok) return rsvp;

  // No location in the body leaves the stored location untouched and the stored zone in force.
  let location: ValidatedEdit["location"] = null;
  if (r.location != null) {
    const loc = validateLocationBlock(r);
    if (!loc.ok) return loc;
    location = { pin: loc.pin, precision: loc.precision, timeZone: timeZoneForPin(loc.pin.lat, loc.pin.lng) };
  }
  const zone = location ? location.timeZone : ctx.timeZone;
  const pinForEnd = location ? location.pin : { lat: ctx.lat, lng: ctx.lng };

  const kind = categoryKind(category.slug);
  if (kind === "listing") {
    const d = checkListingDeadline(r, zone, now);
    if (!d.ok) return d;
    return {
      ok: true,
      value: {
        title: r.title.trim().slice(0, 140),
        body: typeof r.body === "string" ? r.body : "",
        categorySlug: category.slug,
        rsvpUrl: rsvp.value,
        eventDate: null,
        eventTime: null,
        endDate: d.deadline,
        endTime: null,
        placeLabel: typeof r.placeLabel === "string" ? r.placeLabel : "",
        location,
      },
    };
  }

  let eventDate: string | null = null;
  if (r.eventDate != null && r.eventDate !== "") {
    if (!isIsoDate(r.eventDate)) return { ok: false, error: "Event date must be YYYY-MM-DD." };
    eventDate = r.eventDate;
  }
  let endDate: string | null = null;
  if (r.endDate != null && r.endDate !== "") {
    if (!isIsoDate(r.endDate)) return { ok: false, error: "End date must be YYYY-MM-DD." };
    endDate = r.endDate;
  }
  let endTime: string | null = null;
  if (r.endTime != null && r.endTime !== "") {
    if (!isClockTime(r.endTime)) return { ok: false, error: "End time must be HH:MM (24-hour)." };
    endTime = r.endTime.slice(0, 5);
  }
  if (kind === "event-optional") {
    const e = checkCommunityFields(r, eventDate, endDate, endTime);
    if (e) return { ok: false, error: e };
    if (!eventDate && (ctx.eventDate || ctx.endDate)) {
      const storedEnd = eventEnd({ expiresAt: ctx.expiresAt, eventDate: ctx.eventDate ?? null, endDate: ctx.endDate, endTime: ctx.endTime, timeZone: ctx.timeZone, lat: ctx.lat, lng: ctx.lng });
      if (storedEnd && storedEnd.getTime() <= now.getTime()) {
        return { ok: false, error: "This posting has ended. Clearing its date would put it back on the board." };
      }
    }
  }
  if ((endDate || endTime) && !eventDate) return { ok: false, error: "Add the event date before an end date or time." };
  if (endDate && eventDate && endDate < eventDate) return { ok: false, error: "The end date is before the event date." };

  if (eventDate) {
    const today = localDate(now, zone ?? FALLBACK_TIME_ZONE);
    if (eventDate < today && !(endDate && endDate >= today)) {
      return { ok: false, error: "This event date has already passed. Check the date, including the year." };
    }
    const end = eventEnd({ expiresAt: ctx.expiresAt, eventDate, endDate, endTime, timeZone: zone, ...pinForEnd });
    if (end && end.getTime() <= now.getTime()) {
      return { ok: false, error: "This event has already ended. Check the end date and time." };
    }
  }

  return {
    ok: true,
    value: {
      title: r.title.trim().slice(0, 140),
      body: typeof r.body === "string" ? r.body : "",
      categorySlug: category.slug,
      rsvpUrl: rsvp.value,
      eventDate,
      eventTime: typeof r.eventTime === "string" && r.eventTime ? r.eventTime : null,
      endDate,
      endTime,
      placeLabel: typeof r.placeLabel === "string" ? r.placeLabel : "",
      location,
    },
  };
}
