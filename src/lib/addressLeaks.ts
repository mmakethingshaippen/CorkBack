// Personal-details check for the posting text. Pure module.
//
// It only warns. It reads its input and never changes, removes, masks or
// blocks the poster's text, including public venue or organizer addresses,
// phone numbers and email addresses (Requirement 11.12).

import { normalizeAddressText, type AddressCandidate } from "@/lib/addressCandidates";
import { findContactDetails } from "@/lib/contactDetails";

type LeakPrecision = "exact" | "approximate";

export interface LeakInput {
  title: string;
  body: string;
  placeLabel: string;
}

export interface AddressLeak {
  field: "title" | "body" | "placeLabel";
  text: string;
  reason: "candidate" | "pattern" | "phone" | "email";
}

const FIELDS = ["title", "body", "placeLabel"] as const;

const SUFFIXES =
  "street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|way|place|pl|terrace|parkway|highway";

/** House number, one to four words, then a street suffix. Built fresh per call (global flag keeps state). */
function streetPattern(): RegExp {
  return new RegExp(
    `\\b\\d{1,6}[ \\t]+(?:[A-Za-z][A-Za-z.'-]*[ \\t]+){1,4}?(?:${SUFFIXES})\\b`,
    "gi",
  );
}

function padded(s: string): string {
  return ` ${s} `;
}

/** True when normalized `needle` occurs in normalized `hay` on word boundaries. */
function occurs(hay: string, needle: string): boolean {
  return needle.length > 0 && padded(hay).includes(padded(needle));
}

/** True when the normalized texts are the same street line or one holds the other. */
function sameStreet(a: string, b: string): boolean {
  return a.length > 0 && b.length > 0 && (occurs(a, b) || occurs(b, a));
}

/**
 * Personal details in the posting. It reads its input and never changes it.
 * Phone numbers and email addresses are always reported, in any field.
 * Address text that is not the confirmed public place is reported as follows:
 * - A candidate leaks when its normalized text occurs in a field, unless it is
 *   the confirmed street line and precision is exact.
 * - A street-address pattern leaks when it matches no candidate, unless it is
 *   the confirmed street line with exact precision.
 * - With approximate precision the confirmed street line is itself a leak.
 */
export function findAddressLeaks(
  input: LeakInput,
  candidates: readonly AddressCandidate[],
  confirmed: { addressLine: string } | null,
  precision: LeakPrecision,
): AddressLeak[] {
  const leaks: AddressLeak[] = [];
  try {
    const exact = precision === "exact";
    const line = confirmed && typeof confirmed.addressLine === "string"
      ? normalizeAddressText(confirmed.addressLine)
      : "";
    const cands = (Array.isArray(candidates) ? candidates : [])
      .filter((c) => c && typeof c.text === "string")
      .map((c) => ({ text: c.text, norm: normalizeAddressText(c.text) }))
      .filter((c) => c.norm.length > 0);

    for (const field of FIELDS) {
      const raw = input && typeof input[field] === "string" ? input[field] : "";
      if (!raw) continue;
      const norm = normalizeAddressText(raw);
      const seen = new Set<string>();
      const add = (leak: AddressLeak, key: string) => {
        if (seen.has(key)) return;
        seen.add(key);
        leaks.push(leak);
      };

      for (const c of findContactDetails(raw)) {
        add({ field, text: c.text, reason: c.kind }, `${c.kind}:${c.text}`);
      }

      // Candidates found in the field.
      const present = cands.filter((c) => occurs(norm, c.norm));
      for (const c of present) {
        if (exact && sameStreet(c.norm, line)) continue;
        add({ field, text: c.text, reason: "candidate" }, `addr:${c.norm}`);
      }

      // Street-address patterns.
      for (const m of raw.matchAll(streetPattern())) {
        const text = m[0];
        const n = normalizeAddressText(text);
        if (!n) continue;
        if (exact && sameStreet(n, line)) continue;
        // Already covered by a candidate that is in the field (reported or exempt above).
        if (present.some((c) => occurs(c.norm, n))) continue;
        add({ field, text, reason: "pattern" }, `addr:${n}`);
      }

      // Approximate precision: the confirmed street line is personal.
      if (!exact && line && occurs(norm, line)) {
        add({ field, text: confirmed!.addressLine.trim(), reason: "pattern" }, `addr:${line}`);
      }
    }
  } catch {
    return leaks;
  }
  return leaks;
}

/** Publishing is allowed when there are no leaks, or when the poster ticked the acknowledgement. */
export function canPublishWithLeaks(leaks: readonly AddressLeak[], acknowledged: boolean): boolean {
  return leaks.length === 0 || acknowledged === true;
}

/** For a future published flyer image: the candidates of kind contact, return or unknown, as one list. */
export function imageAddressWarning(candidates: readonly AddressCandidate[]): string | null {
  const list = (Array.isArray(candidates) ? candidates : [])
    .filter((c) => c && (c.kind === "contact" || c.kind === "return" || c.kind === "unknown"))
    .map((c) => c.text);
  if (list.length === 0) return null;
  return `The flyer image shows these addresses: ${list.join("; ")}. They stay visible on the image. Crop or hide them first.`;
}
