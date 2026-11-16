import { describe, expect, it, vi } from "vitest";
import { buildMapRequest, createMapRequestModel } from "./mapRequestModel";

const req = (category: string | null = null) =>
  buildMapRequest({
    bounds: { west: -10, south: -10, east: 10, north: 10 },
    category,
    mode: "pins",
  });

describe("world map request model (pins mode)", () => {
  it("is loading while a request is in flight", () => {
    const model = createMapRequestModel<{ id: string }>();
    expect(model.getState().status).toBe("idle");
    model.begin(req());
    expect(model.getState().status).toBe("loading");
  });

  it("applies a successful response", () => {
    const model = createMapRequestModel<{ id: string }>();
    const seq = model.begin(req());
    expect(model.succeed(seq, null, { items: [{ id: "a" }], truncated: false })).toBe(true);
    expect(model.getState()).toMatchObject({ status: "ready", error: null, items: [{ id: "a" }] });
  });

  it("failure keeps previous items and sets an error", () => {
    const model = createMapRequestModel<{ id: string }>();
    const s1 = model.begin(req());
    model.succeed(s1, null, { items: [{ id: "a" }], truncated: false });
    const s2 = model.begin(req());
    expect(model.fail(s2, null, new Error("boom"))).toBe(true);
    expect(model.getState()).toMatchObject({ status: "error", error: "boom", items: [{ id: "a" }] });
  });

  it("uses a default message for errors without one", () => {
    const model = createMapRequestModel<{ id: string }>();
    const s = model.begin(req());
    model.fail(s, null, "nope");
    expect(model.getState().error).toBe("Could not load postings. Try again.");
  });

  it("retry starts a new request and clears the error", () => {
    const model = createMapRequestModel<{ id: string }>();
    const s1 = model.begin(req());
    model.fail(s1, null, new Error("boom"));
    const s2 = model.begin(req());
    expect(s2).toBeGreaterThan(s1);
    expect(model.getState()).toMatchObject({ status: "loading", error: null });
    model.succeed(s2, null, { items: [{ id: "b" }], truncated: false });
    expect(model.getState().status).toBe("ready");
  });

  it("abort by replacement is not an error", () => {
    const model = createMapRequestModel<{ id: string }>();
    const abort = vi.fn();
    const s1 = model.begin(req(), abort);
    const s2 = model.begin(req());
    expect(abort).toHaveBeenCalledTimes(1);
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(model.fail(s1, null, abortErr)).toBe(false);
    // Even a non-abort failure from the replaced request is stale and ignored.
    expect(model.fail(s1, null, new Error("late"))).toBe(false);
    expect(model.getState()).toMatchObject({ status: "loading", error: null });
    expect(model.succeed(s1, null, { items: [{ id: "old" }], truncated: false })).toBe(false);
    expect(model.succeed(s2, null, { items: [], truncated: false })).toBe(true);
  });

  it("a self-abort error on the current request is not applied", () => {
    const model = createMapRequestModel<{ id: string }>();
    const s = model.begin(req());
    const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(model.fail(s, null, abortErr)).toBe(false);
    expect(model.getState().error).toBeNull();
  });
});
