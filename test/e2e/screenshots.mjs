// Takes the README screenshots (one real lookup, so mind the registry rate limits).
//   node test/e2e/screenshots.mjs http://127.0.0.1:8970 docs [domain]
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const base = process.argv[2] ?? "http://127.0.0.1:8970";
const dir = process.argv[3] ?? process.env.E2E_SHOTS_DIR ?? ".";
const domain = process.argv[4] ?? "piotrmajkutewicz.pl";
const iphone = { ...devices["iPhone 13"] };
delete iphone.defaultBrowserType;

const browser = await chromium.launch();

async function lookup(page) {
  await page.goto(base + "/");
  await page.fill("#domain", domain);
  await page.click("#go");
  await page.waitForSelector("#report:not([hidden])", { timeout: 25000 });
  await page.waitForTimeout(1800); // let the entrance animation finish
}

const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
await lookup(desktop);
await desktop.screenshot({ path: `${dir}/ui.png`, clip: { x: 0, y: 0, width: 1280, height: 1500 }, fullPage: true });

const phone = await (await browser.newContext(iphone)).newPage();
await lookup(phone);
await phone.screenshot({ path: `${dir}/ui-mobile.png`, clip: { x: 0, y: 0, width: 390, height: 1500 }, fullPage: true });

// The loading state: the API answer is held back on purpose.
const loading = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
await loading.route("**/api/lookup*", () => new Promise(() => {}));
await loading.goto(base + "/");
await loading.fill("#domain", domain);
await loading.click("#go");
await loading.waitForTimeout(500);
await loading.screenshot({ path: `${dir}/ui-loading.png`, clip: { x: 0, y: 0, width: 1280, height: 760 } });
await browser.close();
