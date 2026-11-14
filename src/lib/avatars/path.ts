const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
// Same shape the database constraint profiles_avatar_path_format enforces.
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})\\.(jpg|png|webp)$`);

/**
 * `<user id>/<uuid>.webp`. The user id comes from the verified session, the file
 * id is random. Nothing here comes from the client.
 */
export function buildAvatarPath(userId: string, fileId: string): string {
  if (!UUID_RE.test(userId)) throw new Error("avatar path: user id must be a lowercase uuid");
  if (!UUID_RE.test(fileId)) throw new Error("avatar path: file id must be a lowercase uuid");
  return `${userId}/${fileId}.webp`;
}

export function parseAvatarPath(path: unknown): { userId: string; fileId: string; ext: "jpg" | "png" | "webp" } | null {
  if (typeof path !== "string") return null;
  const m = PATH_RE.exec(path);
  if (!m) return null;
  return { userId: m[1], fileId: m[2], ext: m[3] as "jpg" | "png" | "webp" };
}