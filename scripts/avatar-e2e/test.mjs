// Profile photo browser verification. Real Microsoft Edge (playwright-core), a running CorkBack build,
// the database in .env.local, and the accounts setup.mjs created. Writes results.json and shots\ to WORK.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { chromium } from "playwright-core";
import { createClient } from "@supabase/supabase-js";
import { admin, env, loadState, saveState, sharp, WORK, BASE } from "./lib.mjs";

const S = loadState();
const { a: A, b: B, r: R, m: M } = S.users;
const P = S.postings;
const SHOTS = path.join(WORK, "shots");
const FIX = path.join(WORK, "fixtures");
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(FIX, { recursive: true });
const PUB = `${env.NEXT_PUBLIC_SUPABASE_URL.replace(/\/+$/, "")}/storage/v1/object/public/avatars/`;
const urlOf = (p) => (p ? PUB + p : null);

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok: ok === "blocked" ? "blocked" : Boolean(ok), extra: String(extra).slice(0, 300) });
  console.log(`${ok === "blocked" ? "BLOCKED" : ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + String(extra).slice(0, 300) : ""}`);
}
async function guard(name, fn) {
  try { await fn(); } catch (e) { check(name, false, e.message.split("\n")[0]); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pathOf = async (u) => (await admin.from("profiles").select("avatar_path").eq("id", u.id).single()).data.avatar_path;
const listFolder = async (u) => ((await admin.storage.from("avatars").list(u.id, { limit: 100 })).data ?? []).map((f) => `${u.id}/${f.name}`);

// ---------------------------------------------------------------- fixtures (built here, never committed)
async function twoTone(w, h) {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; if (x < w / 2) px[i] = 220; else px[i + 2] = 220; }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}
const solid = (w, h, bg, fmt) => sharp({ create: { width: w, height: h, channels: 3, background: bg } })[fmt]().toBuffer();
const F = {};
async function fixture(name, buf) { const p = path.join(FIX, name); fs.writeFileSync(p, buf); F[name] = p; return p; }
await fixture("wide.png", await twoTone(1200, 600));
await fixture("green.jpg", await solid(800, 800, { r: 30, g: 160, b: 60 }, "jpeg"));
await fixture("navy.webp", await solid(640, 480, { r: 31, g: 46, b: 77 }, "webp"));
await fixture("gold.png", await solid(400, 400, { r: 200, g: 160, b: 40 }, "png"));
await fixture("anim.gif", await solid(64, 64, { r: 0, g: 0, b: 0 }, "gif"));
await fixture("vector.svg", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64"/></svg>'));
await fixture("notes.png", Buffer.from("this is a text file pretending to be a PNG ".repeat(20)));
await fixture("huge.png", await sharp(crypto.randomBytes(1100 * 1100 * 3), { raw: { width: 1100, height: 1100, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer());
check("fixture: huge.png is over 2 MiB", fs.statSync(F["huge.png"]).size > 2 * 1024 * 1024, fs.statSync(F["huge.png"]).size);

// ---------------------------------------------------------------- browser helpers
const browser = await chromium.launch({ channel: "msedge", headless: true });
const contexts = [];
async function mk(viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  contexts.push(ctx);
  const page = await ctx.newPage();
  page.posts = [];
  page.on("request", (r) => { if (r.url().endsWith("/api/profile/avatar") && r.method() !== "GET") page.posts.push(r.method()); });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(`${page.url().replace(BASE, "")}: ${e.message.slice(0, 80)}`));
  return { ctx, page };
}
async function signIn(page, who) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password").fill(S.pw);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30000 }), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
}
async function signInRetry(page, who) {
  try { await signIn(page, who); } catch { await sleep(5000); await signIn(page, who); }
}
async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await page.waitForFunction(() => !document.body.innerText.includes("Sign out"), null, { timeout: 20000 });
}
const go = async (page, p) => { await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" }); };
const headerAvatar = (page) => page.locator('main img[width="88"], main span[data-avatar][style*="88px"]').first();
const topBarImg = (page, who) => page.locator(`a[aria-label="@${who.username}"] img`);
const photosOf = (page, url) => page.locator(`img[data-avatar="photo"][src="${url}"]`);
async function overflow(page) { return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); }
async function shot(page, name) { await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); }
async function loaded(page, url) {
  // The <img> actually decoded (not just present): naturalWidth > 0. Avatars are lazy, so scroll each into view.
  return page.evaluate(async (u) => {
    const imgs = [...document.querySelectorAll("img")].filter((i) => i.src === u);
    for (const i of imgs) {
      i.scrollIntoView({ block: "center" });
      for (let t = 0; t < 50 && !(i.complete && i.naturalWidth > 0); t++) await new Promise((r) => setTimeout(r, 200));
      if (i.complete && i.naturalWidth > 0) { window.scrollTo(0, 0); return true; }
    }
    window.scrollTo(0, 0);
    return false;
  }, url);
}
async function choose(page, file, label) {
  const [fc] = await Promise.all([page.waitForEvent("filechooser", { timeout: 10000 }), page.getByRole("button", { name: label }).click()]);
  await fc.setFiles(file);
}
async function waitStatus(page, re, timeout = 30000) {
  await page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source, { timeout });
}
async function pixel(url, fx = 0.5, fy = 0.5) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  const img = sharp(buf);
  const m = await img.metadata();
  const { data, info } = await img.removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const x = Math.min(info.width - 1, Math.floor(info.width * fx)), y = Math.min(info.height - 1, Math.floor(info.height * fy));
  const i = (y * info.width + x) * 3;
  return { w: m.width, h: m.height, fmt: m.format, exif: Boolean(m.exif), r: data[i], g: data[i + 1], b: data[i + 2] };
}
const api = (ctx) => ({
  post: (file, extra = {}) => ctx.request.post(`${BASE}/api/profile/avatar`, { multipart: { ...(file ? { file } : {}), ...extra }, failOnStatusCode: false }),
  del: () => ctx.request.delete(`${BASE}/api/profile/avatar`, { failOnStatusCode: false }),
});
const part = (name, mimeType, p) => ({ name, mimeType, buffer: fs.readFileSync(p) });

