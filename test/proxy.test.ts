import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../src/index";
import { runLookup } from "../src/lookup";
import { parseProxyConfig } from "../src/proxy";
import { deps, domain, fakeNet, fixture, healthyZone, json } from "./helpers";

const KEY = "proxy-secret-key-0123456789abcdef0123456789";
const config = { base: "https://rdap-proxy.example.com", key: KEY, access: null };
const PL = "https://rdap.dns.pl/";
const ok = () => json(fixture("rdap-pl.json"));

describe("parseProxyConfig", () => {
  const good = { RDAP_PROXY_URL: "https://rdap-proxy.example.com", RDAP_PROXY_KEY: KEY };
  it("accepts an https host name and normalises it", () => {
    expect(parseProxyConfig(good).config).toEqual({ base: "https://rdap-proxy.example.com", key: KEY, access: null });
    expect(parseProxyConfig({ ...good, RDAP_PROXY_URL: "https://Proxy.Example.com/" }).config?.base).toBe("https://proxy.example.com");
  });
  it("adds Access credentials only when both parts exist", () => {
    expect(parseProxyConfig({ ...good, RDAP_PROXY_ACCESS_ID: "id", RDAP_PROXY_ACCESS_SECRET: "sec" }).config?.access).toEqual({ id: "id", secret: "sec" });
    expect(parseProxyConfig({ ...good, RDAP_PROXY_ACCESS_ID: "id" }).config?.access).toBeNull();
  });
  it("ignores missing and invalid settings", () => {
    expect(parseProxyConfig({})).toEqual({ config: null, problem: null });
    expect(parseProxyConfig({ RDAP_PROXY_URL: "  " })).toEqual({ config: null, problem: null });
    for (const url of ["http://rdap-proxy.example.com", "https://10.0.0.1", "https://8.8.8.8", "https://[::1]", "https://2130706433", "https://rdap-proxy.example.com:8443", "https://user:pw@rdap-proxy.example.com", "https://rdap-proxy.example.com/rdap", "https://rdap-proxy.example.com/?x=1", "https://localhost", "https://intranet", "not a url", "ftp://x.example.com", "javascript:alert(1)"]) {
      expect(parseProxyConfig({ ...good, RDAP_PROXY_URL: url }), url).toEqual({ config: null, problem: "url" });
    }
    expect(parseProxyConfig({ RDAP_PROXY_URL: good.RDAP_PROXY_URL })).toEqual({ config: null, problem: "key" });
  });
});

describe("registry lookup through the proxy", () => {
  it("asks the proxy with the key and does not touch the registry", async () => {
    const net = fakeNet(healthyZone(), { plRegistry: PL, proxy: () => ok() });
    const r = await runLookup(domain("example.pl"), deps(net, { proxy: { ...config, access: { id: "ID", secret: "SECRET" } } }));
    expect(r.registration).toMatchObject({ state: "registered", registry: "rdap.dns.pl", via: "proxy", registrar: "Example Registrar SAS" });
    const i = net.calls.findIndex((c) => c.startsWith("https://rdap-proxy.example.com/"));
    expect(net.calls[i]).toBe("https://rdap-proxy.example.com/rdap/domain/example.pl");
    expect(net.headers[i]).toMatchObject({ "x-proxy-key": KEY, "cf-access-client-id": "ID", "cf-access-client-secret": "SECRET" });
    expect(net.calls.some((c) => c.startsWith(PL + "domain/"))).toBe(false);
    // the key goes to the proxy only
    net.headers.forEach((h, n) => { if (n !== i) expect(Object.keys(h).filter((k) => /proxy-key|access/.test(k))).toEqual([]); });
    expect(JSON.stringify(r)).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("works as before without a proxy", async () => {
    const net = fakeNet(healthyZone(), { plRegistry: PL, rdapDomain: ok });
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.registration).toMatchObject({ state: "registered", via: null });
    expect(net.calls.some((c) => c.includes("rdap-proxy"))).toBe(false);
  });

  it("does not use the proxy for other registries", async () => {
    const net = fakeNet(healthyZone("example.com"), { proxy: () => { throw new Error("must not be called"); } });
    const r = await runLookup(domain("example.com"), deps(net, { proxy: config }));
    expect(r.registration.state).toBe("registered");
    expect(net.calls.some((c) => c.includes("rdap-proxy"))).toBe(false);
  });

  it("reads 404 from the proxy as available and 429 as rate limited, without a fallback", async () => {
    const free = fakeNet({}, { plRegistry: PL, proxy: () => json({ errorCode: 404 }, 404) });
    expect((await runLookup(domain("wolna.pl"), deps(free, { proxy: config }))).registration).toMatchObject({ state: "available", via: "proxy" });
    expect(free.calls.some((c) => c.startsWith(PL + "domain/"))).toBe(false);

    const limited = fakeNet(healthyZone(), { plRegistry: PL, proxy: () => json({}, 429, "application/rdap+json", { "retry-after": "30" }) });
    const r = await runLookup(domain("example.pl"), deps(limited, { proxy: config }));
    expect(r.registration).toMatchObject({ state: "rate_limited", via: "proxy", registryUrl: "https://www.iana.org/domains/root/db/pl.html" });
    expect(limited.calls.some((c) => c.startsWith(PL + "domain/"))).toBe(false);
    expect(r.dnsAvailable).toBe(true);
  });

  it("falls back to the registry once when the proxy fails", async () => {
    const cases: [string, () => Response | Promise<Response>][] = [
      ["5xx", () => json({}, 503)],
      ["network error", () => { throw new TypeError("down"); }],
      ["wrong key (plain 404)", () => new Response("", { status: 404 })],
      ["HTML from a gateway", () => new Response("<html>login</html>", { status: 200, headers: { "content-type": "text/html" } })],
      ["bad request", () => json({}, 400)],
    ];
    for (const [name, proxy] of cases) {
      const net = fakeNet(healthyZone(), { plRegistry: PL, proxy, rdapDomain: ok });
      const r = await runLookup(domain("example.pl"), deps(net, { proxy: config }));
      expect(r.registration, name).toMatchObject({ state: "registered", via: null });
      expect(net.calls.filter((c) => c.includes("rdap-proxy")), name).toHaveLength(1);
      expect(net.calls.filter((c) => c.startsWith(PL + "domain/")), name).toHaveLength(1);
    }
  });

  it("a proxy timeout falls back too", async () => {
    const net = fakeNet(healthyZone(), { plRegistry: PL, proxy: () => new Promise<Response>(() => {}), rdapDomain: ok });
    const wrapped = (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        net.fetch(url, init).then(resolve, reject);
      });
    const r = await runLookup(domain("example.pl"), { ...deps(net, { proxy: config }), fetch: wrapped, options: { maxRequests: 30, callTimeoutMs: 60, totalTimeoutMs: 5000, concurrency: 6 } });
    expect(r.registration.state).toBe("registered");
  });

  it("a fallback that is rate limited shows the usual message", async () => {
    const net = fakeNet(healthyZone(), { plRegistry: PL, proxy: () => json({}, 502), rdapDomain: () => json({}, 429) });
    const r = await runLookup(domain("example.pl"), deps(net, { proxy: config }));
    expect(r.registration).toMatchObject({ state: "rate_limited", via: null });
  });
});

