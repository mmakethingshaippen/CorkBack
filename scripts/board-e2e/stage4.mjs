// Stage 4 browser checks (Requirements 14.1-14.7, 15.3-15.6, 15.8, 20.2, plus 13.14, 15.1, 15.9, 15.10):
// the category filter on both maps, the world-map caption, empty state, "Show all categories",
// a 5,000-posting fixture capped at 300, debounced panning, abort of the earlier request, stale
// responses, retry after a failure, "Updating..." timing, one map instance, and the network log.
// Both viewports. Mocked data only: /api/postings/map is intercepted per page (never Supabase),
// tiles and the geocoder are stubbed by lib.mjs, geolocation is a stub (no real permission).
// See README.md ("Stage 4") for how to build and run.
import { startServer, launchEdge, newPage, open, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS } from "./lib.mjs";
import { FX_POSTINGS, BERKELEY } from "./fixtures.mjs";

const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- selectors and constants
const W = 'section[aria-label="World map"]';
const TRIGGER = 'button[aria-haspopup="true"][aria-controls]';
const PANEL = '[role="group"][aria-label="Filter by category"]';
const MID = "\u00b7";
const NAVY_RGB = "rgb(31, 46, 77)";
const PIN_CAP = 300;
const CARD_CAP = 100;
const LABEL = { sports: "Sports", classes: "Classes", nightlife: "Nightlife", community: "Community", music: "Music" };

// ---------------------------------------------------------------- fixtures (test data only, ids start with fx-)
const REF = { lat: BERKELEY.lat - 0.02, lng: BERKELEY.lng }; // differs from the default key, so the local map fetches
const SAVED_REF = { lat: REF.lat, lng: REF.lng, zoom: 13, town: "Berkeley" };
const LON = { lat: 51.5465, lng: -0.1035 }; // the world map's first view (no pins yet)
const M_PER_MI = 1609.344;
const R_EARTH = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
function dest(from, miles, bearingDeg) {
  const d = (miles * M_PER_MI) / R_EARTH;
  const br = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}
const base = FX_POSTINGS[0];
let seq = 0;
const mk = (id, title, categorySlug, p, extra = {}) => ({
  ...base,
  id,
  title,
  categorySlug,
  placeLabel: "Fixture",
  lat: p.lat,
  lng: p.lng,
  createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, 0) - seq++ * 60000).toISOString(),
  ...extra,
});
const at = (dLat, dLng) => ({ lat: LON.lat + dLat, lng: LON.lng + dLng });
const WORLD = [
  mk("fx-w-comm-1", "FX World Community A", "community", at(0.3, -0.6)),
  mk("fx-w-comm-2", "FX World Community B", "community", at(-0.4, 0.5)),
  mk("fx-w-comm-3", "FX World Community C", "community", at(0.1, 1.1)),
  mk("fx-w-sport-1", "FX World Sports A", "sports", at(0.6, 0.3)),
  mk("fx-w-sport-2", "FX World Sports B", "sports", at(-0.7, -0.4)),
  mk("fx-w-class-1", "FX World Classes A", "classes", at(0.0, -1.0)),
];
const LOCAL = [
  mk("fx-l-comm-1", "FX Local Community A", "community", dest(REF, 0.6, 20)),
  mk("fx-l-comm-2", "FX Local Community B", "community", dest(REF, 1.4, 140)),
  mk("fx-l-sport-1", "FX Local Sports A", "sports", dest(REF, 0.9, 250)),
  mk("fx-l-sport-2", "FX Local Sports B", "sports", dest(REF, 2.2, 320)),
  mk("fx-l-music-1", "FX Local Music A", "music", dest(REF, 1.1, 80)),
];
const DATA = [...WORLD, ...LOCAL];
const STALE = mk("fx-stale-1", "FX STALE ONLY", "community", at(0.2, 0.2));
const STALE_CAT = mk("fx-stale-2", "FX STALE CATEGORY", "community", at(-0.2, -0.2));
// 5,000 postings around London on a deterministic scatter, newest first by index.
const BIG = (() => {
  let s = 12345;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const cats = ["community", "sports", "music", "classes"];
  return Array.from({ length: 5000 }, (_, i) => ({
    ...base,
    id: `fx-big-${String(i).padStart(4, "0")}`,
    title: `FX Big ${String(i).padStart(4, "0")}`,
    categorySlug: cats[i % cats.length],
    placeLabel: "Fixture",
    lat: 51.0 + rnd(),
    lng: -1.0 + rnd() * 2,
    createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, 0) - i * 1000).toISOString(),
  }));
})();

// ---------------------------------------------------------------- mock of GET /api/postings/map (mimics selectForBounds)
function parseBounds(raw) {
  const p = (raw ?? "").split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  return { west: p[0], south: p[1], east: p[2], north: p[3] };
}
/**
 * pinPlan / cardPlan are queues of one-shot overrides for the next pins or cards request:
 * { delayMs, status, abort, extra: [postings put in front of the result] }.
 */