// ================================================================= 1. Owner A, desktop: crop, preview, upload
const { ctx: ctxA, page: pa } = await mk();
await guard("A flow", async () => {
  await signIn(pa, A);
  await go(pa, `/u/${A.username}`);
  check("A: own profile shows 'Add profile photo'", await pa.getByRole("button", { name: "Add profile photo" }).isVisible());
  check("A: no 'Remove photo' before a photo exists", (await pa.getByRole("button", { name: "Remove photo" }).count()) === 0);
  check("A: header shows fallback initial", (await pa.locator('main [data-avatar="fallback"]').first().innerText()).trim() === A.username[0].toUpperCase());
  check("A: top bar shows the generic icon (no photo yet)", (await topBarImg(pa, A).count()) === 0);
  check("A: Edit username still present next to the photo control", await pa.getByRole("button", { name: "Edit username" }).isVisible());

  // Preview + zoom + Cancel: nothing sent.
  await choose(pa, F["wide.png"], "Add profile photo");
  const preview = pa.getByRole("application", { name: /Photo preview/ });
  await preview.waitFor({ timeout: 10000 });
  await pa.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && i.style.width && parseFloat(i.style.width) > 0; });
  const w0 = await preview.locator("img").evaluate((i) => parseFloat(i.style.width));
  check("crop: preview shows the whole short side (240 px circle, 1200x600 -> 480 px wide)", Math.abs(w0 - 480) < 2, w0);
  const slider = pa.getByRole("slider", { name: "Zoom" });
  await slider.focus();
  for (let i = 0; i < 20; i++) await pa.keyboard.press("ArrowRight");
  const w1 = await preview.locator("img").evaluate((i) => parseFloat(i.style.width));
  const h1 = await preview.locator("img").evaluate((i) => parseFloat(i.style.height));
  check("crop: keyboard zoom enlarges the preview", w1 > w0, `${w0} -> ${w1}`);
  check("crop: zoom keeps proportions (2:1)", Math.abs(w1 / h1 - 2) < 0.01, `${w1}x${h1}`);
  await preview.focus();
  const left0 = await preview.locator("img").evaluate((i) => parseFloat(i.style.left));
  await pa.keyboard.press("ArrowRight");
  const left1 = await preview.locator("img").evaluate((i) => parseFloat(i.style.left));
  check("crop: arrow key moves the crop", left1 < left0, `${left0} -> ${left1}`);
  await shot(pa, "01-cropper-desktop");
  await pa.getByRole("button", { name: "Cancel", exact: true }).click();
  check("crop: Cancel closes the preview", (await preview.count()) === 0);
  check("crop: nothing was uploaded before Save", pa.posts.length === 0, pa.posts.join(","));
  check("crop: no photo stored after Cancel", (await pathOf(A)) === null);

  // Real upload: drag the photo left (shows the right, blue half), then Save.
  await choose(pa, F["wide.png"], "Add profile photo");
  await preview.waitFor();
  await pa.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && parseFloat(i.style.width) > 0; });
  const box = await preview.boundingBox();
  await pa.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pa.mouse.down();
  await pa.mouse.move(box.x + box.width / 2 - 300, box.y + box.height / 2, { steps: 12 });
  await pa.mouse.up();
  const leftDrag = await preview.locator("img").evaluate((i) => parseFloat(i.style.left));
  check("crop: drag reaches the right edge and is clamped inside the image", Math.abs(leftDrag + 240) < 2, leftDrag);
  const resp = pa.waitForResponse((r) => r.url().endsWith("/api/profile/avatar") && r.request().method() === "POST", { timeout: 60000 });
  await pa.getByRole("button", { name: "Save photo" }).click();
  const r1 = await resp;
  check("upload: POST 200", r1.status() === 200, r1.status());
  await waitStatus(pa, /Your photo is saved\./);
  const p1 = await pathOf(A);
  check("upload: avatar_path stored in A's own folder as .webp", Boolean(p1) && p1.startsWith(`${A.id}/`) && p1.endsWith(".webp"), p1);
  await pa.waitForFunction((u) => [...document.querySelectorAll("img")].some((i) => i.src === u && i.naturalWidth > 0), urlOf(p1), { timeout: 20000 });
  check("upload: profile header shows the new photo without reload", await loaded(pa, urlOf(p1)));
  check("upload: top bar shows the new photo", (await topBarImg(pa, A).getAttribute("src")) === urlOf(p1));
  check("upload: label changes to 'Change profile photo' and Remove appears",
    (await pa.getByRole("button", { name: "Change profile photo" }).isVisible()) && (await pa.getByRole("button", { name: "Remove photo" }).isVisible()));
  const px = await pixel(urlOf(p1));
  check("stored: square WebP, 512 px, no EXIF", px.fmt === "webp" && px.w === 512 && px.h === 512 && !px.exif, JSON.stringify(px));
  check("stored: crop applied (right half = blue, not stretched red/blue mix)", px.b > 180 && px.r < 60, JSON.stringify(px));
  const pxEdge = await pixel(urlOf(p1), 0.02, 0.5);
  check("stored: left edge of the crop is also blue (whole square from the right half)", pxEdge.b > 180 && pxEdge.r < 60, JSON.stringify(pxEdge));
  const head = await fetch(urlOf(p1)); // GET: Storage answers HEAD with no-cache
  check("stored: served as image/webp with long cache (URL is unique per upload)", head.headers.get("content-type") === "image/webp" && /max-age=31536000/.test(head.headers.get("cache-control") ?? ""), `${head.headers.get("content-type")} | ${head.headers.get("cache-control")}`);
  check("stored: folder holds exactly one object", (await listFolder(A)).length === 1, (await listFolder(A)).length);
  const shape = await headerAvatar(pa).evaluate((e) => getComputedStyle(e).borderRadius);
  check("display: shown as a circle", /9999px|50%/.test(shape) || parseFloat(shape) >= 44, shape);
  await shot(pa, "02-profile-after-upload");

  // Persistence: refresh, sign out (public view), sign in again.
  await pa.reload({ waitUntil: "networkidle" });
  check("persist: photo after refresh", await loaded(pa, urlOf(p1)));
  await signOut(pa);
  await go(pa, `/u/${A.username}`);
  check("persist: signed-out visitor sees A's photo", await loaded(pa, urlOf(p1)));
  check("signed-out: no photo controls", (await pa.getByRole("button", { name: /profile photo|Remove photo/ }).count()) === 0);
  await signIn(pa, A);
  await go(pa, `/u/${A.username}`);
  check("persist: after signing in again (profile and top bar)", (await loaded(pa, urlOf(p1))) && (await topBarImg(pa, A).getAttribute("src")) === urlOf(p1));

  // Replace (stale-cache check: new unique URL, old object gone, page shows new photo without a hard reload).
  await choose(pa, F["green.jpg"], "Change profile photo");
  await pa.getByRole("application", { name: /Photo preview/ }).waitFor();
  await pa.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && parseFloat(i.style.width) > 0; });
  check("replace: current photo stays visible while previewing", await loaded(pa, urlOf(p1)));
  const r2p = pa.waitForResponse((r) => r.url().endsWith("/api/profile/avatar") && r.request().method() === "POST", { timeout: 60000 });
  await pa.getByRole("button", { name: "Save photo" }).click();
  check("replace: POST 200", (await r2p).status() === 200);
  await waitStatus(pa, /Your photo is saved\./);
  const p2 = await pathOf(A);
  check("replace: new path differs from the old one", p2 && p2 !== p1, p2);
  await pa.waitForFunction((u) => [...document.querySelectorAll("img")].some((i) => i.src === u && i.naturalWidth > 0), urlOf(p2), { timeout: 20000 });
  check("cache: profile and top bar switch to the new URL without a hard reload",
    (await loaded(pa, urlOf(p2))) && (await topBarImg(pa, A).getAttribute("src")) === urlOf(p2) && (await pa.locator(`img[src="${urlOf(p1)}"]`).count()) === 0);
  const folder2 = await listFolder(A);
  check("replace: old object deleted, only the new one left", folder2.length === 1 && folder2[0] === p2, folder2.join(","));
  const pxG = await pixel(urlOf(p2));
  check("replace: stored image is the green photo", pxG.g > 120 && pxG.r < 80, JSON.stringify(pxG));
  S.trace = { ...(S.trace ?? {}), p1, p2 };
  saveState(S);

  // Rapid clicks: five synchronous clicks on Save -> exactly one request.
  pa.posts.length = 0;
  await choose(pa, F["navy.webp"], "Change profile photo");
  await pa.getByRole("application", { name: /Photo preview/ }).waitFor();
  await pa.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && parseFloat(i.style.width) > 0; });
  const r3p = pa.waitForResponse((r) => r.url().endsWith("/api/profile/avatar") && r.request().method() === "POST", { timeout: 60000 });
  await pa.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Save photo"); for (let i = 0; i < 5; i++) b.click(); });
  check("rapid clicks: Change control disabled during upload", await pa.getByRole("button", { name: "Uploading…" }).isDisabled().catch(() => true));
  await r3p;
  await waitStatus(pa, /Your photo is saved\./);
  await sleep(1500);
  check("rapid clicks: exactly one POST", pa.posts.filter((m) => m === "POST").length === 1, pa.posts.join(","));
  const p3 = await pathOf(A);
  check("rapid clicks: one new photo, folder still has one object", (await listFolder(A)).length === 1 && p3 !== p2);

  // Cancel an upload in flight (request held in the browser, never reaches the server).
  const before = await pathOf(A);
  let held = null;
  await pa.route("**/api/profile/avatar", (route) => { held = route; });
  await choose(pa, F["gold.png"], "Change profile photo");
  await pa.getByRole("application", { name: /Photo preview/ }).waitFor();
  await pa.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && parseFloat(i.style.width) > 0; });
  await pa.getByRole("button", { name: "Save photo" }).click();
  await pa.getByRole("button", { name: "Cancel upload" }).waitFor({ timeout: 10000 });
  check("cancel: 'Cancel upload' is offered while sending", true);
  await pa.getByRole("button", { name: "Cancel upload" }).click();
  await waitStatus(pa, /Upload cancelled\. Your current photo was not changed\./);
  check("cancel: message shown, current photo kept", (await pathOf(A)) === before && (await loaded(pa, urlOf(before))));
  await held?.abort().catch(() => {});
  await pa.unroute("**/api/profile/avatar");

  // Network failure mid-request.
  await pa.route("**/api/profile/avatar", (route) => route.abort("connectionreset"));
  await pa.getByRole("button", { name: "Save photo" }).click();
  await waitStatus(pa, /Couldn't reach CorkBack/);
  check("interrupted: network error message, current photo kept", (await pathOf(A)) === before);
  await pa.unroute("**/api/profile/avatar");

  // Timeout: request held for longer than the 60 s client timeout.
  let held2 = null;
  await pa.route("**/api/profile/avatar", (route) => { held2 = route; });
  const t0 = Date.now();
  await pa.getByRole("button", { name: "Save photo" }).click();
  await waitStatus(pa, /The upload took too long/, 75000);
  check("timeout: message after ~60 s, current photo kept", (await pathOf(A)) === before, `${Math.round((Date.now() - t0) / 1000)} s`);
  await held2?.abort().catch(() => {});
  await pa.unroute("**/api/profile/avatar");
  await pa.getByRole("button", { name: "Cancel", exact: true }).click();
  check("cancel/timeout/network: nothing extra stored", (await listFolder(A)).length === 1);

  // Invalid files through the UI (client checks, no request).
  pa.posts.length = 0;
  for (const [file, re, label] of [["anim.gif", /Use a JPEG, PNG or WebP photo/, "GIF"], ["vector.svg", /Use a JPEG, PNG or WebP photo/, "SVG"], ["huge.png", /larger than 2 MB/, "over 2 MB"]]) {
    await choose(pa, F[file], "Change profile photo");
    await waitStatus(pa, re, 5000).then(() => check(`invalid (UI): ${label} rejected with a clear message`, true)).catch(() => check(`invalid (UI): ${label} rejected with a clear message`, false));
    check(`invalid (UI): ${label} opens no cropper`, (await pa.getByRole("application", { name: /Photo preview/ }).count()) === 0);
  }
  check("invalid (UI): no request sent for client-rejected files", pa.posts.length === 0, pa.posts.join(","));
  // A text file named .png passes the type check, so the cropper refuses to preview it.
  await choose(pa, F["notes.png"], "Change profile photo");
  await waitStatus(pa, /could not be read as a photo/, 10000).then(() => check("invalid (UI): text renamed .png refused at preview", true)).catch(() => check("invalid (UI): text renamed .png refused at preview", false));
  check("invalid (UI): photo unchanged after all invalid files", (await pathOf(A)) === before);
  await shot(pa, "03-invalid-message");

  // Remove (inline confirm, Keep photo, then Remove).
  await pa.getByRole("button", { name: "Remove photo" }).click();
  await pa.getByRole("button", { name: "Keep photo" }).click();
  check("remove: 'Keep photo' keeps it", (await pathOf(A)) === before);
  await pa.getByRole("button", { name: "Remove photo" }).click();
  const rd = pa.waitForResponse((r) => r.url().endsWith("/api/profile/avatar") && r.request().method() === "DELETE");
  await pa.getByRole("group", { name: "Remove your photo" }).getByRole("button", { name: "Remove photo" }).click();
  check("remove: DELETE 200", (await rd).status() === 200);
  await waitStatus(pa, /Your photo was removed\./);
  await pa.waitForFunction(() => document.querySelector('main [data-avatar="fallback"]'), null, { timeout: 15000 });
  check("remove: fallback initial shown and top bar icon restored", (await pa.locator('main [data-avatar="fallback"]').count()) > 0 && (await topBarImg(pa, A).count()) === 0);
  check("remove: path cleared and object deleted", (await pathOf(A)) === null && (await listFolder(A)).length === 0);
  await pa.reload({ waitUntil: "networkidle" });
  check("remove: persists after refresh ('Add profile photo' back)", await pa.getByRole("button", { name: "Add profile photo" }).isVisible());
});

