// Orchestration of one lookup: registration (RDAP), DNS (DoH), hosting network (RDAP IP) and mail setup.
// Order: the registry query, the core DNS queries and the mail queries run together; SPF includes and
// the IP network queries follow because they depend on the first answers.
import { analyzeDns, analyzeHosting, analyzeMail, analyzeRegistration, DKIM_SELECTORS, pickTop } from "./analyze";
import { MemoryCache, type JsonCache } from "./cache";
import { parseDohResponse, recordsOf, type DnsAnswer, type DnsTypeName } from "./dns";
import { type ParsedDomain } from "./domain";
import { classifyIp, parseIp } from "./ip";
import { Net, DEFAULT_NET_OPTIONS, type FetchLike, type NetOptions } from "./net";
import { detectProviders } from "./providers";
import { assessExpiry } from "./rdap";
import type { ProxyConfig } from "./proxy";
import { registryInfoUrl } from "./registryinfo";
import { lookupDomain, lookupIpNetwork, type DomainOutcome, type RegistryContext } from "./registry";
import { evaluateSpf, isSpfRecord, type SpfFetch } from "./spf";
import type { DnsGroup, DnsRecordView, Finding, HostingAddress, LookupResult, RegistrationInfo } from "./types";

export const DOH_URL = "https://cloudflare-dns.com/dns-query";
const MAX_ADDRESSES = 8;
const MAX_IP_QUERIES = 2;
const MAX_VIEW_RECORDS = 30;
const MAX_VIEW_CHARS = 1000;

