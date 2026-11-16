// Stage 2 browser checks (Requirements 2-6): nearby radius, distance labels,
// heading, ring, "Show full radius", empty state, truncated notice, bounded
// requests and failure handling, signed out, at 390x844 and 1280x800.
// Mocked data only: /api/postings/map and the place search are intercepted
// (nothing reaches Supabase or a real geocoder), geolocation is a stub.
// See README.md for how to build and run.
//
// Why the reference is Berkeley shifted 2.2 km south (REF): the server renders
// the initial list in seed mode (London, Berlin, Mexico City), and the page uses
// that list whenever the snapped request key equals the default Berkeley one.
// A fixture response can only be used when the key differs, so the searched
// place is chosen so that its snapped box differs from the default box. The
// script asserts that precondition.
import { startServer, launchEdge, newPage, open, measureMap, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS } from "./lib.mjs";
import { FX_POSTINGS, BERKELEY, RICHMOND } from "./fixtures.mjs";

const c = (name, pass, detail) => ({ name, pass: !!pass, detail });

// ---------------------------------------------------------------- geometry (same sphere and mile as the app)
const R_EARTH = 6371000;
const M_PER_MI = 1609.344;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
function milesBetween(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return (2 * R_EARTH * Math.asin(Math.sqrt(h))) / M_PER_MI;
}
function dest(from, miles, bearingDeg) {
  const d = (miles * M_PER_MI) / R_EARTH;
  const br = rad(bearingDeg);
  const lat1 = rad(from.lat);
  const lng1 = rad(from.lng);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
  const lng2 = lng1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: deg(lat2), lng: deg(lng2) };
}
// Mirrors formatApproxDistance in src/lib/nearby.ts.
function approxLabel(miles) {
  let r;
  if (!(miles >= 0.5)) r = 0;
  else if (miles < 10) r = Math.round(miles * 2 + 1e-9) / 2;
  else r = Math.round(miles + 1e-9);
  if (r === 0) return "Under 0.5 mi away";
  return `About ${Number.isInteger(r) ? r : r.toFixed(1)} mi away`;
}
// Mirrors boundsForRadius + snapBoundsOutward (0.1 degree grid) for the precondition check.
function snappedBox(centre, miles) {
  const delta = (miles * M_PER_MI) / R_EARTH;
  const dLat = deg(delta) + 1e-7;
  const dLng = deg(Math.asin(Math.sin(delta) / Math.cos(rad(Math.abs(centre.lat))))) + 1e-7;
  const onGrid = (x) => Math.abs(x - Math.round(x * 10) / 10) < 1e-9;
  const lo = (x) => (onGrid(x) ? Math.round(x * 10) : Math.floor(x * 10)) / 10;
  const hi = (x) => (onGrid(x) ? Math.round(x * 10) : Math.ceil(x * 10)) / 10;
  return { west: lo(centre.lng - dLng), south: lo(centre.lat - dLat), east: hi(centre.lng + dLng), north: hi(centre.lat + dLat) };
}
const inBox = (p, b) => p.lat >= b.south && p.lat <= b.north && p.lng >= b.west && p.lng <= b.east;

// ---------------------------------------------------------------- fixtures
const REF = { lat: BERKELEY.lat - 0.02, lng: BERKELEY.lng }; // "Berkeley" as the mocked geocoder reports it
const REF_NAME = "Berkeley";
const base = FX_POSTINGS[0];
const mk = (id, title, categorySlug, p, extra = {}) => ({ ...base, id, title, categorySlug, placeLabel: "Fixture", lat: p.lat, lng: p.lng, ...extra });

const NEAR = mk("fx-near", "FX Near porch sale", "music", dest(REF, 0.5, 200));
const RICH = mk("fx-richmond", "FX Richmond market", "music", RICHMOND);
const DIAG = mk("fx-diag-edge", "FX Diagonal edge 10 mi", "community", dest(REF, 9.9995, 45));
const OUT = mk("fx-just-outside", "FX Just outside 10 mi", "community", dest(REF, 10.1, 0));
const STANDARD = [NEAR, RICH, DIAG, OUT];
const MANY = Array.from({ length: 120 }, (_, i) => {
  const p = dest(REF, 0.2 + (i % 40) * 0.02, (i * 37) % 360);
  return mk(`fx-many-${String(i).padStart(3, "0")}`, `FX Many ${String(i).padStart(3, "0")}`, "community", p, { createdAt: `2026-11-01T10:${String(i % 60).padStart(2, "0")}:00.000Z` });
});

