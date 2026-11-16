// Stage 5a browser checks (Requirements 17.1, 17.3, 17.4, 17.5, 17.6, 17.9): automatic thread refresh on
// /inbox/[id]. Both viewports. NOTHING IS SENT and no real account or database is used.
//
// Data sources (all local):
//  - /inbox/[id] is server-rendered and needs a signed-in participant. As stage3.mjs does, the scratch
//    build points NEXT_PUBLIC_SUPABASE_URL at a tiny mock Supabase started HERE (127.0.0.1:CB_MOCK_PORT,
//    default 3299) that serves a fake session, a thread row and two profile rows. See README, "Stage 5a".
//  - In the browser, GET /api/messages is intercepted and answered from an in-memory fixture list (inclusive
//    `after` filter, like the real endpoint). /api/messages/unread -> {supported:false}, /api/messages/read -> 200.
//  - POST /api/messages and /api/messages/reply are intercepted: the script FAILS if either is ever called.
//  - Time: page.clock (Playwright 1.45+) is installed so minutes of polling run in seconds. Every request is
//    stamped with the page's (virtual) Date.now() by a fetch wrapper, so gaps are measured in virtual time.
import http from "node:http";
import { startServer, launchEdge, newPage, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS } from "./lib.mjs";

const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
const MOCK_PORT = Number(process.env.CB_MOCK_PORT ?? 3299);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
// Microsecond precision, "+00:00" offset: JS Date would rewrite it, so a modified `after` is detectable.
const ts = (sec, frac = "123456") => `2026-11-01T10:00:${String(sec).padStart(2, "0")}.${frac}+00:00`;
const msg = (n, sec, body, from = OTHER_ID, frac) => ({ id: mid(n), sender_id: from, body, created_at: ts(sec, frac) });
const initial = () => [msg(1, 1, "msg-one", OTHER_ID, "100000"), msg(2, 2, "msg-two", ME_ID, "200000"), msg(3, 3, "msg-three", OTHER_ID, "300456")];

const INIT = () => {
  window.__vis = "visible";
  Object.defineProperty(document, "visibilityState", { get: () => window.__vis, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => window.__vis === "hidden", configurable: true });
  window.__log = [];
  const orig = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const u = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (u.startsWith("/api/messages?")) window.__log.push({ t: Date.now(), url: u });
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
const vlog = (page) => page.evaluate(() => window.__log.slice());
const vnow = (page) => page.evaluate(() => Date.now());
const bodies = (page) => page.$$eval('[role="log"] .whitespace-pre-wrap', (els) => els.map((e) => e.textContent.trim()));
const bodyText = (page) => page.evaluate(() => document.body.innerText);
const reconnecting = async (page) => (await bodyText(page)).includes("Reconnecting…");
const gapsOf = (log) => log.slice(1).map((e, i) => e.t - log[i].t);
const within = (g, expected, jitter = 0.15, slack = 600) => g >= expected * (1 - jitter) - slack && g <= expected * (1 + jitter) + slack;
const setVisibility = (page, v) =>
  page.evaluate((v) => {
    window.__vis = v;
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);

// ---------------------------------------------------------------- run
const mock = await startMock();
const server = await startServer(Number(process.env.CB_PORT ?? 3200), {
  env: { NEXT_PUBLIC_SUPABASE_URL: MOCK_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fx-anon-key", SUPABASE_SERVICE_ROLE_KEY: "fx-service-key" },
});
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, mockUrl: MOCK_URL, viewports: {} };
let anyFail = false;
const sendCalls = [];
let globalMaxInflight = 0;

async function open(vp) {
  const state = { messages: initial(), mode: "ok", reverse: false, slowMs: 0, inflight: 0, maxInflight: 0, reqs: [], reads: 0, unread: 0, delivered: "" };
  const handler = async (route) => {
    const req = route.request();
    if (req.method() !== "GET") {
      sendCalls.push(`${req.method()} ${new URL(req.url()).pathname}`);
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "blocked by test" }) });
    }
    const u = new URL(req.url());
    state.inflight++;
    state.maxInflight = Math.max(state.maxInflight, state.inflight);
    globalMaxInflight = Math.max(globalMaxInflight, state.inflight);
    const after = u.searchParams.get("after");
    state.reqs.push({ after, expected: state.delivered || null, mode: state.mode, threadId: u.searchParams.get("threadId") });
    try {
      if (state.slowMs) await sleep(state.slowMs);
      const json = (status, body) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
      if (state.mode === "abort") return await route.abort("failed");
      if (state.mode === "500") return await json(500, { error: "boom" });
      if (state.mode === "401") return await json(401, { error: "Sign in to read this conversation." });
      if (state.mode === "404") return await json(404, { error: "This conversation couldn't be found." });
      let list = after ? state.messages.filter((m) => m.created_at >= after) : [...state.messages];
      list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
      if (state.reverse) list = list.reverse();
      for (const m of list) if (m.created_at > state.delivered) state.delivered = m.created_at;
      return await json(200, { messages: list });
    } finally {
      state.inflight--;
    }
  };
  const routes = {
    "/api/messages": handler,
    "/api/messages/reply": (route) => {
      sendCalls.push(`${route.request().method()} /api/messages/reply`);
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "blocked by test" }) });
    },
    "/api/messages/unread": (route) => {
      state.unread++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ supported: false }) });
    },
    "/api/messages/read": (route) => {
      state.reads++;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    },
  };
  const o = await newPage(browser, vp, { savedCenter: null, routes });
  await o.context.addCookies([{ ...SESSION_COOKIE, url: server.baseUrl }]);
  await o.context.addInitScript(INIT);
  await o.page.clock.install({ time: Date.now() });
  await o.page.goto(`${server.baseUrl}/inbox/${THREAD_ID}`, { waitUntil: "load" });
  await o.page.waitForSelector("main", { timeout: 15000 });
  return { ...o, state };
}

