import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

let user: { id: string } | null = { id: "user-1" };
const rows = new Set<string>(); // "user:categoryId"
const ops: string[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: (table: string) => {
      if (table === "categories") {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 3 }, error: null }) }) }) };
      }
      return {
        upsert: async (row: { user_id: string; category_id: number }, opts: { ignoreDuplicates?: boolean }) => {
          ops.push(`upsert:${opts.ignoreDuplicates}`);
          rows.add(`${row.user_id}:${row.category_id}`);
          return { error: null };
        },
        delete: () => ({
          eq: (_c: string, uid: string) => ({
            eq: async (_c2: string, cid: number) => {
              ops.push("delete");
              rows.delete(`${uid}:${cid}`);
              return { error: null };
            },
          }),
        }),
        select: () => ({
          eq: (_c: string, uid: string) => ({
            eq: (_c2: string, cid: number) => ({
              maybeSingle: async () => ({ data: rows.has(`${uid}:${cid}`) ? { category_id: cid } : null, error: null }),
            }),
          }),
        }),
      };
    },
  }),
}));

import { PUT } from "./route";

const put = (slug: string, body: unknown) =>
  PUT(new Request(`http://localhost/api/category-follows/${slug}`, { method: "PUT", body: JSON.stringify(body) }), {
    params: Promise.resolve({ slug }),
  });

describe("PUT /api/category-follows/[slug]", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    user = { id: "user-1" };
    rows.clear();
    ops.length = 0;
  });

  it("follows a category, ignoring duplicates, and confirms by reading back", async () => {
    const res = await put("music", { following: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: true });
    expect(ops).toEqual(["upsert:true"]);
  });

  it("unfollows a category", async () => {
    await put("music", { following: true });
    const res = await put("music", { following: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ following: false });
    expect(ops).toEqual(["upsert:true", "delete"]);
  });

  it("returns 404 for an unknown slug and writes nothing", async () => {
    const res = await put("not-a-category", { following: true });
    expect(res.status).toBe(404);
    expect(ops).toHaveLength(0);
  });

  it("returns 401 when signed out", async () => {
    user = null;
    expect((await put("music", { following: true })).status).toBe(401);
  });
});
