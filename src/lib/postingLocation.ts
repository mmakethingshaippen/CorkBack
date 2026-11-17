// Draft state machine for the posting location (location-rules.md).
// A proposal (from a flyer candidate, a place match, a map tap or "Use my
// location") never becomes the pin until the poster answers "Yes, use this
// place". Any later change to the proposal un-confirms. For a private home the
// public pin is an approximate point 150 to 400 m from the exact one, computed
// in the browser; the exact point is never part of the publish payload.
//
// Pure module: no storage, window or navigator access. Imports only domain,
// geocode and addressCandidates.

import type { AddressCandidate } from "./addressCandidates";
import { destinationPoint, haversineMeters } from "./domain";
import { isAmbiguous, type LatLng, type PlaceMatch } from "./geocode";

export type PinSource = "flyer_candidate" | "search" | "pin" | "device";
export type Precision = "exact" | "approximate";
export type StoredPrecision = Precision | "unreviewed";

export const APPROX_MIN_METERS = 150;
export const APPROX_MAX_METERS = 400;
export const STALE_LABEL_METERS = 100;

/** Fixed start view, [lng, lat] and zoom. Independent of any device or browsing location. */
export const DEFAULT_VIEW: { center: [number, number]; zoom: number } = {
  center: [-98.5, 39.8],
  zoom: 3.5,
};

export type LocationNotice =
  | "label_cleared"
  | "label_kept"
  | "device_failed"
  | "no_match"
  | "area_match"
  | "search_unavailable"
  | "search_busy"
  | "query_refused"
  | "location_save_failed";

export interface PinChoice {
  point: LatLng;
  source: PinSource;
  match: PlaceMatch | null;
}

export interface LocationDraft {
  candidates: AddressCandidate[];
  matches: PlaceMatch[];
  proposal: PinChoice | null;
  confirmed: PinChoice | null;
  privateHome: boolean;
  /** Approximate point for the confirmed point; set only while privateHome is true. */
  approx: LatLng | null;
  label: { text: string; origin: "none" | "derived" | "typed"; derivedFrom: LatLng | null };
  /** Existing posting only: what is stored now. Never sent unless the owner confirms a new location. */
  existing: { point: LatLng; precision: StoredPrecision; label: string } | null;
  notice: LocationNotice | null;
}

export type LocationEvent =
  | { type: "extracted"; candidates: AddressCandidate[] }
  | { type: "matches_loaded"; matches: PlaceMatch[]; autoPropose: boolean; source?: "flyer_candidate" | "search" }
  | { type: "match_selected"; match: PlaceMatch; source: "flyer_candidate" | "search" }
  | { type: "pin_placed"; point: LatLng }
  | { type: "device_succeeded"; point: LatLng }
  | { type: "device_failed" }
  | { type: "search_failed"; kind: "unavailable" | "busy" | "refused" }
  | { type: "location_save_failed" }
  | { type: "proposal_confirmed"; rand: [number, number] }
  | { type: "proposal_rejected" }
  | { type: "private_home_set"; value: boolean; rand: [number, number] }
  | { type: "label_typed"; text: string }
  | { type: "existing_loaded"; point: LatLng; precision: StoredPrecision; label: string };

export interface LocationPayload {
  lat: number;
  lng: number;
  source: PinSource;
  confirmed: true;
  precision: Precision;
}

export function emptyDraft(): LocationDraft {
  return {
    candidates: [],
    matches: [],
    proposal: null,
    confirmed: null,
    privateHome: false,
    approx: null,
    label: { text: "", origin: "none", derivedFrom: null },
    existing: null,
    notice: null,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

function unit(n: number): number {
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), 1 - Number.EPSILON) : 0;
}

/**
 * A point 150 to 400 m from `exact`. Distance and bearing come from `rand`
 * (each in [0, 1)): distance = 150 + rand[0] * 250 m, bearing = rand[1] * 2π.
 */
export function approximatePin(exact: LatLng, rand: [number, number]): LatLng {
  const meters = APPROX_MIN_METERS + unit(rand[0]) * (APPROX_MAX_METERS - APPROX_MIN_METERS);
  const bearing = unit(rand[1]) * 2 * Math.PI;
  return destinationPoint(exact, meters, bearing);
}

/** A closed ring (first point repeated at the end) of `steps` + 1 points around `center`. */
export function circleRing(center: LatLng, meters: number, steps = 64): LatLng[] {
  const n = Number.isFinite(steps) ? Math.max(3, Math.floor(steps)) : 64;
  const ring: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    ring.push(destinationPoint(center, meters, (i / n) * 2 * Math.PI));
  }
  ring.push({ ...ring[0] });
  return ring;
}

const BEARINGS = { n: 0, e: Math.PI / 2, s: Math.PI, w: (3 * Math.PI) / 2 } as const;

/** Move a point 10 m (or `meters`) north, south, east or west. */
export function nudgePin(point: LatLng, dir: "n" | "s" | "e" | "w", meters = 10): LatLng {
  return destinationPoint(point, meters, BEARINGS[dir]);
}

