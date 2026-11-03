import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Sign the current user out, clearing the session cookies. */
export async function POST() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json({ ok: true });
  }
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.json({ ok: true });
}
