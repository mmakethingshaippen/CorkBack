import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { BUCKET, MAX_FILE_BYTES, MULTIPART_OVERHEAD_BYTES } from "@/lib/avatars/constants";
import { AVATAR_ERRORS, type AvatarErrorCode } from "@/lib/avatars/errors";
import { processAvatar } from "@/lib/avatars/process";
import { removeAvatar, uploadAvatar, type AvatarDeps, type AvatarResult } from "@/lib/avatars/service";

// sharp needs the Node.js runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST   multipart/form-data with one field, `file`: add or replace your photo.
 * DELETE: remove your photo.
 *
 * The target account is ALWAYS the verified session user. This route reads no
 * user id, username or path from the body, the query string or headers. The
 * service-role client is created here, on the server, and never sent anywhere.
 */
function respond(r: AvatarResult) {
  return NextResponse.json(r.body, { status: r.status, headers: { "Cache-Control": "no-store", ...(r.headers ?? {}) } });
}
function fail(code: AvatarErrorCode) {
  return respond({ status: AVATAR_ERRORS[code].status, body: { ok: false, code, message: AVATAR_ERRORS[code].message } });
}

async function sessionUserId(): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

function deps(): AvatarDeps {
  const admin = createAdminClient();
  const bucket = () => admin.storage.from(BUCKET);
  return {
    rpc: async (fn, args) => {
      const { data, error } = await admin.rpc(fn, args);
      return { data, error: error ? { code: error.code, message: error.message } : null };
    },
    upload: async (path, data, opts) => {
      const { error } = await bucket().upload(path, data, opts);
      return { error: error ? { message: error.message } : null };
    },
    remove: async (paths) => {
      const { error } = await bucket().remove(paths);
      return { error: error ? { message: error.message } : null };
    },
    list: async (folder) => {
      const { data, error } = await bucket().list(folder, { limit: 100 });
      return { data: data ?? null, error: error ? { message: error.message } : null };
    },
    process: processAvatar,
    newId: () => randomUUID(),
    now: () => Date.now(),
    log: (msg, meta) => console.error(`[CorkBack] avatar: ${msg}`, meta),
  };
}

function configured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req: Request) {
  if (!configured()) return fail("unavailable");
  const userId = await sessionUserId();
  if (!userId) return fail("signed_out");

  // Refuse obviously oversized bodies before reading them.
  const declared = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES + MULTIPART_OVERHEAD_BYTES) return fail("too_large");

  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return fail("no_file");
  }
  return respond(await uploadAvatar(deps(), userId, file));
}

export async function DELETE() {
  if (!configured()) return fail("unavailable");
  const userId = await sessionUserId();
  if (!userId) return fail("signed_out");
  return respond(await removeAvatar(deps(), userId));
}