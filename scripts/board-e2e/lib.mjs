import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { BLANK_PNG, SAVED_CENTER, STUB_POSITION, VIEWPORTS, mapResponse } from "./fixtures.mjs";

// Work dir (screenshots, results) lives outside the repo.
export const WORK = process.env.CB_E2E_DIR ?? path.join(os.tmpdir(), "cb_board_e2e");
fs.mkdirSync(path.join(WORK, "shots"), { recursive: true });

// The repo is where `next start` runs. Defaults to two levels above this file
// (works when run in place); set CB_REPO when the scripts are copied elsewhere.
export const REPO = process.env.CB_REPO ?? fileURLToPath(new URL("../../", import.meta.url));
export const EDGE = process.env.CB_EDGE ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
export { VIEWPORTS };

export const DARK_RED_RGB = "rgb(140, 43, 31)";

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
 * Start `next start` as a child with EMPTY Supabase variables (seed mode) and
 * wait until it answers. Returns { baseUrl, stop }. Run `npm run build` first,
 * with the same three variables set to empty strings in the build environment.
 * Set CB_BASE_URL to use a server you started yourself (then stop() is a no-op).
 */
export async function startServer(startPort = 3200, { env: extraEnv = {} } = {}) {
  if (process.env.CB_BASE_URL) return { baseUrl: process.env.CB_BASE_URL, stop: async () => {} };
  const port = await freePort(startPort);
  const nextBin = path.join(REPO, "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    cwd: REPO,
    env: {
      ...process.env,
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
      SUPABASE_SERVICE_ROLE_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
      ...extraEnv, // stage3 points the Supabase URL at its local mock server
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
    // Kill the whole tree on Windows.
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

/**
 * New isolated context + page. Everything external is mocked or blocked:
 * map tiles (blank PNG), the geocoder, and /api/postings/map (fixture JSON,
 * override with opts.mapBody). `localStorage["corkback.mapCenter"]` is seeded
 * (opts.savedCenter = null leaves it empty) and navigator.geolocation is a stub
 * (opts.geolocation = "denied" makes it fail; opts.geoDelayMs delays the fix).
 * navigator.permissions.query({name:"geolocation"}) is stubbed too: it reports
 * opts.permission ("prompt" by default, or "granted" / "denied").
 * No real permission is requested.
 */
export async function newPage(browser, viewportName, opts = {}) {
  const viewport = VIEWPORTS[viewportName];
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, hasTouch: viewportName === "mobile" });
  const savedCenter = opts.savedCenter === undefined ? SAVED_CENTER : opts.savedCenter;
  const geo = opts.geolocation ?? "ok";
  const permission = opts.permission ?? "prompt";
  const delay = opts.geoDelayMs ?? 0;
  await context.addInitScript(
    ({ savedCenter, geo, pos, permission, delay }) => {
      try {
        if (savedCenter) localStorage.setItem("corkback.mapCenter", JSON.stringify(savedCenter));
      } catch {}
      window.__geoCalls = 0;
      const fix = () => ({ coords: { ...pos, altitude: null, altitudeAccuracy: null, heading: null, speed: null }, timestamp: Date.now() });
      const stub = {
        getCurrentPosition: (ok, err) => {
          window.__geoCalls++;
          return geo === "ok" ? setTimeout(() => ok(fix()), delay) : setTimeout(() => err && err({ code: 1, message: "denied" }), delay);
        },
        watchPosition: (ok, err) => {
          window.__geoCalls++;
          (geo === "ok" ? setTimeout(() => ok(fix()), 0) : setTimeout(() => err && err({ code: 1, message: "denied" }), 0));
          return 1;
        },
        clearWatch: () => {},
      };
      Object.defineProperty(navigator, "geolocation", { value: stub, configurable: true });
      window.__permQueries = 0;
      const perms = {
        query: async (d) => {
          window.__permQueries++;
          if (d && d.name === "geolocation") return { state: permission, onchange: null, addEventListener() {}, removeEventListener() {} };
          throw new TypeError("unsupported");
        },
      };
      Object.defineProperty(navigator, "permissions", { value: perms, configurable: true });
    },
    { savedCenter, geo, pos: opts.position ?? STUB_POSITION, permission, delay },
  );
  const mapRequests = [];
  const geocodeRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname.endsWith("openstreetmap.org") && url.hostname.startsWith("tile")) {
      return route.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG });
    }
    if (url.hostname.startsWith("nominatim")) {
      // Never reaches the real geocoder. opts.geocoderBody (array) is the canned answer.
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "GET, OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      geocodeRequests.push(url.search);
      return route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(opts.geocoderBody ?? []) });
    }
    if (url.pathname === "/api/postings/map") {
      mapRequests.push(url.search);
      if (opts.mapHandler) {
        // (URL) => { status?, body, delayMs? }; may read test state at call time.
        const r = await opts.mapHandler(url);
        if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs));
        return route.fulfill({ status: r.status ?? 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(r.body) });
      }
      const body = opts.mapBody ?? mapResponse();
      return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(body) });
    }
    if (opts.routes) {
      for (const [p, handler] of Object.entries(opts.routes)) {
        if (url.pathname === p) return handler(route);
      }
    }
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { context, page, errors, mapRequests, geocodeRequests };
}

