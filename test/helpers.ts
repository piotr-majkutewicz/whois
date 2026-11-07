// Offline test helpers: a fake "internet" for the lookup code. No test touches the network.
import { readFileSync } from "node:fs";
import { parseDomainInput } from "../src/domain";
import { MemoryCache } from "../src/cache";
import type { LookupDeps } from "../src/lookup";

export const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

export const NOW = new Date("2026-11-07T12:00:00Z");

export function domain(input: string) {
  const p = parseDomainInput(input);
  if (!p.ok) throw new Error(p.reason);
  return p;
}

type DnsEntry = { type: number; data: string; name?: string };
export type Zone = Record<string, DnsEntry[] | "servfail" | "nxdomain">;

export const TYPE_NUM: Record<string, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

export interface FakeNet {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  calls: string[];
  /** How many calls went to each kind of endpoint. */
  count: (needle: string) => number;
  rdapDomain: (url: string) => Response | Promise<Response>;
}

export const json = (body: unknown, status = 200, contentType = "application/rdap+json", headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": contentType, ...headers } });

export const dohAnswer = (rows: DnsEntry[], status = 0) =>
  json({ Status: status, Answer: rows.map((r) => ({ name: r.name ?? "x.", type: r.type, TTL: 300, data: r.data })) }, 200, "application/dns-json");

export const q = (type: string, data: string): DnsEntry => ({ type: TYPE_NUM[type]!, data: type === "TXT" ? JSON.stringify(data) : data });

export function fakeNet(zone: Zone, opts: { rdapDomain?: (url: string) => Response | Promise<Response>; ipv4?: (url: string) => Response } = {}): FakeNet {
  const calls: string[] = [];
  const net: FakeNet = {
    calls,
    count: (needle) => calls.filter((c) => c.includes(needle)).length,
    rdapDomain: opts.rdapDomain ?? (() => json(fixture("rdap-pl.json"))),
    fetch: async (url) => {
      calls.push(url);
      const u = new URL(url);
      if (u.host === "data.iana.org") {
        if (u.pathname.endsWith("dns.json")) return json({ services: [[["pl", "com"], ["https://rdap.registry.example/"]], [["nordap"], ["http://insecure.example/"]]] }, 200, "application/json");
        if (u.pathname.endsWith("ipv4.json")) return json({ services: [[["203.0.0.0/8"], ["https://rdap.rir.example/"]]] }, 200, "application/json");
        if (u.pathname.endsWith("ipv6.json")) return json({ services: [[["2a00::/12"], ["https://rdap.rir.example/"]]] }, 200, "application/json");
      }
      if (u.host === "rdap.registry.example") return net.rdapDomain(url);
      if (u.host === "rdap.rir.example") return opts.ipv4 ? opts.ipv4(url) : json(fixture("rdap-ip.json"));
      if (u.host === "cloudflare-dns.com") {
        const name = u.searchParams.get("name")!;
        const type = u.searchParams.get("type")!;
        const entry = zone[`${name}|${type}`] ?? zone["*"];
        if (entry === "servfail") return json({ Status: 2 }, 200, "application/dns-json");
        if (entry === "nxdomain") return json({ Status: 3 }, 200, "application/dns-json");
        return dohAnswer(entry ?? []);
      }
      throw new Error(`unexpected request to ${url}`);
    },
  };
  return net;
}

/** A healthy small-business zone for example.pl. */
export function healthyZone(d = "example.pl"): Zone {
  return {
    [`${d}|A`]: [q("A", "203.0.114.10")],
    [`${d}|AAAA`]: [q("AAAA", "2a01:4f8::1")],
    [`www.${d}|A`]: [{ type: 5, data: `${d}.` }, q("A", "203.0.114.10")],
    [`${d}|NS`]: [q("NS", "ns1.cloudflare.com."), q("NS", "ns2.cloudflare.com.")],
    [`${d}|MX`]: [q("MX", "10 aspmx.l.google.com."), q("MX", "20 alt1.aspmx.l.google.com.")],
    [`${d}|TXT`]: [q("TXT", "v=spf1 include:_spf.google.com -all")],
    [`${d}|CAA`]: [q("CAA", "0 issue \"letsencrypt.org\"")],
    [`${d}|SOA`]: [q("SOA", "ns1.cloudflare.com. dns.cloudflare.com. 1 2 3 4 5")],
    "_spf.google.com|TXT": [q("TXT", "v=spf1 ip4:1.2.3.0/24 -all")],
    [`_dmarc.${d}|TXT`]: [q("TXT", "v=DMARC1; p=reject; rua=mailto:r@example.pl")],
    [`_mta-sts.${d}|TXT`]: [q("TXT", "v=STSv1; id=1")],
    [`_smtp._tls.${d}|TXT`]: [q("TXT", "v=TLSRPTv1; rua=mailto:t@example.pl")],
    [`google._domainkey.${d}|TXT`]: [q("TXT", "v=DKIM1; k=rsa; p=AAAA")],
  };
}

export function deps(net: FakeNet, over: Partial<LookupDeps> = {}): LookupDeps {
  return { fetch: net.fetch, cache: new MemoryCache(), inflight: new Map(), now: () => NOW, sleep: async () => {}, ...over };
}