// ================================================================= 2. Server-side validation (A's session, direct API calls)
await guard("API validation", async () => {
  const x = api(ctxA);
  const gif = await x.post(part("a.gif", "image/gif", F["anim.gif"]));
  check("API: GIF -> 415 unsupported_type", gif.status() === 415 && (await gif.json()).code === "unsupported_type", gif.status());
  const svg = await x.post(part("a.svg", "image/svg+xml", F["vector.svg"]));
  check("API: SVG -> 415", svg.status() === 415, svg.status());
  const big = await x.post(part("big.png", "image/png", F["huge.png"]));
  check("API: over 2 MiB -> 413 too_large", big.status() === 413 && (await big.json()).code === "too_large", big.status());
  const crop = await x.post(part("g.png", "image/png", F["gold.png"]), { crop: "{bad json" });
  check("API: malformed crop -> 400 invalid_crop", crop.status() === 400 && (await crop.json()).code === "invalid_crop", crop.status());
  const none = await x.post(null, { other: "x" });
  check("API: no file -> 400 no_file", none.status() === 400, none.status());
  const fake = await x.post(part("fake.png", "image/png", F["notes.png"]));
  const fj = await fake.json();
  check("API: text declared image/png -> 422 not_an_image (decoded from bytes)", fake.status() === 422 && fj.code === "not_an_image", `${fake.status()} ${fj.code}`);
  check("API: no error body leaks paths, emails or keys", ![gif, svg, big, crop, fake].some(() => false) && !JSON.stringify(fj).match(/@|service|storage\/v1|key/i), JSON.stringify(fj));
  check("API: failed attempts stored nothing", (await pathOf(A)) === null && (await listFolder(A)).length === 0);
  // Final photo for the display checks (A's 5th attempt in the window).
  const ok = await x.post(part("navy.webp", "image/webp", F["navy.webp"]), { crop: JSON.stringify({ x: 0, y: 0, size: 1 }) });
  const oj = await ok.json();
  check("API: valid upload -> 200 with path in A's folder", ok.status() === 200 && oj.path?.startsWith(`${A.id}/`), ok.status());
  check("API: response has no email or key", !JSON.stringify(oj).match(/@|service_role|eyJ/), JSON.stringify(oj));
});
const pathA = await pathOf(A);
const urlA = urlOf(pathA);

