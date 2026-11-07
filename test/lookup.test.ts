import { describe, expect, it } from "vitest";
import { MemoryCache } from "../src/cache";
import { runLookup } from "../src/lookup";
import { DEFAULT_NET_OPTIONS } from "../src/net";
import { deps, domain, fakeNet, fixture, healthyZone, json, q, type Zone } from "./helpers";

describe("runLookup, healthy domain", () => {
  it("collects registration, DNS, hosting and mail", async () => {
    const net = fakeNet(healthyZone());
    const r = await runLookup(domain("www.example.pl"), deps(net));
    expect(r.domain).toBe("example.pl");
    expect(r.submittedHost).toBe("www.example.pl");
    expect(r.registration).toMatchObject({ state: "registered", registry: "rdap.registry.example", registrar: "Example Registrar SAS", cached: false, expiryLevel: "ok", dnssec: "unsigned" });
    expect(r.registration.daysToExpiry).toBeGreaterThan(600);
    expect(r.dnsAvailable).toBe(true);
    expect(r.dns.find((g) => g.host === "apex" && g.type === "MX")!.records).toHaveLength(2);
    expect(r.dns.find((g) => g.host === "www" && g.type === "A")!.records.map((x) => x.type)).toEqual(["CNAME", "A"]);
    expect(r.mail.rating).toBe("good");
    expect(r.mail.spf).toMatchObject({ state: "one", terminal: "-", lookups: 1 });
    expect(r.mail.dmarc).toMatchObject({ policy: "reject", valid: true });
    expect(r.mail.dkim.found).toEqual([{ selector: "google", kind: "txt" }]);
    expect(r.providers.map((p) => `${p.kind}:${p.id}`).sort()).toEqual(["mail:google"]);
    expect(r.hosting.map((h) => [h.ip, h.lookup, h.network?.name])).toEqual([["203.0.114.10", "ok", "EXAMPLE-NET"], ["2a01:4f8::1", "ok", "EXAMPLE-NET"]]);
    expect(r.findings.filter((f) => f.severity !== "low")).toEqual([]);
    expect(r.top).toEqual([]);
    expect(r.coverage.incomplete).toBe(false);
  });

  it("stays within the request budget", async () => {
    const net = fakeNet(healthyZone());
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.coverage.requests).toBe(net.calls.length);
    expect(r.coverage.requests).toBeLessThanOrEqual(30);
  });

  it("never sends an address, token or visitor data to a data source", async () => {
    const net = fakeNet(healthyZone());
    await runLookup(domain("example.pl"), deps(net));
    for (const url of net.calls) expect(new URL(url).protocol).toBe("https:");
    expect(net.calls.every((u) => /^https:\/\/(data\.iana\.org|rdap\.registry\.example|rdap\.rir\.example|cloudflare-dns\.com)\//.test(u))).toBe(true);
  });
});

describe("registry outcomes", () => {
  it("a JSON 404 means the domain is free, and no verdicts are given on DNS or mail", async () => {
    const net = fakeNet({}, { rdapDomain: () => json({ errorCode: 404 }, 404) });
    const r = await runLookup(domain("wolna.pl"), deps(net));
    expect(r.registration.state).toBe("available");
    expect(r.findings).toEqual([]);
    expect(r.mail.rating).toBe("nomail");
  });

  it("an HTML 404 is not proof that the domain is free", async () => {
    const net = fakeNet(healthyZone(), { rdapDomain: () => new Response("<html>not found</html>", { status: 404, headers: { "content-type": "text/html" } }) });
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.registration.state).toBe("unavailable");
    expect(r.mail.rating).toBe("good"); // DNS and mail are still checked
  });

  it("retries once after a 429 and succeeds", async () => {
    let n = 0;
    const sleeps: number[] = [];
    const net = fakeNet(healthyZone(), { rdapDomain: () => (n++ === 0 ? json({}, 429, "application/rdap+json", { "retry-after": "1" }) : json(fixture("rdap-pl.json"))) });
    const r = await runLookup(domain("example.pl"), deps(net, { sleep: async (ms) => void sleeps.push(ms) }));
    expect(r.registration.state).toBe("registered");
    expect(net.count("/domain/")).toBe(2);
    expect(sleeps).toEqual([1000]);
  });

  it("reports a persistent 429 as rate limiting and keeps going with DNS", async () => {
    const net = fakeNet(healthyZone(), { rdapDomain: () => json({}, 429) });
    const sleeps: number[] = [];
    const cache = new MemoryCache();
    const r = await runLookup(domain("example.pl"), deps(net, { cache, sleep: async (ms) => void sleeps.push(ms) }));
    expect(r.registration.state).toBe("rate_limited");
    expect(r.registration.expires).toBeNull();
    expect(net.count("/domain/")).toBe(2);
    expect(sleeps).toHaveLength(1);
    expect(r.dnsAvailable).toBe(true);
    expect(r.findings.some((f) => f.section === "registration")).toBe(false);
    // The registry is left alone for a moment: a second lookup does not ask again.
    const again = await runLookup(domain("example.pl"), deps(net, { cache, inflight: new Map() }));
    expect(again.registration).toMatchObject({ state: "rate_limited", cached: true });
    expect(net.count("/domain/")).toBe(2);
  });

  it("handles 500 and network failures as unavailable, with one retry", async () => {
    const net500 = fakeNet(healthyZone(), { rdapDomain: () => json({}, 500) });
    expect((await runLookup(domain("example.pl"), deps(net500))).registration.state).toBe("unavailable");
    expect(net500.count("/domain/")).toBe(2);
    const netDown = fakeNet(healthyZone(), { rdapDomain: () => { throw new TypeError("network down"); } });
    expect((await runLookup(domain("example.pl"), deps(netDown))).registration.state).toBe("unavailable");
  });

  it("handles a timeout", async () => {
    const net = fakeNet(healthyZone(), {
      rdapDomain: () => new Promise<Response>(() => {}), // never answers
    });
    // The fake fetch ignores the abort signal, so wrap it to honour it like real fetch does.
    const wrapped = (url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        net.fetch(url, init).then(resolve, reject);
      });
    const r = await runLookup(domain("example.pl"), { ...deps(net), fetch: wrapped, options: { ...DEFAULT_NET_OPTIONS, callTimeoutMs: 60, totalTimeoutMs: 5000 } });
    expect(r.registration.state).toBe("unavailable");
    expect(r.dnsAvailable).toBe(true);
  });

  it("a 4xx other than 404 or 429 is an error, not a verdict", async () => {
    const net = fakeNet(healthyZone(), { rdapDomain: () => json({}, 403) });
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.registration.state).toBe("unavailable");
    expect(net.count("/domain/")).toBe(1);
  });

  it("an unreadable 200 is an error", async () => {
    const net = fakeNet(healthyZone(), { rdapDomain: () => new Response("garbage", { status: 200 }) });
    expect((await runLookup(domain("example.pl"), deps(net))).registration.state).toBe("unavailable");
  });

  it("says so when an ending has no RDAP service, and still shows DNS", async () => {
    const zone = healthyZone("firma.nordap");
    const net = fakeNet(zone);
    const r = await runLookup(domain("firma.nordap"), deps(net));
    expect(r.registration.state).toBe("unsupported");
    expect(r.dnsAvailable).toBe(true);
    expect(net.count("/domain/")).toBe(0);
  });

  it("an ending that is not in the bootstrap file is unsupported", async () => {
    const net = fakeNet({});
    expect((await runLookup(domain("firma.xyz"), deps(net))).registration.state).toBe("unsupported");
  });

  it("caches successful answers and the bootstrap file", async () => {
    const net = fakeNet(healthyZone());
    const cache = new MemoryCache();
    await runLookup(domain("example.pl"), deps(net, { cache }));
    const second = await runLookup(domain("example.pl"), deps(net, { cache, inflight: new Map() }));
    expect(second.registration.cached).toBe(true);
    expect(net.count("/domain/")).toBe(1);
    expect(net.count("dns.json")).toBe(1);
  });

  it("shares one registry query between parallel lookups of the same domain", async () => {
    const net = fakeNet(healthyZone());
    const shared = deps(net);
    const [a, b] = await Promise.all([runLookup(domain("example.pl"), shared), runLookup(domain("example.pl"), shared)]);
    expect(a.registration.state).toBe("registered");
    expect(b.registration.state).toBe("registered");
    expect(net.count("/domain/")).toBe(1);
  });
});