export interface LookupDeps {
  fetch: FetchLike;
  cache?: JsonCache;
  inflight?: Map<string, Promise<DomainOutcome>>;
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  options?: NetOptions;
  /** Optional proxy for the .pl registry (see src/proxy.ts). */
  proxy?: ProxyConfig | null;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const sharedInflight = new Map<string, Promise<DomainOutcome>>();

async function doh(net: Net, name: string, type: DnsTypeName): Promise<DnsAnswer> {
  const res = await net.getJson(`${DOH_URL}?name=${encodeURIComponent(name)}&type=${type}`, "application/dns-json");
  if (res.kind !== "response" || res.status !== 200) return { state: "failed" };
  return parseDohResponse(res.body);
}

function toView(answer: DnsAnswer, types: DnsTypeName[]): DnsRecordView[] {
  if (answer.state !== "ok") return [];
  return answer.records
    .filter((r) => types.includes(r.type))
    .slice(0, MAX_VIEW_RECORDS)
    .map((r) => ({ type: r.type, name: r.name, ttl: r.ttl, data: r.data.slice(0, MAX_VIEW_CHARS) }));
}

function registrationInfo(outcome: DomainOutcome, now: Date, domain: string): RegistrationInfo {
  const empty: RegistrationInfo = {
    state: "unavailable", registry: null, registrar: null, registrant: null, registered: null, expires: null, changed: null,
    daysToExpiry: null, expiryLevel: "unknown", statuses: [], nameservers: [], dnssec: "unknown", delayed: false, registryUrl: null, via: null, cached: false,
  };
  switch (outcome.kind) {
    case "found": {
      const d = outcome.data;
      const e = assessExpiry(d.expires, now);
      return {
        ...empty, state: "registered", registry: outcome.registry, registrar: d.registrar, registrant: d.registrant, registered: d.registered,
        expires: d.expires, changed: d.changed, daysToExpiry: e.days, expiryLevel: e.level, statuses: d.statuses,
        nameservers: d.nameservers, dnssec: d.dnssec, delayed: d.delayed, via: outcome.via ?? null, cached: outcome.cached === true,
      };
    }
    case "available": return { ...empty, state: "available", registry: outcome.registry, via: outcome.via ?? null, cached: outcome.cached === true };
    case "unsupported": return { ...empty, state: "unsupported", registryUrl: registryInfoUrl(domain) };
    case "rate_limited": return { ...empty, state: "rate_limited", registry: outcome.registry, registryUrl: registryInfoUrl(domain), via: outcome.via ?? null, cached: outcome.cached === true };
    case "error": return { ...empty, state: "unavailable", registry: outcome.registry };
  }
}

export async function runLookup(parsed: Extract<ParsedDomain, { ok: true }>, deps: LookupDeps): Promise<LookupResult> {
  const now = deps.now ?? (() => new Date());
  const net = new Net(deps.fetch, deps.options ?? DEFAULT_NET_OPTIONS);
  const ctx: RegistryContext = {
    net,
    cache: deps.cache ?? new MemoryCache(),
    inflight: deps.inflight ?? sharedInflight,
    sleep: deps.sleep ?? defaultSleep,
    proxy: deps.proxy ?? null,
  };
  const d = parsed.domain;
  const q = (name: string, type: DnsTypeName) => doh(net, name, type);

  // Phase 1: everything that does not depend on anything else.
  const regPromise = lookupDomain(d, ctx);
  const corePromise = Promise.all([
    q(d, "A"), q(d, "AAAA"), q(d, "NS"), q(d, "MX"), q(d, "TXT"), q(d, "CAA"), q(d, "SOA"), q(`www.${d}`, "A"), q(`www.${d}`, "AAAA"),
  ]);
  const mailPromise = Promise.all([
    q(`_dmarc.${d}`, "TXT"), q(`_mta-sts.${d}`, "TXT"), q(`_smtp._tls.${d}`, "TXT"),
    Promise.all(DKIM_SELECTORS.map(async (selector) => ({ selector, answer: await q(`${selector}._domainkey.${d}`, "TXT") }))),
  ]);
  const [regOutcome, [aA, aAAAA, ns, mx, txt, caa, soa, wA, wAAAA], [dmarcA, mtaStsA, tlsRptA, dkim]] = await Promise.all([regPromise, corePromise, mailPromise]);

  const registration = registrationInfo(regOutcome, now(), d);

  const groups: DnsGroup[] = [];
  const push = (host: "apex" | "www", type: DnsTypeName, a: DnsAnswer, types: DnsTypeName[] = [type]) =>
    groups.push({ host, type, state: a.state === "ok" ? "ok" : "failed", records: toView(a, types) });
  push("apex", "A", aA, ["A", "CNAME"]);
  push("apex", "AAAA", aAAAA, ["AAAA", "CNAME"]);
  push("www", "A", wA, ["A", "CNAME"]);
  push("www", "AAAA", wAAAA, ["AAAA", "CNAME"]);
  push("apex", "NS", ns);
  push("apex", "MX", mx);
  push("apex", "TXT", txt);
  push("apex", "CAA", caa);
  push("apex", "SOA", soa);

  // Phase 2: SPF includes and IP networks. They run together and share what is left of the request budget.
  const spfRecords = recordsOf(txt, "TXT").map((r) => r.data).filter(isSpfRecord);
  const fetchSpf = async (name: string): Promise<SpfFetch> => {
    const a = await q(name, "TXT");
    if (a.state === "failed") return { state: "failed" };
    return { state: "ok", records: recordsOf(a, "TXT").map((r) => r.data).filter(isSpfRecord) };
  };
  const spfPromise = txt.state === "ok" && spfRecords.length === 1
    ? evaluateSpf(d, spfRecords[0]!, fetchSpf, { deadlineMs: Math.max(1000, net.remainingMs() - 1500) })
    : Promise.resolve(null);

  const addressPromise = (async (): Promise<HostingAddress[]> => {
    // The bare domain decides. When it has no address, the www name (often a CNAME) is used instead.
    const fromApex = [...recordsOf(aA, "A"), ...recordsOf(aAAAA, "AAAA")];
    const source = fromApex.length > 0 ? fromApex : [...recordsOf(wA, "A"), ...recordsOf(wAAAA, "AAAA")];
    const seen = new Set<string>();
    const list: HostingAddress[] = [];
    for (const r of source) {
      const ip = r.data.trim().toLowerCase();
      const parsedIp = parseIp(ip);
      if (!parsedIp || seen.has(ip) || list.length >= MAX_ADDRESSES) continue;
      seen.add(ip);
      const kind = classifyIp(ip) === "public" ? "public" : "non_public";
      list.push({ ip, family: parsedIp.version, kind, network: null, lookup: "skipped", registry: null });
    }
    // At most two public addresses are looked up: the first IPv4 and the first IPv6 if both exist.
    const publicOnes = list.filter((a) => a.kind === "public");
    const chosen = [publicOnes.find((a) => a.family === 4), publicOnes.find((a) => a.family === 6)].filter((a): a is HostingAddress => !!a);
    for (const a of publicOnes) if (chosen.length < MAX_IP_QUERIES && !chosen.includes(a)) chosen.push(a);
    await Promise.all(chosen.map(async (a) => {
      const r = await lookupIpNetwork(a.ip, ctx);
      a.registry = r.registry;
      a.network = r.network;
      a.lookup = r.network ? "ok" : "unknown";
    }));
    return list;
  })();

  const [spfEvaluation, hosting] = await Promise.all([spfPromise, addressPromise]);

  const mailResult = analyzeMail({ mx, txt, dmarc: dmarcA, mtaSts: mtaStsA, tlsRpt: tlsRptA, dkim, spfEvaluation });
  const notRegistered = registration.state === "available";
  const mxHosts = mailResult.mail.mx.map((m) => m.host).filter(Boolean);
  const nsHosts = recordsOf(ns, "NS").map((r) => r.data);
  const providers = notRegistered ? [] : [...detectProviders("mail", mxHosts), ...detectProviders("dns", nsHosts)];

  // A free domain gets no DNS or mail verdicts: whatever DNS shows would not describe a working setup.
  const findings: Finding[] = notRegistered
    ? []
    : [
        ...analyzeRegistration(registration),
        ...mailResult.findings,
        ...analyzeDns(groups),
        ...analyzeHosting(hosting),
      ];
  if (notRegistered) mailResult.mail.rating = "nomail";

  const dnsAvailable = [aA, ns, soa, mx, txt].some((a) => a.state === "ok");
  const incomplete =
    net.budgetHit || net.deadlineHit || [aA, aAAAA, ns, mx, txt, caa, soa].some((a) => a.state === "failed") || (spfEvaluation !== null && !spfEvaluation.complete);

  return {
    domain: d,
    unicode: parsed.unicode,
    submittedHost: parsed.submittedHost,
    checkedAt: now().toISOString(),
    registration,
    dns: groups,
    dnsAvailable,
    hosting,
    providers,
    mail: mailResult.mail,
    findings,
    top: pickTop(findings),
    coverage: { requests: net.used, budget: net.options.maxRequests, incomplete },
  };
}

