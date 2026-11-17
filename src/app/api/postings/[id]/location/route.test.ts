import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";

const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  fromCalls: 0,
  rpcResult: { data: null, error: null } as { data: unknown; error: { code: string; message: string } | null },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args });
      return h.rpcResult;
    },
    from: () => {
      h.fromCalls++;
      throw new Error("the retry route must not touch tables");
    },
  }),
}));

import { PATCH } from "./route";

const ID = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown, id = ID) =>
  PATCH(new Request("http://localhost/x", { method: "PATCH", body: typeof body === "string" ? body : JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
const LOC = { lat: 41.6, lng: -90.4, confirmed: true, source: "pin", precision: "exact" };

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  h.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.rpcCalls = [];
  h.fromCalls = 0;
  h.rpcResult = { data: null, error: null };
});

/** Feature: posting-location-confirmation, Property 25 (route part). **Validates: Requirements 13.12, 13.14** */
describe("PATCH /api/postings/[id]/location", () => {
  it("sends exactly the location through one rpc call and writes no content column", async () => {
    await fc.assert(
      fc.asyncProperty(fc.double({ min: -85, max: 85, noNaN: true }), fc.double({ min: -179, max: 179, noNaN: true }), fc.constantFrom("exact", "approximate"), async (lat, lng, precision) => {
        h.rpcCalls = [];
        const res = await call({ location: { lat, lng, confirmed: true, source: "search", precision } });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: ID });
        expect(h.rpcCalls).toHaveLength(1);
        expect(h.rpcCalls[0].fn).toBe("cb_update_posting_location");
        expect(Object.keys(h.rpcCalls[0].args).sort()).toEqual(["p_lat", "p_lng", "p_posting_id", "p_precision", "p_time_zone"]);
        expect(h.rpcCalls[0].args).toMatchObject({ p_posting_id: ID, p_lat: lat, p_lng: lng, p_precision: precision });
        expect(h.fromCalls).toBe(0);
      }),
      { numRuns: 100 },
    );
  });

  it("refuses any key other than location", async () => {
    for (const extra of [{ title: "x" }, { real: { lat: 1, lng: 1 } }, { placeLabel: "x" }, { desired: null }]) {
      expect((await call({ location: LOC, ...extra })).status).toBe(400);
    }
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("rejects unusable bodies and unconfirmed locations without a call", async () => {
    for (const body of ["not json", "[]", "null", {}, { location: { ...LOC, confirmed: false } }, { location: { ...LOC, lat: 123 } }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("signed out is 401, a bad id is 404, unconfigured is 501", async () => {
    h.user = null;
    expect((await call({ location: LOC })).status).toBe(401);
    h.user = { id: "11111111-1111-4111-8111-111111111111" };
    expect((await call({ location: LOC }, "nope")).status).toBe(404);
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect((await call({ location: LOC })).status).toBe(501);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it("maps rpc errors", async () => {
    const cases: [string, number, string][] = [
      ["CB404", 409, "unavailable"], ["CB409", 409, "unavailable"], ["22023", 400, "invalid"],
      ["42501", 401, "signed_out"], ["XX000", 500, "location_failed"],
    ];
    for (const [code, status, name] of cases) {
      h.rpcResult = { data: null, error: { code, message: "m" } };
      const res = await call({ location: LOC });
      expect(res.status).toBe(status);
      expect((await res.json()).code).toBe(name);
    }
  });
});