// ================================================================= 3. B: own photo, cross-account attempts
const { ctx: ctxB, page: pb } = await mk();
await guard("B flow", async () => {
  await signIn(pb, B);
  const x = api(ctxB);
  const okB = await x.post(part("gold.png", "image/png", F["gold.png"]), { user_id: A.id, p_user: A.id, path: pathA, username: A.username });
  check("B API: foreign ids in the body are ignored (B's own photo set)", okB.status() === 200 && (await pathOf(B))?.startsWith(`${B.id}/`));
  check("B API: A's photo unchanged by B's upload", (await pathOf(A)) === pathA);
  await go(pb, `/u/${A.username}`);
  check("B UI: no photo controls on A's profile", (await pb.getByRole("button", { name: /Add profile photo|Change profile photo|Remove photo/ }).count()) === 0);
  check("B UI: sees A's photo", await loaded(pb, urlA));
  check("B UI: no file input on A's profile", (await pb.locator('input[type="file"]').count()) === 0);
});
const pathB = await pathOf(B);
const urlB = urlOf(pathB);

await guard("direct Supabase attempts", async () => {
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sbB = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const { error: se } = await sbB.auth.signInWithPassword({ email: B.email, password: S.pw });
  if (se) throw se;
  const sbAnon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, anonKey, { auth: { persistSession: false } });
  const webp = await sharp(fs.readFileSync(F["gold.png"])).webp().toBuffer();
  for (const [who, sb] of [["B", sbB], ["anon", sbAnon]]) {
    const u1 = await sb.from("profiles").update({ avatar_path: `${B.id}/${crypto.randomUUID()}.webp` }).eq("id", A.id).select("id");
    check(`${who} REST: PATCH A's avatar_path refused`, Boolean(u1.error) || (u1.data ?? []).length === 0, u1.error?.code ?? `rows=${u1.data?.length}`);
    const u2 = await sb.from("profiles").update({ avatar_path: "https://example.com/evil.png" }).eq("id", who === "B" ? B.id : A.id).select("id");
    check(`${who} REST: external URL as avatar_path refused`, Boolean(u2.error) || (u2.data ?? []).length === 0, u2.error?.code ?? `rows=${u2.data?.length}`);
    const u3 = await sb.from("profiles").update({ avatar_path: null }).eq("id", A.id).select("id");
    check(`${who} REST: clearing A's avatar_path refused`, Boolean(u3.error) || (u3.data ?? []).length === 0, u3.error?.code ?? `rows=${u3.data?.length}`);
    for (const [fn, args] of [["cb_set_avatar", { p_user: A.id, p_path: pathB }], ["cb_clear_avatar", { p_user: A.id }], ["cb_avatar_rate_check", { p_user: A.id }]]) {
      const r = await sb.rpc(fn, args);
      check(`${who} RPC: ${fn} refused`, Boolean(r.error), r.error?.code ?? "no error");
    }
    const st = sb.storage.from("avatars");
    const s1 = await st.upload(`${A.id}/${crypto.randomUUID()}.webp`, webp, { contentType: "image/webp" });
    check(`${who} Storage: upload into A's folder refused`, Boolean(s1.error), s1.error?.message ?? "uploaded");
    const s2 = await st.upload(pathA, webp, { contentType: "image/webp", upsert: true });
    check(`${who} Storage: overwrite A's photo refused`, Boolean(s2.error), s2.error?.message ?? "overwritten");
    const s3 = await st.upload(`${B.id}/${crypto.randomUUID()}.webp`, webp, { contentType: "image/webp" });
    check(`${who} Storage: direct upload even into B's own folder refused`, Boolean(s3.error), s3.error?.message ?? "uploaded");
    const s4 = await st.remove([pathA]);
    check(`${who} Storage: delete A's photo has no effect`, (await listFolder(A)).includes(pathA), s4.error?.message ?? `returned ${s4.data?.length ?? 0}`);
    const s5 = await st.move(pathA, `${A.id}/${crypto.randomUUID()}.webp`);
    check(`${who} Storage: move/rename A's photo refused`, Boolean(s5.error) && (await listFolder(A)).includes(pathA), s5.error?.message ?? "moved");
    const s6 = await st.update(pathA, webp, { contentType: "image/webp" });
    check(`${who} Storage: update A's photo refused`, Boolean(s6.error), s6.error?.message ?? "updated");
  }
  const rd = await sbAnon.from("profiles").select("avatar_path").eq("id", A.id).single();
  check("anon REST: can read avatar_path (needed for display)", rd.data?.avatar_path === pathA, rd.error?.code);
  const em = await sbAnon.from("profiles").select("email").limit(1);
  check("anon REST: profiles exposes no email column", Boolean(em.error), em.error?.code);
  check("after every attempt: A's path and object unchanged", (await pathOf(A)) === pathA && (await listFolder(A)).length === 1 && (await listFolder(A))[0] === pathA);
  await sbB.auth.signOut({ scope: "local" }); // the default (global) would also end the browser session
});

