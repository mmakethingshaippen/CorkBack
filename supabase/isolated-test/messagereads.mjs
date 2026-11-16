// Isolated test for the stage 11 message reads drafts (Requirement 19, task 12.2; design Property 24).
// Throwaway embedded PostgreSQL only: never point this at production.
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\messagereads.mjs
// Prerequisite schema = the production files: bootstrap.sql roles, then schema.sql (profiles, postings),
// stage3_messaging.sql and stage6_social_part4.sql (message_threads, messages, their grants and policies).
// The TypeScript model src/lib/unread.ts runs as-is: sucrase transpiles it in memory (same approach as takedown.mjs).
// Set CB_SQL_DIR to a scratch copy of supabase/ to test a variant.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const iso = process.env.CB_ISO_DIR;
if (!iso) throw new Error("Set CB_ISO_DIR (see README.md)");
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..");
const sqlDir = process.env.CB_SQL_DIR ?? path.join(here, "..");
const { Client } = createRequire(path.join(iso, "package.json"))("pg");
const { transform } = createRequire(path.join(repo, "package.json"))("sucrase");
const bin = path.join(iso, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cb-msgreads-"));
const port = 55600 + Math.floor(Math.random() * 90);

// ---- app side: unread.ts evaluated in memory ----
const mod = { exports: {} };
new Function("module", "exports", "require", transform(fs.readFileSync(path.join(repo, "src", "lib", "unread.ts"), "utf8"),
  { transforms: ["typescript", "imports"] }).code)(mod, mod.exports, (id) => { throw new Error(`unexpected import ${id}`); });
const { unreadCount, advanceMarker } = mod.exports;

execFileSync(path.join(bin, "initdb.exe"), ["-D", data, "-U", "supabase_admin", "-E", "UTF8", "--auth=trust", "--locale=C"], { stdio: "ignore" });
const server = spawn(path.join(bin, "postgres.exe"), ["-D", data, "-p", String(port)], { stdio: "ignore" });

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`PASS ${name}`); };
const bad = (name, why) => { fail++; console.log(`FAIL ${name}: ${why}`); };
const check = (name, cond, why = "") => (cond ? ok(name) : bad(name, why));
async function connect(user) {
  for (let i = 0; i < 50; i++) {
    const c = new Client({ port, user, database: "postgres", password: user === "postgres" ? "iso-owner-pw" : undefined });
    try { await c.connect(); return c; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("database did not start");
}
const read = (f) => fs.readFileSync(path.join(sqlDir, f), "utf8");
const F = {
  pre: "stage11_message_reads_preflight.sql", mig: "stage11_message_reads.sql",
  ver: "stage11_message_reads_verify_roles.sql", rb: "stage11_message_reads_rollback.sql",
};
const iso8601 = (ms) => new Date(ms).toISOString();

try {
  const admin = await connect("supabase_admin");
  await admin.query(fs.readFileSync(path.join(here, "bootstrap.sql"), "utf8"));
  await admin.end();
  const db = await connect("postgres");

  // Run SQL; on error roll back the aborted transaction and return the error.
  async function run(sql) {
    try { const res = await db.query(sql); return { res: Array.isArray(res) ? res : [res] }; }
    catch (e) { await db.query("rollback").catch(() => {}); return { err: e }; }
  }
  const rowsOf = (r) => (r.res ?? []).flatMap((x) => x.rows ?? []);
  const expectOk = async (name, sql) => { const r = await run(sql); r.err ? bad(name, `${r.err.code} ${r.err.message}`) : ok(name); return r; };

  // Run one statement as a role/user inside the CURRENT transaction (savepoint, so an error does not abort it).
  async function callAs(uid, role, sql, params = []) {
    await db.query("savepoint cb_s");
    try {
      await db.query("select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)",
        [uid ?? "", JSON.stringify(uid ? { sub: uid, role } : { role })]);
      await db.query(`set local role ${role}`);
      const r = await db.query(sql, params);
      await db.query("reset role");
      await db.query("release savepoint cb_s");
      return { rows: r.rows };
    } catch (e) {
      await db.query("rollback to savepoint cb_s");
      await db.query("reset role");
      return { err: e };
    }
  }
  const inTx = async (fn) => { await db.query("begin"); try { return await fn(); } finally { await db.query("rollback"); } };

  // ---- prerequisite schema: the production files, in production order ----
  for (const f of ["schema.sql", "stage3_messaging.sql", "stage6_social_part4.sql"]) {
    const r = await run(read(f)); r.err ? bad(`prerequisite ${f}`, `${r.err.code} ${r.err.message}`) : ok(`prerequisite ${f} applies`);
  }

  // ---- seed: existing users, threads and messages BEFORE the migration ----
  const ids = Array.from({ length: 4 }, () => randomUUID()).sort();
  const [U1, U2, U3, U4] = ids;
  const X = randomUUID(); // a fifth user who is in no thread
  for (const [i, id] of [...ids, X].entries()) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
    await db.query("insert into public.profiles (id, username) values ($1, $2)", [id, `iso_user_${i}`]);
  }
  const mkThread = async (lo, hi) => (await db.query("insert into public.message_threads (user_lo, user_hi) values ($1, $2) returning id", [lo, hi])).rows[0].id;
  const mkMsg = (th, sender, minsAgo) => db.query(
    "insert into public.messages (thread_id, sender_id, body, created_at) values ($1, $2, 'seed', now() - ($3 || ' minutes')::interval)", [th, sender, String(minsAgo)]);
  const T1 = await mkThread(U1, U2), T2 = await mkThread(U1, U3), T3 = await mkThread(U2, U4);
  await mkMsg(T1, U1, 50); await mkMsg(T1, U2, 40); await mkMsg(T1, U2, 30);
  await mkMsg(T2, U3, 20); await mkMsg(T2, U3, 10);
  // T3 has no message.
  const hashSql = `select md5(coalesce((select string_agg(m::text, '|' order by m.id) from public.messages m), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from public.message_threads t), '')) as h`;
  const msgHash = async () => (await db.query(hashSql)).rows[0].h;
  const readsHash = async () => (await db.query(`select md5(coalesce(string_agg(r::text, '|' order by r.thread_id, r.user_id), '')) as h from public.message_thread_reads r`)).rows[0].h;
  const hashBefore = await msgHash();

  // ---- preflight (read-only) on the unmigrated database ----
  const pre = await run(read(F.pre));
  if (pre.err) bad("preflight runs", `${pre.err.code} ${pre.err.message}`);
  else {
    const rows = rowsOf(pre).filter((r) => r.section);
    const dep = rows.filter((r) => r.section === "dependency");
    check("preflight: every dependency is true", dep.length >= 11 && dep.every((r) => r.detail === "true"), JSON.stringify(dep.filter((r) => r.detail !== "true")));
    check("preflight: message_thread_reads does not exist yet", rows.find((r) => r.item === "message_thread_reads exists")?.detail === "false");
    check("preflight: backfill rows to insert = 2 x threads (6)", rows.find((r) => r.item.startsWith("rows to insert"))?.detail === "6");
    check("preflight changed nothing", (await msgHash()) === hashBefore && (await db.query("select to_regclass('public.message_thread_reads') as t")).rows[0].t === null);
  }

  // ---- rollback on an unmigrated database ----
  await expectOk("rollback on an unmigrated database runs without error", read(F.rb));
  check("rollback on an unmigrated database leaves messages and threads unchanged", (await msgHash()) === hashBefore);

  // ---- migration ----
  await expectOk("migration applies", read(F.mig));
  check("migration leaves messages and threads unchanged", (await msgHash()) === hashBefore);
  const readsAfter1 = await readsHash();
  const nMarkers = (await db.query("select count(*)::int as n from public.message_thread_reads")).rows[0].n;
  check("backfill wrote one marker per participant (6)", nMarkers === 6, String(nMarkers));
  await expectOk("migration runs a second time", read(F.mig));
  check("second migration run leaves the same rows", (await readsHash()) === readsAfter1);
  check("second migration run leaves messages and threads unchanged", (await msgHash()) === hashBefore);

  // ---- backfill: existing threads at zero unread ----
  async function backfillIsZero() {
    return inTx(async () => {
      const seen = {};
      for (const u of [U1, U2, U3, U4]) {
        const r = await callAs(u, "authenticated", "select thread_id, unread from public.cb_unread_counts()");
        if (r.err) return `error for ${u}: ${r.err.message}`;
        seen[u] = Object.fromEntries(r.rows.map((x) => [x.thread_id, x.unread]));
      }
      const exp = { [U1]: [T1, T2], [U2]: [T1, T3], [U3]: [T2], [U4]: [T3] };
      for (const u of [U1, U2, U3, U4]) {
        const got = seen[u];
        if (Object.keys(got).length !== exp[u].length || !exp[u].every((t) => got[t] === 0)) return `unread for ${u}: ${JSON.stringify(got)}`;
      }
      return null;
    });
  }
  const bf = await backfillIsZero();
  check("backfill: every pre-existing thread has 0 unread for both participants (T3, with no message, returns a 0 row)", bf === null, String(bf));
  const mk = (await db.query(`select (r.last_read_at = coalesce((select max(m.created_at) from public.messages m where m.thread_id = r.thread_id), t.created_at)) as eq
    from public.message_thread_reads r join public.message_threads t on t.id = r.thread_id`)).rows;
  check("backfill markers = latest message time (either sender) or thread created_at", mk.length === 6 && mk.every((r) => r.eq));

  // ---- verify_roles ----
  async function verifyRoles() {
    const r = await run(read(F.ver));
    if (r.err) return { err: r.err };
    const rows = rowsOf(r).filter((x) => x.check_name);
    return { rows, all: rows.find((x) => x.check_name === "ALL CHECKS PASS")?.pass === true, failed: rows.filter((x) => x.pass !== true).map((x) => `${x.check_name} [accept ${x.accept}; actual ${x.actual}]`) };
  }
  const v = await verifyRoles();
  v.err ? bad("verify_roles runs", `${v.err.code} ${v.err.message}`) : check(`verify_roles: ALL CHECKS PASS (${v.rows.length - 1} checks)`, v.all, v.failed.join("; "));
  check("verify_roles left no data behind", (await msgHash()) === hashBefore && (await readsHash()) === readsAfter1
    && (await db.query("select count(*)::int as n from auth.users")).rows[0].n === 5);

  // ---- grants and RLS ----
  const priv = (await db.query(`select
    has_any_column_privilege('anon','public.message_thread_reads','select,insert,update,references') as anon_col,
    has_table_privilege('anon','public.message_thread_reads','select,insert,update,delete,truncate,references,trigger') as anon_tab,
    has_table_privilege('authenticated','public.message_thread_reads','select') as auth_sel,
    has_table_privilege('authenticated','public.message_thread_reads','insert,update,delete,truncate') as auth_wide,
    has_column_privilege('authenticated','public.message_thread_reads','last_read_at','update') as upd_marker,
    has_column_privilege('authenticated','public.message_thread_reads','user_id','update') as upd_user,
    has_column_privilege('authenticated','public.message_thread_reads','thread_id','update') as upd_thread,
    has_column_privilege('authenticated','public.message_thread_reads','user_id','insert') as ins_user,
    has_function_privilege('anon','public.cb_mark_thread_read(uuid,timestamptz)','execute') as anon_mark,
    has_function_privilege('anon','public.cb_unread_counts()','execute') as anon_cnt,
    has_function_privilege('authenticated','public.cb_mark_thread_read(uuid,timestamptz)','execute') as auth_mark,
    has_function_privilege('authenticated','public.cb_unread_counts()','execute') as auth_cnt,
    (select relrowsecurity from pg_class where oid = 'public.message_thread_reads'::regclass) as rls,
    (select count(*)::int from pg_policies where tablename = 'message_thread_reads') as pols,
    (select count(*)::int from pg_proc where proname in ('cb_mark_thread_read','cb_unread_counts') and prosecdef and proconfig @> array['search_path=""']) as secdef,
    has_table_privilege('authenticated','public.messages','update,delete') as msg_wr,
    has_table_privilege('authenticated','public.message_threads','update,delete') as thr_wr`)).rows[0];
  check("grants: anon has no privilege on message_thread_reads", !priv.anon_col && !priv.anon_tab);
  check("grants: authenticated has select, column-limited insert and update, no delete/truncate/table-wide write",
    priv.auth_sel && !priv.auth_wide && priv.upd_marker && !priv.upd_user && !priv.upd_thread && priv.ins_user);
  check("grants: anon cannot execute either function; authenticated can", !priv.anon_mark && !priv.anon_cnt && priv.auth_mark && priv.auth_cnt);
  check("RLS is on with three policies; both functions are security definer with an empty search_path", priv.rls && priv.pols === 3 && priv.secdef === 2);
  check("messages and message_threads keep no client update/delete", !priv.msg_wr && !priv.thr_wr);

  await inTx(async () => {
    const A = U1, B = U2, th = T1;
    // anon
    for (const [name, sql, p] of [
      ["anon: select on message_thread_reads is refused", "select count(*) from public.message_thread_reads", []],
      ["anon: cb_unread_counts is refused", "select * from public.cb_unread_counts()", []],
      ["anon: cb_mark_thread_read is refused", "select public.cb_mark_thread_read($1, now())", [th]],
    ]) { const r = await callAs(null, "anon", sql, p); check(name, r.err?.code === "42501", r.err ? r.err.code : "no error"); }
    // signed-in caller with no uid
    const nouid = await callAs(null, "authenticated", "select public.cb_mark_thread_read($1, now())", [th]);
    check("authenticated with no user id: cb_mark_thread_read raises 42501", nouid.err?.code === "42501", nouid.err?.code ?? "no error");
    // third users
    const c3 = await callAs(U3, "authenticated", "select public.cb_mark_thread_read($1, now())", [th]);
    check("non-participant (U3) cb_mark_thread_read on T1 raises 42501", c3.err?.code === "42501", c3.err?.code ?? "no error");
    const cx = await callAs(X, "authenticated", "select public.cb_mark_thread_read($1, now())", [th]);
    check("user in no thread: cb_mark_thread_read raises 42501", cx.err?.code === "42501", cx.err?.code ?? "no error");
    const w = (await db.query("select count(*)::int as n from public.message_thread_reads where thread_id = $1 and user_id not in ($2, $3)", [th, U1, U2])).rows[0].n;
    check("refused mark stored no marker for the outsider", w === 0, String(w));
    const cu = await callAs(X, "authenticated", "select * from public.cb_unread_counts()");
    check("a user in no thread gets no unread rows", !cu.err && cu.rows.length === 0, JSON.stringify(cu.rows ?? cu.err?.message));
    const cu3 = await callAs(U3, "authenticated", "select thread_id from public.cb_unread_counts()");
    check("U3 sees only own thread (T2), not T1 or T3", !cu3.err && cu3.rows.length === 1 && cu3.rows[0].thread_id === T2);
    const rd3 = await callAs(U3, "authenticated", "select count(*)::int as n from public.message_thread_reads where thread_id = $1", [th]);
    check("third user reads none of T1's markers directly", !rd3.err && rd3.rows[0].n === 0);
    const rdA = await callAs(A, "authenticated", "select user_id from public.message_thread_reads where thread_id = $1", [th]);
    check("participant reads only their own marker", !rdA.err && rdA.rows.length === 1 && rdA.rows[0].user_id === A);
    const ins = await callAs(A, "authenticated", "insert into public.message_thread_reads (thread_id, user_id, last_read_at) values ($1, $2, now())", [T3, A]);
    check("direct insert for a thread the caller is not in is refused (RLS)", ins.err?.code === "42501", ins.err?.code ?? "no error");
    const fut = await callAs(A, "authenticated", "update public.message_thread_reads set last_read_at = now() + interval '1 day' where thread_id = $1", [th]);
    check("direct update to a future marker is refused (RLS)", fut.err?.code === "42501", fut.err?.code ?? "no error");

    // earlier timestamp leaves the marker; later moves it; future stores server time
    const get = async (u) => (await db.query("select last_read_at, now() as n from public.message_thread_reads where thread_id = $1 and user_id = $2", [th, u])).rows[0];
    const before = (await get(A)).last_read_at;
    const e = await callAs(A, "authenticated", "select public.cb_mark_thread_read($1, $2)", [th, new Date(before.getTime() - 3600_000).toISOString()]);
    const afterE = (await get(A)).last_read_at;
    check("earlier timestamp: no error and the marker is unchanged", !e.err && afterE.getTime() === before.getTime(), e.err?.message ?? "");
    const f = await callAs(A, "authenticated", "select public.cb_mark_thread_read($1, now() + interval '1 day')", [th]);
    const g = await get(A);
    check("future timestamp: stored as server time, not the future", !f.err && g.last_read_at.getTime() === g.n.getTime(), f.err?.message ?? `${g.last_read_at.toISOString()} vs ${g.n.toISOString()}`);
    const cnt = await callAs(A, "authenticated", "select unread from public.cb_unread_counts() where thread_id = $1", [th]);
    check("after a future-timestamp mark the thread reads 0 unread", cnt.rows?.[0]?.unread === 0);
    const bB = await callAs(B, "authenticated", "select unread from public.cb_unread_counts() where thread_id = $1", [th]);
    check("A's marker does not change B's unread (B keeps its own marker)", bB.rows?.[0]?.unread === 0);
    const nul = await callAs(A, "authenticated", "select public.cb_mark_thread_read(null, now())");
    check("null thread is refused (22023)", nul.err?.code === "22023", nul.err?.code ?? "no error");
  });

  // ---- Property 24: unread SQL matches the model (D) ----
  const POOL = [U1, U2, U3, U4]; // sorted ascending: index order = uuid order
  const BASE = Date.UTC(2020, 0, 1);
  const RUNS = Number(process.env.CB_RUNS ?? 60);
  function rng(seed) { let a = seed; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  async function runProperty(seed0, runs) {
    let failures = 0, first = null;
    const note = (msg) => { failures++; first ??= msg; };
    for (let run = 0; run < runs; run++) {
      const rnd = rng(seed0 + run);
      const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
      await db.query("begin");
      try {
        const nowMs = Number((await db.query("select floor(extract(epoch from now()) * 1000)::bigint as ms")).rows[0].ms);
        const threads = [];
        for (let i = 0, n = int(1, 4); i < n; i++) {
          const a = int(0, 2), b = int(a + 1, 3);
          const id = (await db.query("insert into public.message_threads (user_lo, user_hi) values ($1, $2) returning id", [POOL[a], POOL[b]])).rows[0].id;
          const msgs = [];
          for (let j = 0, m = int(0, 8); j < m; j++) {
            const sender = rnd() < 0.5 ? POOL[a] : POOL[b], ms = BASE + int(0, 9) * 1000;
            await db.query("insert into public.messages (thread_id, sender_id, body, created_at) values ($1, $2, 'x', $3)", [id, sender, iso8601(ms)]);
            msgs.push({ sender_id: sender, created_at: iso8601(ms) });
          }
          threads.push({ id, users: [POOL[a], POOL[b]], msgs, marker: new Map() });
        }
        // random mark calls: grid times from before the first message to after the last, plus the future
        for (const th of threads) {
          const callers = [...th.users, ...POOL.filter((u) => !th.users.includes(u) && rnd() < 0.5)];
          for (const u of callers) {
            const ops = [];
            for (let k = 0, n = int(0, 3); k < n; k++) ops.push(rnd() < 0.15 ? "future" : BASE + int(-1, 10) * 1000);
            let model = null;
            for (const op of ops) {
              const upto = op === "future" ? nowMs + 86400000 : op;
              const r = await callAs(u, "authenticated", "select public.cb_mark_thread_read($1, $2)", [th.id, iso8601(upto)]);
              if (th.users.includes(u)) {
                if (r.err) note(`run ${run}: participant mark failed ${r.err.message}`);
                model = advanceMarker(model, iso8601(Math.min(upto, nowMs)));
              } else if (r.err?.code !== "42501") note(`run ${run}: non-participant mark was not refused (${r.err?.code ?? "no error"})`);
            }
            if (th.users.includes(u)) th.marker.set(u, model);
          }
        }
        // stored markers vs the model, and no markers for outsiders
        const stored = (await db.query("select thread_id, user_id, floor(extract(epoch from last_read_at) * 1000)::bigint as ms from public.message_thread_reads where thread_id = any($1)", [threads.map((t) => t.id)])).rows;
        for (const th of threads) {
          for (const u of POOL) {
            const row = stored.find((s) => s.thread_id === th.id && s.user_id === u);
            const want = th.marker.get(u) ?? null;
            if (!th.users.includes(u)) { if (row) note(`run ${run}: outsider has a marker`); continue; }
            if (want === null ? row : !row || Number(row.ms) !== Date.parse(want)) note(`run ${run}: marker ${row?.ms} != model ${want && Date.parse(want)}`);
          }
        }
        // unread counts vs the model, for every user (participants and outsiders)
        const worldIds = new Set(threads.map((t) => t.id));
        for (const u of POOL) {
          const r = await callAs(u, "authenticated", "select thread_id, unread from public.cb_unread_counts()");
          if (r.err) { note(`run ${run}: cb_unread_counts failed ${r.err.message}`); continue; }
          const got = Object.fromEntries(r.rows.filter((x) => worldIds.has(x.thread_id)).map((x) => [x.thread_id, x.unread]));
          const want = Object.fromEntries(threads.filter((t) => t.users.includes(u)).map((t) => [t.id, unreadCount(t.msgs, u, t.marker.get(u) ?? null)]));
          if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(want).sort())) note(`run ${run}: user ${POOL.indexOf(u)} got ${JSON.stringify(Object.values(got))} want ${JSON.stringify(Object.values(want))}`);
        }
        const anon = await callAs(null, "anon", "select * from public.cb_unread_counts()");
        if (anon.err?.code !== "42501") note(`run ${run}: anon was not refused`);
      } catch (e) { note(`run ${run}: harness error ${e.message}`); }
      finally { await db.query("rollback"); }
    }
    return { failures, first };
  }
  const seed = Number(process.env.CB_SEED ?? 24024);
  const prop = await runProperty(seed, RUNS);
  check(`Property 24: cb_unread_counts / cb_mark_thread_read match the model for ${RUNS} random worlds (seed ${seed})`, prop.failures === 0, `${prop.failures} failures, first: ${prop.first}`);

  // ---- rollback after migration, then re-apply ----
  const hashMid = await msgHash();
  await expectOk("rollback applies after the migration", read(F.rb));
  const gone = (await db.query(`select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname = 'message_thread_reads')::int as t,
    (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('cb_mark_thread_read','cb_unread_counts'))::int as f,
    (select count(*) from pg_policies where tablename = 'message_thread_reads')::int as p`)).rows[0];
  check("rollback removed the table, both functions and the policies", gone.t === 0 && gone.f === 0 && gone.p === 0, JSON.stringify(gone));
  check("rollback left messages and threads unchanged", (await msgHash()) === hashMid && hashMid === hashBefore);
  await expectOk("rollback runs again (nothing to drop)", read(F.rb));

  // ---- mutation checks: each broken variant must be caught ----
  const migSrc = read(F.mig);
  const mutants = [
    ["counts the caller's own messages", "and m.sender_id <> auth.uid()", "and true", "prop"],
    ["counts a message sent exactly at the marker (>= instead of >)", "m.created_at > coalesce", "m.created_at >= coalesce", "prop"],
    ["lets the marker move backwards", "where r.last_read_at < excluded.last_read_at", "", "prop"],
    ["does not cap the marker at the server clock", "least(p_upto, now())", "p_upto", "prop"],
    ["lets a third user read another thread's counts", "and auth.uid() in (t.user_lo, t.user_hi)", "and true", "prop"],
    ["lets a non-participant mark a thread read", "t.id = p_thread and v_uid in (t.user_lo, t.user_hi)", "t.id = p_thread", "prop"],
  ];
  for (const [name, from, to, kind] of mutants) {
    if (!migSrc.includes(from)) { bad(`mutant "${name}"`, "pattern not found in the migration (test needs updating)"); continue; }
    await expectOk(`mutant applies: ${name}`, migSrc.replace(from, to));
    const p = await runProperty(seed, 30);
    check(`mutation caught by Property 24: ${name}`, p.failures > 0, "the property still passed with the mutant");
    const mv = await verifyRoles();
    console.log(`INFO verify_roles ${mv.err || !mv.all ? "also catches" : "does not catch"}: ${name}`);
  }
  // Backfill mutant: marks nothing read. Needs an unmigrated database with the seeded threads.
  {
    const from = "coalesce((select max(m.created_at) from public.messages m where m.thread_id = t.id), t.created_at)";
    if (!migSrc.includes(from)) bad("backfill mutant", "pattern not found");
    else {
      await run(read(F.rb));
      await expectOk("mutant applies: backfill leaves old messages unread", migSrc.replace(from, "'-infinity'::timestamptz"));
      const z = await backfillIsZero();
      check("mutation caught by the backfill check: backfill leaves old messages unread", z !== null);
      await run(read(F.rb));
      // fresh variant: no backfill rows at all
      const cut = migSrc.replace("on conflict (thread_id, user_id) do nothing;\n\n-- 7.", "on conflict (thread_id, user_id) do nothing;\ndelete from public.message_thread_reads;\n\n-- 7.");
      if (cut === migSrc) bad("backfill mutant (no markers)", "pattern not found");
      else {
        const r = await run(cut);
        check("mutation caught: the migration's own assertion refuses a backfill that wrote no markers", !!r.err && /no marker after the backfill/.test(r.err.message), r.err?.message ?? "applied");
      }
    }
  }

  // ---- restore the real migration and re-run everything once ----
  await run(read(F.rb));
  await expectOk("real migration re-applies after the mutants", migSrc);
  const bf2 = await backfillIsZero();
  check("after restore: backfill leaves pre-existing threads at 0 unread", bf2 === null, String(bf2));
  const v2 = await verifyRoles();
  v2.err ? bad("verify_roles after restore", v2.err.message) : check("after restore: verify_roles ALL CHECKS PASS", v2.all, v2.failed.join("; "));
  const p2 = await runProperty(seed + 1000, 20);
  check("after restore: Property 24 passes again (20 more worlds)", p2.failures === 0, `${p2.failures}: ${p2.first}`);
  check("messages and threads unchanged at the end", (await msgHash()) === hashBefore);
  await db.end();
  await new Promise((r) => setTimeout(r, 200));
} catch (e) {
  bad("harness", e.stack ?? String(e));
} finally {
  server.kill();
  await new Promise((r) => setTimeout(r, 1500));
  fs.rmSync(data, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
