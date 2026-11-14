// Follow-up run for checks that failed in run 1 because of harness bugs (B's session revoked by a
// global supabase-js signOut, HEAD cache check, transient sign-in). Same accounts, same database.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { admin, env, loadState, saveState, WORK, BASE } from "./lib.mjs";

const S = loadState();
const { a: A, b: B, m: M } = S.users;
const P = S.postings;
const SHOTS = path.join(WORK, "shots");
const FIX = path.join(WORK, "fixtures");
const PUB = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/avatars/`;
const urlOf = (p) => (p ? PUB + p : null);
const results = [];
const check = (name, ok, extra = "") => { results.push({ name, ok: Boolean(ok), extra: String(extra).slice(0, 300) }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + String(extra).slice(0, 300) : ""}`); };
const guard = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split("\n")[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pathOf = async (u) => (await admin.from("profiles").select("avatar_path").eq("id", u.id).single()).data.avatar_path;
const listFolder = async (u) => ((await admin.storage.from("avatars").list(u.id, { limit: 100 })).data ?? []).map((f) => `${u.id}/${f.name}`);
const part = (name, mimeType, p) => ({ name, mimeType, buffer: fs.readFileSync(path.join(FIX, p)) });

const browser = await chromium.launch({ channel: "msedge", headless: true });
const pages = [];
async function mk(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`${page.url().replace(BASE, "")}: ${e.message.slice(0, 80)}`));
  pages.push(page);
  return { ctx, page };
}
async function signIn(page, who) {
  for (let i = 0; i < 2; i++) {
    try {
      await page.goto(`${BASE}/sign-in`);
      await page.getByLabel("Email address").fill(who.email);
      await page.getByLabel("Password").fill(S.pw);
      await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
      return;
    } catch (e) { if (i) throw e; await sleep(5000); }
  }
}
const go = (page, p) => page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
const topBarImg = (page, who) => page.locator(`a[aria-label="@${who.username}"] img`);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
async function loaded(page, url) {
  return page.evaluate(async (u) => {
    for (const i of [...document.querySelectorAll("img")].filter((x) => x.src === u)) {
      i.scrollIntoView({ block: "center" });
      for (let t = 0; t < 50 && !(i.complete && i.naturalWidth > 0); t++) await new Promise((r) => setTimeout(r, 200));
      if (i.complete && i.naturalWidth > 0) { window.scrollTo(0, 0); return true; }
    }
    return false;
  }, url);
}

const pathA = await pathOf(A);
const urlA = urlOf(pathA);
check("precondition: A has a valid stored photo", pathA && (await listFolder(A)).includes(pathA), pathA);

// Cache header with a normal GET.
await guard("cache", async () => {
  const r = await fetch(urlA);
  check("stored: GET serves image/webp with public, max-age=31536000", r.headers.get("content-type") === "image/webp" && /public.*max-age=31536000/.test(r.headers.get("cache-control") ?? ""), `${r.headers.get("content-type")} | ${r.headers.get("cache-control")}`);
});

// B: session, delete scope, re-upload.
const { ctx: ctxB, page: pb } = await mk();
await guard("B delete scope", async () => {
  await signIn(pb, B);
  const d = await ctxB.request.delete(`${BASE}/api/profile/avatar`, { failOnStatusCode: false });
  check("B API: DELETE 200 clears only B's photo", d.status() === 200 && (await pathOf(B)) === null && (await pathOf(A)) === pathA, d.status());
  check("B API: B's folder emptied, A's untouched", (await listFolder(B)).length === 0 && (await listFolder(A)).length === 1);
  const up = await ctxB.request.post(`${BASE}/api/profile/avatar`, { multipart: { file: part("gold.png", "image/png", "gold.png") }, failOnStatusCode: false });
  check("B API: re-upload 200", up.status() === 200, up.status());
});
const urlB = urlOf(await pathOf(B));

// Message thread and report.
await guard("activity", async () => {
  const msg = await ctxB.request.post(`${BASE}/api/messages`, { data: { postingId: P.p1.id, toUsername: A.username, body: "[TEST] message from B", clientId: crypto.randomUUID() }, failOnStatusCode: false });
  const mj = await msg.json().catch(() => ({}));
  check("setup: B messages A about A's posting", msg.status() === 200 && mj.threadId, msg.status());
  S.trace = { ...(S.trace ?? {}), threadId: mj.threadId };
  saveState(S);
  const rep = await ctxB.request.post(`${BASE}/api/postings/${P.p1.id}/report`, { data: { reason: "other", details: "[TEST] avatar verification report, safe to ignore" }, failOnStatusCode: false });
  check("setup: B reports A's [TEST] posting", rep.status() === 200, rep.status());
});

