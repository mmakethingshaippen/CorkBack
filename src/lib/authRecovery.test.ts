import { describe, it, expect } from "vitest";
import { isRecoverySession } from "./authRecovery";
import { safeNextPath } from "./appUrl";

// Build an unsigned JWT-shaped string with the given claims (test-only).
function jwt(claims: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

describe("isRecoverySession", () => {
  it("is true for a session created from a recovery link", () => {
    expect(isRecoverySession(jwt({ amr: [{ method: "recovery", timestamp: 1 }] }))).toBe(true);
  });
  it("is false for an ordinary password sign-in", () => {
    expect(isRecoverySession(jwt({ amr: [{ method: "password", timestamp: 1 }] }))).toBe(false);
  });
  it("is false for missing or malformed tokens", () => {
    expect(isRecoverySession(null)).toBe(false);
    expect(isRecoverySession("not-a-jwt")).toBe(false);
    expect(isRecoverySession(jwt({}))).toBe(false);
  });
});

describe("safeNextPath", () => {
  it("allows same-site relative paths", () => {
    expect(safeNextPath("/auth/reset-password")).toBe("/auth/reset-password");
  });
  it("rejects absolute and protocol-relative URLs (open redirect)", () => {
    expect(safeNextPath("https://evil.example")).toBe("/");
    expect(safeNextPath("//evil.example")).toBe("/");
    expect(safeNextPath("/\\evil.example")).toBe("/");
  });
  it("uses the fallback when empty", () => {
    expect(safeNextPath(null, "/sign-in")).toBe("/sign-in");
  });
});
