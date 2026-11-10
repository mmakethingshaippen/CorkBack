import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { usernameRejection } from "@/lib/domain";
import { getAppUrl } from "@/lib/appUrl";
import { completeSignUp } from "@/lib/signup";

/**
 * Email-only sign-up. The server re-validates the username rule (never trust
 * the client). No full name is collected.
 *
 * Profile creation (see src/lib/signup.ts for every branch):
 * - With supabase/stage7_signup_profiles.sql applied, the on_auth_user_created
 *   trigger creates the profile in the same transaction as the auth user, and a
 *   taken username aborts the sign-up, so no account is created without one.
 * - Without it (or as a backstop), this route inserts the profile with the
 *   service-role client, because a new user has no session while email
 *   confirmation is on. A profile is never overwritten.
 * - If an account still ends up without a profile, the owner is sent to
 *   /welcome after signing in to choose a username.
 */
export async function POST(req: Request) {
  let input: Record<string, unknown>;
  try {
    input = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid request.", code: "invalid" }, { status: 400 });
  }
  const { username, email, password } = input;
  if (typeof username !== "string" || typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json({ error: "Missing fields.", code: "invalid" }, { status: 400 });
  }

  const rejection = usernameRejection(username);
  if (rejection) return NextResponse.json({ error: rejection, code: "invalid_username" }, { status: 400 });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return NextResponse.json(
      { error: "Auth is not configured in this environment. Add Supabase credentials to enable sign-up.", code: "not_configured" },
      { status: 501 },
    );
  }

  const supabase = await createClient();
  const admin = createAdminClient();
  // Confirmation redirect on the canonical https origin; the homepage forwards
  // the confirmation code to /auth/callback.
  const appUrl = getAppUrl();

  const result = await completeSignUp(
    {
      async usernameTaken(name) {
        const { data } = await admin.from("profiles").select("id").eq("username", name).maybeSingle();
        return Boolean(data);
      },
      async signUp(i) {
        const { data, error } = await supabase.auth.signUp({
          email: i.email,
          password: i.password,
          options: { data: { username: i.username }, emailRedirectTo: `${appUrl}/` },
        });
        return {
          user: data.user ? { id: data.user.id, identities: data.user.identities ?? null } : null,
          error: error ? { status: error.status, code: error.code, message: error.message } : null,
        };
      },
      async profileExists(userId) {
        const { data } = await admin.from("profiles").select("id").eq("id", userId).maybeSingle();
        return Boolean(data);
      },
      async insertProfile(userId, name) {
        const { error } = await admin.from("profiles").insert({ id: userId, username: name });
        if (error) console.error("[CorkBack] sign-up profile insert failed:", { code: error.code });
        return error ? { code: error.code } : null;
      },
    },
    { email, password, username },
  );
  return NextResponse.json(result.body, { status: result.status });
}