try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const checks = [];
    const scn = async (name, fn) => {
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
    const loaded = async (o, tag) => {
      const t = await until(o.page, async () => (await bodies(o.page)).includes("msg-three"), 8000);
      checks.push(c(`${tag} thread renders the mock conversation (signed-in participant)`, t !== null, { url: o.page.url(), body: (await bodyText(o.page)).slice(0, 200) }));
      return t !== null;
    };

    // ===== B: basics (17.1 interval, `after`, inclusive boundary, 17.9 order and uniqueness, Check button)
    await scn("B", async () => {
      const o = await open(vp);
      const { page, state } = o;
      if (!(await loaded(o, "B"))) return void (await o.context.close());
      checks.push(c('B initial request has threadId and no `after`', state.reqs[0]?.threadId === THREAD_ID && state.reqs[0].after === null, state.reqs[0]));
      checks.push(c('B helper text "Updates automatically while this page is open." and the "Check for new messages" button are present', (await bodyText(page)).includes("Updates automatically while this page is open.") && (await page.$('button:text-is("Check for new messages")')) !== null, {}));
      await until(page, async () => (await vlog(page)).length >= 5, 30000);
      const log = await vlog(page);
      const gaps = gapsOf(log).slice(1, 4); // log[0] is the immediate poke; the rest follow the timer
      checks.push(c("B visible tab, steady state: gaps between requests are 5 s ±15 % (measured, virtual ms)", gaps.length >= 3 && gaps.every((g) => within(g, 5000, 0.15, 400)), { gaps }));
      const withAfter = state.reqs.slice(1);
      checks.push(c("B every later request sends `after` = the newest created_at unmodified (microseconds and +00:00 kept)", withAfter.length >= 3 && withAfter.every((r) => r.after === ts(3, "300456") && r.after === r.expected), withAfter.slice(0, 3)));
      const dupe = (await bodies(page)).filter((b) => b === "msg-three").length;
      checks.push(c("B inclusive boundary: the mock returns the newest message again on every poll, shown exactly once", dupe === 1 && (await bodies(page)).length === 3, await bodies(page)));

      // a new message arrives without reload
      await page.evaluate(() => (window.__marker = "same-document"));
      const t0 = await vnow(page);
      state.messages.push(msg(4, 9, "msg-new", OTHER_ID, "900000"));
      const waited = await until(page, async () => (await bodies(page)).includes("msg-new"), 9000);
      const elapsed = (await vnow(page)) - t0;
      checks.push(c("B a new message appears within 6 s and without a reload", waited !== null && elapsed <= 6500 && (await page.evaluate(() => window.__marker)) === "same-document", { elapsedVirtualMs: elapsed }));
      // same timestamp, smaller id: shows once, ordered by id
      state.messages.push({ id: mid(5), sender_id: OTHER_ID, body: "msg-tie-a", created_at: ts(9, "900000") });
      state.messages.push({ id: mid(6), sender_id: ME_ID, body: "msg-tie-z", created_at: ts(9, "900000") });
      await until(page, async () => (await bodies(page)).includes("msg-tie-z") && (await bodies(page)).includes("msg-tie-a"), 9000);
      let bs = await bodies(page);
      checks.push(c("B same-timestamp messages each show exactly once, sorted by created_at then id", JSON.stringify(bs) === JSON.stringify(["msg-one", "msg-two", "msg-three", "msg-new", "msg-tie-a", "msg-tie-z"]), bs));
      // out-of-order batch
      state.reverse = true;
      state.messages.push(msg(7, 12, "msg-late", OTHER_ID, "000001"), msg(8, 11, "msg-early", ME_ID, "000001"));
      await until(page, async () => (await bodies(page)).includes("msg-late"), 9000);
      bs = await bodies(page);
      checks.push(c("B a batch delivered newest-first is shown oldest-first with no duplicates", bs.length === 8 && new Set(bs).size === 8 && bs.indexOf("msg-early") < bs.indexOf("msg-late") && bs.slice(0, 3).join() === "msg-one,msg-two,msg-three", bs));
      state.reverse = false;

      // Check button: one immediate request
      const n0 = (await vlog(page)).length;
      await until(page, async () => (await vlog(page)).length > n0, 9000); // just after a poll: next timer is >= 4.25 s away
      const n1 = (await vlog(page)).length;
      await page.click('button:text-is("Check for new messages")');
      const t1 = await vnow(page);
      await until(page, async () => (await vlog(page)).length > n1, 1500, 50);
      const after1 = await vlog(page);
      await advance(page, 500);
      const after2 = await vlog(page);
      checks.push(c('B "Check for new messages" makes one immediate request (within 1 s), and no second one follows', after1.length === n1 + 1 && after2.length === n1 + 1 && after1[n1].t - t1 <= 1000, { added: after2.length - n1, latencyVirtualMs: after1[n1]?.t - t1 }));
      checks.push(c("B nothing was sent (no POST /api/messages or /reply)", sendCalls.length === 0, sendCalls));
      await shot(page, `stage5a-${vp}-B-thread`);
      await finish(o, "B");
      await o.context.close();
    });

    // ===== H: hidden tab (17.3)
    await scn("H", async () => {
      const o = await open(vp);
      const { page, state } = o;
      if (!(await loaded(o, "H"))) return void (await o.context.close());
      await until(page, async () => (await vlog(page)).length >= 2, 9000);
      await setVisibility(page, "hidden");
      await until(page, async () => state.inflight === 0, 3000, 50);
      await advance(page, 500);
      const n0 = (await vlog(page)).length;
      state.messages.push(msg(4, 9, "msg-while-hidden", OTHER_ID, "900000"));
      await advance(page, 20000);
      await page.evaluate(() => window.dispatchEvent(new Event("focus"))); // focus while hidden must not poll either
      await advance(page, 500);
      const n1 = (await vlog(page)).length;
      checks.push(c("H hidden tab: no requests for 20 s (and none on focus while hidden)", n1 === n0 && !(await bodies(page)).includes("msg-while-hidden"), { before: n0, after: n1 }));
      const tv = await vnow(page);
      await setVisibility(page, "visible");
      await until(page, async () => (await vlog(page)).length > n1, 1200, 50);
      const l2 = await vlog(page);
      await advance(page, 750);
      const l3 = await vlog(page);
      checks.push(c("H becoming visible makes exactly one request within 1 s", l2.length === n1 + 1 && l3.length === n1 + 1 && l2[n1].t - tv <= 1000, { added: l3.length - n1, latencyVirtualMs: l2[n1]?.t - tv }));
      const shown = await until(page, async () => (await bodies(page)).includes("msg-while-hidden"), 2000, 50);
      checks.push(c("H the message sent while hidden appears right after return", shown !== null, await bodies(page)));
      await until(page, async () => (await vlog(page)).length >= n1 + 2, 9000);
      const l4 = await vlog(page);
      const g = l4[n1 + 1] ? l4[n1 + 1].t - l4[n1].t : null;
      checks.push(c("H the 5 s interval resumes after the visible poll (new message just arrived)", g !== null && within(g, 5000, 0.15, 500), { gap: g }));
      await finish(o, "H");
      await o.context.close();
    });

    // ===== F: failures back off, "Reconnecting…", recovery (17.4, 17.5)
    for (const mode of ["500", "abort"]) {
      await scn(`F-${mode}`, async () => {
        const tag = `F-${mode === "500" ? "HTTP 500" : "network abort"}`;
        const o = await open(vp);
        const { page, state } = o;
        if (!(await loaded(o, tag))) return void (await o.context.close());
        await until(page, async () => (await vlog(page)).length >= 2, 9000);
        const before = await bodies(page);
        const base = (await vlog(page)).length;
        state.mode = mode;
        // r0 fails (failures=1), then expected gaps 10 s, 20 s, 40 s, then the 60 s cap.
        const sawReconnecting = await until(page, async () => await reconnecting(page), 12000);
        checks.push(c(`${tag}: "Reconnecting…" appears after the first failed poll`, sawReconnecting !== null, { elapsedVirtualMs: sawReconnecting }));
        checks.push(c(`${tag}: messages already shown are kept while reconnecting`, JSON.stringify(await bodies(page)) === JSON.stringify(before), await bodies(page)));
        await shot(page, `stage5a-${vp}-F-${mode}-reconnecting`);
        checks.push({ ...(await checkNoHorizontalScroll(page)), name: `${tag} no horizontal scroll while reconnecting` });
        await until(page, async () => (await vlog(page)).length >= base + 5, 200000);
        const log = await vlog(page);
        const gaps = gapsOf(log.slice(base)); // between the failed polls r0..r4
        const expected = [10000, 20000, 40000, 60000];
        checks.push(c(`${tag}: next delays grow ~2x per failure (10, 20, 40 s) and cap at 60 s (jitter ±15 %)`, gaps.length >= 4 && expected.every((e, i) => (e === 60000 ? gaps[i] >= 59000 && gaps[i] <= 60900 : within(gaps[i], e, 0.15, 600))), { gaps, expected }));
        const ratios = gaps.slice(1, 3).map((g, i) => +(g / gaps[i]).toFixed(2));
        checks.push(c(`${tag}: consecutive gaps roughly double (measured ratios within jitter bounds 1.5–2.7)`, ratios.every((r) => r >= 1.5 && r <= 2.7), { ratios }));
        checks.push(c(`${tag}: still "Reconnecting…" with messages kept after 5 failures`, (await reconnecting(page)) && JSON.stringify(await bodies(page)) === JSON.stringify(before), {}));
        // recover
        state.mode = "ok";
        const nFail = (await vlog(page)).length;
        const cleared = await until(page, async () => !(await reconnecting(page)), 62000);
        checks.push(c(`${tag}: a successful request removes "Reconnecting…"`, cleared !== null, { elapsedVirtualMs: cleared }));
        await until(page, async () => (await vlog(page)).length >= nFail + 2, 40000);
        const l = await vlog(page);
        const g1 = l[nFail + 1] ? l[nFail + 1].t - l[nFail].t : null;
        checks.push(c(`${tag}: failure count reset after success (next gap is the plain interval, 15 s idle ±15 % since >120 s quiet)`, g1 !== null && within(g1, 15000, 0.15, 600), { gap: g1 }));
        await finish(o, tag);
        await o.context.close();
      });
    }

    // ===== S: 401 and 404 stop the poller (17.6)
    for (const code of ["401", "404"]) {
      await scn(`S-${code}`, async () => {
        const tag = `S-${code}`;
        const o = await open(vp);
        const { page, state } = o;
        if (!(await loaded(o, tag))) return void (await o.context.close());
        await until(page, async () => (await vlog(page)).length >= 2, 9000);
        state.mode = code;
        const want = code === "401" ? "Your session has ended." : "This conversation couldn't be found.";
        const seen = await until(page, async () => (await bodyText(page)).includes(want), 12000);
        const txt = await bodyText(page);
        checks.push(c(code === "401" ? `${tag}: signed-out state ("Your session has ended." with a Sign in again link)` : `${tag}: not-found state ("This conversation couldn't load." + server message)`, seen !== null && (code === "401" ? (await page.$('a:text-is("Sign in again")')) !== null : txt.includes("This conversation couldn't load.")), txt.slice(0, 300)));
        checks.push(c(`${tag}: no "Reconnecting…" text`, !txt.includes("Reconnecting…"), {}));
        await shot(page, `stage5a-${vp}-S-${code}`);
        const n = (await vlog(page)).length;
        await advance(page, 30000);
        await page.evaluate(() => {
          window.dispatchEvent(new Event("focus"));
          document.dispatchEvent(new Event("visibilitychange"));
        });
        await advance(page, 1000);
        const n2 = (await vlog(page)).length;
        checks.push(c(`${tag}: no further requests for 30 s (also none on focus or visibility change)`, n2 === n, { before: n, after: n2 }));
        checks.push(c(`${tag}: still no "Reconnecting…" afterwards`, !(await reconnecting(page)), {}));
        await finish(o, tag);
        await o.context.close();
      });
    }

    // ===== I: never two requests in flight (17.7 spirit, part of every scenario)
    await scn("I", async () => {
      const o = await open(vp);
      const { page, state } = o;
      if (!(await loaded(o, "I"))) return void (await o.context.close());
      await until(page, async () => (await vlog(page)).length >= 2, 9000);
      state.slowMs = 2500;
      await until(page, async () => state.inflight === 1, 9000, 100);
      const n = (await vlog(page)).length;
      // All triggers fire in one synchronous burst, well inside the 2.5 s the mock holds the response.
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll("button")].find((b) => /Check for new messages|Checking/.test(b.textContent));
        for (let i = 0; i < 3; i++) btn?.click();
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await page.waitForTimeout(700);
      const during = (await vlog(page)).length;
      checks.push(c("I while a request is in flight, Check clicks (3), focus and visibility events start no second request", during === n && state.maxInflight === 1, { requestsBefore: n, requestsDuring: during, maxInflight: state.maxInflight, nodeSeen: state.reqs.length, logTimes: (await vlog(page)).map((e) => e.t % 1000000) }));
      state.slowMs = 0;
      await page.waitForTimeout(2300);
      await finish(o, "I");
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
const oneFlight = c("never more than 1 GET /api/messages in flight at any time (all scenarios)", globalMaxInflight <= 1, { globalMaxInflight });
const onlyMock = c("server-side Supabase calls all went to the local mock", mock.hits.length > 0, { total: mock.hits.length, sample: [...new Set(mock.hits)].slice(0, 12) });
out.global = [noSend, oneFlight, onlyMock];
console.log("\n== global");
report(out.global);
if (out.global.some((x) => !x.pass)) anyFail = true;
console.log("\nresults:", writeResults("stage5a", out));
console.log(anyFail ? "STAGE 5A: FAIL" : "STAGE 5A: PASS");
process.exitCode = anyFail ? 1 : 0;