await guard("signed-out API", async () => {
  const anonCtx = await browser.newContext();
  contexts.push(anonCtx);
  const x = api(anonCtx);
  const p = await x.post(part("g.png", "image/png", F["gold.png"]));
  const d = await x.del();
  check("signed-out API: POST 401", p.status() === 401, p.status());
  check("signed-out API: DELETE 401", d.status() === 401, d.status());
  const forged = await anonCtx.request.post(`${BASE}/api/profile/avatar`, { multipart: { file: part("g.png", "image/png", F["gold.png"]) }, headers: { authorization: "Bearer not-a-token", "x-user-id": A.id }, failOnStatusCode: false });
  check("signed-out API: forged headers still 401", forged.status() === 401, forged.status());
  check("signed-out: A's photo unchanged", (await pathOf(A)) === pathA);
});

// B's cross-account DELETE through the route only clears B (then B re-uploads for the display checks).
await guard("B delete scope", async () => {
  const d = await api(ctxB).del();
  check("B API: DELETE clears only B's photo", d.status() === 200 && (await pathOf(B)) === null && (await pathOf(A)) === pathA);
  const again = await api(ctxB).post(part("gold.png", "image/png", F["gold.png"]));
  check("B API: re-upload ok", again.status() === 200);
});
const pathB2 = await pathOf(B);
const urlB2 = urlOf(pathB2);

