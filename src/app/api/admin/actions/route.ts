import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminErrorResponse, adminOutcomeMessage, validateAdminAction } from "@/lib/moderation";

/**
 * POST { kind: "dismiss" | "hide" | "restore", ... } — an admin action.
 *   dismiss  { reportId, note? }
 *   hide     { postingId, reason (required), reportId? }
 *   restore  { postingId, reason (required) }
 * The database functions check is_admin() themselves, run in one transaction,
 * write the append-only audit log, and are idempotent (already_hidden,
 * not_hidden, not_pending come back as ordinary 200 results). A report id that
 * belongs to another posting is refused. Non-admins get the same 404 as a
 * route that does not exist. Hiding is never automatic.
 */
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return notFound();

  // Authorization first, so a non-admin learns nothing about the request shape.
  const { data: admin } = await supabase.rpc("is_admin");
  if (admin !== true) return notFound();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request.", code: "invalid" }, { status: 400 });
  }
  const v = validateAdminAction(raw);
  if (!v.ok) return NextResponse.json({ error: v.error, code: "invalid" }, { status: 400 });
  const a = v.value;

  const { data, error } =
    a.kind === "dismiss"
      ? await supabase.rpc("admin_dismiss_report", { p_report_id: a.reportId, p_note: a.note })
      : a.kind === "hide"
        ? await supabase.rpc("admin_hide_posting", { p_posting_id: a.postingId, p_reason: a.reason, p_report_id: a.reportId })
        : await supabase.rpc("admin_restore_posting", { p_posting_id: a.postingId, p_reason: a.reason });
  if (error) {
    console.error("[CorkBack] admin action failed:", { kind: a.kind, code: error.code, message: error.message });
    const f = adminErrorResponse(error.code);
    return NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
  }
  const result = String(data);
  return NextResponse.json({ result, message: adminOutcomeMessage(result) });
}