/** The detail page note for an approximate posting, otherwise null. */
export function locationNote(precision: StoredPrecision): string | null {
  return precision === "approximate" ? "Approximate location. The exact address is not shown." : null;
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function streetText(m: PlaceMatch): string {
  return [m.name, m.addressLine].filter((p) => p !== "").join(", ") || m.displayName || m.area;
}

function nearText(m: PlaceMatch): string {
  return m.area ? `Near ${m.area}` : "";
}

function derivedLabel(m: PlaceMatch, privateHome: boolean): LocationDraft["label"] {
  const text = privateHome ? nearText(m) : streetText(m);
  return text ? { text, origin: "derived", derivedFrom: m.point } : { text: "", origin: "none", derivedFrom: null };
}

function matchAt(d: LocationDraft, p: LatLng | null): PlaceMatch | null {
  if (!p) return null;
  const pool = [d.proposal?.match, d.confirmed?.match, ...d.matches];
  for (const m of pool) {
    if (m && haversineMeters(m.point, p) < 1) return m;
  }
  return null;
}

/** Re-render a derived label for the privacy setting. Typed and empty labels are untouched. */
function relabel(d: LocationDraft, privateHome: boolean): { label: LocationDraft["label"]; cleared: boolean } {
  const label = d.label;
  if (label.origin !== "derived") return { label, cleared: false };
  const m = matchAt(d, label.derivedFrom);
  if (privateHome) {
    if (m) {
      const next = derivedLabel(m, true);
      return { label: next, cleared: next.origin === "none" };
    }
    // The street text cannot be rebuilt, so a label that may hold it is cleared.
    if (label.text.startsWith("Near ")) return { label, cleared: false };
    return { label: { text: "", origin: "none", derivedFrom: null }, cleared: true };
  }
  return { label: m ? derivedLabel(m, false) : label, cleared: false };
}

/** Clear a derived label whose point is more than 100 m from `point`. */
function checkStale(label: LocationDraft["label"], point: LatLng): { label: LocationDraft["label"]; cleared: boolean } {
  if (label.origin === "derived" && label.derivedFrom && haversineMeters(label.derivedFrom, point) > STALE_LABEL_METERS) {
    return { label: { text: "", origin: "none", derivedFrom: null }, cleared: true };
  }
  return { label, cleared: false };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

function propose(d: LocationDraft, match: PlaceMatch, source: "flyer_candidate" | "search"): LocationDraft {
  let label = d.label;
  let notice: LocationNotice | null = match.level === "area" ? "area_match" : null;
  if (label.origin === "typed") {
    notice = "label_kept";
  } else {
    label = derivedLabel(match, d.privateHome);
  }
  return {
    ...d,
    proposal: { point: match.point, source, match },
    confirmed: null,
    approx: null,
    label,
    notice,
  };
}

function moveProposal(d: LocationDraft, point: LatLng, source: PinSource): LocationDraft {
  const stale = checkStale(d.label, point);
  return {
    ...d,
    proposal: { point, source, match: null },
    confirmed: null,
    approx: null,
    label: stale.label,
    notice: stale.cleared ? "label_cleared" : null,
  };
}

export function locationReducer(d: LocationDraft, e: LocationEvent): LocationDraft {
  switch (e.type) {
    case "extracted":
      return { ...d, candidates: e.candidates, notice: null };

    case "matches_loaded": {
      const next: LocationDraft = { ...d, matches: e.matches, notice: null };
      if (e.matches.length === 0) return { ...next, notice: "no_match" };
      if (e.autoPropose && !isAmbiguous(e.matches)) {
        return propose(next, e.matches[0], e.source ?? "search");
      }
      return e.matches.some((m) => m.level === "area") ? { ...next, notice: "area_match" } : next;
    }

    case "match_selected":
      return propose(d, e.match, e.source);

    case "pin_placed":
      return moveProposal(d, e.point, "pin");

    case "device_succeeded":
      return moveProposal(d, e.point, "device");

    case "device_failed":
      return { ...d, notice: "device_failed" };

    case "search_failed":
      return {
        ...d,
        notice:
          e.kind === "busy" ? "search_busy" : e.kind === "refused" ? "query_refused" : "search_unavailable",
      };

    case "location_save_failed":
      return { ...d, notice: "location_save_failed" };

    case "proposal_confirmed": {
      if (!d.proposal) return d;
      const confirmed = d.proposal;
      const base: LocationDraft = { ...d, confirmed, proposal: null, notice: null };
      if (!d.privateHome) return { ...base, approx: null };
      const { label, cleared } = relabel(base, true);
      return {
        ...base,
        approx: approximatePin(confirmed.point, e.rand),
        label,
        notice: cleared ? "label_cleared" : null,
      };
    }

    case "proposal_rejected":
      return { ...d, proposal: null, notice: null };

    case "private_home_set": {
      const { label, cleared } = relabel(d, e.value);
      return {
        ...d,
        privateHome: e.value,
        approx: e.value && d.confirmed ? approximatePin(d.confirmed.point, e.rand) : null,
        label,
        notice: cleared ? "label_cleared" : null,
      };
    }

    case "label_typed":
      return {
        ...d,
        label: e.text === "" ? { text: "", origin: "none", derivedFrom: null } : { text: e.text, origin: "typed", derivedFrom: null },
        notice: null,
      };

    case "existing_loaded":
      return {
        ...d,
        existing: { point: e.point, precision: e.precision, label: e.label },
        label:
          d.label.origin === "none" && e.label !== ""
            ? { text: e.label, origin: "typed", derivedFrom: null }
            : d.label,
      };

    default:
      return d;
  }
}

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

/** The point visitors see: the approximate point for a private home, the confirmed point otherwise. Null until confirmed. */
export function publicPin(d: LocationDraft): LatLng | null {
  if (!d.confirmed) return null;
  if (d.privateHome) return d.approx;
  return d.confirmed.point;
}

/** The server payload, or null unless the draft is confirmed. A private home sends only the approximate point. */
export function publishableLocation(d: LocationDraft): LocationPayload | null {
  if (!d.confirmed) return null;
  const pin = publicPin(d);
  if (!pin) return null;
  return {
    lat: pin.lat,
    lng: pin.lng,
    source: d.confirmed.source,
    confirmed: true,
    precision: d.privateHome ? "approximate" : "exact",
  };
}