describe("expiry findings", () => {
  const withExpiry = (iso: string) => ({ ...fixture("rdap-pl.json"), events: [{ eventAction: "expiration", eventDate: iso }] });
  const days = (n: number) => new Date(Date.parse("2026-11-07T12:00:00Z") + n * 86_400_000).toISOString();
  const find = async (iso: string) => {
    const net = fakeNet(healthyZone(), { rdapDomain: () => json(withExpiry(iso)) });
    return (await runLookup(domain("example.pl"), deps(net))).findings.filter((f) => f.section === "registration" && f.key !== "reg.no_dnssec");
  };
  it("warns at 29, 6 days and after expiry", async () => {
    expect(await find(days(29))).toMatchObject([{ key: "reg.expires_soon", severity: "medium", params: { days: 29 } }]);
    expect(await find(days(6))).toMatchObject([{ key: "reg.expires_soon", severity: "high" }]);
    expect(await find(days(-2))).toMatchObject([{ key: "reg.expired", severity: "high" }]);
    expect(await find(days(31))).toEqual([]);
  });
});

describe("DNS and hosting edge cases", () => {
  it("does not query private addresses and flags them", async () => {
    const zone = healthyZone();
    zone["example.pl|A"] = [q("A", "192.168.1.10"), q("A", "10.0.0.1")];
    zone["example.pl|AAAA"] = [q("AAAA", "fd00::1")];
    const net = fakeNet(zone);
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.hosting.every((h) => h.kind === "non_public" && h.lookup === "skipped")).toBe(true);
    expect(net.count("/ip/")).toBe(0);
    expect(r.findings.map((f) => f.key)).toContain("hosting.non_public");
  });

  it("looks up at most two public addresses", async () => {
    const zone = healthyZone();
    zone["example.pl|A"] = [q("A", "203.0.114.1"), q("A", "203.0.114.2"), q("A", "203.0.114.3")];
    zone["example.pl|AAAA"] = [];
    const net = fakeNet(zone);
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(net.count("/ip/")).toBe(2);
    expect(r.hosting.filter((h) => h.lookup === "ok")).toHaveLength(2);
    expect(r.hosting.filter((h) => h.lookup === "skipped")).toHaveLength(1);
  });

  it("says unknown when the RIR answers with an error", async () => {
    const net = fakeNet(healthyZone(), { ipv4: () => json({}, 500) });
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.hosting.every((h) => h.lookup === "unknown" && h.network === null)).toBe(true);
  });

  it("reports a broken resolver without claiming that records are missing", async () => {
    const zone: Zone = { "*": "servfail" };
    const net = fakeNet(zone);
    const r = await runLookup(domain("example.pl"), deps(net));
    expect(r.dnsAvailable).toBe(false);
    expect(r.dns.every((g) => g.state === "failed")).toBe(true);
    expect(r.findings.filter((f) => f.section !== "registration")).toEqual([]);
    expect(r.mail.rating).toBe("unknown");
    expect(r.coverage.incomplete).toBe(true);
  });

  it("flags a registered domain with no name servers, and a domain with no address", async () => {
    const zone = healthyZone();
    zone["example.pl|NS"] = [];
    const r1 = await runLookup(domain("example.pl"), deps(fakeNet(zone)));
    expect(r1.findings.map((f) => f.key)).toContain("dns.no_ns");
    const zone2 = healthyZone();
    zone2["example.pl|A"] = [];
    zone2["example.pl|AAAA"] = [];
    const r2 = await runLookup(domain("example.pl"), deps(fakeNet(zone2)));
    expect(r2.findings.map((f) => f.key)).toContain("dns.no_address");
  });

  it("recognises DNS and mail providers", async () => {
    const zone = healthyZone();
    zone["example.pl|NS"] = [q("NS", "kate.ns.cloudflare.com."), q("NS", "bob.ns.cloudflare.com.")];
    const r = await runLookup(domain("example.pl"), deps(fakeNet(zone)));
    expect(r.providers.map((p) => `${p.kind}:${p.id}`).sort()).toEqual(["dns:cloudflare", "mail:google"]);
  });
});