// ---------------------------------------------------------------- mock of GET /api/postings/map (mimics selectForBounds)
function parseBoundsParam(raw) {
  const p = (raw ?? "").split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  return { west: p[0], south: p[1], east: p[2], north: p[3] };
}
function makeState(data) {
  // Since Stage 4 the world map also calls /api/postings/map (mode=pins, cap 300). Stage 2 is about the
  // local map, so `log`, `returned` and `fail` cover cards requests only; pins requests are answered from
  // the same data and recorded in `pinsLog`. Every request (both modes) is still shape-checked below.
  const s = { data, fail: false, log: [], pinsLog: [], returned: [], delayMs: 0 };
  s.handler = (url) => {
    const pins = url.searchParams.get("mode") === "pins";
    (pins ? s.pinsLog : s.log).push(url.search);
    if (s.fail && !pins) return { status: 500, body: { error: "Could not load postings. Try again." } };
    const b = parseBoundsParam(url.searchParams.get("bounds"));
    if (!b) return { status: 400, body: { error: "bad bounds" } };
    const cat = url.searchParams.get("category");
    const cap = pins ? 300 : 100;
    const matches = s.data
      .filter((p) => (cat === null || p.categorySlug === cat) && inBox(p, b))
      .sort((x, y) => (x.isPromoted === y.isPromoted ? (x.createdAt === y.createdAt ? (x.id < y.id ? 1 : -1) : x.createdAt < y.createdAt ? 1 : -1) : x.isPromoted ? -1 : 1));
    const items = matches.slice(0, cap);
    if (pins) return { body: { items, truncated: matches.length > cap } };
    s.returned.push(items.map((i) => i.id));
    return { delayMs: s.delayMs, body: { items, truncated: matches.length > cap } };
  };
  return s;
}

// ---------------------------------------------------------------- page helpers
const HEADING = 'section p[aria-live="polite"]';
const TRIGGER = 'button[aria-haspopup="true"][aria-controls]';
const PANEL = '[role="group"][aria-label="Filter by category"]';

async function heading(page) {
  return page.$eval(HEADING, (p) => p.textContent.trim()).catch(() => null);
}
async function settle(page, ms = 500) {
  await page.waitForFunction(() => !/Loading postings/.test(document.body.innerText), null, { timeout: 8000 });
  await page.waitForTimeout(ms);
}
async function cards(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("section h3")].map((h) => {
      let el = h.parentElement;
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        if (el.querySelectorAll("h3").length === 1 && /mi away/.test(el.innerText)) break;
      }
      const text = el ? el.innerText : "";
      const m = text.match(/(About \d+(?:\.\d)? mi away|Under 0\.5 mi away)/);
      return { title: h.textContent.trim(), distance: m ? m[1] : null };
    }),
  );
}
async function pinTitles(page) {
  return page.evaluate(() => {
    const map = document.querySelector(".maplibregl-map");
    return [...map.querySelectorAll(".maplibregl-marker[aria-label]")].map((m) => m.getAttribute("aria-label"));
  });
}
async function pinInView(page, title) {
  return page.evaluate((title) => {
    const map = document.querySelector(".maplibregl-map").getBoundingClientRect();
    const pin = [...document.querySelectorAll(".maplibregl-map .maplibregl-marker[aria-label]")].find((m) => m.getAttribute("aria-label") === title);
    if (!pin) return { found: false };
    const r = pin.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return { found: true, inView: cx >= map.left && cx <= map.right && cy >= map.top && cy <= map.bottom, cx: Math.round(cx), cy: Math.round(cy) };
  }, title);
}
async function bodyHas(page, re) {
  return page.evaluate((src) => new RegExp(src).test(document.body.innerText), re.source);
}
async function buttonRect(page, textRe) {
  return page.evaluate((src) => {
    const re = new RegExp(src);
    const b = [...document.querySelectorAll("button")].find((x) => re.test(x.textContent.trim()) && x.getBoundingClientRect().width > 0);
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: b.textContent.trim() };
  }, textRe.source);
}
async function setRadius(page, miles) {
  await page.click(`button[role="radio"][aria-label="${miles} ${miles === 1 ? "mile" : "miles"}"]`);
  await settle(page);
}
async function pickCategory(page, label) {
  await page.click(TRIGGER);
  await page.waitForSelector(PANEL, { timeout: 3000 });
  await page.click(`${PANEL} li button:text-is("${label}")`);
  await settle(page);
}

