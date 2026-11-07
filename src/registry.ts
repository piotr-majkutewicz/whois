// RDAP clients: IANA bootstrap, domain registration data and IP network data.
// All of them go through Net (budget, timeouts) and tolerate failure: a problem becomes an outcome, not an exception.
import type { JsonCache } from "./cache";
import type { Net } from "./net";
import {
  findDomainService, findIpService, parseBootstrap, parseDomainRdap, parseIpNetwork,
  type BootstrapFile, type DomainRdap, type IpNetwork,
} from "./rdap";
import { tldOf } from "./domain";
import { parseIp } from "./ip";

export const BOOTSTRAP_URLS = {
  dns: "https://data.iana.org/rdap/dns.json",
  ipv4: "https://data.iana.org/rdap/ipv4.json",
  ipv6: "https://data.iana.org/rdap/ipv6.json",
} as const;

const RDAP_ACCEPT = "application/rdap+json, application/json;q=0.9";
const BOOTSTRAP_TTL = 3600;
const FOUND_TTL = 600; // registrations and "not found" answers are kept for ten minutes
const RATE_LIMITED_TTL = 30; // after a 429 we leave the registry alone for a moment
const IP_TTL = 3600;
const RETRY_DELAY_MS = 600;

export interface RegistryContext {
  net: Net;
  cache: JsonCache;
  /** Parallel lookups of the same domain in one isolate share one registry query. */
  inflight: Map<string, Promise<DomainOutcome>>;
  sleep: (ms: number) => Promise<void>;
}

export type DomainOutcome =
  | { kind: "found"; registry: string; data: DomainRdap; cached?: boolean }
  | { kind: "available"; registry: string; cached?: boolean }
  | { kind: "unsupported" }
  | { kind: "rate_limited"; registry: string; cached?: boolean }
  | { kind: "error"; registry: string | null };

async function bootstrap(kind: keyof typeof BOOTSTRAP_URLS, ctx: RegistryContext): Promise<BootstrapFile | null> {
  const key = `bootstrap:${kind}`;
  const hit = await ctx.cache.get<BootstrapFile>(key);
  if (hit) return hit;
  const res = await ctx.net.getJson(BOOTSTRAP_URLS[kind], "application/json");
  if (res.kind !== "response" || res.status !== 200) return null;
  const file = parseBootstrap(res.body);
  if (!file || file.services.length === 0) return null;
  await ctx.cache.put(key, file, BOOTSTRAP_TTL);
  return file;
}

function hostOf(base: string): string {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
}

async function fetchDomain(domain: string, ctx: RegistryContext): Promise<DomainOutcome> {
  const file = await bootstrap("dns", ctx);
  if (!file) return { kind: "error", registry: null };
  const base = findDomainService(file, tldOf(domain));
  if (!base) return { kind: "unsupported" };
  const registry = hostOf(base);
  const url = `${base}domain/${encodeURIComponent(domain)}`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await ctx.net.getJson(url, RDAP_ACCEPT);
    let retryable = false;
    let rateLimited = false;
    if (res.kind === "error") {
      retryable = res.reason === "timeout" || res.reason === "network";
    } else if (res.status === 200) {
      const data = parseDomainRdap(res.body);
      return data ? { kind: "found", registry, data } : { kind: "error", registry };
    } else if (res.status === 404) {
      // A real "not found" is a JSON answer. An HTML 404 from a proxy or a misrouted server proves nothing.
      return /json/i.test(res.contentType) ? { kind: "available", registry } : { kind: "error", registry };
    } else if (res.status === 429) {
      retryable = true;
      rateLimited = true;
    } else if (res.status >= 500) {
      retryable = true;
    }
    if (!retryable) return { kind: "error", registry };
    if (attempt === 2) return rateLimited ? { kind: "rate_limited", registry } : { kind: "error", registry };
    // One retry after a short pause. A Retry-After of up to two seconds is respected.
    const wait = res.kind === "response" && res.retryAfterSec !== null && res.retryAfterSec > 0 ? Math.min(res.retryAfterSec, 2) * 1000 : RETRY_DELAY_MS;
    if (ctx.net.remainingMs() < wait + 500) return rateLimited ? { kind: "rate_limited", registry } : { kind: "error", registry };
    await ctx.sleep(wait);
  }
  return { kind: "error", registry };
}

/** Cached, de-duplicated registration lookup. */
export async function lookupDomain(domain: string, ctx: RegistryContext): Promise<DomainOutcome> {
  const key = `rdap:${domain}`;
  const cached = await ctx.cache.get<DomainOutcome>(key);
  if (cached) return { ...cached, cached: true } as DomainOutcome;
  const running = ctx.inflight.get(domain);
  if (running) return running;
  const promise = (async () => {
    const outcome = await fetchDomain(domain, ctx);
    if (outcome.kind === "found" || outcome.kind === "available") await ctx.cache.put(key, outcome, FOUND_TTL);
    else if (outcome.kind === "rate_limited") await ctx.cache.put(key, outcome, RATE_LIMITED_TTL);
    return outcome;
  })().finally(() => ctx.inflight.delete(domain));
  ctx.inflight.set(domain, promise);
  return promise;
}

export interface IpOutcome {
  network: IpNetwork | null;
  registry: string | null;
}

/** Network that an address belongs to, from the regional internet registry. Null network = unknown. */
export async function lookupIpNetwork(ip: string, ctx: RegistryContext): Promise<IpOutcome> {
  const parsed = parseIp(ip);
  if (!parsed) return { network: null, registry: null };
  const key = `ip:${ip}`;
  const cached = await ctx.cache.get<IpOutcome>(key);
  if (cached) return cached;
  const file = await bootstrap(parsed.version === 4 ? "ipv4" : "ipv6", ctx);
  if (!file) return { network: null, registry: null };
  const base = findIpService(file, ip);
  if (!base) return { network: null, registry: null };
  const registry = hostOf(base);
  const res = await ctx.net.getJson(`${base}ip/${encodeURIComponent(ip)}`, RDAP_ACCEPT);
  if (res.kind !== "response" || res.status !== 200) return { network: null, registry };
  const network = parseIpNetwork(res.body);
  const out = { network, registry };
  if (network) await ctx.cache.put(key, out, IP_TTL);
  return out;
}
