// Stage 3 browser checks (Requirements 7.3-7.7, 9.5-9.7, 10.4, 10.5, 11.3): category-specific
// fields on the review and edit forms, Community with and without a date, deadline and link
// labels, detail page rows, card date lines, legacy-date edit notice, mocked 400 on save,
// no horizontal scroll, one dark-red action. Both viewports. NOTHING IS PUBLISHED.
//
// Data sources (all local, never the real Supabase):
//  - Board cards: /api/postings/map is intercepted in the browser (as stage2.mjs does).
//  - Review form: sessionStorage["corkback.extracted"] is seeded by an init script. The page is
//    server-gated on a signed-in viewer, so the browser carries a fake session cookie.
//  - Detail and edit pages are server-rendered from Supabase. The scratch build points
//    NEXT_PUBLIC_SUPABASE_URL at a tiny mock server started HERE (127.0.0.1:CB_MOCK_PORT, default 3299)
//    that answers /auth/v1/user and /rest/v1/postings for the "fx" fixture rows below, and an empty
//    list for everything else. The build must use the same URL (see README, "Stage 3").
//  - POST /api/postings is intercepted: the script FAILS if it is ever called.
//    PATCH /api/postings/:id is answered with a mocked 400.
import http from "node:http";
import { startServer, launchEdge, newPage, open, checkNoHorizontalScroll, shot, writeResults, report, VIEWPORTS } from "./lib.mjs";
import { BERKELEY } from "./fixtures.mjs";

const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
const MOCK_PORT = Number(process.env.CB_MOCK_PORT ?? 3299);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;

