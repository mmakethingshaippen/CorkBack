import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { admin, loadState, WORK } from "./lib.mjs";

const BASE = process.env.CB_BASE_URL ?? "http://localhost:3100";
const S = loadState();
const { a, b } = S.users;
const P = S.postings;
const SHOTS = path.join(WORK, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, extra = "") {
  results.push({ name, ok: Boolean(ok), extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
}

const browser = await chromium.launch({ channel: "msedge", headless: true });
const mk = async (viewport = { width: 1280, height: 900 }) => {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const reqs = [];
  page.on("request", (r) => {
    if (r.method() === "PUT" && /\/api\/postings\/[^/]+\/(like|plan)/.test(r.url())) reqs.push(r.url().split("/api/postings/")[1] + " " + r.postData());
  });
  page.reqs = reqs;
  return { ctx, page };
};

async function signIn(page, who) {
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel("Email address").fill(who.email);
  await page.getByLabel("Password").fill(S.pw);
  await Promise.all([page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 20000 }), page.getByRole("button", { name: "Sign in", exact: true }).click()]);
}
async function signOut(page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("Sign out"), null, { timeout: 15000 });
}

const card = (page, title) => page.locator("h3", { hasText: title }).locator('xpath=ancestor::div[contains(@class,"rounded-card")][1]');
const likeBtn = (c) => c.getByRole("button", { name: /^(Like|Unlike) this posting\./ });
const goBtn = (c) => c.getByRole("button", { name: /^(Mark|Clear) Going\./ });
const intBtn = (c) => c.getByRole("button", { name: /^(Mark|Clear) Interested\./ });
const num = async (btn) => Number((await btn.getAttribute("aria-label")).match(/(\d+) /)[1]);
async function st(c) {
  return {
    like: (await likeBtn(c).getAttribute("aria-pressed")) === "true",
    going: (await goBtn(c).getAttribute("aria-pressed")) === "true",
    int: (await intBtn(c).getAttribute("aria-pressed")) === "true",
    nl: await num(likeBtn(c)),
    ng: await num(goBtn(c)),
    ni: await num(intBtn(c)),
  };
}
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);
async function click(page, id, btn) {
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes(`/api/postings/${id}/`) && r.request().method() === "PUT", { timeout: 15000 }),
    btn.click(),
  ]);
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 5000 }).catch(() => {});
  return res.status();
}
async function planRows(pid, uid) {
  const { data } = await admin.from("plans").select("kind").eq("posting_id", pid).eq("user_id", uid);
  return data ?? [];
}
async function likeRows(pid, uid) {
  const { data } = await admin.from("likes").select("posting_id").eq("posting_id", pid).eq("user_id", uid);
  return data ?? [];
}

