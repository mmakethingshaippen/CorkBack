// Focused scenario tests for the posting location confirmation (Requirement 17).
// Uses the pure modules only: no network, no browser, a stub navigator.
import { describe, it, expect, vi } from "vitest";

import {
  emptyDraft,
  locationReducer,
  publishableLocation,
  publicPin,
  type LocationDraft,
  type LocationEvent,
} from "./postingLocation";
import { normalizeAddressCandidates } from "./addressCandidates";
import { findAddressLeaks, canPublishWithLeaks } from "./addressLeaks";
import { prepareGeocodeQuery } from "./geocodeQueryPrepare";
import { requestDeviceLocation, DEVICE_TIMEOUT_MS } from "./deviceLocation";
import { destinationPoint, haversineMeters } from "./domain";
import { validatePostingInput } from "./postingInput";
import { CATEGORIES } from "./categories";
import {
  FX_FLYER_HOME,
  FX_FLYER_NONE,
  FX_FLYER_THREE,
  FX_CONTACT_STRINGS,
  FX_LOOKALIKE_STRINGS,
  FX_MATCHES_AMBIGUOUS,
  FX_MATCH_STREET,
  FX_ORIGIN,
} from "./__fixtures__/location";

const now = new Date("2025-01-01T00:00:00Z");
const RAND: [number, number] = [0.5, 0.25];

function run(events: LocationEvent[], start: LocationDraft = emptyDraft()): LocationDraft {
  return events.reduce(locationReducer, start);
}

function body(draft: LocationDraft) {
  return {
    title: "Fixture posting",
    categorySlug: CATEGORIES[0].slug,
    expiry: "1w",
    location: publishableLocation(draft),
  };
}

/** A stub navigator whose getCurrentPosition is a spy. */
function stubNav(behavior: "granted" | "denied" | "unavailable" | "timeout") {
  const getCurrentPosition = vi.fn(
    (ok: PositionCallback, fail: PositionErrorCallback) => {
      if (behavior === "granted") {
        ok({ coords: { latitude: 37.5, longitude: -122.1 } } as GeolocationPosition);
      } else {
        const code = behavior === "denied" ? 1 : behavior === "timeout" ? 3 : 2;
        fail({ code } as GeolocationPositionError);
      }
    },
  );
  return { nav: { geolocation: { getCurrentPosition } } as unknown as Navigator, getCurrentPosition };
}

describe("scanning at home", () => {
  it("leaves the draft unconfirmed and publishes nothing", () => {
    const { nav, getCurrentPosition } = stubNav("granted");
    const candidates = normalizeAddressCandidates(FX_FLYER_HOME.addresses);
    const d = run([{ type: "extracted", candidates }]);
    expect(d.candidates).toHaveLength(1);
    expect(d.proposal).toBeNull();
    expect(d.confirmed).toBeNull();
    expect(publicPin(d)).toBeNull();
    expect(publishableLocation(d)).toBeNull();
    // Scanning never reads the device position.
    expect(getCurrentPosition).not.toHaveBeenCalled();
    void nav;
    expect(validatePostingInput(body(d), now).ok).toBe(false);
  });
});

describe("multiple addresses", () => {
  it("lists three candidates, makes no pin, and confirms only the venue", () => {
    const candidates = normalizeAddressCandidates(FX_FLYER_THREE.addresses);
    expect(candidates).toHaveLength(3);
    const listed = run([{ type: "extracted", candidates }]);
    expect(listed.proposal).toBeNull();
    expect(publishableLocation(listed)).toBeNull();

    const venuePoint = FX_MATCH_STREET.point;
    const d = run([
      { type: "extracted", candidates },
      { type: "matches_loaded", matches: [FX_MATCH_STREET], autoPropose: false },
      { type: "match_selected", match: FX_MATCH_STREET, source: "flyer_candidate" },
    ]);
    expect(d.confirmed).toBeNull();
    expect(publishableLocation(d)).toBeNull();

    const done = locationReducer(d, { type: "proposal_confirmed", rand: RAND });
    expect(publishableLocation(done)).toEqual({
      lat: venuePoint.lat,
      lng: venuePoint.lng,
      source: "flyer_candidate",
      confirmed: true,
      precision: "exact",
    });
    expect(done.candidates).toEqual(candidates);
  });
});

