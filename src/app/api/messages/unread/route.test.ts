import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let user: { id: string } | null = { id: "user-1" };
let rpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: [], error: null };
const rpcCalls: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string) => {
      rpcCalls.push(name);
      return rpcResult;
    },
  }),
}));

import { GET } from "./route";

describe("GET /api/messages/unread", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
    user = { id: "user-1" };
    rpcResult = { data: [], error: null };
    rpcCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 401 when signed out, without calling the database", async () => {
    user = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it("returns counts, total and no-store", async () => {
    rpcResult = {
      data: [
        { thread_id: "t1", unread: 2 },
        { thread_id: "t2", unread: 0 },
        { thread_id: "t3", unread: 3 },
      ],
      error: null,
    };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ supported: true, total: 5, byThread: { t1: 2, t2: 0, t3: 3 } });
    expect(rpcCalls).toEqual(["cb_unread_counts"]);
  });

  it("returns zero totals for no threads", async () => {
    expect(await (await GET()).json()).toEqual({ supported: true, total: 0, byThread: {} });
  });

  it.each(["42P01", "PGRST202", "PGRST205"])("returns { supported: false } with 200 for %s", async (code) => {
    rpcResult = { data: null, error: { code, message: "missing" } };
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ supported: false });
  });

  it("returns an error status without a supported flag for other failures", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "boom" } };
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).not.toHaveProperty("supported");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
