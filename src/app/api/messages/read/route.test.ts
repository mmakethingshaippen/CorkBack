import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let user: { id: string } | null = { id: "user-1" };
let rpcResult: { data: unknown; error: { code?: string; message: string } | null } = { data: null, error: null };
const rpcCalls: { name: string; args: unknown }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    rpc: async (name: string, args: unknown) => {
      rpcCalls.push({ name, args });
      return rpcResult;
    },
  }),
}));

import { POST } from "./route";

const THREAD = "123e4567-e89b-12d3-a456-426614174000";
const UPTO = "2024-05-01T12:00:00.123456+00:00";
const post = (body: unknown, raw?: string) =>
  POST(new Request("http://localhost/api/messages/read", { method: "POST", body: raw ?? JSON.stringify(body) }));

describe("POST /api/messages/read", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost";
    user = { id: "user-1" };
    rpcResult = { data: null, error: null };
    rpcCalls.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("returns 401 when signed out", async () => {
    user = null;
    const res = await post({ threadId: THREAD, upTo: UPTO });
    expect(res.status).toBe(401);
    expect(rpcCalls).toEqual([]);
  });

  it("calls cb_mark_thread_read with the client's upTo", async () => {
    const res = await post({ threadId: THREAD, upTo: UPTO });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(rpcCalls).toEqual([{ name: "cb_mark_thread_read", args: { p_thread: THREAD, p_upto: UPTO } }]);
  });

  it("passes no user id: only the caller's session decides whose marker changes", async () => {
    await post({ threadId: THREAD, upTo: UPTO, userId: "someone-else" });
    expect(Object.keys(rpcCalls[0].args as object).sort()).toEqual(["p_thread", "p_upto"]);
  });

  it.each([
    ["bad uuid", { threadId: "nope", upTo: UPTO }],
    ["missing threadId", { upTo: UPTO }],
    ["missing upTo", { threadId: THREAD }],
    ["unparseable upTo", { threadId: THREAD, upTo: "yesterday-ish" }],
    ["upTo too long", { threadId: THREAD, upTo: "2024-05-01T12:00:00.000000000000000000000000000Z" }],
    ["non-string upTo", { threadId: THREAD, upTo: 12345 }],
  ])("returns 400 for %s", async (_n, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(rpcCalls).toEqual([]);
  });

  it("returns 400 for a malformed body", async () => {
    expect((await post(null, "{not json")).status).toBe(400);
  });

  it("returns 404 for a non-participant (42501)", async () => {
    rpcResult = { data: null, error: { code: "42501", message: "not a participant" } };
    const res = await post({ threadId: THREAD, upTo: UPTO });
    expect(res.status).toBe(404);
  });

  it("returns { supported: false } with 200 when the function is missing", async () => {
    rpcResult = { data: null, error: { code: "PGRST202", message: "missing" } };
    const res = await post({ threadId: THREAD, upTo: UPTO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ supported: false });
  });

  it("returns 500 for other failures", async () => {
    rpcResult = { data: null, error: { code: "XX000", message: "boom" } };
    expect((await post({ threadId: THREAD, upTo: UPTO })).status).toBe(500);
  });
});
