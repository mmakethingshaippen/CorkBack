// Two-account LOCAL verification of stage 11 (message reads) with thread auto-refresh.
// Embedded PostgreSQL 17 + PostgREST 14.18 (production's version) on this machine only.
// Nothing here connects to Supabase, Vercel or the production database. This is NOT a
// hosted-preview test: no Next.js server, no Supabase Auth, no real browsers.
//
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\twoaccount.mjs
//
// What is real: the production migration chain, the stage 11 preflight / migration /
// verify_roles files, row level security and grants, PostgREST, user JWTs, and the
// app's own client logic (src/lib/messagePolling.ts createPoller, src/lib/messaging.ts
// mergeMessages, src/lib/unread.ts), transpiled in memory with sucrase.
// What is mirrored: the database calls of the routes (/api/messages GET with `after`,
// /api/messages/reply via sendMessageOnce, /api/messages/unread, /api/messages/read) and
// ThreadView's run/markRead glue. The calls are copied from those files, not invented.
// Synthetic accounts iso_alex (A) and iso_blair (B), plus iso_casey (C) as a third user.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = process.env.CB_SQL_DIR ?? path.resolve(HERE, "..");
const REPO = path.resolve(HERE, "..", "..");
const DIR = process.env.CB_ISO_DIR;
if (!DIR) throw new Error("Set CB_ISO_DIR (see README.md)");
const requireIso = createRequire(path.join(DIR, "package.json"));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireIso.resolve("embedded-postgres")).href);
const pg = requireIso("pg");
const { PostgrestClient } = requireIso("@supabase/postgrest-js");
const { transform } = createRequire(path.join(REPO, "package.json"))("sucrase");

// ---- app modules, as shipped ----
function load(file) {
  const mod = { exports: {} };
  const { code } = transform(fs.readFileSync(path.join(REPO, "src", "lib", file), "utf8"), { transforms: ["typescript", "imports"] });
  new Function("module", "exports", "require", code)(mod, mod.exports, (id) => { throw new Error(`unexpected import ${id} in ${file}`); });
  return mod.exports;
}
const { createPoller } = load("messagePolling.ts");
const { mergeMessages } = load("messaging.ts");
const { advanceMarker, totalUnread, badgeText, messagesAriaLabel } = load("unread.ts");

const PG_PORT = 55000 + crypto.randomInt(0, 2000), REST_PORT = 58000 + crypto.randomInt(0, 2000);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwt = (claims) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== "" ? "  :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const embedded = new EmbeddedPostgres({ databaseDir: path.join(DIR, "data-twoaccount"), user: "supabase_admin", password: "iso-super-pw", port: PG_PORT,
  persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
let rest = null;
const sqlFile = async (c, f) => { const r = await c.query(fs.readFileSync(path.join(SQL, f), "utf8")); return (Array.isArray(r) ? r : [r]).flatMap((x) => x.rows ?? []); };

