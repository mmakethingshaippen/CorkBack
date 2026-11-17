// Page and privacy checks for the posting location work (task 9.3).
// Copy on the scan, review, edit and detail pages; the per-category place labels; the approximate note;
// the legacy "unreviewed" edit page; the edit two-step failure and Retry; the privacy and attribution
// rules of the picker; the home board staying independent; one dark-red action per screen; nothing external.
// Flow scenarios (drags, search failures, denied permission) live in scenarios.mjs (9.2).
// Run it like smoke.mjs (see README.md); the script starts and stops the mock and `next start` itself.
import {
  startMock, startServer, launchEdge, newPage, open, removeResults, writeResults, report, shot,
  checkNoHorizontalScroll, checkOneDarkRedAction, checkNothingExternal,
  MOCK_URL, OWNER, postingRow, uuid, SESSION_COOKIE,
} from "./lib.mjs";
import { BERKELEY, FX_FLYER_THREE, FX_MATCH_STREET, SAVED_BOARD_CENTER, FX_LOOKALIKE_STRINGS } from "./fixtures.mjs";

const NAME = "pages";
const OSM = "https://www.openstreetmap.org/copyright";
const SCAN_COPY = "We do not read your location when you scan";
const CONFIRM_Q = "Is this where the event or listing takes place?";
const SAVE_FAILED = "Your other changes were saved, but the location was not.";
const APPROX_NOTE = "Approximate location. The exact address is not shown.";
const UNREVIEWED = "This pin was set from where the posting was published. Check that it marks where this takes place.";
const OLD_WORDING = /pins?\s+where\s+you\s+are/i;
const COORD_TEXT = /-?\d{1,3}\.\d{4,}/;

const c = (name, pass, detail = null) => ({ name, pass: !!pass, detail });
removeResults(NAME);

