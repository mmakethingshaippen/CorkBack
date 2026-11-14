import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

vi.mock("server-only", () => ({}));
import { lookupAvatarPaths } from "@/lib/adminData";

const root = path.resolve(__dirname, "../../..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

/**
 * Every read that names a user must also read that user's photo path, so the
 * same Avatar appears everywhere. A new `profiles...(username)` embed without
 * avatar_path fails here.
 */
describe("avatar_path coverage", () => {
  const files = [
    "src/lib/postings.ts",
    "src/lib/connections.ts",
    "src/lib/follows.ts",
    "src/lib/reactions.ts",
    "src/lib/moderationData.ts",
    "src/lib/auth.ts",
    "src/app/api/postings/[id]/replies/route.ts",
    "src/app/api/users/search/route.ts",
    "src/app/api/messages/threads/route.ts",
    "src/app/inbox/[id]/page.tsx",
  ];
  it.each(files)("%s selects avatar_path wherever it embeds a username", (f) => {
    const src = read(f);
    const embeds = src.match(/profiles![a-z_]+\(([^)]*)\)/g) ?? [];
    for (const e of embeds) expect(e).toContain("avatar_path");
    const direct = src.match(/from\("profiles"\)\s*\.select\("([^"]*)"\)/g) ?? [];
    for (const d of direct) if (d.includes("username")) expect(d).toContain("avatar_path");
    expect(src).toContain("avatar_path");
  });
  it("every PosterHandle call site passes avatarPath", () => {
    const sites = [
      "src/components/ui/PostingCard.tsx",
      "src/components/ui/Replies.tsx",
      "src/components/ui/PostingActions.tsx",
      "src/app/p/[id]/page.tsx",
      "src/app/following/page.tsx",
      "src/app/friends/page.tsx",
      "src/app/friends/FriendsManager.tsx",
    ];
    for (const f of sites) {
      const calls = read(f).match(/<PosterHandle [^>]*\/>/g) ?? [];
      expect(calls.length, f).toBeGreaterThan(0);
      for (const c of calls) expect(c, f).toContain("avatarPath=");
    }
  });
});

describe("lookupAvatarPaths", () => {
  it("makes no request for an empty list", async () => {
    const from = vi.fn();
    expect(await lookupAvatarPaths({ from } as never, [null, undefined, ""])).toEqual({});
    expect(from).not.toHaveBeenCalled();
  });
  it("dedupes and maps usernames to paths; errors give fallbacks", async () => {
    let asked: string[] = [];
    const ok = { from: () => ({ select: () => ({ in: async (_c: string, u: string[]) => { asked = u; return { data: [{ username: "a_b", avatar_path: "p" }, { username: "cc_", avatar_path: null }], error: null }; } }) }) };
    expect(await lookupAvatarPaths(ok as never, ["a_b", "a_b", "cc_"])).toEqual({ a_b: "p", cc_: null });
    expect(asked).toEqual(["a_b", "cc_"]);
    const bad = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { code: "x" } }) }) }) };
    expect(await lookupAvatarPaths(bad as never, ["a_b"])).toEqual({});
  });
});