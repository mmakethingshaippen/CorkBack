import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import sharp from "sharp";

vi.mock("server-only", () => ({}));
import { clampCrop, cropToPixels, defaultCrop, parseCrop, MIN_CROP_SIZE } from "./crop";
import { processAvatar } from "./process";

describe("crop math", () => {
  it("property: the pixel box is always square and inside the image", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 32, max: 9000 }),
        fc.integer({ min: 32, max: 9000 }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        (w, h, x, y, size) => {
          const b = cropToPixels({ x, y, size }, w, h);
          expect(b.side).toBeGreaterThanOrEqual(1);
          expect(b.side).toBeLessThanOrEqual(Math.min(w, h));
          expect(b.left).toBeGreaterThanOrEqual(0);
          expect(b.top).toBeGreaterThanOrEqual(0);
          expect(b.left + b.side).toBeLessThanOrEqual(w);
          expect(b.top + b.side).toBeLessThanOrEqual(h);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("defaults to the centred largest square", () => {
    expect(cropToPixels(null, 100, 60)).toEqual({ left: 20, top: 0, side: 60 });
    expect(cropToPixels(null, 60, 100)).toEqual({ left: 0, top: 20, side: 60 });
    expect(defaultCrop(50, 50)).toEqual({ x: 0, y: 0, size: 1 });
  });

  it("clamps zoom and position", () => {
    const c = clampCrop({ x: 9, y: -9, size: 0.001 }, 100, 60);
    expect(c.size).toBe(MIN_CROP_SIZE);
    expect(c.y).toBe(0);
    expect(c.x).toBeLessThanOrEqual(1 - (MIN_CROP_SIZE * 60) / 100 + 1e-9);
  });

  it("parseCrop accepts only finite numbers and size > 0", () => {
    expect(parseCrop(null)).toBeNull();
    expect(parseCrop("")).toBeNull();
    expect(parseCrop('{"x":0.1,"y":0.2,"size":0.5}')).toEqual({ x: 0.1, y: 0.2, size: 0.5 });
    for (const bad of ["nope", "[]", "null", '{"x":"1","y":0,"size":1}', '{"x":0,"y":0,"size":0}', '{"x":0,"y":0,"size":-1}', '{"x":0,"y":0}', "x".repeat(300)]) {
      expect(parseCrop(bad)).toBe("invalid");
    }
    expect(parseCrop({} as unknown as string)).toBe("invalid");
  });
});

// Left half red, right half blue.
async function twoTone(w: number, h: number, orientation?: number) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3;
    if (x < w / 2) px[i] = 255;
    else px[i + 2] = 255;
  }
  const img = sharp(px, { raw: { width: w, height: h, channels: 3 } }).png();
  return orientation ? img.withMetadata({ orientation }).toBuffer() : img.toBuffer();
}
async function corner(buf: Buffer, where: "tl" | "br") {
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = where === "tl" ? 0 : (info.height * info.width - 1) * 3;
  return { r: data[i], b: data[i + 2] };
}

describe("crop applied by processAvatar", () => {
  it("picks the left or right square of a wide image and never stretches", async () => {
    const input = await twoTone(100, 60);
    const left = await processAvatar(input, { x: 0, y: 0, size: 1 });
    const right = await processAvatar(input, { x: 1, y: 0, size: 1 }); // clamped inside
    expect(left.ok && right.ok).toBe(true);
    if (!left.ok || !right.ok) return;
    expect([left.width, left.height]).toEqual([60, 60]);
    expect((await corner(left.data, "tl")).r).toBeGreaterThan(200);
    expect((await corner(right.data, "br")).b).toBeGreaterThan(200);
  });

  it("zooming in crops a smaller square (still square)", async () => {
    const r = await processAvatar(await twoTone(100, 60), { x: 0, y: 0, size: 0.5 });
    expect(r.ok && [r.width, r.height]).toEqual([30, 30]);
  });

  it("crop is in the oriented image: orientation 6 puts the red half on top", async () => {
    const input = await twoTone(60, 40, 6); // displayed 40 wide x 60 tall
    const top = await processAvatar(input, { x: 0, y: 0, size: 1 });
    const bottom = await processAvatar(input, { x: 0, y: 1, size: 1 });
    expect(top.ok && bottom.ok).toBe(true);
    if (!top.ok || !bottom.ok) return;
    expect([top.width, top.height]).toEqual([40, 40]);
    expect((await corner(top.data, "tl")).r).toBeGreaterThan(200);
    expect((await corner(bottom.data, "br")).b).toBeGreaterThan(200);
  });

  it("garbage crop values are clamped, not trusted", async () => {
    const r = await processAvatar(await twoTone(100, 60), { x: 1e9, y: -1e9, size: 1e9 });
    expect(r.ok && [r.width, r.height]).toEqual([60, 60]);
  });
});