/** Load a path and give the streaming map a short moment (never networkidle). */
export async function open(page, baseUrl, p = "/", pauseMs = 1500) {
  await page.goto(baseUrl + p, { waitUntil: "load" });
  await page.waitForSelector("main", { timeout: 15000 });
  await page.waitForTimeout(pauseMs);
}

// ---------------------------------------------------------------- checks
// Each check returns { name, pass, detail }. Callers record, not throw.

export async function checkNoHorizontalScroll(page) {
  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }));
  const pass = m.scrollWidth <= m.clientWidth && m.bodyScrollWidth <= m.clientWidth;
  return { name: "no horizontal scroll", pass, detail: m };
}

/**
 * Every visible link/button/input outside the map canvas is at least `min` px
 * in both dimensions (default 44). Map markers and MapLibre's own controls are
 * excluded here. Elements listed in `primarySelectors` must be at least 50 px tall.
 */
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
  const pass = res.small.length === 0 && res.primary.every((p) => p.found && p.ok);
  return { name: `tap targets >= ${min}px (primary >= ${primaryMin}px)`, pass, detail: res };
}

/**
 * Counts visible interactive elements painted with the dark-red background
 * (#8C2B1F) outside the map canvas, ignoring selected category chips
 * (`aria-pressed="true"`, a state not an action) and map pins. Exactly one is
 * the rule (design-tokens.md: one dark-red main action per screen).
 */
export async function checkOneDarkRedAction(page) {
  const res = await page.evaluate((red) => {
    const out = [];
    const all = document.querySelectorAll("a[href], button, [role=button], a[href] span, button span");
    for (const el of all) {
      if (el.closest(".maplibregl-map")) continue;
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

/**
 * Geometry of the home map (the first `.maplibregl-map` on the page, scrolled
 * to the top): top edge, and how much of it is visible above the fixed bottom nav.
 */
export async function measureMap(page) {
  return page.evaluate(() => {
    window.scrollTo(0, 0);
    const vh = window.innerHeight;
    const map = document.querySelector(".maplibregl-map");
    const nav = document.querySelector("nav.fixed");
    if (!map) return { found: false, vh };
    const r = map.getBoundingClientRect();
    const navTop = nav ? nav.getBoundingClientRect().top : vh;
    const visibleBottom = Math.min(r.bottom, navTop, vh);
    const visibleTop = Math.max(r.top, 0);
    return {
      found: true,
      vh,
      mapTop: Math.round(r.top * 10) / 10,
      mapTopPct: Math.round((r.top / vh) * 1000) / 10,
      mapHeight: Math.round(r.height * 10) / 10,
      navTop: Math.round(navTop * 10) / 10,
      visibleMapHeight: Math.max(0, Math.round((visibleBottom - visibleTop) * 10) / 10),
    };
  });
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

export function report(results) {
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : "  " + JSON.stringify(r.detail)}`);
}
