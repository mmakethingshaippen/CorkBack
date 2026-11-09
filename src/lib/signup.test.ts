import { describe, expect, it } from "vitest";
import { completeSignUp, SIGNUP_MESSAGES, type SignUpDeps } from "./signup";

const input = { email: "x@example.invalid", password: "pw-123456", username: "new_user" };

/** In-memory model of auth users + profiles with the unique username rule. */
function world(opts: { trigger?: boolean; takenNames?: string[]; insertFails?: string; signUpError?: { status?: number; code?: string; message: string } } = {}) {
  const profiles = new Map<string, string>(); // id -> username
  (opts.takenNames ?? []).forEach((n, i) => profiles.set(`other-${i}`, n));
  const authUsers = new Map<string, { email: string; confirmed: boolean }>();
  let seq = 0;
  const taken = (n: string) => [...profiles.values()].includes(n);
  const deps: SignUpDeps = {
    async usernameTaken(n) { return taken(n); },
    async signUp(i) {
      if (opts.signUpError) return { user: null, error: opts.signUpError };
      const existing = [...authUsers.entries()].find(([, u]) => u.email === i.email);
      if (existing) {
        return existing[1].confirmed
          ? { user: { id: "placeholder", identities: [] }, error: null }
          : { user: { id: existing[0], identities: [{}] }, error: null };
      }
      const id = `u${++seq}`;
      if (opts.trigger) {
        if (taken(i.username)) return { user: null, error: { status: 500, code: "unexpected_failure", message: "Database error saving new user" } };
        profiles.set(id, i.username);
      }
      authUsers.set(id, { email: i.email, confirmed: false });
      return { user: { id, identities: [{}] }, error: null };
    },
    async profileExists(id) { return profiles.has(id); },
    async insertProfile(id, n) {
      if (opts.insertFails) return { code: opts.insertFails };
      if (!authUsers.has(id)) return { code: "23503" };
      if (profiles.has(id) || taken(n)) return { code: "23505" };
      profiles.set(id, n);
      return null;
    },
  };
  return { deps, profiles, authUsers, stranded: () => [...authUsers.keys()].filter((id) => !profiles.has(id)) };
}