const A = await mk();
const B = await mk();
const ANON = await mk();
try {
  await signIn(A.page, a);
  await signIn(B.page, b);

  // ---- 1. React from cards on each surface, no navigation ----
  const surfaces = [
    ["home", `${BASE}/`, P.p2],
    ["following", `${BASE}/following`, P.p2],
    ["profile", `${BASE}/u/${b.username}`, P.p2],
  ];
  for (const [name, url, p] of surfaces) {
    await A.page.goto(url);
    const c = card(A.page, p.title);
    await c.waitFor({ timeout: 20000 });
    const before = A.page.url();
    const s0 = await st(c);
    const code = await click(A.page, p.id, goBtn(c));
    const s1 = await st(c);
    check(`[${name}] Going from card: 200, no navigation, pressed, count +1`, code === 200 && A.page.url() === before && s1.going && s1.ng === s0.ng + 1, `${s0.ng}->${s1.ng} url=${new URL(A.page.url()).pathname}`);
    const rows = await planRows(p.id, a.id);
    check(`[${name}] DB row going`, rows.length === 1 && rows[0].kind === "going");
    await click(A.page, p.id, goBtn(c));
    check(`[${name}] retap clears (no row)`, (await planRows(p.id, a.id)).length === 0 && !(await st(c)).going);
    await click(A.page, p.id, likeBtn(c));
    check(`[${name}] Like from card persists`, (await likeRows(p.id, a.id)).length === 1 && (await st(c)).like && A.page.url() === before);
    await click(A.page, p.id, likeBtn(c));
    check(`[${name}] Unlike clears row`, (await likeRows(p.id, a.id)).length === 0);
  }

  // ---- 2. Persist across refresh and sign-out/sign-in ----
  await A.page.goto(`${BASE}/`);
  let c = card(A.page, P.p2.title);
  await click(A.page, P.p2.id, likeBtn(c));
  await click(A.page, P.p2.id, intBtn(c));
  let s = await st(c);
  check("home: Like + Interested set", s.like && s.int && !s.going && s.nl === 1 && s.ni === 1, JSON.stringify(s));
  await A.page.reload();
  c = card(A.page, P.p2.title);
  check("persists after refresh", eq(await st(c), s), JSON.stringify(await st(c)));
  await signOut(A.page);
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p2.title);
  check("signed out: totals visible, no react buttons", (await c.getByText("Sign in to react").count()) === 1 && (await c.getByRole("button").count()) === 0 && /1 interested/.test(await c.innerText()), (await c.innerText()).replace(/\n/g, " | "));
  await Promise.all([A.page.waitForURL(/\/sign-in/), c.getByText("Sign in to react").click()]);
  check("signed-out prompt goes to /sign-in", true);
  await signIn(A.page, a);
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p2.title);
  check("persists after sign-out + sign-in", eq(await st(c), s), JSON.stringify(await st(c)));

  // ---- 3. Detail page matches; change there; card matches after reload ----
  await A.page.goto(`${BASE}/p/${P.p2.id}`);
  const dLike = A.page.getByRole("button", { name: /^Unlike this posting\. 1 like$/ });
  const dInt = A.page.getByRole("button", { name: /^Interested\. 1 interested$/ });
  check("detail shows same selection+counts", (await dLike.getAttribute("aria-pressed")) === "true" && (await dInt.getAttribute("aria-pressed")) === "true");
  await Promise.all([A.page.waitForResponse((r) => r.url().includes(`/${P.p2.id}/plan`)), A.page.getByRole("button", { name: /^Going\./ }).click()]);
  check("detail: switch to Going (exclusive)", (await planRows(P.p2.id, a.id))[0]?.kind === "going");
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p2.title);
  s = await st(c);
  check("card matches detail change after reload", s.going && !s.int && s.ng === 1 && s.ni === 0 && s.like, JSON.stringify(s));
  await c.getByRole("link", { name: P.p2.title }).click();
  await A.page.waitForURL(/\/p\//);
  await Promise.all([A.page.waitForResponse((r) => r.url().includes(`/${P.p2.id}/plan`)), A.page.getByRole("button", { name: /^Interested\./ }).click()]);
  await A.page.goBack();
  await A.page.waitForURL(`${BASE}/`);
  c = card(A.page, P.p2.title);
  await c.waitFor();
  s = await st(c);
  check("goBack shows detail's change (no stale cached card)", s.int && !s.going && s.ni === 1 && s.ng === 0, JSON.stringify(s));

  // ---- 4. Second account: totals vs own selection ----
  await B.page.goto(`${BASE}/`);
  let cb = card(B.page, P.p2.title);
  const sb0 = await st(cb);
  check("B sees A's totals but not A's selection", !sb0.like && !sb0.going && !sb0.int && sb0.nl === 1 && sb0.ni === 1, JSON.stringify(sb0));
  await click(B.page, P.p2.id, goBtn(cb));
  await click(B.page, P.p2.id, likeBtn(cb));
  const sb1 = await st(cb);
  check("B reacts: own selection, totals include A", sb1.going && sb1.like && sb1.ng === 1 && sb1.ni === 1 && sb1.nl === 2, JSON.stringify(sb1));
  await A.page.reload();
  c = card(A.page, P.p2.title);
  s = await st(c);
  check("A after reload: totals include B, A's own state unchanged", s.int && !s.going && s.like && s.ng === 1 && s.ni === 1 && s.nl === 2, JSON.stringify(s));
  await B.page.reload();
  cb = card(B.page, P.p2.title);
  check("B own selection persisted", eq(await st(cb), sb1));

  // ---- 5. Switch Going -> Interested -> cleared; rapid taps; failures ----
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p1.title);
  await click(A.page, P.p1.id, goBtn(c));
  const r1 = (await planRows(P.p1.id, a.id)).map((r) => r.kind);
  await click(A.page, P.p1.id, intBtn(c));
  const r2 = (await planRows(P.p1.id, a.id)).map((r) => r.kind);
  s = await st(c);
  check("Going -> Interested: one row, exclusive, counts move", eq(r1, ["going"]) && eq(r2, ["interested"]) && !s.going && s.int && s.ng === 0 && s.ni === 1, JSON.stringify({ r1, r2, s }));
  await click(A.page, P.p1.id, intBtn(c));
  s = await st(c);
  check("Interested again -> cleared, no row", (await planRows(P.p1.id, a.id)).length === 0 && !s.int && s.ni === 0);

  // Rapid taps: dispatch 6 clicks synchronously (Playwright's own clicks are queued, not rapid).
  A.page.reqs.length = 0;
  await A.page.evaluate((title) => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.includes(title));
    const btn = [...h.closest(".rounded-card").querySelectorAll("button")].find((x) => /Going/.test(x.getAttribute("aria-label")));
    for (let i = 0; i < 6; i++) btn.click();
  }, P.p1.title);
  await A.page.waitForTimeout(2500);
  const rows = await planRows(P.p1.id, a.id);
  s = await st(c);
  check("rapid taps (6 sync clicks): exactly 1 request", A.page.reqs.length === 1, JSON.stringify(A.page.reqs));
  check("rapid taps: <=1 row, UI agrees with DB", rows.length === 1 && s.going && s.ng === 1, JSON.stringify({ rows, s }));
  A.page.reqs.length = 0;
  await A.page.evaluate((title) => {
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.includes(title));
    const btn = [...h.closest(".rounded-card").querySelectorAll("button")].find((x) => /this posting/.test(x.getAttribute("aria-label")));
    for (let i = 0; i < 6; i++) btn.click();
  }, P.p1.title);
  await A.page.waitForTimeout(2500);
  check("rapid like taps: 1 request, <=1 row", A.page.reqs.length === 1 && (await likeRows(P.p1.id, a.id)).length <= 1, `${A.page.reqs.length} reqs`);
  await click(A.page, P.p1.id, likeBtn(c));
  await click(A.page, P.p1.id, goBtn(c));
  check("state cleaned for failure tests", (await planRows(P.p1.id, a.id)).length === 0 && (await likeRows(P.p1.id, a.id)).length === 0);

  for (const mode of ["abort", "500"]) {
    await A.page.route(`**/api/postings/${P.p1.id}/plan`, (route) => (mode === "abort" ? route.abort() : route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Could not save. Try again.", code: "write_failed" }) })));
    const before = await st(c);
    await goBtn(c).click();
    const alert = c.getByRole("alert");
    await alert.waitFor({ timeout: 8000 });
    const after = await st(c);
    check(`failed save (${mode}): rolled back + clear message`, eq(before, after) && (await alert.innerText()).length > 10 && (await planRows(P.p1.id, a.id)).length === 0, `${(await alert.innerText()).trim()}`);
    await A.page.unroute(`**/api/postings/${P.p1.id}/plan`);
    await click(A.page, P.p1.id, goBtn(c));
    check(`after ${mode}: next tap works, message gone`, (await c.getByRole("alert").count()) === 0 && (await planRows(P.p1.id, a.id)).length === 1);
    await click(A.page, P.p1.id, goBtn(c));
  }

  // ---- 6. Ended / hidden while the page is open ----
  await A.page.goto(`${BASE}/`);
  const c3 = card(A.page, P.p3.title);
  const c4 = card(A.page, P.p4.title);
  await c3.waitFor();
  await c4.waitFor();
  await admin.from("postings").update({ expires_at: new Date(Date.now() - 60000).toISOString() }).eq("id", P.p3.id);
  await admin.from("postings").update({ moderation_hidden_at: new Date().toISOString() }).eq("id", P.p4.id);
  const code3 = await click(A.page, P.p3.id, goBtn(c3));
  const msg3 = (await c3.getByRole("alert").innerText()).trim();
  check("ended posting: 409, message, no row, control closed", code3 === 409 && /ended/i.test(msg3) && (await planRows(P.p3.id, a.id)).length === 0 && !(await st(c3)).going && (await goBtn(c3).getAttribute("aria-disabled")) === "true", msg3);
  const code4 = await click(A.page, P.p4.id, likeBtn(c4));
  const msg4 = (await c4.getByRole("alert").innerText()).trim();
  check("moderator-hidden posting: 404, message, no row", code4 === 404 && /no longer available/i.test(msg4) && (await likeRows(P.p4.id, a.id)).length === 0 && !(await st(c4)).like, msg4);
  A.page.reqs.length = 0;
  await goBtn(c3).click().catch(() => {});
  check("closed control sends no more requests", A.page.reqs.length === 0);
  await A.page.reload();
  check("ended + hidden postings gone from feeds", (await card(A.page, P.p3.title).count()) === 0 && (await card(A.page, P.p4.title).count()) === 0);
  await A.page.goto(`${BASE}/following`);
  check("ended + hidden gone from Following", (await card(A.page, P.p3.title).count()) === 0 && (await card(A.page, P.p4.title).count()) === 0 && (await card(A.page, P.p2.title).count()) === 1);
  await A.page.goto(`${BASE}/u/${b.username}`);
  check("ended + hidden gone from profile", (await card(A.page, P.p3.title).count()) === 0 && (await card(A.page, P.p4.title).count()) === 0);
  await A.page.goto(`${BASE}/p/${P.p3.id}`);
  check("ended detail: final counts, no react controls", (await A.page.getByText("Final count:").count()) === 1 && (await A.page.getByRole("button", { name: /^(Mark|Clear|Going|Interested|Like|Unlike)/ }).count()) === 0);
  const r4 = await A.page.goto(`${BASE}/p/${P.p4.id}`);
  check("hidden detail: not available to others", r4.status() === 404 || (await A.page.getByText(/not found|isn.t available|no longer/i).count()) > 0, `status ${r4.status()}`);

  // ---- 7. Signed-out visitor ----
  await ANON.page.goto(`${BASE}/`);
  const ca = card(ANON.page, P.p2.title);
  await ca.waitFor();
  check("anon: totals visible, sign-in prompt, zero buttons", /1 going|2 going/.test(await ca.innerText()) && (await ca.getByRole("button").count()) === 0 && (await ca.getByRole("link", { name: "Sign in to react" }).count()) === 1);
  const rc = await ANON.page.request.put(`${BASE}/api/postings/${P.p2.id}/plan`, { data: { kind: "going" } });
  check("anon API write refused (401)", rc.status() === 401);

  // ---- 8. Keyboard, open area, focus ring ----
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p1.title);
  const url0 = A.page.url();
  await goBtn(c).focus();
  await Promise.all([A.page.waitForResponse((r) => r.url().includes(`/${P.p1.id}/plan`)), A.page.keyboard.press("Enter")]);
  check("keyboard Enter on Going: reacts, no navigation", (await st(c)).going && A.page.url() === url0);
  await A.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await Promise.all([A.page.waitForResponse((r) => r.url().includes(`/${P.p1.id}/plan`)), A.page.keyboard.press("Space")]);
  check("keyboard Space on Going: clears, no navigation", !(await st(c)).going && A.page.url() === url0 && (await planRows(P.p1.id, a.id)).length === 0);
  await A.page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
  await c.getByRole("link", { name: P.p1.title }).focus();
  const order = [];
  for (let i = 0; i < 5; i++) {
    order.push(await A.page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 30)));
    await A.page.keyboard.press("Tab");
  }
  console.log("   tab order:", JSON.stringify(order));
  check("tab order: title, handle, Like, Going, Interested", order.length === 5 && /\[TEST\]/.test(order[0]) && /^@/.test(order[1]) && /this posting/.test(order[2]) && /Going/.test(order[3]) && /Interested/.test(order[4]));
  await A.page.keyboard.press("Shift+Tab");
  const ring = await A.page.evaluate(() => getComputedStyle(document.activeElement).boxShadow);
  check("focus indicator visible on keyboard focus (ring)", ring && ring !== "none", ring.slice(0, 60));
  await c.getByRole("link", { name: P.p1.title }).focus();
  await Promise.all([A.page.waitForURL(/\/p\//), A.page.keyboard.press("Enter")]);
  check("title link opens posting with Enter", A.page.url().includes(P.p1.id));
  // Open area: a real mouse click on the date line (the stretched link sits under it).
  await A.page.goto(`${BASE}/`);
  c = card(A.page, P.p1.title);
  await c.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await A.page.waitForTimeout(300);
  const bb = await c.locator("p").first().boundingBox();
  await Promise.all([A.page.waitForURL(/\/p\//), A.page.mouse.click(bb.x + 20, bb.y + bb.height / 2)]);
  check("clicking the card's open area opens the posting", A.page.url().includes(P.p1.id));

  // ---- 9. Layouts ----
  for (const [label, vp] of [["390", { width: 390, height: 844 }], ["1280", { width: 1280, height: 900 }]]) {
    const L = await mk(vp);
    await signIn(L.page, a);
    for (const [name, p] of [["home", "/"], ["following", "/following"], ["profile", `/u/${b.username}`]]) {
      await L.page.goto(`${BASE}${p}`);
      const cc = card(L.page, P.p2.title);
      await cc.waitFor({ timeout: 20000 });
      const m = await L.page.evaluate((title) => {
        const h = [...document.querySelectorAll("h3")].find((x) => x.textContent.includes(title));
        const cardEl = h.closest(".rounded-card");
        const cr = cardEl.getBoundingClientRect();
        const btns = [...cardEl.querySelectorAll("button")].map((x) => {
          const r = x.getBoundingClientRect();
          return { w: Math.round(r.width), h: Math.round(r.height), inside: r.left >= cr.left - 12 && r.right <= cr.right + 12 };
        });
        return { btns, hs: document.documentElement.scrollWidth > document.documentElement.clientWidth, cardW: Math.round(cr.width) };
      }, P.p2.title);
      check(`${label}px ${name}: 3 buttons >=44px, inside card, no horizontal scroll`, m.btns.length === 3 && m.btns.every((x) => x.h >= 44 && x.w >= 44 && x.inside) && !m.hs, JSON.stringify(m));
      await L.page.screenshot({ path: path.join(SHOTS, `${label}-${name}.png`) });
    }
    await L.ctx.close();
  }
} catch (e) {
  console.log("HARNESS ERROR", e.stack);
  check("harness completed without error", false, String(e.message).slice(0, 200));
} finally {
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  failed.forEach((f) => console.log("FAILED:", f.name, f.extra));
  fs.writeFileSync(path.join(WORK, "results.json"), JSON.stringify(results, null, 1));
}
