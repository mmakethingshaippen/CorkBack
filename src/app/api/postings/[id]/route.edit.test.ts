import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import fc from "fast-check";

// Stubbed Supabase client: records every update payload; never touches a real database.
const h = vi.hoisted(() => ({
  user: { id: "11111111-1111-4111-8111-111111111111" } as { id: string } | null,
  row: null as Record<string, unknown> | null,
  updates: [] as Record<string, unknown>[],
  updateResult: { data: [{ id: "x" }], error: null } as { data: unknown; error: unknown },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user } }) },
    from: (table: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: h.row });
      b.single = async () => ({ data: { id: `cat-${table}` } });
      b.update = (patch: Record<string, unknown>) => {
        h.updates.push(patch);
        const u: Record<string, unknown> = {};
        u.eq = () => u;
        u.select = async () => h.updateResult;
        return u;
      };
      return b;
    },
  }),
}));

import { PATCH } from "./route";

const POSTING_ID = "22222222-2222-4222-8222-222222222222";
const call = (body: unknown) =>
  PATCH(new Request("http://localhost/api/postings/x", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: POSTING_ID }),
  });

const baseRow = (over: Record<string, unknown> = {}) => ({
  id: POSTING_ID,
  author_id: h.user!.id,
  expires_at: "2099-12-31T00:00:00Z",
  event_date: null,
  event_time: null,
  end_date: null,
  end_time: null,
  rsvp_url: null,
  time_zone: "America/Chicago",
  lat: 41.5,
  lng: -90.5,
  deleted_at: null,
  category: { slug: "music" },
  ...over,
});

const EDITABLE = ["title", "body", "category_id", "event_date", "event_time", "end_date", "end_time", "place_label", "rsvp_url"];
const DATE_COLS = ["event_date", "event_time", "end_date", "end_time"];

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.invalid";
  h.user = { id: "11111111-1111-4111-8111-111111111111" };
  h.updates = [];
  h.updateResult = { data: [{ id: POSTING_ID }], error: null };
  h.row = baseRow();
});

describe("PATCH /api/postings/[id] write sets", () => {
  it("event: writes the four date columns, content columns, and no pin/expiry/flyer", async () => {
    const res = await call({ title: "Show", categorySlug: "music", eventDate: "2090-05-01", eventTime: "19:00", endDate: "2090-05-01", endTime: "21:00", placeLabel: "Hall" });
    expect(res.status).toBe(200);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0]).toMatchObject({ event_date: "2090-05-01", event_time: "19:00", end_date: "2090-05-01", end_time: "21:00", place_label: "Hall" });
    for (const k of ["lat", "lng", "expires_at", "flyer_url", "author_id", "created_at"]) expect(h.updates[0]).not.toHaveProperty(k);
  });

  it("listing: end_date is the deadline; event_date, event_time, end_time are null", async () => {
    h.row = baseRow({ category: { slug: "jobs" } });
    const res = await call({ title: "Hiring", categorySlug: "jobs", deadline: "2090-06-01" });
    expect(res.status).toBe(200);
    expect(h.updates[0]).toMatchObject({ end_date: "2090-06-01", event_date: null, event_time: null, end_time: null });
  });

  it("listing with stored legacy event_date: left as stored unless replaceLegacyEventDate is true", async () => {
    h.row = baseRow({ category: { slug: "jobs" }, event_date: "2090-04-01", event_time: "10:00", end_time: "11:00" });
    await call({ title: "Hiring", categorySlug: "jobs", deadline: "2090-06-01" });
    expect(h.updates[0]).toMatchObject({ event_date: "2090-04-01", event_time: "10:00", end_time: "11:00", end_date: "2090-06-01" });
    await call({ title: "Hiring", categorySlug: "jobs", deadline: "2090-06-01", replaceLegacyEventDate: true });
    expect(h.updates[1]).toMatchObject({ event_date: null, event_time: null, end_time: null, end_date: "2090-06-01" });
  });

  it("event to listing clears the times (and the date when replaced)", async () => {
    h.row = baseRow({ event_date: "2090-04-01", event_time: "10:00", end_time: "11:00" });
    await call({ title: "Sale", categorySlug: "sale", deadline: "2090-06-01" });
    expect(h.updates[0]).toMatchObject({ event_time: null, end_time: null, end_date: "2090-06-01" });
    await call({ title: "Sale", categorySlug: "sale", deadline: "2090-06-01", replaceLegacyEventDate: true });
    expect(h.updates[1]).toMatchObject({ event_date: null, event_time: null, end_time: null });
  });

  it("community with a date follows event rules; without a date all four are null", async () => {
    h.row = baseRow({ category: { slug: "community" } });
    await call({ title: "Meetup", categorySlug: "community", eventDate: "2090-05-01", eventTime: "18:00" });
    expect(h.updates[0]).toMatchObject({ event_date: "2090-05-01", event_time: "18:00", end_date: null, end_time: null });
    await call({ title: "Meetup", categorySlug: "community" });
    expect(h.updates[1]).toMatchObject({ event_date: null, event_time: null, end_date: null, end_time: null });
  });

  it("rsvp_url is omitted when unchanged (after normalisation) and written when changed", async () => {
    h.row = baseRow({ rsvp_url: "https://example.com/rsvp" });
    await call({ title: "Show", categorySlug: "music", eventDate: "2090-05-01", rsvpUrl: "  https://example.com/rsvp  " });
    expect(h.updates[0]).not.toHaveProperty("rsvp_url");
    await call({ title: "Show", categorySlug: "music", eventDate: "2090-05-01", rsvpUrl: "https://example.com/other" });
    expect(h.updates[1]).toMatchObject({ rsvp_url: "https://example.com/other" });
    await call({ title: "Show", categorySlug: "music", eventDate: "2090-05-01", rsvpUrl: "" });
    expect(h.updates[2]).toMatchObject({ rsvp_url: null });
  });

  it("validation errors write nothing", async () => {
    for (const body of [
      { title: "", categorySlug: "music", eventDate: "2090-05-01" },
      { title: "x", categorySlug: "nope" },
      { title: "x", categorySlug: "music", eventDate: "2090-05-01", rsvpUrl: "ftp://a.b" },
      { title: "x", categorySlug: "music", eventDate: "2090-05-01", endDate: "2090-04-01" },
      { title: "x", categorySlug: "jobs", deadline: "2000-01-01" },
    ]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(h.updates).toHaveLength(0);
  });

  it("signed-out and non-owner requests write nothing", async () => {
    h.user = null;
    expect((await call({ title: "x", categorySlug: "music", eventDate: "2090-05-01" })).status).toBe(401);
    h.user = { id: "33333333-3333-4333-8333-333333333333" };
    expect((await call({ title: "x", categorySlug: "music", eventDate: "2090-05-01" })).status).toBe(404);
    expect(h.updates).toHaveLength(0);
  });
});