// ---------------------------------------------------------------- mock Supabase (server-side reads only)
const OWNER = "fx_owner";
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
const uuid = (n) => `00000000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const row = (n, over) => ({
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
  expiry: "1m",
  expires_at: "2099-12-31T00:00:00.000Z",
  is_promoted: false,
  created_at: "2026-11-01T10:00:00.000Z",
  profiles: { username: OWNER, avatar_path: null },
  categories: { slug: "community" },
  ...over,
});
const DB = {
  commDate: row(1, { title: "FX Community with date", categories: { slug: "community" }, event_date: "2099-12-05", event_time: "19:30", rsvp_url: "https://example.com/rsvp" }),
  commNoDate: row(2, { title: "FX Community no date", categories: { slug: "community" }, rsvp_url: "https://example.com/info" }),
  commNoLink: row(3, { title: "FX Community no link", categories: { slug: "community" } }),
  job: row(4, { title: "FX Job with deadline", categories: { slug: "jobs" }, end_date: "2099-06-15", rsvp_url: "https://example.com/apply" }),
  housingNoDeadline: row(5, { title: "FX Housing no deadline", categories: { slug: "housing" }, rsvp_url: "https://example.com/listing" }),
  legacySale: row(6, { title: "FX Sale legacy date", categories: { slug: "sale" }, event_date: "2099-03-10" }),
  music: row(7, { title: "FX Music event", categories: { slug: "music" }, event_date: "2099-12-05", rsvp_url: "https://example.com/tickets" }),
};

function b64url(s) {
  return Buffer.from(s).toString("base64url");
}
const FAKE_JWT = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify({ sub: OWNER_ID, role: "authenticated", exp: 4102444800 }))}.${b64url("sig")}`;
const MOCK_USER = { id: OWNER_ID, aud: "authenticated", role: "authenticated", email: "fx_owner@example.invalid", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
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
      if (table === "postings") {
        const id = url.searchParams.get("id");
        if (id?.startsWith("eq.")) rows = Object.values(DB).filter((r) => r.id === id.slice(3));
      } else if (table === "profiles") rows = [{ id: OWNER_ID, username: OWNER, avatar_path: null }];
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

// ---------------------------------------------------------------- expected labels (from the design table)
const EVENT = ["music", "nightlife", "sports", "social-clubs", "classes"];
const LISTINGS = {
  jobs: { deadline: "Apply by (optional)", link: "Application link (optional)", hint: "The last day to apply. Your posting comes down after it." },
  housing: { deadline: "Available until (optional)", link: "Listing or contact link (optional)", hint: "The last day this is available. Your posting comes down after it." },
  sale: { deadline: "Offer ends (optional)", link: "Listing link (optional)", hint: "The last day of the offer. Your posting comes down after it." },
  "lost-found": { deadline: "Keep this up until (optional)", link: "Contact link (optional)", hint: "The last day to keep this posted. Your posting comes down after it." },
};
const LABELS = { music: "Music", nightlife: "Nightlife", sports: "Sports", "social-clubs": "Social Clubs", classes: "Classes", community: "Community", jobs: "Jobs", housing: "Housing and Real Estate", sale: "Sales", "lost-found": "Lost and Found" };
const R_EXPIRY = "the time you chose to keep it on the board ends";
const R_DEADLINE = "your deadline passes";
const R_EVENT = "the event ends";

// ---------------------------------------------------------------- helpers
const isoPlusDays = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
async function formFields(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("form label")]
      .filter((l) => l.querySelector("input:not([type=checkbox]), textarea"))
      .map((l) => {
        const spans = l.querySelectorAll(":scope > span");
        const input = l.querySelector("input, textarea");
        return { label: spans[0]?.textContent.trim() ?? "", hint: spans[1]?.textContent.trim() ?? null, name: input.name, disabled: input.disabled, value: input.value };
      }),
  );
}
const labelsOf = (fs) => fs.map((f) => f.label);
const field = (fs, name) => fs.find((f) => f.name === name);
const takedownText = (page) => page.$eval('[data-testid="takedown-line"]', (p) => p.textContent.trim()).catch(() => null);
const bodyText = (page) => page.evaluate(() => document.body.innerText);
async function clickChip(page, label) {
  await page.click(`button[aria-pressed]:text-is("${label}")`);
  await page.waitForTimeout(120);
}
async function seedExtracted(context, extracted) {
  await context.addInitScript((e) => {
    if (location.pathname === "/scan/review" && !sessionStorage.getItem("corkback.extracted")) sessionStorage.setItem("corkback.extracted", JSON.stringify(e));
  }, extracted);
}
/** Fails the whole run if the page ever tries to publish. */
async function guardPublish(context, calls) {
  await context.route("**/api/postings", async (route) => {
    if (route.request().method() === "POST") {
      calls.push("POST /api/postings");
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "blocked by test" }) });
    }
    return route.fallback();
  });
}
async function signIn(context, baseUrl) {
  await context.addCookies([{ ...SESSION_COOKIE, url: baseUrl }]);
}

// geometry for card fixtures (same sphere as the app)
const R_EARTH = 6371000;
const M_PER_MI = 1609.344;
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
const REF = { lat: BERKELEY.lat - 0.02, lng: BERKELEY.lng }; // see stage2.mjs: avoids the server-rendered default key
const SAVED_REF = { lat: REF.lat, lng: REF.lng, zoom: 13, town: "Berkeley" };
const cardBase = { body: "Fixture.", flyerUrl: null, rsvpUrl: null, eventDate: null, eventTime: null, endDate: null, endTime: null, expiry: "1m", expiresAt: "2099-12-31T00:00:00.000Z", isPromoted: false, authorUsername: "fx_poster", likeCount: 0, goingCount: 0, interestedCount: 0, createdAt: "2026-11-01T10:00:00.000Z" };
const mkCard = (i, title, categorySlug, placeLabel, extra) => ({ ...cardBase, id: `fx-s3-${i}`, title, categorySlug, placeLabel, ...dest(REF, 0.5, i * 50), ...extra });
const CARDS = [
  mkCard(1, "FX Card Community no date", "community", "Alder Hall"),
  mkCard(2, "FX Card Community dated", "community", "Birch Hall", { eventDate: "2099-12-05" }),
  mkCard(3, "FX Card Job deadline", "jobs", "Cedar Hall", { endDate: "2099-06-15" }),
  mkCard(4, "FX Card Housing no deadline", "housing", "Dogwood Hall"),
  mkCard(5, "FX Card Sale legacy date", "sale", "Elm Hall", { eventDate: "2099-03-10" }),
];

