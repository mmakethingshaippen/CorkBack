import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { usernameRejection } from "@/lib/domain";

/**
 * Email-only sign-up. Server re-validates the username rule (never trust the
 * client) and reserves the username in `profiles`. No full name is collected.
 */
export async function POST(req: Request) {
  const { username, email, password } = await req.json();

  if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }

  const rejection = usernameRejection(username);
  if (rejection) {
    return NextResponse.json({ error: rejection }, { status: 400 });
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Auth is not configured in this environment. Add Supabase credentials to enable sign-up." },
      { status: 501 },
    );
  }

  const supabase = await createClient();

  // Uniqueness check (the DB unique constraint is the source of truth).
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That username is taken." }, { status: 409 });
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Sign-up failed." }, { status: 400 });
  }

  const { error: profileError } = await supabase
    .from("profiles")
    .insert({ id: data.user.id, username });
  if (profileError) {
    return NextResponse.json({ error: "Could not reserve username." }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
