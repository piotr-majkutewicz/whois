import { DEFAULT_LANG, dictionary, LANGS, type Lang, type UiKey } from "./i18n";
import { DEBUG_SCROLL_JS } from "./debug-scroll.js";

/** The whole UI is one static page. Data from outside is only ever inserted with textContent. */
export function renderUi(nonce: string, lang: Lang = DEFAULT_LANG): string {
  const ui = dictionary(lang).ui;
  const t = (key: UiKey) => escapeHtml(ui[key]);
  // Both languages are embedded, so the switch works without another request.
  const texts = Object.fromEntries(
    LANGS.map((l) => {
      const d = dictionary(l);
      return [l, { ui: d.ui, findings: d.findings, errors: d.errors, statuses: d.statuses, recordTypes: d.recordTypes, notShown: d.notShown }];
    }),
  );
  const pressed = (l: Lang) => (l === lang ? "true" : "false");

  return PAGE.replace("__DEBUG_JS__", () => DEBUG_SCROLL_JS)
    .replaceAll("__NONCE__", nonce)
    .replaceAll("__LANG__", lang)
    .replaceAll("__META_TITLE__", t("metaTitle"))
    .replaceAll("__META_DESCRIPTION__", t("metaDescription"))
    .replaceAll("__HEADING__", t("heading"))
    .replaceAll("__INTRO__", t("intro"))
    .replaceAll("__DOMAIN_LABEL__", t("domainLabel"))
    .replaceAll("__DOMAIN_PLACEHOLDER__", t("domainPlaceholder"))
    .replaceAll("__SUBMIT__", t("submit"))
    .replaceAll("__LANG_SWITCH_LABEL__", t("langSwitchLabel"))
    .replaceAll("__RESULT_LABEL__", t("resultLabel"))
    .replaceAll("__LOADING_TEXT__", t("loadingText"))
    .replaceAll("__RETRY__", t("retry"))
    .replaceAll("__CTA_TEXT__", t("ctaText"))
    .replaceAll("__CTA_LINK__", t("ctaLink"))
    .replaceAll("__DISCLAIMER__", t("disclaimer"))
    .replaceAll("__PRESSED_PL__", pressed("pl"))
    .replaceAll("__PRESSED_EN__", pressed("en"))
    .replace("__TEXTS__", () => safeJson(texts));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON that is safe inside a <script> element. */
function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

// String.raw keeps the backslashes of the embedded script as they are.
const PAGE = String.raw`<!doctype html>
<html lang="__LANG__">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#14110f">
<meta name="color-scheme" content="dark">
<meta name="robots" content="noindex, nofollow">
<title>__META_TITLE__</title>
<meta name="description" content="__META_DESCRIPTION__">
<style nonce="__NONCE__">
html{background:#14110f;color-scheme:dark}
:root{--bg:#14110f;--text:#f2ebdd;--muted:#a99f90;--line:#2f2823;--line2:#4a4038;--accent:#ef4444;--ok:#7fb069;--warn:#e0a458;--panel:#1c1815}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:break-word}
main{max-width:820px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:clamp(1.6rem,5vw,2.2rem);line-height:1.2;margin:0 0 8px}
h2{font-size:1.2rem;line-height:1.3;margin:32px 0 12px}
h3{font-size:1.02rem;line-height:1.35;margin:0 0 4px}
p{margin:0 0 12px}
code{font:.88rem/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow-wrap:anywhere;word-break:break-word}
.muted{color:var(--muted)}
form{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0 8px}
label{flex-basis:100%;font-weight:600}
input{flex:1 1 240px;min-width:0;min-height:48px;padding:0 14px;border-radius:8px;border:1px solid var(--line2);background:var(--panel);color:var(--text);font:inherit}
button{min-height:48px;padding:0 24px;border:0;border-radius:8px;background:var(--accent);color:#14110f;font:inherit;font-weight:700;cursor:pointer}
button:disabled{opacity:.6;cursor:wait}
:focus-visible{outline:3px solid var(--text);outline-offset:2px}
.result{position:relative;margin-top:16px}
.sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
.error{display:flex;gap:12px;align-items:flex-start;border:1px solid var(--accent);border-radius:8px;padding:16px}
.error .icon{flex:none;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#14110f;font-weight:800;display:flex;align-items:center;justify-content:center}
.error .body{flex:1 1 auto;min-width:0}
.error p{margin:0 0 4px}
.error .msg{font-weight:700}
.error button{margin-top:12px;min-height:44px}
.loading{position:absolute;inset:0;z-index:2;pointer-events:none}
.load-text{position:sticky;top:12px;display:flex;align-items:center;gap:10px;margin:0 8px;padding:12px 16px 16px;border:1px solid var(--line2);border-radius:8px;background:var(--panel)}
.load-text .bar{position:absolute;left:8px;right:8px;bottom:5px;height:3px;border-radius:2px;background:var(--line);overflow:hidden}
.load-text .bar i{display:block;height:100%;width:35%;border-radius:2px;background:var(--accent);opacity:.7}
.spin{flex:none;width:1em;height:1em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block}
button .spin{margin-right:8px;vertical-align:-2px}
button .spin[hidden]{display:none}
.report{scroll-margin-top:16px}
.report.refreshing{opacity:.45;transition:opacity .2s}
.head{margin:8px 0 16px}
.head h2.dom{margin:0 0 6px;font-size:clamp(1.4rem,5vw,1.9rem);line-height:1.25;overflow-wrap:anywhere}
.head p{display:flex;align-items:center;margin:0 0 4px;min-height:1.6em}
.head .sub{font-size:.9rem}
.copy{display:block;min-height:44px;margin-top:8px;padding:0 16px;background:transparent;color:var(--text);border:1px solid var(--line2);font-weight:600}
.chip{display:inline-flex;align-items:center;gap:6px;font-weight:700}
.chip .ic,.mk{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;font-size:.8rem;font-weight:800;line-height:1;background:currentColor}
.chip .ic,.mk{color:inherit}
.chip .ic span,.mk span.g{color:#14110f}
.ok{color:var(--ok)}.warn{color:var(--warn)}.bad{color:var(--accent)}.unknown,.info{color:var(--muted)}
.tiles{list-style:none;margin:0 0 8px;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.tiles li{border:1px solid var(--line2);border-left:4px solid currentColor;border-radius:8px;padding:12px;min-height:148px;display:flex;flex-direction:column;gap:4px;background:var(--panel)}
.tiles .tt{color:var(--text);font-weight:700;line-height:1.3}
.tiles .th{color:var(--text);font-size:.92rem;line-height:1.35}
.tiles .chip{font-size:.92rem}
.tops{list-style:none;margin:0 0 8px;padding:0;display:grid;gap:12px;counter-reset:t}
.tops li{counter-increment:t;position:relative;border:1px solid var(--line2);border-left:4px solid var(--line2);border-radius:8px;padding:12px 16px 12px 56px}
.tops li.high{border-left-color:var(--accent)}.tops li.medium{border-left-color:var(--warn)}
.tops li::before{content:counter(t);position:absolute;left:14px;top:12px;width:28px;height:28px;border-radius:50%;background:var(--text);color:#14110f;font-weight:800;display:flex;align-items:center;justify-content:center}
.tops p{margin:0}
.card{border:1px solid var(--line);border-radius:10px;padding:4px 16px 16px;margin:24px 0}
.card>h2{margin:12px 0 8px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;justify-content:space-between}
.card>h2 .chip{font-size:.92rem}
.row{padding:8px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}
.row dt{font-weight:600;color:var(--muted);font-size:.92rem}
.row dd{margin:0;min-width:0}
dl{margin:0}
.row .line{display:flex;gap:8px;align-items:flex-start}
.row .line>span:last-child{min-width:0}
.src{display:block;font-size:.82rem;color:var(--muted);margin-top:2px}
ul.plain{padding-left:20px;margin:0 0 12px}
ul.plain li{margin:0 0 6px}
.rec{padding:10px 0;border-top:1px solid var(--line)}
.rec h3 .host{color:var(--muted);font-weight:400;font-size:.9rem}
.rec p{margin:0 0 4px}
.rec .expl{color:var(--muted);font-size:.9rem}
.vals{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.vals li{border:1px solid var(--line);border-radius:6px;padding:6px 10px;background:var(--panel);min-width:0}
.prov{list-style:none;margin:8px 0 0;padding:0;display:grid;gap:8px}
.prov li{border:1px solid var(--line);border-radius:6px;padding:8px 12px;background:var(--panel)}
.addr{border:1px solid var(--line);border-radius:6px;padding:8px 12px;margin:0 0 8px;background:var(--panel)}
.finding{border:1px solid var(--line);border-left:4px solid var(--line2);border-radius:8px;padding:12px 16px;margin:12px 0 0}
.finding.high{border-left-color:var(--accent)}
.finding.medium{border-left-color:var(--warn)}
.finding p{margin:0 0 6px}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:.8rem;font-weight:700;text-transform:uppercase;letter-spacing:.04em;margin-right:8px;color:var(--muted)}
.finding.high .badge{color:var(--accent)}
.finding.medium .badge{color:var(--warn)}
.note{border:1px solid var(--line);border-radius:8px;padding:12px 16px;background:#1a1613}
.top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.top h1{flex:1 1 auto}
.lang{display:flex;gap:4px;flex:none}
.lang button{min-width:44px;min-height:44px;padding:0 12px;border:1px solid var(--line2);background:transparent;color:var(--text);font-weight:600}
.lang button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:#14110f}
.cta{margin-top:24px}
.reglink{display:inline-flex;align-items:center;min-height:44px;color:var(--text);text-underline-offset:3px;font-weight:600}
.cta a{color:var(--text);text-underline-offset:3px;display:inline-block;padding:10px 0}
[hidden]{display:none}
.skeleton .sk{display:block;border-radius:6px;background:var(--line);color:transparent}
.skeleton .head h2.dom{width:min(60%,18rem)}
.skeleton .head .st{width:min(45%,14rem)}
.skeleton .head .ex{width:min(35%,11rem)}
.skeleton .head .sk-copy{height:44px;margin-top:8px;width:9rem}
.skeleton .tiles li{border-color:var(--line);color:var(--line)}
.skeleton .tiles .sk{height:1.1em;margin-bottom:6px}
.skeleton .sk-h2{width:min(50%,16rem)}
.skeleton .sk-card{min-height:96px;border:1px solid var(--line);border-radius:8px;margin:0 0 12px;background:transparent}
.report .rv{opacity:1}
@media (min-width:640px){
.row{display:grid;grid-template-columns:minmax(0,13rem) minmax(0,1fr);gap:4px 16px}
}
@media (prefers-reduced-motion:no-preference){
@keyframes rise{from{opacity:0;transform:translateY(8px)}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(300%)}}
@keyframes shimmer{from{opacity:.55}to{opacity:1}}
.report .rv{animation:rise .4s ease-out both;animation-delay:calc(var(--i,0) * 45ms)}
.spin{animation:spin .8s linear infinite}
.load-text .bar i{animation:slide 1.4s ease-in-out infinite}
.skeleton .sk,.skeleton .tiles li,.skeleton .sk-card{animation:shimmer 1s ease-in-out infinite alternate}
.error{animation:rise .25s ease-out}
}
.report.still .rv{animation:none}
@media (prefers-reduced-motion:reduce){.load-text .bar i{width:100%;opacity:.35}}
</style>
</head>
<body>
<main>
  <header class="top">
    <h1 data-i18n="heading">__HEADING__</h1>
    <div class="lang" role="group" aria-label="__LANG_SWITCH_LABEL__" data-i18n-aria-label="langSwitchLabel">
      <button type="button" data-lang="pl" lang="pl" aria-label="Polski" aria-pressed="__PRESSED_PL__">PL</button>
      <button type="button" data-lang="en" lang="en" aria-label="English" aria-pressed="__PRESSED_EN__">EN</button>
    </div>
  </header>
  <p class="muted" data-i18n="intro">__INTRO__</p>
  <form id="form" novalidate>
    <label for="domain" data-i18n="domainLabel">__DOMAIN_LABEL__</label>
    <input id="domain" name="domain" type="text" inputmode="url" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="__DOMAIN_PLACEHOLDER__" data-i18n-placeholder="domainPlaceholder" required maxlength="300">
    <button id="go" type="submit"><span class="spin" aria-hidden="true" hidden></span><span id="goText" data-i18n="submit">__SUBMIT__</span></button>
  </form>
  <div id="result" class="result" aria-busy="false">
    <div id="live" class="sr-only" role="status" aria-live="polite"></div>
    <div id="skeleton" class="skeleton" aria-hidden="true" hidden>
      <div class="head">
        <h2 class="dom"><span class="sk">&nbsp;</span></h2>
        <p><span class="sk st">&nbsp;</span></p>
        <p><span class="sk ex">&nbsp;</span></p>
        <p class="sub"><span class="sk ex">&nbsp;</span></p>
        <span class="sk sk-copy"></span>
      </div>
      <ul class="tiles">
        <li><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span></li>
        <li><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span></li>
        <li><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span></li>
        <li><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span><span class="sk">&nbsp;</span></li>
      </ul>
      <h2><span class="sk sk-h2">&nbsp;</span></h2>
      <div class="sk-card"></div>
      <div class="sk-card"></div>
      <div class="sk-card"></div>
    </div>
    <div id="loading" class="loading" hidden>
      <p class="load-text muted"><span class="spin" aria-hidden="true"></span><span id="loadText" data-i18n="loadingText">__LOADING_TEXT__</span><span class="bar" aria-hidden="true"><i></i></span></p>
    </div>
    <div id="error" class="error" hidden>
      <span class="icon" aria-hidden="true">!</span>
      <div class="body">
        <p class="msg" id="errorMsg"></p>
        <p class="muted" id="errorHint"></p>
        <button type="button" id="retry" data-i18n="retry">__RETRY__</button>
      </div>
    </div>
    <section id="report" class="report" hidden aria-label="__RESULT_LABEL__" data-i18n-aria-label="resultLabel"></section>
  </div>
  <p class="cta"><span data-i18n="ctaText">__CTA_TEXT__</span> <a href="https://piotrmajkutewicz.pl" rel="noopener" data-i18n="ctaLink">__CTA_LINK__</a></p>
  <p class="note muted" id="disclaimer" data-i18n="disclaimer">__DISCLAIMER__</p>
</main>
<script nonce="__NONCE__">__DEBUG_JS__</script>
<script nonce="__NONCE__">
(function () {
  var TEXTS = __TEXTS__;
  var SERVER_LANG = "__LANG__";
  // Real timings, not a fake progress: the slow notice appears after SLOW_MS of waiting and the request
  // is given up after TIMEOUT_MS (the server itself stops after about 12 seconds).
  var SLOW_MS = 7000;
  var TIMEOUT_MS = 20000;
  var form = document.getElementById("form");
  var input = document.getElementById("domain");
  var go = document.getElementById("go");
  var goText = document.getElementById("goText");
  var goSpin = go.querySelector(".spin");
  var resultEl = document.getElementById("result");
  var live = document.getElementById("live");
  var skeletonEl = document.getElementById("skeleton");
  var loadingEl = document.getElementById("loading");
  var loadText = document.getElementById("loadText");
  var errorEl = document.getElementById("error");
  var errorMsg = document.getElementById("errorMsg");
  var errorHint = document.getElementById("errorHint");
  var retryBtn = document.getElementById("retry");
  var reportEl = document.getElementById("report");
  var lang = SERVER_LANG;
  var lastInput = null;
  var lastResult = null; // the language-neutral result of the last lookup
  var lastError = null;
  var runId = 0;
  var busy = false;
  var userScrolled = false;
  var slowTimer = null;
  var timeoutTimer = null;
  var flip = false;

  function valid(v) { return v === "pl" || v === "en"; }
  function readStored() { try { return window.localStorage.getItem("lang"); } catch (e) { return null; } }
  function writeStored(v) { try { window.localStorage.setItem("lang", v); } catch (e) { /* the page works without storage */ } }
  function reduced() { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  function D() { return TEXTS[lang]; }
  function fmt(tpl, params) {
    return String(tpl || "").replace(/\{(\w+)\}/g, function (m, k) { return params && Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m; });
  }
  function T(key, params) { return fmt(D().ui[key], params); }
  function setText(node, key) { node.setAttribute("data-i18n", key); node.textContent = T(key); }
  // A trailing no-break space makes a repeated message count as a change for the live region.
  function announce(msg) { flip = !flip; live.textContent = msg + (flip ? " " : ""); }
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function daysText(n) { return n + " " + (n === 1 ? T("dayOne") : T("dayMany")); }
  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(lang === "pl" ? "pl-PL" : "en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" }); }
    catch (e) { return iso; }
  }

  // el("tag", {class: "x"}, "text" | [nodes or strings]) builds nodes with textContent only.
  function el(tag, attrs, content) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (typeof content === "string") n.textContent = content;
    else if (content) content.forEach(function (c) { n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }
  // Values that come from registries or DNS are marked "raw": they are never translated.
  function raw(text, tag) { return el(tag || "code", { class: "raw" }, String(text)); }

  var ICON = { ok: "✓", warn: "!", bad: "✕", unknown: "?", info: "i" };
  var LEVEL_KEY = { ok: "tileOk", warn: "tileWarn", bad: "tileBad", unknown: "tileUnknown", info: "tileInfo" };
  function mark(lv) { return el("span", { class: "mk " + lv, "aria-hidden": "true" }, [el("span", { class: "g" }, ICON[lv])]); }
  function chip(lv, text) { return el("span", { class: "chip " + lv }, [el("span", { class: "ic", "aria-hidden": "true" }, [el("span", null, ICON[lv])]), text || T(LEVEL_KEY[lv])]); }
  function sevLevel(sev) { return sev === "high" ? "bad" : sev === "medium" ? "warn" : "ok"; }
  function worst(findings) {
    var lv = "ok";
    findings.forEach(function (f) { if (f.severity === "high") lv = "bad"; else if (f.severity === "medium" && lv !== "bad") lv = "warn"; });
    return lv;
  }
  function sectionFindings(n, section) { return n.findings.filter(function (f) { return f.section === section; }); }

  function findingParams(f) {
    var p = {};
    for (var k in f.params) p[k] = f.params[k];
    if (typeof p.days === "number") p.daysText = daysText(p.days);
    return p;
  }
  function sourceText(n, src) {
    if (src === "rdap_domain") return T("srcRdapDomain", { registry: n.registration.registry || "" }) + (n.registration.cached ? " " + T("srcCache") : "");
    if (src === "rdap_ip") {
      var h = n.hosting.filter(function (x) { return x.registry; })[0];
      return T("srcRdapIp", { registry: h ? h.registry : "" });
    }
    if (src === "doh") return T("srcDoh");
    return T("srcDerived");
  }
  function srcLine(n, src) { return el("small", { class: "src" }, T("howWeKnow") + sourceText(n, src)); }

  // ---- result pieces ----
  function expiryText(reg) {
    if (reg.state !== "registered" || reg.daysToExpiry === null) return "";
    if (reg.expiryLevel === "expired") return T("expiredAgo", { when: daysText(Math.abs(reg.daysToExpiry)) });
    if (reg.daysToExpiry < 1) return T("expiresToday");
    return T("expiresIn", { when: daysText(reg.daysToExpiry) });
  }
  var STATE_KEY = { registered: "statusRegistered", available: "statusAvailable", unsupported: "statusUnsupported", rate_limited: "statusRateLimited", unavailable: "statusUnavailable" };
  var RATING_KEY = { good: "mailRatingGood", improve: "mailRatingImprove", risk: "mailRatingRisk", nomail: "mailRatingNone", unknown: "mailRatingUnknown" };
  var RATING_LEVEL = { good: "ok", improve: "warn", risk: "bad", nomail: "info", unknown: "unknown" };

  function registrationLevel(n) {
    var r = n.registration;
    if (r.state === "available") return "info";
    if (r.state !== "registered") return "unknown";
    return worst(sectionFindings(n, "registration"));
  }
  function dnsGroup(n, host, type) { return n.dns.filter(function (g) { return g.host === host && g.type === type; })[0]; }
  function nsCount(n) {
    var g = dnsGroup(n, "apex", "NS");
    return g && g.state === "ok" ? g.records.length : null;
  }
  function tileFor(n, id) {
    var free = n.registration.state === "available";
    if (id === "registration") {
      var r = n.registration;
      var head = r.state === "registered" ? cap(expiryText(r)) : T(STATE_KEY[r.state]);
      return { level: registrationLevel(n), title: T("sectionRegistration"), head: head };
    }
    if (id === "dns") {
      var c = nsCount(n);
      var lv = !n.dnsAvailable || free ? "unknown" : worst(sectionFindings(n, "dns"));
      return { level: lv, title: T("sectionDns"), head: c === null ? T("tileUnknown") : c === 0 ? T("tileDnsNone") : T("tileDnsHeadline", { count: c }) };
    }
    if (id === "hosting") {
      var cnt = n.hosting.length;
      var hl = free || cnt === 0 ? "unknown" : worst(sectionFindings(n, "hosting"));
      return { level: hl, title: T("sectionHosting"), head: cnt === 0 ? T("tileHostingNone") : T("tileHostingHeadline", { count: cnt }) };
    }
    var rating = n.mail.rating;
    return { level: RATING_LEVEL[rating], title: T("sectionMail"), head: T(RATING_KEY[rating]) };
  }

  function findingNode(n, f) {
    var tx = D().findings[f.key] || {};
    var p = findingParams(f);
    var lv = sevLevel(f.severity);
    return el("article", { class: "finding " + f.severity }, [
      el("h3", null, [el("span", { class: "badge" }, [mark(lv === "ok" ? "info" : lv), T(f.severity === "high" ? "severityHigh" : f.severity === "medium" ? "severityMedium" : "severityLow")]), fmt(tx.title, p)]),
      el("p", null, [el("strong", null, T("why")), fmt(tx.why, p)]),
      el("p", null, [el("strong", null, T("fix")), fmt(tx.fix, p)]),
      el("p", { class: "src" }, [el("strong", null, T("howWeKnow")), sourceText(n, f.source)])
    ]);
  }
  function findingsBlock(n, section) {
    var list = sectionFindings(n, section);
    if (list.length === 0) return el("p", { class: "muted" }, T("noFindings"));
    var box = el("div", null, [el("h3", null, T("findingsHeading", { count: list.length }))]);
    list.forEach(function (f) { box.appendChild(findingNode(n, f)); });
    return box;
  }
  function row(label, nodes, lv) {
    var inner = lv ? el("div", { class: "line" }, [mark(lv), el("span", null, nodes)]) : el("div", null, nodes);
    return el("div", { class: "row" }, [el("dt", null, label), el("dd", null, [inner])]);
  }
  function card(id, titleKey, level, body) {
    return el("section", { class: "card", id: "sec-" + id, "aria-labelledby": "h-" + id }, [
      el("h2", { id: "h-" + id }, [T(titleKey), chip(level)])
    ].concat(body));
  }

  // The address comes from the server, but it is checked again here: only the IANA page of an ending is accepted.
  var IANA_PREFIX = "https://www.iana.org/domains/root/db/";
  function registryLink(n) {
    var url = n.registration.registryUrl;
    if (typeof url !== "string" || !/^https:\/\/www\.iana\.org\/domains\/root\/db\/(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})\.html$/.test(url) || url.indexOf(IANA_PREFIX) !== 0) return null;
    var parts = (n.unicode || n.domain).split(".");
    var a = el("a", { class: "reglink", target: "_blank", rel: "noopener noreferrer" }, T("registryLink", { tld: parts[parts.length - 1] }));
    a.setAttribute("href", url);
    return el("p", null, [a]);
  }

  function registrationCard(n) {
    var r = n.registration;
    var body = [];
    if (r.state !== "registered") {
      var key = { available: "regAvailableText", unsupported: "regUnsupportedText", rate_limited: "regRateLimitedText", unavailable: "regUnavailableText" }[r.state];
      body.push(el("p", null, T(key)));
      var link = registryLink(n);
      if (link) { body.push(link); body.push(el("p", { class: "muted" }, T("registryLinkHint"))); }
      if (r.registry) body.push(el("p", { class: "src" }, T("howWeKnow") + sourceText(n, "rdap_domain")));
      return card("registration", "sectionRegistration", registrationLevel(n), body);
    }
    var rows = [];
    var src = function () { return srcLine(n, "rdap_domain"); };
    rows.push(row(T("rowRegistrar"), [r.registrar ? raw(r.registrar, "span") : T("valueUnknown"), src()]));
    rows.push(row(T("rowRegistered"), [r.registered ? fmtDate(r.registered) : T("valueUnknown"), src()]));
    var exp = r.expires ? fmtDate(r.expires) + (expiryText(r) ? " (" + expiryText(r) + ")" : "") : T("valueUnknown");
    rows.push(row(T("rowExpires"), [exp, src()], r.expiryLevel === "unknown" ? null : r.expiryLevel === "ok" ? "ok" : r.expiryLevel === "medium" ? "warn" : "bad"));
    rows.push(row(T("rowChanged"), [r.changed ? fmtDate(r.changed) : T("valueUnknown"), src()]));
    var st = r.statuses.map(function (s) {
      var d = D().statuses[s.id];
      return el("li", null, [el("strong", null, d.label), " (", raw(s.raw, "span"), "). " + d.explain]);
    });
    rows.push(row(T("rowStatuses"), [st.length ? el("ul", { class: "plain" }, st) : T("valueUnknown"), src()]));
    rows.push(row(T("rowNameservers"), [r.nameservers.length ? el("ul", { class: "plain" }, r.nameservers.map(function (h) { return el("li", null, [raw(h)]); })) : T("valueUnknown"), src()]));
    rows.push(row(T("rowDnssec"), [r.dnssec === "signed" ? T("dnssecSigned") : r.dnssec === "unsigned" ? T("dnssecUnsigned") : T("dnssecUnknown"), src()]));
    rows.push(row(T("rowOwner"), [T("ownerHidden"), src()]));
    body.push(el("dl", null, rows));
    if (r.delayed) body.push(el("p", { class: "muted" }, T("regDelayNote")));
    if (r.cached) body.push(el("p", { class: "muted" }, T("regCachedNote")));
    body.push(findingsBlock(n, "registration"));
    return card("registration", "sectionRegistration", registrationLevel(n), body);
  }

  var DNS_ORDER = [["apex", "NS"], ["apex", "MX"], ["apex", "A"], ["apex", "AAAA"], ["apex", "TXT"], ["apex", "CAA"], ["apex", "SOA"], ["www", "A"], ["www", "AAAA"]];
  function recordValue(rec) {
    if (rec.type === "MX") { var p = rec.data.split(" "); return raw(p[0] + "  " + (p[1] || "")); }
    return raw(rec.data);
  }
  function dnsCard(n) {
    var body = [el("p", { class: "muted" }, T("dnsIntro"))];
    var free = n.registration.state === "available";
    if (!n.dnsAvailable) body.push(el("p", null, T("dnsUnavailable")));
    else {
      DNS_ORDER.forEach(function (k) {
        var g = dnsGroup(n, k[0], k[1]);
        if (!g) return;
        var meta = D().recordTypes[g.type];
        var box = el("div", { class: "rec" }, [
          el("h3", null, [meta.title + " ", el("span", { class: "host" }, "· " + T(k[0] === "apex" ? "hostApex" : "hostWww"))]),
          el("p", { class: "expl" }, meta.explain)
        ]);
        if (g.state === "failed") box.appendChild(el("p", { class: "muted" }, T("dnsFailed")));
        else if (g.records.length === 0) box.appendChild(el("p", { class: "muted" }, T("dnsNone")));
        else box.appendChild(el("ul", { class: "vals" }, g.records.map(function (rec) {
          var lead = rec.type === "CNAME" && g.type !== "CNAME" ? [D().recordTypes.CNAME.title + ": "] : [];
          return el("li", null, lead.concat([recordValue(rec)]));
        })));
        box.appendChild(srcLine(n, "doh"));
        body.push(box);
      });
    }
    body.push(el("h3", null, T("providersHeading")));
    body.push(el("p", { class: "muted" }, T("providersNote")));
    if (n.providers.length === 0) body.push(el("p", null, T("noProviders")));
    else body.push(el("ul", { class: "prov" }, n.providers.map(function (p) {
      var hosts = el("small", { class: "src" }, [T("providerFoundBy") + ": "].concat(p.hosts.reduce(function (acc, h, i) { if (i) acc.push(", "); acc.push(raw(h, "span")); return acc; }, [])));
      return el("li", null, [el("strong", { class: "raw" }, p.name), " (" + T(p.kind === "mail" ? "providerMail" : "providerDns") + ")", hosts]);
    })));
    if (!free) body.push(findingsBlock(n, "dns"));
    var lv = !n.dnsAvailable || free ? "unknown" : worst(sectionFindings(n, "dns"));
    return card("dns", "sectionDns", lv, body);
  }

  function hostingCard(n) {
    var body = [el("p", { class: "muted" }, T("hostingIntro"))];
    if (n.hosting.length === 0) body.push(el("p", null, T("hostingNoAddress")));
    n.hosting.forEach(function (h) {
      var parts = [el("p", null, [raw(h.ip), " (IPv" + h.family + ")"])];
      if (h.lookup === "ok" && h.network) {
        var name = (h.network.organisation ? h.network.organisation + " " : "") + (h.network.name ? (h.network.organisation ? "(" + h.network.name + ")" : h.network.name) : "");
        parts.push(el("p", null, [el("strong", null, T("hostingNetwork") + ": "), raw(name, "span")]));
        if (h.network.country) parts.push(el("p", null, [el("strong", null, T("hostingCountry") + ": "), raw(h.network.country, "span")]));
        if (h.network.cidr) parts.push(el("p", { class: "muted" }, [raw(h.network.cidr)]));
        parts.push(srcLine(n, "rdap_ip"));
      } else {
        parts.push(el("p", { class: "muted" }, T(h.kind === "non_public" ? "hostingNonPublic" : h.lookup === "unknown" ? "hostingUnknown" : "hostingSkipped")));
      }
      body.push(el("div", { class: "addr" }, parts));
    });
    body.push(el("p", { class: "muted" }, T("hostingNote")));
    body.push(srcLine(n, "doh"));
    if (n.registration.state !== "available") body.push(findingsBlock(n, "hosting"));
    var free = n.registration.state === "available";
    return card("hosting", "sectionHosting", free || n.hosting.length === 0 ? "unknown" : worst(sectionFindings(n, "hosting")), body);
  }

  var TERMINAL = { "-": ["-all", "terminalHard"], "~": ["~all", "terminalSoft"], "?": ["?all", "terminalNeutral"], "+": ["+all", "terminalOpen"] };
  function findingLevel(n, prefix) {
    var list = sectionFindings(n, "mail").filter(function (f) { return f.key.indexOf(prefix) === 0; });
    return list.length ? worst(list) : "ok";
  }
  function presence(v) { return v === "present" ? ["recordPresent", "ok"] : v === "absent" ? ["recordAbsent", "info"] : ["recordUnknown", "unknown"]; }
  function mailCard(n) {
    var m = n.mail;
    var body = [el("p", { class: "muted" }, T("mailIntro"))];
    var rl = RATING_LEVEL[m.rating];
    body.push(el("p", null, [el("strong", null, T("mailRatingLabel") + ": "), chip(rl, T(RATING_KEY[m.rating]))]));
    if (n.registration.state === "available") {
      body.push(el("p", null, T("availableNote")));
      return card("mail", "sectionMail", "unknown", body);
    }
    var rows = [];
    var mxText, mxLv;
    if (m.mxState === "failed") { mxText = T("mxUnknown"); mxLv = "unknown"; }
    else if (m.nullMx) { mxText = T("mxNull"); mxLv = "info"; }
    else if (m.mx.length === 0) { mxText = T("mxNone"); mxLv = "warn"; }
    else { mxText = null; mxLv = "ok"; }
    rows.push(row(T("rowMx"), [mxText !== null ? mxText : el("ul", { class: "plain" }, m.mx.map(function (x) { return el("li", null, [raw(x.priority + "  " + x.host)]); })), srcLine(n, "doh")], mxLv));

    var s = m.spf, spfText;
    if (s.state === "unknown") spfText = T("spfUnknown");
    else if (s.state === "none") spfText = T("spfNone");
    else if (s.state === "multiple") spfText = T("spfMultiple");
    else if (s.syntaxError) spfText = T("spfBroken");
    else if (!TERMINAL[s.terminal]) spfText = T("spfNoEnd");
    else {
      var tm = TERMINAL[s.terminal];
      spfText = T(s.complete ? "spfValue" : "spfValueMore", { terminal: tm[0], meaning: T(tm[1]), lookups: s.lookups });
    }
    var spfNodes = [spfText];
    if (s.record) spfNodes.push(el("div", null, [raw(s.record)]));
    spfNodes.push(srcLine(n, "doh"));
    rows.push(row(T("rowSpf"), spfNodes, s.state === "unknown" ? "unknown" : findingLevel(n, "spf.")));

    var dm = m.dmarc, dmText;
    if (dm.state === "unknown") dmText = T("dmarcUnknown");
    else if (dm.state === "none") dmText = T("dmarcNone");
    else if (dm.state === "multiple") dmText = T("dmarcMultiple");
    else if (!dm.valid) dmText = T("dmarcInvalid");
    else dmText = T("dmarcValue", { policy: dm.policy, meaning: T({ none: "policyNone", quarantine: "policyQuarantine", reject: "policyReject" }[dm.policy]), pct: dm.pct, reports: T(dm.ruaCount > 0 ? "reportsYes" : "reportsNo") });
    rows.push(row(T("rowDmarc"), [dmText, srcLine(n, "doh")], dm.state === "unknown" ? "unknown" : findingLevel(n, "dmarc.")));

    var dk = m.dkim, dkText, dkLv;
    if (dk.found.length > 0) {
      dkText = T("dkimFound", { selectors: dk.found.map(function (x) { return x.selector + (x.kind === "cname" ? " " + T("dkimCname") : ""); }).join(", ") });
      dkLv = "ok";
    } else if (dk.failed === dk.tried.length) { dkText = T("dkimUnknown"); dkLv = "unknown"; }
    else { dkText = T("dkimNotFound", { count: dk.tried.length - dk.failed }); dkLv = "info"; }
    rows.push(row(T("rowDkim"), [dkText, el("small", { class: "src" }, T("dkimNote", { selectors: dk.tried.join(", ") })), srcLine(n, "doh")], dkLv));

    var ms = presence(m.mtaSts), tr = presence(m.tlsRpt);
    rows.push(row(T("rowMtaSts"), [T(ms[0]), srcLine(n, "doh")], ms[1]));
    rows.push(row(T("rowTlsRpt"), [T(tr[0]), srcLine(n, "doh")], tr[1]));
    body.push(el("dl", null, rows));
    body.push(el("p", { class: "muted" }, T("mailRecordsNote")));
    body.push(findingsBlock(n, "mail"));
    return card("mail", "sectionMail", rl, body);
  }

  function copyText(n) {
    var lines = [T("copyFor", { domain: n.unicode || n.domain }), T(STATE_KEY[n.registration.state]) + (expiryText(n.registration) ? ", " + expiryText(n.registration) : ""), T("copyRating", { rating: T(RATING_KEY[n.mail.rating]) })];
    if (n.top.length) {
      lines.push("", T("copyTop"));
      n.top.forEach(function (i) { lines.push("- " + fmt((D().findings[n.findings[i].key] || {}).title, findingParams(n.findings[i]))); });
    }
    lines.push("", window.location.origin + "/");
    return lines.join("\n");
  }

  function render(n, animate) {
    var i = 0; // position in the entrance cascade, capped so long reports do not wait
    function rv(node) {
      if (animate) { node.classList.add("rv"); node.style.setProperty("--i", String(Math.min(i++, 12))); }
      return node;
    }
    reportEl.classList.toggle("still", !animate);
    reportEl.replaceChildren();

    var reg = n.registration;
    var head = el("div", { class: "head" }, [
      el("h2", { class: "dom raw" }, n.unicode || n.domain),
      el("p", null, [chip(registrationLevel(n), T(STATE_KEY[reg.state]))]),
      el("p", null, expiryText(reg) ? cap(expiryText(reg)) : " "),
      el("p", { class: "sub muted" }, n.submittedHost !== n.domain ? T("checkedDomain", { domain: n.unicode || n.domain, host: n.submittedHost }) : " ")
    ]);
    var copyBtn = el("button", { type: "button", class: "copy" }, T("copy"));
    copyBtn.addEventListener("click", function () {
      var done = function (ok) { copyBtn.textContent = T(ok ? "copied" : "copyFailed"); announce(copyBtn.textContent); window.setTimeout(function () { copyBtn.textContent = T("copy"); }, 2000); };
      try { navigator.clipboard.writeText(copyText(n)).then(function () { done(true); }, function () { done(false); }); }
      catch (e) { done(false); }
    });
    head.appendChild(copyBtn);
    reportEl.appendChild(rv(head));

    var ids = ["registration", "dns", "hosting", "mail"];
    reportEl.appendChild(rv(el("ul", { class: "tiles" }, ids.map(function (id) {
      var tl = tileFor(n, id);
      return el("li", { class: tl.level }, [el("span", { class: "tt" }, tl.title), chip(tl.level), el("span", { class: "th" }, tl.head)]);
    }))));

    reportEl.appendChild(rv(el("h2", null, T("topHeading"))));
    if (n.top.length === 0) reportEl.appendChild(rv(el("p", null, T("noTop"))));
    else reportEl.appendChild(rv(el("ol", { class: "tops" }, n.top.map(function (idx) {
      var f = n.findings[idx];
      var tx = D().findings[f.key] || {};
      var p = findingParams(f);
      return el("li", { class: f.severity }, [el("h3", null, fmt(tx.title, p)), el("p", null, [el("strong", null, T("fix")), fmt(tx.fix, p)])]);
    }))));

    reportEl.appendChild(rv(registrationCard(n)));
    reportEl.appendChild(rv(mailCard(n)));
    reportEl.appendChild(rv(dnsCard(n)));
    reportEl.appendChild(rv(hostingCard(n)));

    reportEl.appendChild(rv(el("h2", null, T("notShownHeading"))));
    reportEl.appendChild(rv(el("ul", { class: "plain" }, D().notShown.map(function (x) { return el("li", null, x); }))));
    reportEl.appendChild(rv(el("h2", null, T("coverageHeading"))));
    reportEl.appendChild(el("p", { class: "muted" }, T("coverageLine", { requests: n.coverage.requests, budget: n.coverage.budget })));
    if (n.coverage.incomplete) reportEl.appendChild(el("p", { class: "muted" }, T("coverageIncomplete")));
  }

  function setBusy(on) {
    busy = on;
    go.disabled = on;
    input.readOnly = on;
    goSpin.hidden = !on;
    setText(goText, on ? "submitBusy" : "submit");
    resultEl.setAttribute("aria-busy", String(on));
  }
  function clearTimers() { window.clearTimeout(slowTimer); window.clearTimeout(timeoutTimer); }
  function finish() {
    clearTimers();
    loadingEl.hidden = true;
    skeletonEl.hidden = true;
    reportEl.classList.remove("refreshing");
    setBusy(false);
  }

  var CODE_HINT = { rate_limited: "errorHintRate", invalid_domain: "errorHintInput" };
  var NO_RETRY = { invalid_domain: 1, invalid_json: 1, invalid_lang: 1, body_too_large: 1, invalid_body: 1 };

  // Shows an error. e = { kind: "network" | "timeout" | "response", code, key, message }.
  function showError(e, announceIt) {
    lastError = e;
    var message, hint, retry = true;
    if (e.kind === "network") { message = T("errorNetwork"); hint = "errorHintNetwork"; }
    else if (e.kind === "timeout") { message = T("errorTimeout"); hint = "errorHintSlow"; }
    else {
      message = (e.key && D().errors[e.key]) || e.message || T("errorGeneric");
      hint = CODE_HINT[e.code] || "errorHintGeneric";
      if (NO_RETRY[e.code]) retry = false;
    }
    reportEl.hidden = true;
    errorMsg.textContent = message;
    setText(errorHint, hint);
    retryBtn.hidden = !retry;
    errorEl.hidden = false;
    if (announceIt) announce(message + " " + T(hint));
  }

  // Scrolls only when the result starts below the visible area and the person has not scrolled meanwhile.
  function revealIfNeeded() {
    if (userScrolled) return;
    if (reportEl.getBoundingClientRect().top > window.innerHeight - 120) {
      reportEl.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
    }
  }

  function run(value) {
    var id = ++runId;
    var timedOut = false;
    lastInput = value;
    clearTimers();
    errorEl.hidden = true;
    userScrolled = false;
    reportEl.hidden = true;
    reportEl.classList.remove("refreshing");
    skeletonEl.hidden = false;
    setText(loadText, "loadingText");
    loadingEl.hidden = false;
    setBusy(true);
    announce(T("announceLoading"));

    slowTimer = window.setTimeout(function () {
      if (id !== runId) return;
      setText(loadText, "loadingSlow");
      announce(T("loadingSlow"));
    }, SLOW_MS);
    var ctrl = new AbortController();
    timeoutTimer = window.setTimeout(function () { timedOut = true; ctrl.abort(); }, TIMEOUT_MS);

    fetch("/api/lookup?lang=" + lang, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: value, lang: lang }),
      signal: ctrl.signal
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) { return { ok: res.ok, data: data }; });
    }).then(function (r) {
      if (id !== runId) return;
      finish();
      if (timedOut) { showError({ kind: "timeout" }, true); return; }
      if (r.ok && r.data && r.data.neutral) {
        lastResult = r.data.neutral;
        lastError = null;
        render(lastResult, true);
        reportEl.hidden = false;
        announce(T("announceDone", { domain: lastResult.unicode || lastResult.domain }));
        revealIfNeeded();
      } else {
        var err = (r.data && r.data.error) || {};
        showError({ kind: "response", code: err.code, key: err.key, message: err.message }, true);
      }
    }).catch(function () {
      if (id !== runId) return;
      finish();
      showError({ kind: timedOut ? "timeout" : "network" }, true);
    });
  }

  // Sets the language of every static text.
  function apply(l) {
    lang = l;
    live.textContent = ""; // an old announcement would be in the wrong language
    document.documentElement.lang = l;
    document.title = T("metaTitle");
    var meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", T("metaDescription"));
    document.querySelectorAll("[data-i18n]").forEach(function (n) { n.textContent = T(n.getAttribute("data-i18n")); });
    document.querySelectorAll("[data-i18n-placeholder]").forEach(function (n) { n.setAttribute("placeholder", T(n.getAttribute("data-i18n-placeholder"))); });
    document.querySelectorAll("[data-i18n-aria-label]").forEach(function (n) { n.setAttribute("aria-label", T(n.getAttribute("data-i18n-aria-label"))); });
    document.querySelectorAll("[data-lang]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-lang") === l)); });
  }

  // Changing the language never repeats the lookup: the result is drawn again from the neutral data.
  function choose(l) {
    if (l === lang) return;
    writeStored(l);
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("lang", l);
      window.history.replaceState(null, "", u.toString());
    } catch (e) { /* ignore */ }
    // Where the first heading of the result is on screen, so the content can be kept in place.
    var anchor = !reportEl.hidden ? reportEl.querySelector("h2:not(.dom)") : null;
    var anchorTop = anchor ? anchor.getBoundingClientRect().top : 0;
    apply(l);
    if (!reportEl.hidden && lastResult) {
      render(lastResult, false);
      var heading = reportEl.querySelector("h2:not(.dom)");
      if (heading) {
        var delta = heading.getBoundingClientRect().top - anchorTop;
        if (Math.abs(delta) > 1) window.scrollBy(0, delta);
      }
    } else if (!errorEl.hidden && lastError) showError(lastError, false);
  }

  document.querySelectorAll("[data-lang]").forEach(function (b) {
    b.addEventListener("click", function () { choose(b.getAttribute("data-lang")); });
  });
  retryBtn.addEventListener("click", function () { if (lastInput !== null && !busy) run(lastInput); });
  ["wheel", "touchmove", "keydown"].forEach(function (ev) {
    window.addEventListener(ev, function () { if (busy) userScrolled = true; }, { passive: true });
  });

  // Order of precedence: ?lang= in the address, then the saved choice, then Polish.
  var fromQuery = new URLSearchParams(window.location.search).get("lang");
  var initial = "pl";
  if (valid(fromQuery)) { initial = fromQuery; writeStored(fromQuery); }
  else if (valid(readStored())) initial = readStored();
  if (initial !== SERVER_LANG) apply(initial);
  else lang = initial;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    run(input.value);
  });
})();
</script>
</body>
</html>`;
