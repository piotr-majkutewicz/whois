import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { fakeNet, healthyZone } from "./helpers";

const call = (path: string, init?: RequestInit, env: Env = {}) => worker.fetch(new Request("https://whois.test" + path, init), env);
const post = (body: string, env?: Env, path = "/api/lookup") =>
  call(path, { method: "POST", body, headers: { "content-type": "application/json" } }, env);

// No test may reach the network: any real fetch call fails the test.
const forbidFetch = () => vi.stubGlobal("fetch", vi.fn(async (u: string) => { throw new Error(`unexpected network access: ${u}`); }));

afterEach(() => vi.unstubAllGlobals());

describe("page", () => {
  it("is served with a strict CSP and a per-request nonce", async () => {
    forbidFetch();
    const res = await call("/");
    const html = await res.text();
    const csp = res.headers.get("content-security-policy")!;
    const nonce = /nonce-([^']+)'/.exec(csp)![1]!;
    expect(csp.startsWith("default-src 'none'")).toBe(true);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src 'self'");
    expect(html).toContain(`nonce="${nonce}"`);
    expect(html).not.toContain("__NONCE__");
    expect(html).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(html).not.toMatch(/style="/); // inline style attributes would be blocked by the CSP
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("has the iOS fixes: theme-color, color-scheme and a dark html background", async () => {
    const html = await (await call("/")).text();
    expect(html).toContain('<meta name="theme-color" content="#14110f">');
    expect(html).toContain('<meta name="color-scheme" content="dark">');
    expect(html).toMatch(/html\{background:#14110f;color-scheme:dark\}/);
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    expect(html).not.toMatch(/(?:^|\n)(?:html|body)\s*\{[^}]*\boverflow(?:-[xy])?\s*:/);
  });

  it("loads nothing from outside and links only to the author's site", async () => {
    const html = await (await call("/")).text();
    const urls = [...html.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((m) => m[0]);
    // The only other address is the IANA prefix that links are checked against before they are rendered.
    expect(urls.filter((u) => !u.startsWith("https://piotrmajkutewicz.pl") && !u.startsWith("https://www.iana.org/domains/root/db/"))).toEqual([]);
    expect(html).toContain('<a href="https://piotrmajkutewicz.pl" rel="noopener"');
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=|<img/);
  });

  it("is Polish by default and English with ?lang=en, with both dictionaries embedded", async () => {
    const pl = await (await call("/")).text();
    const en = await (await call("/?lang=en")).text();
    expect(pl).toContain('<html lang="pl">');
    expect(en).toContain('<html lang="en">');
    expect(pl).toContain("Sprawdź domenę");
    expect(en).toContain("Domain check");
    expect(pl).toContain('aria-pressed="true">PL');
    expect(en).toContain('aria-pressed="true">EN');
    expect(await (await call("/?lang=xx")).text()).toContain('<html lang="pl">');
    // the language-neutral design: both languages are in the page, so switching needs no request
    expect(pl).toContain("Domena jest zajęta");
    expect(pl).toContain("The domain is registered");
  });

  it("only activates the scroll diagnostics with ?dbg=1", async () => {
    const html = await (await call("/")).text();
    expect(html).toMatch(/if \(!\/\[\?&\]dbg=1\(&\|\$\)\/\.test\(location\.search\)\) return;/);
  });

  it("serves robots.txt that allows crawling and has no sitemap", async () => {
    const res = await call("/robots.txt");
    expect(await res.text()).toBe("User-agent: *\nAllow: /\n");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(await call("/sitemap.xml").then((r) => r.status)).toBe(404);
    expect(await (await call("/")).text()).toContain('<meta name="robots" content="noindex, nofollow">');
  });
});

describe("POST /api/lookup, input handling", () => {
  it("validates the body without any network access", async () => {
    forbidFetch();
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(5000))).status).toBe(413);
    expect((await post(JSON.stringify({}))).status).toBe(400);
    expect((await post(JSON.stringify({ domain: 5 }))).status).toBe(400);
    expect((await post(JSON.stringify({ domain: "example.com", lang: "de" }))).status).toBe(400);
    expect((await call("/api/lookup")).status).toBe(405);
    expect((await call("/nope")).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects IPs, local names and bad names with stable codes and translated messages", async () => {
    forbidFetch();
    for (const [input, key] of [["127.0.0.1", "domain_ip"], ["http://[::1]/", "domain_ip"], ["localhost", "domain_local"], ["firma", "domain_no_dot"], ["", "domain_empty"], ["a b.com", "domain_chars"], ["com.pl", "domain_suffix"]] as const) {
      const res = await post(JSON.stringify({ domain: input }));
      const body = (await res.json()) as any;
      expect(res.status, input).toBe(400);
      expect(body.error.code).toBe("invalid_domain");
      expect(body.error.key).toBe(key);
      expect(body.error.message.length).toBeGreaterThan(5);
    }
    const en = (await (await post(JSON.stringify({ domain: "10.0.0.1", lang: "en" }))).json()) as any;
    expect(en.error.message).toBe("This is an IP address, not a domain name. Enter a name, for example example.com.");
    const pl = (await (await post(JSON.stringify({ domain: "10.0.0.1" }))).json()) as any;
    expect(pl.error.message).toContain("adres IP");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies the rate limit binding when present and works without it", async () => {
    forbidFetch();
    const denied: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const res = await post(JSON.stringify({ domain: "example.com" }), denied);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(((await res.json()) as any).error.code).toBe("rate_limited");
    expect((await post(JSON.stringify({ domain: "10.0.0.1" }), {})).status).toBe(400);
  });

  it("uses the client address as the rate limit key and nothing else", async () => {
    forbidFetch();
    const limit = vi.fn(async () => ({ success: true }));
    await call("/api/lookup", { method: "POST", body: JSON.stringify({ domain: "127.0.0.1" }), headers: { "cf-connecting-ip": "203.0.113.7" } }, { RATE_LIMITER: { limit } });
    expect(limit).toHaveBeenCalledWith({ key: "203.0.113.7" });
  });

  it("sends X-Robots-Tag noindex on every kind of response", async () => {
    forbidFetch();
    const denied: Env = { RATE_LIMITER: { limit: async () => ({ success: false }) } };
    const responses = [
      await call("/"), await call("/", { method: "HEAD" }), await call("/robots.txt"), await call("/nope"), await call("/api/lookup"),
      await post("not json"), await post("x".repeat(5000)), await post(JSON.stringify({ domain: "127.0.0.1" })),
      await post(JSON.stringify({ domain: "example.com" }), denied),
    ];
    for (const res of responses) expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(responses.every((r) => r.headers.get("x-content-type-options") === "nosniff")).toBe(true);
  });
});

describe("POST /api/lookup, successful lookups with a fake internet", () => {
  it("returns neutral data and texts, with no street, phone or e-mail", async () => {
    const net = fakeNet(healthyZone());
    vi.stubGlobal("fetch", net.fetch);
    const res = await post(JSON.stringify({ domain: "https://www.example.pl/kontakt" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.lang).toBe("pl");
    expect(body.neutral.domain).toBe("example.pl");
    expect(body.neutral.registration.state).toBe("registered");
    expect(body.neutral.mail.rating).toBe("good");
    expect(body.texts.status).toBe("Domena jest zajęta");
    expect(body.texts.mailRating).toBe("Dobrze skonfigurowana");
    for (const secret of ["Przykladowa", "500600700", "jan@example.invalid", "Tech Person"]) expect(raw).not.toContain(secret);
  });

  it("answers in English when asked and the body field beats the query string", async () => {
    vi.stubGlobal("fetch", fakeNet(healthyZone()).fetch);
    const body = (await (await post(JSON.stringify({ domain: "example.pl", lang: "en" }), {}, "/api/lookup?lang=pl")).json()) as any;
    expect(body.lang).toBe("en");
    expect(body.texts.status).toBe("The domain is registered");
    expect(body.neutral.registration.state).toBe("registered");
  });

  it("returns the registry information link for an ending without RDAP", async () => {
    vi.stubGlobal("fetch", fakeNet({}).fetch);
    const body = (await (await post(JSON.stringify({ domain: "firma.xyz" }))).json()) as any;
    expect(body.neutral.registration.state).toBe("unsupported");
    expect(body.neutral.registration.registryUrl).toBe("https://www.iana.org/domains/root/db/xyz.html");
    expect(await call("/").then((r) => r.text())).not.toMatch(/innerHTML/);
  });

  it("never turns an internal failure into a detailed error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("secret internal detail 10.1.2.3"); }));
    const res = await post(JSON.stringify({ domain: "nie-w-cache.pl" }));
    // all outbound calls failed: the lookup still completes, with everything marked unavailable
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain("secret internal detail");
    const body = JSON.parse(raw);
    expect(body.neutral.registration.state).toBe("unavailable");
    expect(body.neutral.dnsAvailable).toBe(false);
    expect(body.neutral.coverage.incomplete).toBe(true);
  });
});
