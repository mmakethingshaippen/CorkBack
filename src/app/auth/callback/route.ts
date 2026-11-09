import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  RECOVERY_COOKIE,
  RECOVERY_COOKIE_MAX_AGE,
  hasRecoveryAmr,
  isRecentRecovery,
} from "@/lib/authRecovery";
import { RESET_PASSWORD_PATH } from "@/lib/appUrl";
import { destinationAfterSignIn } from "@/lib/welcome";

/**
 * PKCE code exchange on the server. Uses the public anon client with the
 * request cookies, which hold the code verifier the browser stored when it
 * asked for the email. A recovery session is marked and always goes to the
 * new-password page, never to the homepage. Nothing here is logged.
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
    // No stored verifier means a different browser, or a code that is no
    // longer valid; Supabase can't tell those apart without the verifier.
    const reason = /verifier/i.test(error?.message ?? "") ? "other_browser" : "link_invalid";
    return failTo(reason);
  }

  const recovery =
    next === RESET_PASSWORD_PATH ||
    hasRecoveryAmr(data.session.access_token) ||
    isRecentRecovery(data.session.user);

  if (recovery) {
    (await cookies()).set(RECOVERY_COOKIE, "1", {
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
    });
    return NextResponse.redirect(new URL(RESET_PASSWORD_PATH, request.url));
  }
  return NextResponse.redirect(new URL(await destinationAfterSignIn(supabase, data.session.user.id, next), request.url));
}
