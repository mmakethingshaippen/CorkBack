import { describe, expect, it } from "vitest";
import {
  REPORT_REASONS,
  REPORT_REASON_LABEL,
  adminErrorResponse,
  adminOutcomeMessage,
  reportErrorResponse,
  validateAdminAction,
  validateReportInput,
} from "./moderation";

const U1 = "6c5e0000-0000-4000-8000-00000000008a";
const U2 = "6c5e0000-0000-4000-8000-00000000008b";

describe("report reasons", () => {
  it("offers exactly the six approved reasons, each with a label", () => {
    expect([...REPORT_REASONS]).toEqual(["spam_scam", "inappropriate", "misleading", "personal_info", "duplicate", "other"]);
    expect(Object.values(REPORT_REASON_LABEL)).toEqual([
      "Spam or scam", "Inappropriate content", "Misleading information", "Personal information", "Duplicate", "Other",
    ]);
  });
});

describe("validateReportInput", () => {
  it("accepts a reason with no details (details are optional for every reason)", () => {
    for (const reason of REPORT_REASONS) expect(validateReportInput({ reason })).toEqual({ ok: true, value: { reason, details: null } });
  });
  it("trims details and treats whitespace-only as none", () => {
    expect(validateReportInput({ reason: "other", details: "  hi  " })).toEqual({ ok: true, value: { reason: "other", details: "hi" } });
    expect(validateReportInput({ reason: "other", details: "   " })).toEqual({ ok: true, value: { reason: "other", details: null } });
  });
  it("rejects an unknown reason, non-text details and details over 1000", () => {
    expect(validateReportInput({ reason: "nope" }).ok).toBe(false);
    expect(validateReportInput({}).ok).toBe(false);
    expect(validateReportInput(null).ok).toBe(false);
    expect(validateReportInput({ reason: "other", details: 5 }).ok).toBe(false);
    expect(validateReportInput({ reason: "other", details: "x".repeat(1001) }).ok).toBe(false);
    expect(validateReportInput({ reason: "other", details: "x".repeat(1000) }).ok).toBe(true);
  });
});

describe("database error mapping", () => {
  it("maps the report function's errors to the documented statuses", () => {
    expect(reportErrorResponse("42501").status).toBe(401);
    expect(reportErrorResponse("CB404").status).toBe(404);
    expect(reportErrorResponse("CB400").status).toBe(400);
    expect(reportErrorResponse("CB413").status).toBe(413);
    expect(reportErrorResponse("CB429").status).toBe(429);
    expect(reportErrorResponse(undefined).status).toBe(500);
  });
  it("a non-admin (42501) is told the admin route does not exist", () => {
    expect(adminErrorResponse("42501")).toMatchObject({ status: 404, code: "not_found" });
    expect(adminErrorResponse("CB400").code).toBe("wrong_report");
    expect(adminErrorResponse("CB409").status).toBe(409);
    expect(adminErrorResponse("CB422").status).toBe(400);
  });
  it("describes the idempotent outcomes", () => {
    expect(adminOutcomeMessage("already_hidden")).toMatch(/already hidden/);
    expect(adminOutcomeMessage("not_pending")).toMatch(/already resolved/);
    expect(adminOutcomeMessage("not_hidden")).toMatch(/wasn't hidden/);
  });
});

describe("validateAdminAction", () => {
  it("requires a reason to hide or restore (whitespace-only is blank), but not a note to dismiss", () => {
    expect(validateAdminAction({ kind: "hide", postingId: U1, reason: "   " }).ok).toBe(false);
    expect(validateAdminAction({ kind: "restore", postingId: U1, reason: "" }).ok).toBe(false);
    expect(validateAdminAction({ kind: "hide", postingId: U1, reason: " personal info ", reportId: U2 })).toEqual({
      ok: true, value: { kind: "hide", postingId: U1, reason: "personal info", reportId: U2 },
    });
    expect(validateAdminAction({ kind: "dismiss", reportId: U2 })).toEqual({ ok: true, value: { kind: "dismiss", reportId: U2, note: null } });
  });
  it("rejects bad ids, unknown kinds and over-long reasons", () => {
    expect(validateAdminAction({ kind: "hide", postingId: "x", reason: "r" }).ok).toBe(false);
    expect(validateAdminAction({ kind: "hide", postingId: U1, reason: "r", reportId: "nope" }).ok).toBe(false);
    expect(validateAdminAction({ kind: "delete", postingId: U1 }).ok).toBe(false);
    expect(validateAdminAction({ kind: "hide", postingId: U1, reason: "x".repeat(501) }).ok).toBe(false);
    expect(validateAdminAction({ kind: "hide", postingId: U1, reason: "x".repeat(500) }).ok).toBe(true);
  });
});