describe("EditPostingForm cancel (source contract)", () => {
  it("Cancel is a link back to the posting and sends no request", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src/app/p/[id]/edit/EditPostingForm.tsx"), "utf8");
    const cancel = src.indexOf("Cancel");
    expect(cancel).toBeGreaterThan(-1);
    const start = src.lastIndexOf("<Link", cancel);
    expect(start).toBeGreaterThan(-1);
    const tag = src.slice(start, cancel);
    expect(tag).toContain("href={`/p/${postingId}`}");
    expect(tag).not.toMatch(/onClick|fetch/);
    expect(src.match(/fetch\(/g) ?? []).toHaveLength(1); // only the save request
  });
});

/**
 * Feature: board-usability-improvements, Property 16: Edit never changes data silently.
 * **Validates: Requirements 11.7, 11.8**
 */
describe("Property 16: edit never changes data silently", () => {
  const slugs = ["music", "classes", "community", "jobs", "housing", "sale", "lost-found"];
  const date = fc.integer({ min: 0, max: 300 }).map((n) => new Date(Date.UTC(2090, 0, 1 + n)).toISOString().slice(0, 10));
  const time = fc.constantFrom("08:00", "12:30", "19:00", "23:15");
  const opt = <T>(a: fc.Arbitrary<T>) => fc.option(a, { nil: null });
  const url = fc.constantFrom("https://a.example/x", "https://b.example/y", "http://c.example");

  const stored = fc.record({
    slug: fc.constantFrom(...slugs),
    event_date: opt(date), event_time: opt(time), end_date: opt(date), end_time: opt(time), rsvp_url: opt(url),
  });
  const edit = fc.record({
    categorySlug: fc.constantFrom(...slugs),
    title: fc.constantFrom("T", "", "  Title  "),
    eventDate: opt(date), eventTime: opt(time), endDate: opt(date), endTime: opt(time), deadline: opt(date),
    rsvpUrl: fc.oneof(opt(url), fc.constantFrom("", "  https://a.example/x  ", "ftp://bad", "not a url")),
    replaceLegacyEventDate: fc.boolean(),
  });

  it("every written column is owner input or kind-required; nothing outside the allowed set; errors write nothing", async () => {
    await fc.assert(
      fc.asyncProperty(stored, edit, async (s, b) => {
        h.updates = [];
        h.row = baseRow({ category: { slug: s.slug }, event_date: s.event_date, event_time: s.event_time, end_date: s.end_date, end_time: s.end_time, rsvp_url: s.rsvp_url });
        const res = await call(b);
        if (res.status !== 200) {
          expect(h.updates).toHaveLength(0);
          return;
        }
        expect(h.updates).toHaveLength(1);
        const p = h.updates[0];
        for (const k of Object.keys(p)) expect(EDITABLE).toContain(k);
        const listing = ["jobs", "housing", "sale", "lost-found"].includes(b.categorySlug);
        const oldListing = ["jobs", "housing", "sale", "lost-found"].includes(s.slug);
        const input: Record<string, unknown> = { event_date: b.eventDate, event_time: b.eventTime, end_date: b.endDate, end_time: b.endTime };
        for (const c of DATE_COLS) {
          expect(p).toHaveProperty(c);
          const v = p[c];
          if (v === null) continue;
          if (listing) {
            if (c === "end_date") expect(v).toBe(b.deadline);
            else {
              // Only a stored legacy event_date (and its times, when not coming from an event kind) may survive.
              expect(b.replaceLegacyEventDate).toBe(false);
              expect(v).toBe(s[c as "event_date" | "event_time" | "end_time"]);
              expect(s.event_date).not.toBeNull();
              if (c !== "event_date") expect(oldListing).toBe(true);
            }
          } else {
            expect(v).toBe(input[c]);
          }
        }
        // rsvp_url: present only when it changes the stored value.
        if ("rsvp_url" in p) expect(p.rsvp_url).not.toBe(s.rsvp_url);
        else expect(b.rsvpUrl === null || b.rsvpUrl === "" ? null : String(b.rsvpUrl).trim()).toBe(s.rsvp_url);
        // The owner-entered title/body/place are written as given.
        expect(p.title).toBe(b.title.trim());
      }),
      { numRuns: 200 },
    );
  });
});