// Navy ring pixels in the map canvas with every overlay hidden (markers, controls, buttons, radius control).
async function ringPixels(page) {
  await page.evaluate(() => document.querySelector(".maplibregl-map").scrollIntoView({ block: "center" }));
  await page.waitForTimeout(200);
  const hidden = await page.evaluate(() => {
    const map = document.querySelector(".maplibregl-map");
    const wrap = map.parentElement.parentElement; // .relative holding container + overlays
    const els = [...map.querySelectorAll(".maplibregl-marker, .maplibregl-ctrl")];
    for (const ch of wrap.children) if (!ch.contains(map)) els.push(ch);
    const saved = els.map((e) => [e, e.style.visibility]);
    els.forEach((e) => (e.style.visibility = "hidden"));
    window.__restoreOverlays = () => saved.forEach(([e, v]) => (e.style.visibility = v));
    const r = map.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
  const buf = await page.screenshot({ clip: hidden });
  await page.evaluate(() => window.__restoreOverlays());
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 31) < 30 && Math.abs(d[i + 1] - 46) < 30 && Math.abs(d[i + 2] - 77) < 35) n++;
    return n;
  }, buf.toString("base64"));
}

// ---------------------------------------------------------------- request-content checks
const URL_RE = /^\?bounds=(-?\d+\.\d),(-?\d+\.\d),(-?\d+\.\d),(-?\d+\.\d)&(?:category=([a-z-]+)&)?mode=(?:cards|pins)$/;
const CARDS_URL_RE = /&mode=cards$/;
function checkRequests(requests, label) {
  const bad = [];
  const cats = new Set();
  for (const q of requests) {
    const m = q.match(URL_RE);
    if (!m) { bad.push({ q, why: "unexpected shape or extra parameter" }); continue; }
    const [w, s, e, n] = m.slice(1, 5).map(Number);
    if (![w, s, e, n].every((v) => Math.abs(Math.round(v * 10) - v * 10) < 1e-9)) bad.push({ q, why: "not on the 0.1 grid" });
    if (!(w < e && s < n)) bad.push({ q, why: "inverted" });
    if (/37\.8515|37\.8715|122\.273|your|lat=|lng=|radius|limit|cap/i.test(q)) bad.push({ q, why: "leaks a reference or extra parameter" });
    if (m[5]) cats.add(m[5]);
  }
  return c(`${label}: every /api/postings/map request carries only snapped bounds, optional category and mode (cards for the local map, pins for the world map)`, requests.some((q) => CARDS_URL_RE.test(q)) && bad.length === 0, { count: requests.length, bad, categories: [...cats], sample: requests.slice(0, 3) });
}

const SAVED_REF = { lat: REF.lat, lng: REF.lng, zoom: 13, town: REF_NAME };

// ---------------------------------------------------------------- run
const server = await startServer(Number(process.env.CB_PORT ?? 3200));
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, fixtures: {}, viewports: {} };
let anyFail = false;

// Fixture self-check (precondition of every scenario).
const box10 = snappedBox(REF, 10);
const defaultBox10 = snappedBox(BERKELEY, 10);
const pre = [
  c("fixture precondition: REF snapped 10 mi box differs from the default Berkeley box (so fixtures are fetched, not the seed list)", JSON.stringify(box10) !== JSON.stringify(defaultBox10), { box10, defaultBox10 }),
  c("fixture precondition: diagonal posting is within 10 mi and inside the coarse box", milesBetween(REF, DIAG) <= 10 && inBox(DIAG, box10), { miles: milesBetween(REF, DIAG), box10 }),
  c("fixture precondition: just-outside posting is beyond 10 mi but inside the coarse box", milesBetween(REF, OUT) > 10 && inBox(OUT, box10), { miles: milesBetween(REF, OUT), box10 }),
  c("fixture precondition: Richmond is between 5 and 10 mi from REF", milesBetween(REF, RICH) > 5 && milesBetween(REF, RICH) < 10, { miles: milesBetween(REF, RICH) }),
];
const expected = {
  near: approxLabel(milesBetween(REF, NEAR)),
  richmond: approxLabel(milesBetween(REF, RICH)),
  diag: approxLabel(milesBetween(REF, DIAG)),
  richmondFromDefault: approxLabel(milesBetween(BERKELEY, RICH)),
};
out.fixtures = { REF, expected, miles: { near: milesBetween(REF, NEAR), richmond: milesBetween(REF, RICH), diag: milesBetween(REF, DIAG), outside: milesBetween(REF, OUT) }, snapped10: box10 };
console.log("== preconditions");
report(pre);
console.log("expected labels:", JSON.stringify(expected));
if (pre.some((x) => !x.pass)) anyFail = true;

