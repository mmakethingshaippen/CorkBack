// Test-only stand-in for the Supabase client used by queryPostingsInBounds.
// It applies the inclusive lat/lng filters, the category embed filter and the
// query order for real, and records every call. It never touches a network.

export interface StubRow {
  id: string;
  title: string;
  lat: number;
  lng: number;
  created_at: string;
  is_promoted: boolean;
  expires_at: string;
  event_date: string | null;
  time_zone: string | null;
  categories: { slug: string };
  [k: string]: unknown;
}

export interface StubCall {
  filters: { op: string; col: string; val: unknown }[];
  from: number;
  to: number;
  columns: string;
}

export const FUTURE = "2999-01-01T00:00:00.000Z";

export function makeRow(i: number, over: Partial<StubRow> = {}): StubRow {
  return {
    id: `row-${String(i).padStart(5, "0")}`,
    title: `Posting ${i}`,
    body: "",
    lat: 37.87,
    lng: -122.27,
    // Lower i = newer, so the stub order (newest first) is index order.
    created_at: new Date(Date.UTC(2030, 0, 1) - i * 1000).toISOString(),
    is_promoted: false,
    expires_at: FUTURE,
    event_date: null,
    time_zone: null,
    expiry: "1m",
    categories: { slug: "community" },
    profiles: { username: "poster", avatar_path: null },
    ...over,
  };
}

/** An event that ended long ago while expires_at is still in the future. */
export const endedOver = (): Partial<StubRow> => ({ event_date: "2020-01-01", time_zone: "UTC" });

export function makeStubClient(
  rows: StubRow[],
  opts: { error?: { code: string; message: string }; user?: { id: string } | null } = {},
) {
  const calls: StubCall[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: opts.user ?? null } }) },
    from: (_table: string) => {
      const call: StubCall = { filters: [], from: -1, to: -1, columns: "" };
      const b = {
        select: (c: string) => ((call.columns = c), b),
        is: (col: string, val: unknown) => (call.filters.push({ op: "is", col, val }), b),
        gt: (col: string, val: unknown) => (call.filters.push({ op: "gt", col, val }), b),
        gte: (col: string, val: unknown) => (call.filters.push({ op: "gte", col, val }), b),
        lte: (col: string, val: unknown) => (call.filters.push({ op: "lte", col, val }), b),
        eq: (col: string, val: unknown) => (call.filters.push({ op: "eq", col, val }), b),
        order: () => b,
        range: async (from: number, to: number) => {
          call.from = from;
          call.to = to;
          calls.push(call);
          if (opts.error) return { data: null, error: opts.error };
          let out = rows.filter((r) =>
            call.filters.every((f) => {
              if (f.op === "gte" && (f.col === "lat" || f.col === "lng")) return (r[f.col] as number) >= (f.val as number);
              if (f.op === "lte" && (f.col === "lat" || f.col === "lng")) return (r[f.col] as number) <= (f.val as number);
              if (f.op === "eq" && f.col === "categories.slug") return r.categories.slug === f.val;
              return true;
            }),
          );
          out = [...out].sort(
            (a, c) =>
              Number(c.is_promoted) - Number(a.is_promoted) ||
              Date.parse(c.created_at) - Date.parse(a.created_at) ||
              (a.id < c.id ? 1 : a.id > c.id ? -1 : 0),
          );
          return { data: out.slice(from, to + 1), error: null };
        },
      };
      return b;
    },
  };
  return { client, calls };
}
