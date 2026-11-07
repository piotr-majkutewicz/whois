// RDAP: pure parsing of registry answers. No network access here.
// Personal data is never copied out of an answer: only a fixed set of fields is read.
import { inCidr, parseIp } from "./ip";

export const STATUS_IDS = [
  "ok",
  "inactive",
  "transfer_lock",
  "update_lock",
  "delete_lock",
  "renew_lock",
  "hold",
  "pending_delete",
  "redemption",
  "pending_create",
  "pending_transfer",
  "pending_update",
  "pending_renew",
  "grace_period",
  "other",
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export interface DomainStatus {
  /** The code exactly as the registry sent it (shown as is, it is not personal data). */
  raw: string;
  id: StatusId;
}

/** Normalises "clientTransferProhibited", "client transfer prohibited" and "client_transfer_prohibited". */
function normaliseStatus(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function mapStatus(raw: string): StatusId {
  const s = normaliseStatus(raw);
  const stripped = s.replace(/^(client|server) /, "");
  if (stripped === "transfer prohibited") return "transfer_lock";
  if (stripped === "update prohibited") return "update_lock";
  if (stripped === "delete prohibited") return "delete_lock";
  if (stripped === "renew prohibited") return "renew_lock";
  if (stripped === "hold") return "hold";
  if (s === "ok" || s === "active" || s === "registered") return "ok";
  if (s === "inactive") return "inactive";
  if (s === "pending delete") return "pending_delete";
  if (s === "redemption period" || s === "pending restore" || s === "redemption") return "redemption";
  if (s === "pending create") return "pending_create";
  if (s === "pending transfer") return "pending_transfer";
  if (s === "pending update") return "pending_update";
  if (s === "pending renew") return "pending_renew";
  if (["add period", "renew period", "auto renew period", "transfer period"].includes(s)) return "grace_period";
  return "other";
}

export function mapStatuses(raw: unknown): DomainStatus[] {
  if (!Array.isArray(raw)) return [];
  const out: DomainStatus[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (typeof r !== "string" || r.length > 80) continue;
    const id = mapStatus(r);
    // Equivalent codes (client and server variants of one lock) are shown once.
    const key = id === "other" ? `other:${r}` : id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ raw: r, id });
  }
  return out;
}

export type ExpiryLevel = "expired" | "high" | "medium" | "ok" | "unknown";

export interface Expiry {
  /** Whole days from `now` to the expiry date. Negative when the domain already expired. */
  days: number | null;
  level: ExpiryLevel;
}

const DAY_MS = 86_400_000;

export function assessExpiry(expires: string | null, now: Date): Expiry {
  if (!expires) return { days: null, level: "unknown" };
  const t = Date.parse(expires);
  if (Number.isNaN(t)) return { days: null, level: "unknown" };
  // After expiry the days are rounded away from zero, so "expired 12 hours ago" reads as one day, not zero.
  if (t <= now.getTime()) return { days: -Math.ceil((now.getTime() - t) / DAY_MS), level: "expired" };
  const days = Math.floor((t - now.getTime()) / DAY_MS);
  if (days < 7) return { days, level: "high" };
  if (days < 30) return { days, level: "medium" };
  return { days, level: "ok" };
}

export type DnssecState = "signed" | "unsigned" | "unknown";

