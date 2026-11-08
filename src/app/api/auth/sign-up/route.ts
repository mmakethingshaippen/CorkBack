import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { usernameRejection } from "@/lib/domain";
import { getAppUrl } from "@/lib/appUrl";

/**
 * Email-only sign-up. Server re-validates the username rule (never trust the
 * client). The username is passed as auth user metadata; a DB trigger
 * (supabase/stage5_profile_trigger.sql) creates the matching `profiles` row at
 * the moment the auth user is created — this works even with email confirmation
 * on, when the new user has no session yet (so an RLS-guarded client insert
 * would be blocked). No full name is collected.
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

  // Friendly pre-check (the DB unique constraint remains the source of truth).
  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "That username is taken." }, { status: 409 });
  }

  // Confirmation redirect on the canonical https origin. Using the raw env value
  // sent "http://corkback.vercel.app/", which Supabase rejected (not on the
  // allow-list) and replaced with the Site URL. The homepage forwards the
  // confirmation code to /auth/callback.
  const appUrl = getAppUrl();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }, // also read by the handle_new_user() trigger (backstop)
      emailRedirectTo: `${appUrl}/`,
    },
  });
  if (error || !data.user) {
    return NextResponse.json({ error: error?.message ?? "Sign-up failed." }, { status: 400 });
  }

  // Create the matching profiles row now, with the service-role client. This
  // does not depend on the new user's session (which does not exist yet when
  // email confirmation is on), so the profile always exists — alerts.user_id FK
  // succeeds and the profile page has the real username. If a DB trigger also
  // exists, the upsert is harmless (on conflict do nothing).
  const admin = createAdminClient();
  const { error: profileError } = await admin
    .from("profiles")
    .upsert({ id: data.user.id, username }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) {
    // Unique-username collision is the main expected case.
    if (profileError.code === "23505") {
      return NextResponse.json({ error: "That username is taken." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not create your profile." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