describe("completeSignUp", () => {
  it("creates exactly one profile for a normal sign-up (no trigger)", async () => {
    const w = world();
    const r = await completeSignUp(w.deps, input);
    expect(r.status).toBe(200);
    expect([...w.profiles.values()].filter((n) => n === "new_user")).toHaveLength(1);
    expect(w.stranded()).toEqual([]);
  });

  it("creates exactly one profile with the trigger, without a second write", async () => {
    const w = world({ trigger: true });
    const r = await completeSignUp(w.deps, input);
    expect(r.status).toBe(200);
    expect(w.profiles.size).toBe(1);
  });

  it("rejects a taken username before creating any account", async () => {
    const w = world({ takenNames: ["new_user"] });
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 409, body: { code: "username_taken", error: SIGNUP_MESSAGES.taken } });
    expect(w.authUsers.size).toBe(0);
  });

  it("race without trigger: the loser gets 409 with a recovery path, and resubmitting the same email fixes it", async () => {
    const w = world();
    // Both pass the pre-check; then the winner's profile lands first.
    const realTaken = w.deps.usernameTaken;
    let first = true;
    w.deps.usernameTaken = async (n) => (first ? ((first = false), false) : realTaken(n));
    w.profiles.set("winner", "new_user");
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 409, body: { error: SIGNUP_MESSAGES.takenDuringSignUp } });
    expect(w.stranded()).toHaveLength(1); // unconfirmed account, recoverable:
    const again = await completeSignUp(w.deps, { ...input, username: "other_name" });
    expect(again.status).toBe(200);
    expect(w.stranded()).toEqual([]);
  });

  it("race with trigger: the loser's sign-up is aborted, no account is created", async () => {
    const w = world({ trigger: true });
    let first = true;
    const realTaken = w.deps.usernameTaken;
    w.deps.usernameTaken = async (n) => (first ? ((first = false), false) : realTaken(n));
    w.profiles.set("winner", "new_user");
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 409, body: { code: "username_taken" } });
    expect(w.authUsers.size).toBe(0);
  });

  it("trigger rejection for another reason is a retryable 500, not 'taken'", async () => {
    const w = world({ signUpError: { status: 500, message: "Database error saving new user" } });
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 500, body: { code: "signup_failed" } });
  });

  it("retrying the same details (lost response) succeeds and keeps one profile", async () => {
    const w = world();
    expect((await completeSignUp(w.deps, input)).status).toBe(200);
    // The retry's pre-check sees its own username: honest message with the way forward.
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 409, body: { error: SIGNUP_MESSAGES.taken } });
    expect(w.profiles.size).toBe(1);
  });

  it("profile write failure returns a recovery message; resubmitting completes it", async () => {
    const w = world({ insertFails: "XX000" });
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 500, body: { code: "profile_failed", error: SIGNUP_MESSAGES.profileFailed } });
    expect(w.stranded()).toHaveLength(1);
    const fixed = world();
    fixed.authUsers.set("u1", { email: input.email, confirmed: false });
    expect((await completeSignUp(fixed.deps, input)).status).toBe(200);
    expect(fixed.profiles.get("u1")).toBe("new_user");
  });

  it("concurrent requests for the same account: the second sees the profile and succeeds", async () => {
    const w = world();
    w.authUsers.set("u9", { email: input.email, confirmed: false });
    w.deps.profileExists = (() => { let calls = 0; return async (id: string) => (++calls === 1 ? false : w.profiles.has(id)); })();
    w.profiles.set("u9", "new_user"); // the other request won
    w.deps.usernameTaken = async () => false;
    const r = await completeSignUp(w.deps, input);
    expect(r.status).toBe(200);
  });

  it("already-confirmed email: same answer as new sign-up, nothing written", async () => {
    const w = world();
    w.authUsers.set("old", { email: input.email, confirmed: true });
    const r = await completeSignUp(w.deps, input);
    expect(r).toMatchObject({ status: 200, body: { message: SIGNUP_MESSAGES.checkEmail } });
    expect(w.profiles.size).toBe(0);
  });

  it("existing unconfirmed account with a profile is never renamed", async () => {
    const w = world();
    w.authUsers.set("u1", { email: input.email, confirmed: false });
    w.profiles.set("u1", "first_name");
    const r = await completeSignUp(w.deps, { ...input, username: "second_name" });
    expect(r.status).toBe(200);
    expect(w.profiles.get("u1")).toBe("first_name");
  });

  it("maps the per-address resend throttle to 'wait a minute'", async () => {
    const r = await completeSignUp(world({ signUpError: { status: 429, message: "For security purposes, you can only request this after 42 seconds." } }).deps, input);
    expect(r).toMatchObject({ status: 429, body: { code: "rate_limited", error: SIGNUP_MESSAGES.rateLimited } });
  });

  it("maps the project-wide email quota to 'try again later' (not 'a minute')", async () => {
    const r = await completeSignUp(world({ signUpError: { status: 429, code: "over_email_send_rate_limit", message: "email rate limit exceeded" } }).deps, input);
    expect(r).toMatchObject({ status: 429, body: { code: "email_quota", error: SIGNUP_MESSAGES.emailQuota } });
  });

  it("passes through validation errors such as a weak password", async () => {
    const r = await completeSignUp(world({ signUpError: { status: 422, code: "weak_password", message: "Password should be at least 6 characters." } }).deps, input);
    expect(r).toMatchObject({ status: 400, body: { code: "weak_password", error: "Password should be at least 6 characters." } });
  });

  it("placeholder user id (FK failure) is answered like a new sign-up", async () => {
    const w = world();
    w.deps.signUp = async () => ({ user: { id: "ghost", identities: null }, error: null });
    expect((await completeSignUp(w.deps, input)).status).toBe(200);
    expect(w.profiles.size).toBe(0);
  });
});
