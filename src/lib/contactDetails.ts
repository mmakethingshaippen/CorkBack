/**
 * Contact detector: finds phone numbers and email addresses in free text.
 *
 * Pure. It only detects. It never removes or edits text, never throws, and
 * reads its input only. Shared by the personal-details check and the
 * geocoder query check.
 *
 * The detector favors warning over silence for separated 10-digit numbers.
 * It can miss numbers written with words or unusual separators. The warning
 * is advisory, so a miss costs a missed warning and a false positive costs
 * one checkbox.
 */

export interface ContactMatch {
  kind: "phone" | "email";
  text: string;
  index: number;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** Separated 10-digit forms, with an optional country prefix. */
const SEPARATED_RE =
  /(?<!\d)(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;

/** International form; 9 to 15 digits in total is checked after the match. */
const INTERNATIONAL_RE = /(?<!\d)\+\d{1,3}(?:[\s.-]?\d{1,4}){2,5}(?!\d)/g;

/** Local seven-digit form, only with a hyphen or dot. */
const LOCAL_RE = /(?<!\d)(?<!\d[.-])\d{3}[.-]\d{4}(?!\d)(?![.-]\d)/g;

const DATE_RES = [
  /^\d{4}-\d{2}-\d{2}$/,
  /^\d{1,2}\/\d{1,2}\/\d{4}$/,
  /^\d{1,2}\.\d{1,2}\.\d{4}$/,
];
const TIME_RE = /^\d{1,2}:\d{2}$/;
const YEAR_RE = /^(?:1[89]|20)\d{2}$/;
const POSTCODE_RE = /^\d{5}(?:-\d{4})?$/;

function digitCount(s: string): number {
  return s.replace(/\D/g, "").length;
}

/** True when the candidate is really a date, time, price, year or postcode. */
function isLookAlike(text: string, before: string, after: string): boolean {
  if (DATE_RES.some((re) => re.test(text))) return true;
  if (TIME_RE.test(text) || YEAR_RE.test(text) || POSTCODE_RE.test(text)) return true;
  // Price: a leading currency sign, or a comma-thousands group around the match.
  if (/[$€]\s*$/.test(before)) return true;
  if (/\d,$/.test(before) || /^,\d{3}/.test(after)) return true;
  return false;
}

function collect(
  text: string,
  re: RegExp,
  kind: "phone" | "email",
  accept: (m: string) => boolean,
  out: ContactMatch[],
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const start = m.index;
    const end = start + m[0].length;
    if (!accept(m[0])) continue;
    if (kind === "phone") {
      if (isLookAlike(m[0], text.slice(0, start), text.slice(end))) continue;
    }
    if (out.some((o) => start < o.index + o.text.length && o.index < end)) continue;
    out.push({ kind, text: m[0], index: start });
  }
}

/** Never throws. Reports phone numbers and email addresses; reads its input only. */
export function findContactDetails(text: string): ContactMatch[] {
  try {
    if (typeof text !== "string" || text.length === 0) return [];
    const found: ContactMatch[] = [];
    collect(text, EMAIL_RE, "email", () => true, found);
    collect(
      text,
      SEPARATED_RE,
      "phone",
      (s) => {
        // A bare run of digits is reported only when it starts with 2 to 9.
        if (/^\d+$/.test(s)) return /^[2-9]/.test(s);
        return true;
      },
      found,
    );
    collect(
      text,
      INTERNATIONAL_RE,
      "phone",
      (s) => {
        const n = digitCount(s);
        return n >= 9 && n <= 15;
      },
      found,
    );
    collect(text, LOCAL_RE, "phone", () => true, found);
    return found.sort((a, b) => a.index - b.index);
  } catch {
    return [];
  }
}

export function hasContactDetails(text: string): boolean {
  return findContactDetails(text).length > 0;
}
