import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const sent: Record<string, unknown>[] = [];
vi.mock("resend", () => ({
  Resend: class {
    emails = {
      send: async (m: Record<string, unknown>) => {
        sent.push(m);
        return { error: null };
      },
    };
  },
}));

const builderInputs: Record<string, unknown>[] = [];
vi.mock("@/lib/email", async (orig) => {
  const actual = await orig<typeof import("@/lib/email")>();
  return {
    ...actual,
    sendAlertEmail: (input: { to: string; posting: Record<string, unknown> }) => {
      builderInputs.push(input.posting);
      return actual.sendAlertEmail(input as Parameters<typeof actual.sendAlertEmail>[0]);
    },
  };
});

const future = new Date(Date.now() + 30 * 86400_000).toISOString();
const posting = (id: string, extra: Record<string, unknown>) => ({
  id,
  author_id: "poster",
  lat: 40,
  lng: -75,
  expires_at: future,
  event_date: null,
  end_date: null,
  end_time: null,
  time_zone: "America/New_York",
  deleted_at: null,
  title: `Title ${id}`,
  event_time: null,
  place_label: "Main St",
  categories: { slug: "jobs" },
  ...extra,
});

let postingRows: unknown[] = [];

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "is", "gt", "eq"]) b[m] = () => b;
      b.maybeSingle = async () => ({ data: null, error: null });
      b.insert = async () => ({ error: null });
      const rows =
        table === "postings"
          ? postingRows
          : table === "alerts"
            ? [{ id: "a1", user_id: "owner", center_lat: 40, center_lng: -75, radius_miles: 5, categories: { slug: "jobs" } }]
            : [];
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
      return b;
    },
    auth: { admin: { getUserById: async () => ({ data: { user: { email: "owner@example.com" } } }) } },
  }),
}));

import { GET } from "./route";

const req = () =>
  new Request("http://localhost/api/cron/alerts", { headers: { authorization: "Bearer test-cron-secret" } });

describe("alert cron route", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    sent.length = 0;
    builderInputs.length = 0;
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
    process.env.RESEND_API_KEY = "re_test_never_sent";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("passes endDate and categorySlug to the builder and keeps going past a bad posting", async () => {
    postingRows = [
      posting("bad", { end_date: "not-a-date" }),
      posting("good", { end_date: "2099-12-01" }),
    ];
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(2);
    expect(body.errors).toEqual([]);

    const good = builderInputs.find((p) => p.id === "good");
    expect(good).toMatchObject({ endDate: "2099-12-01", categorySlug: "jobs" });

    const goodMail = sent.find((m) => String(m.subject).includes("Title good"));
    expect(String(goodMail?.text)).toContain("Apply by Dec 1");
    const badMail = sent.find((m) => String(m.subject).includes("Title bad"));
    expect(badMail).toBeDefined();
    expect(`${badMail?.subject}${badMail?.text}${badMail?.html}`).not.toMatch(/null|undefined|Invalid Date/);
    expect(String(badMail?.text)).not.toContain("Apply by");
  });
});
