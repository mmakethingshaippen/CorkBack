import "server-only";
import { RATE_RETRY_AFTER_SECONDS } from "./constants";
import type { CropRect } from "./crop";
import { AVATAR_ERRORS, type AvatarErrorCode } from "./errors";
import { selectOrphans, type StoredObject } from "./orphans";
import { buildAvatarPath, parseAvatarPath } from "./path";
import type { ProcessResult } from "./process";
import { avatarUrl } from "./url";
import { precheckFile } from "./validate";

type DbError = { code?: string; message?: string } | null;

/**
 * Everything the avatar operations touch, injected so tests can drive each
 * step and each failure. The route wires these to the service-role client.
 * There is no user-id parameter anywhere except `userId`, which the route takes
 * only from the verified session.
 */
export type AvatarDeps = {
  rpc: (fn: "cb_avatar_rate_check" | "cb_set_avatar" | "cb_clear_avatar", args: Record<string, unknown>) => Promise<{ data: unknown; error: DbError }>;
  upload: (path: string, data: Buffer, opts: { contentType: string; cacheControl: string; upsert: boolean }) => Promise<{ error: DbError }>;
  remove: (paths: string[]) => Promise<{ error: DbError }>;
  list: (folder: string) => Promise<{ data: StoredObject[] | null; error: DbError }>;
  process: (input: Buffer, crop?: CropRect | null) => Promise<ProcessResult>;
  newId: () => string;
  now: () => number;
  log?: (msg: string, meta: Record<string, unknown>) => void;
};

export type AvatarResult = {
  status: number;
  body: { ok: boolean; code?: AvatarErrorCode; message?: string; path?: string | null; url?: string | null };
  headers?: Record<string, string>;
};

/** Storage sets this on every new object: the name is unique, so it never changes. */
export const OBJECT_CACHE_CONTROL = "31536000";

function fail(code: AvatarErrorCode, headers?: Record<string, string>): AvatarResult {
  return { status: AVATAR_ERRORS[code].status, body: { ok: false, code, message: AVATAR_ERRORS[code].message }, headers };
}

/**
 * Upload or replace the session user's photo.
 * Order: precheck (declared type and size, no CPU) -> rate check (records the
 * attempt; fails closed) -> decode/validate/re-encode -> upload a NEW object
 * -> cb_set_avatar (database checks owner, existence, type, size) -> delete the
 * previous object and sweep stale files. If anything fails after the upload,
 * the new object is removed and the current photo is untouched.
 */
export async function uploadAvatar(deps: AvatarDeps, userId: string | null, file: File | null, crop: CropRect | null = null): Promise<AvatarResult> {
  const log = deps.log ?? (() => {});
  if (!userId) return fail("signed_out");
  const pre = precheckFile(file);
  if (pre) return fail(pre);

  const rate = await deps.rpc("cb_avatar_rate_check", { p_user: userId });
  if (rate.error) {
    if (rate.error.code === "CB429") return fail("rate_limited", { "Retry-After": String(RATE_RETRY_AFTER_SECONDS) });
    log("rate check unavailable", { code: rate.error.code });
    return fail("unavailable");
  }

  let input: Buffer;
  try {
    input = Buffer.from(await (file as File).arrayBuffer());
  } catch {
    return fail("not_an_image");
  }
  const processed = await deps.process(input, crop);
  if (!processed.ok) return fail(processed.code);

  const path = buildAvatarPath(userId, deps.newId());
  const up = await deps.upload(path, processed.data, { contentType: "image/webp", cacheControl: OBJECT_CACHE_CONTROL, upsert: false });
  if (up.error) {
    log("upload failed", { message: up.error.message });
    return fail("failed");
  }

  const set = await deps.rpc("cb_set_avatar", { p_user: userId, p_path: path });
  if (set.error) {
    log("cb_set_avatar failed", { code: set.error.code });
    await deps.remove([path]).catch(() => undefined); // best effort: never keep an unreferenced file
    return fail("failed");
  }

  await cleanup(deps, userId, typeof set.data === "string" ? set.data : null, path);
  return { status: 200, body: { ok: true, path, url: avatarUrl(path) } };
}

/** Remove the session user's photo: clear the reference first, then delete the file. */
export async function removeAvatar(deps: AvatarDeps, userId: string | null): Promise<AvatarResult> {
  const log = deps.log ?? (() => {});
  if (!userId) return fail("signed_out");
  const res = await deps.rpc("cb_clear_avatar", { p_user: userId });
  if (res.error) {
    log("cb_clear_avatar failed", { code: res.error.code });
    // PGRST202: function not installed yet. Fail closed with a clear message.
    return fail(res.error.code === "PGRST202" ? "unavailable" : "failed");
  }
  await cleanup(deps, userId, typeof res.data === "string" ? res.data : null, null);
  return { status: 200, body: { ok: true, path: null, url: null } };
}

/**
 * After the database change succeeded: delete the previous object (only if it is
 * in this user's folder), then sweep stale leftovers. Cleanup failures are
 * logged and never turn a successful change into an error.
 */
async function cleanup(deps: AvatarDeps, userId: string, oldPath: string | null, currentPath: string | null) {
  const log = deps.log ?? (() => {});
  try {
    const old = parseAvatarPath(oldPath);
    if (old && old.userId === userId && oldPath !== currentPath) {
      const r = await deps.remove([oldPath as string]);
      if (r.error) log("old photo delete failed", { message: r.error.message });
    }
    const listed = await deps.list(userId);
    if (listed.error || !listed.data) return;
    const currentName = currentPath ? currentPath.slice(userId.length + 1) : null;
    const stale = selectOrphans(listed.data, currentName, deps.now())
      .map((n) => `${userId}/${n}`)
      .filter((p) => parseAvatarPath(p)?.userId === userId);
    if (stale.length) {
      const r = await deps.remove(stale);
      if (r.error) log("orphan sweep failed", { message: r.error.message });
    }
  } catch (e) {
    log("cleanup error", { message: e instanceof Error ? e.message : String(e) });
  }
}