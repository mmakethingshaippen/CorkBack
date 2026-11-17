// Scenario checks for the posting location work (task 9.2, Requirement 17.11).
// Real Edge, 390x844 and 1280x800, local production build, mocked scan/geocoder/posting routes,
// stubbed navigator.geolocation. Nothing real is contacted. See README.md for how to run.
import {
  startMock, startServer, launchEdge, newPage, open, dragMouse, removeResults, writeResults, report, shot,
  checkNoHorizontalScroll, checkNothingExternal, MOCK_URL, postingRow, uuid,
} from "./lib.mjs";
import {
  FX_FLYER_HOME, FX_FLYER_THREE, FX_FLYER_NONE, FX_MATCH_STREET, FX_MATCHES_AMBIGUOUS,
  FX_CONTACT_STRINGS, FX_LOOKALIKE_STRINGS, SAVED_BOARD_CENTER, STUB_POSITION,
} from "./fixtures.mjs";

const NAME = "scenarios";
const QUESTION = "Is this where the event or listing takes place?";
const MAP = '[aria-label="Map for placing the pin"]';
const MSG = {
  deviceFailed: "We could not get your location. You can search or place the pin on the map.",
  unavailable: "Place search is unavailable right now. You can still place the pin on the map.",
  busy: "Place search is busy. Try again in a moment.",
  refused: "That search includes a phone number or email address, so it was not sent. Search with just the street address or the place name.",
  chooseFirst: "Choose where this takes place on the map before publishing.",
  ackFirst: "Check the box to confirm your posting does not show a home or personal address.",
  saveFailed: "Your other changes were saved, but the location was not.",
  retryFailed: "The location was not saved. Try again.",
  sendNote: "Searching sends only this address text to a public map search service.",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = (name, pass, detail) => ({ name, pass: !!pass, detail });
removeResults(NAME);

async function until(fn, ms = 6000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await sleep(100);
  }
  return false;
}
const text = (page) => page.evaluate(() => document.body.innerText);
const has = async (page, s) => (await text(page)).includes(s);
const count = (page, s) => page.getByText(s, { exact: true }).count();
const isVisible = (loc) => loc.first().isVisible().catch(() => false);
const btn = (page, name) => page.getByRole("button", { name, exact: true });

