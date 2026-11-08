import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isRecoverySession } from "@/lib/authRecovery";
import { RESET_PASSWORD_PATH, safeNextPath } from "@/lib/appUrl";

/**
 * PKCE code exchange on the server. Uses the public anon client with the
 * request cookies, which hold the code verifier the browser stored when it
 * asked for the email. A recovery session always goes to the new-password page,
 * never to the homepage. Nothing here is logged.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  const errorCode = searchParams.get("error_code") ?? searchParams.get("error");

  // Where to send a failure: the reset page when this was a reset, else sign-in.
  const failTo = (reason: string) => {
    const base = next === RESET_PASSWORD_PATH ? RESET_PASSWORD_PATH : "/sign-in";
    return NextResponse.redirect(new URL(`${base}?error=${reason}`, request.url));
  };

  if (errorCode) return failTo(errorCode === "otp_expired" ? "link_expired" : "link_invalid");
  if (!code || !process.env.NEXT_PUBLIC_SUPABASE_URL) return failTo("link_invalid");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    // A missing code verifier means the link was opened in a different browser
    // from the one that requested it.
    const reason = /verifier/i.test(error?.message ?? "") ? "other_browser" : "link_invalid";
    return failTo(reason);
  }

  const dest = isRecoverySession(data.session.access_token)
    ? RESET_PASSWORD_PATH
    : safeNextPath(next, "/");
  return NextResponse.redirect(new URL(dest, request.url));
}
