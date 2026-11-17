// Isolated test for the stage 14 posting location drafts (task 5.4; design: posting-location-confirmation).
// Throwaway embedded PostgreSQL 17 + PostgREST 14.18 on this machine only. Never point this at production.
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\location.mjs
// Sequence: production chain through stage 8 -> seed -> preflight -> migration -> verify (ALL CHECKS PASS and the
// transaction rolled back) -> md5 before/after -> PostgREST checks (author JWT, another user's JWT, anon and
// authenticated against the geocoder objects) -> rollback -> every stage 14 object gone and the insert grants
// back -> migration again. Set CB_SQL_DIR to a scratch copy of supabase/ to test a variant.
// Then (task 13.14) the additive stage 15 anonymous-limit chain: preflight -> migration -> verify
// (ALL CHECKS PASS, self-rollback) -> stage 14 inventory md5 unchanged -> PostgREST role checks ->
// rollback -> migration again, all with stage 14 left frozen.
// The stage 14 database property tests (task 5.5: Property 21 slot spacing, Property 25 atomic
// update) and the stage 15 database property tests (task 13.15: Property 32 the atomic anon-slot
// limit under concurrency and its window reset, Property 33 the purge deletes only expired rows)
// extend this file, after the stage 15 migration/verify/rollback chain.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL = process.env.CB_SQL_DIR ?? path.resolve(HERE, "..");
const DIR = process.env.CB_ISO_DIR;
if (!DIR) throw new Error("Set CB_ISO_DIR (see README.md)");

// ---- refuse anything that looks like production ----
const PROD_REF = "djdmiqxzcgjdwcxqqrzk";
const prodLike = /djdmiqxzcgjdwcxqqrzk|\.supabase\.(co|com|net)|pooler\.supabase|vercel-storage|neon\.tech|amazonaws\.com/i;
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && prodLike.test(v) && !/^(PATH|PSModulePath|Path)$/.test(k)) {
    console.error(`REFUSED: environment variable ${k} points at a production-looking host or project (${PROD_REF}). Unset it and run again.`);
    process.exit(2);
  }
}
for (const k of ["DATABASE_URL", "POSTGRES_URL", "PGHOST", "SUPABASE_DB_URL"]) {
  const v = process.env[k];
  if (v && !/^(postgres(ql)?:\/\/[^@]*@)?(127\.0\.0\.1|localhost|::1)([:/]|$)/.test(v)) {
    console.error(`REFUSED: ${k} is set to a non-local host. This harness only uses its own embedded database.`);
    process.exit(2);
  }
}

const requireIso = createRequire(path.join(DIR, "package.json"));
const { default: EmbeddedPostgres } = await import(pathToFileURL(requireIso.resolve("embedded-postgres")).href);
const pg = requireIso("pg");
const { PostgrestClient } = requireIso("@supabase/postgrest-js");

const PG_PORT = 55000 + crypto.randomInt(0, 2000), REST_PORT = 58000 + crypto.randomInt(0, 2000);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwt = (claims) => {
  const h = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64u(JSON.stringify({ aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, ...claims }));
  return `${h}.${p}.${crypto.createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`;
};
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${!ok && detail !== "" ? "  :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const CHAIN = ["schema.sql", "stage2_alerts.sql", "stage3_messaging.sql", "stage5_categories.sql", "stage6_social_part1.sql",
  "stage6_social_part3.sql", "stage6_social_part4.sql", "stage8_moderation.sql"];
const F = { pre: "stage14_posting_location_preflight.sql", mig: "stage14_posting_location.sql",
  ver: "stage14_posting_location_verify.sql", rb: "stage14_posting_location_rollback.sql" };
// Stage 15 (task 13.14): the shared anonymous geocoder rate limit, additive to stage 14.
const F15 = { pre: "stage15_geocoder_anon_limit_preflight.sql", mig: "stage15_geocoder_anon_limit.sql",
  ver: "stage15_geocoder_anon_limit_verify.sql", rb: "stage15_geocoder_anon_limit_rollback.sql" };

const dataDir = path.join(DIR, "data-location");
fs.rmSync(dataDir, { recursive: true, force: true });
const embedded = new EmbeddedPostgres({ databaseDir: dataDir, user: "supabase_admin", password: "iso-super-pw", port: PG_PORT,
  persistent: false, initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {} });
let rest = null;
const sqlFile = async (c, f) => { const r = await c.query(fs.readFileSync(path.join(SQL, f), "utf8")); return Array.isArray(r) ? r : [r]; };
const rowsOf = (results) => results.flatMap((x) => x.rows ?? []);