describe("worker routes with the proxy", () => {
  afterEach(() => vi.unstubAllGlobals());
  const post = (env: Env, domainName = "example.pl", lang = "pl") =>
    worker.fetch(new Request("https://whois.test/api/lookup", { method: "POST", body: JSON.stringify({ domain: domainName, lang }) }), env);

  it("uses the proxy when configured and never returns the secrets", async () => {
    const net = fakeNet(healthyZone("proxied-1.pl"), { plRegistry: PL, proxy: () => ok() });
    vi.stubGlobal("fetch", net.fetch);
    const res = await post({ RDAP_PROXY_URL: "https://rdap-proxy.example.com", RDAP_PROXY_KEY: KEY, RDAP_PROXY_ACCESS_ID: "ACCID", RDAP_PROXY_ACCESS_SECRET: "ACCSECRET" }, "proxied-1.pl");
    const raw = await res.text();
    const body = JSON.parse(raw);
    expect(body.neutral.registration).toMatchObject({ state: "registered", via: "proxy" });
    for (const secret of [KEY, "ACCID", "ACCSECRET", "rdap-proxy.example.com"]) expect(raw).not.toContain(secret);
    expect(body.texts.findings.every((f: any) => !f.source.includes("example.com"))).toBe(true);
  });

  it("ignores an invalid proxy URL, asks the registry directly and warns once without the value", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const net = fakeNet(healthyZone("proxied-2.pl"), { plRegistry: PL, rdapDomain: ok });
    vi.stubGlobal("fetch", net.fetch);
    const env = { RDAP_PROXY_URL: "http://10.0.0.5", RDAP_PROXY_KEY: KEY };
    const body = (await (await post(env, "proxied-2.pl")).json()) as any;
    expect(body.neutral.registration).toMatchObject({ state: "registered", via: null });
    expect(net.calls.some((c) => c.includes("10.0.0.5"))).toBe(false);
    await post(env, "proxied-2.pl");
    expect(warn.mock.calls.length).toBeLessThanOrEqual(1);
    for (const call of warn.mock.calls) expect(String(call[0])).not.toMatch(/10\.0\.0\.5|proxy-secret/);
    warn.mockRestore();
  });

  it("names the intermediary in the source line, in both languages", async () => {
    const net = fakeNet(healthyZone("proxied-3.pl"), { plRegistry: PL, proxy: () => json({ ...fixture("rdap-pl.json"), events: [{ eventAction: "expiration", eventDate: "2026-11-20T00:00:00Z" }] }) });
    vi.stubGlobal("fetch", net.fetch);
    const env = { RDAP_PROXY_URL: "https://rdap-proxy.example.com", RDAP_PROXY_KEY: KEY };
    const pl = (await (await post(env, "proxied-3.pl")).json()) as any;
    const src = pl.texts.findings.find((f: any) => f.id === "reg.expires_soon").source;
    expect(src).toBe("RDAP rejestru rdap.dns.pl (przez pośrednika)");
    const en = (await (await post(env, "proxied-3.pl", "en")).json()) as any;
    expect(en.texts.findings.find((f: any) => f.id === "reg.expires_soon").source).toBe("RDAP of the rdap.dns.pl registry (through an intermediary)");
  });
});
