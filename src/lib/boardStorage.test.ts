import { describe, expect, it } from "vitest";
import {
  parseSavedCenter,
  parseStoredRadius,
  readRadius,
  readSavedCenter,
  writeRadius,
  writeSavedCenter,
} from "./boardStorage";

const throwing = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

function memory(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("stored radius", () => {
  it("accepts only the five options", () => {
    for (const r of [1, 3, 5, 10, 25]) expect(parseStoredRadius(String(r))).toBe(r);
    for (const bad of ["2", "0", "-5", "10.5", "abc", "", null, "26"]) expect(parseStoredRadius(bad)).toBeNull();
  });
  it("round-trips and ignores invalid stored values", () => {
    const s = memory();
    expect(writeRadius(5, s)).toBe(true);
    expect(readRadius(s)).toBe(5);
    expect(readRadius(memory({ "corkback.radiusMiles": "7" }))).toBeNull();
    expect(writeRadius(7, s)).toBe(false);
  });
});

describe("saved centre", () => {
  it("reads old shapes: with town as town, without as saved", () => {
    expect(parseSavedCenter('{"lat":1,"lng":2,"zoom":13,"town":"Berkeley"}')?.kind).toBe("town");
    expect(parseSavedCenter('{"lat":1,"lng":2}')?.kind).toBe("saved");
    expect(parseSavedCenter('{"lat":1,"lng":2,"town":null}')?.kind).toBe("saved");
  });
  it("keeps a valid kind and rejects bad data", () => {
    expect(parseSavedCenter('{"lat":1,"lng":2,"kind":"device"}')?.kind).toBe("device");
    expect(parseSavedCenter('{"lat":1,"lng":2,"kind":"bogus"}')?.kind).toBe("saved");
    expect(parseSavedCenter("not json")).toBeNull();
    expect(parseSavedCenter('{"lat":"1","lng":2}')).toBeNull();
    expect(parseSavedCenter(null)).toBeNull();
  });
  it("round-trips through storage", () => {
    const s = memory();
    expect(writeSavedCenter({ lat: 1, lng: 2, town: "Oakland", kind: "town" }, s)).toBe(true);
    expect(readSavedCenter(s)).toMatchObject({ lat: 1, lng: 2, town: "Oakland", kind: "town" });
  });
});

describe("storage failure", () => {
  it("falls back without throwing", () => {
    expect(readRadius(throwing)).toBeNull();
    expect(writeRadius(5, throwing)).toBe(false);
    expect(readSavedCenter(throwing)).toBeNull();
    expect(writeSavedCenter({ lat: 1, lng: 2 }, throwing)).toBe(false);
    expect(readRadius(null)).toBeNull();
  });
});
