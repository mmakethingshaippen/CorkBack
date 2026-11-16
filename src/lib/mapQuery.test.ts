import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";

vi.mock("server-only", () => ({}));

const h = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("./supabase/server", () => ({ createClient: async () => h.client }));
vi.mock("./reactions", () => ({
  getReactionCounts: async (_s: unknown, ids: string[]) =>
    new Map(ids.map((id) => [id, { likes: 2, going: 1, interested: 0 }])),
  getViewerLikedIds: async () => new Set<string>(),
  getViewerPlans: async () => new Map(),
}));

import { queryPostingsInBounds } from "./mapQuery";
import { MAP_CAPS, selectForBounds, snapBoundsOutward, boundsForRadius } from "./mapBounds";
import { SEED_POSTINGS } from "./seed";
import { isPostingActive } from "./lifecycle";
import { endedOver, makeRow, makeStubClient, type StubRow } from "./__testing__/mapSupabaseStub";

const BOUNDS = { west: -122.35, south: 37.8, east: -122.2, north: 37.95 };

function use(rows: StubRow[], opts?: Parameters<typeof makeStubClient>[1]) {
  const s = makeStubClient(rows, opts);
  h.client = s.client;
  return s;
}

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-test";
});
afterEach(() => vi.restoreAllMocks());

describe("queryPostingsInBounds (stubbed Supabase)", () => {
  it("pins mode returns slim pins and at most MAP_CAPS.pins", async () => {
    const { calls } = use(Array.from({ length: 305 }, (_, i) => makeRow(i)));
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "pins" });
    expect(r.cap).toBe(MAP_CAPS.pins);
    expect(r.items).toHaveLength(300);
    expect(r.truncated).toBe(true);
    expect(Object.keys(r.items[0]).sort()).toEqual(["categorySlug", "id", "lat", "lng", "title"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].to - calls[0].from + 1).toBe(301);
  });

  it("cards mode returns full postings with counts, capped at 100", async () => {
    use(Array.from({ length: 101 }, (_, i) => makeRow(i)));
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "cards" });
    expect(r.items).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect((r.items[0] as { likeCount: number }).likeCount).toBe(2);
  });

  it("is not truncated when exactly cap rows match", async () => {
    use(Array.from({ length: 100 }, (_, i) => makeRow(i)));
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "cards" });
    expect(r.items).toHaveLength(100);
    expect(r.truncated).toBe(false);
  });

  it("drops ended events without a short page while more active rows exist", async () => {
    // 100 ended rows are newest, then 150 active ones. Page 1 (101 rows) holds no active rows.
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => makeRow(i, endedOver())),
      ...Array.from({ length: 150 }, (_, i) => makeRow(100 + i)),
    ];
    const { calls } = use(rows);
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "cards" });
    expect(r.items).toHaveLength(100);
    expect(r.truncated).toBe(true);
    expect(calls.length).toBeGreaterThan(1);
    expect(r.items.every((p) => !("expiresAt" in p) || isPostingActive(p as never))).toBe(true);
  });

  it("reads at most 4 pages and reports truncated when the page limit is hit", async () => {
    const rows = Array.from({ length: 600 }, (_, i) => makeRow(i, endedOver()));
    const { calls } = use(rows);
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "cards" });
    expect(calls).toHaveLength(4);
    expect(r.items).toHaveLength(0);
    expect(r.truncated).toBe(true);
  });

  it("applies inclusive gte/lte filters with the snapped (expanded) bounds", async () => {
    const { calls } = use([]);
    await queryPostingsInBounds({ bounds: { west: -122.349, south: 37.801, east: -122.201, north: 37.951 }, category: null, mode: "pins" });
    const f = calls[0].filters.filter((x) => ["gte", "lte"].includes(x.op));
    expect(f).toEqual([
      { op: "gte", col: "lat", val: 37.8 },
      { op: "lte", col: "lat", val: 38 },
      { op: "gte", col: "lng", val: -122.4 },
      { op: "lte", col: "lng", val: -122.2 },
    ]);
  });

  it("includes a posting exactly on the snapped box edge", async () => {
    const raw = { west: -122.349, south: 37.801, east: -122.201, north: 37.951 };
    const s = snapBoundsOutward(raw);
    use([makeRow(1, { lat: s.north, lng: s.east }), makeRow(2, { lat: s.south, lng: s.west }), makeRow(3, { lat: s.north + 0.001, lng: s.east })]);
    const r = await queryPostingsInBounds({ bounds: raw, category: null, mode: "pins" });
    expect(r.items.map((p) => p.id).sort()).toEqual(["row-00001", "row-00002"]);
  });

  it("includes a posting exactly 10 mi diagonally NE of a Berkeley centre", async () => {
    const centre = { lat: 37.8715, lng: -122.273 };
    const d = (10 * 1609.344) / 6_371_000;
    const lat1 = (centre.lat * Math.PI) / 180;
    const brg = Math.PI / 4;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brg));
    const lng2 =
      (centre.lng * Math.PI) / 180 +
      Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    use([makeRow(1, { lat: (lat2 * 180) / Math.PI, lng: (lng2 * 180) / Math.PI })]);
    const r = await queryPostingsInBounds({ bounds: boundsForRadius(centre, 10), category: null, mode: "pins" });
    expect(r.items).toHaveLength(1);
  });

  it("filters by category using an inner join on the embed", async () => {
    const { calls } = use([makeRow(1), makeRow(2, { categories: { slug: "music" } })]);
    const r = await queryPostingsInBounds({ bounds: BOUNDS, category: "music", mode: "pins" });
    expect(r.items.map((p) => p.id)).toEqual(["row-00002"]);
    expect(calls[0].columns).toContain("categories!inner(slug)");
  });

  it("throws a readable error and no data when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    use([], { error: { code: "XX000", message: "boom" } });
    await expect(queryPostingsInBounds({ bounds: BOUNDS, category: null, mode: "pins" })).rejects.toThrow(/Failed to load postings/);
  });
});

