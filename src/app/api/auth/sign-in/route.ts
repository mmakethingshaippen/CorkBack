import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Email-only sign-in. */
export async function POST(req: Request) {
  const { email, password } = await req.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Auth is not configured in this environment. Add Supabase credentials to enable sign-in." },
      { status: 501 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 401 });
  }
  // An account without a profile finishes setup on /welcome (choose a username).
  const { data: profile } = await supabase.from("profiles").select("id").eq("id", data.user.id).maybeSingle();
  return NextResponse.json({ ok: true, needsUsername: !profile });
}
