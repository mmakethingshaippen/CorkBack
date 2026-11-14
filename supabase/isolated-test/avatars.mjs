// Isolated test for stage 10 (applied) and stage 10b (draft) avatar SQL.
// Throwaway embedded PostgreSQL only: never point this at production.
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\avatars.mjs
// Uses bootstrap.sql for Supabase-like roles (non-superuser postgres owner with
// BYPASSRLS, anon, authenticated, service_role, auth.uid()). storage.* is a
// STUB with the columns the SQL uses; it is owned by postgres here (in
// production it is owned by supabase_storage_admin). The real Storage API is
// not part of this test; the live two-account test covers it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const iso = process.env.CB_ISO_DIR;
if (!iso) throw new Error("Set CB_ISO_DIR (see README.md)");
const require = createRequire(path.join(iso, "package.json"));
const { Client } = require("pg");
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = process.env.CB_SQL_DIR ?? path.join(here, "..");
const bin = path.join(iso, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cb-avatars-"));
const port = 55400 + Math.floor(Math.random() * 90);

execFileSync(path.join(bin, "initdb.exe"), ["-D", data, "-U", "supabase_admin", "-E", "UTF8", "--auth=trust", "--locale=C"], { stdio: "ignore" });
const server = spawn(path.join(bin, "postgres.exe"), ["-D", data, "-p", String(port)], { stdio: "ignore" });

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`PASS ${name}`); };
const bad = (name, why) => { fail++; console.log(`FAIL ${name}: ${why}`); };
async function connect(user) {
  for (let i = 0; i < 50; i++) {
    const c = new Client({ port, user, database: "postgres", password: user === "postgres" ? "iso-owner-pw" : undefined });
    try { await c.connect(); return c; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  throw new Error("database did not start");
}
const read = (f) => fs.readFileSync(path.join(sqlDir, f), "utf8");

// Run `sql` as a client role inside a transaction that is always rolled back.
async function as(c, role, uid, sql, params = []) {
  await c.query("begin");
  try {
    await c.query(`set local role ${role}`);
    if (uid) await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
    return await c.query(sql, params);
  } finally { await c.query("rollback"); }
}
async function expectError(name, fn, code) {
  try { await fn(); bad(name, "no error"); }
  catch (e) { e.code === code ? ok(name) : bad(name, `got ${e.code} ${e.message}`); }
}
async function expectOk(name, fn, check = () => true) {
  try { const r = await fn(); check(r) ? ok(name) : bad(name, `unexpected result ${JSON.stringify(r?.rows ?? r)}`); }
  catch (e) { bad(name, `${e.code} ${e.message}`); }
}

try {
  const admin = await connect("supabase_admin");
  await admin.query(fs.readFileSync(path.join(here, "bootstrap.sql"), "utf8"));
  // Storage stub + profiles exactly as production had them before stage 10.
  await admin.query(`
    create schema storage authorization postgres;
    grant usage on schema storage to anon, authenticated, service_role;`);
  await admin.end();

  const db = await connect("postgres");
  await db.query(`
    create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
      file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
      name text not null, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
    alter table storage.buckets enable row level security;
    alter table storage.objects enable row level security;
    grant select, insert, update, delete on storage.buckets, storage.objects to anon, authenticated, service_role;
    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      username text not null unique, created_at timestamptz not null default now(),
      constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$'));
    alter table public.profiles enable row level security;
    create policy "profiles public read" on public.profiles for select using (true);
    create policy "profiles self insert" on public.profiles for insert with check (auth.uid() = id);
    create policy "profiles self update" on public.profiles for update using (auth.uid() = id);`);

  const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID(), E = randomUUID();
  for (const [id, name] of [[A, "iso_alice"], [B, "iso_bob"], [C, null], [D, "iso_dee"], [E, "iso_eve"]]) {
    await db.query("insert into auth.users (id) values ($1)", [id]);
    if (name) await db.query("insert into public.profiles (id, username) values ($1, $2)", [id, name]);
  }

  // Apply stage 10 twice (rerun safety), then stage 10b twice.
  await expectOk("stage10 applies", () => db.query(read("stage10_avatars.sql")));
  await expectOk("stage10 reruns cleanly", () => db.query(read("stage10_avatars.sql")));
  await db.query("update storage.buckets set file_size_limit = 5000000 where id = 'avatars'");
  await expectError("stage10 refuses a bucket with different settings", () => db.query(read("stage10_avatars.sql")), "P0001");
  await db.query("rollback").catch(() => {});
  await db.query("update storage.buckets set file_size_limit = 2097152 where id = 'avatars'");
  await expectOk("stage10b applies", () => db.query(read("stage10b_avatar_clear_and_rate_limit.sql")));
  await expectOk("stage10b reruns cleanly", () => db.query(read("stage10b_avatar_clear_and_rate_limit.sql")));

  const pA = `${A}/${randomUUID()}.webp`, pB = `${B}/${randomUUID()}.webp`;
  const putObject = (name, metadata) => db.query("insert into storage.objects (bucket_id, name, metadata) values ('avatars', $1, $2)", [name, metadata]);
  await putObject(pA, { mimetype: "image/webp", size: 1234 });
  await putObject(pB, { mimetype: "image/webp", size: 1234 });

  // Client roles: direct writes refused, reads and username editing still work.
  await expectError("authenticated cannot PATCH own avatar_path", () => as(db, "authenticated", A, "update public.profiles set avatar_path = $1 where id = $2", [pA, A]), "42501");
  await expectError("authenticated cannot set another account's avatar_path", () => as(db, "authenticated", B, "update public.profiles set avatar_path = $1 where id = $2", [pB, A]), "42501");
  await expectError("anon cannot PATCH avatar_path", () => as(db, "anon", null, "update public.profiles set avatar_path = null"), "42501");
  await expectError("authenticated cannot insert a profile with avatar_path", () => as(db, "authenticated", C, "insert into public.profiles (id, username, avatar_path) values ($1, 'iso_carl', null)", [C]), "42501");
  await expectOk("username editing still works (own row)", () => as(db, "authenticated", A, "update public.profiles set username = 'iso_alice2' where id = $1 returning id", [A]), (r) => r.rowCount === 1);
  await expectOk("username editing cannot touch another row (RLS)", () => as(db, "authenticated", B, "update public.profiles set username = 'iso_hijack' where id = $1 returning id", [A]), (r) => r.rowCount === 0);
  await expectOk("/welcome signup insert (id, username) still works", () => as(db, "authenticated", C, "insert into public.profiles (id, username) values ($1, 'iso_carl') returning id", [C]), (r) => r.rowCount === 1);
  await expectOk("anon can read avatar_path", () => as(db, "anon", null, "select avatar_path from public.profiles limit 1"));
  await expectOk("authenticated can read avatar_path", () => as(db, "authenticated", B, "select avatar_path from public.profiles where id = $1", [A]));
  for (const fn of ["cb_set_avatar($1, $2)", "cb_clear_avatar($1)", "cb_avatar_rate_check($1)"]) {
    const args = fn.includes("$2") ? [A, pA] : [A];
    for (const role of ["authenticated", "anon"]) {
      await expectError(`${role} cannot call ${fn.split("(")[0]}`, () => as(db, role, B, `select public.${fn}`, args), "42501");
    }
  }
  await expectError("authenticated cannot read the rate ledger", () => as(db, "authenticated", A, "select * from public.avatar_uploads"), "42501");

  // Storage stub: restrictive policies block client writes in the avatars bucket.
  await expectError("authenticated cannot upload into own avatars folder", () => as(db, "authenticated", A, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${A}/${randomUUID()}.webp`]), "42501");
  await expectError("authenticated cannot upload into another user's folder", () => as(db, "authenticated", B, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${A}/${randomUUID()}.webp`]), "42501");
  await db.query(`create policy "iso broad permissive" on storage.objects for all to authenticated using (true) with check (true)`);
  await expectError("a broad permissive policy still cannot open uploads", () => as(db, "authenticated", B, "insert into storage.objects (bucket_id, name) values ('avatars', $1)", [`${A}/${randomUUID()}.webp`]), "42501");
  await expectOk("a broad permissive policy still cannot open overwrite", () => as(db, "authenticated", B, "update storage.objects set metadata = '{}' where name = $1 returning id", [pA]), (r) => r.rowCount === 0);
  await expectOk("a broad permissive policy still cannot open delete", () => as(db, "authenticated", B, "delete from storage.objects where name = $1 returning id", [pA]), (r) => r.rowCount === 0);
  await db.query(`drop policy "iso broad permissive" on storage.objects`);

  // cb_set_avatar (service role).
  const svc = (sql, params) => as(db, "service_role", null, sql, params);
  await expectOk("service_role sets own-folder existing object", () => svc("select public.cb_set_avatar($1, $2) as old", [A, pA]), (r) => r.rows[0].old === null);
  await db.query("select public.cb_set_avatar($1, $2)", [A, pA]); // keep it set for the next checks
  await expectError("cb_set_avatar refuses another user's path", () => svc("select public.cb_set_avatar($1, $2)", [A, pB]), "42501");
  await expectError("cb_set_avatar refuses a missing object", () => svc("select public.cb_set_avatar($1, $2)", [A, `${A}/${randomUUID()}.webp`]), "P0002");
  for (const [label, md] of [["missing mime", { size: 10 }], ["blank mime", { mimetype: " ", size: 10 }], ["gif mime", { mimetype: "image/gif", size: 10 }], ["zero size", { mimetype: "image/webp", size: 0 }], ["over 2 MiB", { mimetype: "image/webp", size: 2097153 }], ["missing size", { mimetype: "image/webp" }], ["non-numeric size", { mimetype: "image/webp", size: "1e3" }]]) {
    const p = `${A}/${randomUUID()}.webp`;
    await putObject(p, md);
    await expectError(`cb_set_avatar refuses ${label}`, () => svc("select public.cb_set_avatar($1, $2)", [A, p]), "22023");
  }
  await expectError("path constraint refuses a foreign folder even for service_role", () => svc("update public.profiles set avatar_path = $1 where id = $2", [pB, A]), "23514");

  // cb_clear_avatar.
  await expectOk("cb_clear_avatar returns the old path and clears it", () => svc("select public.cb_clear_avatar($1) as old, (select avatar_path from public.profiles where id = $1) as now", [A]), (r) => r.rows[0].old === null || r.rows[0].old === pA);
  await expectOk("cb_clear_avatar result is visible in the same transaction", async () => {
    await db.query("begin"); await db.query("set local role service_role");
    const r1 = await db.query("select public.cb_clear_avatar($1) as old", [A]);
    const r2 = await db.query("select avatar_path from public.profiles where id = $1", [A]);
    await db.query("rollback");
    return { rows: [{ old: r1.rows[0].old, now: r2.rows[0].avatar_path }] };
  }, (r) => r.rows[0].old === pA && r.rows[0].now === null);
  await expectError("cb_clear_avatar unknown user -> CB404", () => svc("select public.cb_clear_avatar($1)", [randomUUID()]), "CB404");
  await expectError("cb_clear_avatar null -> CB400", () => svc("select public.cb_clear_avatar(null)"), "CB400");

  // Rate limit: 5 per 10 minutes, 20 per 24 hours.
  let accepted = 0, limited = 0;
  for (let i = 0; i < 6; i++) {
    try { await db.query("select public.cb_avatar_rate_check($1)", [D]); accepted++; } catch (e) { if (e.code === "CB429") limited++; else throw e; }
  }
  accepted === 5 && limited === 1 ? ok("sixth attempt in 10 minutes -> CB429") : bad("10 minute limit", `${accepted} accepted, ${limited} limited`);
  await db.query("insert into public.avatar_uploads (user_id, created_at) select $1, now() - interval '2 hours' from generate_series(1, 20)", [B]);
  await expectError("21st attempt in 24 hours -> CB429 (old rows count)", () => db.query("select public.cb_avatar_rate_check($1)", [B]), "CB429");
  await db.query("insert into public.avatar_uploads (user_id, created_at) select $1, now() - interval '25 hours' from generate_series(1, 30)", [A]);
  await expectOk("rows older than 24 hours are ignored", () => db.query("select public.cb_avatar_rate_check($1)", [A]));

  // Concurrency: 12 simultaneous service_role sessions for one user -> exactly 5 accepted.
  const conns = await Promise.all(Array.from({ length: 12 }, () => connect("postgres")));
  const results = await Promise.allSettled(conns.map(async (c) => { await c.query("set role service_role"); return c.query("select public.cb_avatar_rate_check($1)", [E]); }));
  const n = results.filter((r) => r.status === "fulfilled").length;
  const other = results.filter((r) => r.status === "rejected" && r.reason.code !== "CB429");
  n === 5 && other.length === 0 ? ok("12 concurrent attempts -> exactly 5 accepted") : bad("concurrency", `${n} accepted, ${other.length} unexpected errors`);
  const { rows: [{ count }] } = await db.query("select count(*)::int from public.avatar_uploads where user_id = $1", [E]);
  count === 5 ? ok("ledger has exactly 5 rows for the concurrent user") : bad("ledger count", count);
  await Promise.all(conns.map((c) => c.end()));

  // Rollback keeps ledger rows and protections; then re-apply.
  const before = (await db.query("select count(*)::int as n from public.avatar_uploads")).rows[0].n;
  await expectOk("stage10b rollback applies", () => db.query(read("stage10b_avatar_clear_and_rate_limit_rollback.sql")));
  await expectOk("rollback removed both functions", () => db.query("select to_regprocedure('public.cb_clear_avatar(uuid)') as a, to_regprocedure('public.cb_avatar_rate_check(uuid)') as b"), (r) => r.rows[0].a === null && r.rows[0].b === null);
  await expectOk("rollback kept every ledger row", () => db.query("select count(*)::int as n from public.avatar_uploads"), (r) => r.rows[0].n === before);
  await expectError("after rollback avatar_path is still unwritable", () => as(db, "authenticated", A, "update public.profiles set avatar_path = null where id = $1", [A]), "42501");
  await expectOk("cb_set_avatar survives the 10b rollback", () => db.query("select to_regprocedure('public.cb_set_avatar(uuid,text)') as f"), (r) => r.rows[0].f !== null);
  await expectOk("stage10b re-applies after rollback", () => db.query(read("stage10b_avatar_clear_and_rate_limit.sql")));
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