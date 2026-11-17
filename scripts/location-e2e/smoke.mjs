// Smoke run for the location harness (task 9.1). Proves the plumbing, not the feature:
// server starts against the mock Supabase, the mocks answer, geolocation is controlled,
// nothing leaves the machine. Scenario checks live in scenarios.mjs and pages.mjs (9.2, 9.3).
import {
  startMock, startServer, launchEdge, newPage, open, removeResults, writeResults, report, shot,
  checkNoHorizontalScroll, checkNothingExternal, MOCK_URL, postingRow,
} from "./lib.mjs";
import { FX_FLYER_THREE } from "./fixtures.mjs";

const NAME = "smoke";
const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
removeResults(NAME);

const results = [];
const mock = await startMock({ a: postingRow(1) });
const server = await startServer(3200);
const browser = await launchEdge();
try {
  for (const vp of ["mobile", "desktop"]) {
    const geo = vp === "mobile" ? "granted" : "denied";
    const { context, page, errors, h } = await newPage(browser, vp, { baseUrl: server.baseUrl, flyer: FX_FLYER_THREE, geolocation: geo, geocode: "street" });
    await open(page, server.baseUrl, "/scan/review");
    const text = await page.evaluate(() => document.body.innerText);
    results.push(c(`${vp}: review page renders`, text.length > 100, { len: text.length, head: text.slice(0, 120) }));
    results.push(c(`${vp}: seeded flyer visible`, text.includes("Spring bake sale") || (await page.$('input[value="Spring bake sale"]')) !== null, null));
    results.push(await checkNoHorizontalScroll(page));
    results.push(c(`${vp}: scanning reads no device location`, (await h.geoCalls()) === 0, await h.geoCalls()));

    // Mock plumbing, driven from inside the page like the app would.
    const q = "200 Maple Avenue, Berkeley";
    const g = await page.evaluate(async (q) => (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`)).json(), q);
    results.push(c(`${vp}: /api/geocode mocked and recorded`, g.state === "ok" && h.geocodeRequests.length === 1 && h.geocodeRequests[0].q === q, { g, rec: h.geocodeRequests }));
    h.geocode = "busy";
    const gb = await page.evaluate(async () => (await fetch("/api/geocode?q=abc")).status);
    results.push(c(`${vp}: geocode busy answer`, gb === 429, gb));
    h.patchAnswer = "locationFailed";
    const pr = await page.evaluate(async () => {
      const r = await fetch("/api/postings/fx-1", { method: "PATCH", body: JSON.stringify({ title: "x" }) });
      return { status: r.status, body: await r.json() };
    });
    results.push(c(`${vp}: PATCH recorded, canned location_failed`, pr.status === 500 && pr.body.code === "location_failed" && h.patches.length === 1, pr));
    await page.evaluate(() => fetch("/api/postings/fx-1/location", { method: "PATCH", body: JSON.stringify({ location: { lat: 1 } }) }));
    results.push(c(`${vp}: retry route recorded`, h.retries.length === 1 && Object.keys(h.retries[0].body).join() === "location", h.retries));

    // Geolocation stub: granted answers, denied errors, counter counts.
    const r = await page.evaluate(() => new Promise((res) => navigator.geolocation.getCurrentPosition((p) => res({ ok: p.coords.latitude }), (e) => res({ err: e.code }))));
    results.push(c(`${vp}: geolocation stub (${geo})`, geo === "granted" ? "ok" in r : r.err === 1, r));
    results.push(c(`${vp}: geolocation call counter`, (await h.geoCalls()) === 1, await h.geoCalls()));

    // A direct call to a real host is blocked and reported.
    await page.evaluate(() => fetch("https://nominatim.openstreetmap.org/search?q=x").catch(() => null));
    results.push(c(`${vp}: direct geocoder call is blocked and recorded`, h.external.length === 1, h.external));
    h.external.length = 0;
    results.push(checkNothingExternal(h, mock));
    results.push(c(`${vp}: no page errors`, errors.length === 0, errors));
    await shot(page, `smoke-${vp}`);
    await context.close();
  }
  // Detail page through the mock Supabase (server-rendered read).
  const { context, page, h } = await newPage(browser, "mobile", { baseUrl: server.baseUrl });
  await open(page, server.baseUrl, `/p/${postingRow(1).id}`);
  const t = await page.evaluate(() => document.body.innerText);
  results.push(c("detail page served from the mock Supabase", t.includes("FX posting"), t.slice(0, 120)));
  results.push(checkNothingExternal(h, mock));
  await context.close();
} finally {
  await browser.close().catch(() => {});
  await server.stop();
  await mock.stop();
}
report(results);
writeResults(NAME, { when: new Date().toISOString(), mock: MOCK_URL, mockHits: mock.hits, results });
process.exit(results.every((r) => r.pass) ? 0 : 1);
