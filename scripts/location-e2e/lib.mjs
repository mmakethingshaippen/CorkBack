import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { BLANK_PNG, GEOCODE_ANSWERS, POSTING_ANSWERS, STUB_POSITION, VIEWPORTS } from "./fixtures.mjs";

// Browser harness for the posting location work. Everything external is mocked or blocked:
// the real geocoder, the production database and every non-local host. See README.md.

// Work dir (screenshots, results) lives outside the repo.
export const WORK = process.env.CB_E2E_DIR ?? path.join(os.tmpdir(), "cb_location_e2e");
fs.mkdirSync(path.join(WORK, "shots"), { recursive: true });

// `next start` runs in the scratch build copy (no .env.local). Set CB_REPO when the scripts are copied elsewhere.
export const REPO = process.env.CB_REPO ?? fileURLToPath(new URL("../../", import.meta.url));
export const EDGE = process.env.CB_EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export { VIEWPORTS, GEOCODE_ANSWERS, POSTING_ANSWERS };

export const DARK_RED_RGB = "rgb(140, 43, 31)";
export const MOCK_PORT = Number(process.env.CB_MOCK_PORT ?? 3299);
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
const PRODUCTION_REF = "djdmiqxzcgjdwcxqqrzk";

// ---------------------------------------------------------------- mock Supabase (server-side reads/RPCs only)
export const OWNER = "fx_owner";
export const OWNER_ID = "00000000-0000-4000-8000-000000000001";
export const uuid = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
/** A postings row as PostgREST returns it, for the detail and edit pages. */
export const postingRow = (n, over = {}) => ({
  id: uuid(n),
  title: "FX posting",
  body: "Fixture body for browser tests.",
  flyer_url: null,
  rsvp_url: null,
  event_date: null,
  event_time: null,
  end_date: null,
  end_time: null,
  time_zone: "America/Los_Angeles",
  place_label: "Cedar Hall",
  lat: 37.8715,
  lng: -122.273,
  location_precision: "exact",
  expiry: "1m",
  expires_at: "2099-12-31T00:00:00.000Z",
  is_promoted: false,
  created_at: "2026-11-01T10:00:00.000Z",
  profiles: { username: OWNER, avatar_path: null },
  categories: { slug: "community" },
  ...over,
});

