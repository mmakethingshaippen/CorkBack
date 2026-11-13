import { describe, it, expect, vi, beforeEach } from "vitest";

let user: { id: string } | null = { id: "user-1" };
let updateResult: { data: { username: string } | null; error: { code: string } | null } = { data: null, error: null };
const updates: { values: unknown; id: unknown }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({
      update: (values: unknown) => ({
        eq: (_col: string, id: unknown) => {
          updates.push({ values, id });
          return { select: () => ({ maybeSingle: async () => updateResult }) };
        },
      }),
    }),
  }),
}));

import { PATCH } from "./route";

const patch = (body: unknown) =>
  PATCH(new Request("http://localhost/api/profile/username", { method: "PATCH", body: JSON.stringify(body) }));

describe("PATCH /api/profile/username", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    user = { id: "user-1" };
    updateResult = { data: null, error: null };
    updates.length = 0;
  });

  it("returns 401 when signed out", async () => {
    user = null;
    expect((await patch({ username: "newname" })).status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("returns 400 for an invalid username and writes nothing", async () => {
    for (const username of ["ab", "has space", "bad-name", "x".repeat(21), 5]) {
      const res = await patch({ username });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_username");
    }
    expect(updates).toHaveLength(0);
  });

  it("returns 409 username_taken when the unique constraint fires", async () => {
    updateResult = { data: null, error: { code: "23505" } };
    const res = await patch({ username: "taken_name" });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "That username is taken. Try another.", code: "username_taken" });
  });

  it("renames the signed in user's own row, lowercased", async () => {
    updateResult = { data: { username: "new_name" }, error: null };
    const res = await patch({ username: "New_Name" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, username: "new_name" });
    expect(updates).toEqual([{ values: { username: "new_name" }, id: "user-1" }]);
  });
});
