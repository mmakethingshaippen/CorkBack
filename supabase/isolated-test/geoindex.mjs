// Isolated test for the stage 12 geo index drafts (Requirement 16, task 9.8).
// Throwaway embedded PostgreSQL only: never point this at production.
//   $env:CB_ISO_DIR = "$env:TEMP\cb-iso"; node supabase\isolated-test\geoindex.mjs
// Uses bootstrap.sql for Supabase-like roles. public.postings and public.categories are
// MINIMAL stand-ins with the columns the map query and the index touch. The map query
// is the SQL equivalent of src/lib/mapQuery.ts (PostgREST cannot be used here).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const iso = process.env.CB_ISO_DIR;
if (!iso) throw new Error("Set CB_ISO_DIR (see README.md)");
const require = createRequire(path.join(iso, "package.json"));
const { Client } = require("pg");
const here = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = process.env.CB_SQL_DIR ?? path.join(here, "..");
const bin = path.join(iso, "node_modules", "@embedded-postgres", "windows-x64", "native", "bin");
const data = fs.mkdtempSync(path.join(os.tmpdir(), "cb-geoindex-"));
const port = 55500 + Math.floor(Math.random() * 90);

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
  pre: "stage12_postings_geo_index_preflight.sql",
  mig: "stage12_postings_geo_index.sql",
  ver: "stage12_postings_geo_index_verify.sql",
  rb: "stage12_postings_geo_index_rollback.sql",
};
const IDX = "postings_active_geo_idx";

