/**
 * Avatar error codes, HTTP statuses and the exact text a person sees. No server
 * imports, so browser code can use the same table for its own prechecks.
 */
export type AvatarErrorCode =
  | "signed_out"
  | "no_file"
  | "too_large"
  | "unsupported_type"
  | "not_an_image"
  | "too_many_pixels"
  | "too_small"
  | "invalid_crop"
  | "rate_limited"
  | "unavailable"
  | "failed";

export const AVATAR_ERRORS: Record<AvatarErrorCode, { status: number; message: string }> = {
  signed_out: { status: 401, message: "Your session has ended. Sign in again to change your photo." },
  no_file: { status: 400, message: "Choose a photo to upload." },
  too_large: { status: 413, message: "That photo is larger than 2 MB. Choose a smaller one." },
  unsupported_type: { status: 415, message: "Use a JPEG, PNG or WebP photo. GIF and SVG files are not accepted." },
  not_an_image: { status: 422, message: "That file could not be read as a photo. Try a different JPEG, PNG or WebP." },
  too_many_pixels: { status: 422, message: "That photo has too many pixels (over 50 megapixels). Choose a smaller photo." },
  too_small: { status: 422, message: "That photo is too small. Use one at least 32 by 32 pixels." },
  invalid_crop: { status: 400, message: "The crop could not be read. Adjust the photo and try again." },
  rate_limited: { status: 429, message: "You have changed your photo a lot recently. Try again in about 10 minutes." },
  unavailable: { status: 503, message: "Photo uploads are temporarily unavailable. Please try again later." },
  failed: { status: 500, message: "Couldn't save your photo. Your current photo was not changed. Please try again." },
};

export function avatarErrorMessage(code: string | undefined | null): string {
  if (code && code in AVATAR_ERRORS) return AVATAR_ERRORS[code as AvatarErrorCode].message;
  return AVATAR_ERRORS.failed.message;
}