function makeMock(data) {
  const s = { data, log: [], pinPlan: [], cardPlan: [] };
  s.respond = (url) => {
    const mode = url.searchParams.get("mode") ?? "pins";
    const plan = (mode === "cards" ? s.cardPlan : s.pinPlan).shift() ?? {};
    const entry = { search: url.search, mode, category: url.searchParams.get("category"), hasBounds: url.searchParams.has("bounds") };
    s.log.push(entry);
    if (plan.abort) {
      entry.outcome = "network error";
      return { abort: true, delayMs: plan.delayMs };
    }
    if (plan.status && plan.status !== 200) {
      entry.outcome = `status ${plan.status}`;
      return { status: plan.status, body: { error: "Could not load postings. Try again." }, delayMs: plan.delayMs };
    }
    const b = parseBounds(url.searchParams.get("bounds"));
    if (!b) {
      entry.outcome = "400";
      return { status: 400, body: { error: "bad bounds" } };
    }
    const cap = mode === "cards" ? CARD_CAP : PIN_CAP;
    const cat = entry.category;
    const matches = s.data
      .filter((p) => (cat === null || p.categorySlug === cat) && p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east)
      .sort((x, y) => (x.isPromoted === y.isPromoted ? (x.createdAt === y.createdAt ? (x.id < y.id ? 1 : -1) : x.createdAt < y.createdAt ? 1 : -1) : x.isPromoted ? -1 : 1));
    let items = matches.slice(0, cap);
    if (plan.extra) items = [...plan.extra, ...items];
    entry.returned = items.length;
    entry.truncated = matches.length > cap;
    entry.titles = items.map((i) => i.title);
    entry.outcome = "ok";
    return { delayMs: plan.delayMs, body: { items, truncated: matches.length > cap } };
  };
  return s;
}
async function installMock(page, mock) {
  // A page-level route takes precedence over lib.mjs's context-level one.
  await page.route(
    (u) => u.pathname === "/api/postings/map",
    async (route) => {
      const url = new URL(route.request().url());
      const r = mock.respond(url);
      if (r.delayMs) await sleep(r.delayMs);
      try {
        if (r.abort) return await route.abort("failed");
        await route.fulfill({ status: r.status ?? 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(r.body) });
      } catch {
        /* the page aborted the request first: expected for replaced requests */
      }
    },
  );
}

// ---------------------------------------------------------------- in-page instrumentation
const INSTRUMENT = () => {
  const orig = window.fetch.bind(window);
  window.__f = [];
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url || String(input);
    if (!url.includes("/api/postings/map")) return orig(input, init);
    const rec = { url, t0: performance.now(), abortedAt: null, settledAt: null, outcome: null };
    window.__f.push(rec);
    const sig = init && init.signal;
    if (sig) sig.addEventListener("abort", () => { if (rec.settledAt === null && rec.abortedAt === null) rec.abortedAt = performance.now(); });
    const p = orig(input, init);
    p.then(
      (r) => { rec.settledAt = performance.now(); rec.outcome = "http " + r.status; },
      (e) => { rec.settledAt = performance.now(); rec.outcome = (e && e.name) || "error"; },
    );
    return p;
  };
};
const POLLER = () => {
  const W = 'section[aria-label="World map"]';
  window.__ui = [];
  window.__canvasAdds = 0;
  let last = "";
  const w0 = document.querySelector(W);
  if (w0) {
    new MutationObserver((ms) => {
      for (const m of ms)
        for (const n of m.addedNodes)
          if (n.nodeType === 1 && (n.matches(".maplibregl-canvas, .maplibregl-map") || n.querySelector(".maplibregl-canvas, .maplibregl-map"))) window.__canvasAdds++;
    }).observe(w0, { subtree: true, childList: true });
  }
  setInterval(() => {
    const w = document.querySelector(W);
    if (!w) return;
    const txt = w.innerText;
    const upd = /Updating…/.test(txt);
    const retry = [...w.querySelectorAll("button")].some((b) => b.textContent.trim() === "Try again" && b.getBoundingClientRect().width > 0);
    const err = /Could not load postings for this view/.test(txt);
    const titles = [...w.querySelectorAll(".maplibregl-marker[aria-label]")].map((m) => m.getAttribute("aria-label"));
    const stale = titles.some((t) => t.startsWith("FX STALE"));
    const key = [upd, retry, err, titles.length, stale].join("|");
    if (key !== last) {
      last = key;
      window.__ui.push({ t: performance.now(), upd, retry, err, n: titles.length, stale });
    }
  }, 10);
};

// ---------------------------------------------------------------- page helpers
const fetchLog = (page) => page.evaluate(() => window.__f.map((r) => ({ ...r })));
const uiLog = (page) => page.evaluate(() => window.__ui.map((r) => ({ ...r })));
const nowIn = (page) => page.evaluate(() => performance.now());