// Inbox and thread header, both viewers, desktop and mobile.
for (const vp of [{ width: 1280, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "mobile" }]) {
  for (const [viewer, other, otherUrl, viewerUrl] of [[B, A, urlA, urlB], [A, B, urlB, urlA]]) {
    const { page } = await mk({ width: vp.width, height: vp.height });
    await guard(`messages ${vp.tag} ${viewer.username}`, async () => {
      await signIn(page, viewer);
      for (const [name, route] of [["Inbox", "/inbox"], ["Thread header", `/inbox/${S.trace.threadId}`]]) {
        await go(page, route);
        check(`${vp.tag}: ${name} (viewer @${viewer.username.split("_")[1]}) shows the other person's photo`, await loaded(page, otherUrl));
        check(`${vp.tag}: ${name} top bar shows the viewer's photo`, (await topBarImg(page, viewer).getAttribute("src").catch(() => null)) === viewerUrl);
        check(`${vp.tag}: ${name} has no horizontal scroll`, (await overflow(page)) <= 0);
        await page.screenshot({ path: path.join(SHOTS, `fu-${vp.tag}-${viewer.username.split("_")[1]}-${name.replace(/ /g, "-")}.png`), fullPage: true });
      }
    });
  }
}

// Admin queue.
for (const vp of [{ width: 1280, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "mobile" }]) {
  const { page } = await mk({ width: vp.width, height: vp.height });
  await guard(`admin ${vp.tag}`, async () => {
    await signIn(page, M);
    await go(page, "/admin");
    check(`${vp.tag} admin: page is the admin queue`, (await page.getByText(/Recent actions/).count()) > 0);
    check(`${vp.tag} admin: shows the [TEST] report`, (await page.getByText(P.p1.title).count()) > 0);
    check(`${vp.tag} admin: author A's avatar`, await loaded(page, urlA));
    check(`${vp.tag} admin: reporter B's avatar`, await loaded(page, urlB));
    check(`${vp.tag} admin: no email shown`, !(await page.content()).includes("@corkback-test.invalid"));
    check(`${vp.tag} admin: no horizontal scroll`, (await overflow(page)) <= 0, await overflow(page));
    await page.screenshot({ path: path.join(SHOTS, `fu-admin-${vp.tag}.png`), fullPage: true });
  });
}

// Missing or deleted image file.
await guard("missing file", async () => {
  const ghost = `${A.id}/${crypto.randomUUID()}.webp`;
  const { error } = await admin.from("profiles").update({ avatar_path: ghost }).eq("id", A.id);
  if (error) throw error;
  try {
    const { page } = await mk();
    await signIn(page, A);
    await go(page, `/u/${A.username}`);
    await page.waitForFunction(() => document.querySelector('main [data-avatar="fallback"]'), null, { timeout: 15000 });
    check("missing file: profile header falls back to the initial", (await page.locator('main [data-avatar="fallback"]').first().innerText()).trim() === A.username[0].toUpperCase());
    const topOk = await page.waitForFunction((u) => !document.querySelector(`a[aria-label="@${u}"] img`), A.username, { timeout: 15000 }).then(() => true, () => false);
    check("missing file: top bar falls back to the generic icon", topOk);
    check("missing file: no broken image boxes", await page.evaluate(() => ![...document.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth === 0 && i.src.includes("/avatars/"))));
    await go(page, `/p/${P.p1.id}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-avatar="fallback"]').length > 0, null, { timeout: 15000 });
    check("missing file: posting author section falls back", true);
    check("missing file: owner sees 'Change profile photo' and can replace it", await page.goto(`${BASE}/u/${A.username}`).then(() => page.getByRole("button", { name: "Change profile photo" }).isVisible()));
  } finally {
    await admin.from("profiles").update({ avatar_path: pathA }).eq("id", A.id);
  }
  check("missing file: A's real path restored", (await pathOf(A)) === pathA);
});

// Username edit next to the photo control.
await guard("username edit", async () => {
  const { page } = await mk();
  await signIn(page, A);
  await go(page, `/u/${A.username}`);
  const newName = `cbsoc_a2_${S.hex}`;
  await page.getByRole("button", { name: "Edit username" }).click();
  await page.locator('input[name="username"]').fill(newName);
  const resp = page.waitForResponse((r) => r.url().includes("/api/profile/username"), { timeout: 20000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const r = await resp;
  check("username edit: saves", r.status() === 200, r.status());
  await page.waitForURL(new RegExp(`/u/${newName}`), { timeout: 20000 });
  check("username edit: URL follows the new name", true);
  check("username edit: photo kept after rename", await loaded(page, urlA));
  check("username edit: photo control still offered", await page.getByRole("button", { name: "Change profile photo" }).isVisible());
  S.users.a.username = newName;
  saveState(S);
  const { data } = await admin.from("profiles").select("username, avatar_path").eq("id", A.id).single();
  check("username edit: database has new name and the same photo", data.username === newName && data.avatar_path === pathA);
});

const errs = pages.flatMap((p) => p.errors);
check("follow-up pages: no uncaught page errors", errs.length === 0, errs.join(" | "));
await browser.close();
const pass = results.filter((r) => r.ok).length, fail = results.length - pass;
fs.writeFileSync(path.join(WORK, "results-followup.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, fail, results }, null, 2));
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