const b64url = (s) => Buffer.from(s).toString("base64url");
const FAKE_JWT = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: OWNER_ID, role: "authenticated", exp: 4102444800 }))}.${b64url("sig")}`;
const MOCK_USER = { id: OWNER_ID, aud: "authenticated", role: "authenticated", email: "fx_owner@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
const SESSION = { access_token: FAKE_JWT, refresh_token: "fx-refresh", expires_at: 4102444800, expires_in: 3600, token_type: "bearer", user: MOCK_USER };
export const SESSION_COOKIE = { name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSION)) };

/**
 * Local mock Supabase on 127.0.0.1:CB_MOCK_PORT. Answers /auth/v1/user, `postings` rows by `id=eq.<id>`
 * (from `rows`, an object or array of postingRow values) and an empty result for everything else.
 * RPCs are answered with an empty result and RECORDED in `rpcs` (the geocoder slot and cache functions
 * and cb_update_posting_location are never reached by the browser flows, so a hit is worth reporting).
 * The scratch build must be made with NEXT_PUBLIC_SUPABASE_URL=MOCK_URL.
 */
export function startMock(rows = {}) {
  const list = Array.isArray(rows) ? rows : Object.values(rows);
  const hits = [];
  const rpcs = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, MOCK_URL);
    hits.push(`${req.method} ${url.pathname}`);
    req.resume();
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/auth/v1/user") return send(200, MOCK_USER);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      rpcs.push(url.pathname.slice("/rest/v1/rpc/".length));
      return send(200, []);
    }
    if (url.pathname.startsWith("/rest/v1/")) {
      const table = url.pathname.slice("/rest/v1/".length);
      let out = [];
      if (table === "postings") {
        const id = url.searchParams.get("id");
        if (id?.startsWith("eq.")) out = list.filter((r) => r.id === id.slice(3));
      } else if (table === "profiles") out = [{ id: OWNER_ID, username: OWNER, avatar_path: null }];
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return out.length === 1 ? send(200, out[0]) : send(406, { code: "PGRST116", message: "no rows", details: "", hint: null });
      }
      return send(200, out);
    }
    send(404, { message: "not mocked" });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_PORT, "127.0.0.1", () => resolve({ hits, rpcs, stop: () => new Promise((r) => server.close(r)) }));
  });
}

// ---------------------------------------------------------------- next start
function freePort(start) {
  return new Promise((resolve) => {
    const tryPort = (p) => {
      const s = net.createServer();
      s.once("error", () => tryPort(p + 1));
      s.once("listening", () => s.close(() => resolve(p)));
      s.listen(p, "127.0.0.1");
    };
    tryPort(start);
  });
}

/**
 * Start `next start` against the local mock Supabase. The geocoder variables are set to EMPTY, so the
 * route's own config check stays disabled and no upstream call can ever be made, even if a request
 * were to reach the server (the browser intercepts /api/geocode first). Returns { baseUrl, stop }.
 * CB_BASE_URL uses a server you started yourself (stop() is then a no-op).
 */
export async function startServer(startPort = 3200) {
  if (process.env.CB_BASE_URL) return { baseUrl: process.env.CB_BASE_URL, stop: async () => {} };
  const port = await freePort(startPort);
  const nextBin = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: REPO,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: MOCK_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fx-anon-key",
      SUPABASE_SERVICE_ROLE_KEY: "fx-service-key",
      GEOCODER_URL: "",
      GEOCODER_USER_AGENT: "",
      GEOCODER_REFERER: "",
      GEOCODER_API_KEY: "",
      GEOCODER_CACHE_SECRET: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  const baseUrl = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode !== null) return;
    await new Promise((res) => {
      const k = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true });
      k.on("exit", res);
      k.on("error", res);
    });
  };
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error(`next start exited early:\n${log}`);
    try {
      const r = await fetch(baseUrl + "/api/auth/sign-in", { method: "GET" });
      if (r.status > 0) return { baseUrl, stop };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await stop();
  throw new Error(`next start did not become ready:\n${log}`);
}

export async function launchEdge() {
  return chromium.launch({ channel: "msedge", executablePath: fs.existsSync(EDGE) ? EDGE : undefined, headless: true });
}

// ---------------------------------------------------------------- page factory
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" };
const json = (route, [status, body]) => route.fulfill({ status, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
const parseBody = (req) => {
  try {
    return JSON.parse(req.postData() ?? "null");
  } catch {
    return { __unparsable: req.postData() };
  }
};

/**
 * New isolated context + page with every external thing mocked. Returns
 * { context, page, errors, h } where `h` is the live recorder and control surface:
 *
 *   h.geocodeRequests  [{ url, q }]       every /api/geocode request (q = decoded `q` parameter)
 *   h.scanRequests     [{ url, method }]  every /api/scan/extract request
 *   h.posts            [body]             POST /api/postings bodies
 *   h.patches          [{ id, body }]     PATCH /api/postings/:id bodies
 *   h.retries          [{ id, body }]     PATCH /api/postings/:id/location bodies
 *   h.external         [url]              any request to a non-local host that was blocked (must stay empty)
 *   h.geocode          current answer: a GEOCODE_ANSWERS key, a [status, body] pair, or (url) => [status, body] | { answer, delayMs }
 *   h.patchAnswer / h.retryAnswer / h.postAnswer   POSTING_ANSWERS keys or [status, body] pairs (settable between steps)
 *   h.geoCalls()       the stub's getCurrentPosition + watchPosition call count in the page
 *
 * opts:
 *   flyer            object returned by /api/scan/extract as `{ extracted }`, and seeded in
 *                    sessionStorage["corkback.extracted"] for /scan/review (null = nothing seeded)
 *   geocode          initial h.geocode (default "empty")
 *   geolocation      "granted" (fix after delayMs), "denied" (error code 1) or "absent" (navigator.geolocation undefined)
 *   permission       navigator.permissions state for "geolocation": "prompt" (never asked, default), "granted", "denied"
 *   position         stubbed fix { latitude, longitude, accuracy }
 *   geoDelayMs       delay before the stub answers
 *   savedBoardCenter value seeded into localStorage["corkback.mapCenter"] (default none; the picker must ignore it)
 *   signedIn         add the fake session cookie (default true)
 *   routes           { "/path": (route) => ... } extra pathname handlers
 *   baseUrl          required when signedIn (cookies need a URL)
 *
 * Any request to a host other than 127.0.0.1/localhost is aborted and listed in h.external, and
 * the production Supabase ref in a URL is reported the same way. Tiles get a blank PNG, and a
 * direct Nominatim request (which the picker must never make) is answered with [] and recorded
 * in h.external as well.
 */
export async function newPage(browser, viewportName, opts = {}) {
  const viewport = VIEWPORTS[viewportName];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewportName === "mobile" });
  const geolocation = opts.geolocation ?? "granted";
  const permission = opts.permission ?? "prompt";
  const delay = opts.geoDelayMs ?? 0;
  await context.addInitScript(
    ({ geolocation, permission, pos, delay, board, flyer }) => {
      try {
        if (board) localStorage.setItem("corkback.mapCenter", JSON.stringify(board));
        if (flyer && location.pathname === "/scan/review" && !sessionStorage.getItem("corkback.extracted")) {
          sessionStorage.setItem("corkback.extracted", JSON.stringify(flyer));
        }
      } catch {}
      window.__geoCalls = 0;
      const fix = () => ({ coords: { ...pos, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      const answer = (ok, err, ms) =>
        geolocation === "granted" ? setTimeout(() => ok(fix()), ms) : setTimeout(() => err && err({ code: 1, message: "denied", PERMISSION_DENIED: 1 }), ms);
      if (geolocation === "absent") {
        Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
      } else {
        const stub = {
          getCurrentPosition: (ok, err) => { window.__geoCalls++; answer(ok, err, delay); },
          watchPosition: (ok, err) => { window.__geoCalls++; answer(ok, err, 0); return 1; },
          clearWatch: () => {},
        };
        Object.defineProperty(navigator, "geolocation", { value: stub, configurable: true });
      }
      const perms = {
        query: async (d) => {
          if (d && d.name === "geolocation") return { state: permission, onchange: null, addEventListener() {}, removeEventListener() {} };
          throw new TypeError("unsupported");
        },
      };
      Object.defineProperty(navigator, "permissions", { value: perms, configurable: true });
    },
    { geolocation, permission, pos: opts.position ?? STUB_POSITION, delay, board: opts.savedBoardCenter ?? null, flyer: opts.flyer ?? null },
  );

  const h = {
    geocodeRequests: [],
    scanRequests: [],
    posts: [],
    patches: [],
    retries: [],
    external: [],
    geocode: opts.geocode ?? "empty",
    postAnswer: "postOk",
    patchAnswer: "patchOk",
    retryAnswer: "retryOk",
    geoCalls: null,
  };
  const pick = (table, v) => (Array.isArray(v) ? v : table[v]);

  await context.route("**/*", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
    if (!local) {
      if (url.hostname.endsWith("openstreetmap.org") && url.hostname.startsWith("tile")) {
        return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
      }
      // Anything else (including a direct geocoder call, any CDN, the production project) is blocked.
      h.external.push(req.url() + (req.url().includes(PRODUCTION_REF) ? "  [PRODUCTION SUPABASE]" : ""));
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      if (url.hostname.startsWith("nominatim")) return route.fulfill({ status: 200, contentType: "application/json", headers: CORS, body: "[]" });
      return route.abort();
    }
    const p = url.pathname;
    if (p === "/api/scan/extract") {
      h.scanRequests.push({ url: url.search, method: req.method() });
      return json(route, [200, { extracted: opts.flyer ?? null }]);
    }
    if (p === "/api/geocode") {
      h.geocodeRequests.push({ url: req.url(), q: url.searchParams.get("q") });
      let a = typeof h.geocode === "function" ? await h.geocode(url) : h.geocode;
      let delayMs = 0;
      if (a && !Array.isArray(a) && typeof a === "object") ({ answer: a, delayMs = 0 } = a);
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
      return json(route, pick(GEOCODE_ANSWERS, a));
    }
    if (p === "/api/postings" && req.method() === "POST") {
      h.posts.push(parseBody(req));
      return json(route, pick(POSTING_ANSWERS, h.postAnswer));
    }
    const m = p.match(/^\/api\/postings\/([^/]+)(\/location)?$/);
    if (m && req.method() === "PATCH") {
      if (m[2]) {
        h.retries.push({ id: m[1], body: parseBody(req) });
        return json(route, pick(POSTING_ANSWERS, h.retryAnswer));
      }
      h.patches.push({ id: m[1], body: parseBody(req) });
      return json(route, pick(POSTING_ANSWERS, h.patchAnswer));
    }
    if (opts.routes) {
      for (const [rp, handler] of Object.entries(opts.routes)) if (p === rp) return handler(route);
    }
    return route.continue();
  });

  if (opts.signedIn !== false) {
    if (!opts.baseUrl) throw new Error("newPage: opts.baseUrl is required when signedIn");
    await context.addCookies([{ ...SESSION_COOKIE, url: opts.baseUrl }]);
  }
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  h.geoCalls = () => page.evaluate(() => window.__geoCalls ?? 0);
  return { context, page, errors, h };
}

/** Load a path and give the page a short moment (never networkidle: the map keeps loading tiles). */
export async function open(page, baseUrl, p = "/", pauseMs = 1500) {
  await page.goto(baseUrl + p, { waitUntil: "load" });
  await page.waitForSelector("main", { timeout: 15000 });
  await page.waitForTimeout(pauseMs);
}

/**
 * A real mouse drag. Holds 175 ms before release so MapLibre does not apply inertia, then makes a 3 px
 * pointer move, because headless Edge otherwise delays MapLibre's `moveend` until the next pointer event.
 */
export async function dragMouse(page, from, to, steps = 12) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.waitForTimeout(175);
  await page.mouse.up();
  await page.mouse.move(to.x + 3, to.y + 3);
  await page.waitForTimeout(300);
}

// ---------------------------------------------------------------- checks
// Each check returns { name, pass, detail }. Callers record, not throw.

export async function checkNoHorizontalScroll(page) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  return { name: "no horizontal scroll", pass: m.scrollWidth <= m.clientWidth && m.bodyScrollWidth <= m.clientWidth, detail: m };
}

/** Visible links, buttons and inputs outside the map canvas are at least `min` px both ways; `primarySelectors` at least `primaryMin` tall. */
export async function checkTapTargets(page, { min = 44, primarySelectors = [], primaryMin = 50 } = {}) {
  const res = await page.evaluate(
    ({ min, primarySelectors, primaryMin }) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
      };
      const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 40);
      const small = [];
      for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")) {
        if (el.closest(".maplibregl-map")) continue;
        if (!vis(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < min || r.height < min) small.push({ label: label(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
      const primary = [];
      for (const sel of primarySelectors) {
        const el = document.querySelector(sel);
        if (!el) { primary.push({ sel, found: false }); continue; }
        const r = el.getBoundingClientRect();
        primary.push({ sel, found: true, h: Math.round(r.height), ok: r.height >= primaryMin });
      }
      return { small, primary };
    },
    { min, primarySelectors, primaryMin },
  );
  return { name: `tap targets >= ${min}px (primary >= ${primaryMin}px)`, pass: res.small.length === 0 && res.primary.every((p) => p.found && p.ok), detail: res };
}

/**
 * Exactly one visible dark-red (#8C2B1F) interactive element in the main content, outside the map, ignoring selected chips
 * (aria-pressed="true") and the app navigation. The raised Scan circle in BottomNav is the nav's own anchor action and is
 * unchanged by this feature (same split as scripts/board-e2e/stage1.mjs "outside bottom nav").
 */
export async function checkOneDarkRedAction(page) {
  const res = await page.evaluate((red) => {
    const out = [];
    for (const el of document.querySelectorAll("a[href], button, [role=button], a[href] span, button span")) {
      if (el.closest(".maplibregl-map") || el.closest("nav")) continue;
      if (el.getAttribute("aria-pressed") === "true") continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (getComputedStyle(el).backgroundColor !== red) continue;
      const host = el.closest("a[href], button, [role=button]");
      if (!host || out.some((o) => o.host === host)) continue;
      out.push({ host, label: (host.textContent || host.getAttribute("aria-label") || "").trim().slice(0, 40), top: Math.round(r.top) });
    }
    return out.map(({ label, top }) => ({ label, top }));
  }, DARK_RED_RGB);
  return { name: "exactly one dark-red main action", pass: res.length === 1, detail: { count: res.length, items: res } };
}

/** Fails if anything left the machine: external requests, production Supabase, any mock RPC hit. */
export function checkNothingExternal(h, mock) {
  // Layout RPCs (unread counts, reaction counts) are normal page traffic; only the feature's RPCs count.
  const rpcs = (mock?.rpcs ?? []).filter((n) => n.startsWith("cb_geocoder_") || n === "cb_update_posting_location");
  return { name: "no external or production request", pass: h.external.length === 0 && rpcs.length === 0, detail: { external: h.external, rpcs } };
}

export async function shot(page, name) {
  const file = path.join(WORK, "shots", `${name}.png`);
  await page.screenshot({ path: file });
  return file;
}

export function writeResults(name, data) {
  const file = path.join(WORK, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}

export function removeResults(name) {
  fs.rmSync(path.join(WORK, `${name}.json`), { force: true });
}

export function report(results) {
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  " + JSON.stringify(r.detail)}`);
}