function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function centerMap(page) {
  await page.locator(MAP).evaluate((el) => el.scrollIntoView({ block: "center" }));
  await sleep(250);
}
/** Tap an empty part of the map (away from the zoom control and from a pin that sits at the centre). */
async function tapMap(page) {
  await centerMap(page);
  const b = await page.locator(MAP).boundingBox();
  await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.7);
  await sleep(800);
}
async function markerCount(page) {
  return page.locator(".maplibregl-marker").count();
}
async function markerCenter(page) {
  await centerMap(page);
  await sleep(600);
  const b = await page.locator(".maplibregl-marker").first().boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function yes(page) {
  await btn(page, "Yes, use this place").click();
  await sleep(300);
}
async function publish(page) {
  await page.getByRole("button", { name: "Publish to the map", exact: true }).click();
}
async function search(page, q) {
  await page.getByLabel("Search for a place or address").fill(q);
  await page.getByRole("button", { name: "Search", exact: true }).click();
}
async function ackIfShown(page) {
  const ack = page.locator("#leaksAck");
  if ((await ack.count()) && !(await ack.isChecked())) await ack.check();
}
/** Every geocoder request carries only `q`, and q is one of the expected strings, in order. */
function onlyQ(h, expected) {
  const keys = h.geocodeRequests.map((r) => [...new URL(r.url).searchParams.keys()].join(","));
  const paths = h.geocodeRequests.map((r) => new URL(r.url).pathname);
  const qs = h.geocodeRequests.map((r) => r.q);
  const pass = keys.every((k) => k === "q") && paths.every((p) => p === "/api/geocode") && JSON.stringify(qs) === JSON.stringify(expected);
  return { pass, detail: { qs, expected, keys } };
}
/** The publish body holds the location block and nothing that describes a device or an exact point. */
function locationBody(post) {
  const loc = post?.location;
  const keys = loc ? Object.keys(loc).sort().join(",") : "";
  const top = Object.keys(post ?? {});
  const json = JSON.stringify(post ?? {});
  const noLeak = !["real", "desired", "coords", "position", "lat", "lng", "device"].some((k) => top.includes(k)) &&
    !json.includes(String(STUB_POSITION.latitude)) && !json.includes(String(STUB_POSITION.longitude));
  const pass = keys === "confirmed,lat,lng,precision,source" && loc.confirmed === true && Number.isFinite(loc.lat) && Number.isFinite(loc.lng) &&
    ["exact", "approximate"].includes(loc.precision) && ["flyer_candidate", "search", "pin", "device"].includes(loc.source) && noLeak;
  return { pass, detail: { keys, top, loc } };
}

async function shared(vp, label, { page, errors, h }, mock, results) {
  results.push(await checkNoHorizontalScroll(page).then((r) => ({ ...r, name: `${vp}: ${label}: ${r.name}` })));
  results.push(c(`${vp}: ${label}: no page errors`, errors.length === 0, errors));
  const ext = checkNothingExternal(h, mock);
  results.push({ ...ext, name: `${vp}: ${label}: ${ext.name}` });
}

// ============================================================================ scenarios
// Each takes (ctx, vp, results) and records c(...) entries.

async function scanningAtHome(ctx, vp, results) {
  const t = `${vp}: scanning at home`;
  const p = await newPage(ctx.browser, vp, {
    baseUrl: ctx.baseUrl, flyer: FX_FLYER_HOME, geocode: "street", geolocation: "granted", permission: "granted", savedBoardCenter: SAVED_BOARD_CENTER,
  });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    results.push(c(`${t}: device location never called on load`, (await h.geoCalls()) === 0, await h.geoCalls()));
    results.push(c(`${t}: the home-looking address is only a candidate`, await has(page, "1427 Elm Street, Berkeley, CA 94704"), null));
    results.push(c(`${t}: no pin, no proposal, no question bar`, (await markerCount(page)) === 0 && !(await isVisible(btn(page, "Yes, use this place"))), await markerCount(page)));
    results.push(c(`${t}: no geocoder request before a tap`, h.geocodeRequests.length === 0, h.geocodeRequests));
    results.push(c(`${t}: shows the "sends only this address text" note`, await has(page, MSG.sendNote), null));
    await publish(page);
    await sleep(600);
    results.push(c(`${t}: Publish before confirming sends nothing and says to choose a place`, h.posts.length === 0 && (await has(page, MSG.chooseFirst)), { posts: h.posts.length }));

    await page.getByRole("button", { name: "Find on map", exact: true }).click();
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: Find on map sends only the candidate text`, ...Object.values(onlyQ(h, ["1427 Elm Street, Berkeley, CA 94704"]))));
    results.push(c(`${t}: question text shown exactly`, (await count(page, QUESTION)) >= 2 && (await isVisible(page.locator("p.font-bold", { hasText: QUESTION }))), await count(page, QUESTION)));
    results.push(c(`${t}: a proposal pin is on the map`, (await markerCount(page)) === 1, await markerCount(page)));
    await shot(page, `scenario-home-${vp}`);
    await publish(page);
    await sleep(600);
    results.push(c(`${t}: unanswered question keeps Publish from sending`, h.posts.length === 0, h.posts.length));

    await yes(page);
    results.push(c(`${t}: confirmed state shown`, await has(page, "Pin confirmed."), null));
    await ackIfShown(page);
    await publish(page);
    results.push(c(`${t}: one publish after Yes`, await until(() => h.posts.length === 1), h.posts.length));
    const post = h.posts[0];
    const lb = locationBody(post);
    results.push(c(`${t}: body location is {lat,lng,source,confirmed,precision} only`, lb.pass, lb.detail));
    results.push(c(`${t}: body is the confirmed match, flyer_candidate, exact`, post?.location?.source === "flyer_candidate" && post.location.precision === "exact" && distance(post.location, FX_MATCH_STREET.point) < 1, post?.location));
    results.push(c(`${t}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
    await shared(vp, "scanning at home", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function multipleAddresses(ctx, vp, results) {
  const t = `${vp}: multiple addresses`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_THREE, geocode: "street" });
  const { page, h } = p;
  const [venue, contact, ret] = FX_FLYER_THREE.addresses.map((a) => a.text);
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    const finds = page.getByRole("button", { name: "Find on map", exact: true });
    results.push(c(`${t}: three candidates, three Find on map buttons`, (await finds.count()) === 3, await finds.count()));
    results.push(c(`${t}: all three address texts listed`, (await has(page, venue)) && (await has(page, contact)) && (await has(page, ret)), null));
    results.push(c(`${t}: question asked once per candidate`, (await count(page, QUESTION)) === 3, await count(page, QUESTION)));
    results.push(c(`${t}: no pin and no request until a tap`, (await markerCount(page)) === 0 && h.geocodeRequests.length === 0, null));
    await publish(page);
    await sleep(500);
    results.push(c(`${t}: Publish with nothing chosen sends nothing`, h.posts.length === 0, h.posts.length));

    // Choose the contact address, then back out.
    await finds.nth(1).click();
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: contact candidate sends only its own text`, ...Object.values(onlyQ(h, [contact]))));
    await btn(page, "No, choose another").click();
    await sleep(300);
    results.push(c(`${t}: "No, choose another" returns to the list and keeps no pin`, (await finds.count()) === 3 && !(await isVisible(btn(page, "Yes, use this place"))), null));
    await publish(page);
    await sleep(500);
    results.push(c(`${t}: after "No" nothing is confirmed`, h.posts.length === 0, h.posts.length));

    // Choose the venue, confirm.
    await finds.nth(0).click();
    await until(() => h.geocodeRequests.length === 2);
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: only the two chosen texts were ever sent`, ...Object.values(onlyQ(h, [contact, venue]))));
    await yes(page);
    await ackIfShown(page);
    await publish(page);
    results.push(c(`${t}: one publish`, await until(() => h.posts.length === 1), h.posts.length));
    const post = h.posts[0];
    const lb = locationBody(post);
    results.push(c(`${t}: body location block only`, lb.pass, lb.detail));
    results.push(c(`${t}: confirmed point is the venue match`, post?.location?.source === "flyer_candidate" && distance(post.location, FX_MATCH_STREET.point) < 1, post?.location));
    results.push(c(`${t}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
    await shared(vp, "multiple addresses", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function noAddress(ctx, vp, results) {
  const t = `${vp}: no address`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: "empty" });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    results.push(c(`${t}: no candidate list, search box and map available`, !(await has(page, "Addresses found on the flyer")) && (await isVisible(page.getByLabel("Search for a place or address"))) && (await isVisible(page.locator(MAP))), null));
    await search(page, "Piedmont Park");
    await until(() => h.geocodeRequests.length === 1);
    await sleep(500);
    results.push(c(`${t}: search sends only the typed text`, ...Object.values(onlyQ(h, ["Piedmont Park"]))));
    results.push(c(`${t}: empty answer sets no pin`, (await markerCount(page)) === 0, null));
    await tapMap(page);
    results.push(c(`${t}: a map tap proposes a pin and asks the question`, (await markerCount(page)) === 1 && (await isVisible(page.locator("p.font-bold", { hasText: QUESTION }))), await markerCount(page)));
    await publish(page);
    await sleep(500);
    results.push(c(`${t}: unconfirmed tap does not publish`, h.posts.length === 0, h.posts.length));
    await btn(page, "Move pin north").click();
    await sleep(300);
    results.push(c(`${t}: a nudge keeps the proposal unconfirmed`, await isVisible(btn(page, "Yes, use this place")), null));
    await yes(page);
    await ackIfShown(page);
    await publish(page);
    results.push(c(`${t}: one publish`, await until(() => h.posts.length === 1), h.posts.length));
    const post = h.posts[0];
    const lb = locationBody(post);
    results.push(c(`${t}: body location block only, source pin, exact`, lb.pass && post.location.source === "pin" && post.location.precision === "exact", lb.detail));
    results.push(c(`${t}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
    await shared(vp, "no address", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function ambiguousMatches(ctx, vp, results) {
  const t = `${vp}: ambiguous matches`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: "ambiguous" });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    await search(page, "Central Library");
    await until(() => page.getByRole("button", { name: /Northside/ }).count().then((n) => n > 0));
    results.push(c(`${t}: both matches listed`, (await page.getByRole("button", { name: /Downtown/ }).count()) === 1 && (await page.getByRole("button", { name: /Northside/ }).count()) === 1, null));
    results.push(c(`${t}: no automatic proposal, no pin`, (await markerCount(page)) === 0 && !(await isVisible(btn(page, "Yes, use this place"))), await markerCount(page)));
    await publish(page);
    await sleep(500);
    results.push(c(`${t}: nothing publishes before a match is selected`, h.posts.length === 0, h.posts.length));
    await page.getByRole("button", { name: /Northside/ }).click();
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: selecting a match shows the pin and the question`, (await markerCount(page)) === 1 && (await isVisible(page.locator("p.font-bold", { hasText: QUESTION }))), null));
    results.push(c(`${t}: attribution link next to results`, (await page.locator('a[href="https://www.openstreetmap.org/copyright"]').count()) >= 1, null));
    await yes(page);
    await ackIfShown(page);
    await publish(page);
    results.push(c(`${t}: one publish`, await until(() => h.posts.length === 1), h.posts.length));
    const post = h.posts[0];
    const lb = locationBody(post);
    results.push(c(`${t}: body is the selected match, source search`, lb.pass && post.location.source === "search" && distance(post.location, FX_MATCHES_AMBIGUOUS[1].point) < 1, lb.detail));
    results.push(c(`${t}: only the typed text was sent`, ...Object.values(onlyQ(h, ["Central Library"]))));
    await shared(vp, "ambiguous matches", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function deniedPermission(ctx, vp, results) {
  const t = `${vp}: denied location permission`;
  for (const geo of ["denied", "absent"]) {
    const tt = `${t} (${geo})`;
    const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: "street", geolocation: geo, permission: geo === "denied" ? "denied" : "prompt" });
    const { page, h } = p;
    try {
      await open(page, ctx.baseUrl, "/scan/review");
      results.push(c(`${tt}: nothing asked on load`, (await h.geoCalls()) === 0, await h.geoCalls()));
      await search(page, "Maple Hall");
      await until(() => isVisible(btn(page, "Yes, use this place")));
      const before = await markerCount(page);
      await btn(page, "Use my location").click();
      await until(() => has(page, MSG.deviceFailed));
      results.push(c(`${tt}: failure message shown`, await has(page, MSG.deviceFailed), (await text(page)).slice(0, 300)));
      results.push(c(`${tt}: existing draft unchanged (proposal and question stay)`, before === 1 && (await markerCount(page)) === 1 && (await isVisible(btn(page, "Yes, use this place"))), null));
      results.push(c(`${tt}: shortcut was tapped once`, (await h.geoCalls()) === (geo === "denied" ? 1 : 0), await h.geoCalls()));
      await yes(page);
      await ackIfShown(page);
      await publish(page);
      results.push(c(`${tt}: publish still works`, await until(() => h.posts.length === 1), h.posts.length));
      const post = h.posts[0];
      const lb = locationBody(post);
      results.push(c(`${tt}: body is the manual (search) pin, no device point`, lb.pass && post.location.source === "search" && distance(post.location, FX_MATCH_STREET.point) < 1, lb.detail));
      await shared(vp, `denied (${geo})`, p, ctx.mock, results);
    } catch (e) {
      results.push(c(`${tt}: threw`, false, String(e).slice(0, 400)));
    } finally {
      await p.context.close();
    }
  }
}

async function correctedPin(ctx, vp, results) {
  const t = `${vp}: corrected pin`;
  // No printed place label, so the label is derived from the match.
  const flyer = { ...FX_FLYER_THREE, placeLabel: "" };
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer, geocode: "street" });
  const { page, h } = p;
  const labelInput = page.locator('input[id$="-label"]');
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    await page.getByRole("button", { name: "Find on map", exact: true }).first().click();
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: label derived from the match`, (await labelInput.inputValue()).includes("Maple Hall"), await labelInput.inputValue()));
    await yes(page);
    results.push(c(`${t}: confirmed`, await has(page, "Pin confirmed."), null));

    // Real mouse drag of the pin, well over 100 m (about 500 m at zoom 15).
    const from = await markerCenter(page);
    await dragMouse(page, from, { x: from.x - 90, y: from.y + 60 });
    await until(() => isVisible(btn(page, "Yes, use this place")));
    results.push(c(`${t}: drag discards the confirmed point and asks again`, !(await has(page, "Pin confirmed.")) && (await isVisible(btn(page, "Yes, use this place"))), (await text(page)).slice(0, 200)));
    results.push(c(`${t}: stale derived label cleared`, (await labelInput.inputValue()) === "", await labelInput.inputValue()));
    await publish(page);
    await sleep(600);
    results.push(c(`${t}: Publish is blocked until the poster confirms again`, h.posts.length === 0 && (await has(page, MSG.chooseFirst)), h.posts.length));

    await yes(page);
    await ackIfShown(page);
    await publish(page);
    results.push(c(`${t}: one publish`, await until(() => h.posts.length === 1), h.posts.length));
    const post = h.posts[0];
    const lb = locationBody(post);
    const moved = post?.location ? distance(post.location, FX_MATCH_STREET.point) : 0;
    results.push(c(`${t}: body is the dragged point (source pin, 100 m to 1.5 km from the match)`, lb.pass && post.location.source === "pin" && moved > 100 && moved < 1500, { moved, loc: post?.location }));
    results.push(c(`${t}: only the chosen candidate text was sent`, ...Object.values(onlyQ(h, [FX_FLYER_THREE.addresses[0].text]))));
    results.push(c(`${t}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
    await shot(page, `scenario-corrected-${vp}`);
    await shared(vp, "corrected pin", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function searchFailures(ctx, vp, results) {
  const t = `${vp}: search failures`;
  const cases = [
    { key: "unavailable", answer: "unavailable", msg: MSG.unavailable },
    { key: "bad gateway", answer: "badGateway", msg: MSG.unavailable },
    { key: "busy", answer: "busy", msg: MSG.busy },
  ];
  for (const k of cases) {
    const tt = `${t}: ${k.key}`;
    const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: k.answer });
    const { page, h } = p;
    try {
      await open(page, ctx.baseUrl, "/scan/review");
      // Typing sends nothing and offers no suggestions.
      await page.getByLabel("Search for a place or address").pressSequentially("Elm Street 12", { delay: 40 });
      await sleep(1200);
      results.push(c(`${tt}: typing alone sends no request`, h.geocodeRequests.length === 0, h.geocodeRequests));
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await until(() => has(page, k.msg));
      results.push(c(`${tt}: message shown`, await has(page, k.msg), (await text(page)).slice(0, 300)));
      await sleep(1000);
      results.push(c(`${tt}: exactly one request, only the typed text`, ...Object.values(onlyQ(h, ["Elm Street 12"]))));
      results.push(c(`${tt}: search box and map stay available`, (await isVisible(page.getByLabel("Search for a place or address"))) && (await isVisible(page.locator(MAP))), null));
      await tapMap(page);
      await yes(page);
      await ackIfShown(page);
      await publish(page);
      results.push(c(`${tt}: manual pin publishes`, await until(() => h.posts.length === 1), h.posts.length));
      const post = h.posts[0];
      const lb = locationBody(post);
      results.push(c(`${tt}: body location block only, source pin`, lb.pass && post.location.source === "pin", lb.detail));
      results.push(c(`${tt}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
      await shared(vp, `search ${k.key}`, p, ctx.mock, results);
    } catch (e) {
      results.push(c(`${tt}: threw`, false, String(e).slice(0, 400)));
    } finally {
      await p.context.close();
    }
  }
}

