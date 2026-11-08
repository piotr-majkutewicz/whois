// Browser tests for the page. Not part of `npm test` (needs a browser and a running dev server).
//
//   npx wrangler dev --port 8970 &
//   node test/e2e/ui.e2e.mjs http://127.0.0.1:8970
//
// Playwright is not a dependency of this project. Install it separately (`npm i -g playwright`) and, if
// it cannot be found, point PLAYWRIGHT_MODULE at the installed package directory.
//   E2E_SHOTS_DIR=dir   write screenshots there (optional)
//   E2E_LIVE=1          also run a few lookups against the real registries (spaced out, keep it small)
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pw = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const { chromium, devices } = pw;
const base = process.argv[2] ?? "http://127.0.0.1:8970";
const shots = process.env.E2E_SHOTS_DIR;

let failures = 0;
function ok(cond, name, extra = "") {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
}

const iphone = { ...devices["iPhone 13"] };
delete iphone.defaultBrowserType;
const VIEWPORTS = [
  { name: "iPhone 13 (390px)", options: iphone },
  { name: "small phone (360px)", options: { ...iphone, viewport: { width: 360, height: 700 }, screen: { width: 360, height: 700 } } },
  { name: "desktop (1280px)", options: { viewport: { width: 1280, height: 800 } } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}

// A canned lookup result, built once from a real response of the dev server (for example.com).
async function realResult() {
  const res = await fetch(`${base}/api/lookup`, { method: "POST", body: JSON.stringify({ domain: "example.com", lang: "pl" }) });
  if (!res.ok) throw new Error(`real lookup failed: ${res.status}`);
  return res.json();
}

async function mockApi(page, payload, state) {
  await page.route("**/api/lookup*", async (route) => {
    state.calls++;
    await state.gate.promise;
    if (state.fail) return state.fail(route);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
}

const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function freshPage(browser, options, extra = {}) {
  const ctx = await browser.newContext({ ...options, locale: "en-US", ...extra });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(String(e)));
  return { ctx, page, errors };
}

// Visible text without values that come from registries and DNS (those are never translated).
const ownText = (page) =>
  page.evaluate(() => {
    const c = document.querySelector("main").cloneNode(true);
    c.querySelectorAll(".raw,script,style").forEach((n) => n.remove());
    return c.textContent.replace(/\s+/g, " ");
  });

const EN_WORDS = /\b(the|and|your|domain|registered|expires|expired|check|result|records?|name servers?|why it matters|what to do|how we know|loading|error)\b/i;
const PL_LETTERS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

// Real touch gestures through the DevTools protocol.
async function swipe(page, cdp, yDistance) {
  const x = 200;
  const y0 = yDistance < 0 ? 560 : 150;
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= 12; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y0 + (yDistance * i) / 12 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(700);
}

(async () => {
  const payload = await realResult();
  const browser = await chromium.launch();

  for (const vp of VIEWPORTS) {
    console.log(`\n== ${vp.name}`);
    const touch = !!vp.options.hasTouch;

    // 0. Control: on a plain tall page the gesture helper really scrolls (so a later pass means something).
    if (touch) {
      const { ctx, page } = await freshPage(browser, vp.options);
      await page.setContent('<body style="margin:0"><div style="height:3000px;background:linear-gradient(#000,#fff)"></div></body>');
      const cdp = await ctx.newCDPSession(page);
      await swipe(page, cdp, -400);
      const y = await page.evaluate(() => window.scrollY);
      ok(y > 100, "control page: the touch gesture scrolls", `scrollY=${y}`);
      await ctx.close();
    }

    // 1. Loading state, layout stability, announcements, touch scroll.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options);
      const state = { calls: 0, gate: gate() };
      await mockApi(page, payload, state);
      await page.goto(base + "/");
      ok((await page.locator("html").getAttribute("lang")) === "pl", "default language is Polish with an English browser");
      ok((await page.locator('meta[name="theme-color"]').getAttribute("content")) === "#14110f", "theme-color meta");
      ok((await page.locator('meta[name="color-scheme"]').getAttribute("content")) === "dark", "color-scheme meta");
      ok((await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)) === "rgb(20, 17, 15)", "html background is dark");
      ok((await overflowX(page)) <= 0, "no horizontal overflow on the empty page");
      await page.fill("#domain", "example.com");
      const t = await page.evaluate(async () => {
        const t0 = performance.now();
        document.getElementById("go").click();
        await new Promise((r) => requestAnimationFrame(() => r()));
        return {
          ms: performance.now() - t0,
          skeleton: !document.getElementById("skeleton").hidden,
          loading: !document.getElementById("loading").hidden,
          disabled: document.getElementById("go").disabled,
          label: document.getElementById("goText").textContent,
          spinner: !document.querySelector("#go .spin").hidden,
          busy: document.getElementById("result").getAttribute("aria-busy"),
          live: document.getElementById("live").textContent.trim(),
          text: document.getElementById("loadText").textContent,
        };
      });
      ok(t.ms < 100, "loading state within 100 ms of the click", `${t.ms.toFixed(1)} ms`);
      ok(t.skeleton && t.loading && t.disabled && t.spinner, "skeleton, note, spinner and lock are active");
      ok(t.label === "Sprawdzam domenę..." && t.busy === "true", "busy label and aria-busy");
      ok(t.live === "Trwa sprawdzanie", "live region announces the check", t.live);
      ok(t.text === "Pytam rejestr domen i serwery DNS, to zwykle trwa kilka sekund", "honest loading text, no invented stages");
      await page.locator("#domain").press("Enter");
      await page.waitForTimeout(150);
      ok(state.calls === 1, "no second request while busy", `calls=${state.calls}`);
      ok((await overflowX(page)) <= 0, "no horizontal overflow while loading");
      const m = (scope) =>
        page.evaluate((s) => {
          const top = (sel) => { const n = document.querySelector(`${s} ${sel}`); const b = n.getBoundingClientRect(); return [b.top + window.scrollY, b.height]; };
          return { dom: top(s === "#skeleton" ? ".head h2" : ".head h2"), tiles: top(".tiles"), h2: top(s === "#skeleton" ? "h2:not(.dom)" : "h2:not(.dom)") };
        }, scope);
      const before = await m("#skeleton");
      if (shots) await page.screenshot({ path: `${shots}/e2e-loading-${touch ? "m" : "d"}-${vp.options.viewport.width}.png` });
      state.gate.open();
      await page.waitForSelector("#report:not([hidden])");
      await page.waitForTimeout(900);
      const after = await m("#report");
      const d = (k, i) => Math.abs(before[k][i] - after[k][i]);
      ok(d("dom", 0) <= 3 && d("dom", 1) <= 3, "domain heading does not move", `dTop=${d("dom", 0).toFixed(1)} dH=${d("dom", 1).toFixed(1)}`);
      ok(d("tiles", 0) <= 3 && d("tiles", 1) <= 3, "status tiles do not move or resize", `dTop=${d("tiles", 0).toFixed(1)} dH=${d("tiles", 1).toFixed(1)}`);
      ok(d("h2", 0) <= 3, "heading below the tiles does not move", `dTop=${d("h2", 0).toFixed(1)}`);
      const late = await page.evaluate(() => ({
        gone: document.getElementById("loading").hidden && document.getElementById("skeleton").hidden,
        disabled: document.getElementById("go").disabled,
        live: document.getElementById("live").textContent.trim(),
        scrollY: window.scrollY,
        tiles: document.querySelectorAll("#report .tiles li").length,
        sections: [...document.querySelectorAll("#report .card > h2")].map((h) => h.textContent),
      }));
      ok(late.gone && !late.disabled, "loading state gone, form unlocked");
      ok(late.live === "Gotowe, sprawdzono domenę example.com", "live region announces the result", late.live);
      ok(late.tiles === 4 && late.sections.length === 4, "four status tiles and four cards");
      ok(late.scrollY <= 1, "page was not scrolled without need", `scrollY=${late.scrollY}`);
      ok((await overflowX(page)) <= 0, "no horizontal overflow with the result");
      const tilesText = await page.evaluate(() => [...document.querySelectorAll("#report .tiles li")].every((li) => li.querySelector(".chip .ic") && li.querySelector(".chip").textContent.trim().length > 3));
      ok(tilesText, "every status has an icon and a text, not only a colour");
      const targets = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
      ok(targets.every((h) => h >= 43.9), "all buttons are at least 44 px high", targets.map((h) => h.toFixed(0)).join(","));
      ok((await page.locator('a[href="https://piotrmajkutewicz.pl"]').getAttribute("rel")) === "noopener", "CTA link has rel=noopener");
      if (shots) {
        await page.screenshot({ path: `${shots}/e2e-result-${vp.options.viewport.width}.png`, fullPage: true });
      }

      if (touch) {
        const cdp = await ctx.newCDPSession(page);
        await swipe(page, cdp, -400);
        const down = await page.evaluate(() => window.scrollY);
        await swipe(page, cdp, 300);
        await swipe(page, cdp, 400);
        await swipe(page, cdp, 400);
        const up = await page.evaluate(() => window.scrollY);
        ok(down > 100 && up < down, "touch scroll works down and back up", `down=${down} up=${up}`);
        await swipe(page, cdp, 600);
        const top = await page.evaluate(() => window.scrollY);
        ok(top === 0, "scrolling back reaches 0 and the page does not reload", `scrollY=${top}`);
        ok((await page.evaluate(() => document.getElementById("report").hidden)) === false, "result is still there after the gestures");
      } else {
        await page.mouse.wheel(0, 600);
        await page.waitForTimeout(200);
        const down = await page.evaluate(() => window.scrollY);
        await page.mouse.wheel(0, -2000);
        await page.waitForTimeout(200);
        ok(down > 100 && (await page.evaluate(() => window.scrollY)) === 0, "wheel scroll works down and back to 0");
      }
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }

    // 2. Language switch: no new request, content kept in place, no foreign words.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options);
      const state = { calls: 0, gate: gate() };
      state.gate.open();
      await mockApi(page, payload, state);
      await page.goto(base + "/");
      await page.fill("#domain", "example.com");
      await page.click("#go");
      await page.waitForSelector("#report:not([hidden])");
      await page.waitForTimeout(700);
      const pl = await ownText(page);
      ok(!EN_WORDS.test(pl), "Polish view has no English words", (EN_WORDS.exec(pl) ?? [""])[0]);
      ok(/Najważniejsze rzeczy do sprawdzenia/.test(pl) && /Czego to narzędzie NIE pokazuje/.test(pl) && /Skąd wiemy/.test(pl), "Polish headings and 'how we know'");
      await page.evaluate(() => window.scrollTo(0, 500));
      await page.waitForTimeout(100);
      const headTop = () => page.evaluate(() => document.querySelector("#report h2:not(.dom)").getBoundingClientRect().top);
      const y0 = await headTop();
      await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
      await page.waitForTimeout(250);
      const en = await ownText(page);
      ok(state.calls === 1, "switching language sends no new request", `calls=${state.calls}`);
      ok(!PL_LETTERS.test(en), "English view has no Polish letters", (PL_LETTERS.exec(en) ?? [""])[0]);
      ok(/The most important things to check/.test(en) && /What this tool does NOT show/.test(en), "English headings");
      ok((await page.locator("html").getAttribute("lang")) === "en", "html lang switched");
      ok((await page.locator('[data-lang="en"]').getAttribute("aria-pressed")) === "true", "aria-pressed follows");
      ok(Math.abs((await headTop()) - y0) <= 1, "content stays where it was", `${y0} -> ${await headTop()}`);
      ok((await overflowX(page)) <= 0, "no horizontal overflow in English");
      ok((await page.evaluate(() => localStorage.getItem("lang"))) === "en", "choice remembered in localStorage");
      await page.reload();
      ok((await page.locator("html").getAttribute("lang")) === "en", "stored language survives a reload");
      await page.goto(base + "/?lang=pl");
      ok((await page.locator("html").getAttribute("lang")) === "pl", "?lang= beats the stored choice");
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }

    // 3. Errors: real validation from the server (no network needed; one call per viewport, the dev rate limit is 8 per minute), in both languages, plus a network failure.
    {
      const { ctx, page } = await freshPage(browser, vp.options);
      await page.goto(base + "/");
      for (const [input, msg] of [["127.0.0.1", "To adres IP, a nie nazwa domeny. Wpisz nazwę, na przykład przyklad.pl."]]) {
        await page.fill("#domain", input);
        await page.click("#go");
        await page.waitForSelector("#error:not([hidden])");
        ok((await page.textContent("#errorMsg")) === msg, `rejected input "${input}"`);
        ok(await page.locator("#retry").isHidden(), "no retry for input errors");
        ok((await page.textContent("#live")).includes(msg), "error announced");
        ok(await page.locator("#error .icon").isVisible(), "error has an icon");
        ok((await overflowX(page)) <= 0, "no overflow in the error state");
      }
      await page.evaluate(() => document.querySelector('[data-lang="en"]').click());
      ok((await page.textContent("#errorMsg")) === "This is an IP address, not a domain name. Enter a name, for example example.com.", "error switches language without a request");
      await ctx.close();

      const b = await freshPage(browser, vp.options);
      const state = { calls: 0, gate: gate(), fail: (r) => r.abort("failed") };
      state.gate.open();
      await mockApi(b.page, payload, state);
      await b.page.goto(base + "/");
      await b.page.fill("#domain", "example.com");
      await b.page.click("#go");
      await b.page.waitForSelector("#error:not([hidden])");
      ok((await b.page.textContent("#errorMsg")).startsWith("Nie udało się połączyć"), "network failure message");
      const box = await b.page.locator("#retry").boundingBox();
      ok(box.height >= 43.9, "retry button at least 44 px");
      state.fail = null;
      await b.page.click("#retry");
      await b.page.waitForSelector("#report:not([hidden])");
      ok(state.calls === 2, "retry sends a new request");
      await b.ctx.close();
    }

    // 4. Registry states shown honestly, using canned results.
    {
      const variants = {
        rate_limited: ["Rejestr chwilowo ogranicza zapytania, spróbuj za chwilę.", (n) => { n.registration = { ...n.registration, state: "rate_limited", expires: null, daysToExpiry: null, expiryLevel: "unknown", statuses: [], nameservers: [], registrar: null }; }],
        unsupported: ["Dla tej końcówki rejestr nie udostępnia danych przez RDAP", (n) => { n.registration = { ...n.registration, state: "unsupported", expires: null, daysToExpiry: null, expiryLevel: "unknown", statuses: [], nameservers: [], registrar: null }; }],
        available: ["Rejestr nie ma tej domeny w bazie", (n) => { n.registration = { ...n.registration, state: "available", expires: null, daysToExpiry: null, expiryLevel: "unknown", statuses: [], nameservers: [], registrar: null }; n.findings = []; n.top = []; n.mail.rating = "nomail"; }],
        expiring: ["wygasa za 5 dni", (n) => { n.registration = { ...n.registration, daysToExpiry: 5, expiryLevel: "high" }; n.findings = [{ key: "reg.expires_soon", section: "registration", severity: "high", source: "rdap_domain", params: { days: 5 } }]; n.top = [0]; }],
      };
      for (const [name, [needle, patch]] of Object.entries(variants)) {
        const { ctx, page } = await freshPage(browser, vp.options);
        const p = JSON.parse(JSON.stringify(payload));
        patch(p.neutral);
        const state = { calls: 0, gate: gate() };
        state.gate.open();
        await mockApi(page, p, state);
        await page.goto(base + "/");
        await page.fill("#domain", "example.com");
        await page.click("#go");
        await page.waitForSelector("#report:not([hidden])");
        const text = await page.evaluate(() => document.getElementById("report").textContent.replace(/\s+/g, " "));
        ok(text.includes(needle), `${name}: message shown`);
        ok((await overflowX(page)) <= 0, `${name}: no horizontal overflow`);
        if (name === "expiring") {
          ok(/Wysokie/.test(text) && /Domena wygasa za 5 dni/.test(text), "expiry warning appears with its level");
        }
        await ctx.close();
      }
    }

    // 5. Reduced motion, copy button.
    {
      const { ctx, page, errors } = await freshPage(browser, vp.options, { reducedMotion: "reduce", permissions: ["clipboard-read", "clipboard-write"] });
      const state = { calls: 0, gate: gate() };
      await mockApi(page, payload, state);
      await page.goto(base + "/");
      await page.fill("#domain", "example.com");
      await page.click("#go");
      const anim = await page.evaluate(() => [getComputedStyle(document.querySelector("#go .spin")).animationName, getComputedStyle(document.querySelector(".load-text .bar i")).animationName, getComputedStyle(document.querySelector("#skeleton .sk")).animationName]);
      ok(anim.every((a) => a === "none"), "reduced motion: no animations while loading", anim.join(","));
      state.gate.open();
      await page.waitForSelector("#report:not([hidden])");
      const after = await page.evaluate(() => [...document.querySelectorAll("#report .tiles, #report .card")].every((n) => getComputedStyle(n).animationName === "none" && getComputedStyle(n).opacity === "1"));
      ok(after, "reduced motion: result shown at once");
      if (!touch) {
        await page.click("#report .copy");
        await page.waitForTimeout(200);
        ok((await page.textContent("#report .copy")) === "Skopiowano", "copy button confirms");
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        ok(clip.startsWith("Domena: example.com") && clip.includes("Poczta:"), "copied text is a readable summary", clip.split("\n")[0]);
      }
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
    }
  }

  // 6. Optional: a few real lookups, spaced out because registries (NASK in particular) rate-limit.
  if (process.env.E2E_LIVE) {
    console.log("\n== live network (desktop)");
    for (const domain of ["example.com", "piotrmajkutewicz.pl", "wolna-domena-test-8d3k2.com"]) {
      const { ctx, page, errors } = await freshPage(browser, VIEWPORTS[2].options);
      await page.goto(base + "/");
      await page.fill("#domain", domain);
      await page.click("#go");
      await page.waitForSelector("#report:not([hidden]), #error:not([hidden])", { timeout: 25000 });
      const info = await page.evaluate(() => ({
        error: !document.getElementById("error").hidden,
        head: document.querySelector("#report .head")?.innerText.replace(/\s+/g, " "),
        tiles: [...document.querySelectorAll("#report .tiles li")].map((li) => li.innerText.replace(/\s+/g, " ")),
      }));
      console.log(`     ${domain}: ${info.error ? "ERROR" : info.head}\n       ${info.tiles.join(" | ")}`);
      ok(!info.error && info.head.includes(domain.startsWith("wolna") ? "wolna" : domain), `live result for ${domain}`);
      if (shots && domain === "piotrmajkutewicz.pl") {
        await page.screenshot({ path: `${shots}/ui.png`, fullPage: true });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      ok(errors.length === 0, "no console errors", errors.join(" | "));
      await ctx.close();
      await sleep(8000);
    }
  }

  await browser.close();
  console.log(failures === 0 ? "\nAll e2e checks passed." : `\n${failures} e2e check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
})();