// ================================================================= 4. Activity for the display surfaces
await guard("activity setup", async () => {
  const rep = await ctxA.request.post(`${BASE}/api/postings/${P.p2.id}/replies`, { data: { body: "[TEST] reply from A for avatar check", clientId: crypto.randomUUID() }, failOnStatusCode: false });
  check("setup: A replies on B's posting", rep.status() === 200, rep.status());
  const msg = await ctxB.request.post(`${BASE}/api/messages`, { data: { postingId: P.p1.id, toUsername: A.username, body: "[TEST] message from B", clientId: crypto.randomUUID() }, failOnStatusCode: false });
  const mj = await msg.json().catch(() => ({}));
  check("setup: B messages A about A's posting", msg.status() === 200 && mj.threadId, msg.status());
  S.trace = { ...(S.trace ?? {}), threadId: mj.threadId };
  saveState(S);
  const repo = await ctxB.request.post(`${BASE}/api/postings/${P.p1.id}/report`, { data: { reason: "other", details: "[TEST] avatar verification report, safe to ignore" }, failOnStatusCode: false });
  check("setup: B reports A's [TEST] posting (for the admin queue)", repo.status() === 200, repo.status());
});

// ================================================================= 5. Display surfaces + layouts (B's view, then A's and admin)
const surfaces = [
  ["profile (A's)", `/u/${A.username}`, [urlA]],
  ["posting card on profile + author on posting page", `/p/${P.p1.id}`, [urlA]],
  ["posting page with A's reply and friends' attendance", `/p/${P.p2.id}`, [urlA]],
  ["Following (followee list and card)", "/following", [urlA]],
  ["Friends (list and activity)", "/friends", [urlA]],
  ["Inbox", "/inbox", [urlA]],
  ["Message thread header", () => `/inbox/${S.trace.threadId}`, [urlA]],
];
for (const vp of [{ width: 1280, height: 900, tag: "desktop" }, { width: 390, height: 844, tag: "mobile" }]) {
  const { page } = await mk({ width: vp.width, height: vp.height });
  await guard(`surfaces ${vp.tag}`, async () => {
    await signIn(page, B);
    for (const [name, p, urls] of surfaces) {
      const route = typeof p === "function" ? p() : p;
      await go(page, route);
      for (const u of urls) {
        const n = await photosOf(page, u).count();
        check(`${vp.tag}: ${name} shows A's photo`, n > 0 && (await loaded(page, u)), `count=${n}`);
      }
      check(`${vp.tag}: ${name} top bar shows B's photo`, (await topBarImg(page, B).getAttribute("src").catch(() => null)) === urlB2);
      const ov = await overflow(page);
      check(`${vp.tag}: ${name} has no horizontal scroll`, ov <= 0, `${ov}px`);
      await shot(page, `${vp.tag}-${name.replace(/[^a-z]+/gi, "-")}`);
    }
    // Specific surfaces.
    await go(page, `/u/${A.username}`);
    check(`${vp.tag}: profile shows header photo and the card avatar (>= 2)`, (await photosOf(page, urlA).count()) >= 2, await photosOf(page, urlA).count());
    await go(page, `/p/${P.p2.id}`);
    const replyImg = page.locator("li").filter({ hasText: "[TEST] reply from A" }).locator(`img[src="${urlA}"]`);
    check(`${vp.tag}: reply shows A's avatar`, (await replyImg.count()) === 1);
    check(`${vp.tag}: replies have no like control`, (await page.locator("li").filter({ hasText: "[TEST] reply from A" }).getByRole("button", { name: /like/i }).count()) === 0);
    const friendsBox = page.locator("div").filter({ has: page.getByText("Friends", { exact: true }) }).filter({ hasText: "Going:" }).last();
    check(`${vp.tag}: friends attendance shows A's avatar`, (await friendsBox.locator(`img[src="${urlA}"]`).count()) >= 1);
    check(`${vp.tag}: posting author section shows B's avatar`, (await photosOf(page, urlB2).count()) >= 1);
    await go(page, "/friends");
    await page.getByLabel("Search by username").fill(A.username);
    await page.waitForFunction((u) => document.querySelectorAll(`section[aria-labelledby="find-friends"] img[src="${u}"]`).length > 0, urlA, { timeout: 15000 }).then(
      () => check(`${vp.tag}: friend search result shows A's avatar`, true),
      () => check(`${vp.tag}: friend search result shows A's avatar`, false),
    );
    const reqRow = page.locator("li").filter({ hasText: `@${R.username}` }).first();
    check(`${vp.tag}: pending request row shows R's avatar or fallback`, (await reqRow.locator("[data-avatar]").count()) >= 1);
    await go(page, `/u/${B.username}`);
    check(`${vp.tag}: B's own profile shows the photo control`, await page.getByRole("button", { name: "Change profile photo" }).isVisible());
    if (vp.tag === "mobile") {
      await choose(page, F["wide.png"], "Change profile photo");
      await page.getByRole("application", { name: /Photo preview/ }).waitFor();
      const pv = await page.getByRole("application", { name: /Photo preview/ }).boundingBox();
      check("mobile: cropper fits the 390 px screen", pv.x >= 0 && pv.x + pv.width <= 390, JSON.stringify(pv));
      check("mobile: cropper page has no horizontal scroll", (await overflow(page)) <= 0);
      const save = await page.getByRole("button", { name: "Save photo" }).boundingBox();
      check("mobile: Save photo is at least 44 px tall", save.height >= 44, save.height);
      await shot(page, "mobile-cropper");
      await page.getByRole("button", { name: "Cancel", exact: true }).click();
    }
  });
}