describe("queryPostingsInBounds (seed mode)", () => {
  it("matches selectForBounds over the active seed postings", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const now = new Date("2026-11-10T00:00:00Z");
    const b = { west: -1, south: 50, east: 15, north: 55 };
    const r = await queryPostingsInBounds({ bounds: b, category: null, mode: "cards" }, now);
    const expected = selectForBounds(SEED_POSTINGS.filter((p) => isPostingActive(p, now)), {
      bounds: snapBoundsOutward(b),
      category: null,
      cap: 100,
    });
    expect(r).toEqual(expected);
    expect(r.items.length).toBeGreaterThan(0);
  });
});

describe("Property 17: Map query result is bounded", () => {
  /**
   * **Validates: Requirements 13.4**
   */
  it("never exceeds MAP_CAPS[mode]; every read spans at most cap + 1 rows; at most 4 reads", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("pins" as const, "cards" as const),
        fc.array(fc.boolean(), { maxLength: 640 }),
        async (mode, endedMask) => {
          const cap = MAP_CAPS[mode];
          const rows = endedMask.map((ended, i) => makeRow(i, ended ? endedOver() : {}));
          const { calls } = use(rows);
          const r = await queryPostingsInBounds({ bounds: BOUNDS, category: null, mode });
          const activeCount = endedMask.filter((e) => !e).length;
          const pageLimitReachable = rows.length > 3 * (cap + 1);
          expect(r.items.length).toBeLessThanOrEqual(cap);
          expect(r.cap).toBe(cap);
          expect(calls.length).toBeLessThanOrEqual(4);
          for (const c of calls) expect(c.to - c.from + 1).toBeLessThanOrEqual(cap + 1);
          if (!pageLimitReachable) {
            expect(r.items.length).toBe(Math.min(activeCount, cap));
            expect(r.truncated).toBe(activeCount > cap);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