describe("limits", () => {
  it("never exceeds the request budget, even with a huge SPF tree", async () => {
    const zone = healthyZone();
    zone["example.pl|TXT"] = [q("TXT", "v=spf1 " + Array.from({ length: 9 }, (_, i) => `include:i${i}.example.net`).join(" ") + " -all")];
    for (let i = 0; i < 9; i++) zone[`i${i}.example.net|TXT`] = [q("TXT", `v=spf1 include:deep${i}.example.net -all`)];
    const net = fakeNet(zone);
    const r = await runLookup(domain("example.pl"), deps(net, { options: { ...DEFAULT_NET_OPTIONS, maxRequests: 24 } }));
    expect(net.calls.length).toBeLessThanOrEqual(24);
    expect(r.coverage.incomplete).toBe(true);
    expect(r.findings.map((f) => f.key)).not.toContain("spf.missing");
  });

  it("limits concurrent requests", async () => {
    let active = 0, peak = 0;
    const net = fakeNet(healthyZone());
    const slow = async (url: string, init?: RequestInit) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 3));
      try {
        return await net.fetch(url, init);
      } finally {
        active--;
      }
    };
    await runLookup(domain("example.pl"), { ...deps(net), fetch: slow });
    expect(peak).toBeLessThanOrEqual(DEFAULT_NET_OPTIONS.concurrency);
    expect(peak).toBeGreaterThan(1);
  });
});