try {
  const admin = await connect("supabase_admin");
  await admin.query(fs.readFileSync(path.join(here, "bootstrap.sql"), "utf8"));
  await admin.end();
  const db = await connect("postgres");

  // Run a file; on error roll back the aborted transaction and return the error.
  async function run(file, sql = read(file)) {
    try { const res = await db.query(sql); return { res: Array.isArray(res) ? res : [res] }; }
    catch (e) { await db.query("rollback").catch(() => {}); return { err: e }; }
  }
  const results = (r) => (r.res ?? []).flatMap((x) => x.rows ?? []);
  const expectOk = async (name, file, sql) => { const r = await run(file, sql); r.err ? bad(name, `${r.err.code} ${r.err.message}`) : ok(name); return r; };
  const expectFail = async (name, file, sql, code = "P0001") => { const r = await run(file, sql); r.err && r.err.code === code ? ok(name) : bad(name, r.err ? `got ${r.err.code} ${r.err.message}` : "no error"); };

  // ---- minimal tables with the real column names and types ----
  await db.query(`
    create table public.categories (id uuid primary key, slug text not null unique, label text not null);
    create table public.postings (
      id uuid primary key,
      title text not null,
      category_id uuid references public.categories(id),
      lat double precision not null,
      lng double precision not null,
      created_at timestamptz not null,
      expires_at timestamptz not null,
      deleted_at timestamptz,
      moderation_hidden_at timestamptz,
      is_promoted boolean not null default false
    );
    insert into public.categories (id, slug, label)
      select md5('cat' || i)::uuid, (array['community','sports','music','market','jobs','housing'])[i], 'Cat ' || i
      from generate_series(1, 6) i;`);

  // ~5000 rows, seeded by arithmetic only (repeatable). 3-decimal coordinates so boxes can sit exactly on a row.
  // 60% in a dense Bay Area cluster, the rest across the US. Many shared created_at values exercise the id tiebreak.
  await db.query(`
    insert into public.postings (id, title, category_id, lat, lng, created_at, expires_at, deleted_at, moderation_hidden_at, is_promoted)
    select md5('p' || i)::uuid,
           'Posting ' || i,
           md5('cat' || (1 + i % 6))::uuid,
           case when i % 10 < 6 then round((37.70 + ((i * 7919) % 4000) / 10000.0)::numeric, 3)::float8
                else round((25 + ((i::bigint * 104729) % 240000) / 10000.0)::numeric, 3)::float8 end,
           case when i % 10 < 6 then round((-122.50 + ((i * 6151) % 4000) / 10000.0)::numeric, 3)::float8
                else round((-124 + ((i::bigint * 15485863) % 560000) / 10000.0)::numeric, 3)::float8 end,
           timestamptz '2026-01-01 00:00:00+00' + ((i % 400) || ' hours')::interval,
           case when i % 13 = 0 then now() - interval '2 days' else now() + interval '30 days' end,
           case when i % 17 = 0 then now() - interval '1 day' end,
           case when i % 19 = 0 then now() - interval '1 day' end,
           i % 23 = 0
    from generate_series(1, 5000) i;
    analyze public.postings;`);
  const count = async () => Number((await db.query("select count(*) n from public.postings")).rows[0].n);
  check("seeded 5000 postings", (await count()) === 5000);

  const hash = async () => (await db.query("select md5(coalesce(string_agg(t::text, '|' order by id), '')) h, count(*) n from public.postings t")).rows[0];
  const indexes = async () => (await db.query("select indexdef from pg_indexes where schemaname='public' and tablename='postings' and indexname=$1", [IDX])).rows;

  // ---- the map query (SQL equivalent of queryPostingsInBounds), cap + 1 = 101 (cards) ----
  const MAP_SQL = (withCategory) => `
    select p.id::text
    from public.postings p
    ${withCategory ? "join public.categories c on c.id = p.category_id" : ""}
    where p.deleted_at is null and p.moderation_hidden_at is null and p.expires_at > now()
      and p.lat >= $1 and p.lat <= $2 and p.lng >= $3 and p.lng <= $4
      ${withCategory ? "and c.slug = $5" : ""}
    order by p.is_promoted desc, p.created_at desc, p.id desc
    limit 101`;
  // A row that sits on the edge, to prove edges are inclusive.
  const edge = (await db.query("select lat, lng from public.postings where deleted_at is null and moderation_hidden_at is null and expires_at > now() and lat between 37.75 and 37.85 order by id limit 1")).rows[0];
  const BOXES = [
    ["bay area (dense, over the cap)", 37.6, 38.2, -122.6, -122.0, null],
    ["berkeley block", 37.85, 37.9, -122.3, -122.25, null],
    ["tiny box on one row (inclusive edges)", edge.lat, edge.lat, edge.lng, edge.lng, null],
    ["box with edges on a row", edge.lat - 0.05, edge.lat, edge.lng - 0.05, edge.lng, null],
    ["bay area, category sports", 37.6, 38.2, -122.6, -122.0, "sports"],
    ["bay area, category community", 37.6, 38.2, -122.6, -122.0, "community"],
    ["us wide", 24, 50, -125, -66, null],
    ["us wide, category music", 24, 50, -125, -66, "music"],
    ["empty ocean", -10, -5, -150, -140, null],
    ["lng band only matters", 30, 45, -100, -90, null],
  ];
  // Run every box; when `forceIndex`, turn sequential scans off for this connection only.
  async function runBoxes(forceIndex) {
    const out = [], plans = [];
    if (forceIndex) await db.query("set enable_seqscan = off");
    try {
      for (const [, s, n, w, e, cat] of BOXES) {
        const params = cat ? [s, n, w, e, cat] : [s, n, w, e];
        out.push((await db.query(MAP_SQL(!!cat), params)).rows.map((r) => r.id));
        if (forceIndex) {
          const { rows } = await db.query(`explain ${MAP_SQL(!!cat)}`, params);
          plans.push(rows.map((r) => r["QUERY PLAN"]).join("\n"));
        }
      }
    } finally { await db.query("reset enable_seqscan"); }
    return { out, plans };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ===== 1. before: index absent =====
  check("index starts absent", (await indexes()).length === 0);
  const h0 = await hash();
  const base = await runBoxes(false);
  check("baseline map query returns rows and hits the cap", base.out.some((r) => r.length === 101) && base.out.some((r) => r.length > 0) && base.out.some((r) => r.length === 0));
  check("edge row is returned by the tiny box (inclusive range)", base.out[2].length >= 1);

  const pre0 = await expectOk("preflight runs (index absent)", F.pre);
  check("preflight reports ABSENT", results(pre0).some((r) => r.item === IDX && r.detail === "ABSENT"));
  check("preflight reports lat and lng as double precision", results(pre0).filter((r) => /^column type: l(at|ng)$/.test(r.item)).every((r) => r.detail.startsWith("double precision")) && results(pre0).filter((r) => /^column type/.test(r.item)).length === 2);
  check("preflight changed no rows", same(await hash(), h0));
  await expectFail("verify fails while the index is absent", F.ver);

  // rollback when the index does not exist
  await expectOk("rollback with no index causes no error", F.rb);
  await expectOk("rollback with no index, second time", F.rb);
  check("rollback with no index changed no rows", same(await hash(), h0));

  // ===== 2. migrate twice =====
  await expectOk("migration applies", F.mig);
  const idx1 = await indexes();
  check("exactly one index after the first run", idx1.length === 1, JSON.stringify(idx1));
  await expectOk("migration reruns cleanly", F.mig);
  check("still exactly one index after the second run", (await indexes()).length === 1);
  check("index definition is stable across reruns", same(idx1, await indexes()));
  check("only one index mentions lat and lng", Number((await db.query("select count(*) n from pg_indexes where tablename='postings' and indexdef like '%(lat, lng)%'")).rows[0].n) === 1);
  check("migration changed no rows", same(await hash(), h0));
  const pre1 = await expectOk("preflight runs (index present)", F.pre);
  check("preflight shows the index valid and ready", results(pre1).some((r) => r.item === IDX && /valid=true/.test(r.detail) && /ready=true/.test(r.detail)));
  const ver1 = await expectOk("verify passes", F.ver);
  check("verify reports success", results(ver1).some((r) => r.result === "stage12 verify: all checks passed"));
  const ver2 = await expectOk("verify passes twice (read-only)", F.ver);
  check("verify changed no rows", same(await hash(), h0) && results(ver2).length > 0);

  // ===== 3. same rows with and without the index =====
  await db.query("analyze public.postings");
  const withDefault = await runBoxes(false);
  const withIndex = await runBoxes(true);
  check("results match with the index (default planner)", same(base.out, withDefault.out));
  check("results match with the index (seqscan off)", same(base.out, withIndex.out));
  const usedIdx = withIndex.plans.map((p) => p.includes(IDX));
  check("forced run uses the index for every box", usedIdx.every(Boolean), `boxes not using it: ${usedIdx.map((u, i) => (u ? null : BOXES[i][0])).filter(Boolean).join(", ")}`);
  check("order is exactly preserved on the over-the-cap box (promoted, newest, id)", same(base.out[0], withIndex.out[0]) && withIndex.out[0].length === 101);

  // ===== 4. rollback twice =====
  await expectOk("rollback applies", F.rb);
  check("index gone after rollback", (await indexes()).length === 0);
  await expectOk("rollback twice causes no error", F.rb);
  check("rollback changed no rows", same(await hash(), h0));
  await expectFail("verify fails after rollback", F.ver);
  const afterRb = await runBoxes(false);
  check("results match after rollback", same(base.out, afterRb.out));

  // ===== 5. mutation checks: verify must catch a wrong index =====
  const wrong = async (label, ddl) => {
    await db.query(`drop index if exists public.${IDX}`);
    await db.query(ddl);
    await expectFail(`mutation: verify catches ${label}`, F.ver);
    await expectFail(`mutation: migration refuses ${label} (keeps no silent wrong index)`, F.mig);
    await db.query(`drop index if exists public.${IDX}`);
  };
  await wrong("an index missing the moderation condition", `create index ${IDX} on public.postings (lat, lng) where deleted_at is null`);
  await wrong("an index missing the deleted condition", `create index ${IDX} on public.postings (lat, lng) where moderation_hidden_at is null`);
  await wrong("an index with an expires_at predicate", `create index ${IDX} on public.postings (lat, lng) where deleted_at is null and moderation_hidden_at is null and expires_at is not null`);
  await wrong("a non-partial index", `create index ${IDX} on public.postings (lat, lng)`);
  await wrong("an index on (lng, lat)", `create index ${IDX} on public.postings (lng, lat) where deleted_at is null and moderation_hidden_at is null`);
  await expectOk("migration applies after the mutations", F.mig);
  await expectOk("verify passes on the real index again", F.ver);

  // ===== 6. mutation checks: the row hash must catch a row change =====
  const hIdx = await hash();
  check("hash is unchanged with the index in place", same(hIdx, h0));
  await db.query("update public.postings set title = title || '!' where id = (select id from public.postings order by id limit 1)");
  check("mutation: hash detects one modified row", !same(await hash(), h0));
  await db.query("update public.postings set title = left(title, length(title) - 1) where id = (select id from public.postings order by id limit 1)");
  check("hash returns to baseline after restoring that row", same(await hash(), h0));
  await db.query(`delete from public.postings where id = (select id from public.postings order by id limit 1)`);
  check("mutation: hash detects one deleted row", !same(await hash(), h0));
  const migVariant = read(F.mig).replace(/commit;\s*$/i, "update public.postings set lat = lat + 0.001 where id = (select id from public.postings order by id limit 1);\ncommit;");
  check("mutation variant text really contains an update", migVariant.includes("update public.postings"));
  const hBefore = await hash();
  await expectOk("mutation: a migration variant that updates a row runs", F.mig, migVariant);
  check("mutation: hash detects the migration variant's row change", !same(await hash(), hBefore));

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
