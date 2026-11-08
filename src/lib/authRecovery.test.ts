import { describe, it, expect } from "vitest";
import { hasRecoveryAmr, isRecentRecovery } from "./authRecovery";
import { normalizeAppUrl, safeNextPath } from "./appUrl";

// Build an unsigned JWT-shaped string with the given claims (test-only).
function jwt(claims: object): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "none" })}.${b64(claims)}.sig`;
}

describe("hasRecoveryAmr", () => {
  it("is true when amr records a recovery", () => {
    expect(hasRecoveryAmr(jwt({ amr: [{ method: "recovery", timestamp: 1 }] }))).toBe(true);
  });
  it("is false for otp and password sessions (this project records recovery as otp)", () => {
    expect(hasRecoveryAmr(jwt({ amr: [{ method: "otp", timestamp: 1 }] }))).toBe(false);
    expect(hasRecoveryAmr(jwt({ amr: [{ method: "password", timestamp: 1 }] }))).toBe(false);
  });
  it("is false for missing or malformed tokens", () => {
    expect(hasRecoveryAmr(null)).toBe(false);
    expect(hasRecoveryAmr("not-a-jwt")).toBe(false);
    expect(hasRecoveryAmr(jwt({}))).toBe(false);
  });
});

describe("isRecentRecovery", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  it("is true within the last hour", () => {
    expect(isRecentRecovery({ recovery_sent_at: "2026-11-03T11:30:00Z" }, now)).toBe(true);
  });
  it("is false when older than an hour, missing, or in the future", () => {
    expect(isRecentRecovery({ recovery_sent_at: "2026-11-03T10:00:00Z" }, now)).toBe(false);
    expect(isRecentRecovery({ recovery_sent_at: null }, now)).toBe(false);
    expect(isRecentRecovery(null, now)).toBe(false);
    expect(isRecentRecovery({ recovery_sent_at: "2026-11-03T13:00:00Z" }, now)).toBe(false);
  });
});

describe("normalizeAppUrl", () => {
  it("forces https for the production host (the live misconfiguration)", () => {
    expect(normalizeAppUrl("http://corkback.vercel.app")).toBe("https://corkback.vercel.app");
  });
  it("reduces to a bare origin and tolerates a missing scheme", () => {
    expect(normalizeAppUrl("https://corkback.vercel.app/")).toBe("https://corkback.vercel.app");
    expect(normalizeAppUrl(" corkback.vercel.app ")).toBe("https://corkback.vercel.app");
  });
  it("keeps http for local development", () => {
    expect(normalizeAppUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("returns null for empty or unusable values", () => {
    expect(normalizeAppUrl("")).toBeNull();
    expect(normalizeAppUrl(undefined)).toBeNull();
    expect(normalizeAppUrl("http://")).toBeNull();
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
