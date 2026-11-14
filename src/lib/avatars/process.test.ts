import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
import { processAvatar } from "./process";
import { MAX_FILE_BYTES, OUTPUT_SIZE } from "./constants";

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 140, g: 43, b: 31 } } });

describe("Property 4: processed output invariants", () => {
  it("is WebP, fits 512, keeps aspect, never upscales, carries no metadata", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 32, max: 64 }),
        fc.integer({ min: 32, max: 64 }),
        fc.constantFrom("jpeg", "png", "webp"),
        fc.integer({ min: 1, max: 8 }),
        async (w, h, fmt, orientation) => {
          const base = solid(w, h)[fmt as "jpeg" | "png" | "webp"]();
          const input = await base.withMetadata({ orientation }).toBuffer();
          const r = await processAvatar(input);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          const m = await sharp(r.data).metadata();
          expect(m.format).toBe("webp");
          expect(m.exif).toBeUndefined();
          expect(m.icc).toBeUndefined();
          expect(m.xmp).toBeUndefined();
          const [ew, eh] = orientation >= 5 ? [h, w] : [w, h];
          expect([r.width, r.height]).toEqual([ew, eh]); // small inputs are not enlarged
          expect(r.width).toBeLessThanOrEqual(OUTPUT_SIZE);
          expect(r.data.length).toBeLessThanOrEqual(MAX_FILE_BYTES);
        },
      ),
      { numRuns: 100 },
    );
  }, 60_000);
});

describe("sharp fixtures", () => {
  it("strips GPS EXIF from a JPEG", async () => {
    const input = await solid(100, 80)
      .jpeg()
      .withExif({ IFD0: { Copyright: "x" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 26/1 46/1", GPSLongitudeRef: "W", GPSLongitude: "79/1 58/1 56/1" } })
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const r = await processAvatar(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect((await sharp(r.data).metadata()).exif).toBeUndefined();
      expect(r.data.includes(Buffer.from("GPS"))).toBe(false);
    }
  });

  it("resizes large images to fit inside 512 without stretching", async () => {
    const r = await processAvatar(await solid(1600, 900).png().toBuffer());
    expect(r.ok && [r.width, r.height]).toEqual([512, 288]);
  });

  it("applies orientation 6 (swaps width and height)", async () => {
    const r = await processAvatar(await solid(60, 40).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    expect(r.ok && [r.width, r.height]).toEqual([40, 60]);
  });

  it("rejects text declared as an image", async () => {
    expect(await processAvatar(Buffer.from("MZ this is not a picture at all"))).toEqual({ ok: false, code: "not_an_image" });
  });

  it("rejects SVG", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>');
    const r = await processAvatar(svg);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["unsupported_type", "not_an_image"]).toContain(r.code);
  });

  it("rejects GIF", async () => {
    const gif = await solid(64, 64).gif().toBuffer();
    expect(await processAvatar(gif)).toEqual({ ok: false, code: "unsupported_type" });
  });

  it("rejects a truncated JPEG", async () => {
    const jpg = await solid(200, 200).jpeg().toBuffer();
    expect(await processAvatar(jpg.subarray(0, 300))).toEqual({ ok: false, code: "not_an_image" });
  });

  it("rejects images over the pixel limit", async () => {
    // 8000 x 6400 = 51.2 MP, a tiny PNG of one colour.
    const big = await sharp({ create: { width: 8000, height: 6400, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png({ compressionLevel: 9 }).toBuffer();
    expect(big.length).toBeLessThan(MAX_FILE_BYTES);
    expect(await processAvatar(big)).toEqual({ ok: false, code: "too_many_pixels" });
  }, 30_000);

  it("rejects 31 x 31", async () => {
    expect(await processAvatar(await solid(31, 31).png().toBuffer())).toEqual({ ok: false, code: "too_small" });
  });

  it("rejects over 2 MiB before decoding", async () => {
    expect(await processAvatar(Buffer.alloc(MAX_FILE_BYTES + 1))).toEqual({ ok: false, code: "too_large" });
  });

  it("reads only the first frame of an animated WebP", async () => {
    const frame = (b: number) => sharp({ create: { width: 64, height: 40, channels: 3, background: { r: 0, g: 0, b } } }).raw().toBuffer();
    const anim = await sharp(Buffer.concat([await frame(0), await frame(255)]), { raw: { width: 64, height: 80, channels: 3, pageHeight: 40 } } as never)
      .webp()
      .toBuffer();
    expect((await sharp(anim, { animated: true }).metadata()).pages).toBe(2);
    const r = await processAvatar(anim);
    expect(r.ok && [r.width, r.height]).toEqual([64, 40]);
    if (r.ok) expect((await sharp(r.data, { animated: true }).metadata()).pages ?? 1).toBe(1);
  });
});