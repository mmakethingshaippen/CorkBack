// Address candidates read from a flyer. A candidate is only a suggestion: it
// never becomes the pin until the poster confirms it (location-rules.md).
// Pure module: no server-only imports, no storage or window access.

import type { ExtractedFlyer } from "@/lib/types";

export type CandidateKind = "venue" | "contact" | "return" | "other" | "unknown";
export interface AddressCandidate {
  text: string;
  kind: CandidateKind;
}

export const MAX_CANDIDATES = 5;
export const MAX_CANDIDATE_TEXT = 200;

const KINDS: readonly CandidateKind[] = ["venue", "contact", "return", "other", "unknown"];

const SUFFIXES: Record<string, string> = {
  st: "street",
  ave: "avenue",
  av: "avenue",
  blvd: "boulevard",
  rd: "road",
  dr: "drive",
  ln: "lane",
  ct: "court",
  pl: "place",
  hwy: "highway",
  pkwy: "parkway",
  cir: "circle",
  ter: "terrace",
  sq: "square",
  n: "north",
  s: "south",
  e: "east",
  w: "west",
};

/** Lowercase, strip punctuation and extra spaces, expand common street suffixes. */
export function normalizeAddressText(s: string): string {
  if (typeof s !== "string") return "";
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => SUFFIXES[t] ?? t)
    .join(" ");
}

/** Never throws. Anything that is not a list of {text, kind?} becomes []. Caps, trims, dedupes by normalized text. */
export function normalizeAddressCandidates(raw: unknown): AddressCandidate[] {
  try {
    if (!Array.isArray(raw)) return [];
    const out: AddressCandidate[] = [];
    const seen = new Set<string>();
    for (const item of raw) {
      if (out.length >= MAX_CANDIDATES) break;
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as { text?: unknown; kind?: unknown };
      if (typeof rec.text !== "string") continue;
      const text = rec.text.trim().slice(0, MAX_CANDIDATE_TEXT).trim();
      if (!text) continue;
      const key = normalizeAddressText(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const kind = KINDS.includes(rec.kind as CandidateKind) ? (rec.kind as CandidateKind) : "unknown";
      out.push({ text, kind });
    }
    return out;
  } catch {
    return [];
  }
}

function strOrNull(v: unknown): string | null | undefined {
  if (v === null) return null;
  if (typeof v === "string") return v;
  return undefined;
}

/** Validated read of the sessionStorage value. Missing `addresses` becomes []. Returns null when unreadable. */
export function parseStoredExtraction(json: string | null): ExtractedFlyer | null {
  try {
    if (typeof json !== "string" || !json) return null;
    const v: unknown = JSON.parse(json);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    const o = v as Record<string, unknown>;
    if (typeof o.title !== "string") return null;

    const eventDate = o.eventDate === undefined ? null : strOrNull(o.eventDate);
    const eventTime = o.eventTime === undefined ? null : strOrNull(o.eventTime);
    const rsvpUrl = o.rsvpUrl === undefined ? null : strOrNull(o.rsvpUrl);
    const placeLabel = o.placeLabel === undefined ? "" : o.placeLabel;
    const categorySlug = o.categorySlug === undefined ? "" : o.categorySlug;
    const body = o.body === undefined ? "" : o.body;
    if (eventDate === undefined || eventTime === undefined || rsvpUrl === undefined) return null;
    if (typeof placeLabel !== "string" || typeof categorySlug !== "string" || typeof body !== "string") return null;
    if (o.eventDateYearPrinted !== undefined && typeof o.eventDateYearPrinted !== "boolean") return null;

    const result: ExtractedFlyer = {
      title: o.title,
      eventDate,
      eventTime,
      placeLabel,
      categorySlug,
      rsvpUrl,
      body,
      addresses: normalizeAddressCandidates(o.addresses),
    };
    if (o.eventDateYearPrinted !== undefined) result.eventDateYearPrinted = o.eventDateYearPrinted;
    return result;
  } catch {
    return null;
  }
}

export function serializeExtraction(e: ExtractedFlyer): string {
  return JSON.stringify(e);
}