try {
  await embedded.initialise();
  await embedded.start();
  const su = embedded.getPgClient(); await su.connect();
  await su.query(fs.readFileSync(path.join(HERE, "bootstrap.sql"), "utf8"));
  await su.end();
  const owner = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "iso-owner-pw", database: "postgres" });
  owner.on("error", () => {});
  await owner.connect();
  for (const f of CHAIN) await sqlFile(owner, f);
  console.log(`applied the production chain: ${CHAIN.join(", ")}`);

  // ---- seed (as the owner, like sign-up and publish do) ----
  const A = crypto.randomUUID(), B = crypto.randomUUID();
  for (const [id, name] of [[A, "iso_author"], [B, "iso_other"]]) {
    await owner.query("insert into auth.users (instance_id, id, aud, role, email, raw_user_meta_data, created_at, updated_at) values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, $3, now(), now())", [id, `${name}@iso.invalid`, { username: name }]);
    await owner.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]);
  }
  const cat = (await owner.query("select id from public.categories order by id limit 1")).rows[0].id;
  const mk = async (author, title, expiresSql) => (await owner.query(
    `insert into public.postings (author_id, title, body, category_id, place_label, lat, lng, expiry, expires_at, time_zone)
     values ($1, $2, 'b', $3, 'Seed place', 37.87, -122.27, '1w', ${expiresSql}, 'America/Los_Angeles') returning id`, [author, title, cat])).rows[0].id;
  const P1 = await mk(A, "[SYNTHETIC] one", "now() + interval '7 days'");
  await mk(A, "[SYNTHETIC] two", "now() + interval '3 days'");
  await mk(B, "[SYNTHETIC] three", "now() + interval '5 days'");
  const sums = async () => (await owner.query(`select (select count(*)::int from auth.users) u,
    md5(coalesce(string_agg(format('%s|%s|%s|%s|%s', id, lat, lng, place_label, time_zone), E'\\n' order by id), '')) m, count(*)::int n from public.postings`)).rows[0];
  const grants = async () => (await owner.query(`select string_agg(column_name, ',' order by column_name) g from information_schema.column_privileges
    where table_schema = 'public' and table_name = 'postings' and grantee = 'authenticated' and privilege_type = 'INSERT'`)).rows[0].g;
  const s0 = await sums(), g0 = await grants();
  const stage14Objects = async () => (await owner.query(`select
    (select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'postings' and column_name = 'location_precision')
  + (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'cb_geocoder%' or proname = 'cb_update_posting_location'))
  + (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relname like 'cb_geocoder%')
  + (select count(*)::int from pg_constraint where conname = 'postings_location_precision_check') n`)).rows[0].n;

  // ---- preflight ----
  const pre = rowsOf(await sqlFile(owner, F.pre)).filter((r) => r.section);
  const dep = pre.filter((r) => r.section === "dependency");
  check("preflight: every dependency is true", dep.length > 0 && dep.every((r) => r.detail === "true"), dep.filter((r) => r.detail !== "true"));
  check("preflight: every target is absent (false)", pre.filter((r) => r.section === "target").every((r) => r.detail === "false"), pre.filter((r) => r.section === "target"));
  check("preflight changed nothing", JSON.stringify(await sums()) === JSON.stringify(s0) && (await stage14Objects()) === 0);

  // ---- migration ----
  const applyMigration = async (label) => {
    try { await sqlFile(owner, F.mig); check(label, true); return true; }
    catch (e) { check(label, false, `${e.code} ${e.message}`); return false; }
  };
  await applyMigration("migration applies");
  check("migration touched no existing row (md5 equal)", JSON.stringify(await sums()) === JSON.stringify(s0));
  check("migration added the column and the objects", (await stage14Objects()) > 0);
  check("existing rows read 'unreviewed'", (await owner.query("select count(*)::int n from public.postings where location_precision <> 'unreviewed'")).rows[0].n === 0);
  await applyMigration("migration runs a second time");
  check("second run leaves the same md5", JSON.stringify(await sums()) === JSON.stringify(s0));

  // ---- verify: ALL CHECKS PASS, and its transaction rolled back ----
  let verifyOk = false;
  try {
    const sel = (await sqlFile(owner, F.ver)).filter((x) => x.rows?.length && "pass" in x.rows[0]).pop();
    const bad = sel.rows.filter((r) => r.pass !== true);
    for (const r of bad) console.log(`     verify: ${r.n} ${String(r.check_name).slice(0, 90)} accept=${r.accept} actual=${r.actual}`);
    const all = sel.rows.find((r) => r.check_name === "ALL CHECKS PASS");
    verifyOk = !!all && all.pass === true && all.actual === "true" && bad.length === 0;
    check(`verify: ALL CHECKS PASS (${sel.rows.length - 1} checks)`, verifyOk, `${bad.length} failing`);
  } catch (e) { check("verify runs", false, `${e.code} ${e.message}`); await owner.query("rollback").catch(() => {}); }
  const s1 = await sums();
  check("verify rolled back: users, postings and the md5 are as before", JSON.stringify(s1) === JSON.stringify(s0), { before: s0, after: s1 });
  check("verify left the connection outside a transaction", (await owner.query("select 1 as x")).rows[0].x === 1
    && (await owner.query("select txid_current_if_assigned() is null as t")).rows[0].t === true);

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
  const as = (uid, role = "authenticated") => new PostgrestClient(`http://127.0.0.1:${REST_PORT}`,
    { headers: { Authorization: `Bearer ${jwt(uid ? { sub: uid, role } : { role })}` } });
  const reloadSchema = async () => { await owner.query("select pg_notify('pgrst', 'reload schema')"); await sleep(2500); };
  const REFUSED = new Set(["42501", "PGRST202", "PGRST205", "PGRST301"]);
  const refused = (r) => !!r.error && REFUSED.has(r.error.code) && !(r.data?.length);
  const update = (uid, id, extra = {}) => as(uid).rpc("cb_update_posting_location",
    { p_posting_id: id, p_lat: 10, p_lng: 20, p_time_zone: "Europe/Paris", p_precision: "approximate", ...extra });

  await reloadSchema();
  let r = await update(A, P1);
  check("PostgREST: author JWT updates its own posting", !r.error && r.data === "updated", r.error);
  const row = (await owner.query("select lat, lng, time_zone, location_precision from public.postings where id = $1", [P1])).rows[0];
  check("PostgREST: the row holds the new pin, zone and precision", row.lat === 10 && row.lng === 20 && row.time_zone === "Europe/Paris" && row.location_precision === "approximate", row);
  r = await update(B, P1, { p_lat: 1, p_lng: 2 });
  check("PostgREST: another user's JWT is refused (CB404)", r.error?.code === "CB404", r.error);
  const afterOther = (await owner.query("select lat, lng from public.postings where id = $1", [P1])).rows[0];
  check("PostgREST: the other user's call changed nothing", afterOther.lat === 10 && afterOther.lng === 20);
  r = await update(A, P1, { p_precision: "unreviewed" });
  check("PostgREST: an invalid precision is refused (22023)", r.error?.code === "22023", r.error);
  r = await as(null, "anon").rpc("cb_update_posting_location", { p_posting_id: P1, p_lat: 1, p_lng: 2, p_time_zone: "x", p_precision: "exact" });
  check("PostgREST: anon cannot call cb_update_posting_location", refused(r), r.error);

  for (const role of ["anon", "authenticated"]) {
    const db = as(role === "anon" ? null : A, role);
    for (const t of ["cb_geocoder_cache", "cb_geocoder_throttle"]) {
      r = await db.from(t).select("*");
      check(`PostgREST: ${role} cannot read ${t}`, refused(r), r.error ?? r.data);
    }
    r = await db.from("cb_geocoder_cache").insert({ key_hash: "a".repeat(64), results: [], expires_at: new Date(Date.now() + 3600e3).toISOString() });
    check(`PostgREST: ${role} cannot write cb_geocoder_cache`, refused(r), r.error);
    r = await db.rpc("cb_geocoder_take_slot", { p_max_wait_ms: 1000 });
    check(`PostgREST: ${role} cannot call cb_geocoder_take_slot`, refused(r), r.error ?? r.data);
    r = await db.rpc("cb_geocoder_purge_cache");
    check(`PostgREST: ${role} cannot call cb_geocoder_purge_cache`, refused(r), r.error ?? r.data);
  }
  r = await as(null, "service_role").rpc("cb_geocoder_take_slot", { p_max_wait_ms: 3000 });
  check("PostgREST: service_role can take a slot", !r.error && Array.isArray(r.data) && r.data.length === 1, r.error ?? r.data);

  // ---- rollback ----
  const sBeforeRb = await sums();
  try { await sqlFile(owner, F.rb); check("rollback applies", true); } catch (e) { check("rollback applies", false, `${e.code} ${e.message}`); }
  const sAfterRb = await sums();
  check("rollback left every posting row (id, lat, lng, place_label, time_zone) as it was", sAfterRb.m === sBeforeRb.m && sAfterRb.n === sBeforeRb.n && sAfterRb.u === sBeforeRb.u, { sBeforeRb, sAfterRb });
  check("rollback: every stage 14 object is gone", (await stage14Objects()) === 0, await stage14Objects());
  check("rollback: the stage 8 insert grants are back exactly", (await grants()) === g0, { g0, now: await grants() });
  try { await sqlFile(owner, F.rb); check("rollback runs a second time", true); } catch (e) { check("rollback runs a second time", false, `${e.code} ${e.message}`); }
  await reloadSchema();
  r = await update(A, P1);
  check("PostgREST after rollback: cb_update_posting_location is gone", !!r.error && ["PGRST202", "42883"].includes(r.error.code), r.error);

  // ---- migration again ----
  await applyMigration("migration applies again after the rollback");
  check("re-apply: every stage 14 object is back", (await stage14Objects()) > 0);
  check("re-apply: rows read 'unreviewed' again", (await owner.query("select count(*)::int n from public.postings where location_precision <> 'unreviewed'")).rows[0].n === 0);
  check("re-apply: posting rows unchanged", (await sums()).m === sBeforeRb.m);
  await reloadSchema();
  r = await update(A, P1);
  check("PostgREST after re-apply: the author JWT updates again", !r.error && r.data === "updated", r.error);

  // ======================================================================================
  // Stage 15 (task 13.14): the shared anonymous geocoder rate limit, additive to stage 14.
  // Stage 14 is installed at this point. Sequence: preflight (stage 14 present, stage 15
  // absent, capture the stage 14 inventory md5) -> migration -> verify (ALL CHECKS PASS and
  // a self-rollback) -> stage 14 inventory unchanged -> PostgREST role checks (anon and
  // authenticated refused on the table and both functions, service_role allowed) ->
  // rollback (every stage 15 object gone, stage 14 unchanged, run twice) -> migration again.
  // ======================================================================================
  const stage15Objects = async () => (await owner.query(`select
    (select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relname = 'cb_geocoder_anon_limit')
  + (select count(*)::int from pg_proc where pronamespace = 'public'::regnamespace
       and proname in ('cb_geocoder_take_anon_slot', 'cb_geocoder_purge_anon_limit')) n`)).rows[0].n;
  // Baseline the posting rows as they stand now (the stage 14 PostgREST checks above
  // moved P1's pin): stage 15 is additive and must leave every posting row untouched.
  const sPre15 = await sums();
  // The stage 14 inventory md5 the preflight prints; used to prove stage 15 is additive.
  const s14InvRows = async (file) => rowsOf(await sqlFile(owner, file)).filter((x) => x.section === "stage14" || x.item === "stage14 inventory md5");
  const s14Inv = (rows) => rows.find((r) => r.item === "stage14 inventory md5")?.detail ?? null;

  // ---- stage 15 preflight: stage 14 present, stage 15 absent, capture the md5 ----
  const pre15 = rowsOf(await sqlFile(owner, F15.pre));
  const dep15 = pre15.filter((r) => r.section === "dependency");
  check("stage15 preflight: every dependency is true (stage 14 present, roles exist)",
    dep15.length > 0 && dep15.every((r) => r.detail === "true"), dep15.filter((r) => r.detail !== "true"));
  check("stage15 preflight: every stage 15 target is absent (false)",
    pre15.filter((r) => r.section === "target").every((r) => r.detail === "false"), pre15.filter((r) => r.section === "target"));
  const inv0 = s14Inv(pre15);
  check("stage15 preflight: it reports the stage 14 inventory md5", typeof inv0 === "string" && inv0.length === 32, inv0);
  check("stage15 preflight changed nothing", JSON.stringify(await sums()) === JSON.stringify(sPre15) && (await stage15Objects()) === 0);

  // ---- stage 15 migration ----
  const applyS15 = async (label) => {
    try { await sqlFile(owner, F15.mig); check(label, true); return true; }
    catch (e) { check(label, false, `${e.code} ${e.message}`); return false; }
  };
  await applyS15("stage15 migration applies after stage 14");
  check("stage15 migration added the table and both functions", (await stage15Objects()) === 3, await stage15Objects());
  check("stage15 migration touched no existing posting row (md5 equal)", JSON.stringify(await sums()) === JSON.stringify(sPre15));
  check("stage15 migration left stage 14 fully present", (await stage14Objects()) > 0);
  await applyS15("stage15 migration runs a second time (re-runnable)");
  check("stage15 second run leaves stage 14 inventory md5 unchanged", s14Inv(await s14InvRows(F15.pre)) === inv0);

  // ---- stage 15 verify: ALL CHECKS PASS, and its transaction rolled back ----
  let verify15Ok = false;
  try {
    const sel = (await sqlFile(owner, F15.ver)).filter((x) => x.rows?.length && "pass" in x.rows[0]).pop();
    const bad = sel.rows.filter((r) => r.pass !== true);
    for (const r of bad) console.log(`     stage15 verify: ${r.n} ${String(r.check_name).slice(0, 90)} accept=${r.accept} actual=${r.actual}`);
    const all = sel.rows.find((r) => r.check_name === "ALL CHECKS PASS");
    verify15Ok = !!all && all.pass === true && all.actual === "true" && bad.length === 0;
    check(`stage15 verify: ALL CHECKS PASS (${sel.rows.length - 1} checks)`, verify15Ok, `${bad.length} failing`);
  } catch (e) { check("stage15 verify runs", false, `${e.code} ${e.message}`); await owner.query("rollback").catch(() => {}); }
  check("stage15 verify rolled back: no anon-limit row remains", (await owner.query("select count(*)::int n from public.cb_geocoder_anon_limit")).rows[0].n === 0);
  check("stage15 verify left the connection outside a transaction", (await owner.query("select 1 as x")).rows[0].x === 1
    && (await owner.query("select txid_current_if_assigned() is null as t")).rows[0].t === true);
  check("stage15 verify left the stage 14 inventory md5 unchanged", s14Inv(await s14InvRows(F15.pre)) === inv0);

  // ---- PostgREST role checks on the stage 15 objects ----
  await reloadSchema();
  for (const role of ["anon", "authenticated"]) {
    const db = as(role === "anon" ? null : A, role);
    r = await db.from("cb_geocoder_anon_limit").select("*");
    check(`PostgREST: ${role} cannot read cb_geocoder_anon_limit`, refused(r), r.error ?? r.data);
    r = await db.from("cb_geocoder_anon_limit").insert({ client_hash: "a".repeat(64) });
    check(`PostgREST: ${role} cannot write cb_geocoder_anon_limit`, refused(r), r.error);
    r = await db.rpc("cb_geocoder_take_anon_slot", { p_client_hash: "a".repeat(64), p_max_hits: 30, p_window_seconds: 600 });
    check(`PostgREST: ${role} cannot call cb_geocoder_take_anon_slot`, refused(r), r.error ?? r.data);
    r = await db.rpc("cb_geocoder_purge_anon_limit", { p_window_seconds: 600 });
    check(`PostgREST: ${role} cannot call cb_geocoder_purge_anon_limit`, refused(r), r.error ?? r.data);
  }
  r = await as(null, "service_role").rpc("cb_geocoder_take_anon_slot", { p_client_hash: "b".repeat(64), p_max_hits: 30, p_window_seconds: 600 });
  check("PostgREST: service_role can take an anon slot (true, within the limit)", !r.error && r.data === true, r.error ?? r.data);
  r = await as(null, "service_role").rpc("cb_geocoder_purge_anon_limit", { p_window_seconds: 0 });
  check("PostgREST: service_role can purge the anon limit", !r.error && typeof r.data === "number", r.error ?? r.data);
  await owner.query("delete from public.cb_geocoder_anon_limit");

  // ---- stage 15 rollback: every stage 15 object gone, stage 14 unchanged, run twice ----
  try { await sqlFile(owner, F15.rb); check("stage15 rollback applies", true); } catch (e) { check("stage15 rollback applies", false, `${e.code} ${e.message}`); }
  check("stage15 rollback: every stage 15 object is gone", (await stage15Objects()) === 0, await stage15Objects());
  check("stage15 rollback left stage 14 fully present", (await stage14Objects()) > 0);
  check("stage15 rollback left the stage 14 inventory md5 unchanged", s14Inv(await s14InvRows(F15.pre)) === inv0);
  check("stage15 rollback: posting rows unchanged", JSON.stringify(await sums()) === JSON.stringify(sPre15));
  try { await sqlFile(owner, F15.rb); check("stage15 rollback runs a second time", true); } catch (e) { check("stage15 rollback runs a second time", false, `${e.code} ${e.message}`); }
  await reloadSchema();
  r = await as(null, "service_role").rpc("cb_geocoder_take_anon_slot", { p_client_hash: "a".repeat(64), p_max_hits: 30, p_window_seconds: 600 });
  check("PostgREST after stage15 rollback: cb_geocoder_take_anon_slot is gone", !!r.error && ["PGRST202", "42883"].includes(r.error.code), r.error);

  // ---- stage 15 migration again (re-runnable after a rollback) ----
  await applyS15("stage15 migration applies again after the rollback");
  check("stage15 re-apply: every stage 15 object is back", (await stage15Objects()) === 3);
  check("stage15 re-apply: the stage 14 inventory md5 is unchanged", s14Inv(await s14InvRows(F15.pre)) === inv0);
  await reloadSchema();
  r = await as(null, "service_role").rpc("cb_geocoder_take_anon_slot", { p_client_hash: "c".repeat(64), p_max_hits: 30, p_window_seconds: 600 });
  check("PostgREST after stage15 re-apply: service_role can take an anon slot again", !r.error && r.data === true, r.error ?? r.data);
  await owner.query("delete from public.cb_geocoder_anon_limit");

  // ======================================================================================
  // Database property tests (task 5.5). Stage 14 is installed again at this point.
  // Seeded, so a failure can be replayed: CB_PROP_SEED=<n> node supabase\isolated-test\location.mjs
  // ======================================================================================
  const SEED = Number(process.env.CB_PROP_SEED ?? crypto.randomInt(1, 2 ** 31));
  let st = SEED >>> 0;
  const rnd = () => { st = (st + 0x6d2b79f5) >>> 0; let t = st; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const rint = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = (a) => a[rint(0, a.length - 1)];
  console.log(`property tests: seed ${SEED}`);
  const newConn = async (role) => {
    const c = new pg.Client({ host: "127.0.0.1", port: PG_PORT, user: "postgres", password: "iso-owner-pw", database: "postgres" });
    c.on("error", () => {});
    await c.connect();
    if (role) await c.query(`set role ${role}`);
    return c;
  };

  // ---- Property 21: slot grants are at least 1 second apart across concurrent callers ----
  {
    const ROUNDS = 100, MAXN = 12;
    const conns = [];
    for (let i = 0; i < MAXN; i++) conns.push(await newConn("service_role"));
    const sampler = await newConn(null);
    const pids = new Set();
    for (const c of conns) pids.add((await c.query("select pg_backend_pid() p")).rows[0].p);
    check("P21: the callers use separate backend connections", pids.size === MAXN, [...pids]);
    let bad = null, granted = 0, refusedCalls = 0, minGap = Infinity, maxWait = 0, maxN = 0;
    for (let round = 1; round <= ROUNDS && !bad; round++) {
      const n = round <= 12 ? round : rint(1, MAXN);       // rounds 1..12 cover every N once
      const bound = round === 13 ? 0 : round === 14 ? 5000 : rint(0, 5000);
      maxN = Math.max(maxN, n);
      await owner.query("update public.cb_geocoder_throttle set next_slot_at = '-infinity'");
      const seen = [];
      let polling = true;
      const poll = (async () => {
        while (polling) {
          seen.push(Date.parse((await sampler.query("select next_slot_at from public.cb_geocoder_throttle")).rows[0].next_slot_at ?? "") || 0);
          await sleep(2);
        }
      })();
      // Every caller waits at a barrier and is released in the same tick.
      let release; const gate = new Promise((res) => { release = res; });
      const t0 = Date.now();
      const calls = conns.slice(0, n).map(async (c) => { await gate; return (await c.query("select slot_at, wait_ms from public.cb_geocoder_take_slot($1)", [bound])).rows; });
      release();
      const results = await Promise.all(calls);
      const spread = Date.now() - t0;
      polling = false; await poll;
      const finalNext = (await owner.query("select next_slot_at from public.cb_geocoder_throttle")).rows[0].next_slot_at;
      const rows = results.flat();
      const slots = rows.map((x) => x.slot_at.getTime()).sort((a, b) => a - b);
      const gaps = slots.slice(1).map((v, i) => v - slots[i]);
      granted += rows.length; refusedCalls += n - rows.length;
      if (gaps.length) minGap = Math.min(minGap, ...gaps);
      if (rows.length) maxWait = Math.max(maxWait, ...rows.map((x) => x.wait_ms));
      const lo = Math.min(n, Math.floor(Math.max(bound - spread, 0) / 1100) + 1), hi = Math.min(n, Math.floor((bound + spread) / 1100) + 1);
      const perCall = results.every((x) => x.length <= 1);
      const nonDecr = seen.every((v, i) => i === 0 || v >= seen[i - 1]) && (seen.length === 0 || finalNext.getTime() >= seen[seen.length - 1]);
      const why = [];
      if (!perCall) why.push("a call returned more than one row");
      if (gaps.some((g) => g < 1000)) why.push(`gap below 1000 ms: ${gaps.join(",")}`);
      if (rows.some((x) => x.wait_ms < 0 || x.wait_ms > bound)) why.push(`wait_ms outside 0..${bound}: ${rows.map((x) => x.wait_ms).join(",")}`);
      if (rows.length < lo || rows.length > hi) why.push(`granted ${rows.length}, expected ${lo}..${hi}`);
      if (!nonDecr) why.push("next_slot_at decreased");
      if (why.length) bad = { round, n, bound, spread, why };
    }
    check(`P21: ${ROUNDS} randomized rounds (N 1..${maxN}, bound 0..5000 ms): gaps >= 1000 ms, wait_ms within the bound, none beyond the bound, next_slot_at never decreases`, !bad, bad);
    console.log(`     P21 summary: ${granted} slots granted, ${refusedCalls} callers refused, smallest gap ${minGap === Infinity ? "n/a" : minGap + " ms"}, largest wait_ms ${maxWait}`);
    // Mixed spacing of rounds: callers that arrive in a trickle, not all at once.
    await owner.query("update public.cb_geocoder_throttle set next_slot_at = '-infinity'");
    const trickle = await Promise.all(conns.slice(0, 8).map(async (c, i) => { await sleep(i * rint(0, 40)); return (await c.query("select slot_at from public.cb_geocoder_take_slot(5000)")).rows; }));
    const ts = trickle.flat().map((x) => x.slot_at.getTime()).sort((a, b) => a - b);
    check("P21: staggered callers also get slots at least 1000 ms apart", ts.length > 0 && ts.slice(1).every((v, i) => v - ts[i] >= 1000), ts);
    for (const c of conns) await c.end().catch(() => {});
    await sampler.end().catch(() => {});
  }

  // ---- Property 25 (database part): an invalid cb_update_posting_location call leaves the row's md5 equal ----
  {
    const author = await newConn("authenticated");
    const asUser = (uid) => author.query("select set_config('request.jwt.claims', $1, false)", [uid ? JSON.stringify({ sub: uid, role: "authenticated" }) : ""]);
    const rowMd5 = async (id) => (await owner.query("select md5(p::text) m from public.postings p where id = $1", [id])).rows[0].m;
    const allMd5 = async () => (await owner.query("select md5(coalesce(string_agg(p::text, E'\\n' order by id), '')) m from public.postings p")).rows[0].m;
    const target = (await owner.query("select id, lat, lng, time_zone, location_precision from public.postings where author_id = $1 order by title limit 1", [A])).rows[0];
    const ended = (await owner.query(`insert into public.postings (author_id, title, body, category_id, place_label, lat, lng, expiry, expires_at, time_zone)
      values ($1, '[SYNTHETIC] ended', 'b', $2, 'Seed place', 37.87, -122.27, '1w', now() + interval '1 hour', 'America/Los_Angeles') returning id`, [A, cat])).rows[0].id;
    await owner.query("update public.postings set expires_at = now() - interval '1 hour' where id = $1", [ended]).catch(() => {});
    const hidden = (await owner.query(`insert into public.postings (author_id, title, body, category_id, place_label, lat, lng, expiry, expires_at, time_zone)
      values ($1, '[SYNTHETIC] hidden', 'b', $2, 'Seed place', 37.87, -122.27, '1w', now() + interval '1 day', 'America/Los_Angeles') returning id`, [A, cat])).rows[0].id;
    await owner.query("update public.postings set moderation_hidden_at = now() where id = $1", [hidden]).catch(() => {});
    const endedOk = (await owner.query("select expires_at < now() as e from public.postings where id = $1", [ended])).rows[0].e;
    const kinds = [
      () => ({ who: A, id: target.id, args: [pick([91, -91, 90.0001, 1e9, Infinity, -Infinity, NaN, rnd() * 1000 + 90.01]), rnd() * 360 - 180, "UTC", "exact"], code: "22023" }),
      () => ({ who: A, id: target.id, args: [rnd() * 180 - 90, pick([181, -181, 180.0001, 1e9, Infinity, -Infinity, NaN, rnd() * 1000 + 180.01]), "UTC", "exact"], code: "22023" }),
      () => ({ who: A, id: target.id, args: [rnd() * 180 - 90, rnd() * 360 - 180, "UTC", pick(["unreviewed", "EXACT", "", "precise", "exact ", "approx"])], code: "22023" }),
      () => ({ who: A, id: target.id, args: [pick([null, 10]), pick([null, 20]), "UTC", pick([null, "exact"])], code: "22023", needsNull: true }),
      () => ({ who: B, id: target.id, args: [rnd() * 180 - 90, rnd() * 360 - 180, "Europe/Paris", "exact"], code: "CB404" }),
      () => ({ who: A, id: crypto.randomUUID(), args: [rnd() * 180 - 90, rnd() * 360 - 180, "Europe/Paris", "approximate"], code: "CB404" }),
      () => ({ who: A, id: hidden, args: [rnd() * 180 - 90, rnd() * 360 - 180, "Europe/Paris", "exact"], code: "CB404", sub: hidden }),
      () => ({ who: A, id: ended, args: [rnd() * 180 - 90, rnd() * 360 - 180, "Europe/Paris", "exact"], code: "CB409", sub: ended }),
      () => ({ who: null, id: target.id, args: [10, 20, "UTC", "exact"], code: "42501" }),
    ];
    const IT = 100; let badP = null, tried = 0;
    for (let i = 0; i < IT && !badP; i++) {
      const k = pick(kinds)();
      if (k.needsNull && k.args.every((v) => v !== null)) k.args[rint(0, 1) ? 0 : 3] = null;
      if (k.code === "CB409" && !endedOk) continue;
      const watch = k.sub ?? target.id;
      const before = [await rowMd5(watch), await allMd5()];
      await asUser(k.who);
      let code = null;
      try { await author.query("select public.cb_update_posting_location($1, $2, $3, $4, $5)", [k.id, ...k.args]); }
      catch (e) { code = e.code; }
      tried++;
      const after = [await rowMd5(watch), await allMd5()];
      if (code !== k.code || before[0] !== after[0] || before[1] !== after[1]) badP = { i, kind: k.code, got: code, args: k.args, rowSame: before[0] === after[0], tableSame: before[1] === after[1] };
    }
    check(`P25 (database): ${tried} invalid calls (bad range, NaN, infinity, null, bad precision, other user, missing, hidden, ended, signed out) all refused with the expected code and left the row md5 and the whole table md5 equal`, !badP && tried >= 90, badP ?? `only ${tried} ran`);
    check("P25 (database): the ended and hidden fixture postings were really in those states", endedOk && (await owner.query("select moderation_hidden_at is not null h from public.postings where id = $1", [hidden])).rows[0].h);
    // The same call with valid input then changes the row (the refusals above were not a dead function), and one statement moves all columns together.
    await asUser(A);
    const ok = await author.query("select public.cb_update_posting_location($1, 33.5, -111.25, 'America/Phoenix', 'exact') r", [target.id]);
    const now = (await owner.query("select lat, lng, time_zone, location_precision from public.postings where id = $1", [target.id])).rows[0];
    check("P25 (database): a valid call still writes lat, lng, zone and precision together", ok.rows[0].r === "updated" && now.lat === 33.5 && now.lng === -111.25 && now.time_zone === "America/Phoenix" && now.location_precision === "exact", now);
    await author.end().catch(() => {});
  }

  // ======================================================================================
  // Stage 15 database property tests (task 13.15). Stage 15 is installed at this point.
  // Seeded like the stage 14 properties, so a failure can be replayed with CB_PROP_SEED.
  // ======================================================================================
  const hex64 = () => { let s = ""; for (let i = 0; i < 64; i++) s += "0123456789abcdef"[rint(0, 15)]; return s; };

  // ---- Property 32: the anonymous slot limit is atomic and resets per window ----
  // cb_geocoder_take_anon_slot(p_client_hash, p_max_hits default 30, p_window_seconds default 600):
  // for each hash, at most p_max_hits trues occur within one window and the rest are false, with
  // no lost updates under concurrent callers from separate connections; different hashes count
  // separately; the window resets after p_window_seconds; an invalid hash raises 22023.
  {
    const ROUNDS = 100, MAXN = 12;
    const conns = [];
    for (let i = 0; i < MAXN; i++) conns.push(await newConn("service_role"));
    const pids = new Set();
    for (const c of conns) pids.add((await c.query("select pg_backend_pid() p")).rows[0].p);
    check("P32: the callers use separate backend connections", pids.size === MAXN, [...pids]);

    // Always start from an empty table so each round is independent.
    await owner.query("delete from public.cb_geocoder_anon_limit");

    let bad = null, totalTrue = 0, totalFalse = 0, maxN = 0, resetChecks = 0;
    for (let round = 1; round <= ROUNDS && !bad; round++) {
      // rounds 1..12 cover every concurrency N once; the rest are random.
      const n = round <= MAXN ? round : rint(1, MAXN);
      // A small max_hits keeps rounds fast while still exercising "some true, some false".
      const maxHits = pick([1, 2, 3, 5, 8, n]);
      // A long window so no accidental reset happens mid-round.
      const windowSec = 600;
      maxN = Math.max(maxN, n);
      const hash = hex64();

      // n concurrent callers for ONE hash, each on its own connection, released together.
      let release; const gate = new Promise((res) => { release = res; });
      const calls = conns.slice(0, n).map(async (c) => {
        await gate;
        return (await c.query("select public.cb_geocoder_take_anon_slot($1, $2, $3) as granted", [hash, maxHits, windowSec])).rows[0].granted;
      });
      release();
      const results = await Promise.all(calls);
      const trues = results.filter((g) => g === true).length;
      const falses = results.filter((g) => g === false).length;
      totalTrue += trues; totalFalse += falses;

      // The stored hit count must equal the number of calls (no lost updates), and the number
      // of trues must be exactly min(n, maxHits) with the rest false.
      const stored = (await owner.query("select hits from public.cb_geocoder_anon_limit where client_hash = $1", [hash])).rows[0]?.hits ?? -1;
      const expectTrue = Math.min(n, maxHits);
      const why = [];
      if (stored !== n) why.push(`stored hits ${stored} != calls ${n} (lost update)`);
      if (trues !== expectTrue) why.push(`trues ${trues} != expected ${expectTrue}`);
      if (falses !== n - expectTrue) why.push(`falses ${falses} != expected ${n - expectTrue}`);
      if (results.some((g) => typeof g !== "boolean")) why.push("a call returned a non-boolean");

      // Independence: a different hash starts fresh and is granted true on its first hit.
      const otherHash = hex64();
      const otherFirst = (await conns[0].query("select public.cb_geocoder_take_anon_slot($1, $2, $3) as g", [otherHash, maxHits, windowSec])).rows[0].g;
      if (otherFirst !== true) why.push("a different hash was not independent (first hit not true)");
      const origStillCapped = (await conns[0].query("select public.cb_geocoder_take_anon_slot($1, $2, $3) as g", [hash, maxHits, windowSec])).rows[0].g;
      // One more hit on the original hash: true only if it was still below the limit before.
      if (origStillCapped !== (stored + 1 <= maxHits)) why.push(`original hash counting not independent of other hash (got ${origStillCapped})`);

      if (why.length) { bad = { round, n, maxHits, trues, falses, stored, why }; break; }

      // Occasionally verify the window reset: a tiny window, hit once, sleep past it, hit again.
      if (round % 20 === 0) {
        resetChecks++;
        const wHash = hex64();
        const a = (await conns[0].query("select public.cb_geocoder_take_anon_slot($1, 1, 1) as g", [wHash])).rows[0].g;
        const bWithin = (await conns[0].query("select public.cb_geocoder_take_anon_slot($1, 1, 1) as g", [wHash])).rows[0].g;
        await sleep(1200); // past the 1 second window
        const cAfter = (await conns[0].query("select public.cb_geocoder_take_anon_slot($1, 1, 1) as g", [wHash])).rows[0].g;
        const hitsNow = (await owner.query("select hits from public.cb_geocoder_anon_limit where client_hash = $1", [wHash])).rows[0].hits;
        if (!(a === true && bWithin === false && cAfter === true && hitsNow === 1)) {
          bad = { round, windowReset: { a, bWithin, cAfter, hitsNow } };
          break;
        }
      }

      await owner.query("delete from public.cb_geocoder_anon_limit");
    }
    check(`P32: ${ROUNDS} randomized rounds (N 1..${maxN} concurrent callers per hash): exactly min(N, max_hits) trues per window, the rest false, no lost updates, hashes counted separately, window resets`, !bad, bad);
    check(`P32: the window reset was exercised (${resetChecks} rounds)`, resetChecks > 0 && !bad);
    console.log(`     P32 summary: ${totalTrue} grants, ${totalFalse} refusals across ${ROUNDS} rounds`);

    // Invalid hash => 22023, and nothing is written.
    let invalidOk = true, invalidWrote = false;
    for (const h of [null, "", "xyz", "A".repeat(64), "f".repeat(63), "f".repeat(65), " " + "a".repeat(63), "a".repeat(64) + "\n"]) {
      const before = (await owner.query("select count(*)::int n from public.cb_geocoder_anon_limit")).rows[0].n;
      let code = null;
      try { await conns[0].query("select public.cb_geocoder_take_anon_slot($1, 30, 600)", [h]); }
      catch (e) { code = e.code; }
      const after = (await owner.query("select count(*)::int n from public.cb_geocoder_anon_limit")).rows[0].n;
      if (code !== "22023") invalidOk = false;
      if (after !== before) invalidWrote = true;
    }
    check("P32: an invalid client hash (null, empty, non-hex, wrong length, uppercase, whitespace) is refused with 22023", invalidOk);
    check("P32: a refused invalid hash writes no row", !invalidWrote);

    await owner.query("delete from public.cb_geocoder_anon_limit");
    for (const c of conns) await c.end().catch(() => {});
  }

  // ---- Property 33: the anonymous-limit purge deletes only expired rows ----
  // cb_geocoder_purge_anon_limit(p_window_seconds default 600) deletes exactly the rows whose
  // window_start is older than the window and leaves every other row, returning the deleted count.
  {
    const ROUNDS = 100;
    let bad = null, maxRows = 0;
    const svc = await newConn("service_role");
    for (let round = 1; round <= ROUNDS && !bad; round++) {
      await owner.query("delete from public.cb_geocoder_anon_limit");
      const windowSec = pick([0, 1, 60, 300, 600, 3600]);
      const rows = rint(1, 20);
      maxRows = Math.max(maxRows, rows);
      // Each row gets a window_start at a random age. Ages sit at least a few seconds away from
      // the window edge on either side, so the expected/actual split is stable despite the clock
      // advancing by microseconds between computing the expectation and running the purge. The
      // exact boundary is covered deterministically by the fixed cases below the loop.
      const expectedExpired = new Set();
      const survivorsBefore = [];
      for (let i = 0; i < rows; i++) {
        const h = hex64();
        const expired = rnd() < 0.5;
        // Expired: comfortably older than the window. Survivor: comfortably newer (including future).
        const ageSec = expired ? windowSec + rint(5, 120) : windowSec - rint(5, 120) - 5; // may go negative => future
        await owner.query(
          "insert into public.cb_geocoder_anon_limit (client_hash, window_start, hits) values ($1, now() - make_interval(secs => $2), 1)",
          [h, ageSec]);
        if (expired) expectedExpired.add(h); else survivorsBefore.push(h);
      }

      const deleted = (await svc.query("select public.cb_geocoder_purge_anon_limit($1) as n", [windowSec])).rows[0].n;
      const remaining = (await owner.query("select client_hash from public.cb_geocoder_anon_limit order by client_hash")).rows.map((r) => r.client_hash);
      const remainingSet = new Set(remaining);

      const why = [];
      if (deleted !== expectedExpired.size) why.push(`returned count ${deleted} != expected expired ${expectedExpired.size}`);
      if (remaining.some((h) => expectedExpired.has(h))) why.push("an expired row survived the purge");
      if (survivorsBefore.some((h) => !remainingSet.has(h))) why.push("a non-expired row was wrongly deleted");
      if (remaining.length + deleted !== expectedExpired.size + survivorsBefore.length) why.push("row accounting does not balance");
      if (why.length) { bad = { round, windowSec, rows, deleted, expectedExpired: expectedExpired.size, why }; break; }
    }
    check(`P33: ${ROUNDS} randomized rounds (up to ${maxRows} rows, varied window_start around the window edge): purge deletes exactly the rows older than the window, leaves the rest, returns the deleted count`, !bad, bad);

    // Empty table: purge deletes nothing and returns 0.
    await owner.query("delete from public.cb_geocoder_anon_limit");
    const emptyDeleted = (await svc.query("select public.cb_geocoder_purge_anon_limit(600) as n")).rows[0].n;
    check("P33: purge on an empty table returns 0", emptyDeleted === 0, emptyDeleted);

    // A future-dated row (window_start ahead of now) is never deleted, even with a zero-second
    // window, because the purge removes strictly-older rows only.
    const fresh = hex64();
    await owner.query("insert into public.cb_geocoder_anon_limit (client_hash, window_start, hits) values ($1, now() + interval '1 hour', 1)", [fresh]);
    const freshDeleted = (await svc.query("select public.cb_geocoder_purge_anon_limit(0) as n")).rows[0].n;
    const freshSurvives = (await owner.query("select count(*)::int n from public.cb_geocoder_anon_limit where client_hash = $1", [fresh])).rows[0].n === 1;
    check("P33: a row not yet older than the window survives a zero-second-window purge", freshDeleted === 0 && freshSurvives, { freshDeleted, freshSurvives });

    await owner.query("delete from public.cb_geocoder_anon_limit");
    await svc.end().catch(() => {});
  }

  await owner.end();
} catch (e) {
  fail++; console.log(`FAIL harness :: ${e.stack ?? e}`);
} finally {
  try { rest?.kill(); } catch {}
  try { await embedded.stop(); } catch {}
  await sleep(500);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exitCode = fail ? 1 : 0;
}