describe("no address", () => {
  it("has an empty list, then a tap, a confirm and a valid payload", () => {
    expect(normalizeAddressCandidates(FX_FLYER_NONE.addresses)).toEqual([]);
    const d = run([
      { type: "extracted", candidates: [] },
      { type: "pin_placed", point: FX_ORIGIN },
    ]);
    expect(publishableLocation(d)).toBeNull();
    const done = locationReducer(d, { type: "proposal_confirmed", rand: RAND });
    const payload = publishableLocation(done);
    expect(payload).toEqual({ ...FX_ORIGIN, source: "pin", confirmed: true, precision: "exact" });
    expect(validatePostingInput(body(done), now).ok).toBe(true);
  });
});

describe("ambiguous matches", () => {
  it("shows no proposal until a match is selected", () => {
    const [a, b] = FX_MATCHES_AMBIGUOUS;
    expect(haversineMeters(a.point, b.point)).toBeGreaterThan(2500);
    const loaded = run([{ type: "matches_loaded", matches: FX_MATCHES_AMBIGUOUS, autoPropose: true }]);
    expect(loaded.matches).toHaveLength(2);
    expect(loaded.proposal).toBeNull();
    expect(loaded.confirmed).toBeNull();
    expect(publishableLocation(loaded)).toBeNull();

    const picked = locationReducer(loaded, { type: "match_selected", match: b, source: "search" });
    expect(picked.proposal?.point).toEqual(b.point);
    expect(publishableLocation(picked)).toBeNull();
    const done = locationReducer(picked, { type: "proposal_confirmed", rand: RAND });
    expect(publishableLocation(done)).toMatchObject({ lat: b.point.lat, lng: b.point.lng, source: "search" });
  });
});

describe("denied location permission", () => {
  it("keeps the draft unchanged apart from the notice, and a manual pin publishes", async () => {
    const { nav, getCurrentPosition } = stubNav("denied");
    const before = run([{ type: "extracted", candidates: normalizeAddressCandidates(FX_FLYER_THREE.addresses) }]);
    const result = await requestDeviceLocation(nav);
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: "denied" });

    const failed = locationReducer(before, { type: "device_failed" });
    expect(failed.notice).toBe("device_failed");
    expect({ ...failed, notice: null }).toEqual(before);

    const done = run(
      [
        { type: "pin_placed", point: FX_ORIGIN },
        { type: "proposal_confirmed", rand: RAND },
      ],
      failed,
    );
    expect(publishableLocation(done)).toMatchObject({ ...FX_ORIGIN, source: "pin", confirmed: true });
    expect(validatePostingInput(body(done), now).ok).toBe(true);
  });
});

describe("corrected pin", () => {
  it("discards the confirmation, clears the stale label, blocks publish, then publishes the dragged point", () => {
    const confirmed = run([
      { type: "match_selected", match: FX_MATCH_STREET, source: "flyer_candidate" },
      { type: "proposal_confirmed", rand: RAND },
    ]);
    expect(confirmed.label.origin).toBe("derived");
    expect(confirmed.label.text).not.toBe("");
    expect(publishableLocation(confirmed)).not.toBeNull();

    const dragged = destinationPoint(FX_MATCH_STREET.point, 400, Math.PI / 2);
    const moved = locationReducer(confirmed, { type: "pin_placed", point: dragged });
    expect(moved.confirmed).toBeNull();
    expect(moved.label).toEqual({ text: "", origin: "none", derivedFrom: null });
    expect(moved.notice).toBe("label_cleared");
    expect(publishableLocation(moved)).toBeNull();
    expect(validatePostingInput(body(moved), now).ok).toBe(false);

    const again = locationReducer(moved, { type: "proposal_confirmed", rand: RAND });
    const payload = publishableLocation(again);
    expect(payload).toMatchObject({ lat: dragged.lat, lng: dragged.lng, source: "pin", confirmed: true });
    expect(validatePostingInput(body(again), now).ok).toBe(true);
  });
});

describe("search unavailable", () => {
  it("leaves the draft alone and a manual pin publishes", () => {
    const before = run([{ type: "extracted", candidates: normalizeAddressCandidates(FX_FLYER_HOME.addresses) }]);
    const failed = locationReducer(before, { type: "search_failed", kind: "unavailable" });
    expect(failed.notice).toBe("search_unavailable");
    expect({ ...failed, notice: null }).toEqual(before);

    const done = run(
      [
        { type: "pin_placed", point: FX_ORIGIN },
        { type: "proposal_confirmed", rand: RAND },
      ],
      failed,
    );
    expect(validatePostingInput(body(done), now).ok).toBe(true);
  });
});

