import { describe, expect, it } from "vitest";
import { diffMarkers } from "./markerDiff";

const m = (id: string) => ({ id, lat: 1, lng: 2 });

describe("diffMarkers", () => {
  it("adds ids with no marker yet", () => {
    const d = diffMarkers([], [m("a"), m("b")]);
    expect(d.add.map((x) => x.id)).toEqual(["a", "b"]);
    expect(d.remove).toEqual([]);
    expect(d.keep).toEqual([]);
  });

  it("removes ids that are no longer wanted", () => {
    const d = diffMarkers(["a", "b"], [m("a")]);
    expect(d.remove).toEqual(["b"]);
    expect(d.add).toEqual([]);
  });

  it("leaves common ids untouched", () => {
    const d = diffMarkers(new Set(["a", "b"]), [m("b"), m("c")]);
    expect(d.keep).toEqual(["b"]);
    expect(d.add.map((x) => x.id)).toEqual(["c"]);
    expect(d.remove).toEqual(["a"]);
  });

  it("returns an empty diff when nothing changed", () => {
    const d = diffMarkers(["a"], [m("a")]);
    expect(d).toEqual({ add: [], remove: [], keep: ["a"] });
  });

  it("collapses duplicate wanted ids", () => {
    const d = diffMarkers([], [m("a"), m("a")]);
    expect(d.add).toHaveLength(1);
  });
});
