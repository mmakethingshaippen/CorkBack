// Isolated check (design.md Property 15): public.posting_takedown_at (stage6_social_part1.sql)
// and the app's postingTakedown (src/lib/lifecycle.ts) return the same instant, to the
// millisecond, for generated listing and Community rows.
// Throwaway embedded PostgreSQL only: never point this at production.
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\takedown.mjs
//
// How the TypeScript is loaded: lifecycle.ts is transpiled in memory with sucrase
// (already in the repo's node_modules, via tailwind) and evaluated. Nothing is
// written to disk and nothing is reimplemented. The one import, tz-lookup, is only
// used at publish (timeZoneForPin), never by postingTakedown, so it is stubbed.
// The SQL is loaded by slicing the two function definitions out of the stage file
// (the rest of the file needs the postings table), so the tested text is the real text.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const iso = process.env.CB_ISO_DIR;
if (!iso) throw new Error("Set CB_ISO_DIR (see README.md)");
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const sqlDir = process.env.CB_SQL_DIR ?? path.join(here, "..");
const isoRequire = createRequire(path.join(iso, "package.json"));
const { Client } = isoRequire("pg");
const { transform } = createRequire(path.join(repo, "package.json"))("sucrase");

// ---- app side: lifecycle.ts, evaluated in memory ----
const tsSource = fs.readFileSync(path.join(repo, "src", "lib", "lifecycle.ts"), "utf8");
const { code } = transform(tsSource, { transforms: ["typescript", "imports"] });
const mod = { exports: {} };
new Function("module", "exports", "require", code)(mod, mod.exports, (id) => {
  if (id === "@photostructure/tz-lookup") return { default: () => { throw new Error("not used"); } };
  throw new Error(`unexpected import ${id}`);
});
const { postingTakedown, isValidTimeZone } = mod.exports;

// ---- SQL side: the two functions from stage6_social_part1.sql ----
const stage6 = fs.readFileSync(path.join(sqlDir, "stage6_social_part1.sql"), "utf8");
const from = stage6.indexOf("create or replace function public.cb_safe_time_zone");
const to = stage6.indexOf("-- Security invoker", from);
if (from < 0 || to < 0) throw new Error("could not find the lifecycle functions in stage6_social_part1.sql");
const functionsSql = stage6.slice(from, to);

