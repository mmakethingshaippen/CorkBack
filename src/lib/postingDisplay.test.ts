import { describe, expect, it } from "vitest";
import { cardDateLabel, formatDateOnly, onBoardUntilLine } from "./postingDisplay";

describe("cardDateLabel", () => {
  it("shows the prefix and Deadline for a listing", () => {
    expect(cardDateLabel({ categorySlug: "jobs", eventDate: null, endDate: "2030-12-01" })).toBe("Apply by Dec 1");
  });
  it("shows no line for a listing without a Deadline or a date-less Community posting", () => {
    expect(cardDateLabel({ categorySlug: "sale", eventDate: null, endDate: null })).toBeNull();
    expect(cardDateLabel({ categorySlug: "community", eventDate: null, endDate: null })).toBeNull();
  });
  it("keeps a stored legacy event date and shows event dates as before", () => {
    expect(cardDateLabel({ categorySlug: "housing", eventDate: "2030-03-05", endDate: null })).toBe("Mar 5");
    expect(cardDateLabel({ categorySlug: "music", eventDate: "2030-03-05" })).toBe("Mar 5");
  });
});

describe("onBoardUntilLine", () => {
  const base = { eventDate: null, lat: 34, lng: -118, timeZone: "America/Los_Angeles" };
  it("names the deadline day in the stored zone", () => {
    const line = onBoardUntilLine({ ...base, categorySlug: "jobs", endDate: "2030-12-01", expiresAt: "2031-06-01T00:00:00Z" });
    expect(line).toBe("On the board until Sunday, December 1, 2030 (deadline)");
  });
  it("names expiry when it comes first", () => {
    const line = onBoardUntilLine({ ...base, categorySlug: "community", expiresAt: "2030-02-01T12:00:00Z" });
    expect(line).toBe("On the board until Friday, February 1, 2030 (expiry)");
  });
});

describe("formatDateOnly", () => {
  it("does not shift the calendar day", () => {
    expect(formatDateOnly("2030-01-01", { day: "numeric", month: "short" })).toBe("Jan 1");
  });
});