try {
  await embedded.initialise();
  await embedded.start();
  const su = embedded.getPgClient(); await su.connect();
  await su.query(fs.readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
  await su.end();
  const owner = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "iso-owner-pw", database: "postgres" });
  owner.on("error", () => {});
  await owner.connect();
  for (const f of ["schema.sql", "stage2_alerts.sql", "stage3_messaging.sql", "stage5_categories.sql",
                   "stage6_social_part1.sql", "stage6_social_part3.sql", "stage6_social_part4.sql"]) await sqlFile(owner, f);
  console.log("applied the production chain: schema, stage2, stage3, stage5, stage6 parts 1, 3, 4");

  // Synthetic accounts and one synthetic posting by B (seeded as the owner, like sign-up and publish do).
  const A = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID();
  for (const [id, name] of [[A, "iso_alex"], [B, "iso_blair"], [C, "iso_casey"]]) {
    await owner.query("insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())", [id, `${name}@iso.invalid`, { username: name }]);
    await owner.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]);
  }
  const cat = (await owner.query("select id from public.categories where slug = 'sale'")).rows[0].id;
  const posting = (await owner.query(
    "insert into public.postings (author_id, title, category_id, lat, lng, expiry, expires_at, time_zone) values ($1, '[SYNTHETIC] Porch sale', $2, 37.87, -122.27, '1w', now() + interval '7 days', 'America/Los_Angeles') returning id",
    [B, cat])).rows[0].id;
  // A thread that already has history BEFORE stage 11 (the backfill must mark it read).
  const [lo, hi] = [A, B].sort();
  const thread = (await owner.query("insert into public.message_threads (posting_id, user_lo, user_hi) values ($1, $2, $3) returning id", [posting, lo, hi])).rows[0].id;
  await owner.query("insert into public.messages (thread_id, sender_id, body, client_id) values ($1, $2, 'Is it still available?', gen_random_uuid())", [thread, A]);
  await owner.query("insert into public.messages (thread_id, sender_id, body, client_id) values ($1, $2, 'Yes, come by Saturday.', gen_random_uuid())", [thread, B]);

  // ---- stage 11 in the documented order ----
  const before = (await owner.query("select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) h from public.messages m")).rows[0].h;
  const pre = await sqlFile(owner, "stage11_message_reads_preflight.sql");
  check("1 preflight runs read-only and reports message_thread_reads absent", JSON.stringify(pre).match(/message_thread_reads/i) !== null, pre.slice(0, 3));
  await sqlFile(owner, "stage11_message_reads.sql");
  const ver = await sqlFile(owner, "stage11_message_reads_verify_roles.sql");
  const all = ver.find((r) => JSON.stringify(r).includes("ALL CHECKS PASS"));
  check("2 migration applied; verify_roles reports ALL CHECKS PASS", all && Object.values(all).includes(true), all);
  const after = (await owner.query("select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) h from public.messages m")).rows[0].h;
  check("2 messages unchanged by migration and verify", before === after);

  // ---- PostgREST 14.18 ----
  const bin = path.join(DIR, "node_modules/@embedded-postgres/windows-x64/native/bin");
  let ready = false;
  for (let attempt = 1; attempt <= 3 && !ready; attempt++) {
    rest = spawn(path.join(DIR, "postgrest/postgrest.exe"), [], {
      env: { ...process.env, PATH: `${bin};${process.env.PATH}`, PGRST_DB_URI: `postgres://authenticator:iso-auth-pw@127.0.0.1:${PG_PORT}/postgres`,
        PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: JWT_SECRET, PGRST_SERVER_PORT: String(REST_PORT),
        PGRST_SERVER_HOST: "127.0.0.1", PGRST_LOG_LEVEL: "error" }, stdio: "ignore" });
    for (let i = 0; i < 40 && !ready && rest.exitCode === null; i++) {
      try { ready = (await fetch(`http://127.0.0.1:${REST_PORT}/categories?select=id&limit=1`)).status === 200; } catch {}
      if (!ready) await sleep(500);
    }
    if (!ready) { try { rest.kill(); } catch {} await sleep(1500); }
  }
  if (!ready) throw new Error("PostgREST did not start");
  console.log("PostgREST 14.18 ready");
  const as = (uid) => new PostgrestClient(`http://127.0.0.1:${REST_PORT}`, { headers: { Authorization: `Bearer ${uid ? jwt({ sub: uid, role: "authenticated" }) : jwt({ role: "anon" })}` } });

  // ---- mirrored route calls ----
  const UNSUPPORTED = new Set(["42P01", "PGRST202", "PGRST205"]);
  async function unread(uid) {           // /api/messages/unread
    const { data, error } = await as(uid).rpc("cb_unread_counts");
    if (error) return UNSUPPORTED.has(error.code) ? { supported: false } : { error: error.code };
    const byThread = Object.fromEntries((data ?? []).map((r) => [r.thread_id, r.unread]));
    return { supported: true, total: totalUnread(byThread), byThread };
  }
  async function markRead(uid, upTo) {   // /api/messages/read
    const { error } = await as(uid).rpc("cb_mark_thread_read", { p_thread: thread, p_upto: upTo });
    return error ? { status: error.code === "42501" ? 404 : UNSUPPORTED.has(error.code) ? 200 : 500, code: error.code } : { status: 200 };
  }
  async function getMessages(uid, after) { // /api/messages GET
    const db = as(uid);
    const { data: th } = await db.from("message_threads").select("id").eq("id", thread).maybeSingle();
    if (!th) return { status: 404 };
    let q = db.from("messages").select("id, sender_id, body, created_at").eq("thread_id", thread);
    if (after) q = q.gte("created_at", after);
    const { data, error } = await q.order("created_at", { ascending: true }).order("id", { ascending: true });
    return error ? { status: 500, code: error.code } : { status: 200, messages: data };
  }
  async function send(uid, body) {        // /api/messages/reply -> sendMessageOnce
    const { data, error } = await as(uid).from("messages")
      .upsert({ thread_id: thread, sender_id: uid, body, client_id: crypto.randomUUID() }, { onConflict: "thread_id,sender_id,client_id", ignoreDuplicates: true })
      .select("id, sender_id, body, created_at");
    if (error) throw new Error(`send failed ${error.code} ${error.message}`);
    return data[0];
  }

  // ---- a browser tab: ThreadView's poller + markRead, with the shipped modules ----
  function openThread(viewer, name) {
    const tab = { viewer, name, messages: [], marked: null, marking: false, hidden: false, requests: [], markCalls: [], inFlight: 0, maxInFlight: 0 };
    tab.markRead = async () => {
      if (tab.hidden || tab.marking) return;
      let newest = null;
      for (const m of tab.messages) if (m.sender_id !== viewer && (!newest || advanceMarker(newest, m.created_at) !== newest)) newest = m.created_at;
      if (!newest || advanceMarker(tab.marked, newest) === tab.marked) return;
      tab.marking = true;
      try { const r = await markRead(viewer, newest); tab.markCalls.push({ upTo: newest, status: r.status }); if (r.status === 200) tab.marked = advanceMarker(tab.marked, newest); }
      finally { tab.marking = false; }
    };
    tab.poller = createPoller({
      run: async () => {
        tab.inFlight++; tab.maxInFlight = Math.max(tab.maxInFlight, tab.inFlight);
        try {
          const newest = tab.messages.length ? tab.messages[tab.messages.length - 1].created_at : null;
          tab.requests.push({ at: Date.now(), after: newest });
          const r = await getMessages(viewer, newest);
          if (r.status === 404 || r.status === 401) return { kind: "stop" };
          if (r.status !== 200) return { kind: "retry" };
          const known = new Set(tab.messages.map((m) => m.id));
          const added = r.messages.filter((m) => !known.has(m.id)).length;
          tab.messages = mergeMessages(tab.messages, r.messages);
          void tab.markRead();
          return { kind: "ok", added };
        } finally { tab.inFlight--; }
      },
      isHidden: () => tab.hidden, now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h), random: Math.random,
      cfg: { baseMs: 1000, idleMs: 3000, idleAfterMs: 120000, maxMs: 8000, jitter: 0.15 }, // shortened intervals (floor 1 s) so the run takes seconds
    });
    tab.poller.start(); tab.poller.poke();
    return tab;
  }
  const waitFor = async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return Date.now() - t0; await sleep(100); } return -1; };
  const ids = (list) => list.map((m) => m.id);
  const unique = (list) => new Set(ids(list)).size === list.length;

  // 3. Backfill: history from before stage 11 counts as read for both accounts.
  let ua = await unread(A), ub = await unread(B);
  check("3 backfill: pre-existing history is read for both accounts (A 0, B 0)", ua.supported && ub.supported && ua.total === 0 && ub.total === 0, { ua, ub });
  check("3 badge hidden at 0: label 'Messages'", badgeText(ub.total) === null && messagesAriaLabel(ub.total) === "Messages");

  // 4. A sends two messages while B is not looking: B's badge shows 2, A's own messages don't count for A.
  const m1 = await send(A, "Could I come Friday instead?");
  const m2 = await send(A, "Around 5 pm.");
  ub = await unread(B); ua = await unread(A);
  check("4 B unread = 2 after two messages from A; badge '2', label 'Messages, 2 unread'", ub.total === 2 && ub.byThread[thread] === 2 && badgeText(ub.total) === "2" && messagesAriaLabel(ub.total) === "Messages, 2 unread", ub);
  check("4 A's own messages never count for A (A unread 0)", ua.total === 0, ua);

  // 5. B opens the thread: first load has no cursor, sees everything, marks read -> B badge clears.
  const tabB = openThread(B, "B");
  const tLoad = await waitFor(async () => tabB.messages.length === 4 && tabB.markCalls.length >= 1);
  check("5 B's first request has no `after` and loads the whole thread (4 messages)", tabB.requests[0]?.after === null && tabB.messages.length === 4, { first: tabB.requests[0], n: tabB.messages.length, ms: tLoad });
  check("5 B marks read up to A's newest message (exact created_at string)", tabB.markCalls[0]?.upTo === m2.created_at && tabB.markCalls[0]?.status === 200, tabB.markCalls[0]);
  ub = await unread(B);
  check("5 B unread clears to 0 after opening the thread", ub.total === 0, ub);

  // 6. Auto-refresh: A opens too; A sends while B's tab is open -> appears in B's tab without reload, once.
  const tabA = openThread(A, "A");
  await waitFor(async () => tabA.messages.length === 4);
  const m3 = await send(A, "Great, see you then.");
  const tSeen = await waitFor(async () => tabB.messages.some((m) => m.id === m3.id));
  check("6 A's new message appears in B's open thread by polling (no reload)", tSeen >= 0 && tSeen < 3000, { ms: tSeen });
  const cursorReq = tabB.requests.find((r) => r.after !== null);
  check("6 later polls send `after` = newest created_at, unmodified", cursorReq && tabB.requests.filter((r) => r.after).every((r) => typeof r.after === "string" && /\d{2}:\d{2}:\d{2}\.\d+[+-]\d{2}:\d{2}$/.test(r.after) && tabB.messages.some((m) => m.created_at === r.after)), cursorReq);
  check("6 no duplicates in B's thread (inclusive cursor + merge)", unique(tabB.messages) && tabB.messages.length === 5, { n: tabB.messages.length });
  await waitFor(async () => (await unread(B)).total === 0);
  ub = await unread(B);
  check("6 B's unread returns to 0 because the open tab marked the new message read", ub.total === 0 && tabB.markCalls.at(-1)?.upTo === m3.created_at, { ub, last: tabB.markCalls.at(-1) });

  // 7. B replies: A sees it, A's unread clears; B's own reply never counts for B.
  const r1 = await send(B, "Friday works. Bring cash.");
  const tA = await waitFor(async () => tabA.messages.some((m) => m.id === r1.id));
  check("7 B's reply appears in A's open thread", tA >= 0, { ms: tA });
  await waitFor(async () => (await unread(A)).total === 0);
  ua = await unread(A); ub = await unread(B);
  check("7 A's unread clears after A's tab shows the reply; B's own reply never counts for B", ua.total === 0 && ub.total === 0, { ua, ub });

  // 8. Hidden tab: no requests and no mark-read; unread stays until visible again.
  tabB.hidden = true;
  await sleep(1500);
  const reqsHidden = tabB.requests.length, marksHidden = tabB.markCalls.length;
  const m4 = await send(A, "One more question about the lamp.");
  await sleep(4000);
  ub = await unread(B);
  check("8 hidden tab makes no requests and no mark-read while hidden", tabB.requests.length === reqsHidden && tabB.markCalls.length === marksHidden, { reqs: tabB.requests.length - reqsHidden });
  check("8 B shows 1 unread while the tab is hidden", ub.total === 1, ub);
  tabB.hidden = false; tabB.poller.poke();
  const tBack = await waitFor(async () => (await unread(B)).total === 0 && tabB.messages.some((m) => m.id === m4.id));
  check("8 on return: one request, the message appears, unread clears", tBack >= 0, { ms: tBack });

  // 9. Same-timestamp messages: two messages from A that share created_at with B's current newest.
  //    Written as the owner with explicit timestamps (simulating two commits in the same instant).
  const newestB = tabB.messages.at(-1).created_at;
  await owner.query("insert into public.messages (thread_id, sender_id, body, client_id, created_at) values ($1,$2,'tie one',gen_random_uuid(),$3),($1,$2,'tie two',gen_random_uuid(),$3)", [thread, A, newestB]);
  await waitFor(async () => tabB.messages.filter((m) => m.body.startsWith("tie ")).length === 2, 4000);
  check("9 same-timestamp messages are both shown exactly once", tabB.messages.filter((m) => m.body.startsWith("tie ")).length === 2 && unique(tabB.messages), { n: tabB.messages.length });

  // 10. Same-millisecond, later-microsecond message after a mark (precision of the client marker).
  // A message from A whose created_at is in the SAME millisecond as B's marker but later in microseconds.
  // Everything is computed in SQL (JavaScript Dates would drop the microseconds).
  await waitFor(async () => (await unread(B)).total === 0, 3000);
  const setup = (await owner.query(
    `with mk as (select last_read_at t from public.message_thread_reads where thread_id = $1 and user_id = $3)
     insert into public.messages (thread_id, sender_id, body, client_id, created_at)
     select $1, $2, 'same millisecond', gen_random_uuid(), date_trunc('milliseconds', t) + interval '999 microseconds' from mk
     where extract(microseconds from t)::bigint % 1000 < 999
     returning to_char(created_at at time zone 'UTC', 'HH24:MI:SS.US') c,
               (select to_char(t at time zone 'UTC', 'HH24:MI:SS.US') from mk) m`,
    [thread, A, B])).rows[0];
  const marked = setup?.m, laterUs = setup?.c;
  check("10 setup: new message is later than B's marker by microseconds within the same millisecond", Boolean(setup) && laterUs > marked && laterUs.slice(0, 12) === marked.slice(0, 12), { marked, laterUs });
  await waitFor(async () => tabB.messages.some((m) => m.body === "same millisecond"), 4000);
  const tClear = await waitFor(async () => (await unread(B)).total === 0, 4000);
  check("10 a message later by microseconds but in the same millisecond as the last mark is still marked read", tClear >= 0, { marked, laterUs, unread: await unread(B) });

  // 11. Third user and anonymous: nothing visible, nothing writable.
  const c = await getMessages(C, null);
  const cm = await markRead(C, new Date().toISOString());
  const cu = await unread(C);
  check("11 third user: thread not visible (404), mark-read refused (404 from 42501), no unread rows", c.status === 404 && cm.status === 404 && cm.code === "42501" && cu.total === 0 && !(thread in cu.byThread), { c: c.status, cm, cu });
  const an = await as(null).rpc("cb_unread_counts");
  check("11 anonymous: unread function not executable", Boolean(an.error), an.error?.code);
  const directLower = await as(B).from("message_thread_reads").update({ last_read_at: "2000-01-01T00:00:00Z" }).eq("thread_id", thread).eq("user_id", A).select();
  check("11 B cannot change A's read marker directly", !directLower.error && (directLower.data ?? []).length === 0, directLower.error?.code ?? directLower.data?.length);

  // 12. Marker rules through the RPC: an earlier time does not lower it; a future time is clamped.
  const m5 = await send(A, "last one");
  await waitFor(async () => (await unread(B)).total === 0);
  await markRead(B, "2000-01-01T00:00:00Z");
  check("12 an earlier upTo never lowers the marker (B still 0 unread)", (await unread(B)).total === 0);
  await markRead(B, "2999-01-01T00:00:00Z");
  const stored = (await owner.query("select last_read_at <= now() ok from public.message_thread_reads where thread_id = $1 and user_id = $2", [thread, B])).rows[0];
  check("12 a future upTo is clamped to server time", stored.ok === true, stored);
  void m1; void m5;

  // 13. No overlapping requests from either tab.
  check("13 at most one request in flight per tab", tabA.maxInFlight === 1 && tabB.maxInFlight === 1, { A: tabA.maxInFlight, B: tabB.maxInFlight });
  tabA.poller.stop(); tabB.poller.stop();

  // 14. Rollback: unread reports unsupported (the app hides the badge); messages untouched.
  const msgsBefore = (await owner.query("select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) h, count(*)::int n from public.messages m")).rows[0];
  await sqlFile(owner, "stage11_message_reads_rollback.sql");
  await owner.query("notify pgrst, 'reload schema'");
  let un; for (let i = 0; i < 20; i++) { un = await unread(B); if (un.supported === false) break; await sleep(500); }
  const mr = await markRead(B, new Date().toISOString());
  const msgsAfter = (await owner.query("select md5(coalesce(string_agg(m::text, '|' order by m.id), '')) h, count(*)::int n from public.messages m")).rows[0];
  check("14 after rollback the unread endpoint answers {supported:false} (badge hidden) and read answers 200", un.supported === false && mr.status === 200, { un, mr });
  check("14 rollback leaves every message unchanged", msgsBefore.h === msgsAfter.h, { n: msgsAfter.n });
  await owner.end();
} catch (e) {
  check("harness", false, e.stack ?? String(e));
} finally {
  try { rest?.kill(); } catch {}
  try { await embedded.stop(); } catch {}
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
