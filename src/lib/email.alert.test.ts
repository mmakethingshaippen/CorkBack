import { describe, it, expect, vi, afterEach } from "vitest";
import fc from "fast-check";

vi.mock("server-only", () => ({}));

import { buildAlertEmail } from "./email";

type P = Parameters<typeof buildAlertEmail>[0];
const base = { id: "p1", title: "Test posting", placeLabel: "Main St" };
const make = (o: Partial<P> & { categorySlug: string }): P =>
  ({ ...base, eventDate: null, eventTime: null, endDate: null, ...o }) as P;

const BAD = /null|undefined|Invalid Date/;
const all = (e: { subject: string; text: string; html: string }) => `${e.subject}\n${e.text}\n${e.html}`;

describe("buildAlertEmail examples", () => {
  const savedTz = process.env.TZ;
  afterEach(() => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
  });

  it("listing with a deadline uses the fieldSpec card prefix", () => {
    const e = buildAlertEmail(make({ categorySlug: "jobs", endDate: "2026-12-01" }));
    expect(e.text).toContain("Apply by Dec 1");
    expect(e.html).toContain("Apply by Dec 1");
    const h = buildAlertEmail(make({ categorySlug: "housing", endDate: "2026-03-09" }));
    expect(h.text).toContain("Available until Mar 9");
  });

  it("listing without a deadline has no date line", () => {
    const e = buildAlertEmail(make({ categorySlug: "jobs" }));
    expect(e.text).not.toMatch(/Apply by|Date:|Time:/);
    expect(e.text).toContain("Place: Main St");
  });

  it("date-less Community has no date line", () => {
    const e = buildAlertEmail(make({ categorySlug: "community" }));
    expect(e.text).not.toMatch(/Date:|Time:|by /);
  });

  it("events keep the Date line, with time when present", () => {
    const e = buildAlertEmail(make({ categorySlug: "music", eventDate: "2026-12-01", eventTime: "19:00" }));
    expect(e.text).toContain("Date: 2026-12-01 at 19:00");
    expect(e.html).toContain("Date: 2026-12-01 at 19:00");
  });

  it("legacy listing with an event_date keeps its Date line", () => {
    const e = buildAlertEmail(make({ categorySlug: "jobs", eventDate: "2026-12-01", endDate: "2027-01-05" }));
    expect(e.text).toContain("Date: 2026-12-01");
    expect(e.text).not.toContain("Apply by");
  });

  it("date-only strings never shift a day in any timezone", () => {
    for (const tz of ["UTC", "Pacific/Auckland", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = tz;
      const e = buildAlertEmail(make({ categorySlug: "jobs", endDate: "2026-12-01" }));
      expect(e.text, tz).toContain("Apply by Dec 1");
      expect(e.text, tz).not.toContain("Nov 30");
      expect(e.text, tz).not.toContain("Dec 2");
    }
  });

  it("an unparseable date omits the line and still returns an email", () => {
    for (const slug of ["jobs", "music", "community"]) {
      const e = buildAlertEmail(make({ categorySlug: slug, eventDate: "garbage", endDate: "2026-13-45" }));
      expect(e.subject).toContain("Test posting");
      expect(e.text).toContain("View it:");
      expect(e.text).not.toMatch(/Date:|Apply by/);
      expect(all(e)).not.toMatch(BAD);
    }
    const l = buildAlertEmail(make({ categorySlug: "sale", endDate: "2026-02-30" }));
    expect(l.text).not.toContain("Offer ends");
  });
});

describe("Property 30: alert email never leaks null/undefined/Invalid Date", () => {
  const dateish = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(""),
    fc.constantFrom("garbage", "2026-13-45", "2026-02-30", "NaN", "0000-00-00", "Invalid Date"),
    fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10)),
    fc.date({ min: new Date("2000-01-01"), max: new Date("2100-01-01"), noInvalidDate: true }).map((d) => d.toISOString()),
  );
  const timeish = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.constant(""),
    fc.constantFrom("garbage", "25:99"),
    fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })).map(
      ([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    ),
  );
  const slug = fc.constantFrom("jobs", "housing", "sale", "lost-found", "community", "music", "unknown-cat");

  /** Validates: Requirements 12.1, 12.2, 12.3, 12.4, 12.5, 12.6 */
  it("holds for any combination of present, missing and garbage dates and times", () => {
    fc.assert(
      fc.property(slug, dateish, timeish, dateish, timeish, (categorySlug, eventDate, eventTime, endDate, endTime, ) => {
        const posting = {
          ...base,
          categorySlug,
          eventDate: eventDate as string | null,
          eventTime: eventTime as string | null,
          endDate: endDate as string | null,
          endTime,
        } as unknown as P;
        const e = buildAlertEmail(posting);
        expect(all(e)).not.toMatch(BAD);
        expect(e.text).toContain("View it:");
        expect(e.text).toContain("Place: Main St");
      }),
      { numRuns: 300 },
    );
  });
});
