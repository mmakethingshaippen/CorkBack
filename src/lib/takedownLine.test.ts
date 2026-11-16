import { describe, it, expect } from "vitest";
import { takedownLine, TAKEDOWN_ZONE_NOTE } from "./takedownLine";

const base = { expiresAt: "2025-12-20T12:00:00.000Z", timeZone: "America/Los_Angeles" };

describe("takedownLine", () => {
  it("names the event end when it is earlier than expiry", () => {
    const l = takedownLine({ ...base, categorySlug: "music", eventDate: "2025-12-05" });
    expect(l.reason).toBe("event_end");
    expect(l.text).toBe("Comes down on Friday, December 5, 2025: the event ends");
  });

  it("names the deadline for a listing", () => {
    const l = takedownLine({ ...base, categorySlug: "jobs", endDate: "2025-12-01" });
    expect(l.reason).toBe("deadline");
    expect(l.text).toBe("Comes down on Monday, December 1, 2025: your deadline passes");
  });

  it("names expiry for a Community notice and for a later event", () => {
    expect(takedownLine({ ...base, categorySlug: "community" }).reason).toBe("expiry");
    const l = takedownLine({ ...base, categorySlug: "community", eventDate: "2026-02-01" });
    expect(l.reason).toBe("expiry");
    expect(l.text).toBe("Comes down on Saturday, December 20, 2025: the time you chose to keep it on the board ends");
  });

  it("shows calendar dates without a pin zone", () => {
    const l = takedownLine({ ...base, timeZone: null, categorySlug: "music", eventDate: "2025-12-05" });
    expect(l.text).toContain("Friday, December 5, 2025");
  });

  it("exports the zone note", () => {
    expect(TAKEDOWN_ZONE_NOTE).toBe("The exact time uses your pin's time zone.");
  });
});
