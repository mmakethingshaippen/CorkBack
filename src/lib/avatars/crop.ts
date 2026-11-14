/**
 * Square crop math shared by the browser cropper and the server pipeline.
 * No server imports, so client components can use it.
 *
 * A crop is expressed relative to the ORIENTED image (EXIF orientation applied,
 * which is what a browser <img> shows and what sharp's rotate() produces):
 *   x, y  top-left corner as a fraction of the image width and height
 *   size  side length as a fraction of the SHORTER side of the image
 * One side value means the region is always square, so it can only be scaled
 * uniformly, never stretched.
 */
export type CropRect = { x: number; y: number; size: number };

/** Zoom limit: the crop may shrink to 10% of the shorter side. */
export const MIN_CROP_SIZE = 0.1;

export function defaultCrop(width: number, height: number): CropRect {
  return clampCrop({ x: 0, y: 0, size: 1 }, width, height, true);
}

/** Keep the crop inside the image. With `center`, the crop is centred on the free axis. */
export function clampCrop(crop: CropRect, width: number, height: number, center = false): CropRect {
  const short = Math.min(width, height);
  const size = Math.min(1, Math.max(MIN_CROP_SIZE, Number.isFinite(crop.size) ? crop.size : 1));
  const sideW = (size * short) / width; // side as a fraction of the width
  const sideH = (size * short) / height;
  const maxX = Math.max(0, 1 - sideW);
  const maxY = Math.max(0, 1 - sideH);
  const x = center ? maxX / 2 : Math.min(maxX, Math.max(0, Number.isFinite(crop.x) ? crop.x : 0));
  const y = center ? maxY / 2 : Math.min(maxY, Math.max(0, Number.isFinite(crop.y) ? crop.y : 0));
  return { x, y, size };
}

/** Integer pixel box for sharp.extract: always square, always inside the image. */
export function cropToPixels(crop: CropRect | null | undefined, width: number, height: number): { left: number; top: number; side: number } {
  const c = crop ? clampCrop(crop, width, height) : defaultCrop(width, height);
  const side = Math.max(1, Math.min(Math.round(c.size * Math.min(width, height)), width, height));
  const left = Math.min(width - side, Math.max(0, Math.round(c.x * width)));
  const top = Math.min(height - side, Math.max(0, Math.round(c.y * height)));
  return { left, top, side };
}

/** Parse the `crop` form field. null = absent (use the centred square); "invalid" = reject. */
export function parseCrop(raw: unknown): CropRect | null | "invalid" {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 200) return "invalid";
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (!v || typeof v !== "object") return "invalid";
  const { x, y, size } = v as Record<string, unknown>;
  if (typeof x !== "number" || typeof y !== "number" || typeof size !== "number") return "invalid";
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(size) || size <= 0) return "invalid";
  return { x, y, size };
}