const results = [];
const add = (...r) => results.push(...r);
const body = (page) => page.evaluate(() => document.body.innerText);
const distM = (a, b) => {
  const R = 6371000, t = (d) => (d * Math.PI) / 180;
  const h = Math.sin(t(b.lat - a.lat) / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(t(b.lng - a.lng) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const tileZooms = (urls) => urls.map((u) => Number(u.match(/openstreetmap\.org\/(\d+)\//)?.[1])).filter((z) => !Number.isNaN(z));

// Rows served by the mock Supabase. 1 legacy edit, 2 failure flow, 3 approximate, 4..7 detail kinds.
const rows = [
  postingRow(1, { location_precision: "unreviewed" }),
  postingRow(2, { location_precision: "unreviewed" }),
  postingRow(3, { location_precision: "approximate", place_label: "Westside" }),
  postingRow(4, { categories: { slug: "music" }, event_date: "2099-06-01", event_time: "19:30" }),
  postingRow(5, { categories: { slug: "sale" }, place_label: "Oak Street" }),
  postingRow(6, { categories: { slug: "lost-found" }, place_label: "Lakeside Park" }),
  postingRow(7, { categories: { slug: "community" }, event_date: null, place_label: "Library steps" }),
];
const mock = await startMock(rows);
const server = await startServer(3200);
const browser = await launchEdge();
const base = server.baseUrl;
const contexts = [];
const fresh = async (vp, opts = {}) => {
  const r = await newPage(browser, vp, { baseUrl: base, ...opts });
  contexts.push(r);
  return r;
};

try {
  // ------------------------------------------------------------ scan, review, edit, detail: copy + one dark-red action
  for (const vp of ["mobile", "desktop"]) {
    const scan = await fresh(vp, { flyer: FX_FLYER_THREE });
    await open(scan.page, base, "/scan");
    const st = await body(scan.page);
    add(
      c(`${vp} scan: says we do not read your location when you scan`, st.includes(SCAN_COPY)),
      c(`${vp} scan: no "pins where you are" wording`, !OLD_WORDING.test(st)),
      c(`${vp} scan: no device location read`, (await scan.h.geoCalls()) === 0),
      await checkOneDarkRedAction(scan.page),
      await checkNoHorizontalScroll(scan.page),
      checkNothingExternal(scan.h, mock),
    );
    await shot(scan.page, `pages-scan-${vp}`);

    const rev = await fresh(vp, { flyer: FX_FLYER_THREE });
    await open(rev.page, base, "/scan/review");
    const rt = await body(rev.page);
    add(
      c(`${vp} review: no "pins where you are" wording`, !OLD_WORDING.test(rt)),
      c(`${vp} review: picker heading and "Your flyer" candidates shown`, rt.includes("Where does this take place?") && rt.includes("Addresses found on the flyer")),
      c(`${vp} review: flyer photo is not published line`, rt.includes("The flyer photo is not published")),
      c(`${vp} review: no device location read on load`, (await rev.h.geoCalls()) === 0),
      await checkOneDarkRedAction(rev.page),
      await checkNoHorizontalScroll(rev.page),
      checkNothingExternal(rev.h, mock),
    );
    await shot(rev.page, `pages-review-${vp}`);

    const edit = await fresh(vp);
    await open(edit.page, base, `/p/${uuid(1)}/edit`);
    const et = await body(edit.page);
    add(
      c(`${vp} edit: no "pins where you are" wording`, !OLD_WORDING.test(et)),
      c(`${vp} edit: shows the Location section`, et.includes("Location") && et.includes("Change location")),
      await checkOneDarkRedAction(edit.page),
      await checkNoHorizontalScroll(edit.page),
      checkNothingExternal(edit.h, mock),
    );

    const det = await fresh(vp);
    await open(det.page, base, `/p/${uuid(4)}`);
    const dt = await body(det.page);
    add(
      c(`${vp} detail: no "pins where you are" wording`, !OLD_WORDING.test(dt)),
      await checkNoHorizontalScroll(det.page),
      checkNothingExternal(det.h, mock),
    );
    for (const x of [scan, rev, edit, det]) await x.context.close();
  }

  // ------------------------------------------------------------ detail page labels, approximate note, no coordinates
  const cookie = `${SESSION_COOKIE.name}=${SESSION_COOKIE.value}`;
  const kinds = [
    [4, "music", "Event venue", "Cedar Hall"],
    [5, "sale", "Listing location", "Oak Street"],
    [6, "lost-found", "Lost or found near", "Lakeside Park"],
    [7, "community (no date)", "Location", "Library steps"],
  ];
  const det = await fresh("mobile");
  for (const [n, kind, label, place] of kinds) {
    await open(det.page, base, `/p/${uuid(n)}`, 800);
    const t = await body(det.page);
    add(
      c(`detail ${kind}: label "${label}:" before the place`, t.includes(`${label}: ${place}`) || t.includes(`${label}:`) && t.includes(place), t.slice(0, 200)),
      c(`detail ${kind}: no approximate note on an exact posting`, !t.includes(APPROX_NOTE)),
      c(`detail ${kind}: no coordinates in visible text`, !COORD_TEXT.test(t)),
    );
  }
  await open(det.page, base, `/p/${uuid(3)}`, 800);
  const at = await body(det.page);
  add(c("detail approximate: shows the approximate note", at.includes(APPROX_NOTE)));
  await shot(det.page, "pages-detail-approx");
  // The server HTML of every detail page: no device or exact position, and no coordinate other than the public pin.
  const pub = new Set([String(rows[0].lat), String(rows[0].lng)]);
  for (const n of [3, 4, 5, 6, 7]) {
    const html = await (await fetch(`${base}/p/${uuid(n)}`, { headers: { cookie } })).text();
    const decimals = [...new Set(html.match(/-?\d{2,3}\.\d{4,}/g) ?? [])];
    const extra = decimals.filter((d) => !pub.has(d));
    add(
      c(`detail ${n}: no device position in the HTML`, !html.includes("37.8044") && !html.includes("-122.2712")),
      c(`detail ${n}: no coordinate in the HTML beyond the public pin`, extra.length === 0, extra),
    );
  }
  add(checkNothingExternal(det.h, mock));

  // ------------------------------------------------------------ legacy "unreviewed" edit page
  {
    const { page, h, errors } = await fresh("desktop", { geolocation: "granted" });
    await open(page, base, `/p/${uuid(1)}/edit`);
    const t = await body(page);
    add(
      c("legacy edit: shows the unreviewed review notice", t.includes(UNREVIEWED)),
      c("legacy edit: shows the current pin (map of the current location)", (await page.locator('[aria-label="Map of the current location"]').count()) > 0),
      c("legacy edit: no request of any kind before Save", h.posts.length + h.patches.length + h.retries.length + h.geocodeRequests.length === 0 && (await h.geoCalls()) === 0,
        { posts: h.posts.length, patches: h.patches.length, retries: h.retries.length, geocode: h.geocodeRequests.length }),
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.waitForTimeout(1200);
    add(
      c("legacy edit: Save without a new place sends no location", h.patches.length === 1 && !("location" in h.patches[0].body), h.patches[0]?.body),
      c("legacy edit: no device location read", (await h.geoCalls()) === 0),
      c("legacy edit: no page errors", errors.length === 0, errors),
      checkNothingExternal(h, mock),
    );
  }

  // ------------------------------------------------------------ edit: new place, two-step failure, Retry keeps the pin
  {
    const { page, h, errors } = await fresh("desktop", { geocode: "street" });
    h.patchAnswer = "locationFailed";
    await open(page, base, `/p/${uuid(2)}/edit`);
    await page.getByRole("button", { name: "Change location" }).click();
    add(await checkOneDarkRedAction(page));
    await page.locator("[role=search] input").fill("200 Maple Avenue, Berkeley");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: /Maple Hall/ }).first().click({ timeout: 8000 });
    add(c("edit: confirmation question shown", (await body(page)).includes(CONFIRM_Q)));
    await page.getByRole("button", { name: "Yes, use this place" }).click();
    await page.getByRole("button", { name: "Save changes" }).click();
    await page.getByText(SAVE_FAILED).first().waitFor({ timeout: 8000 });
    const loc = h.patches[0]?.body?.location;
    add(
      c("edit: one PATCH carries one location block with the confirmed point",
        h.patches.length === 1 && loc && loc.lat === FX_MATCH_STREET.point.lat && loc.lng === FX_MATCH_STREET.point.lng && loc.confirmed === true && loc.precision === "exact", h.patches[0]?.body),
      c('edit: shows "Your other changes were saved, but the location was not."', true),
      c("edit: Retry button shown", (await page.getByRole("button", { name: "Retry" }).count()) === 1),
      c("edit: chosen pin kept (map of the new location)", (await page.locator('[aria-label="Map of the new location"]').count()) > 0),
    );
    // Retry fails once: still one Retry, the pin is kept. Then it succeeds.
    h.retryAnswer = "retryFailed";
    await page.getByRole("button", { name: "Retry" }).click();
    await page.waitForTimeout(800);
    add(
      c("edit: failed Retry keeps the message, the button and the pin",
        h.retries.length === 1 && (await body(page)).includes(SAVE_FAILED) && (await page.getByRole("button", { name: "Retry" }).count()) === 1
          && (await page.locator('[aria-label="Map of the new location"]').count()) > 0),
    );
    h.retryAnswer = "retryOk";
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText("Location saved.").waitFor({ timeout: 8000 });
    add(
      c("edit: Retry bodies hold only {location} with the same chosen pin",
        h.retries.length === 2 && h.retries.every((r) => Object.keys(r.body).join() === "location" && JSON.stringify(r.body.location) === JSON.stringify(loc)), h.retries),
      c("edit: only the original PATCH carried content (no second content write)", h.patches.length === 1),
      c("edit: geocoder asked only with the typed text", h.geocodeRequests.length === 1 && h.geocodeRequests[0].q === "200 Maple Avenue, Berkeley", h.geocodeRequests),
      c("edit: no device location read", (await h.geoCalls()) === 0),
      c("edit: no page errors", errors.length === 0, errors),
      checkNothingExternal(h, mock),
    );
    await shot(page, "pages-edit-retry");
  }

  // ------------------------------------------------------------ edit page for an approximate posting
  {
    const { page, h } = await fresh("desktop");
    await open(page, base, `/p/${uuid(3)}/edit`);
    const t = await body(page);
    add(
      c("approximate edit: private-home note and checked box", t.includes("This posting already uses an approximate pin")),
      c("approximate edit: no request before Save", h.patches.length + h.retries.length + h.geocodeRequests.length === 0),
      checkNothingExternal(h, mock),
    );
  }

  // ------------------------------------------------------------ review page: privacy, attribution, leaks, board independence
  {
    const { page, h, errors } = await fresh("desktop", {
      flyer: FX_FLYER_THREE, geocode: "street", geolocation: "granted", savedBoardCenter: SAVED_BOARD_CENTER,
    });
    const tiles = [];
    page.on("request", (r) => { if (/tile\.openstreetmap\.org/.test(r.url())) tiles.push(r.url()); });
    await open(page, base, "/scan/review", 2500);
    const boardBefore = await page.evaluate(() => localStorage.getItem("corkback.mapCenter"));
    const z0 = tileZooms(tiles);
    add(
      c("review: start view ignores the saved board centre (low-zoom default view)", z0.length > 0 && Math.max(...z0) <= 5, { zooms: [...new Set(z0)] }),
      c("review: attribution link on the map", (await page.locator(`.maplibregl-ctrl-attrib a[href="${OSM}"]`).count()) >= 1),
    );

    // Look-alike numbers do not warn.
    const details = page.locator("#body");
    await details.fill(`Doors ${FX_LOOKALIKE_STRINGS.join(" ")}`);
    add(c("review: look-alike numbers do not show the personal-details warning", (await page.locator("#leaks-warning, :text('Check for personal details')").count()) === 0));

    // Search from the first flyer candidate.
    await page.getByRole("button", { name: "Find on map" }).first().click();
    await page.getByText("Matches", { exact: true }).waitFor({ timeout: 8000 });
    add(
      c("review: attribution link next to the results", (await page.locator(`p:has-text("Map data") a[href="${OSM}"]`).count()) === 1),
      c("review: geocoder URL holds only the selected address text",
        h.geocodeRequests.length === 1 && h.geocodeRequests[0].q === FX_FLYER_THREE.addresses[0].text && new URL(h.geocodeRequests[0].url).searchParams.size === 1, h.geocodeRequests),
    );
    await page.getByRole("button", { name: /Maple Hall/ }).first().click();
    const pt = await body(page);
    add(
      c("review: confirmation question shown", pt.includes(CONFIRM_Q)),
      c("review: no coordinates on screen while proposing", !COORD_TEXT.test(pt)),
      await checkOneDarkRedAction(page),
    );
    await page.getByRole("button", { name: "Yes, use this place" }).click();
    await page.getByText("Pin confirmed.").waitFor({ timeout: 5000 });

    // Private home preview: the explanation, no exact point sent.
    await page.getByLabel("This place is a private home").check();
    const ht = await body(page);
    add(
      c("review: private-home explanation (quarter mile, street address not shown)",
        ht.includes("Visitors will see a pin about a quarter mile (400 m) from this place, not the exact spot.") && ht.includes("leave out the house number.")),
      c("review: no latitude or longitude text on screen after confirming", !COORD_TEXT.test(ht)),
    );
    await shot(page, "pages-review-private-home");

    // Personal details: warning blocks Publish until acknowledged; text stays unchanged.
    const typed = "Call 510-555-0142 or jane.doe@example.com";
    await details.fill(typed);
    await page.getByText("Check for personal details").waitFor({ timeout: 5000 });
    add(
      c("review: warning names the phone and the email and says venue details can stay",
        (await body(page)).includes("510-555-0142") && (await body(page)).includes("jane.doe@example.com") && (await body(page)).includes("Public venue or organizer details can stay")),
      await checkOneDarkRedAction(page),
    );
    await page.getByRole("button", { name: "Publish to the map" }).click();
    await page.waitForTimeout(600);
    add(
      c("review: Publish is blocked until the box is checked (no POST)", h.posts.length === 0 && (await body(page)).includes("Check the box to confirm")),
      c("review: warning leaves the typed text unchanged", (await details.inputValue()) === typed),
    );
    await page.locator("#leaksAck").check();
    await page.getByRole("button", { name: "Publish to the map" }).click();
    await page.waitForTimeout(1200);
    const post = h.posts[0];
    const sent = post?.location;
    add(
      c("review: after acknowledging, exactly one POST", h.posts.length === 1, h.posts.length),
      c("review: POST details text equals the typed text", post?.body === typed, post?.body),
      c("review: private home sends an approximate pin 150 to 400 m from the confirmed place, never the exact point",
        sent && sent.precision === "approximate" && sent.confirmed === true
          && distM(sent, FX_MATCH_STREET.point) >= 150 && distM(sent, FX_MATCH_STREET.point) <= 400
          && !(sent.lat === FX_MATCH_STREET.point.lat && sent.lng === FX_MATCH_STREET.point.lng), sent),
      c("review: POST holds no candidate text and no device position", !JSON.stringify(post ?? {}).includes("37.8044") && !JSON.stringify(post ?? {}).includes("Return Lane")),
    );

    // Home board independence: nothing the posting flow did touched the board's storage.
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("corkback.")));
    const boardAfter = await page.evaluate(() => localStorage.getItem("corkback.mapCenter"));
    add(
      c("review: flow wrote no board storage keys (only the seeded mapCenter exists)", keys.length === 1 && keys[0] === "corkback.mapCenter", keys),
      c("review: saved board centre unchanged by the flow", boardAfter === boardBefore, { boardBefore, boardAfter }),
      c("review: no device location read without the shortcut", (await h.geoCalls()) === 0),
      c("review: no page errors", errors.length === 0, errors),
      checkNothingExternal(h, mock),
    );
  }

  // The "Use my location" shortcut reads the device once, and still writes no board key.
  {
    const { page, h } = await fresh("desktop", { flyer: FX_FLYER_THREE, geolocation: "granted", savedBoardCenter: SAVED_BOARD_CENTER });
    await open(page, base, "/scan/review");
    const before = await page.evaluate(() => localStorage.getItem("corkback.mapCenter"));
    await page.getByRole("button", { name: "Use my location" }).click();
    await page.getByText(CONFIRM_Q).first().waitFor({ timeout: 8000 });
    const after = await page.evaluate(() => localStorage.getItem("corkback.mapCenter"));
    const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("corkback.")));
    add(
      c("shortcut: one device read, after the tap", (await h.geoCalls()) === 1, await h.geoCalls()),
      c("shortcut: saved board centre unchanged", after === before, { before, after }),
      c("shortcut: no radius or other board key written", keys.join() === "corkback.mapCenter", keys),
      c("shortcut: device position not on screen before confirming", !COORD_TEXT.test(await body(page))),
      checkNothingExternal(h, mock),
    );
  }

  // The home board keeps its own permission-gated behaviour (not changed by the posting flow).
  {
    const { page, h, errors } = await fresh("desktop", { permission: "prompt", geolocation: "granted", savedBoardCenter: SAVED_BOARD_CENTER });
    await open(page, base, "/", 2500);
    add(
      c("board: with permission not granted, the board makes no device read", (await h.geoCalls()) === 0, await h.geoCalls()),
      c("board: saved centre still in storage and untouched", (await page.evaluate(() => localStorage.getItem("corkback.mapCenter"))) === JSON.stringify(SAVED_BOARD_CENTER)),
      c("board: no page errors", errors.length === 0, errors),
      checkNothingExternal(h, mock),
    );
    await shot(page, "pages-board");
  }
} finally {
  for (const x of contexts) await x.context.close().catch(() => {});
  await browser.close().catch(() => {});
  await server.stop();
  await mock.stop();
}
report(results);
writeResults(NAME, { when: new Date().toISOString(), mock: MOCK_URL, owner: OWNER, berkeley: BERKELEY, results });
process.exit(results.every((r) => r.pass) ? 0 : 1);
