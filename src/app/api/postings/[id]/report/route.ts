import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/reactionState";
import { reportErrorResponse, validateReportInput } from "@/lib/moderation";

/**
 * POST { reason, details? } — report a posting. Signed-in users, not the author.
 * Everything that matters is enforced by public.submit_posting_report (visible
 * posting, not your own, one pending report per posting, 5 per 10 minutes and
 * 20 per 24 hours, serialized against hide/delete). A repeat is answered as
 * "already_reported" with 200, not as an error. Reporter identity and details
 * are never returned to anyone but admins.
 */
const fail = (status: number, code: string, error: string) => NextResponse.json({ error, code }, { status });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return fail(501, "not_configured", "Reporting isn't available in this environment.");
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return fail(401, "signed_out", "Sign in to report a posting.");
  if (!isUuid(id)) return fail(404, "not_found", "This posting isn't available.");

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return fail(400, "invalid", "Invalid request.");
  }
  const v = validateReportInput(raw);
  if (!v.ok) return fail(400, "invalid", v.error);

  const { data, error } = await supabase.rpc("submit_posting_report", {
    p_posting_id: id,
    p_reason: v.value.reason,
    p_details: v.value.details,
  });
  if (error) {
    console.error("[CorkBack] report failed:", { code: error.code, message: error.message });
    const r = reportErrorResponse(error.code);
    return fail(r.status, r.code, r.error);
  }
  return NextResponse.json({ result: data === "already_reported" ? "already_reported" : "created" });
}