export interface DomainRdap {
  registrar: string | null;
  registered: string | null;
  expires: string | null;
  changed: string | null;
  statuses: DomainStatus[];
  nameservers: string[];
  dnssec: DnssecState;
  /** True when the registry says the data may be shown with a delay (for example NASK: up to 15 minutes). */
  delayed: boolean;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads one vCard property value, for example "fn". */
function vcardValue(entity: Json, prop: string): string | null {
  const arr = entity.vcardArray;
  if (!Array.isArray(arr) || !Array.isArray(arr[1])) return null;
  for (const item of arr[1] as unknown[]) {
    if (Array.isArray(item) && item[0] === prop && typeof item[3] === "string") return item[3];
  }
  return null;
}

function rolesOf(entity: Json): string[] {
  return Array.isArray(entity.roles) ? entity.roles.filter((r): r is string => typeof r === "string") : [];
}

/**
 * Name of the registrar. Only an entity with the "registrar" role is read, and only its formatted name.
 * Registrant, administrative and technical contacts are never looked at. A registrar that is marked as an
 * individual is dropped too, as a precaution.
 */
function registrarName(entities: unknown): string | null {
  if (!Array.isArray(entities)) return null;
  for (const e of entities) {
    if (!isObj(e) || !rolesOf(e).includes("registrar")) continue;
    const kind = vcardValue(e, "kind");
    if (kind && kind.toLowerCase() === "individual") return null;
    const fn = vcardValue(e, "fn")?.trim();
    if (fn) return fn.slice(0, 120);
  }
  return null;
}

function eventDate(events: unknown, action: string): string | null {
  if (!Array.isArray(events)) return null;
  for (const e of events) {
    if (isObj(e) && e.eventAction === action && typeof e.eventDate === "string" && !Number.isNaN(Date.parse(e.eventDate))) {
      return new Date(e.eventDate).toISOString();
    }
  }
  return null;
}

export function parseDomainRdap(body: unknown): DomainRdap | null {
  if (!isObj(body) || body.objectClassName !== "domain") return null;
  const nameservers: string[] = [];
  if (Array.isArray(body.nameservers)) {
    for (const ns of body.nameservers) {
      if (isObj(ns) && typeof ns.ldhName === "string" && ns.ldhName) nameservers.push(ns.ldhName.toLowerCase().replace(/\.$/, ""));
    }
  }
  let dnssec: DnssecState = "unknown";
  if (isObj(body.secureDNS) && typeof body.secureDNS.delegationSigned === "boolean") {
    dnssec = body.secureDNS.delegationSigned ? "signed" : "unsigned";
  }
  const delayed = Array.isArray(body.notices)
    ? body.notices.some((n) => isObj(n) && /delay/i.test(String(n.title ?? "")))
    : false;
  return {
    registrar: registrarName(body.entities),
    registered: eventDate(body.events, "registration"),
    expires: eventDate(body.events, "expiration"),
    changed: eventDate(body.events, "last changed"),
    statuses: mapStatuses(body.status ?? (typeof body.nask0_state === "string" ? [body.nask0_state] : [])),
    nameservers: [...new Set(nameservers)].sort(),
    dnssec,
    delayed,
  };
}

// ---- IANA bootstrap ----

export interface BootstrapFile {
  services: [string[], string[]][];
}

export function parseBootstrap(body: unknown): BootstrapFile | null {
  if (!isObj(body) || !Array.isArray(body.services)) return null;
  const services: [string[], string[]][] = [];
  for (const s of body.services) {
    if (!Array.isArray(s) || !Array.isArray(s[0]) || !Array.isArray(s[1])) continue;
    const keys = s[0].filter((x): x is string => typeof x === "string");
    const urls = s[1].filter((x): x is string => typeof x === "string");
    services.push([keys, urls]);
  }
  return { services };
}

/** Only HTTPS endpoints are used. The base URL always ends with a slash. */
function httpsBase(urls: string[]): string | null {
  const u = urls.find((x) => x.startsWith("https://"));
  if (!u) return null;
  return u.endsWith("/") ? u : u + "/";
}

export function findDomainService(file: BootstrapFile, tld: string): string | null {
  const t = tld.toLowerCase();
  for (const [keys, urls] of file.services) {
    if (keys.some((k) => k.toLowerCase() === t)) return httpsBase(urls);
  }
  return null;
}

/** The most specific (longest prefix) block that contains the address. */
export function findIpService(file: BootstrapFile, ip: string): string | null {
  const parsed = parseIp(ip);
  if (!parsed) return null;
  let best: { len: number; base: string } | null = null;
  for (const [cidrs, urls] of file.services) {
    for (const c of cidrs) {
      if (!inCidr(parsed, c)) continue;
      const len = Number(c.slice(c.indexOf("/") + 1));
      const base = httpsBase(urls);
      if (base && (!best || len > best.len)) best = { len, base };
    }
  }
  return best?.base ?? null;
}

// ---- IP network ----

export interface IpNetwork {
  /** Network name from the registry, for example "CLOUDFLARENET". */
  name: string | null;
  /** Organisation name, when the registry publishes one for the network (only organisations, never people). */
  organisation: string | null;
  country: string | null;
  cidr: string | null;
}

export function parseIpNetwork(body: unknown): IpNetwork | null {
  if (!isObj(body) || body.objectClassName !== "ip network") return null;
  let org: string | null = null;
  if (Array.isArray(body.entities)) {
    for (const e of body.entities) {
      if (!isObj(e) || !rolesOf(e).includes("registrant")) continue;
      // Only organisations. Person objects (kind "individual") are skipped.
      if (vcardValue(e, "kind")?.toLowerCase() !== "org") continue;
      const fn = vcardValue(e, "fn")?.trim();
      if (fn) {
        org = fn.slice(0, 120);
        break;
      }
    }
  }
  let cidr: string | null = null;
  const c0 = Array.isArray(body.cidr0_cidrs) ? body.cidr0_cidrs[0] : null;
  if (isObj(c0) && typeof c0.length === "number") {
    const prefix = typeof c0.v4prefix === "string" ? c0.v4prefix : typeof c0.v6prefix === "string" ? c0.v6prefix : null;
    if (prefix) cidr = `${prefix}/${c0.length}`;
  }
  const name = typeof body.name === "string" && body.name ? body.name.slice(0, 80) : null;
  const country = typeof body.country === "string" && /^[A-Za-z]{2}$/.test(body.country) ? body.country.toUpperCase() : null;
  if (!name && !org) return null;
  return { name, organisation: org, country, cidr };
}
