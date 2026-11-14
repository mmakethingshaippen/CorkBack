import "server-only";
import sharp from "sharp";
import { MAX_FILE_BYTES, MAX_INPUT_PIXELS, OUTPUT_SIZE, WEBP_QUALITY } from "./constants";
import type { AvatarErrorCode } from "./errors";
import { checkDimensions } from "./validate";

export type ProcessResult =
  | { ok: true; data: Buffer; width: number; height: number; inputFormat: "jpeg" | "png" | "webp" }
  | { ok: false; code: AvatarErrorCode };

const ACCEPTED = new Set(["jpeg", "png", "webp"]);

/**
 * Decode, validate and re-encode an uploaded photo.
 *
 * - The format comes from the bytes (sharp's decoder), never from the file name
 *   or the declared type. Only JPEG, PNG and WebP decode; GIF, SVG and anything
 *   else are refused.
 * - `limitInputPixels` makes sharp refuse oversized images before decoding them.
 * - `animated: false` reads only the first frame of an animated WebP.
 * - Output: EXIF orientation applied, fitted inside 512 x 512 (aspect kept,
 *   never stretched or enlarged), WebP. No metadata is copied, so EXIF
 *   (including GPS), XMP and ICC are dropped.
 */
export async function processAvatar(input: Buffer): Promise<ProcessResult> {
  if (input.length === 0) return { ok: false, code: "no_file" };
  if (input.length > MAX_FILE_BYTES) return { ok: false, code: "too_large" };

  const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const, animated: false };
  let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
  try {
    meta = await sharp(input, opts).metadata();
  } catch (e) {
    return { ok: false, code: pixelLimitError(e) ? "too_many_pixels" : "not_an_image" };
  }
  if (!meta.format || !ACCEPTED.has(meta.format)) {
    // Decodable but not an accepted format (e.g. GIF, SVG, TIFF, AVIF).
    return { ok: false, code: meta.format ? "unsupported_type" : "not_an_image" };
  }
  // For multi-frame input, `height` here is one frame (animated: false).
  const dim = checkDimensions(meta.width ?? 0, meta.pageHeight ?? meta.height ?? 0);
  if (dim) return { ok: false, code: dim };

  try {
    const { data, info } = await sharp(input, opts)
      .rotate()
      .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY })
      .toBuffer({ resolveWithObject: true });
    if (data.length === 0 || data.length > MAX_FILE_BYTES) return { ok: false, code: "failed" };
    return { ok: true, data, width: info.width, height: info.height, inputFormat: meta.format as "jpeg" | "png" | "webp" };
  } catch (e) {
    return { ok: false, code: pixelLimitError(e) ? "too_many_pixels" : "not_an_image" };
  }
}

function pixelLimitError(e: unknown): boolean {
  return e instanceof Error && /pixel limit/i.test(e.message);
}