import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({
  client: null as unknown,
  likedCalls: 0,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("@/lib/reactions", () => ({
  getReactionCounts: async (_s: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { likes: 0, going: 0, interested: 0 }])),
  getViewerLikedIds: async (_s: unknown, _u: string, ids: string[]) => {
    h.likedCalls++;
    return new Set(ids.slice(0, 1));
  },
  getViewerPlans: async () => new Map(),
}));

import { GET } from "./route";
import { MAP_CAPS, selectForBounds, snapBoundsOutward, boundsForRadius } from "@/lib/mapBounds";
import { SEED_POSTINGS } from "@/lib/seed";
import { isPostingActive } from "@/lib/lifecycle";
import { endedOver, makeRow, makeStubClient, type StubRow } from "@/lib/__testing__/mapSupabaseStub";

const B = "-122.35,37.8,-122.2,37.95";
const get = (qs: string) => GET(new Request(`http://localhost/api/postings/map?${qs}`));

function use(rows: StubRow[], opts?: Parameters<typeof makeStubClient>[1]) {
  const s = makeStubClient(rows, opts);
  h.client = s.client;
  return s;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
  h.likedCalls = 0;
  use([]);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("GET /api/postings/map validation", () => {
  const badBounds: [string, string][] = [
    ["missing", ""],
    ["malformed", "bounds=a,b,c,d"],
    ["too few parts", "bounds=1,2,3"],
    ["inverted latitude", "bounds=-122.35,37.95,-122.2,37.8"],
    ["inverted longitude", "bounds=-122.2,37.8,-122.35,37.95"],
    ["latitude out of range", "bounds=-122.35,37.8,-122.2,91"],
    ["longitude out of range", "bounds=-181,37.8,-122.2,37.95"],
    ["antimeridian", "bounds=170,10,-170,20"],
  ];
  it.each(badBounds)("400 for %s bounds", async (_n, qs) => {
    const res = await get(qs);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("400 for an unknown category", async () => {
    expect((await get(`bounds=${B}&category=nope`)).status).toBe(400);
  });
  it("400 for an invalid mode", async () => {
    expect((await get(`bounds=${B}&mode=grid`)).status).toBe(400);
  });
});

describe("GET /api/postings/map responses", () => {
  it("defaults to pins mode with the public cache header", async () => {
    use([makeRow(1)]);
    const res = await get(`bounds=${B}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cap).toBe(MAP_CAPS.pins);
    expect(Object.keys(body.items[0]).sort()).toEqual(["categorySlug", "id", "lat", "lng", "title"]);
    expect(res.headers.get("Cache-Control")).toBe("public, s-maxage=30, stale-while-revalidate=60");
  });

  it("cards mode is private, no-store and attaches viewer likes for a signed-in user", async () => {
    use([makeRow(1), makeRow(2)], { user: { id: "u1" } });
    const res = await get(`bounds=${B}&mode=cards`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.cap).toBe(MAP_CAPS.cards);
    expect(body.items[0].viewerLiked).toBe(true);
    expect(h.likedCalls).toBe(1);
  });

  it("pins mode never looks up viewer likes", async () => {
    use([makeRow(1)], { user: { id: "u1" } });
    await get(`bounds=${B}&mode=pins`);
    expect(h.likedCalls).toBe(0);
  });

  it("a failed read gives 500, no-store and no internal detail", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    use([], { error: { code: "XX000", message: "secret-internal-detail" } });
    const res = await get(`bounds=${B}`);
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text).not.toContain("secret-internal-detail");
    expect(text).not.toContain("XX000");
    expect(JSON.parse(text).items).toEqual([]);
  });

  it("returns a posting exactly on the snapped box edge", async () => {
    const s = snapBoundsOutward({ west: -122.349, south: 37.801, east: -122.201, north: 37.951 });
    use([makeRow(1, { lat: s.north, lng: s.east })]);
    const body = await (await get("bounds=-122.349,37.801,-122.201,37.951")).json();
    expect(body.items).toHaveLength(1);
  });

  it("returns a posting exactly 10 mi diagonally NE of a Berkeley centre", async () => {
    const centre = { lat: 37.8715, lng: -122.273 };
    const d = (10 * 1609.344) / 6_371_000;
    const lat1 = (centre.lat * Math.PI) / 180;
    const brg = Math.PI / 4;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 =
      (centre.lng * Math.PI) / 180 +
      Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    use([makeRow(1, { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI })]);
    const b = boundsForRadius(centre, 10);
    const body = await (await get(`bounds=${b.west},${b.south},${b.east},${b.north}`)).json();
    expect(body.items).toHaveLength(1);
  });

  it("seed mode matches selectForBounds over active seed postings", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    vi.useFakeTimers({ toFake: ["Date"] });
    const now = new Date("2026-11-10T00:00:00Z");
    vi.setSystemTime(now);
    const b = { west: -1, south: 50, east: 15, north: 55 };
    const res = await get(`bounds=${b.west},${b.south},${b.east},${b.north}&mode=cards`);
    const body = await res.json();
    const expected = selectForBounds(SEED_POSTINGS.filter((p) => isPostingActive(p, now)), {
      bounds: snapBoundsOutward(b),
      category: null,
      cap: MAP_CAPS.cards,
    });
    expect(body).toEqual(JSON.parse(JSON.stringify(expected)));
    expect(body.items.length).toBeGreaterThan(0);
  });
});

describe("Property 17: Map query result is bounded (route)", () => {
  /**
   * **Validates: Requirements 13.4**
   */
  it("never exceeds MAP_CAPS[mode], reads at most cap + 1 rows per request, and ignores limit and cap parameters", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("pins" as const, "cards" as const),
        fc.array(fc.boolean(), { maxLength: 640 }),
        fc.oneof(fc.integer({ min: -5, max: 5000 }), fc.constant(0)),
        async (mode, endedMask, handMade) => {
          const cap = MAP_CAPS[mode];
          const rows = endedMask.map((ended, i) => makeRow(i, ended ? endedOver() : {}));
          const plain = use(rows);
          const base = await (await get(`bounds=${B}&mode=${mode}`)).json();
          const forged = use(rows);
          const res = await get(`bounds=${B}&mode=${mode}&limit=${handMade}&cap=${handMade}`);
          const body = await res.json();
          expect(body).toEqual(base);
          expect(body.items.length).toBeLessThanOrEqual(cap);
          expect(body.cap).toBe(cap);
          for (const c of [...plain.calls, ...forged.calls]) expect(c.to - c.from + 1).toBeLessThanOrEqual(cap + 1);
          expect(forged.calls.length).toBeLessThanOrEqual(4);
          expect(forged.calls.length).toBe(plain.calls.length);
        },
      ),
      { numRuns: 25 },
    );
  });
});