async function queryRefused(ctx, vp, results) {
  const t = `${vp}: query refused`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: "street" });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    const input = page.getByLabel("Search for a place or address");
    for (const contact of [FX_CONTACT_STRINGS[0], FX_CONTACT_STRINGS[3]]) {
      const q = `Call ${contact} about 200 Maple Avenue`;
      await input.fill(q);
      await page.getByRole("button", { name: "Search", exact: true }).click();
      await until(() => has(page, MSG.refused));
      results.push(c(`${t}: "${contact}" shows the refusal message`, await has(page, MSG.refused), (await text(page)).slice(0, 300)));
      results.push(c(`${t}: "${contact}" sends no request`, h.geocodeRequests.length === 0, h.geocodeRequests));
      results.push(c(`${t}: "${contact}" leaves the search box unchanged`, (await input.inputValue()) === q, await input.inputValue()));
    }
    // A look-alike (times, dates, prices, years, postcodes) is not a contact detail and is sent.
    const lookalike = `200 Maple Avenue ${FX_LOOKALIKE_STRINGS[6]}`;
    await input.fill(lookalike);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await until(() => h.geocodeRequests.length === 1);
    results.push(c(`${t}: a postcode look-alike is sent as typed`, ...Object.values(onlyQ(h, [lookalike]))));
    await shared(vp, "query refused", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function contactWarning(ctx, vp, results) {
  const t = `${vp}: contact details warning`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, flyer: FX_FLYER_NONE, geocode: "empty" });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, "/scan/review");
    await tapMap(page);
    await yes(page);
    const body = page.locator('textarea[name="body"]');
    const lookalike = `Starts ${FX_LOOKALIKE_STRINGS[0]} on ${FX_LOOKALIKE_STRINGS[1]}, ${FX_LOOKALIKE_STRINGS[3]} entry, ${FX_LOOKALIKE_STRINGS[4]}, ${FX_LOOKALIKE_STRINGS[5]}`;
    await body.fill(lookalike);
    await sleep(300);
    results.push(c(`${t}: times, dates, prices, years and postcodes do not warn`, !(await has(page, "Check for personal details")), null));
    const original = `Call ${FX_CONTACT_STRINGS[0]} or email ${FX_CONTACT_STRINGS[3]} about the sale.`;
    await body.fill(original);
    await sleep(300);
    const txt = await text(page);
    results.push(c(`${t}: phone and email warn, naming the field and the kind`, txt.includes("Check for personal details") && txt.includes("Details: phone number") && txt.includes("Details: email address"), txt.slice(txt.indexOf("Check for"), txt.indexOf("Check for") + 300)));
    await publish(page);
    await sleep(600);
    results.push(c(`${t}: Publish without the check sends nothing`, h.posts.length === 0 && (await has(page, MSG.ackFirst)), h.posts.length));
    await page.locator("#leaksAck").check();
    await publish(page);
    results.push(c(`${t}: after the check, one publish`, await until(() => h.posts.length === 1), h.posts.length));
    results.push(c(`${t}: text sent unchanged`, h.posts[0]?.body === original, h.posts[0]?.body));
    results.push(c(`${t}: text in the field unchanged`, (await body.inputValue()) === original, await body.inputValue()));
    await shared(vp, "contact warning", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

async function editSaveFailure(ctx, vp, results) {
  const t = `${vp}: edit save failure`;
  const p = await newPage(ctx.browser, vp, { baseUrl: ctx.baseUrl, geocode: "empty" });
  const { page, h } = p;
  try {
    await open(page, ctx.baseUrl, `/p/${uuid(1)}/edit`);
    await page.getByRole("button", { name: "Change location", exact: true }).click();
    await sleep(500);
    await tapMap(page);
    await yes(page);
    h.patchAnswer = "locationFailed";
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    results.push(c(`${t}: one combined PATCH`, await until(() => h.patches.length === 1), h.patches.length));
    const sent = h.patches[0]?.body?.location;
    results.push(c(`${t}: PATCH carries a location block of five keys`, !!sent && Object.keys(sent).sort().join(",") === "confirmed,lat,lng,precision,source", sent));
    await until(() => has(page, MSG.saveFailed));
    results.push(c(`${t}: failure message and Retry shown`, (await has(page, MSG.saveFailed)) && (await isVisible(btn(page, "Retry"))), null));
    results.push(c(`${t}: chosen pin kept (new location shown, not the stored one)`, (await page.locator('[aria-label="Map of the new location"]').count()) >= 1 && (await has(page, "New location chosen.")), null));

    h.retryAnswer = "retryFailed";
    await btn(page, "Retry").click();
    results.push(c(`${t}: Retry sends one request`, await until(() => h.retries.length === 1), h.retries.length));
    results.push(c(`${t}: Retry body is only {location}, same point`, Object.keys(h.retries[0]?.body ?? {}).join() === "location" && JSON.stringify(h.retries[0].body.location) === JSON.stringify(sent), h.retries[0]?.body));
    await until(() => has(page, MSG.retryFailed));
    results.push(c(`${t}: failed Retry keeps the message and the button`, (await has(page, MSG.retryFailed)) && (await isVisible(btn(page, "Retry"))), null));

    h.retryAnswer = "retryOk";
    await btn(page, "Retry").click();
    await until(() => has(page, "Location saved."));
    results.push(c(`${t}: successful Retry shows the saved state and removes the button`, (await has(page, "Location saved.")) && !(await isVisible(btn(page, "Retry"))), null));
    results.push(c(`${t}: second Retry body is only {location}, same point`, h.retries.length === 2 && Object.keys(h.retries[1].body).join() === "location" && JSON.stringify(h.retries[1].body.location) === JSON.stringify(sent), h.retries[1]?.body));
    results.push(c(`${t}: no content PATCH after the first`, h.patches.length === 1, h.patches.length));
    results.push(c(`${t}: device location never called`, (await h.geoCalls()) === 0, await h.geoCalls()));
    await shared(vp, "edit save failure", p, ctx.mock, results);
  } catch (e) {
    results.push(c(`${t}: threw`, false, String(e).slice(0, 400)));
  } finally {
    await p.context.close();
  }
}

// ============================================================================ run
const results = [];
const mock = await startMock({ a: postingRow(1) });
const server = await startServer(3200);
const browser = await launchEdge();
try {
  const ctx = { browser, mock, baseUrl: server.baseUrl };
  for (const vp of ["mobile", "desktop"]) {
    await scanningAtHome(ctx, vp, results);
    await multipleAddresses(ctx, vp, results);
    await noAddress(ctx, vp, results);
    await ambiguousMatches(ctx, vp, results);
    await deniedPermission(ctx, vp, results);
    await correctedPin(ctx, vp, results);
    await searchFailures(ctx, vp, results);
    await queryRefused(ctx, vp, results);
    await contactWarning(ctx, vp, results);
    await editSaveFailure(ctx, vp, results);
  }
} finally {
  await browser.close().catch(() => {});
  await server.stop();
  await mock.stop();
}
report(results);
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed} passed, ${failed} failed, ${results.length} total`);
writeResults(NAME, { when: new Date().toISOString(), mock: MOCK_URL, mockHits: mock.hits, results });
process.exit(failed === 0 ? 0 : 1);
