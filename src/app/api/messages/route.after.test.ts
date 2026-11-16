import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const THREAD = "11111111-1111-4111-8111-111111111111";
const MESSAGES = [
  { id: "a", sender_id: "u1", body: "one", created_at: "2025-01-01T10:00:00.000Z" },
  { id: "b", sender_id: "u2", body: "two", created_at: "2025-01-01T10:05:00.000Z" },
  { id: "c", sender_id: "u1", body: "three", created_at: "2025-01-01T10:10:00.000Z" },
];

let user: { id: string } | null = { id: "u1" };
let participant = true;
let messageReads = 0;
const gteCalls: Array<[string, string]> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === "message_threads") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: participant ? { id: THREAD } : null }) }) }) };
      }
      messageReads++;
      let lower: string | null = null;
      const builder = {
        select: () => builder,
        eq: () => builder,
        gte: (col: string, val: string) => {
          gteCalls.push([col, val]);
          lower = val;
          return builder;
        },
        order: () => builder,
        then: (resolve: (v: unknown) => unknown) =>
          resolve({
            data: MESSAGES.filter((m) => lower === null || Date.parse(m.created_at) >= Date.parse(lower)),
            error: null,
          }),
      };
      return builder;
    },
  }),
}));

import { GET } from "./route";

const get = (qs: string) => GET(new Request(`http://localhost/api/messages?threadId=${THREAD}${qs}`));

describe("GET /api/messages ?after", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    user = { id: "u1" };
    participant = true;
    messageReads = 0;
    gteCalls.length = 0;
  });

  it("returns the whole thread without after", async () => {
    const res = await get("");
    expect(res.status).toBe(200);
    expect((await res.json()).messages).toHaveLength(3);
    expect(gteCalls).toEqual([]);
  });

  it("includes the message exactly at the after bound", async () => {
    const res = await get(`&after=${encodeURIComponent("2025-01-01T10:05:00.000Z")}`);
    expect(res.status).toBe(200);
    expect((await res.json()).messages.map((m: { id: string }) => m.id)).toEqual(["b", "c"]);
    expect(gteCalls).toEqual([["created_at", "2025-01-01T10:05:00.000Z"]]);
  });

  it("400s on an overlong after without reading messages", async () => {
    const res = await get(`&after=${"2025-01-01T10:05:00.000Z".padEnd(41, "0")}`);
    expect(res.status).toBe(400);
    expect(await res.json()).not.toHaveProperty("messages");
    expect(messageReads).toBe(0);
  });

  it("400s on an unparseable or empty after", async () => {
    for (const qs of ["&after=not-a-date", "&after="]) {
      const res = await get(qs);
      expect(res.status).toBe(400);
      expect(await res.json()).not.toHaveProperty("messages");
    }
    expect(messageReads).toBe(0);
  });

  it("still 404s for a non-participant", async () => {
    participant = false;
    const res = await get(`&after=${encodeURIComponent("2025-01-01T10:05:00.000Z")}`);
    expect(res.status).toBe(404);
    expect(messageReads).toBe(0);
  });
});
