// Stage 1 browser checks (Requirement 1): compact category filter on the home
// board, signed out, at 390x844 and 1280x800. Mocked data only: seed mode,
// no real location/camera, no Supabase. See README.md for how to build and run.
import { BERKELEY } from "./fixtures.mjs";
import { startServer, launchEdge, newPage, open, measureMap, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS, DARK_RED_RGB } from "./lib.mjs";

const TRIGGER = 'button[aria-haspopup="true"][aria-controls]';
const PANEL = '[role="group"][aria-label="Filter by category"]';
const EXPECTED_ORDER = ["All categories", "Music", "Nightlife", "Sports", "Social Clubs", "Lost and Found", "Housing and Real Estate", "Jobs", "Sales", "Classes", "Community"];

// Saved centre 2.2 km south of the default Berkeley point: its snapped box differs from the server-rendered
// default key, so the page fetches (mocked) fixtures instead of using the empty seed list (see README).
const STAGE1_CENTER = { lat: BERKELEY.lat - 0.02, lng: BERKELEY.lng, zoom: 13, town: "Berkeley" };
const c = (name, pass, detail) => ({ name, pass: !!pass, detail });

async function triggerState(page) {
  return page.evaluate(
    ({ TRIGGER, PANEL }) => {
      const t = document.querySelector(TRIGGER);
      return {
        count: document.querySelectorAll(TRIGGER).length,
        text: t ? t.textContent.replace(/[▴▾]/g, "").trim() : null,
        expanded: t?.getAttribute("aria-expanded"),
        panelOpen: !!document.querySelector(PANEL),
        focusOnTrigger: !!t && document.activeElement === t,
        pageHeight: document.documentElement.scrollHeight,
      };
    },
    { TRIGGER, PANEL },
  );
}

async function counts(page) {
  return page.evaluate(() => ({
    pins: (document.querySelector(".maplibregl-map")?.querySelectorAll("button.maplibregl-marker[aria-label], .maplibregl-marker button[aria-label]").length) ?? 0, // first map = Local_Map (the world map is a second .maplibregl-map)
    cards: document.querySelectorAll("section h3").length,
    empty: [...document.querySelectorAll("section p")].some((p) => /Nothing within \d+ mi of/.test(p.textContent)),
  }));
}

async function openPanel(page) {
  await page.click(TRIGGER);
  await page.waitForSelector(PANEL, { timeout: 3000 });
}

// Dark-red actions outside the map and outside the bottom nav, plus the nav count.
async function darkRedSplit(page) {
  return page.evaluate((red) => {
    const nav = document.querySelector("nav.fixed");
    const list = (inNav) => {
      const out = [];
      for (const el of document.querySelectorAll("a[href], button, [role=button], a[href] span, button span")) {
        if (el.closest(".maplibregl-map") || el.closest(".maplibregl-marker")) continue;
        if (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true") continue; // selected category row and selected radius option (selected-chip state, not a main action)
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).backgroundColor !== red) continue;
        if (!!(nav && nav.contains(el)) !== inNav) continue;
        const host = el.closest("a[href], button, [role=button]");
        if (!host || out.includes(host)) continue;
        out.push(host);
      }
      return out.map((h) => (h.textContent || h.getAttribute("aria-label") || "").trim().slice(0, 30));
    };
    return { outsideNav: list(false), nav: list(true) };
  }, DARK_RED_RGB);
}

// Tap targets: split into feature-scope failures and pre-existing items.
async function tapTargets(page, { min = 44 } = {}) {
  return page.evaluate((min) => {
    const nav = document.querySelector("nav.fixed");
    const header = document.querySelector("header");
    const vis = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
    };
    const label = (el) => (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || el.tagName).trim().slice(0, 40);
    const feature = [];
    const preExisting = [];
    let checked = 0;
    for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=button]")) {
      if (el.closest(".maplibregl-map")) continue;
      if (!vis(el)) continue;
      checked++;
      const r = el.getBoundingClientRect();
      if (r.width >= min && r.height >= min) continue;
      const item = { label: label(el), w: Math.round(r.width), h: Math.round(r.height) };
      const inNav = nav && nav.contains(el);
      const inHeader = header && header.contains(el);
      const isHandle = /^@/.test(item.label) || !!el.closest("section h3 ~ div");
      if (el.closest("section h3") || (el.matches("a[href^='/p/']") && el.querySelector("h3"))) preExisting.push({ ...item, why: "card title link (PostingCard, not changed by this feature)" });
      else if (inNav) preExisting.push({ ...item, why: "bottom nav" });
      else if (inHeader) preExisting.push({ ...item, why: "top bar" });
      else if (isHandle && el.matches("a[href^='/u/'], a[href^='/profile'], a[href*='@']")) preExisting.push({ ...item, why: "author handle" });
      else feature.push(item);
    }
    return { checked, feature, preExisting };
  }, min);
}

