import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminErrorResponse } from "@/lib/moderation";
import { fetchLog, fetchPostingDetail, lookupAvatarPaths } from "@/lib/adminData";
import { isUuid } from "@/lib/reactionState";

/**
 * GET — posting context for a report (body, place, dates, author username,
 * state) plus that posting's moderation history. Admins only; everyone else
 * gets 404. Never includes messages or email addresses.
 */
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) return notFound();
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !isUuid(id)) return notFound();
  const [detail, log] = await Promise.all([fetchPostingDetail(supabase, id), fetchLog(supabase, id, 50)]);
  if (!detail.ok || !log.ok) {
    const f = adminErrorResponse(!detail.ok ? detail.code : !log.ok ? log.code : undefined);
    return NextResponse.json({ error: f.error, code: f.code }, { status: f.status });
  }
  if (!detail.value) return notFound();
  const avatars = await lookupAvatarPaths(supabase, [detail.value.authorUsername, ...log.value.map((h) => h.adminUsername)]);
  return NextResponse.json({ posting: detail.value, history: log.value, avatars });
}
