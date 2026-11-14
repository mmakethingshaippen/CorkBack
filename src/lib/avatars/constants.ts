/**
 * Profile photo limits. One place to change them. Used by the browser prechecks,
 * the API route and the image pipeline, so the three can never disagree.
 */
export const BUCKET = "avatars";

/** 2 MiB, also enforced by the Storage bucket settings. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** The only accepted input types. No GIF, no SVG. */
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

/**
 * Decoded-pixel ceiling (about 8192 x 6144). Accepts typical 12 to 48 MP phone
 * photos; guards against small files that decode to enormous images. Anything
 * above is rejected with a clear message, never silently downscaled.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/** Smallest accepted width and height, in pixels. */
export const MIN_DIMENSION = 32;

/** Output fits inside this square. Aspect ratio is kept; small images are not enlarged. */
export const OUTPUT_SIZE = 512;
export const WEBP_QUALITY = 85;

/** Stale files in a user's folder older than this are swept after a successful change. */
export const ORPHAN_AGE_MS = 10 * 60 * 1000;

/** Sent with a 429 so clients know when to retry (the 10 minute window). */
export const RATE_RETRY_AFTER_SECONDS = 600;

/** Multipart framing slack allowed on top of the file size for the early Content-Length check. */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024;