const server = await startServer(Number(process.env.CB_PORT ?? 3200));
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, viewports: {} };
let anyFail = false;
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const { width, height } = VIEWPORTS[vp];
    const { page, errors, context } = await newPage(browser, vp, { savedCenter: STAGE1_CENTER });
    await open(page, server.baseUrl, "/");
    const checks = [];

    // --- 1.8 map geometry (hard thresholds at mobile only; measured at both)
    const g = await measureMap(page);
    if (vp === "mobile") {
      checks.push(c("map top edge <= 55% of viewport height (464 px)", g.found && g.mapTop <= 0.55 * height, { mapTop: g.mapTop, mapTopPct: g.mapTopPct, limitPx: 0.55 * height }));
      checks.push(c("visible map above bottom nav >= 240 px", g.found && g.visibleMapHeight >= 240, { visibleMapHeight: g.visibleMapHeight, navTop: g.navTop, mapHeight: g.mapHeight }));
    } else {
      checks.push(c("map measured (informational, no threshold at desktop)", g.found, g));
    }

    // --- 1.1 single trigger, label
    let s = await triggerState(page);
    checks.push(c('exactly one trigger reading "Category: All"', s.count === 1 && s.text === "Category: All", s));
    const baseHeight = s.pageHeight;

    // --- 1.2 / 1.3 open and close paths
    // click open, panel contents, overlay (no layout change)
    await openPanel(page);
    s = await triggerState(page);
    const rows = await page.$$eval(`${PANEL} li button`, (bs) => bs.map((b) => b.textContent.trim()));
    checks.push(c("click opens panel; aria-expanded=true", s.panelOpen && s.expanded === "true", s));
    checks.push(c('panel lists "All categories" first, then every category once in order', JSON.stringify(rows) === JSON.stringify(EXPECTED_ORDER), { rows }));
    checks.push(c("panel is an overlay (page height unchanged while open)", s.pageHeight === baseHeight, { open: s.pageHeight, closed: baseHeight }));
    const geo = await page.evaluate(
      ({ PANEL }) => {
        const p = document.querySelector(PANEL).getBoundingClientRect();
        return { left: Math.round(p.left), right: Math.round(p.right), vw: window.innerWidth, position: getComputedStyle(document.querySelector(PANEL)).position };
      },
      { PANEL },
    );
    checks.push(c("panel is absolutely positioned and inside the viewport width", geo.position === "absolute" && geo.left >= 0 && geo.right <= geo.vw, geo));

    // close by Escape
    await page.keyboard.press("Escape");
    s = await triggerState(page);
    checks.push(c("Escape closes panel and focus returns to trigger", !s.panelOpen && s.focusOnTrigger && s.expanded === "false", s));

    // Enter opens (keyboard)
    await page.focus(TRIGGER);
    await page.keyboard.press("Enter");
    s = await triggerState(page);
    checks.push(c("Enter opens panel", s.panelOpen, s));
    await page.keyboard.press("Escape");

    // Space opens
    await page.focus(TRIGGER);
    await page.keyboard.press("Space");
    s = await triggerState(page);
    checks.push(c("Space opens panel", s.panelOpen, s));

    // outside click closes
    await page.mouse.click(Math.round(width / 2), 6);
    await page.waitForTimeout(150);
    s = await triggerState(page);
    checks.push(c("outside click closes panel and focus returns to trigger", !s.panelOpen && s.focusOnTrigger, s));

    // toggle by trigger click closes
    await openPanel(page);
    await page.click(TRIGGER);
    s = await triggerState(page);
    checks.push(c("second trigger click closes panel", !s.panelOpen, s));

    // --- 1.5 signed-out: no follow controls
    await openPanel(page);
    const follow = await page.evaluate(
      ({ PANEL }) => {
        const inPanel = [...document.querySelectorAll(`${PANEL} button`)].filter((b) => /follow/i.test(b.textContent + b.getAttribute("aria-label"))).length;
        const rowButtons = document.querySelectorAll(`${PANEL} li button`).length;
        const rowsWithTwo = [...document.querySelectorAll(`${PANEL} li`)].filter((li) => li.querySelectorAll("button").length !== 1).length;
        const anyFollowOnPage = [...document.querySelectorAll("button")].filter((b) => /follow/i.test(b.textContent + (b.getAttribute("aria-label") ?? ""))).length;
        return { inPanel, rowButtons, rowsWithTwo, anyFollowOnPage };
      },
      { PANEL },
    );
    checks.push(c("signed out: no follow control in panel (one button per row)", follow.inPanel === 0 && follow.rowsWithTwo === 0, follow));

    // --- 1.6 select Sports (no postings) -> empty state, still selected (1.7)
    const before = await counts(page);
    checks.push(c("All categories shows postings (pins and cards > 0, equal)", before.pins > 0 && before.pins === before.cards, before));

    // select Community (a seed category with postings): filters
    await page.click(`${PANEL} li button:text-is("Community")`);
    await page.waitForTimeout(400);
    s = await triggerState(page);
    let k = await counts(page);
    checks.push(c("selecting a row closes panel, focus returns to trigger", !s.panelOpen && s.focusOnTrigger, s));
    checks.push(c('trigger reads "Category: Community" after selecting Community', s.text === "Category: Community", s));
    checks.push(c("Community: pins and cards filtered (fewer than all, equal, >0), no empty state", k.pins > 0 && k.pins < before.pins && k.pins === k.cards && !k.empty, { ...k, all: before }));
    const cardCats = await page.$$eval("section h3", (hs) => hs.map((h) => h.textContent.trim()));
    out.viewports[vp] = { communityCardTitles: cardCats };

    // Sports: empty state
    await openPanel(page);
    await page.click(`${PANEL} li button:text-is("Sports")`);
    await page.waitForTimeout(400);
    s = await triggerState(page);
    k = await counts(page);
    checks.push(c('empty category: zero pins, zero cards, empty state shown', k.pins === 0 && k.cards === 0 && k.empty, k));
    checks.push(c('empty category stays selected: trigger reads "Category: Sports"', s.text === "Category: Sports", s));
    await openPanel(page);
    const pressed = await page.$$eval(`${PANEL} li button[aria-pressed="true"]`, (bs) => bs.map((b) => b.textContent.trim()));
    checks.push(c("panel marks only Sports as selected (aria-pressed)", JSON.stringify(pressed) === JSON.stringify(["Sports"]), { pressed }));

    // dark-red selected row measured here (panel open)
    const sel = await page.$eval(`${PANEL} li button[aria-pressed="true"]`, (b) => getComputedStyle(b).backgroundColor);
    checks.push(c("selected row is dark red", sel === DARK_RED_RGB, { backgroundColor: sel }));

    // panel row + trigger + search + use my location tap targets with panel open
    const tapOpen = await tapTargets(page);
    checks.push(c("tap targets >= 44px in feature scope (panel open)", tapOpen.feature.length === 0, { checked: tapOpen.checked, under44: tapOpen.feature }));
    await shot(page, `stage1-${vp}-panel-open`);

    // All categories restores
    await page.click(`${PANEL} li button:text-is("All categories")`);
    await page.waitForTimeout(400);
    s = await triggerState(page);
    k = await counts(page);
    checks.push(c('"All categories" restores all (pins = cards = initial, no empty state)', k.pins === before.pins && k.cards === before.cards && !k.empty && s.text === "Category: All", { ...k, text: s.text, initial: before }));

    // --- 1.9 horizontal scroll, panel closed and open
    checks.push({ ...(await checkNoHorizontalScroll(page)), name: "no horizontal scroll (panel closed)" });
    await openPanel(page);
    checks.push({ ...(await checkNoHorizontalScroll(page)), name: "no horizontal scroll (panel open)" });
    await page.keyboard.press("Escape");

    // --- tap targets (panel closed), split
    const tap = await tapTargets(page);
    checks.push(c("tap targets >= 44px: filter trigger, search, Search button, Use my location (feature scope)", tap.feature.length === 0, { checked: tap.checked, under44: tap.feature }));
    const named = await page.evaluate(() => {
      const sizes = {};
      const pick = (key, el) => {
        if (!el) return (sizes[key] = null);
        const r = el.getBoundingClientRect();
        sizes[key] = { w: Math.round(r.width), h: Math.round(r.height) };
      };
      pick("filterTrigger", document.querySelector('button[aria-haspopup="true"][aria-controls]'));
      pick("searchInput", document.querySelector('input[aria-label="Search a town or city"]'));
      pick("useMyLocation", [...document.querySelectorAll("button")].find((b) => /Use my location|Locating/.test(b.textContent)));
      return sizes;
    });
    checks.push(c("named controls present and >= 44 px each way", Object.values(named).every((v) => v && v.w >= 44 && v.h >= 44), named));

    // --- dark red: outside nav and nav separately
    const red = await darkRedSplit(page);
    checks.push(c("dark-red main actions outside bottom nav (panel closed): one at most, none from this feature", red.outsideNav.length <= 1, red));

    await shot(page, `stage1-${vp}-closed`);
    checks.push(c("no uncaught page errors", errors.length === 0, errors));

    out.viewports[vp] = { size: VIEWPORTS[vp], geometry: g, checks, tapPreExisting: tap.preExisting, nav: red.nav, outsideNavDarkRed: red.outsideNav };
    console.log(`\n== ${vp} ${width}x${height}`);
    console.log("map:", JSON.stringify(g));
    report(checks);
    console.log("dark-red outside bottom nav:", JSON.stringify(red.outsideNav), "| bottom nav:", JSON.stringify(red.nav));
    console.log("pre-existing under-44px (not Stage 1 failures):", JSON.stringify(tap.preExisting));
    if (checks.some((x) => !x.pass)) anyFail = true;
    await context.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log("\nresults:", writeResults("stage1", out));
console.log(anyFail ? "STAGE 1: FAIL" : "STAGE 1: PASS");
process.exitCode = anyFail ? 1 : 0;
