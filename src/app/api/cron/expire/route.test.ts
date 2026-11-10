import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Records every query-builder call so the test can prove the job never writes.
const calls: string[] = [];
let result: { count: number | null; error: { message: string } | null } = { count: 0, error: null };

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => {
    const builder: Record<string, unknown> = {};
    for (const m of ["select", "is", "or", "eq", "lt", "lte", "update", "delete", "insert", "upsert"]) {
      builder[m] = (...args: unknown[]) => {
        calls.push(`${m}(${JSON.stringify(args)})`);
        return builder;
      };
    }
    builder.then = (resolve: (v: unknown) => unknown) => resolve(result);
    return {
      from: (table: string) => {
        calls.push(`from(${table})`);
        return builder;
      },
    };
  },
}));

import { GET } from "./route";

const req = (auth?: string) =>
  new Request("http://localhost/api/cron/expire", { headers: auth ? { authorization: auth } : {} });

describe("expiry cron (read-only)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    calls.length = 0;
    result = { count: 0, error: null };
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("rejects a missing or wrong secret (401) and touches nothing", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it("rejects when CRON_SECRET is unset, even with an empty bearer", async () => {
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
  });

  it("returns 501 when the database is not configured", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await GET(req("Bearer test-cron-secret"))).status).toBe(501);
    expect(calls).toEqual([]);
  });

  it("counts past-takedown postings and never updates, deletes, or inserts", async () => {
    result = { count: 2, error: null };
    const res = await GET(req("Bearer test-cron-secret"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: 0, pastTakedown: 2 });
    expect(calls[0]).toBe("from(postings)");
    expect(calls.some((c) => /^(update|delete|insert|upsert)\(/.test(c))).toBe(false);
    expect(calls.some((c) => c.startsWith('select(["id",{"count":"exact","head":true}]'))).toBe(true);
  });

  it("reports a database error as 500", async () => {
    result = { count: null, error: { message: "boom" } };
    expect((await GET(req("Bearer test-cron-secret"))).status).toBe(500);
  });
});