/** Resolves once no map request is in flight and none has started for `quietMs`. */
async function waitIdle(page, quietMs = 1000, timeout = 20000) {
  const t0 = Date.now();
  let lastN = -1;
  let lastChange = Date.now();
  while (Date.now() - t0 < timeout) {
    const s = await page.evaluate(() => ({ n: window.__f.length, pending: window.__f.filter((r) => r.settledAt === null).length }));
    if (s.n !== lastN || s.pending > 0) {
      lastN = s.n;
      lastChange = Date.now();
    }
    if (s.pending === 0 && Date.now() - lastChange >= quietMs) return true;
    await sleep(60);
  }
  return false;
}
async function waitForNewFetch(page, count, timeout = 4000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const n = await page.evaluate(() => window.__f.length);
    if (n > count) return true;
    await sleep(15);
  }
  return false;
}
const worldTitles = (page) => page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.map((m) => m.getAttribute("aria-label")));
const worldPinsInView = (page) =>
  page.evaluate((W) => {
    const box = document.querySelector(`${W} .maplibregl-map`).getBoundingClientRect();
    const cv = document.querySelector(`${W} .maplibregl-canvas`).getBoundingClientRect();
    const pts = [...document.querySelectorAll(`${W} .maplibregl-marker[aria-label]`)].map((m) => {
      const r = m.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    const within = (m) => ({ x, y }) => x >= box.left + m && x <= box.right - m && y >= box.top + m && y <= box.bottom - m;
    // Marker positions are rounded to whole pixels, so a pin within 1.5 px of an edge cannot be placed
    // inside or outside the view from the DOM. Report the strict and the loose count.
    return { min: pts.filter(within(1.5)).length, max: pts.filter(within(-1.5)).length, box: [box.width, box.height], canvas: [cv.width, cv.height] };
  }, W);
const localTitles = (page) =>
  page.evaluate((W) => [...document.querySelectorAll(".maplibregl-marker[aria-label]")].filter((m) => !m.closest(W)).map((m) => m.getAttribute("aria-label")), W);
const caption = (page) => page.$eval(`${W} h2`, (h) => h.textContent.trim()).catch(() => null);
const triggerText = (page) => page.$eval(TRIGGER, (b) => b.textContent.replace(/[\u25be\u25b4]/g, "").trim()).catch(() => null);
const worldText = (page) => page.$eval(W, (s) => s.innerText).catch(() => "");
async function pickCategory(page, label) {
  await page.click(TRIGGER);
  await page.waitForSelector(PANEL, { timeout: 3000 });
  await page.click(`${PANEL} li button:text-is("${label}")`);
}
async function scrollWorldIntoView(page) {
  await page.evaluate((W) => document.querySelector(W).scrollIntoView({ block: "center" }), W);
  await sleep(250);
}
/** A point on the world map's canvas that is not a pin, control or overlay. */
async function canvasPoint(page) {
  return page.evaluate((W) => {
    const map = document.querySelector(`${W} .maplibregl-map`);
    const r = map.getBoundingClientRect();
    for (const [fx, fy] of [[0.3, 0.8], [0.5, 0.85], [0.7, 0.8], [0.2, 0.5], [0.4, 0.15], [0.6, 0.9], [0.1, 0.9]]) {
      const x = r.left + r.width * fx;
      const y = r.top + r.height * fy;
      const el = document.elementFromPoint(x, y);
      if (el && el.classList.contains("maplibregl-canvas")) return { x, y, w: r.width, h: r.height };
    }
    return null;
  }, W);
}
/** Mouse drag on the world map with a 200 ms hold before release (no inertia). Returns page time of release. */
async function drag(page, dx, dy, holdMs = 175) {
  const p = await canvasPoint(page);
  if (!p) throw new Error("no free canvas point on the world map");
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + dx, p.y + dy, { steps: 2 });
  await sleep(holdMs); // longer than MapLibre's 160 ms inertia window, so the pan stops at release
  await page.mouse.up();
  const t = await nowIn(page);
  // Harness workaround: in headless Edge, MapLibre does not fire "moveend" after a release until the
  // next pointer event arrives (seen with vertical drags). A real pointer always moves a little after
  // release, so move it 3 px. Without this the pan is not reported and no request is issued.
  await sleep(30);
  await page.mouse.move(p.x + dx + 3, p.y + dy + 2);
  return t;
}
const nonBlank = (a) => a.filter(Boolean);
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

// ---------------------------------------------------------------- network-log check (Req 13.1, 20.2)
const MAP_URL = /^\/api\/postings\/map\?bounds=(-?\d+\.\d),(-?\d+\.\d),(-?\d+\.\d),(-?\d+\.\d)(?:&category=([a-z-]+))?&mode=(pins|cards)$/;
function trackNet(page, origin) {
  const log = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    log.push({ method: r.method(), host: u.host, path: u.pathname, search: u.search, full: u.pathname + u.search, body: r.postData() ?? "", sameOrigin: u.origin === origin });
  });
  return log;
}
function netChecks(log, label, needles) {
  const out = [];
  const maps = log.filter((r) => r.sameOrigin && r.path === "/api/postings/map");
  const bad = [];
  for (const r of maps) {
    const m = r.full.match(MAP_URL);
    if (!m) { bad.push({ q: r.full, why: "no snapped bounds, or an extra or unknown parameter" }); continue; }
    const [w, s, e, n] = m.slice(1, 5).map(Number);
    if (![w, s, e, n].every((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-9)) bad.push({ q: r.full, why: "not on the 0.1 grid" });
    if (!(w < e && s < n)) bad.push({ q: r.full, why: "inverted" });
    if (r.method !== "GET" || r.body) bad.push({ q: r.full, why: "not a bodyless GET" });
  }
  out.push(c(`${label}: every /api/postings/map request has snapped bounds (0.1 grid), optional category, mode, nothing else (${maps.length} requests)`, maps.length > 0 && bad.length === 0, { bad, sample: maps.slice(0, 2).map((r) => r.full) }));
  const leaks = log.filter((r) => r.sameOrigin && r.path.startsWith("/api/") && needles.some((n) => (r.full + r.body).includes(n)));
  out.push(c(`${label}: no same-origin API request contains the viewer's coordinates (${needles.join(", ")})`, leaks.length === 0, leaks.slice(0, 3)));
  const paramLeaks = maps.filter((r) => /[?&](lat|lng|lon|radius|limit|cap|user|username|email|x|y)=/i.test(r.search));
  out.push(c(`${label}: no radius, user or coordinate parameter on any map request`, paramLeaks.length === 0, paramLeaks.slice(0, 3)));
  return out;
}
const SF = { latitude: 37.7749, longitude: -122.4194, accuracy: 20 };
const NEEDLES = ["37.8715", "122.273", "37.8515", "37.7749", "122.4194"];

// ---------------------------------------------------------------- run
const server = await startServer(Number(process.env.CB_PORT ?? 3200));
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, viewports: {} };
let anyFail = false;

