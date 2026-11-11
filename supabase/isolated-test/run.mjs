// Isolated compatibility + verification run. Embedded Postgres 17 + PostgREST 14.18 (production's version).
// Nothing here connects to the production database. See README.md in this folder for setup.
//
// Usage: CB_ISO_DIR=<work dir with node_modules + postgrest/> node supabase/isolated-test/run.mjs
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, "$1");
const REPO = process.env.CB_SQL_DIR ?? path.resolve(HERE, ".."); // the supabase/ folder with the migrations (CB_SQL_DIR: a mutated copy, for mutation checks)
const DIR = process.env.CB_ISO_DIR ?? HERE;           // work dir: node_modules, postgrest/, data/ (outside OneDrive)
// Test-only packages live in the work dir, not in the app's dependencies.
const requireIso = createRequire(path.join(DIR, "package.json"));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireIso.resolve("embedded-postgres")).href);
const pg = requireIso("pg");
const { PostgrestClient } = requireIso("@supabase/postgrest-js");
// Fresh ports each run, so a server from a previous run that is still shutting down can't collide.
const PG_PORT = 55000 + crypto.randomInt(0, 2000), REST_PORT = 58000 + crypto.randomInt(0, 2000);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const results = [];
const out = (s) => console.log(s);
const check = (suite, name, ok, detail = "") => { results.push({ suite, name, ok: !!ok }); out(`${ok ? "PASS" : "FAIL"} [${suite}] ${name}${detail ? " :: " + detail : ""}`); };

const b64u = (b) => Buffer.from(b).toString("base64url");
const jwt = (claims) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};

const pgLog = [];
const embedded = new EmbeddedPostgres({ databaseDir: path.join(DIR, "data"), user: "supabase_admin", password: "iso-super-pw", port: PG_PORT,
  persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: (m) => pgLog.push(String(m)), onError: (m) => pgLog.push(String(m)) });
let rest = null;

async function sqlFile(client, file) {
  const text = fs.readFileSync(path.join(REPO, file), "utf8");
  try {
    const r = await client.query(text);
    const list = Array.isArray(r) ? r : [r];
    return list.filter((x) => x.rows && x.rows.length).pop()?.rows ?? [];
  } catch (e) {
    const pos = e.position ? Number(e.position) : null;
    throw new Error(`${file}: ${e.code ?? ""} ${e.message}${e.where ? " | " + e.where.split("\n")[0] : ""}${pos ? " | near: " + text.slice(Math.max(0, pos - 80), pos + 40).replace(/\s+/g, " ") : ""}`);
  }
}