describe("query refused", () => {
  it("does not prepare a query for a flyer line containing a phone number or email", () => {
    for (const line of [
      "Call 510-555-0142 or visit 200 Maple Avenue",
      "200 Maple Avenue, write to jane.doe@example.com",
    ]) {
      expect(prepareGeocodeQuery(line)).toEqual({ ok: false, reason: "contains_contact" });
    }
    expect(prepareGeocodeQuery("200 Maple Avenue, Berkeley, CA 94710").ok).toBe(true);
  });

  it("records the refusal without touching the draft", () => {
    const before = run([{ type: "extracted", candidates: normalizeAddressCandidates(FX_FLYER_THREE.addresses) }]);
    const refused = locationReducer(before, { type: "search_failed", kind: "refused" });
    expect(refused.notice).toBe("query_refused");
    expect({ ...refused, notice: null }).toEqual(before);
  });
});

describe("location save failure", () => {
  it("keeps the chosen pin and the same payload for a retry", () => {
    const done = run([
      { type: "pin_placed", point: FX_ORIGIN },
      { type: "proposal_confirmed", rand: RAND },
    ]);
    const payload = publishableLocation(done);
    const failed = locationReducer(done, { type: "location_save_failed" });
    expect(failed.notice).toBe("location_save_failed");
    expect(failed.confirmed).toEqual(done.confirmed);
    expect(failed.proposal).toEqual(done.proposal);
    expect(publishableLocation(failed)).toEqual(payload);
  });
});

describe("contact details", () => {
  const empty = { title: "", body: "", placeLabel: "" };
  const fields = ["title", "body", "placeLabel"] as const;

  it("warns for phones and emails in each field", () => {
    for (const field of fields) {
      for (const s of FX_CONTACT_STRINGS) {
        const leaks = findAddressLeaks({ ...empty, [field]: s }, [], null, "exact");
        expect(leaks.some((l) => l.field === field && (l.reason === "phone" || l.reason === "email"))).toBe(true);
        expect(canPublishWithLeaks(leaks, false)).toBe(false);
        expect(canPublishWithLeaks(leaks, true)).toBe(true);
      }
    }
  });

  it("leaves the venue contact text unchanged", () => {
    const input = {
      title: "Bake sale, call 510-555-0142",
      body: "Questions: hall@example.org",
      placeLabel: "Maple Hall",
    };
    const copy = { ...input };
    const leaks = findAddressLeaks(input, [], null, "exact");
    expect(leaks.length).toBeGreaterThan(0);
    expect(input).toEqual(copy);
  });

  it("does not warn for times, dates, prices, years and postcodes", () => {
    for (const field of fields) {
      for (const s of FX_LOOKALIKE_STRINGS) {
        expect(findAddressLeaks({ ...empty, [field]: s }, [], null, "exact")).toEqual([]);
      }
    }
  });
});

describe("requestDeviceLocation with a stub navigator", () => {
  it("granted returns the point", async () => {
    const { nav, getCurrentPosition } = stubNav("granted");
    expect(await requestDeviceLocation(nav)).toEqual({ ok: true, point: { lat: 37.5, lng: -122.1 } });
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      expect.objectContaining({ timeout: DEVICE_TIMEOUT_MS, maximumAge: 0 }),
    );
  });

  it("denied, unavailable and timeout map to their reasons", async () => {
    expect(await requestDeviceLocation(stubNav("denied").nav)).toEqual({ ok: false, reason: "denied" });
    expect(await requestDeviceLocation(stubNav("unavailable").nav)).toEqual({ ok: false, reason: "unavailable" });
    expect(await requestDeviceLocation(stubNav("timeout").nav)).toEqual({ ok: false, reason: "timeout" });
  });

  it("absent geolocation or navigator is unsupported", async () => {
    expect(await requestDeviceLocation({} as Navigator)).toEqual({ ok: false, reason: "unsupported" });
    expect(await requestDeviceLocation(undefined)).toEqual({ ok: false, reason: "unsupported" });
  });
});
