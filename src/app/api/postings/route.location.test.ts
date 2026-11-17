import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  inserts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (_fn: string, args: { p_tz: string }) => ({ data: args.p_tz, error: null }),
    from: () => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.single = async () => ({ data: { id: "cat-1" } });
      b.insert = (row: Record<string, unknown>) => {
        h.inserts.push(row);
        return { select: () => ({ single: async () => ({ data: { id: "new-id" }, error: null }) }) };
      };
      return b;
    },
  }),
}));

import { POST } from "./route";

const call = (body: unknown) => POST(new Request("http://localhost/api/postings", { method: "POST", body: JSON.stringify(body) }));
const base = { title: "Show", categorySlug: "music", eventDate: "2090-05-01", expiry: "1m" };
const loc = (lat: number, lng: number, precision = "exact") => ({ lat, lng, confirmed: true, source: "search", precision });

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  h.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.inserts = [];
});

/** Feature: posting-location-confirmation. **Validates: Requirements 12.6, 12.7** */
describe("POST /api/postings location", () => {
  it("writes lat, lng and location_precision from the confirmed location, and nothing else about it", async () => {
    await fc.assert(
      fc.asyncProperty(fc.double({ min: 30, max: 48, noNaN: true }), fc.double({ min: -120, max: -75, noNaN: true }), fc.constantFrom("exact", "approximate"), async (lat, lng, precision) => {
        h.inserts = [];
        const res = await call({ ...base, location: loc(lat, lng, precision) });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "new-id" });
        expect(h.inserts).toHaveLength(1);
        expect(h.inserts[0]).toMatchObject({ lat, lng, location_precision: precision });
        for (const k of ["source", "confirmed", "location", "real", "desired"]) expect(h.inserts[0]).not.toHaveProperty(k);
      }),
      { numRuns: 100 },
    );
  });

  it("rejects a missing, unconfirmed or retired real/desired location with 400 and no insert", async () => {
    for (const body of [
      base,
      { ...base, location: { ...loc(41.5, -90.5), confirmed: false } },
      { ...base, real: { lat: 41.5, lng: -90.5 } },
      { ...base, categorySlug: "jobs", eventDate: undefined, desired: { lat: 41.5, lng: -90.5 } },
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(h.inserts).toHaveLength(0);
  });

  it("signed out is 401 with no insert", async () => {
    h.user = null;
    expect((await call({ ...base, location: loc(41.5, -90.5) })).status).toBe(401);
    expect(h.inserts).toHaveLength(0);
  });
});
