import { describe, expect, it, vi } from "vitest";
import {
  MESSAGES,
  buildLookup,
  buildRetryBody,
  canStartLookup,
  failureForState,
  runLookup,
} from "./locationPickerActions";
import { OSM_ATTRIBUTION_HTML, PICKER_MAP_STYLE } from "./pickerMapStyle";
import { emptyDraft, locationReducer } from "@/lib/postingLocation";

const ok = (body: unknown) => vi.fn(async () => ({ json: async () => body }));

describe("locationPickerActions", () => {
  it("makes no request on typing: only runLookup can call fetch", () => {
    const f = ok({ state: "ok", matches: [] });
    buildLookup("12 Main Street");
    canStartLookup(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("builds a lookup that sends only the prepared text", async () => {
    const f = ok({ state: "ok", matches: [] });
    const out = await runLookup("  12   Main  Street ", false, f);
    expect(out).toEqual({ status: "ok", matches: [] });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/api/geocode?q=12%20Main%20Street");
  });

  it("refuses a query with a phone number without calling fetch", async () => {
    const f = ok({ state: "ok", matches: [] });
    const out = await runLookup("12 Main St call 555-867-5309", false, f);
    expect(f).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "invalid", failure: { kind: "refused", message: MESSAGES.refused } });
  });

  it("does not call fetch for a too-short query", async () => {
    const f = ok({});
    const out = await runLookup("ab", false, f);
    expect(f).not.toHaveBeenCalled();
    expect(out).toMatchObject({ status: "invalid", failure: null });
  });

  it("ignores a lookup while one is in flight", async () => {
    const f = ok({ state: "ok", matches: [] });
    expect(await runLookup("12 Main Street", true, f)).toEqual({ status: "skipped" });
    expect(f).not.toHaveBeenCalled();
  });

  it("maps route states to kinds and messages", () => {
    expect(failureForState("ok")).toBeNull();
    expect(failureForState("busy")).toEqual({ kind: "busy", message: MESSAGES.busy });
    expect(failureForState("user_limit")).toEqual({ kind: "busy", message: MESSAGES.userLimit });
    expect(failureForState("query_refused")).toEqual({ kind: "refused", message: MESSAGES.refused });
    expect(failureForState("private_home_refused")).toEqual({
      kind: "private_home",
      message: MESSAGES.privateHomeSearch,
    });
    expect(failureForState("unavailable")).toEqual({ kind: "unavailable", message: MESSAGES.unavailable });
    expect(failureForState(undefined)?.kind).toBe("unavailable");
  });

  it("adds home=1 for a private-home lookup and sends only the prepared text", async () => {
    const f = ok({ state: "ok", matches: [] });
    const out = await runLookup("  12   Main  Street ", false, f, true);
    expect(out).toEqual({ status: "ok", matches: [] });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f).toHaveBeenCalledWith("/api/geocode?q=12%20Main%20Street&home=1");
  });

  it("flags a private-home refusal so the picker can switch to manual placement", async () => {
    const f = ok({ state: "private_home_refused" });
    const out = await runLookup("12 Main Street", false, f, true);
    expect(out).toMatchObject({
      status: "failed",
      privateHomeRefused: true,
      failure: { kind: "private_home", message: MESSAGES.privateHomeSearch },
    });
  });

  it("turns a network error or a failed state into a failure", async () => {
    const boom = vi.fn(async () => {
      throw new Error("net");
    });
    expect(await runLookup("12 Main Street", false, boom)).toMatchObject({ status: "failed", failure: { kind: "unavailable" } });
    expect(await runLookup("12 Main Street", false, ok({ state: "busy" }))).toMatchObject({
      status: "failed",
      failure: { kind: "busy" },
    });
  });

  it("builds a Retry body with only the location key, and none without a confirmed pin", () => {
    expect(buildRetryBody(emptyDraft())).toBeNull();
    let d = locationReducer(emptyDraft(), { type: "pin_placed", point: { lat: 40, lng: -75 } });
    d = locationReducer(d, { type: "proposal_confirmed", rand: [0.1, 0.2] });
    const body = buildRetryBody(d);
    expect(Object.keys(body!)).toEqual(["location"]);
    expect(body!.location).toMatchObject({ lat: 40, lng: -75, confirmed: true, precision: "exact" });
  });

  it("links the OSM copyright in the tile source attribution", () => {
    expect(OSM_ATTRIBUTION_HTML).toContain('href="https://www.openstreetmap.org/copyright"');
    const src = PICKER_MAP_STYLE.sources.osm as { attribution?: string };
    expect(src.attribution).toBe(OSM_ATTRIBUTION_HTML);
  });
});