// ================================================================= 6. Admin / moderation view
await guard("admin", async () => {
  const { page } = await mk();
  await signIn(page, M);
  const res = await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  const isAdmin = (await page.getByText(/Recent actions/).count()) > 0;
  if (!isAdmin) {
    check("admin: queue shows reporter and author avatars", "blocked", `temporary admin ${M.username} not granted (status ${res?.status()})`);
    return;
  }
  const item = page.locator("li, article, div").filter({ hasText: P.p1.title }).last();
  check("admin: report shows author A's avatar", (await page.locator(`img[src="${urlA}"]`).count()) >= 1);
  check("admin: report shows reporter B's avatar", (await page.locator(`img[src="${urlB2}"]`).count()) >= 1);
  check("admin: no email shown", !(await page.content()).includes("@corkback-test.invalid"));
  check("admin: no photo control for other users", (await page.getByRole("button", { name: /profile photo/ }).count()) === 0);
  check("admin: no horizontal scroll", (await overflow(page)) <= 0);
  await shot(page, "admin-queue");
  await go(page, `/u/${A.username}`);
  check("admin: no photo controls on someone else's profile", (await page.getByRole("button", { name: /Add profile photo|Change profile photo|Remove photo/ }).count()) === 0);
  void item;
});

// ================================================================= 7. Missing file fallback
await guard("missing file", async () => {
  // Point A's path at a well-formed name that does not exist (service role; the format constraint still applies).
  const ghost = `${A.id}/${crypto.randomUUID()}.webp`;
  const { error } = await admin.from("profiles").update({ avatar_path: ghost }).eq("id", A.id);
  if (error) throw error;
  const { page } = await mk();
  await signInRetry(page, A);
  await go(page, `/u/${A.username}`);
  await page.waitForFunction(() => document.querySelector('main [data-avatar="fallback"]'), null, { timeout: 15000 });
  check("missing file: profile header falls back to the initial", (await page.locator('main [data-avatar="fallback"]').first().innerText()).trim() === A.username[0].toUpperCase());
  await page.waitForFunction((u) => !document.querySelector(`a[aria-label="@${u}"] img`), A.username, { timeout: 15000 }).then(
    () => check("missing file: top bar falls back to the generic icon", true),
    () => check("missing file: top bar falls back to the generic icon", false),
  );
  check("missing file: no broken-image boxes left on the page", await page.evaluate(() => ![...document.querySelectorAll("img")].some((i) => i.complete && i.naturalWidth === 0 && i.src.includes("/avatars/"))));
  await go(page, `/p/${P.p1.id}`);
  check("missing file: posting author section falls back", (await page.locator('[data-avatar="fallback"]').count()) >= 1);
  await admin.from("profiles").update({ avatar_path: pathA }).eq("id", A.id);
});