// ---------------------------------------------------------------- run
const mock = await startMock();
const server = await startServer(Number(process.env.CB_PORT ?? 3200), {
  env: { NEXT_PUBLIC_SUPABASE_URL: MOCK_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "fx-anon-key", SUPABASE_SERVICE_ROLE_KEY: "fx-service-key" },
});
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, mockUrl: MOCK_URL, viewports: {} };
let anyFail = false;
const publishCalls = [];

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
    const finish = async (page, errors, tag, { expectRed = null } = {}) => {
      checks.push({ ...(await checkNoHorizontalScroll(page)), name: `${tag} no horizontal scroll` });
      // Same rule as lib.checkOneDarkRedAction, but outside the fixed bottom nav (its raised Scan
      // anchor is on every screen; stage1.mjs also counts it separately) and ignoring selected states.
      const red = await page.evaluate((redRgb) => {
        const items = [];
        for (const el of document.querySelectorAll("a[href], button, [role=button], a[href] span, button span")) {
          if (el.closest(".maplibregl-map") || el.closest("nav.fixed")) continue;
          if (el.getAttribute("aria-pressed") === "true" || el.getAttribute("aria-checked") === "true") continue;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || getComputedStyle(el).backgroundColor !== redRgb) continue;
          const host = el.closest("a[href], button, [role=button]");
          if (!host || host.getAttribute("aria-pressed") === "true" || host.getAttribute("aria-checked") === "true") continue;
          const label = (host.textContent || "").trim().slice(0, 40);
          if (!items.some((i) => i.label === label)) items.push({ label });
        }
        return { detail: { count: items.length, items } };
      }, "rgb(140, 43, 31)");
      checks.push(c(`${tag} ${expectRed === null ? "at most one" : "exactly one"} dark-red action`, expectRed === null ? red.detail.count <= 1 : red.detail.count === expectRed, red.detail));
      checks.push(c(`${tag} no uncaught page errors`, errors.length === 0, errors));
    };

    // ===== R: review form (signed in via fake cookie, never published)
    await scn("R", async () => {
      const { page, errors, context } = await newPage(browser, vp, { savedCenter: null });
      await signIn(context, server.baseUrl);
      await guardPublish(context, publishCalls);
      await seedExtracted(context, { title: "FX Review title", body: "Body", categorySlug: "community", eventDate: null, eventTime: null, placeLabel: "Cedar Hall", rsvpUrl: null });
      await open(page, server.baseUrl, "/scan/review", 1200);
      const formThere = await page.$('form button[type="submit"]');
      checks.push(c("R review form renders for the (mock) signed-in session", !!formThere, { url: page.url(), body: (await bodyText(page)).slice(0, 200) }));
      if (!formThere) return;

      // Events
      for (const slug of EVENT) {
        await clickChip(page, LABELS[slug]);
        const fs = await formFields(page);
        const ok =
          labelsOf(fs).join("|") === ["Title", "Event date", "Time", "End date (optional)", "End time (optional)", "Event place", "Details", "RSVP link (optional)"].join("|") &&
          !field(fs, "eventDate").disabled && !field(fs, "eventTime").disabled && !field(fs, "endDate").disabled && !field(fs, "endTime").disabled;
        checks.push(c(`R ${slug} (event): Event date (required), Time, End date/time, Event place, "RSVP link (optional)"; nothing disabled`, ok, labelsOf(fs)));
      }
      // Listings
      for (const [slug, L] of Object.entries(LISTINGS)) {
        await clickChip(page, LABELS[slug]);
        const fs = await formFields(page);
        const want = ["Title", L.deadline, "Place (optional)", "Details", L.link];
        const dl = field(fs, "deadline");
        checks.push(c(`R ${slug} (listing): fields are exactly ${JSON.stringify(want)}, deadline hint shown, no event date/time/end fields`, JSON.stringify(labelsOf(fs)) === JSON.stringify(want) && dl?.hint === L.hint && !field(fs, "eventDate") && !field(fs, "endDate"), { labels: labelsOf(fs), hint: dl?.hint }));
        const body = await bodyText(page);
        checks.push(c(`R ${slug}: shows no end-time sentence "Without an end, an event comes down..."`, !/Without an end, an event comes down/.test(body), {}));
      }

      // Listing takedown line
      await clickChip(page, "Jobs");
      await clickChip(page, "1 month");
      let t = await takedownText(page);
      checks.push(c('R jobs, no deadline: takedown line "Comes down on {date}: ' + R_EXPIRY + '"', /^Comes down on .+: the time you chose to keep it on the board ends$/.test(t ?? ""), { t }));
      await page.fill('input[name="deadline"]', isoPlusDays(3));
      await page.waitForTimeout(150);
      t = await takedownText(page);
      checks.push(c('R jobs with a deadline in 3 days (1 month stay): takedown line names "your deadline passes"', /^Comes down on .+: your deadline passes$/.test(t ?? ""), { t }));
      checks.push(c("R takedown line carries the zone note beneath the chips", /The exact time uses your pin's time zone\./.test(await bodyText(page)), {}));

      // Community without a date
      await clickChip(page, "Community");
      let fs = await formFields(page);
      checks.push(c('R community: "Event date (optional)" with hint "Leave empty for a general notice."', field(fs, "eventDate")?.label === "Event date (optional)" && field(fs, "eventDate")?.hint === "Leave empty for a general notice.", field(fs, "eventDate")));
      checks.push(c("R community, no date: Time, End date and End time disabled", field(fs, "eventTime").disabled && field(fs, "endDate").disabled && field(fs, "endTime").disabled, fs.map((f) => [f.name, f.disabled])));
      checks.push(c('R community: link label "Link (optional)"', field(fs, "rsvpUrl")?.label === "Link (optional)", field(fs, "rsvpUrl")));
      t = await takedownText(page);
      checks.push(c('R community without a date: takedown line names the expiry ("the time you chose...")', /^Comes down on .+: the time you chose to keep it on the board ends$/.test(t ?? ""), { t }));
      await shot(page, `stage3-${vp}-R-community-nodate`);

      // Community with a date
      await page.fill('input[name="eventDate"]', isoPlusDays(2));
      await page.waitForTimeout(150);
      fs = await formFields(page);
      checks.push(c("R community with a date: Time, End date and End time enabled", !field(fs, "eventTime").disabled && !field(fs, "endDate").disabled && !field(fs, "endTime").disabled, fs.map((f) => [f.name, f.disabled])));
      t = await takedownText(page);
      checks.push(c('R community with a date in 2 days (1 month stay): takedown line names "the event ends"', /^Comes down on .+: the event ends$/.test(t ?? ""), { t }));
      await shot(page, `stage3-${vp}-R-community-date`);
      // clearing the date goes back
      await page.fill('input[name="eventDate"]', "");
      await page.waitForTimeout(150);
      fs = await formFields(page);
      t = await takedownText(page);
      checks.push(c("R community date cleared again: fields disabled and takedown back to expiry", field(fs, "eventTime").disabled && /the time you chose to keep it on the board ends$/.test(t ?? ""), { t }));

      await finish(page, errors, "R", { expectRed: 1 });
      await context.close();
    });

    // ===== R2: scanned flyer date pre-fills a listing Deadline
    await scn("R2", async () => {
      const { page, errors, context } = await newPage(browser, vp, { savedCenter: null });
      await signIn(context, server.baseUrl);
      await guardPublish(context, publishCalls);
      const d = isoPlusDays(5);
      await seedExtracted(context, { title: "FX Scanned job", body: "Body", categorySlug: "jobs", eventDate: d, eventDateYearPrinted: true, eventTime: null, placeLabel: "Cedar Hall", rsvpUrl: null });
      await open(page, server.baseUrl, "/scan/review", 1200);
      let fs = await formFields(page);
      checks.push(c("R2 scanned jobs flyer with a readable date: Deadline pre-filled with the scanned date", field(fs, "deadline")?.value === d, { deadline: field(fs, "deadline")?.value, d }));
      await page.fill('input[name="deadline"]', "");
      fs = await formFields(page);
      checks.push(c("R2 Deadline can be cleared", field(fs, "deadline")?.value === "", {}));
      await finish(page, errors, "R2", { expectRed: 1 });
      await context.close();
    });

    // ===== C: board cards with mocked /api/postings/map
    await scn("C", async () => {
      const { page, errors, context, mapRequests } = await newPage(browser, vp, { savedCenter: SAVED_REF, mapBody: { items: CARDS, truncated: false } });
      await guardPublish(context, publishCalls);
      await open(page, server.baseUrl, "/", 2500);
      await page.waitForFunction(() => !/Loading postings/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(500);
      const cards = await page.evaluate(() =>
        [...document.querySelectorAll("section h3")].map((h) => {
          const a = h.closest("a");
          return { title: h.textContent.trim(), sub: a?.nextElementSibling?.textContent.trim() ?? null };
        }),
      );
      const by = (t) => cards.find((x) => x.title === t)?.sub ?? null;
      checks.push(c("C mocked fixtures drove the board (5 cards)", cards.length === 5 && mapRequests.length > 0, { cards, mapRequests: mapRequests.length }));
      const nd = by("FX Card Community no date");
      checks.push(c("C Community without a date: no date line (subtitle starts with the place)", !!nd && nd.startsWith("Alder Hall"), { nd }));
      const dd = by("FX Card Community dated");
      checks.push(c('C Community with a date: card shows "Dec 5" before the place', !!dd && /^Dec 5\D+Birch Hall/.test(dd), { dd }));
      const job = by("FX Card Job deadline");
      checks.push(c('C jobs with a Deadline: card reads "Apply by Jun 15" before the place', !!job && /^Apply by Jun 15\D+Cedar Hall/.test(job), { job }));
      const ho = by("FX Card Housing no deadline");
      checks.push(c("C housing without a Deadline: no date line", !!ho && ho.startsWith("Dogwood Hall"), { ho }));
      const sale = by("FX Card Sale legacy date");
      checks.push(c('C sale with only a legacy event date: the old date ("Mar 10") still shows', !!sale && /^Mar 10\D+Elm Hall/.test(sale), { sale }));
      await shot(page, `stage3-${vp}-C-cards`);
      await finish(page, errors, "C", { expectRed: 1 });
      await context.close();
    });

    // ===== D: detail pages (signed out, server-rendered from the mock)
    const detail = async (key, fn) => {
      await scn(`D-${key}`, async () => {
        const { page, errors, context } = await newPage(browser, vp, { savedCenter: null });
        await guardPublish(context, publishCalls);
        const resp = await page.goto(`${server.baseUrl}/p/${DB[key].id}`, { waitUntil: "load" });
        await page.waitForSelector("main", { timeout: 15000 });
        await page.waitForTimeout(600);
        if (!(await page.$("article h1"))) {
          checks.push(c(`D-${key} detail page rendered the mock posting`, false, { status: resp?.status(), body: (await bodyText(page)).slice(0, 200) }));
          await context.close();
          return;
        }
        const info = await page.evaluate(() => {
          const rows = [...document.querySelectorAll("article dl dd")].map((d) => d.textContent.trim());
          const until = [...document.querySelectorAll("article p")].map((p) => p.textContent.trim()).find((t) => /^On the board until/.test(t)) ?? null;
          const act = [...document.querySelectorAll("article a[target=_blank]")].map((a) => a.textContent.trim());
          return { rows, until, act };
        });
        await fn(info, page);
        await shot(page, `stage3-${vp}-D-${key}`);
        await finish(page, errors, `D-${key}`, { expectRed: info.act.length ? 1 : null });
        await context.close();
      });
    };
    await detail("commDate", async (i) => {
      checks.push(c('D Community with a date: button "RSVP"', i.act.length === 1 && /^RSVP/.test(i.act[0]), i.act));
      checks.push(c('D Community with a date: "On the board until ... (event ends)"', /^On the board until .*2099 \(event ends\)$/.test(i.until ?? ""), i));
      checks.push(c("D Community with a date: date row and time row present", i.rows.some((r) => /December 5, 2099|5 December 2099/.test(r)) && i.rows.includes("19:30"), i.rows));
    });
    await detail("commNoDate", async (i) => {
      checks.push(c('D Community without a date: button "Learn more"', i.act.length === 1 && /^Learn more/.test(i.act[0]), i.act));
      checks.push(c('D Community without a date: "On the board until ... (expiry)" and no date row', /^On the board until .*2099 \(expiry\)$/.test(i.until ?? "") && i.rows.length === 1 && i.rows[0] === "Cedar Hall", i));
    });
    await detail("commNoLink", async (i) => {
      checks.push(c("D Community without a link: no action button", i.act.length === 0, i.act));
    });
    await detail("job", async (i) => {
      checks.push(c('D jobs with a deadline: row "Apply by ..." with the date, no "Ends" row', i.rows.some((r) => /^Apply by .*June 15, 2099|^Apply by .*15 June 2099/.test(r)) && !i.rows.some((r) => /^Ends/.test(r)), i.rows));
      checks.push(c('D jobs: button "Apply"; takedown reason "(deadline)"', i.act.length === 1 && /^Apply/.test(i.act[0]) && /^On the board until .*2099 \(deadline\)$/.test(i.until ?? ""), i));
    });
    await detail("housingNoDeadline", async (i) => {
      checks.push(c('D housing without a deadline: no deadline row, button "View listing", reason "(expiry)"', i.rows.length === 1 && i.act.length === 1 && /^View listing/.test(i.act[0]) && /\(expiry\)$/.test(i.until ?? ""), i));
    });
    await detail("legacySale", async (i) => {
      checks.push(c("D sale with a legacy event date: the stored date still shows, no deadline row", i.rows.some((r) => /March 10, 2099|10 March 2099/.test(r)) && !i.rows.some((r) => /^Offer ends/.test(r)), i.rows));
    });

    // ===== E: edit page (owner via fake cookie), PATCH mocked
    const openEdit = async (key) => {
      const o = await newPage(browser, vp, { savedCenter: null });
      await signIn(o.context, server.baseUrl);
      await guardPublish(o.context, publishCalls);
      await o.page.goto(`${server.baseUrl}/p/${DB[key].id}/edit`, { waitUntil: "load" });
      await o.page.waitForSelector("main", { timeout: 15000 });
      await o.page.waitForTimeout(600);
      o.formThere = !!(await o.page.$('form button[type="submit"]'));
      return o;
    };
    await scn("E1", async () => {
      const o = await openEdit("legacySale");
      checks.push(c("E1 edit page renders for the (mock) owner", o.formThere, { url: o.page.url(), body: (await bodyText(o.page)).slice(0, 200) }));
      if (!o.formThere) return void (await o.context.close());
      const fs = await formFields(o.page);
      const note = await o.page.$eval('[role="note"]', (n) => n.textContent.trim()).catch(() => null);
      checks.push(c('E1 legacy-date sale: Deadline field "Offer ends (optional)" pre-filled with the stored date', field(fs, "deadline")?.label === "Offer ends (optional)" && field(fs, "deadline")?.value === "2099-03-10", field(fs, "deadline")));
      checks.push(c('E1 legacy-date notice names the stored date ("Mar 10") and says saving replaces it', /event date \(Mar 10\)/.test(note ?? "") && /Saving replaces the event date with the deadline/.test(note ?? ""), { note }));
      const live = await o.page.$eval('[aria-live="polite"] p.font-bold', (p) => p.textContent.trim()).catch(() => null);
      checks.push(c('E1 takedown line shows "your deadline passes"', /^Comes down on .+: your deadline passes$/.test(live ?? ""), { live }));
      checks.push(c("E1 listing edit has no event time or end fields", !field(fs, "eventTime") && !field(fs, "endDate") && !field(fs, "endTime"), labelsOf(fs)));
      await shot(o.page, `stage3-${vp}-E1-legacy`);
      await finish(o.page, o.errors, "E1", { expectRed: 1 });
      await o.context.close();
    });
    await scn("E2", async () => {
      const o = await openEdit("commDate");
      checks.push(c("E2 edit page renders for the (mock) owner", o.formThere, { url: o.page.url() }));
      if (!o.formThere) return void (await o.context.close());
      const patches = [];
      await o.page.route("**/api/postings/*", async (route) => {
        if (route.request().method() !== "PATCH") return route.fallback();
        patches.push(JSON.parse(route.request().postData() ?? "{}"));
        return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "This posting has ended, so its date can't be removed." }) });
      });
      let fs = await formFields(o.page);
      checks.push(c('E2 Community with a date: "Event date (optional)", date and time pre-filled', field(fs, "eventDate")?.label === "Event date (optional)" && field(fs, "eventDate")?.value === "2099-12-05" && field(fs, "eventTime")?.value === "19:30", fs.map((f) => [f.name, f.value])));
      await o.page.fill('input[name="title"]', "FX edited title");
      await o.page.fill('input[name="eventDate"]', "");
      await o.page.waitForTimeout(250);
      fs = await formFields(o.page);
      const live = await o.page.$eval('[aria-live="polite"] p.font-bold', (p) => p.textContent.trim()).catch(() => null);
      checks.push(c("E2 clearing the date disables Time, End date and End time and shows the expiry takedown line", field(fs, "eventTime").disabled && field(fs, "endDate").disabled && field(fs, "endTime").disabled && /the time you chose to keep it on the board ends$/.test(live ?? ""), { live }));
      await o.page.click('button[type="submit"]');
      await o.page.waitForFunction(() => /can't be removed/.test(document.body.innerText), null, { timeout: 5000 }).catch(() => {});
      const status = await o.page.$eval('p[role="status"]', (p) => p.textContent.trim()).catch(() => null);
      fs = await formFields(o.page);
      checks.push(c("E2 mocked 400 on save: the server error text is shown", status === "This posting has ended, so its date can't be removed.", { status }));
      checks.push(c("E2 the save sent eventDate null and the page stayed on the edit form with entered values kept", patches.length === 1 && patches[0].eventDate === null && /\/edit$/.test(o.page.url()) && field(fs, "title").value === "FX edited title" && field(fs, "eventDate").value === "", { patches, url: o.page.url(), title: field(fs, "title").value }));
      await shot(o.page, `stage3-${vp}-E2-rejected`);
      await finish(o.page, o.errors, "E2", { expectRed: 1 });
      await o.context.close();
    });
    await scn("E3", async () => {
      const o = await openEdit("music");
      if (!o.formThere) return void checks.push(c("E3 edit page renders (event)", false, { url: o.page.url() }));
      let fs = await formFields(o.page);
      checks.push(c("E3 event edit labels: Event date (required), Time, End date/time, Event place, RSVP link", JSON.stringify(labelsOf(fs)) === JSON.stringify(["Title", "Event date", "Time", "End date (optional)", "End time (optional)", "Event place", "Details", "RSVP link (optional)"]), labelsOf(fs)));
      await clickChip(o.page, "Jobs");
      fs = await formFields(o.page);
      const notes = await o.page.$$eval('[role="note"]', (ns) => ns.map((n) => n.textContent.trim()));
      checks.push(c("E3 switching event to a listing shows the event-to-listing notice before saving", notes.some((n) => /^Listings use a deadline instead of an event date\. Saving removes the event date, event time and end time\.$/.test(n)) && field(fs, "deadline")?.label === "Apply by (optional)", { notes, labels: labelsOf(fs) }));
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
const pub = c("no POST /api/postings was ever made (nothing published)", publishCalls.length === 0, publishCalls);
const onlyMock = c("server-side Supabase calls all went to the local mock (hit counts below)", mock.hits.length > 0, { total: mock.hits.length, sample: [...new Set(mock.hits)].slice(0, 12) });
out.global = [pub, onlyMock];
console.log("\n== global");
report(out.global);
if (!pub.pass) anyFail = true;
console.log("\nresults:", writeResults("stage3", out));
console.log(anyFail ? "STAGE 3: FAIL" : "STAGE 3: PASS");
process.exitCode = anyFail ? 1 : 0;
