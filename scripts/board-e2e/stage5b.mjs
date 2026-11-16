// Stage 5b browser checks (Requirements 18.1, 18.8, 18.9, 18.10, 18.11, 18.12): unread badge in the bottom nav,
// inbox markers and mark-read on /inbox/[id]. Both viewports. NOTHING IS SENT and no real account or database is used.
//
// Data sources (all local):
//  - /inbox and /inbox/[id] are server-rendered and need a signed-in viewer. As stage3.mjs and stage5a.mjs do, the
//    scratch build points NEXT_PUBLIC_SUPABASE_URL at a tiny mock Supabase started HERE (127.0.0.1:CB_MOCK_PORT,
//    default 3299) that serves a fake session, a thread row and two profile rows. See README, "Stage 5b".
//  - In the browser ONLY these are mocked: GET /api/messages/unread (ok | supported:false | 401 | 500),
//    POST /api/messages/read (records the body, answers 200), plus the page data the screens need
//    (GET /api/messages/threads and GET /api/messages, answered from in-memory fixtures).
//  - POST /api/messages and /api/messages/reply are intercepted: the script FAILS if either is ever called.
//  - Time: page.clock (Playwright 1.45+) is installed so minutes of polling run in seconds. Every unread, read and
//    poll request is stamped with the page's (virtual) Date.now() by a fetch wrapper, so gaps are virtual time.
import http from "node:http";
import { startServer, launchEdge, newPage, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS, DARK_RED_RGB } from "./lib.mjs";

const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
const MOCK_PORT = Number(process.env.CB_MOCK_PORT ?? 3299);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.CB_ONLY ? new Set(process.env.CB_ONLY.split(",")) : null;