// ---- generated rows (seeded, repeatable) ----
let seed = 20260101;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const pad = (n, w = 2) => String(n).padStart(w, "0");
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const ZONES = [
  "America/Los_Angeles", "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Sao_Paulo",
  "America/Havana", "America/St_Johns", "Europe/London", "Europe/Dublin", "Europe/Berlin", "Asia/Kolkata", "Asia/Kathmandu",
  "Asia/Tokyo", "Asia/Beirut", "Australia/Lord_Howe", "Australia/Sydney", "Pacific/Auckland", "Pacific/Chatham",
  "Pacific/Apia", "Etc/GMT+12", "Etc/GMT-14", "UTC",
  // stored value is invalid or missing: both sides must fall back to Etc/GMT+12
  null, "", "Not/AZone", "5", "+05", " America/Los_Angeles", "America/Los Angeles", "America//Chicago", "Mars/Olympus",
  // pass the name pattern but are abbreviations / POSIX strings / links that the two runtimes may judge differently
  "PST", "CEST", "EST", "UTC+5", "GMT-3", "XYZ3", "EST5EDT", "US/Pacific", "Factory", "Etc/Unknown",
  "CET", "EET", "MET", "WET", "HST", "MST", "GMT", "Zulu", "NZ", "GB", "Japan", "Navajo",
];
// Days on or beside daylight saving changes (2018-2030 mix of northern, southern, Lord Howe, Chatham, Havana, Sao Paulo).
const DST_DATES = [
  "2018-11-04", "2018-11-03", "2018-11-05", "2018-02-17", "2018-02-18", "2018-11-04",
  "2026-03-08", "2026-03-07", "2026-03-09", "2026-11-01", "2026-10-31", "2026-11-02",
  "2026-03-29", "2026-03-28", "2026-10-25", "2026-10-24", "2026-10-26",
  "2026-04-05", "2026-04-04", "2026-04-06", "2026-10-04", "2026-10-03", "2026-10-05",
  "2026-09-27", "2026-09-26", "2026-09-28", "2026-04-04", "2026-03-14", "2026-03-15", "2026-11-07",
  "2027-03-14", "2027-11-07", "2028-03-26", "2025-10-26", "2030-03-31", "2024-03-10", "2024-11-03",
];
const randDate = () => `${pick([2024, 2025, 2026, 2027, 2028])}-${pad(1 + Math.floor(rnd() * 12))}-${pad(1 + Math.floor(rnd() * 28))}`;
const anyDate = () => (rnd() < 0.5 ? pick(DST_DATES) : randDate());
const randTime = () => {
  const h = pick([0, 1, 2, 3, 12, 22, 23, Math.floor(rnd() * 24)]);
  const m = pick([0, 15, 30, 45, 59, Math.floor(rnd() * 60)]);
  const s = pick([null, null, 0, 30, 59]);
  return s === null ? `${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
};
const expiry = (anchor) => {
  // Mostly after the event end (event end wins), sometimes before (expiry wins), sometimes far future.
  const r = rnd();
  const base = Date.parse(`${anchor ?? randDate()}T00:00:00Z`);
  if (r < 0.2) return new Date(base + Math.floor(rnd() * 3 * 86400000) - 86400000).toISOString();
  if (r < 0.3) return new Date(base + Math.floor(rnd() * 86400000 * 3)).toISOString();
  return new Date(Date.parse("2099-01-01T00:00:00Z") + Math.floor(rnd() * 1e9)).toISOString();
};

const rows = [];
const add = (kind, r) => rows.push({ kind, ...r });
for (let i = 0; i < 1500; i++) {
  const zone = pick(ZONES);
  // Listing: end_date only, with or without end_time (event_date null).
  const endDate = anyDate();
  add("listing", { expires_at: expiry(endDate), event_date: null, end_date: endDate, end_time: rnd() < 0.5 ? randTime() : null, time_zone: zone });
}
for (let i = 0; i < 2500; i++) {
  const zone = pick(ZONES);
  const shape = Math.floor(rnd() * 5);
  const ev = anyDate();
  const end = rnd() < 0.5 ? ev : addDays(ev, 1 + Math.floor(rnd() * 3));
  if (shape === 0) add("community", { expires_at: expiry(null), event_date: null, end_date: null, end_time: null, time_zone: zone }); // neither
  else if (shape === 1) add("community", { expires_at: expiry(ev), event_date: ev, end_date: null, end_time: null, time_zone: zone }); // event_date only
  else if (shape === 2) add("community", { expires_at: expiry(ev), event_date: ev, end_date: null, end_time: randTime(), time_zone: zone }); // + end_time
  else if (shape === 3) add("community", { expires_at: expiry(end), event_date: ev, end_date: end, end_time: null, time_zone: zone }); // + end_date
  else add("community", { expires_at: expiry(end), event_date: ev, end_date: end, end_time: randTime(), time_zone: zone });
}
// Fixed cases, including every example from the stage verify file.
add("community", { expires_at: "2099-01-01T00:00:00Z", event_date: "2026-03-08", end_date: null, end_time: null, time_zone: "America/Los_Angeles" });
add("community", { expires_at: "2099-01-01T00:00:00Z", event_date: "2026-11-16", end_date: null, end_time: null, time_zone: null });
add("community", { expires_at: "2099-01-01T00:00:00Z", event_date: "2026-11-16", end_date: "2026-11-18", end_time: "17:30", time_zone: "America/Los_Angeles" });
add("listing", { expires_at: "2099-01-01T00:00:00Z", event_date: null, end_date: "2026-04-05", end_time: "02:15", time_zone: "Australia/Lord_Howe" });
// Stored end_time values the app's clock parser treats specially: fractional seconds and 24:00.
add("community", { expires_at: "2099-01-01T00:00:00Z", event_date: "2026-11-16", end_date: null, end_time: "12:00:00.5", time_zone: "America/Los_Angeles" });
add("listing", { expires_at: "2099-01-01T00:00:00Z", event_date: null, end_date: "2026-11-16", end_time: "24:00:00", time_zone: "Europe/London" });

// Optional: also apply a draft stage file (relative to CB_SQL_DIR) on top, to check a proposed fix.
const draftFile = process.env.CB_TAKEDOWN_DRAFT;

const appMs = (r) => postingTakedown({
  expiresAt: r.expires_at, eventDate: r.event_date, endDate: r.end_date, endTime: r.end_time, timeZone: r.time_zone, lat: 0, lng: 0,
}).getTime();

// ---- throwaway database ----
const bin = path.join(iso, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cb-takedown-"));
const port = 55500 + Math.floor(Math.random() * 90);
execFileSync(path.join(bin, "initdb.exe"), ["-D", data, "-U", "supabase_admin", "-E", "UTF8", "--auth=trust", "--locale=C"], { stdio: "ignore" });
const server = spawn(path.join(bin, "postgres.exe"), ["-D", data, "-p", String(port)], { stdio: "ignore" });
async function connect(user) {
  for (let i = 0; i < 50; i++) {
    const c = new Client({ port, user, database: "postgres", password: user === "postgres" ? "iso-owner-pw" : undefined });
    try { await c.connect(); return c; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("database did not start");
}

let exitCode = 0;
try {
  const admin = await connect("supabase_admin");
  await admin.query(fs.readFileSync(path.join(here, "bootstrap.sql"), "utf8"));
  await admin.end();
  const db = await connect("postgres");
  await db.query(functionsSql);
  const defs = async () => (await db.query(
    `select string_agg(pg_get_functiondef(p.oid), E'\n' order by p.proname) as d
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and p.proname in ('cb_safe_time_zone', 'posting_takedown_at')`)).rows[0].d;
  const stage6Defs = await defs();
  if (draftFile) {
    await db.query(fs.readFileSync(path.join(sqlDir, draftFile), "utf8"));
    await db.query(fs.readFileSync(path.join(sqlDir, draftFile), "utf8")); // rerun safety
    console.log(`applied draft ${draftFile} twice (throwaway database only)`);
  }

  // Every zone name this Postgres knows (with and without '/'), on daylight saving days.
  const { rows: names } = await db.query("select name from pg_timezone_names order by name collate \"C\"");
  for (const { name } of names) {
    for (const d of [pick(DST_DATES), pick(DST_DATES), randDate()]) {
      add("community", { expires_at: "2099-01-01T00:00:00Z", event_date: d, end_date: null, end_time: rnd() < 0.5 ? randTime() : null, time_zone: name });
      add("listing", { expires_at: "2099-01-01T00:00:00Z", event_date: null, end_date: d, end_time: rnd() < 0.5 ? randTime() : null, time_zone: name });
    }
  }

  const { rows: out } = await db.query(
    `select r.i, public.cb_safe_time_zone(r.time_zone) as zone,
            floor(extract(epoch from public.posting_takedown_at(r.expires_at, r.event_date, r.end_date, r.end_time, r.time_zone)) * 1000)::bigint::text as ms
       from jsonb_to_recordset($1::jsonb)
            as r(i int, expires_at timestamptz, event_date date, end_date date, end_time time, time_zone text)
      order by r.i`,
    [JSON.stringify(rows.map((r, i) => ({ i, ...r })))],
  );

  // Known limit (documented in stage13): a name the app's runtime accepts while
  // the database falls back to Etc/GMT+12 (ICU legacy aliases such as PST, and
  // CET/EET/MET/WET with the stage 13 draft). The app never stores such a name
  // (tz-lookup at publish, checked with cb_safe_time_zone), so these rows are
  // reported, not failed. Every other difference fails the check.
  const mismatches = [], knownLimit = [];
  const perKind = { listing: 0, community: 0 };
  rows.forEach((r, i) => {
    perKind[r.kind]++;
    const db_ms = out[i].ms;
    const app_ms = String(appMs(r));
    if (db_ms === app_ms) return;
    const m = { row: r, db: new Date(Number(db_ms)).toISOString(), app: new Date(Number(app_ms)).toISOString() };
    const dbFellBack = out[i].zone === "Etc/GMT+12" && r.time_zone !== "Etc/GMT+12";
    (dbFellBack && isValidTimeZone(r.time_zone) ? knownLimit : mismatches).push(m);
  });
  console.log(`rows compared: ${rows.length} (listing ${perKind.listing}, community ${perKind.community})`);
  console.log(`mismatches: ${mismatches.length}`);
  if (knownLimit.length) {
    console.log(`known limit (zone names only the app accepts; tz-lookup never returns them): ${knownLimit.length} rows, zones ${[...new Set(knownLimit.map((m) => m.row.time_zone))].join(", ")}`);
  }
  const byZone = {};
  for (const m of mismatches) byZone[String(m.row.time_zone)] = (byZone[String(m.row.time_zone)] ?? 0) + 1;
  if (mismatches.length) console.log(`mismatches by stored zone: ${JSON.stringify(byZone)}`);
  const shown = new Set();
  for (const m of mismatches) {
    const z = String(m.row.time_zone);
    if (shown.has(z) && (process.env.CB_TAKEDOWN_VERBOSE ?? "") === "") continue;
    shown.add(z);
    console.log(JSON.stringify(m));
  }
  if (mismatches.length) exitCode = 1;

  if (draftFile) {
    const rollback = draftFile.replace(/\.sql$/, "_rollback.sql");
    await db.query(fs.readFileSync(path.join(sqlDir, rollback), "utf8"));
    const same = (await defs()) === stage6Defs;
    console.log(`${same ? "PASS" : "FAIL"} ${rollback} restores the stage 6 definitions exactly`);
    if (!same) exitCode = 1;
  }
  await db.end();
} catch (e) {
  console.log(`FAIL harness: ${e.stack ?? e}`);
  exitCode = 1;
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 1500));
  fs.rmSync(data, { recursive: true, force: true });
  process.exitCode = exitCode;
}
