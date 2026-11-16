// Baseline measurements of the home board before any change. Read-only: mocked
// API responses, stubbed location, empty Supabase variables (seed mode).
import { startServer, launchEdge, newPage, open, measureMap, checkNoHorizontalScroll, checkTapTargets, checkOneDarkRedAction, shot, writeResults, report, VIEWPORTS } from "./lib.mjs";

const server = await startServer(Number(process.env.CB_PORT ?? 3200));
const browser = await launchEdge();
const out = { baseUrl: server.baseUrl, viewports: {} };
try {
  for (const vp of Object.keys(VIEWPORTS)) {
    const { page, errors, context } = await newPage(browser, vp);
    await open(page, server.baseUrl, "/");
    const geometry = await measureMap(page);
    const checks = [
      await checkNoHorizontalScroll(page),
      await checkTapTargets(page, { primarySelectors: ['a[href="/scan"].bg-dark-red'] }),
      await checkOneDarkRedAction(page),
    ];
    await shot(page, `baseline-${vp}`);
    out.viewports[vp] = { size: VIEWPORTS[vp], geometry, checks, pageErrors: errors };
    console.log(`\n== ${vp} ${VIEWPORTS[vp].width}x${VIEWPORTS[vp].height}`);
    console.log("map:", JSON.stringify(geometry));
    report(checks);
    if (errors.length) console.log("page errors:", errors);
    await context.close();
  }
} finally {
  await browser.close();
  await server.stop();
}
console.log("\nresults:", writeResults("baseline", out));
