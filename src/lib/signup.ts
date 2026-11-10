/**
 * Sign-up decisions, kept free of Next/Supabase imports so every branch is
 * unit-tested (signup.test.ts). The route supplies the I/O.
 *
 * Goal: a sign-up ends with exactly one profile for the new account, or with
 * a message that tells the person exactly how to finish. No branch leaves an
 * account that can't be recovered:
 * - a username lost to a race, or a profile write that failed, can be fixed by
 *   submitting again with the same email (the existing unconfirmed account is
 *   reused and gets the profile), or by confirming and choosing a username on
 *   /welcome after signing in;
 * - with supabase/stage7_signup_profiles.sql applied, the profile is created in
 *   the same transaction as the auth user, so a taken username aborts the whole
 *   sign-up and no account is created at all.
 *
 * Privacy: responses never reveal whether an email already has an account.
 */

export interface SignUpDeps {
  usernameTaken(username: string): Promise<boolean>;
  signUp(input: { email: string; password: string; username: string }): Promise<{
    user: { id: string; identities?: unknown[] | null } | null;
    error: { status?: number; code?: string; message: string } | null;
  }>;
  profileExists(userId: string): Promise<boolean>;
  insertProfile(userId: string, username: string): Promise<{ code?: string } | null>;
}

export interface SignUpResult {
  status: number;
  body: { ok: true; message: string } | { ok?: false; error: string; code: string };
}

export const SIGNUP_MESSAGES = {
  checkEmail:
    "Check your email to confirm your account. If this email already has an account, sign in or reset your password instead.",
  taken: "That username is taken. If you just signed up with it, check your email for the confirmation link.",
  takenDuringSignUp:
    "That username was just taken by someone else. Choose another username and submit again with the same email and password.",
  rateLimited: "A confirmation email was just sent to this address. Wait a minute, then submit again with the same details.",
  emailQuota:
    "CorkBack can't send more confirmation emails right now. No account was created; please try again later.",
  profileFailed:
    "We couldn't finish setting up your account. Submit again with the same email and password, or confirm your email, sign in and choose a username.",
  failed: "Sign-up didn't go through. Please try again.",
} as const;

const ok = (): SignUpResult => ({ status: 200, body: { ok: true, message: SIGNUP_MESSAGES.checkEmail } });
const fail = (status: number, code: string, error: string): SignUpResult => ({ status, body: { error, code } });

/** Supabase Auth's generic error when a database trigger rejects the new user. */
export const isTriggerRejection = (e: { status?: number; message: string }) =>
  /database error saving new user/i.test(e.message);
export const isRateLimited = (e: { status?: number; code?: string; message: string }) =>
  e.status === 429 || /rate.?limit|security purposes|only request this after/i.test(`${e.code ?? ""} ${e.message}`);
/** Per-address resend throttle ("only request this after N seconds") vs the project-wide email quota. */
export const isPerAddressThrottle = (e: { message: string }) => /security purposes|only request this after/i.test(e.message);

export async function completeSignUp(
  deps: SignUpDeps,
  input: { email: string; password: string; username: string },
): Promise<SignUpResult> {
  // Friendly early answer; the unique constraint stays the source of truth.
  if (await deps.usernameTaken(input.username)) return fail(409, "username_taken", SIGNUP_MESSAGES.taken);

  const { user, error } = await deps.signUp(input);
  if (error) {
    if (isRateLimited(error)) {
      return isPerAddressThrottle(error)
        ? fail(429, "rate_limited", SIGNUP_MESSAGES.rateLimited)
        : fail(429, "email_quota", SIGNUP_MESSAGES.emailQuota);
    }
    if (isTriggerRejection(error)) {
      // With the stage 7 trigger, a username taken between the check above and
      // the insert aborts the whole sign-up: no account was created.
      return (await deps.usernameTaken(input.username))
        ? fail(409, "username_taken", SIGNUP_MESSAGES.takenDuringSignUp)
        : fail(500, "signup_failed", SIGNUP_MESSAGES.failed);
    }
    if ((error.status ?? 500) >= 500) return fail(500, "signup_failed", SIGNUP_MESSAGES.failed);
    return fail(400, error.code ?? "invalid", error.message);
  }
  if (!user) return fail(500, "signup_failed", SIGNUP_MESSAGES.failed);

  // Already-confirmed email: Supabase returns a placeholder user with no
  // identities and creates nothing. Same answer as a new sign-up.
  if (Array.isArray(user.identities) && user.identities.length === 0) return ok();

  // Profile already there: created by the stage 7 trigger, or this is a repeat
  // sign-up for an existing unconfirmed account. Never overwritten here.
  if (await deps.profileExists(user.id)) return ok();

  const insertError = await deps.insertProfile(user.id, input.username);
  if (!insertError) return ok();
  if (insertError.code === "23505") {
    // Either a concurrent sign-up won the username, or a concurrent request for
    // this same account already created the profile.
    if (await deps.profileExists(user.id)) return ok();
    return fail(409, "username_taken", SIGNUP_MESSAGES.takenDuringSignUp);
  }
  if (insertError.code === "23503") return ok(); // placeholder user id: nothing to attach to
  return fail(500, "profile_failed", SIGNUP_MESSAGES.profileFailed);
}
