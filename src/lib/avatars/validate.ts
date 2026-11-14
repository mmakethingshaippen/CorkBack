import { ALLOWED_TYPES, MAX_FILE_BYTES, MAX_INPUT_PIXELS, MIN_DIMENSION } from "./constants";
import type { AvatarErrorCode } from "./errors";

/**
 * Cheap checks on what the browser (or a direct request) declares. The server
 * never trusts these alone: the real format and size come from the bytes.
 */
export function precheckFile(file: { size: number; type: string } | null | undefined): AvatarErrorCode | null {
  if (!file || !Number.isFinite(file.size) || file.size <= 0) return "no_file";
  if (!(ALLOWED_TYPES as readonly string[]).includes(file.type)) return "unsupported_type";
  if (file.size > MAX_FILE_BYTES) return "too_large";
  return null;
}

/** Decoded size rules: at least 32 x 32, and at most 50,000,000 pixels in total. */
export function checkDimensions(width: number, height: number): AvatarErrorCode | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return "not_an_image";
  if (width * height > MAX_INPUT_PIXELS) return "too_many_pixels";
  if (width < MIN_DIMENSION || height < MIN_DIMENSION) return "too_small";
  return null;
}

/** The viewer may manage a photo only on their own, real (non-seed) profile. */
export function canManageAvatar(args: { viewerId: string | null | undefined; profileId: string }): boolean {
  const { viewerId, profileId } = args;
  if (!viewerId || !profileId) return false;
  if (profileId.startsWith("seed-")) return false;
  return viewerId === profileId;
}

/**
 * Which photo controls to show. Admin status is deliberately not an input: an
 * admin viewing someone else's profile gets no control.
 */
export function avatarControls(args: {
  viewerId: string | null | undefined;
  profileId: string;
  avatarPath: string | null | undefined;
}): { showUpload: boolean; uploadLabel: "Add profile photo" | "Change profile photo"; showRemove: boolean } {
  const manage = canManageAvatar(args);
  const has = Boolean(args.avatarPath);
  return {
    showUpload: manage,
    uploadLabel: has ? "Change profile photo" : "Add profile photo",
    showRemove: manage && has,
  };
}