// ---------------------------------------------------------------- mock Supabase (server-side reads only)
const ME = "fx_me";
const OTHER = "fx_other";
const ME_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_ID = "00000000-0000-4000-8000-000000000002";
const THREAD_ID = "00000000-0000-4000-8000-0000000a0001";
const b64url = (s) => Buffer.from(s).toString("base64url");
const FAKE_JWT = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: ME_ID, role: "authenticated", exp: 4102444800 }))}.${b64url("sig")}`;
const MOCK_USER = { id: ME_ID, aud: "authenticated", role: "authenticated", email: "fx_me@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: FAKE_JWT, refresh_token: "fx-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user: MOCK_USER };
const SESSION_COOKIE = { name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSION)) };

function startMock() {
  const hits = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, MOCK_URL);
    hits.push(`${req.method} ${url.pathname}`);
    req.resume();
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/auth/v1/user") return send(200, MOCK_USER);
    if (url.pathname.startsWith("/rest/v1/rpc/")) return send(200, []);
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let rows = [];
      if (table === "message_threads") {
        if (url.searchParams.get("id") === `eq.${THREAD_ID}`) rows = [{ user_lo: ME_ID, user_hi: OTHER_ID, posting_id: null, postings: null }];
      } else if (table === "profiles") {
        const id = url.searchParams.get("id");
        rows = id === `eq.${OTHER_ID}` ? [{ id: OTHER_ID, username: OTHER, avatar_path: null }] : [{ id: ME_ID, username: ME, avatar_path: null }];
      }
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return rows.length === 1 ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "no rows", details: "", hint: null });
      }
      return send(200, rows);
    }
    send(404, { message: "not mocked" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve({ hits, stop: () => new Promise((r) => server.close(r)) }));
  });
}

// ---------------------------------------------------------------- fixtures
const mid = (n) => `00000000-0000-4000-8000-00000000${String(n).padStart(4, "0")}`;
const ts = (sec, frac = "123456") => `2026-11-01T10:00:${String(sec).padStart(2, "0")}.${frac}+00:00`;
const msg = (n, sec, body, from = OTHER_ID, frac) => ({ id: mid(n), sender_id: from, body, created_at: ts(sec, frac) });
const T1 = "00000000-0000-4000-8000-0000000b0001";
const T2 = "00000000-0000-4000-8000-0000000b0002";
const T3 = "00000000-0000-4000-8000-0000000b0003";
const THREADS = [
  { id: T1, postingTitle: "Bike swap", otherHandle: "alpha_one", otherAvatarPath: null, lastMessage: "hello one", lastAt: "2026-11-01T10:00:00Z", lastFromMe: false },
  { id: T2, postingTitle: null, otherHandle: "bravo_two", otherAvatarPath: null, lastMessage: "hello two", lastAt: "2026-10-31T10:00:00Z", lastFromMe: true },
  { id: T3, postingTitle: "Yard sale", otherHandle: "charlie_three", otherAvatarPath: null, lastMessage: "hello three", lastAt: "2026-10-30T10:00:00Z", lastFromMe: false },
];

const INIT = () => {
  window.__vis = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => window.__vis, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => window.__vis === "hidden", configurable: true });
  window.__ulog = [];
  window.__rlog = [];
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (u.startsWith("/api/messages/unread")) window.__ulog.push({ t: Date.now() });
    else if (u.startsWith("/api/messages/read")) window.__rlog.push({ t: Date.now(), body: init && init.body ? String(init.body) : null });
    return orig(input, init);
  };
};

// ---------------------------------------------------------------- helpers
async function advance(page, ms, step = 250) {
  for (let t = 0; t < ms; t += step) {
    await page.clock.runFor(step);
    await page.waitForTimeout(15);
  }
}
/** Advance virtual time in small steps until cond() is true. Returns elapsed virtual ms, or null on timeout. */
async function until(page, cond, maxMs, step = 250) {
  for (let t = 0; ; t += step) {
    if (await cond()) return t;
    if (t >= maxMs) return null;
    await page.clock.runFor(step);
    await page.waitForTimeout(15);
  }
}
const ulog = (page) => page.evaluate(() => window.__ulog.slice());
const rlog = (page) => page.evaluate(() => window.__rlog.slice());
const nUnread = async (page) => (await ulog(page)).length;
const vnow = (page) => page.evaluate(() => Date.now());
const bodies = (page) => page.$$eval('[role="log"] .whitespace-pre-wrap', (els) => els.map((e) => e.textContent.trim()));
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const gapsOf = (log) => log.slice(1).map((e, i) => e.t - log[i].t);
const setVisibility = (page, v) =>
  page.evaluate((v) => {
    window.__vis = v;
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);
const fire = (page, what) =>
  page.evaluate((what) => {
    if (what === "focus") window.dispatchEvent(new Event("focus"));
    else window.dispatchEvent(new Event("cb:unread-changed"));
  }, what);

/** What the Messages link in the bottom nav shows right now. */
const navInfo = (page) =>
  page.evaluate(() => {
    const link = document.querySelector('nav a[href="/inbox"]');
    if (!link) return { found: false };
    const badge = [...link.querySelectorAll("span")].find((s) => s.getAttribute("aria-hidden") === "true" && s.textContent.trim() !== "");
    const cs = badge ? getComputedStyle(badge) : null;
    const r = badge ? badge.getBoundingClientRect() : null;
    return {
      found: true,
      label: link.getAttribute("aria-label"),
      badge: badge ? badge.textContent.trim() : null,
      badgeAriaHidden: badge ? badge.getAttribute("aria-hidden") : null,
      badgeBg: cs ? cs.backgroundColor : null,
      badgeColor: cs ? cs.color : null,
      badgeRect: r ? { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 } : null,
      linkBg: getComputedStyle(link).backgroundColor,
    };
  });
/** Anything unread-looking outside the nav: dots and the visually hidden "Unread" text. */
const markerInfo = (page) =>
  page.evaluate(() => {
    const rows = [...document.querySelectorAll('ul[aria-label="Your conversations"] > li')].map((li) => {
      const a = li.querySelector("a");
      const id = (a?.getAttribute("href") ?? "").split("/").pop();
      const dot = [...li.querySelectorAll("span")].find((s) => s.getAttribute("aria-hidden") === "true" && s.className.includes("rounded-full") && s.className.includes("bg-dark-red"));
      const sr = [...li.querySelectorAll(".sr-only")].find((s) => s.textContent.trim() === "Unread");
      const handle = [...li.querySelectorAll("span.truncate")].find((s) => s.textContent.startsWith("@"));
      const srRect = sr ? sr.getBoundingClientRect() : null;
      const srCs = sr ? getComputedStyle(sr) : null;
      return {
        id,
        dot: !!dot,
        dotBg: dot ? getComputedStyle(dot).backgroundColor : null,
        srUnread: !!sr,
        srRect: srRect ? { w: srRect.width, h: srRect.height } : null,
        srPosition: srCs ? srCs.position : null,
        textHasUnread: li.textContent.includes("Unread"),
        handleWeight: handle ? getComputedStyle(handle.parentElement).fontWeight : null,
      };
    });
    const nonNavDots = [...document.querySelectorAll("span")].filter((s) => !s.closest("nav") && s.getAttribute("aria-hidden") === "true" && s.className.includes("rounded-full") && s.className.includes("bg-dark-red")).length;
    const unreadWords = [...document.querySelectorAll(".sr-only")].filter((s) => s.textContent.trim() === "Unread").length;
    return { rows, nonNavDots, unreadWords };
  });

// ---------------------------------------------------------------- run
const mock = await startMock();
const server = await startServer(Number(process.env.CB_PORT ?? 3200), {
  env: { NEXT_PUBLIC_SUPABASE_URL: MOCK_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fx-anon-key", SUPABASE_SERVICE_ROLE_KEY: "fx-service-key" },
});
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, mockUrl: MOCK_URL, viewports: {} };
let anyFail = false;
const sendCalls = [];
const foreign = new Set();

async function open(vp, opts = {}) {
  const { path = "/inbox", signedIn = true } = opts;
  const state = {
    unreadMode: opts.unreadMode ?? "ok", // ok | unsupported | 401 | 500
    byThread: opts.byThread ?? {},
    threads: opts.threads ?? THREADS,
    messages: opts.messages ?? [],
    slowMs: 0,
    inflight: 0,
    unreadServed: 0,
    reads: [],
  };
  const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
  const routes = {
    "/api/messages/unread": (route) => {
      state.unreadServed++;
      if (state.unreadMode === "ok") return json(route, 200, { supported: true, total: Object.values(state.byThread).reduce((a, b) => a + b, 0), byThread: state.byThread });
      if (state.unreadMode === "unsupported") return json(route, 200, { supported: false });
      if (state.unreadMode === "401") return json(route, 401, { error: "Sign in" });
      return json(route, 500, { error: "boom" });
    },
    "/api/messages/read": (route) => {
      const req = route.request();
      if (req.method() !== "POST") return json(route, 405, { error: "method" });
      try {
        state.reads.push(JSON.parse(req.postData() ?? "null"));
      } catch {
        state.reads.push(null);
      }
      return json(route, 200, { ok: true });
    },
    "/api/messages/threads": (route) => json(route, 200, { threads: state.threads }),
    "/api/messages/reply": (route) => {
      sendCalls.push(`${route.request().method()} /api/messages/reply`);
      return json(route, 500, { error: "blocked by test" });
    },
    "/api/messages": async (route) => {
      const req = route.request();
      if (req.method() !== "GET") {
        sendCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
        return json(route, 500, { error: "blocked by test" });
      }
      const u = new URL(req.url());
      state.inflight++;
      try {
        if (state.slowMs) await sleep(state.slowMs);
        const after = u.searchParams.get("after");
        const list = (after ? state.messages.filter((m) => m.created_at >= after) : [...state.messages]).sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
        return await json(route, 200, { messages: list });
      } finally {
        state.inflight--;
      }
    },
  };
  const o = await newPage(browser, vp, { savedCenter: null, routes });
  o.page.on("request", (r) => {
    const h = new URL(r.url()).hostname;
    if (/supabase\./i.test(h)) foreign.add(h);
  });
  if (signedIn) await o.context.addCookies([{ ...SESSION_COOKIE, url: server.baseUrl }]);
  await o.context.addInitScript(INIT);
  await o.page.clock.install({ time: Date.now() });
  await o.page.goto(`${server.baseUrl}${path}`, { waitUntil: "load" });
  await o.page.waitForSelector("main", { timeout: 15000 });
  return { ...o, state };
}

/** Change what the mock says and make the page ask now; returns once the new answer is shown (or null). */
async function setCountsAndRefresh(o, n, how = "event") {
  o.state.byThread = n > 0 ? { [T1]: n } : {};
  await fire(o.page, how);
}

try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const checks = [];
    const scn = async (name, fn) => {
      if (ONLY && !ONLY.has(name)) return;
      try {
        await fn();
      } catch (e) {
        checks.push(c(`${name} scenario aborted: ${String(e).split("\n")[0]}`, false, String(e).slice(0, 700)));
      }
    };
    const finish = async (o, tag) => {
      checks.push({ ...(await checkNoHorizontalScroll(o.page)), name: `${tag} no horizontal scroll` });
      checks.push(c(`${tag} no uncaught page errors`, o.errors.length === 0, o.errors));
    };
    const waitNav = (o, pred, max = 3000) => until(o.page, async () => pred(await navInfo(o.page)), max, 50);

    // ===== A: badge text and accessible label (18.8, 18.9); badge colour vs the one dark-red main action (20.12 spirit)
    await scn("A", async () => {
      const o = await open(vp, { byThread: {} });
      const { page } = o;
      await until(page, async () => (await nUnread(page)) >= 1, 3000, 50);
      await advance(page, 1000);
      checks.push(c("A on load, with two components using the count (nav + inbox list), exactly one unread request is made", (await nUnread(page)) === 1, { requests: await nUnread(page) }));
      let nav = await navInfo(page);
      checks.push(c('A total 0: no badge, link label exactly "Messages"', nav.found && nav.badge === null && nav.label === "Messages", nav));
      const darkRedHosts = () =>
        page.evaluate((red) => {
          const els = [...document.querySelectorAll("a[href], button, [role=button], a[href] span, button span")];
          const hosts = new Map();
          for (const el of els) {
            if (el.closest(".maplibregl-map") || el.getAttribute("aria-pressed") === "true") continue;
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || getComputedStyle(el).backgroundColor !== red) continue;
            const host = el.closest("a[href], button, [role=button]");
            if (host && !hosts.has(host)) hosts.set(host, { label: (host.getAttribute("aria-label") || host.textContent || "").trim().slice(0, 30), viaAriaHidden: el.getAttribute("aria-hidden") === "true" });
          }
          return [...hosts.values()];
        }, DARK_RED_RGB);
      const hosts0 = await darkRedHosts();
      for (const [n, text, label] of [
        [3, "3", "Messages, 3 unread"],
        [9, "9", "Messages, 9 unread"],
        [10, "9+", "Messages, 10 unread"],
        [12, "9+", "Messages, 12 unread"],
      ]) {
        await setCountsAndRefresh(o, n);
        const t = await waitNav(o, (x) => x.badge === text && x.label === label);
        nav = await navInfo(page);
        checks.push(c(`A total ${n}: badge "${text}", label "${label}" (shown ${t === null ? "never" : t + " ms after the event"})`, t !== null && nav.badgeAriaHidden === "true", nav));
        if (n === 12) {
          checks.push(c('A badge is aria-hidden (the exact total is only in the link label, once)', nav.badgeAriaHidden === "true" && nav.label === "Messages, 12 unread", nav));
          const hosts12 = await darkRedHosts();
          const real = hosts12.filter((h) => !h.viaAriaHidden);
          const reported = { badgeBackground: nav.badgeBg, badgeTextColor: nav.badgeColor, messagesLinkBackground: nav.linkBg, badgeSize: nav.badgeRect, darkRedHostsAt0: hosts0, darkRedHostsAt12: hosts12 };
          checks.push(c("A the badge is an aria-hidden indicator inside the Messages link: dark-red hosts that are not reached only through the badge stay at one (the Scan circle); badge colour reported", real.length === 1 && hosts0.length === 1 && nav.linkBg !== DARK_RED_RGB, reported));
          checks.push(c(`A note (informational): the shared checkOneDarkRedAction would count ${hosts12.length} hosts at total 12 (the Messages link is counted only through its aria-hidden dark-red badge)`, true, { badgeBg: nav.badgeBg }));
          await shot(page, `stage5b-${vp}-A-badge12`);
        }
      }
      await setCountsAndRefresh(o, 0);
      await waitNav(o, (x) => x.badge === null && x.label === "Messages");
      nav = await navInfo(page);
      checks.push(c('A back to total 0: badge removed, label "Messages"', nav.badge === null && nav.label === "Messages", nav));
      checks.push(c("A nothing was sent (no POST /api/messages or /reply)", sendCalls.length === 0, sendCalls));
      await finish(o, "A");
      await o.context.close();
    });

    // ===== B: refresh triggers: focus, cb:unread-changed (<= 1 s), every 60 s visible, none hidden (18.1, 18.10)
    await scn("B", async () => {
      const o = await open(vp, { byThread: { [T1]: 2 } });
      const { page } = o;
      await waitNav(o, (x) => x.badge === "2", 3000);
      await until(page, async () => (await nUnread(page)) >= 4, 200000);
      const log = await ulog(page);
      const gaps = gapsOf(log).slice(0, 3);
      checks.push(c("B visible: one request every 60 s (3 gaps measured, virtual ms, tolerance 1 s)", gaps.length === 3 && gaps.every((g) => Math.abs(g - 60000) <= 1000), { gaps }));
      // focus
      let n = await nUnread(page);
      o.state.byThread = { [T1]: 5 };
      let t0 = await vnow(page);
      await fire(page, "focus");
      let el = await until(page, async () => (await nUnread(page)) > n, 1000, 50);
      let shown = await waitNav(o, (x) => x.badge === "5", 1000);
      let req = (await ulog(page))[n];
      checks.push(c("B window focus triggers a refresh within 1 s and the badge updates", el !== null && req && req.t - t0 <= 1000 && shown !== null, { requestLatencyVirtualMs: req ? req.t - t0 : null, badgeAfterMs: shown }));
      // cb:unread-changed
      await advance(page, 500);
      n = await nUnread(page);
      o.state.byThread = { [T1]: 1 };
      t0 = await vnow(page);
      await fire(page, "event");
      el = await until(page, async () => (await nUnread(page)) > n, 1000, 50);
      shown = await waitNav(o, (x) => x.badge === "1", 1000);
      req = (await ulog(page))[n];
      checks.push(c("B cb:unread-changed triggers a refresh within 1 s and the badge updates", el !== null && req && req.t - t0 <= 1000 && shown !== null, { requestLatencyVirtualMs: req ? req.t - t0 : null, badgeAfterMs: shown }));
      await advance(page, 1000);
      // hidden: nothing
      await setVisibility(page, "hidden");
      await advance(page, 500);
      const h0 = await nUnread(page);
      await advance(page, 150000);
      await fire(page, "focus");
      await fire(page, "event");
      await advance(page, 1000);
      const h1 = await nUnread(page);
      checks.push(c("B hidden tab: no unread requests for 150 s (timer ticks, focus and cb:unread-changed all skipped)", h1 === h0, { before: h0, after: h1 }));
      // visible again: one request within 1 s
      o.state.byThread = { [T1]: 4 };
      const tv = await vnow(page);
      await setVisibility(page, "visible");
      el = await until(page, async () => (await nUnread(page)) > h1, 1000, 50);
      const lv = await ulog(page);
      await advance(page, 750);
      const lv2 = await ulog(page);
      checks.push(c("B becoming visible makes exactly one request within 1 s and the badge updates", el !== null && lv.length === h1 + 1 && lv2.length === h1 + 1 && lv[h1].t - tv <= 1000 && (await navInfo(page)).badge === "4", { added: lv2.length - h1, latencyVirtualMs: lv[h1] ? lv[h1].t - tv : null, badge: (await navInfo(page)).badge }));
      // timer continues while visible
      const k = await nUnread(page);
      const got = await until(page, async () => (await nUnread(page)) > k, 61000);
      checks.push(c("B the 60 s timer keeps running after the tab is visible again (next request within 60 s)", got !== null, { elapsedVirtualMs: got }));
      checks.push(c("B nothing was sent (no POST /api/messages or /reply)", sendCalls.length === 0, sendCalls));
      await finish(o, "B");
      await o.context.close();
    });

    // ===== C: supported:false -> one request, then none for the session; no badge, dot or "Unread" (18.11)
    await scn("C", async () => {
      const o = await open(vp, { unreadMode: "unsupported", byThread: { [T1]: 3 } });
      const { page } = o;
      await until(page, async () => (await nUnread(page)) >= 1, 3000, 50);
      await advance(page, 1500);
      await until(page, async () => (await bodyText(page)).includes("@alpha_one"), 5000, 100);
      let nav = await navInfo(page);
      let m = await markerInfo(page);
      checks.push(c('C unsupported: no badge, label "Messages"; no dot and no "Unread" text on any inbox row (even though the mock lists counts)', nav.badge === null && nav.label === "Messages" && m.rows.length === 3 && m.rows.every((r) => !r.dot && !r.srUnread && !r.textHasUnread) && m.nonNavDots === 0 && m.unreadWords === 0, { nav, m }));
      const n = await nUnread(page);
      await advance(page, 190000);
      await fire(page, "focus");
      await fire(page, "event");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await advance(page, 1000);
      const n2 = await nUnread(page);
      checks.push(c("C unsupported: exactly one request, then none for 190 s, focus, cb:unread-changed or visibility change", n === 1 && n2 === 1, { afterFirst: n, later: n2 }));
      nav = await navInfo(page);
      checks.push(c("C still no badge afterwards", nav.badge === null && nav.label === "Messages", nav));
      await shot(page, `stage5b-${vp}-C-unsupported`);
      await finish(o, "C");
      await o.context.close();
    });

    // ===== D: failures keep the last counts and retry at the next scheduled refresh (18.12 / 18.1)
    await scn("D", async () => {
      const o = await open(vp, { byThread: { [T1]: 3 } });
      const { page, state } = o;
      await waitNav(o, (x) => x.badge === "3", 3000);
      const log0 = await ulog(page);
      const tLoad = log0[0].t;
      await advance(page, 2000);
      state.unreadMode = "500";
      let n = await nUnread(page);
      await fire(page, "event");
      await until(page, async () => (await nUnread(page)) > n, 1000, 50);
      await advance(page, 500);
      let nav = await navInfo(page);
      checks.push(c('D a 500 answer keeps the last counts: badge "3" and label "Messages, 3 unread" remain', nav.badge === "3" && nav.label === "Messages, 3 unread", nav));
      // next scheduled tick still fails: counts still kept, and it IS a request (supported not changed, not stopped)
      n = await nUnread(page);
      const failedAt = (await ulog(page))[n - 1].t;
      const tick1 = await until(page, async () => (await nUnread(page)) > n, 65000);
      const l1 = await ulog(page);
      nav = await navInfo(page);
      checks.push(c("D after a 500 the client is not stopped: the next scheduled refresh (60 s timer) still asks, exactly once in that window", tick1 !== null && l1.length === n + 1 && [0, 60000].some((g) => Math.abs((l1[n].t - tLoad) % 60000 - g) <= 1000), { requestsInWindow: l1.length - n, gapFromFailureMs: l1[n] ? l1[n].t - failedAt : null, phaseMsFromTimerGrid: l1[n] ? (l1[n].t - tLoad) % 60000 : null }));
      checks.push(c('D that second 500 also keeps "3" and the label', nav.badge === "3" && nav.label === "Messages, 3 unread", nav));
      // recover on the next tick
      state.unreadMode = "ok";
      state.byThread = { [T1]: 5 };
      const m0 = await nUnread(page);
      const tick2 = await until(page, async () => (await nUnread(page)) > m0, 65000);
      const shown = await waitNav(o, (x) => x.badge === "5" && x.label === "Messages, 5 unread", 2000);
      const l2 = await ulog(page);
      checks.push(c("D the following scheduled refresh succeeds and the new count shows; gap between scheduled refreshes is 60 s", tick2 !== null && shown !== null && Math.abs(l2[m0].t - l1[n].t - 60000) <= 1000, { gap: l2[m0] ? l2[m0].t - l1[n].t : null, badge: (await navInfo(page)).badge }));
      await finish(o, "D");
      await o.context.close();
    });
    await scn("D2", async () => {
      const o = await open(vp, { unreadMode: "500", byThread: { [T1]: 2 } });
      const { page, state } = o;
      await until(page, async () => (await nUnread(page)) >= 1, 3000, 50);
      await advance(page, 1500);
      let nav = await navInfo(page);
      checks.push(c('D2 first answer is a 500: no badge, label "Messages" (nothing known yet)', nav.badge === null && nav.label === "Messages", nav));
      state.unreadMode = "ok";
      const t = await until(page, async () => (await nUnread(page)) >= 2, 65000);
      const l = await ulog(page);
      await waitNav(o, (x) => x.badge === "2", 2000);
      nav = await navInfo(page);
      checks.push(c("D2 the client retries at the next scheduled refresh (about 60 s later) and then shows the badge", t !== null && Math.abs(l[1].t - l[0].t - 60000) <= 1000 && nav.badge === "2", { gap: l[1] ? l[1].t - l[0].t : null, nav }));
      await finish(o, "D2");
      await o.context.close();
    });

    // ===== E: signed-out visitor: one 401, then nothing (18.1 / 18.11)
    await scn("E", async () => {
      const o = await open(vp, { signedIn: false, unreadMode: "401" });
      const { page } = o;
      await until(page, async () => (await nUnread(page)) >= 1, 3000, 50);
      await advance(page, 1500);
      const txt = await bodyText(page);
      const nav = await navInfo(page);
      const n = await nUnread(page);
      await advance(page, 190000);
      await fire(page, "focus");
      await fire(page, "event");
      await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
      await advance(page, 1000);
      const n2 = await nUnread(page);
      checks.push(c("E signed-out visitor on /inbox (sign-in prompt shown): exactly one unread request (401), then none for 190 s, focus, cb:unread-changed and visibility change", n === 1 && n2 === 1 && /sign in/i.test(txt), { first: n, later: n2 }));
      checks.push(c('E signed-out: no badge, label "Messages"', nav.badge === null && nav.label === "Messages", nav));
      await finish(o, "E");
      await o.context.close();
    });
    await scn("E2", async () => {
      const o = await open(vp, { byThread: { [T1]: 3 } });
      const { page, state } = o;
      await waitNav(o, (x) => x.badge === "3", 3000);
      state.unreadMode = "401";
      await advance(page, 500);
      await fire(page, "event");
      await waitNav(o, (x) => x.badge === null, 2000);
      const n = await nUnread(page);
      await advance(page, 190000);
      await fire(page, "focus");
      await advance(page, 1000);
      const n2 = await nUnread(page);
      const nav = await navInfo(page);
      checks.push(c('E2 session ends mid-visit (401 after a good answer): badge disappears, label "Messages", and no further requests for 190 s or on focus', n2 === n && nav.badge === null && nav.label === "Messages", { before: n, after: n2, nav }));
      await finish(o, "E2");
      await o.context.close();
    });

    // ===== F: inbox markers (18.5 / 18.7): dot, bold handle, visually hidden "Unread" for count >= 1; none at 0
    await scn("F", async () => {
      const o = await open(vp, { byThread: { [T1]: 2, [T3]: 1 } });
      const { page, state } = o;
      await until(page, async () => (await bodyText(page)).includes("@charlie_three"), 5000, 100);
      await waitNav(o, (x) => x.badge === "3", 3000);
      let m = await markerInfo(page);
      const by = Object.fromEntries(m.rows.map((r) => [r.id, r]));
      const t1 = by[T1], t2 = by[T2], t3 = by[T3];
      checks.push(c("F counts 2 and 1: those two rows show a dot, the visually hidden text \"Unread\" and a bold handle; the badge shows the total 3", t1?.dot && t1.srUnread && t3?.dot && t3.srUnread && (await navInfo(page)).badge === "3", { t1, t3 }));
      checks.push(c("F count 0 (thread absent from byThread): no dot, no \"Unread\" text, normal handle weight", t2 && !t2.dot && !t2.srUnread && !t2.textHasUnread, t2));
      checks.push(c("F unread handle is bolder than a read one (computed font-weight, measured)", Number(t1?.handleWeight) > Number(t2?.handleWeight), { unread: t1?.handleWeight, read: t2?.handleWeight }));
      checks.push(c('F "Unread" is visually hidden (position absolute, 1x1 px) and the dot is dark red (indicator, not an action; colour reported)', t1?.srPosition === "absolute" && t1.srRect.w <= 1.01 && t1.srRect.h <= 1.01 && t1.dotBg === DARK_RED_RGB, { srPosition: t1?.srPosition, srRect: t1?.srRect, dotBg: t1?.dotBg }));
      await shot(page, `stage5b-${vp}-F-markers`);
      // one thread read -> its marker goes, the other stays
      state.byThread = { [T3]: 1 };
      await fire(page, "event");
      await until(page, async () => (await markerInfo(page)).rows.find((r) => r.id === T1)?.dot === false, 2000, 50);
      m = await markerInfo(page);
      const a = m.rows.find((r) => r.id === T1), b = m.rows.find((r) => r.id === T3);
      checks.push(c("F after thread 1 is read (count 0): its dot, \"Unread\" text and bold handle go; thread 3 keeps its marker; badge shows 1", a && !a.dot && !a.srUnread && b?.dot && b.srUnread && (await navInfo(page)).badge === "1" && Number(a.handleWeight) === Number(t2.handleWeight), { a, b }));
      state.byThread = {};
      await fire(page, "event");
      await until(page, async () => (await markerInfo(page)).unreadWords === 0, 2000, 50);
      m = await markerInfo(page);
      checks.push(c("F all counts 0: no dots, no \"Unread\" text, no badge", m.nonNavDots === 0 && m.unreadWords === 0 && (await navInfo(page)).badge === null, m));
      await finish(o, "F");
      await o.context.close();
    });

    // ===== G: mark-read from an open thread (18.1 / 18.5 / 18.6)
    await scn("G", async () => {
      const o = await open(vp, {
        path: `/inbox/${THREAD_ID}`,
        byThread: { [THREAD_ID]: 2 },
        messages: [msg(1, 1, "msg-one", OTHER_ID, "100000"), msg(2, 2, "msg-two", ME_ID, "200000"), msg(3, 3, "msg-three", OTHER_ID, "300456"), msg(4, 4, "msg-four-mine", ME_ID, "400000")],
      });
      const { page, state } = o;
      await until(page, async () => (await bodies(page)).includes("msg-four-mine"), 8000);
      await until(page, async () => (await rlog(page)).length >= 1, 3000, 50);
      await advance(page, 500);
      let rl = await rlog(page);
      let body = rl[0] ? JSON.parse(rl[0].body) : null;
      checks.push(c("G opening a thread with other-participant messages sends exactly one mark-read with upTo = the newest OTHER participant's created_at, unmodified (my newer message ignored)", rl.length === 1 && body && body.threadId === THREAD_ID && body.upTo === ts(3, "300456"), { posts: rl.length, body }));
      await advance(page, 20000);
      rl = await rlog(page);
      checks.push(c("G repeated polls (the inclusive boundary returns the same messages) do not send another mark-read while upTo has not advanced (20 s)", rl.length === 1, { posts: rl.length }));
      const ul = await ulog(page);
      const follow = ul.find((e) => e.t >= rl[0].t);
      checks.push(c("G the mark-read is followed by a cb:unread-changed refresh within 1 s (an unread request right after it)", !!follow && follow.t - rl[0].t <= 1000, { readAt: rl[0].t, nextUnreadAt: follow?.t ?? null, delayMs: follow ? follow.t - rl[0].t : null }));
      // new other-participant message while visible
      const t0 = await vnow(page);
      state.messages.push(msg(5, 9, "msg-new-other", OTHER_ID, "900000"));
      await until(page, async () => (await rlog(page)).length >= 2, 40000);
      rl = await rlog(page);
      body = rl[1] ? JSON.parse(rl[1].body) : null;
      checks.push(c("G a new other-participant message while visible leads to exactly one more mark-read with the new upTo", rl.length === 2 && body?.upTo === ts(9, "900000") && body.threadId === THREAD_ID, { posts: rl.length, body, afterMs: rl[1] ? rl[1].t - t0 : null }));
      await advance(page, 300);
      const follow2 = (await ulog(page)).find((e) => e.t >= rl[1].t);
      checks.push(c("G that mark-read is also followed by an unread refresh within 1 s", !!follow2 && follow2.t - rl[1].t <= 1000, { delayMs: follow2 ? follow2.t - rl[1].t : null }));
      // my own message: no new mark-read
      state.messages.push(msg(6, 12, "msg-mine-2", ME_ID, "000001"));
      await until(page, async () => (await bodies(page)).includes("msg-mine-2"), 40000);
      await advance(page, 15000);
      checks.push(c("G a new message from me alone sends no mark-read", (await rlog(page)).length === 2, { posts: (await rlog(page)).length }));
      // message rendered while hidden: skipped, then sent on return
      state.slowMs = 1500;
      await until(page, async () => state.inflight === 1, 60000, 100);
      await setVisibility(page, "hidden");
      state.messages.push(msg(7, 15, "msg-while-hidden", OTHER_ID, "150000"));
      await page.waitForTimeout(2300);
      state.slowMs = 0;
      await advance(page, 500);
      const rendered = (await bodies(page)).includes("msg-while-hidden");
      await advance(page, 20000);
      const hiddenPosts = (await rlog(page)).length;
      checks.push(c("G a message that renders while the tab is hidden does not send mark-read (20 s hidden)", rendered && hiddenPosts === 2, { rendered, posts: hiddenPosts }));
      const tv = await vnow(page);
      await setVisibility(page, "visible");
      await until(page, async () => (await rlog(page)).length >= 3, 3000, 50);
      await advance(page, 3000);
      rl = await rlog(page);
      body = rl[2] ? JSON.parse(rl[2].body) : null;
      checks.push(c("G on becoming visible, exactly one mark-read is sent with upTo = that message's created_at", rl.length === 3 && body?.upTo === ts(15, "150000"), { posts: rl.length, body, afterMs: rl[2] ? rl[2].t - tv : null }));
      checks.push(c("G the mock saw the same three bodies (nothing else posted to /api/messages/read)", state.reads.length === 3, state.reads));
      checks.push(c("G nothing was sent (no POST /api/messages or /api/messages/reply)", sendCalls.length === 0, sendCalls));
      await shot(page, `stage5b-${vp}-G-thread`);
      await finish(o, "G");
      await o.context.close();
    });

    out.viewports[vp] = { size: VIEWPORTS[vp], checks };
    console.log(`\n== ${vp} ${VIEWPORTS[vp].width}x${VIEWPORTS[vp].height}`);
    report(checks);
    if (checks.some((x) => !x.pass)) anyFail = true;
  }
} finally {
  await browser.close();
  await server.stop();
  await mock.stop();
}
const noSend = c("no POST /api/messages or /api/messages/reply was ever made (nothing sent)", sendCalls.length === 0, sendCalls);
const noReal = c("the browser never contacted a supabase.* host", foreign.size === 0, [...foreign]);
const onlyMock = c("server-side Supabase calls all went to the local mock", mock.hits.length > 0, { total: mock.hits.length, sample: [...new Set(mock.hits)].slice(0, 12) });
out.global = [noSend, noReal, onlyMock];
console.log("\n== global");
report(out.global);
if (out.global.some((x) => !x.pass)) anyFail = true;
console.log("\nresults:", writeResults("stage5b", out));
console.log(anyFail ? "STAGE 5B: FAIL" : "STAGE 5B: PASS");
process.exitCode = anyFail ? 1 : 0;