async function main() {
  await embedded.initialise();
  await embedded.start();
  const su = embedded.getPgClient(); await su.connect();
  await su.query(fs.readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
  await su.end();
  const owner = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "iso-owner-pw", database: "postgres" });
  owner.on("error", () => {});
  await owner.connect();
  out(`postgres: ${(await owner.query("select version()")).rows[0].version.split(",")[0]}, encoding ${(await owner.query("show server_encoding")).rows[0].server_encoding}`);

  // Production migration chain, in order (stage5_profile_trigger.sql was never applied in production).
  for (const f of ["schema.sql", "stage2_alerts.sql", "stage3_messaging.sql", "stage5_categories.sql",
                   "stage6_social_part1.sql", "stage6_social_part3.sql", "stage6_social_part4.sql"]) {
    await sqlFile(owner, f); out(`applied ${f}`);
  }

  // PostgREST 14.18 against it.
  const bin = path.join(DIR, "node_modules/@embedded-postgres/windows-x64/native/bin");
  // PostgREST on Windows intermittently exits (code 3) during startup; start it up to 3 times.
  let restLog = "", ready = false, attempt = 0;
  while (!ready && attempt < 3) {
    attempt++;
    rest = spawn(path.join(DIR, "postgrest/postgrest.exe"), [], {
      env: { ...process.env, PATH: `${bin};${process.env.PATH}`,
        PGRST_DB_URI: `postgres://authenticator:iso-auth-pw@127.0.0.1:${PG_PORT}/postgres`,
        PGRST_DB_SCHEMAS: "public", PGRST_DB_ANON_ROLE: "anon", PGRST_JWT_SECRET: JWT_SECRET,
        PGRST_SERVER_PORT: String(REST_PORT), PGRST_SERVER_HOST: "127.0.0.1", PGRST_LOG_LEVEL: "error" },
      stdio: ["ignore", "pipe", "pipe"] });
    restLog = ""; rest.stdout.on("data", (d) => (restLog += d)); rest.stderr.on("data", (d) => (restLog += d));
    for (let i = 0; i < 40 && !ready && rest.exitCode === null; i++) {
      try { const r = await fetch(`http://127.0.0.1:${REST_PORT}/categories?select=id&limit=1`); ready = r.status === 200; } catch {}
      if (!ready) await new Promise((r) => setTimeout(r, 500));
    }
    if (!ready) { try { rest.kill(); } catch {} await new Promise((r) => setTimeout(r, 1500)); }
  }
  if (!ready) throw new Error(`PostgREST did not become ready after ${attempt} attempts. exit=${rest.exitCode} log: ${restLog.replace(/\s+/g, " ").slice(0, 600)}`);
  out(`PostgREST 14.18 ready (attempt ${attempt})`);
  const reload = async () => { await owner.query("notify pgrst, 'reload schema'"); await new Promise((r) => setTimeout(r, 1500)); };

  // Two users (A author, B other), created as the owner like the sign-up route does.
  const A = crypto.randomUUID(), B = crypto.randomUUID();
  for (const [id, name] of [[A, "iso_author"], [B, "iso_other"]]) {
    await owner.query("insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())",
      [id, `${name}@iso.invalid`, { username: name }]);
    await owner.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]);
  }
  const as = (uid) => new PostgrestClient(`http://127.0.0.1:${REST_PORT}`, { headers: { Authorization: `Bearer ${uid ? jwt({ sub: uid, role: "authenticated" }) : jwt({ role: "anon" })}` } });

  // The deployed code's (6289a7e) exact calls. Returns nothing; records checks.
  const POSTING_COLUMNS = "id, title, body, flyer_url, rsvp_url, event_date, event_time, end_date, end_time, time_zone, place_label, lat, lng, expiry, expires_at, is_promoted, created_at, profiles!postings_author_id_fkey(username), categories(slug)";
  async function deployedCode(suite, { promoteMustWork = true } = {}) {
    const a = as(A), b = as(B), anon = as(null);
    // Publish (src/app/api/postings/route.ts @6289a7e)
    const { data: cat, error: catErr } = await a.from("categories").select("id").eq("slug", "community").single();
    const { data: dbZone, error: tzErr } = await a.rpc("cb_safe_time_zone", { p_tz: "America/Los_Angeles" });
    const sentExpiry = new Date(Date.now() + 7 * 86400000).toISOString();
    const ins = await a.from("postings").insert({
      author_id: A, title: `[ISO] ${suite}`, body: "Isolated test", category_id: cat?.id, rsvp_url: null,
      event_date: null, event_time: null, end_date: null, end_time: null,
      time_zone: tzErr || dbZone !== "America/Los_Angeles" ? null : dbZone, place_label: "Board",
      lat: 37.87, lng: -122.27, expiry: "1w", expires_at: sentExpiry,
    }).select("id").single();
    check(suite, "deployed publish: category lookup, zone RPC, insert ... select id", !catErr && !tzErr && !ins.error && ins.data?.id, ins.error ? `${ins.error.code} ${ins.error.message}` : "");
    const id = ins.data?.id;
    if (!id) return;
    // Reads (src/lib/postings.ts @6289a7e)
    const list = await anon.from("postings").select(POSTING_COLUMNS).is("deleted_at", null).gt("expires_at", new Date().toISOString());
    const one = await anon.from("postings").select(POSTING_COLUMNS).eq("id", id).is("deleted_at", null).maybeSingle();
    check(suite, "deployed reads: active list and direct posting (anon) include it", !list.error && list.data.some((p) => p.id === id) && one.data?.id === id, list.error?.message ?? "");
    // Promote (src/app/api/postings/promote/route.ts @6289a7e)
    const pre = await a.from("postings").select("id, author_id, deleted_at, expires_at").eq("id", id).maybeSingle();
    const up = await a.from("postings").update({ is_promoted: true }).eq("id", id).eq("author_id", A);
    const v1 = (await owner.query("select is_promoted from public.postings where id = $1", [id])).rows[0].is_promoted;
    const down = await a.from("postings").update({ is_promoted: false }).eq("id", id).eq("author_id", A);
    const v2 = (await owner.query("select is_promoted from public.postings where id = $1", [id])).rows[0].is_promoted;
    const works = !pre.error && pre.data?.author_id === A && !up.error && v1 === true && !down.error && v2 === false;
    if (promoteMustWork) check(suite, "deployed promote toggle: read, update is_promoted true then false", works, up.error ? `${up.error.code} ${up.error.message}` : `stored ${v1}/${v2}`);
    else check(suite, "deployed promote toggle is REFUSED (expected after phase B)", up.error?.code === "42501" && v1 === false, up.error ? `${up.error.code}` : `stored ${v1}`);
    const other = await b.from("postings").update({ is_promoted: true }).eq("id", id).eq("author_id", B);
    const v3 = (await owner.query("select is_promoted from public.postings where id = $1", [id])).rows[0].is_promoted;
    check(suite, "another user cannot promote it", v3 === false, other.error ? other.error.code : "0 rows");
    // Likes and plans (like/plan routes @6289a7e) by B on A's posting
    const l1 = await b.from("likes").upsert({ posting_id: id, user_id: B }, { onConflict: "posting_id,user_id", ignoreDuplicates: true });
    const l2 = await b.from("likes").delete().eq("posting_id", id).eq("user_id", B);
    const p1 = await b.from("plans").upsert({ posting_id: id, user_id: B, kind: "going" }, { onConflict: "posting_id,user_id" });
    const p2 = await b.from("plans").upsert({ posting_id: id, user_id: B, kind: "interested" }, { onConflict: "posting_id,user_id" });
    const p3 = await b.from("plans").delete().eq("posting_id", id).eq("user_id", B);
    check(suite, "deployed likes/plans upserts and deletes", ![l1, l2, p1, p2, p3].some((r) => r.error), [l1, l2, p1, p2, p3].map((r) => r.error?.code ?? "ok").join(","));
    // Messaging (src/app/api/messages/route.ts + messagesServer.ts @6289a7e)
    const lo = A < B ? A : B, hi = A < B ? B : A;
    const th = await b.from("message_threads").insert({ posting_id: id, user_lo: lo, user_hi: hi }).select("id").single();
    const msg = th.data ? await b.from("messages").upsert({ thread_id: th.data.id, sender_id: B, body: "[ISO] hello", client_id: crypto.randomUUID() },
      { onConflict: "thread_id,sender_id,client_id", ignoreDuplicates: true }).select("id, sender_id, body, created_at") : { error: th.error };
    check(suite, "deployed messaging: start thread from posting, send message", !th.error && !msg.error && msg.data?.length === 1, th.error?.message ?? msg.error?.message ?? "");
    return id;
  }

  // 1. Baseline: before stage 8.
  await deployedCode("before stage 8");

  // 2. Preflight (read-only), migration (phase A), catalog + role verification.
  const pre = await sqlFile(owner, "stage8_moderation_preflight.sql");
  for (const r of pre) if (r.ok === false) check("preflight", r.check_name, false, `${r.actual} (expected ${r.expect})`);
  check("preflight", `all guard rows ok (${pre.filter((r) => r.ok === true).length} checked, ${pre.filter((r) => r.ok === null).length} info)`, pre.every((r) => r.ok !== false));
  for (const r of pre.filter((x) => x.ok === null)) out(`  info: ${r.check_name} = ${r.actual}`);
  await sqlFile(owner, "stage8_moderation.sql"); out("applied stage8_moderation.sql (phase A)");
  const va = await sqlFile(owner, "stage8_moderation_verify_admin.sql");
  for (const r of va) if (!r.pass) check("verify_admin", r.check_name, false, `actual=${r.actual} expected=${r.expected}`);
  check("verify_admin", `${va.filter((r) => r.pass).length}/${va.length} catalog checks pass`, va.every((r) => r.pass));
  const vr = await sqlFile(owner, "stage8_moderation_verify_roles.sql");
  for (const r of vr) if (!r.pass) check("verify_roles", r.check_name, false, `actual=${r.actual} accept=${JSON.stringify(r.accept)}`);
  check("verify_roles", `${vr.filter((r) => r.pass).length}/${vr.length} role checks pass`, vr.every((r) => r.pass));
  await reload();

  // 3. Deployed code after phase A.
  const idA = await deployedCode("after phase A");
  if (idA) {
    const stored = (await owner.query("select expires_at - created_at as span from public.postings where id = $1", [idA])).rows[0].span;
    check("after phase A", "publish trigger: stored expiry = preset (7 days), not the client's value", stored.days === 7 && !stored.hours, JSON.stringify(stored));
  }

  // 4. Phase B: direct promotion is refused; the new code's function path works.
  const pb = await sqlFile(owner, "stage8b_promotion_lockdown.sql");
  check("phase B", "check row: direct promotion off, content edits on, function available", pb[0]?.clients_can_set_promotion_directly === false && pb[0]?.clients_can_still_edit_content === true && pb[0]?.promotion_function_available === true, JSON.stringify(pb[0]));
  await reload();
  const idB = await deployedCode("after phase B", { promoteMustWork: false });
  if (idB) {
    const r1 = await as(A).rpc("set_posting_promoted", { p_posting_id: idB, p_promoted: true });
    const r2 = await as(A).rpc("set_posting_promoted", { p_posting_id: idB, p_promoted: false });
    const r3 = await as(B).rpc("set_posting_promoted", { p_posting_id: idB, p_promoted: true });
    check("after phase B", "new code's promotion path (rpc set_posting_promoted) works; other user refused", r1.data === "promoted" && r2.data === "unpromoted" && r3.error?.code === "CB404", `${r1.data ?? r1.error?.code}/${r2.data ?? r2.error?.code}/${r3.error?.code}`);
  }

  // 5. Rollback path: re-grant phase B, roll back stage 8, deployed code works again.
  await owner.query("grant update (is_promoted) on public.postings to authenticated");
  const colBefore = (await owner.query("select has_column_privilege('authenticated', 'public.posting_reports', 'status', 'select') as c, has_table_privilege('authenticated', 'public.posting_reports', 'select') as t")).rows[0];
  check("rollback", "precondition: the migration really grants authenticated COLUMN-level select on posting_reports (and no table-level select)", colBefore.c === true && colBefore.t === false, JSON.stringify(colBefore));
  // Finding (informational): does the OLD rollback's table-level "revoke all" already clear column grants? Rolled back, changes nothing.
  await owner.query("begin"); await owner.query("revoke all on public.posting_reports from anon, authenticated");
  const revAllOnly = (await owner.query("select has_column_privilege('authenticated', 'public.posting_reports', 'status', 'select') as c")).rows[0].c;
  await owner.query("rollback");
  out(`  info: table-level 'revoke all' alone leaves authenticated column SELECT on posting_reports.status = ${revAllOnly}`);
  const rb = await sqlFile(owner, "stage8_moderation_rollback.sql");
  check("rollback", "functions removed; no client access to moderation data (table OR column level); no direct reply inserts; hidden postings and their aggregate counts still excluded",
    Number(rb[0]?.stage8_functions_left) === 0 && rb[0]?.clients_can_read_moderation_data === false && rb[0]?.clients_can_read_any_report_column === false
    && rb[0]?.anyone_can_insert_replies_directly === false && rb[0]?.hidden_still_excluded === true && rb[0]?.reaction_counts_still_exclude_hidden === true, JSON.stringify(rb[0]));
  await reload();
  await deployedCode("after rollback");

  // 6. The two owner-only setup scripts refuse their placeholders (they must be edited by Max).
  for (const f of ["stage8_admin_grant.sql", "stage8_test_admin.sql"]) {
    let msg = "ran";
    try { await sqlFile(owner, f); } catch (e) { msg = e.message; }
    check("setup scripts", `${f} refuses to run unedited`, /Nothing was changed/.test(msg), msg.slice(0, 120));
  }

  // 7. Temporary test admin script: refuses a real account, grants a fresh disposable one, revoke leaves none.
  // (Stage 8 functions were rolled back in step 5; re-apply phase A so is_admin exists.)
  await sqlFile(owner, "stage8_moderation.sql"); await reload();
  for (let i = 0; i < 20; i++) {   // wait until PostgREST's schema cache has the re-created functions
    const probe = await as(A).rpc("is_admin");
    if (probe.error?.code !== "PGRST202") break;
    await owner.query("notify pgrst, 'reload schema'"); await new Promise((r) => setTimeout(r, 1000));
  }
  const tmpl = fs.readFileSync(path.join(REPO, "stage8_test_admin.sql"), "utf8");
  const grantPart = tmpl.split("-- 2. REVOKE")[0];
  // Un-comment exactly the revoke block's SQL lines, as Max would.
  const revokePart = tmpl.split("-- 2. REVOKE")[1].split("\n").filter((l) => /^--\s+(delete|where|and|select)\b/.test(l)).map((l) => l.replace(/^--\s?/, "")).join("\n");
  out(`revoke block run:\n${revokePart.split("\n").map((l) => "    " + l).join("\n")}`);
  let realMsg = "granted";
  try { await owner.query(grantPart.replace("REPLACE_WITH_TEST_USERNAME", "iso_author")); } catch (e) { realMsg = e.message; }
  check("test admin", "refuses a real (non-test) account", /Nothing was changed/.test(realMsg) && (await owner.query("select count(*)::int n from public.admins")).rows[0].n === 0, realMsg.slice(0, 90));
  const T = crypto.randomUUID(), tname = "cbsoc_admin_a1b2c3";
  await owner.query("insert into auth.users (instance_id, id, aud, role, email, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, now(), now())", [T, `${tname}@yopmail.com`]);
  await owner.query("insert into public.profiles (id, username) values ($1, $2)", [T, tname]);
  await owner.query(grantPart.replace("REPLACE_WITH_TEST_USERNAME", tname));
  const before = await as(T).rpc("is_admin");
  const queue = await as(T).rpc("admin_report_queue", { p_status: "all" });
  await owner.query(revokePart);
  const after = await as(T).rpc("is_admin");
  const left = (await owner.query("select count(*)::int n from public.admins where granted_note like 'TEMPORARY stage 8%'")).rows[0].n;
  check("test admin", "grants a fresh disposable test account; it can use admin functions; revoke removes it", before.data === true && !queue.error && after.data === false && left === 0,
    `is_admin ${before.data}->${after.data}, queue ${queue.error?.code ?? "ok"}, left ${left}`);

  // 8. Multi-session behavior (concurrent replies/reports, report vs hide/delete lock ordering). Phase A is applied again at this point.
  const { runConcurrency } = await import(pathToFileURL(path.join(HERE, "concurrency.mjs")).href);
  await runConcurrency({ pg, port: PG_PORT, owner, check, out });

  await owner.end();
  if (results.some((r) => !r.ok) && restLog.trim()) out(`postgrest log: ${restLog.trim().slice(0, 400)}`);
}

main()
  .catch((e) => { check("harness", "run completed", false, e.message); })
  .finally(async () => {
    if (rest) rest.kill();
    try { await embedded.stop(); } catch {}
    const failed = results.filter((r) => !r.ok).length;
    out(`\nTOTAL ${results.length - failed}/${results.length} passed`);
    process.exit(failed ? 1 : 0);
  });
