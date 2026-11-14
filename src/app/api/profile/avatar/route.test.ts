import { describe, it, expect, vi, beforeEach } from "vitest";
import fc from "fast-check";
import sharp from "sharp";

vi.mock("server-only", () => ({}));

type Call = { kind: string; args: unknown };
let sessionUser: { id: string } | null = null;
let calls: Call[] = [];
let failures: Partial<Record<"rate" | "upload" | "set" | "clear" | "remove" | "list", { code?: string; message?: string }>> = {};
let oldPath: string | null = null;
let listed: { name: string; created_at: string }[] = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: sessionUser } }) } }),
  createAdminClient: () => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ kind: `rpc:${fn}`, args });
      const key = fn === "cb_avatar_rate_check" ? "rate" : fn === "cb_set_avatar" ? "set" : "clear";
      const err = failures[key as "rate" | "set" | "clear"];
      if (err) return { data: null, error: err };
      return { data: fn === "cb_avatar_rate_check" ? null : oldPath, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, data: Buffer, opts: unknown) => {
          calls.push({ kind: "upload", args: { bucket, path, size: data.length, opts } });
          return { error: failures.upload ?? null };
        },
        remove: async (paths: string[]) => {
          calls.push({ kind: "remove", args: { bucket, paths } });
          return { error: failures.remove ?? null };
        },
        list: async (folder: string) => {
          calls.push({ kind: "list", args: { bucket, folder } });
          return { data: failures.list ? null : listed, error: failures.list ?? null };
        },
      }),
    },
  }),
}));

import { POST, DELETE } from "./route";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const OLD = `${A}/33333333-3333-4333-8333-333333333333.webp`;

let png: Buffer;
async function req(opts: { file?: Blob | null; extra?: Record<string, string>; query?: string; headers?: Record<string, string> } = {}) {
  const form = new FormData();
  if (opts.file !== null) form.set("file", opts.file ?? new File([png], "me.png", { type: "image/png" }));
  for (const [k, v] of Object.entries(opts.extra ?? {})) form.set(k, v);
  return POST(new Request(`http://localhost/api/profile/avatar${opts.query ?? ""}`, { method: "POST", body: form, headers: opts.headers }));
}
const uploads = () => calls.filter((c) => c.kind === "upload").map((c) => c.args as { path: string; opts: Record<string, unknown> });
const rpcUsers = () => calls.filter((c) => c.kind.startsWith("rpc:")).map((c) => (c.args as { p_user: string }).p_user);

beforeEach(async () => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
  sessionUser = { id: A };
  calls = [];
  failures = {};
  oldPath = null;
  listed = [];
  png ??= await sharp({ create: { width: 600, height: 400, channels: 3, background: "#1F2E4D" } }).png().toBuffer();
});

describe("Property 5: the target is always the session user", () => {
  it("ignores user ids, usernames and paths in body, query and headers", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(B, "mculbeaux", `${B}/x.webp`, "../../etc"),
        fc.constantFrom("user_id", "userId", "p_user", "id", "username", "path", "p_path", "target"),
        async (foreign, field) => {
          calls = [];
          const res = await req({ extra: { [field]: foreign }, query: `?${field}=${encodeURIComponent(foreign)}&user=${B}`, headers: { "x-user-id": B, "x-target-user": foreign } });
          expect(res.status).toBe(200);
          expect(rpcUsers().every((u) => u === A)).toBe(true);
          expect(uploads().every((u) => u.path.startsWith(`${A}/`))).toBe(true);
          const set = calls.find((c) => c.kind === "rpc:cb_set_avatar")!.args as { p_path: string };
          expect(set.p_path.startsWith(`${A}/`)).toBe(true);
          expect(JSON.stringify(calls)).not.toContain(B);
        },
      ),
      { numRuns: 20 },
    );
  }, 60_000);

  it("DELETE clears only the session user's photo", async () => {
    oldPath = OLD;
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(rpcUsers()).toEqual([A]);
    expect(calls.find((c) => c.kind === "remove")!.args).toEqual({ bucket: "avatars", paths: [OLD] });
  });

  it("never deletes an old path from another user's folder", async () => {
    oldPath = `${B}/33333333-3333-4333-8333-333333333333.webp`;
    await DELETE();
    expect(calls.some((c) => c.kind === "remove")).toBe(false);
  });

  it("signed out: 401 for POST and DELETE and nothing is called", async () => {
    sessionUser = null;
    expect((await req()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe("Property 6: failure never loses the current photo", () => {
  it("after a failed database update the new file is removed and the old one kept", async () => {
    for (const code of ["42501", "P0002", "22023", "XX000"]) {
      calls = [];
      oldPath = OLD;
      failures = { set: { code } };
      const res = await req();
      expect(res.status).toBe(500);
      const up = uploads()[0];
      const removed = calls.filter((c) => c.kind === "remove").flatMap((c) => (c.args as { paths: string[] }).paths);
      expect(removed).toEqual([up.path]);
      expect(removed).not.toContain(OLD);
    }
  });
  it("a failed upload touches no database row and deletes nothing", async () => {
    oldPath = OLD;
    failures = { upload: { message: "boom" } };
    expect((await req()).status).toBe(500);
    expect(calls.some((c) => c.kind === "rpc:cb_set_avatar" || c.kind === "remove")).toBe(false);
  });
  it("cleanup failures do not turn success into an error", async () => {
    oldPath = OLD;
    failures = { remove: { message: "nope" }, list: { message: "nope" } };
    expect((await req()).status).toBe(200);
  });
  it("replacement deletes the old object and sweeps only stale files", async () => {
    oldPath = OLD;
    const now = Date.now();
    listed = [
      { name: "44444444-4444-4444-8444-444444444444.webp", created_at: new Date(now - 60 * 60 * 1000).toISOString() },
      { name: "55555555-5555-4555-8555-555555555555.webp", created_at: new Date(now - 60 * 1000).toISOString() },
    ];
    const res = await req();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.path).not.toBe(OLD);
    expect(body.url).toBe(`https://example.supabase.co/storage/v1/object/public/avatars/${body.path}`);
    const removed = calls.filter((c) => c.kind === "remove").map((c) => (c.args as { paths: string[] }).paths);
    expect(removed).toEqual([[OLD], [`${A}/44444444-4444-4444-8444-444444444444.webp`]]);
  });
});

describe("Property 8: rate-check outcome mapping", () => {
  it("CB429 -> 429 with Retry-After; any other failure -> 503; never processes or uploads", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("CB429", "PGRST202", "42883", "57014", "XX000"), async (code) => {
        calls = [];
        failures = { rate: { code } };
        const res = await req();
        if (code === "CB429") {
          expect(res.status).toBe(429);
          expect(res.headers.get("retry-after")).toBe("600");
        } else expect(res.status).toBe(503);
        expect(uploads()).toEqual([]);
      }),
      { numRuns: 10 },
    );
  });
  it("prechecked failures never consume allowance; DELETE never calls the rate check", async () => {
    await req({ file: new File([Buffer.from("GIF89a")], "a.gif", { type: "image/gif" }) });
    oldPath = OLD;
    await DELETE();
    expect(calls.some((c) => c.kind === "rpc:cb_avatar_rate_check")).toBe(false);
  });
});