try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const checks = [];
    const notes = {};
    const only = process.env.CB_ONLY ? process.env.CB_ONLY.split(",") : null;
    const scn = async (name, fn) => {
      if (only && !only.includes(name)) return;
      try {
        await fn();
      } catch (e) {
        checks.push(c(`${name} scenario aborted: ${String(e).split("\n")[0]}`, false, String(e).slice(0, 700)));
      }
    };
    /** New page with the mock, instrumentation and net tracking; waits for the first idle. */
    const start = async (data, opts = {}) => {
      const mock = makeMock(data);
      const o = await newPage(browser, vp, { savedCenter: SAVED_REF, ...opts });
      await o.context.addInitScript(INSTRUMENT);
      await installMock(o.page, mock);
      const net = trackNet(o.page, server.baseUrl);
      await open(o.page, server.baseUrl, "/", 2000);
      const idle = await waitIdle(o.page);
      await o.page.evaluate(POLLER);
      return { ...o, mock, net, idle };
    };

    // ===== S: category on both maps, caption, empty state, Show all categories, one map instance
    await scn("S", async () => {
      const { page, errors, context, mock, net } = await start(DATA);
      const allWorld = WORLD.map((p) => p.title);
      const allLocal = LOCAL.map((p) => p.title);
      // The world map opens on the whole world, so on a wide screen its view can also hold the
      // "local" fixtures. Expected world pins = what the last pins response returned for its view.
      const lastPinsTitles = () => ([...mock.log].reverse().find((r) => r.mode === "pins" && r.outcome === "ok")?.titles ?? []);
      const incl = (big, small) => small.every((x) => big.includes(x));
      const capOk = async (label, text) => {
        const m = new RegExp("^Explore the world " + MID + " " + label + " " + MID + " (\\d+) postings? in view$").exec(text ?? "");
        const v = await worldPinsInView(page);
        return { ok: !!m && Number(m[1]) >= v.min && Number(m[1]) <= v.max, n: m ? Number(m[1]) : null, inView: v };
      };
      const maps0 = await page.evaluate(() => document.querySelectorAll(".maplibregl-map").length);
      const el0 = await page.evaluate((W) => { const e = document.querySelector(`${W} .maplibregl-map`); window.__worldEl = e; return !!e; }, W);
      const wt0 = await worldTitles(page);
      const lt0 = await localTitles(page);
      checks.push(c("S baseline: two map instances on the page (.maplibregl-map count)", maps0 === 2 && el0, { maps0 }));
      checks.push(c("S baseline (All categories): world map draws exactly the returned pins (every world fixture included) and local map every nearby fixture", same(wt0, lastPinsTitles()) && incl(wt0, allWorld) && same(lt0, allLocal), { world: wt0, local: lt0 }));
      const cap0 = await caption(page);
      const k0 = await capOk("All categories", cap0);
      checks.push(c("S baseline caption is 'Explore the world " + MID + " All categories " + MID + " {n} postings in view' with n = pins inside the visible map", k0.ok, { cap0, ...k0 }));
      await scrollWorldIntoView(page);
      await shot(page, `stage4-${vp}-S-all`);

      // --- Sports
      let mark = mock.log.length;
      await pickCategory(page, "Sports");
      checks.push(c('S trigger reads "Category: Sports"', /^Category: Sports/.test((await triggerText(page)) ?? ""), await triggerText(page)));
      await waitIdle(page);
      const reqs = mock.log.slice(mark);
      const sportsT = WORLD.filter((p) => p.categorySlug === "sports").map((p) => p.title);
      const localSportsT = LOCAL.filter((p) => p.categorySlug === "sports").map((p) => p.title);
      const wt1 = await worldTitles(page);
      const lt1 = await localTitles(page);
      checks.push(c("S Sports: world map shows only Sports pins (all world Sports fixtures), no Community pin (Req 14.2)", same(wt1, lastPinsTitles()) && incl(wt1, sportsT) && wt1.every((t) => /Sports/.test(t)), { world: wt1 }));
      checks.push(c("S Sports: local map shows only Sports pins, no Community pin (Req 14.2)", same(lt1, localSportsT) && !lt1.some((t) => /Community/.test(t)), { local: lt1 }));
      const pinReqs = reqs.filter((r) => r.mode === "pins");
      const cardReqs = reqs.filter((r) => r.mode === "cards");
      checks.push(c("S Sports: every world request after the change carries category=sports and the last one returned only Sports (Req 14.1)", pinReqs.length > 0 && pinReqs.every((r) => r.category === "sports"), pinReqs.map((r) => r.search)));
      checks.push(c("S Sports: every local request after the change carries category=sports (Req 14.1)", cardReqs.length > 0 && cardReqs.every((r) => r.category === "sports"), cardReqs.map((r) => r.search)));
      const cap1 = await caption(page);
      const k1 = await capOk("Sports", cap1);
      checks.push(c("S Sports caption is 'Explore the world " + MID + " Sports " + MID + " {n} postings in view' with n = Sports pins inside the visible map (Req 14.4)", k1.ok, { cap1, ...k1 }));
      await shot(page, `stage4-${vp}-S-sports`);

      // --- Classes: singular
      await pickCategory(page, "Classes");
      await waitIdle(page);
      const cap2 = await caption(page);
      checks.push(c(`S Classes (one pin) caption uses the singular: "Explore the world ${MID} Classes ${MID} 1 posting in view"`, cap2 === `Explore the world ${MID} Classes ${MID} 1 posting in view`, { cap2 }));

      // --- Nightlife: empty
      mark = mock.log.length;
      await pickCategory(page, "Nightlife");
      await waitIdle(page);
      const wt3 = await worldTitles(page);
      const txt3 = await worldText(page);
      checks.push(c('S Nightlife (no postings): world map shows "No Nightlife postings in this view." and no pins (Req 14.6)', /No Nightlife postings in this view\./.test(txt3) && wt3.length === 0, { wt3, txt3: txt3.slice(0, 200) }));
      const btn = await page.evaluate((W) => {
        const b = [...document.querySelectorAll(`${W} button`)].find((x) => x.textContent.trim() === "Show all categories");
        if (!b) return null;
        const r = b.getBoundingClientRect();
        const cs = getComputedStyle(b);
        const vis = r.width > 0 && r.height > 0;
        return { w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, bg: cs.backgroundColor, color: cs.color, vis, inViewport: r.top >= 0 && r.bottom <= innerHeight };
      }, W);
      checks.push(c('S empty state: "Show all categories" button is navy (rgb(31, 46, 77)) and at least 44 x 44 px (Req 14.6)', !!btn && btn.vis && btn.bg === NAVY_RGB && btn.w >= 44 && btn.h >= 44, btn));
      await shot(page, `stage4-${vp}-S-empty`);

      // --- Show all categories
      mark = mock.log.length;
      await page.click(`${W} button:text-is("Show all categories")`);
      await waitIdle(page);
      const after = mock.log.slice(mark);
      const lastPins = [...after].reverse().find((r) => r.mode === "pins");
      const lastCards = [...after].reverse().find((r) => r.mode === "cards");
      checks.push(c("S Show all categories: the selection becomes All categories (trigger reads \"Category: All\")", /^Category: All/.test((await triggerText(page)) ?? ""), await triggerText(page)));
      checks.push(c("S Show all categories: world request has no category (Req 14.7)", !!lastPins && lastPins.category === null && after.filter((r) => r.mode === "pins").every((r) => r.category === null), after.filter((r) => r.mode === "pins").map((r) => r.search)));
      checks.push(c("S Show all categories: local request has no category afterwards (Req 14.7)", !!lastCards && lastCards.category === null && after.filter((r) => r.mode === "cards").every((r) => r.category === null), after.filter((r) => r.mode === "cards").map((r) => r.search)));
      const wt4 = await worldTitles(page);
      const lt4 = await localTitles(page);
      checks.push(c("S Show all categories: both maps show every category again", same(wt4, lastPinsTitles()) && incl(wt4, allWorld) && same(lt4, allLocal), { world: wt4, local: lt4 }));
      const k4 = await capOk("All categories", await caption(page));
      checks.push(c("S caption back to 'Explore the world " + MID + " All categories " + MID + " {n} postings in view'", k4.ok, { cap: await caption(page), ...k4 }));

      // --- one world map instance across all of the above (Req 15.1)
      const inst = await page.evaluate((W) => ({
        maps: document.querySelectorAll(".maplibregl-map").length,
        worldCanvases: document.querySelectorAll(`${W} canvas.maplibregl-canvas`).length,
        sameElement: window.__worldEl === document.querySelector(`${W} .maplibregl-map`) && document.contains(window.__worldEl),
        canvasAdds: window.__canvasAdds,
      }), W);
      checks.push(c("S the world map is created once: 2 .maplibregl-map elements, 1 world canvas, same DOM node, 0 canvas/map nodes added after load across 4 category changes (Req 15.1)", inst.maps === 2 && inst.worldCanvases === 1 && inst.sameElement && inst.canvasAdds === 0, inst));
      for (const x of netChecks(net, "S", NEEDLES)) checks.push(x);
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "S no horizontal scroll" });
      checks.push(c("S no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== T: 5,000 postings, capped at 300
    await scn("T", async () => {
      const { page, errors, context, mock, net } = await start(BIG);
      await scrollWorldIntoView(page);
      const cap = await caption(page);
      const wt = await worldTitles(page);
      const lastPins = [...mock.log].reverse().find((r) => r.mode === "pins");
      checks.push(c('T 5,000 fixture: caption is exactly "Showing 300 of many postings in this view. Zoom in to see more." (Req 14.5)', cap === "Showing 300 of many postings in this view. Zoom in to see more.", { cap, lastPins: lastPins && { returned: lastPins.returned, truncated: lastPins.truncated } }));
      checks.push(c("T the mock returned exactly 300 pins with truncated=true, and the map draws 300 markers (not 5,000)", !!lastPins && lastPins.returned === 300 && lastPins.truncated === true && wt.length === 300, { returned: lastPins?.returned, drawn: wt.length }));
      const txt = await worldText(page);
      checks.push(c("T no posting total on the map caption or section other than the 300 limit (Req 14.8)", !/5,?000/.test(txt) && !/\bin view\b/.test(cap ?? ""), { cap }));
      checks.push(c("T no pins-mode response exceeded 300 and no cards-mode response exceeded 100", mock.log.every((r) => (r.returned ?? 0) <= (r.mode === "cards" ? CARD_CAP : PIN_CAP)), mock.log.map((r) => `${r.mode}:${r.returned}`).slice(0, 8)));
      await shot(page, `stage4-${vp}-T-truncated`);
      // Zooming in leaves the truncated state once fewer than 300 are in the box.
      const mark = mock.log.length;
      let steps = 0;
      for (; steps < 10; steps++) {
        await page.click(`${W} .maplibregl-ctrl-zoom-in`);
        await sleep(450);
        await waitIdle(page);
        if (!/^Showing 300 of many/.test((await caption(page)) ?? "")) { steps++; break; }
      }
      notes.T = { zoomInSteps: steps };
      const cap2 = await caption(page);
      const last2 = [...mock.log.slice(mark)].reverse().find((r) => r.mode === "pins");
      // Req 14.4: n counts the drawn pins inside the visible view (the snapped request box is a little larger),
      // i.e. markers whose anchor (element centre) lies inside the map container (+-1.5 px for pixel rounding).
      const inView = await worldPinsInView(page);
      const drawn2 = (await worldTitles(page)).length;
      const capM = new RegExp(`^Explore the world ${MID} All categories ${MID} (\\d+) (posting|postings) in view$`).exec(cap2 ?? "");
      const n2 = capM ? Number(capM[1]) : -1;
      checks.push(c('T zoomed in (until fewer than 300 are in view): the caption returns to "Explore the world · All categories · {n} postings in view" with n equal to the drawn pins inside the visible view (not all pins returned for the snapped box)', !!last2 && last2.truncated === false && !!capM && capM[2] === (n2 === 1 ? "posting" : "postings") && n2 >= inView.min && n2 <= inView.max && n2 <= drawn2, { cap2, inView, drawn: drawn2, last2: last2 && { returned: last2.returned, truncated: last2.truncated } }));
      for (const x of netChecks(net, "T", NEEDLES)) checks.push(x);
      checks.push(c("T no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== D1: several pans within 400 ms produce one request
    await scn("D1", async () => {
      const { page, errors, context, net } = await start(DATA);
      await scrollWorldIntoView(page);
      const before = (await fetchLog(page)).length;
      const ups = [];
      ups.push(await drag(page, -50, 0));
      await sleep(40);
      ups.push(await drag(page, 0, 40));
      await sleep(40);
      ups.push(await drag(page, 50, 0));
      const lastUp = ups[ups.length - 1];
      await waitIdle(page, 1200);
      const recs = (await fetchLog(page)).slice(before);
      const gaps = ups.slice(1).map((u, i) => Math.round(u - ups[i]));
      const dt = recs.length ? Math.round(recs[0].t0 - lastUp) : null;
      checks.push(c(`D1 three pans with gaps of ${gaps.join(" and ")} ms between releases (each < 400) produce exactly one request (Req 15.3)`, recs.length === 1 && gaps.every((g) => g < 400), { requests: recs.length, gaps }));
      checks.push(c("D1 that request starts about 400 ms after the last pan (380 to 700 ms), none during the burst", recs.length === 1 && dt >= 380 && dt <= 700 && recs[0].t0 > lastUp, { dtMs: dt }));
      notes.D1 = { gaps, dtMs: dt };
      for (const x of netChecks(net, "D1", NEEDLES)) checks.push(x);
      checks.push(c("D1 no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== D2: abort of the earlier request, slow stale response, "Updating..." timing, pins stay
    await scn("D2", async () => {
      const { page, errors, context, mock, net } = await start(DATA);
      await scrollWorldIntoView(page);
      const titles0 = await worldTitles(page);
      await page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.forEach((m) => (m.dataset.keep = "1")));
      mock.pinPlan.push({ delayMs: 4000, extra: [STALE] }); // slow, and carries a posting no later response has
      const n0 = (await fetchLog(page)).length;
      await drag(page, -45, 0);
      await waitForNewFetch(page, n0, 3000);
      await sleep(900); // R1 is still in flight; "Updating..." is due 300 ms after it started
      const midTitles = await worldTitles(page);
      const keptMid = await page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.filter((m) => m.dataset.keep === "1").length);
      const midText = await worldText(page);
      // second pan while R1 is in flight
      const n1 = (await fetchLog(page)).length;
      const pinY = () => page.$eval(`${W} .maplibregl-marker[aria-label]`, (m) => Math.round(m.getBoundingClientRect().top));
      const y0 = await pinY();
      await drag(page, 0, 40);
      const y1 = await pinY();
      notes.D2pan2 = { pinTopBefore: y0, pinTopAfter: y1 };
      await waitForNewFetch(page, n1, 3000);
      await waitIdle(page, 1200);
      const recs = (await fetchLog(page)).slice(n0);
      const ui = await uiLog(page);
      const [r1, r2] = recs;
      notes.D2 = { urls: recs.map((r) => r.url), mockSearches: mock.log.slice(-3).map((r) => r.search), t0s: recs.map((r) => Math.round(r.t0)) };
      checks.push(c("D2 two pans with a slow first request give exactly two requests", recs.length === 2, recs.map((r) => ({ t0: Math.round(r.t0), aborted: r.abortedAt !== null, outcome: r.outcome }))));
      checks.push(c("D2 the earlier (slow) request was aborted by the page when the later one was sent (Req 15.4)", !!r1 && r1.abortedAt !== null && r1.outcome === "AbortError" && !!r2 && Math.abs(r1.abortedAt - r2.t0) < 60, { abortGapMs: r1 && r2 && r1.abortedAt !== null ? Math.round(r1.abortedAt - r2.t0) : null, r1: r1 && r1.outcome, r2: r2 && r2.outcome }));
      checks.push(c("D2 the later request was not aborted and succeeded", !!r2 && r2.abortedAt === null && r2.outcome === "http 200", r2));
      // Updating... timing against R1
      const updOn = ui.find((u) => u.upd && r1 && u.t >= r1.t0);
      const delta = updOn && r1 ? Math.round(updOn.t - r1.t0) : null;
      checks.push(c('D2 "Updating…" appears about 300 ms after the slow request starts (280 to 650 ms), not earlier (Req 15.9)', delta !== null && delta >= 280 && delta <= 650, { deltaMs: delta }));
      checks.push(c('D2 while "Updating…" showed, the previous pins stayed (same markers, same DOM elements)', same(midTitles, titles0) && keptMid === titles0.length && /Updating…/.test(midText), { midTitles: midTitles.length, keptMid, expected: titles0.length }));
      const last = ui[ui.length - 1];
      checks.push(c('D2 "Updating…" is hidden once the latest request has settled (Req 15.10)', last && !last.upd && !/Updating…/.test(await worldText(page)), last));
      // stale response ignored, no failure shown for the aborted request
      checks.push(c("D2 the aborted slow request's posting (FX STALE ONLY) never appeared (Req 15.5)", !ui.some((u) => u.stale), { staleSeen: ui.filter((u) => u.stale).length }));
      checks.push(c("D2 the replaced (aborted) request is not a failure: no retry button, no error message ever shown (Req 15.7)", !ui.some((u) => u.retry || u.err), { retryOrErr: ui.filter((u) => u.retry || u.err).length }));
      // same markers are not recreated
      const returned = new Set(mock.log[mock.log.length - 1].titles ?? []);
      const kept = await page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.map((m) => [m.getAttribute("aria-label"), m.dataset.keep === "1"]));
      const shouldKeep = kept.filter(([t]) => titles0.includes(t) && returned.has(t));
      checks.push(c("D2 markers present before and after the response were kept, not recreated (Req 15.2)", shouldKeep.length > 0 && shouldKeep.every(([, k]) => k), { shouldKeep: shouldKeep.length, recreated: shouldKeep.filter(([, k]) => !k).map(([t]) => t) }));
      await shot(page, `stage4-${vp}-D2`);
      for (const x of netChecks(net, "D2", NEEDLES)) checks.push(x);
      checks.push(c("D2 no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== D2b: fast responses never show "Updating..."
    await scn("D2b", async () => {
      const { page, context } = await start(DATA);
      await scrollWorldIntoView(page);
      const n0 = (await fetchLog(page)).length;
      const t = await nowIn(page);
      await drag(page, -45, 0);
      await waitForNewFetch(page, n0, 3000);
      await waitIdle(page, 1000);
      const ui = (await uiLog(page)).filter((u) => u.t >= t);
      checks.push(c('D2b an instant response never shows "Updating…" (label only after 300 ms in flight)', !ui.some((u) => u.upd), { states: ui.length }));
      await context.close();
    });

    // ===== D3: a response for a category that is no longer selected is discarded
    await scn("D3", async () => {
      const { page, errors, context, mock } = await start(DATA);
      await scrollWorldIntoView(page);
      mock.pinPlan.push({ delayMs: 450, extra: [STALE_CAT] });
      const n0 = (await fetchLog(page)).length;
      const t0 = await nowIn(page);
      await drag(page, -45, 0);
      await waitForNewFetch(page, n0, 3000);
      await pickCategory(page, "Sports"); // while the slow All-categories request is in flight
      await waitIdle(page, 1200);
      const recs = (await fetchLog(page)).slice(n0);
      const r1 = recs[0];
      const sportsRec = recs.find((r) => /category=sports/.test(r.url) && /mode=pins/.test(r.url)); // the world request for the new category
      const changeRec = recs.find((r) => /category=sports/.test(r.url) && /mode=cards/.test(r.url)); // local map reacts at once: marks the change
      const delivered = !!r1 && r1.outcome === "http 200" && !!changeRec && !!sportsRec && r1.settledAt > changeRec.t0 && r1.settledAt < sportsRec.t0;
      const ui = (await uiLog(page)).filter((u) => u.t >= t0);
      const wt = await worldTitles(page);
      const sportsT = WORLD.filter((p) => p.categorySlug === "sports").map((p) => p.title);
      checks.push(c(`D3 the old-category response ${delivered ? "arrived after the change and was discarded" : "did not arrive between the change and the new request (stale path not exercised)"}: its pin never appeared, no error, no retry (Req 14.3)`, !ui.some((u) => u.stale || u.retry || u.err), { delivered, r1: r1 && { outcome: r1.outcome, abortedAt: r1.abortedAt }, staleSeen: ui.filter((u) => u.stale).length }));
      // The world map opens on the whole world, so on a wide screen the Sports view can also hold the local Sports fixtures.
      const lastSports = [...mock.log].reverse().find((r) => r.mode === "pins" && r.category === "sports" && r.outcome === "ok")?.titles ?? [];
      checks.push(c("D3 final world pins are exactly the last Sports response (every world Sports fixture, only Sports, no stale pin)", same(wt, lastSports) && sportsT.every((x) => wt.includes(x)) && wt.every((x) => /Sports/.test(x)), { wt }));
      const capD3 = await caption(page);
      const mD3 = new RegExp("^Explore the world " + MID + " Sports " + MID + " (\\d+) postings? in view$").exec(capD3 ?? "");
      const vD3 = await worldPinsInView(page);
      checks.push(c("D3 final caption is 'Explore the world " + MID + " Sports " + MID + " {n} postings in view' with n = Sports pins inside the visible map", !!mD3 && Number(mD3[1]) >= vD3.min && Number(mD3[1]) <= vD3.max, { capD3, vD3 }));
      notes.D3 = { staleResponseDelivered: delivered, r1: r1 && { outcome: r1.outcome, settledAfterStartMs: r1.settledAt && Math.round(r1.settledAt - r1.t0), abortedAfterStartMs: r1.abortedAt && Math.round(r1.abortedAt - r1.t0) }, categoryChangeAtMs: changeRec && r1 ? Math.round(changeRec.t0 - r1.t0) : null, newWorldRequestAtMs: sportsRec && r1 ? Math.round(sportsRec.t0 - r1.t0) : null };
      checks.push(c("D3 no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== D4: retry after a failed request (HTTP 500, then a network error)
    await scn("D4", async () => {
      const { page, errors, context, mock, net } = await start(DATA);
      await scrollWorldIntoView(page);
      const titles0 = await worldTitles(page);
      await page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.forEach((m) => (m.dataset.keep = "1")));
      for (const kind of ["status 500", "network error"]) {
        mock.pinPlan.push(kind === "status 500" ? { status: 500 } : { abort: true });
        const n0 = (await fetchLog(page)).length;
        await drag(page, kind === "status 500" ? -45 : 45, 0);
        await waitForNewFetch(page, n0, 3000);
        await sleep(1300);
        const recs = (await fetchLog(page)).slice(n0);
        const r1 = recs[0];
        const ui = await uiLog(page);
        const retryOn = ui.find((u) => u.retry && r1 && u.t >= r1.t0);
        const lag = retryOn && r1 && r1.settledAt ? Math.round(retryOn.t - r1.settledAt) : null;
        const pinsNow = await worldTitles(page);
        const keptNow = await page.$$eval(`${W} .maplibregl-marker[aria-label]`, (ms) => ms.filter((m) => m.dataset.keep === "1").length);
        checks.push(c(`D4 ${kind}: the retry button shows within 1 s of the failure (Req 15.6)`, lag !== null && lag <= 1000, { lagMs: lag, outcome: r1 && r1.outcome }));
        checks.push(c(`D4 ${kind}: all current pins are kept while the error shows`, same(pinsNow, titles0) && keptNow === titles0.length, { pinsNow: pinsNow.length, keptNow, expected: titles0.length }));
        const alertTxt = await page.$eval(`${W} [role="alert"]`, (a) => a.textContent.trim()).catch(() => null);
        notes[`D4 ${kind}`] = { lagMs: lag, alert: alertTxt };
        // retry
        const nBefore = (await fetchLog(page)).length;
        const tClick = await nowIn(page);
        await page.click(`${W} button:text-is("Try again")`);
        await waitForNewFetch(page, nBefore, 2500);
        await sleep(300);
        await waitIdle(page, 1000);
        const after = (await fetchLog(page)).slice(nBefore);
        const ui2 = (await uiLog(page)).filter((u) => u.t >= tClick);
        const hidden = ui2.find((u) => !u.retry);
        const hiddenAfter = hidden ? Math.round(hidden.t - tClick) : null;
        checks.push(c(`D4 ${kind}: "Try again" sends exactly one request for the current viewport (same URL as the failed one), the button is hidden afterwards (Req 15.8)`, after.length === 1 && !!r1 && after[0].url === r1.url && hiddenAfter !== null && !(await page.$(`${W} button:text-is("Try again")`)), { requests: after.length, sameUrl: after[0] && r1 ? after[0].url === r1.url : null, hiddenAfterMs: hiddenAfter }));
        notes[`D4 ${kind}`].hiddenAfterClickMs = hiddenAfter;
      }
      for (const x of netChecks(net, "D4", NEEDLES)) checks.push(x);
      checks.push(c("D4 no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== P: page load, HTML payload and request log (Req 13.14)
    await scn("P", async () => {
      const mock = makeMock(DATA);
      const o = await newPage(browser, vp, { savedCenter: null, geolocation: "denied" });
      await o.context.addInitScript(INSTRUMENT);
      await installMock(o.page, mock);
      const net = trackNet(o.page, server.baseUrl);
      const resp = await o.page.goto(server.baseUrl + "/", { waitUntil: "load" });
      const html = await resp.text();
      await o.page.waitForSelector("main", { timeout: 15000 });
      await sleep(2000);
      await waitIdle(o.page);
      const embedded = ["london-quiet-sounds", "berlin-miso-missing", "mexico-mercado-barrio", "An evening of quiet sounds", "Miso is missing", "Mercado del barrio"].filter((s) => html.includes(s));
      const postingObjs = (html.match(/\\"categorySlug\\"|"categorySlug"/g) ?? []).length;
      checks.push(c("P the page HTML embeds no world posting (no seed posting id or title; 0 posting objects outside the capped initial list)", embedded.length === 0 && postingObjs <= CARD_CAP, { embedded, postingObjs, htmlBytes: html.length }));
      const api = net.filter((r) => r.sameOrigin && r.path.startsWith("/api/") && r.path !== "/api/messages/unread"); // the Stage 5b unread poll (BottomNav) is not a postings request
      const kinds = api.map((r) => `${r.method} ${r.path}${r.path === "/api/postings/map" ? " " + (r.full.match(/mode=(\w+)/)?.[1] ?? "?") : ""}`);
      const mapReq = api.filter((r) => r.path === "/api/postings/map");
      const modes = mapReq.map((r) => r.full.match(/mode=(\w+)/)?.[1]);
      checks.push(c("P page load makes only /api/postings/map requests: pins for the world map, no cards request (server list used), no other /api/postings call (Req 13.14)", api.length === mapReq.length && modes.length >= 1 && modes.every((m) => m === "pins"), { kinds }));
      checks.push(c("P page load issues at most 3 world pin requests (first view and one refit)", modes.length <= 3, { count: modes.length }));
      notes.P = { kinds, htmlBytes: html.length, postingObjs };
      for (const x of netChecks(net, "P", NEEDLES)) checks.push(x);
      await o.context.close();
    });
    await scn("P2", async () => {
      const { page, context, mock, net } = await start(DATA);
      const api = net.filter((r) => r.sameOrigin && r.path.startsWith("/api/") && r.path !== "/api/messages/unread"); // the Stage 5b unread poll (BottomNav) is not a postings request
      const modes = mock.log.map((r) => r.mode);
      checks.push(c("P2 with a saved map centre the load makes only cards (capped at 100) and pins requests, nothing else under /api", api.every((r) => r.path === "/api/postings/map") && modes.filter((m) => m === "cards").length <= 2 && modes.every((m) => m === "cards" || m === "pins"), { modes }));
      await context.close();
    });

    // ===== G: device location stays in the browser (Req 20.2)
    await scn("G", async () => {
      const { page, errors, context, net } = await start(DATA, { savedCenter: null, geolocation: "ok", position: SF });
      await page.click('button:text-is("Use my location")');
      await waitIdle(page, 1200);
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      const maps = net.filter((r) => r.sameOrigin && r.path === "/api/postings/map");
      checks.push(c("G the stubbed device position was requested (not a real permission) and map requests followed", geoCalls >= 1 && maps.length >= 2, { geoCalls, maps: maps.length }));
      for (const x of netChecks(net, "G", NEEDLES)) checks.push(x);
      checks.push(c("G no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    out.viewports[vp] = { size: VIEWPORTS[vp], checks, notes };
    console.log(`\n== ${vp} ${VIEWPORTS[vp].width}x${VIEWPORTS[vp].height}`);
    report(checks);
    console.log("notes:", JSON.stringify(notes));
    if (checks.some((x) => !x.pass)) anyFail = true;
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log("\nresults:", writeResults("stage4", out));
console.log(anyFail ? "STAGE 4: FAIL" : "STAGE 4: PASS");
process.exitCode = anyFail ? 1 : 0;
