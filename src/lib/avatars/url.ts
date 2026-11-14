import { BUCKET } from "./constants";
import { parseAvatarPath } from "./path";

/**
 * Public URL of a stored photo, or null when there is no (valid) path. The file
 * name is unique per upload, so a replaced photo always has a new URL and a
 * stale cache can never show the old one.
 */
export function avatarUrl(
  path: string | null | undefined,
  base: string | undefined = process.env.NEXT_PUBLIC_SUPABASE_URL,
): string | null {
  if (!path || !base || !parseAvatarPath(path)) return null;
  return `${base.replace(/\/+$/, "")}/storage/v1/object/public/${BUCKET}/${path}`;
}

/** One uppercase letter for the fallback circle. */
export function avatarInitial(username: string | null | undefined): string {
  const first = (username ?? "").trim().charAt(0);
  return first ? first.toUpperCase() : "?";
}