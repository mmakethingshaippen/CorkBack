import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { RESET_PASSWORD_PATH, safeNextPath } from "@/lib/appUrl";

/**
 * Server-side verification for `token_hash` email links (the recommended
 * Supabase template). Works on any device or browser because it needs no
 * stored code verifier. Uses the public anon client. Nothing here is logged.
 */
const ALLOWED_TYPES: EmailOtpType[] = ["recovery", "signup", "email", "invite", "magiclink", "email_change"];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  const isRecovery = type === "recovery";

  const failTo = (reason: string) =>
    NextResponse.redirect(
      new URL(`${isRecovery ? RESET_PASSWORD_PATH : "/sign-in"}?error=${reason}`, request.url),
    );

  if (!tokenHash || !type || !ALLOWED_TYPES.includes(type) || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    return failTo("link_invalid");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) {
    const expired = /expired|invalid/i.test(error.message) || error.code === "otp_expired";
    return failTo(expired ? "link_expired" : "link_invalid");
  }

  const dest = isRecovery ? RESET_PASSWORD_PATH : safeNextPath(next, "/");
  return NextResponse.redirect(new URL(dest, request.url));
}