describe("route examples", () => {
  it("successful upload: WebP, upsert false, long cache, path under the user", async () => {
    const res = await req();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const [u] = uploads();
    expect(u.path).toMatch(new RegExp(`^${A}/[0-9a-f-]{36}\\.webp$`));
    expect(u.opts).toEqual({ contentType: "image/webp", cacheControl: "31536000", upsert: false });
    expect(calls.map((c) => c.kind).slice(0, 3)).toEqual(["rpc:cb_avatar_rate_check", "upload", "rpc:cb_set_avatar"]);
  });
  it("invalid declared type -> 415", async () => {
    const res = await req({ file: new File([png], "a.svg", { type: "image/svg+xml" }) });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe("unsupported_type");
  });
  it("2 MiB + 1 byte -> 413", async () => {
    const res = await req({ file: new File([Buffer.alloc(2 * 1024 * 1024 + 1)], "a.png", { type: "image/png" }) });
    expect(res.status).toBe(413);
    expect(uploads()).toEqual([]);
  });
  it("text renamed to .png -> 422 not_an_image, nothing uploaded", async () => {
    const res = await req({ file: new File([Buffer.from("just some text, not an image")], "a.png", { type: "image/png" }) });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("not_an_image");
    expect(uploads()).toEqual([]);
  });
  it("GIF bytes declared as PNG -> 415", async () => {
    const gif = await sharp({ create: { width: 64, height: 64, channels: 3, background: "#fff" } }).gif().toBuffer();
    const res = await req({ file: new File([gif], "a.png", { type: "image/png" }) });
    expect(res.status).toBe(415);
  });
  it("missing file -> 400", async () => {
    expect((await req({ file: null })).status).toBe(400);
  });
  it("oversized Content-Length is refused before reading", async () => {
    const res = await POST(new Request("http://localhost/api/profile/avatar", { method: "POST", body: "x", headers: { "content-length": String(5 * 1024 * 1024) } }));
    expect(res.status).toBe(413);
  });
  it("remove before stage 10b is applied fails closed with 503", async () => {
    failures = { clear: { code: "PGRST202" } };
    expect((await DELETE()).status).toBe(503);
  });
});

describe("crop field", () => {
  it("accepts a valid crop and a missing crop", async () => {
    expect((await req({ extra: { crop: JSON.stringify({ x: 0.2, y: 0, size: 0.8 }) } })).status).toBe(200);
    expect((await req()).status).toBe(200);
  });

  it("rejects a malformed crop with 400 before touching the database or Storage", async () => {
    for (const crop of ["not json", '{"x":"a","y":0,"size":1}', '{"x":0,"y":0,"size":0}', "[1,2,3]"]) {
      calls = [];
      const res = await req({ extra: { crop } });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid_crop");
      expect(calls).toEqual([]);
    }
  });

  it("clamps an out-of-range crop instead of failing", async () => {
    expect((await req({ extra: { crop: JSON.stringify({ x: 99, y: -99, size: 99 }) } })).status).toBe(200);
  });
});