try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const { width, height } = VIEWPORTS[vp];
    const checks = [];
    const title = (p) => p.title;
    const notes = {};
    const scn = async (name, fn) => {
      try {
        await fn();
      } catch (e) {
        checks.push(c(name + ' scenario aborted: ' + String(e).split('\n')[0], false, String(e).slice(0, 600)));
      }
    };

    // ===== Scenario A: seeded saved centre -> no automatic location request; nearby list at 10 mi
    await scn("A", async () => {
      const st = makeState(STANDARD);
      const { page, errors, context, mapRequests } = await newPage(browser, vp, { savedCenter: SAVED_REF, mapHandler: st.handler });
      await open(page, server.baseUrl, "/", 2500);
      await settle(page);
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      checks.push(c("A seeded saved centre: no automatic geolocation request on mount", geoCalls === 0, { geoCalls }));
      const h = await heading(page);
      const cs = await cards(page);
      const titles = cs.map((x) => x.title).sort();
      const want = [NEAR, RICH, DIAG].map(title).sort();
      checks.push(c('A heading is "3 postings · Within 10 mi of Berkeley"', h === "3 postings · Within 10 mi of Berkeley", { h }));
      checks.push(c("A cards at 10 mi: Near, Richmond and the diagonal 10 mi posting shown; just-outside posting NOT shown", JSON.stringify(titles) === JSON.stringify(want), { titles, returnedByMock: st.returned.at(-1) }));
      checks.push(c("A mock returned the just-outside posting (inside the coarse box), so the browser exact filter did the exclusion", (st.returned.at(-1) ?? []).includes(OUT.id), { returned: st.returned.at(-1) }));
      const rich = cs.find((x) => x.title === RICH.title);
      checks.push(c(`A Richmond card reads "${expected.richmond}" (formatApproxDistance of the fixture distance)`, rich?.distance === expected.richmond && /^About \d+(\.5)? mi away$/.test(rich?.distance ?? ""), { rich, miles: out.fixtures.miles.richmond }));
      checks.push(c("A every card has a distance label", cs.length > 0 && cs.every((x) => x.distance), { cs }));
      checks.push(c(`A diagonal 10 mi card present with "${expected.diag}"`, cs.find((x) => x.title === DIAG.title)?.distance === expected.diag, { diag: cs.find((x) => x.title === DIAG.title) }));
      const pins = (await pinTitles(page)).sort();
      checks.push(c("A pins equal cards (same set, same count)", JSON.stringify(pins) === JSON.stringify(titles), { pins, cards: titles }));
      checks.push(c("A no truncated notice for a small result", !(await bodyHas(page, /Showing the first 100 postings/)), {}));
      checks.push(c('A "Show full radius" not shown for a saved (town) centre', !(await buttonRect(page, /^Show full radius$/)), {}));
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "A no horizontal scroll" });
      checks.push(checkRequests(mapRequests, "A"));

      // Stage 1 layout still holds with the radius control (hard thresholds at mobile).
      const g = await measureMap(page);
      const rc = await page.evaluate(() => {
        const map = document.querySelector(".maplibregl-map").getBoundingClientRect();
        const rg = document.querySelector('[role="radiogroup"][aria-label="Search radius in miles"]');
        const r = rg.getBoundingClientRect();
        return { inside: r.left >= map.left - 0.5 && r.right <= map.right + 0.5 && r.top >= map.top - 0.5 && r.bottom <= map.bottom + 0.5, rg: { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) }, map: { l: Math.round(map.left), r: Math.round(map.right), t: Math.round(map.top), b: Math.round(map.bottom) } };
      });
      checks.push(c("A radius control sits inside the map (adds no layout height)", rc.inside, rc));
      if (vp === "mobile") {
        checks.push(c("A map top edge <= 55% of 844 (464 px) with the radius control", g.found && g.mapTop <= 0.55 * height, { mapTop: g.mapTop, mapTopPct: g.mapTopPct }));
        checks.push(c("A visible map above bottom nav >= 240 px", g.found && g.visibleMapHeight >= 240, g));
      } else notes.mapGeometryDesktop = g;
      await shot(page, `stage2-${vp}-A-nearby`);
      checks.push(c("A no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== Scenario B: no saved centre, permission not yet granted ("prompt") -> no automatic request, default Berkeley (seed list is empty here): empty state, Try, search, radius, category, ring, failure
    await scn("B", async () => {
      const st = makeState(STANDARD);
      const { page, errors, context, mapRequests, geocodeRequests } = await newPage(browser, vp, {
        savedCenter: null,
        geolocation: "denied",
        permission: "prompt",
        mapHandler: st.handler,
        geocoderBody: [{ lat: String(REF.lat), lon: String(REF.lng), display_name: "Berkeley, California, United States" }],
      });
      await open(page, server.baseUrl, "/", 2500);
      await settle(page);
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      const permQueries = await page.evaluate(() => window.__permQueries);
      checks.push(c("B permission not granted: permission state read, NO automatic location request (no prompt); reference stays Berkeley", geoCalls === 0 && permQueries >= 1, { geoCalls, permQueries }));

      // empty state + Try button
      const emptyText = await bodyHas(page, /Nothing within 10 mi of Berkeley/);
      const tryBtn = await buttonRect(page, /^Try 25 mi$/);
      checks.push(c('B empty state "Nothing within 10 mi of Berkeley" with navy "Try 25 mi" button >= 44 px', emptyText && tryBtn && tryBtn.h >= 44 && tryBtn.w >= 44, { emptyText, tryBtn }));
      const tryColor = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /^Try 25 mi$/.test(x.textContent.trim()));
        return b ? getComputedStyle(b).backgroundColor : null;
      });
      checks.push(c("B Try button is deep navy (rgb(31, 46, 77))", tryColor === "rgb(31, 46, 77)", { tryColor }));
      checks.push(c("B empty state: heading reads 0 postings", /^0 postings · Within 10 mi of Berkeley$/.test((await heading(page)) ?? ""), { h: await heading(page) }));
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "B no horizontal scroll (empty state)" });
      await shot(page, `stage2-${vp}-B-empty`);

      // Try 25 mi
      await page.getByRole("button", { name: /^Try 25 mi$/ }).click();
      await settle(page, 700);
      let h = await heading(page);
      let cs = await cards(page);
      checks.push(c('B "Try 25 mi" widens to 25 mi: heading "Within 25 mi of Berkeley" and fixture cards appear', /Within 25 mi of Berkeley$/.test(h ?? "") && cs.length >= 3, { h, titles: cs.map(title) }));
      const radioChecked = await page.$eval('button[role="radio"][aria-checked="true"]', (b) => b.getAttribute("aria-label"));
      checks.push(c("B radius control shows 25 miles active", radioChecked === "25 miles", { radioChecked }));

      // Category Sports -> request carries category, empty at 25 mi with no Try button
      await pickCategory(page, "Sports");
      const noBtn = await buttonRect(page, /^Try \d+ mi$/);
      checks.push(c('B at 25 mi with nothing found: "Nothing within 25 mi of Berkeley" and no Try button', (await bodyHas(page, /Nothing within 25 mi of Berkeley/)) && !noBtn, { noBtn }));
      checks.push(c("B category request carries category=sports", mapRequests.some((q) => /[?&]category=sports&/.test(q)), { reqs: mapRequests.filter((q) => /category/.test(q)) }));
      await pickCategory(page, "All categories");

      // Search "Berkeley"
      await page.fill('input[aria-label="Search a town or city"]', "Berkeley");
      await page.click('button:text-is("Search")');
      await settle(page, 900);
      checks.push(c("B place search used the intercepted geocoder (1 request, never the real one)", geocodeRequests.length === 1, { geocodeRequests }));
      checks.push(c('B after searching "Berkeley": note "Showing Berkeley."', await bodyHas(page, /Showing Berkeley\./), {}));

      // 10 mi
      await setRadius(page, 10);
      await page.waitForTimeout(1200);
      h = await heading(page);
      cs = await cards(page);
      let titles = cs.map(title).sort();
      checks.push(c('B search Berkeley, 10 mi: heading "3 postings · Within 10 mi of Berkeley"', h === "3 postings · Within 10 mi of Berkeley", { h }));
      checks.push(c("B 10 mi: Richmond fixture card shown", titles.includes(RICH.title), { titles }));
      const rich = cs.find((x) => x.title === RICH.title);
      checks.push(c(`B Richmond card reads "${expected.richmond}" (distance from the searched Berkeley)`, rich?.distance === expected.richmond && /^About \d+(\.5)? mi away$/.test(rich?.distance ?? ""), { rich, defaultBerkeleyWouldRead: expected.richmondFromDefault }));
      checks.push(c("B 10 mi: diagonal 10 mi posting appears (edge not lost)", titles.includes(DIAG.title), { titles, miles: out.fixtures.miles.diag }));
      checks.push(c("B 10 mi: just-outside posting (returned by the mock) does NOT appear", !titles.includes(OUT.title) && (st.returned.at(-1) ?? []).includes(OUT.id), { titles, returned: st.returned.at(-1) }));
      const pins10 = (await pinTitles(page)).sort();
      checks.push(c("B 10 mi: pins equal cards", JSON.stringify(pins10) === JSON.stringify(titles), { pins: pins10, cards: titles }));

      // ring drawn after fit
      const ring10 = await ringPixels(page);
      checks.push(c("B radius ring drawn (navy ring pixels in the map with overlays hidden) after the search fit", ring10 > 150, { ringPixels: ring10 }));
      await shot(page, `stage2-${vp}-B-10mi`);

      // 5 mi
      await setRadius(page, 5);
      await page.waitForTimeout(1200);
      h = await heading(page);
      cs = await cards(page);
      titles = cs.map(title).sort();
      checks.push(c('B 5 mi: heading "1 posting · Within 5 mi of Berkeley"', h === "1 posting · Within 5 mi of Berkeley", { h }));
      checks.push(c("B 5 mi: Richmond hidden", !titles.includes(RICH.title), { titles }));
      checks.push(c("B 5 mi: diagonal 10 mi posting disappears", !titles.includes(DIAG.title), { titles }));
      checks.push(c("B 5 mi: near posting still shown; pins equal cards", titles.length === 1 && titles[0] === NEAR.title && JSON.stringify((await pinTitles(page)).sort()) === JSON.stringify(titles), { titles, pins: await pinTitles(page) }));
      const ring5 = await ringPixels(page);
      checks.push(c("B radius ring redrawn at 5 mi", ring5 > 150, { ringPixels: ring5 }));

      // back to 10 mi
      await setRadius(page, 10);
      await page.waitForTimeout(800);
      titles = (await cards(page)).map(title).sort();
      checks.push(c("B back to 10 mi: Richmond and diagonal posting return", titles.includes(RICH.title) && titles.includes(DIAG.title) && !titles.includes(OUT.title), { titles }));
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "B no horizontal scroll (cards at 10 mi)" });

      // failure keeps previous cards, shows retry
      const prevCards = (await cards(page)).map(title);
      const prevPins = (await pinTitles(page)).sort();
      const prevHeading = await heading(page);
      st.fail = true;
      await page.click('button[role="radio"][aria-label="25 miles"]');
      await page.waitForFunction(() => /Could not load postings for this area/.test(document.body.innerText), null, { timeout: 8000 });
      await page.waitForTimeout(500);
      const alertText = await page.$eval('main [role="alert"]', (a) => a.textContent.trim());
      const retry = await buttonRect(page, /^Try again$/);
      const afterCards = (await cards(page)).map(title);
      const afterPins = (await pinTitles(page)).sort();
      checks.push(c("B failed request: previous cards kept", JSON.stringify(afterCards) === JSON.stringify(prevCards) && afterCards.length === 3, { prevCards, afterCards }));
      checks.push(c("B failed request: previous pins kept", JSON.stringify(afterPins) === JSON.stringify(prevPins), { prevPins, afterPins }));
      checks.push(c("B failed request: heading keeps the previous view", (await heading(page)) === prevHeading, { prevHeading, now: await heading(page) }));
      checks.push(c('B failed request: error message and a "Try again" retry button >= 44 px', /Could not load postings/.test(alertText) && retry && retry.h >= 44, { alertText, retry }));
      checks.push(c("B failed request: no fallback to loading everything (every request still bounded)", [...st.log, ...st.pinsLog].every((q) => URL_RE.test(q)), { log: st.log.slice(-3) }));
      await shot(page, `stage2-${vp}-B-failed`);
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "B no horizontal scroll (failure state)" });
      st.fail = false;
      await page.click('button:text-is("Try again")');
      await page.waitForFunction(() => !/Could not load postings for this area/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
      await settle(page, 700);
      checks.push(c("B retry succeeds: alert gone, heading shows 25 mi, cards present", !(await bodyHas(page, /Could not load postings for this area/)) && /Within 25 mi of Berkeley$/.test((await heading(page)) ?? "") && (await cards(page)).length >= 3, { h: await heading(page), errorShown: await bodyHas(page, /Could not load postings for this area/) }));

      checks.push(checkRequests(mapRequests, "B"));
      checks.push(c("B no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== Scenario C: no saved centre, permission already granted (stub) -> automatic device reference, street zoom, Show full radius
    await scn("C", async () => {
      const st = makeState(STANDARD);
      const { page, errors, context, mapRequests } = await newPage(browser, vp, {
        savedCenter: null,
        geolocation: "ok",
        permission: "granted",
        position: { latitude: REF.lat, longitude: REF.lng, accuracy: 20 },
        mapHandler: st.handler,
      });
      await open(page, server.baseUrl, "/", 2800);
      await settle(page, 800);
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      checks.push(c("C permission already granted: page auto-requests location once on mount (stub, never real permission)", geoCalls === 1, { geoCalls }));
      const h = await heading(page);
      checks.push(c('C device reference: heading "Within 10 mi of your location"', /Within 10 mi of your location$/.test(h ?? ""), { h }));
      const cs = await cards(page);
      checks.push(c("C device reference: nearby cards from the fixture response (3, just-outside excluded)", cs.length === 3 && !cs.some((x) => x.title === OUT.title), { titles: cs.map(title) }));
      const full = await buttonRect(page, /^Show full radius$/);
      checks.push(c('C "Show full radius" visible for the device reference', !!full, { full }));
      const fullColor = await page.evaluate(() => {
        const b = [...document.querySelectorAll("button")].find((x) => /^Show full radius$/.test(x.textContent.trim()));
        return b ? getComputedStyle(b).backgroundColor : null;
      });
      checks.push(c('C "Show full radius" is deep navy', fullColor === "rgb(31, 46, 77)", { fullColor }));
      const richBefore = await pinInView(page, RICH.title);
      const nearBefore = await pinInView(page, NEAR.title);
      const ringBefore = await ringPixels(page);
      const diagBefore = await pinInView(page, DIAG.title);
      checks.push(c("C street zoom kept (not fitted to the ring): Richmond and the diagonal pins are outside the visible map", richBefore.found && !richBefore.inView && diagBefore.found && !diagBefore.inView, { richBefore, diagBefore, nearBefore, ringPixelsBefore: ringBefore }));
      await shot(page, `stage2-${vp}-C-street`);
      await page.click('button:text-is("Show full radius")');
      await page.waitForTimeout(1800);
      const after = {};
      for (const p of [NEAR, RICH, DIAG]) after[p.title] = await pinInView(page, p.title);
      const ringAfter = await ringPixels(page);
      checks.push(c('C clicking "Show full radius" fits the ring: every 10 mi pin is inside the visible map', Object.values(after).every((x) => x.found && x.inView), after));
      checks.push(c("C ring visible after fit (navy ring pixels) and more than at street zoom", ringAfter > 150 && ringAfter > ringBefore, { ringBefore, ringAfter }));
      await shot(page, `stage2-${vp}-C-full-radius`);
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "C no horizontal scroll" });
      // Changing the radius ends the "device view" state
      await setRadius(page, 5);
      checks.push(c('C changing the radius hides "Show full radius"', !(await buttonRect(page, /^Show full radius$/)), {}));
      checks.push(checkRequests(mapRequests, "C"));
      checks.push(c("C no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== Scenario D: 120 postings near the centre -> response capped at 100 -> truncated notice
    await scn("D", async () => {
      const st = makeState(MANY);
      const { page, errors, context, mapRequests } = await newPage(browser, vp, { savedCenter: SAVED_REF, mapHandler: st.handler });
      await open(page, server.baseUrl, "/", 2500);
      await settle(page, 1000);
      const cs = await cards(page);
      const pins = await pinTitles(page);
      checks.push(c('D 100+ response: notice "Showing the first 100 postings. Choose a smaller radius to see them all."', await bodyHas(page, /Showing the first 100 postings\. Choose a smaller radius to see them all\./), {}));
      checks.push(c("D 100 cards and 100 pins rendered (equal)", cs.length === 100 && pins.length === 100, { cards: cs.length, pins: pins.length, returned: st.returned.at(-1)?.length }));
      checks.push(c('D heading "100 postings · Within 10 mi of Berkeley"', (await heading(page)) === "100 postings · Within 10 mi of Berkeley", { h: await heading(page) }));
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: "D no horizontal scroll (100 cards)" });
      await shot(page, `stage2-${vp}-D-truncated`);
      checks.push(checkRequests(mapRequests, "D"));
      checks.push(c("D no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== Scenario E: permission denied -> no automatic request
    await scn("E", async () => {
      const st = makeState(STANDARD);
      const { page, errors, context } = await newPage(browser, vp, { savedCenter: null, geolocation: "denied", permission: "denied", mapHandler: st.handler });
      await open(page, server.baseUrl, "/", 2000);
      await settle(page, 600);
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      checks.push(c("E permission denied: no automatic location request; heading stays on Berkeley", geoCalls === 0 && /Within 10 mi of Berkeley$/.test((await heading(page)) ?? ""), { geoCalls, h: await heading(page) }));
      checks.push(c("E no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    // ===== Scenario F: permission granted but the device fix is slow; the viewer searches first -> the late fix never overrides the searched city
    await scn("F", async () => {
      const st = makeState(STANDARD);
      const FAR = { latitude: 34.0522, longitude: -118.2437, accuracy: 20 }; // Los Angeles, far from the searched city
      const { page, errors, context, geocodeRequests } = await newPage(browser, vp, {
        savedCenter: null,
        geolocation: "ok",
        permission: "granted",
        geoDelayMs: 4000,
        position: FAR,
        mapHandler: st.handler,
        geocoderBody: [{ lat: String(REF.lat), lon: String(REF.lng), display_name: "Berkeley, California, United States" }],
      });
      await open(page, server.baseUrl, "/", 800);
      await page.fill('input[aria-label="Search a town or city"]', "Berkeley");
      await page.click('button:text-is("Search")');
      await settle(page, 900);
      const before = await heading(page);
      await page.waitForTimeout(5000); // the delayed device fix fires during this wait
      const geoCalls = await page.evaluate(() => window.__geoCalls);
      const after = await heading(page);
      const saved = await page.evaluate(() => localStorage.getItem("corkback.mapCenter"));
      const cs = await cards(page);
      checks.push(c("F the automatic request was made (granted) and its late fix arrived after the search", geoCalls === 1 && geocodeRequests.length === 1, { geoCalls, geocodeRequests: geocodeRequests.length }));
      checks.push(c('F late device fix ignored: heading still "Within 10 mi of Berkeley" (not "your location")', /Within 10 mi of Berkeley$/.test(before ?? "") && /Within 10 mi of Berkeley$/.test(after ?? ""), { before, after }));
      checks.push(c("F saved centre is still the searched town (kind town), not the device fix", !!saved && JSON.parse(saved).kind === "town" && JSON.parse(saved).town === "Berkeley", { saved }));
      checks.push(c('F no "Showing near you" note and no "Show full radius" after the late fix', !(await bodyHas(page, /Showing near you/)) && !(await buttonRect(page, /^Show full radius$/)), {}));
      checks.push(c("F Berkeley fixture cards still shown", cs.length === 3, { n: cs.length }));
      checks.push(c("F no uncaught page errors", errors.length === 0, errors));
      await context.close();
    });

    out.viewports[vp] = { size: VIEWPORTS[vp], notes, checks };
    console.log(`\n== ${vp} ${width}x${height}`);
    report(checks);
    if (checks.some((x) => !x.pass)) anyFail = true;
  }
} finally {
  await browser.close();
  await server.stop();
}
out.preconditions = pre;
console.log("\nresults:", writeResults("stage2", out));
console.log(anyFail ? "STAGE 2: FAIL" : "STAGE 2: PASS");
process.exitCode = anyFail ? 1 : 0;