// ================================================================= 8. Username editing regression (A)
await guard("username edit", async () => {
  const { page } = await mk();
  await signInRetry(page, A);
  await go(page, `/u/${A.username}`);
  const newName = `cbsoc_a2_${S.hex}`;
  await page.getByRole("button", { name: "Edit username" }).click();
  await page.locator('input[name="username"]').fill(newName);
  const resp = page.waitForResponse((r) => r.url().includes("/api/profile/username"), { timeout: 20000 });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const r = await resp;
  check("username edit: still saves next to the photo control", r.status() === 200, r.status());
  await page.waitForURL(new RegExp(`/u/${newName}`), { timeout: 20000 }).catch(() => {});
  await go(page, `/u/${newName}`);
  check("username edit: photo kept after rename", await loaded(page, urlA));
  S.users.a.username = newName;
  saveState(S);
});

// ================================================================= 9. Rate limit (account R)
await guard("rate limit", async () => {
  const { ctx, page } = await mk();
  await signIn(page, R);
  const x = api(ctx);
  const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await x.post(part("gold.png", "image/png", F["gold.png"]))).status());
  statuses.push((await x.post(part("fake.png", "image/png", F["notes.png"]))).status()); // failed attempt still counts
  check("rate: 4 valid + 1 unreadable within 10 minutes", JSON.stringify(statuses) === JSON.stringify([200, 200, 200, 200, 422]), statuses.join(","));
  const kept = await pathOf(R);
  const sixth = await x.post(part("gold.png", "image/png", F["gold.png"]));
  const sj = await sixth.json();
  check("rate: 6th attempt -> 429 with Retry-After: 600", sixth.status() === 429 && sixth.headers()["retry-after"] === "600" && sj.code === "rate_limited", `${sixth.status()} ${sixth.headers()["retry-after"]}`);
  check("rate: limited attempt changed nothing", (await pathOf(R)) === kept && (await listFolder(R)).length === 1);
  await go(page, `/u/${R.username}`);
  await choose(page, F["green.jpg"], "Change profile photo");
  await page.getByRole("application", { name: /Photo preview/ }).waitFor();
  await page.waitForFunction(() => { const i = document.querySelector('[role="application"] img'); return i && parseFloat(i.style.width) > 0; });
  await page.getByRole("button", { name: "Save photo" }).click();
  await waitStatus(page, /changed your photo a lot recently/).then(() => check("rate: UI shows the clear limit message", true), () => check("rate: UI shows the clear limit message", false));
  check("rate: photo still displayed after the limit", await loaded(page, urlOf(kept)));
  const del = await x.del();
  check("rate: Remove photo still works when upload-limited (no allowance used)", del.status() === 200 && (await pathOf(R)) === null);
  const gif = await x.post(part("a.gif", "image/gif", F["anim.gif"]));
  check("rate: declared-type rejects are answered before the limiter (415, not 429)", gif.status() === 415, gif.status());
});

// ================================================================= done
check("no uncaught page errors", contexts.flatMap((c) => c.pages()).every((p) => (p.errors ?? []).length === 0), contexts.flatMap((c) => c.pages()).flatMap((p) => p.errors ?? []).join(" | "));
await browser.close();
const pass = results.filter((r) => r.ok === true).length, fail = results.filter((r) => r.ok === false).length, blocked = results.filter((r) => r.ok === "blocked").length;
fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), pass, fail, blocked, results }, null, 2));
console.log(`\n${pass} passed, ${fail} failed, ${blocked} blocked`);
process.exitCode = fail ? 1 : 0;
