import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_INPUT_PIXELS, MIN_DIMENSION, ORPHAN_AGE_MS } from "./constants";
import { avatarControls, canManageAvatar, checkDimensions, precheckFile } from "./validate";
import { buildAvatarPath, parseAvatarPath } from "./path";
import { avatarInitial, avatarUrl } from "./url";
import { selectOrphans } from "./orphans";
import { AVATAR_ERRORS, avatarErrorMessage } from "./errors";

const uuid = fc.uuid().map((u) => u.toLowerCase());
const anyType = fc.oneof(
  fc.constantFrom(...ALLOWED_TYPES, "image/gif", "image/svg+xml", "text/plain", "application/octet-stream", "", "IMAGE/PNG", "image/heic"),
  fc.string(),
);

describe("Property 1: upload precheck accepts exactly valid files", () => {
  it("accepts iff type is allowed and 0 < size <= 2 MiB", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10, max: MAX_FILE_BYTES * 2 }), anyType, (size, type) => {
        const r = precheckFile({ size, type });
        const valid = size > 0 && size <= MAX_FILE_BYTES && (ALLOWED_TYPES as readonly string[]).includes(type);
        expect(r === null).toBe(valid);
        if (size <= 0) expect(r).toBe("no_file");
      }),
    );
  });
  it("boundaries", () => {
    expect(precheckFile({ size: MAX_FILE_BYTES, type: "image/png" })).toBeNull();
    expect(precheckFile({ size: MAX_FILE_BYTES + 1, type: "image/png" })).toBe("too_large");
    expect(precheckFile({ size: 10, type: "image/gif" })).toBe("unsupported_type");
    expect(precheckFile({ size: 10, type: "image/svg+xml" })).toBe("unsupported_type");
    expect(precheckFile(null)).toBe("no_file");
  });
});

describe("Property 2: dimension rule", () => {
  it("rejects too small and too many pixels, accepts the rest", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20000 }), fc.integer({ min: 1, max: 20000 }), (w, h) => {
        const r = checkDimensions(w, h);
        if (w * h > MAX_INPUT_PIXELS) expect(r).toBe("too_many_pixels");
        else if (w < MIN_DIMENSION || h < MIN_DIMENSION) expect(r).toBe("too_small");
        else expect(r).toBeNull();
      }),
    );
  });
  it("accepts typical phone photos (12, 48 MP) and refuses non-images", () => {
    expect(checkDimensions(4032, 3024)).toBeNull();
    expect(checkDimensions(8000, 6000)).toBeNull();
    expect(checkDimensions(8192, 6144)).toBe("too_many_pixels");
    expect(checkDimensions(0, 10)).toBe("not_an_image");
    expect(checkDimensions(31, 500)).toBe("too_small");
  });
});

describe("Property 3: avatar path builder and parser round trip", () => {
  it("round trips and always starts with the user id", () => {
    fc.assert(
      fc.property(uuid, uuid, (u, f) => {
        const p = buildAvatarPath(u, f);
        expect(p).toBe(`${u}/${f}.webp`);
        expect(parseAvatarPath(p)).toEqual({ userId: u, fileId: f, ext: "webp" });
      }),
    );
  });
  it("refuses non-uuid input and rejects traversal or foreign shapes", () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        fc.pre(!/^[0-9a-f-]{36}$/.test(s));
        expect(() => buildAvatarPath(s, "00000000-0000-4000-8000-000000000000")).toThrow();
      }),
    );
    for (const bad of ["../x.webp", "a/b.webp", "00000000-0000-4000-8000-000000000000/../x.webp", "00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.gif", "", null, 42]) {
      expect(parseAvatarPath(bad)).toBeNull();
    }
  });
});

describe("Property 9: avatar URL and fallback", () => {
  it("builds the public URL only for valid paths", () => {
    fc.assert(
      fc.property(uuid, uuid, (u, f) => {
        const p = `${u}/${f}.webp`;
        expect(avatarUrl(p, "https://x.supabase.co/")).toBe(`https://x.supabase.co/storage/v1/object/public/avatars/${p}`);
      }),
    );
    fc.assert(fc.property(fc.string(), (s) => { fc.pre(parseAvatarPath(s) === null); expect(avatarUrl(s, "https://x")).toBeNull(); }));
    expect(avatarUrl(null, "https://x")).toBeNull();
    expect(avatarUrl("00000000-0000-4000-8000-000000000000/00000000-0000-4000-8000-000000000000.webp", undefined)).toBeNull();
  });
  it("fallback initial is one uppercase char", () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9_]{3,20}$/), (u) => {
      expect(avatarInitial(u)).toBe(u[0].toUpperCase());
    }));
    expect(avatarInitial("")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
  });
});

describe("Property 10: control visibility", () => {
  it("only the owner of a real profile sees controls; Remove only with a photo", () => {
    fc.assert(
      fc.property(fc.option(uuid, { nil: null }), uuid, fc.boolean(), fc.option(fc.constant("p"), { nil: null }), (viewer, owner, sameUser, path) => {
        const viewerId = sameUser ? owner : viewer;
        const c = avatarControls({ viewerId, profileId: owner, avatarPath: path });
        const isOwner = viewerId === owner;
        expect(c.showUpload).toBe(isOwner);
        expect(c.showRemove).toBe(isOwner && path !== null);
        expect(c.uploadLabel).toBe(path ? "Change profile photo" : "Add profile photo");
      }),
    );
  });
  it("seed profiles and signed-out viewers get nothing", () => {
    expect(canManageAvatar({ viewerId: "seed-a", profileId: "seed-a" })).toBe(false);
    expect(canManageAvatar({ viewerId: null, profileId: "x" })).toBe(false);
  });
});

describe("Property 7: orphan selection", () => {
  it("never selects the current file, recent files, or undated files", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ name: fc.string({ minLength: 1 }), ageMs: fc.option(fc.integer({ min: -1000, max: ORPHAN_AGE_MS * 3 }), { nil: null }) }), { maxLength: 20 }),
        fc.option(fc.string({ minLength: 1 }), { nil: null }),
        (items, current) => {
          const now = 1_800_000_000_000;
          const objects = items.map((i) => ({ name: i.name, created_at: i.ageMs === null ? null : new Date(now - i.ageMs).toISOString() }));
          const out = selectOrphans(objects, current, now);
          for (const n of out) {
            expect(n).not.toBe(current);
            const o = objects.find((x) => x.name === n && x.created_at && now - Date.parse(x.created_at) >= ORPHAN_AGE_MS);
            expect(o).toBeTruthy();
          }
        },
      ),
    );
  });
});

describe("error table", () => {
  it("has a message and expected status per code; unknown codes fall back", () => {
    expect(AVATAR_ERRORS.too_large.status).toBe(413);
    expect(AVATAR_ERRORS.unsupported_type.status).toBe(415);
    expect(AVATAR_ERRORS.rate_limited.status).toBe(429);
    expect(avatarErrorMessage("nope")).toBe(AVATAR_ERRORS.failed.message);
  });
});