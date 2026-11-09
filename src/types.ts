// Language-neutral result of a lookup. It holds identifiers, parameters and raw values only.
// Texts are produced from the dictionaries (src/i18n), in the browser or on request for API users.
import type { DnsTypeName } from "./dns";
import type { DnssecState, ExpiryLevel, IpNetwork, StatusId } from "./rdap";
import type { ProviderMatch } from "./providers";
import type { SpfQualifier } from "./spf";
import type { DmarcPolicy } from "./dmarc";

export type Severity = "high" | "medium" | "low";
export type Section = "registration" | "dns" | "hosting" | "mail";
export const SECTIONS: readonly Section[] = ["registration", "dns", "hosting", "mail"];

/** Where a piece of information comes from. The dictionaries explain each id. */
export type SourceId = "rdap_domain" | "rdap_ip" | "doh" | "derived";

export interface Finding {
  /** Stable id, also the key of the texts in the dictionaries. */
  key: string;
  section: Section;
  severity: Severity;
  source: SourceId;
  /** Values for the {placeholders} of the texts. */
  params: Record<string, string | number>;
}

export type RegistrationState =
  | "registered" // the registry returned data
  | "available" // the registry answered "not found"
  | "unsupported" // no RDAP service for this ending
  | "rate_limited" // the registry answered 429 twice
  | "unavailable"; // timeout, server error or an answer we could not read

export interface RegistrationInfo {
  state: RegistrationState;
  /** Registry host (for example "rdap.dns.pl"), used in the "how we know" line. */
  registry: string | null;
  registrar: string | null;
  registrant: { name: string; country: string | null } | null;
  registered: string | null;
  expires: string | null;
  changed: string | null;
  daysToExpiry: number | null;
  expiryLevel: ExpiryLevel;
  statuses: { raw: string; id: StatusId }[];
  nameservers: string[];
  dnssec: DnssecState;
  /** The registry says its data may be a few minutes old. */
  delayed: boolean;
  /** Official information about the registry of this ending (IANA page). Only set when the registry could not answer. */
  registryUrl: string | null;
  /** "proxy" when the registry was asked through the optional intermediary. */
  via: "proxy" | null;
  /** True when this answer came from our cache. */
  cached: boolean;
}

export interface DnsRecordView {
  type: DnsTypeName;
  name: string;
  ttl: number;
  data: string;
}

/** One group of records: the name that was asked, the type, and what came back. */
export interface DnsGroup {
  host: "apex" | "www";
  type: DnsTypeName;
  /** "ok" with zero records means the name has no record of this type. "failed" means we do not know. */
  state: "ok" | "failed";
  records: DnsRecordView[];
}

export interface HostingAddress {
  ip: string;
  family: 4 | 6;
  /** "public" addresses are looked up; others are listed and not queried. */
  kind: "public" | "non_public";
  network: IpNetwork | null;
  /** "ok" network found, "unknown" lookup failed or no registry data, "skipped" not queried (non-public or budget). */
  lookup: "ok" | "unknown" | "skipped";
  /** RIR host that answered. */
  registry: string | null;
}

export interface SpfInfo {
  state: "none" | "one" | "multiple" | "unknown";
  record: string | null;
  terminal: SpfQualifier | null;
  lookups: number;
  complete: boolean;
  exceeded: boolean;
  syntaxError: boolean;
  cycle: boolean;
}

export interface DmarcInfo {
  state: "none" | "one" | "multiple" | "unknown";
  valid: boolean;
  policy: DmarcPolicy | null;
  pct: number;
  ruaCount: number;
}

export interface DkimInfo {
  tried: string[];
  found: { selector: string; kind: "txt" | "cname" }[];
  /** Number of selector queries that failed (so "not found" may be incomplete). */
  failed: number;
}

export type MailRating = "good" | "improve" | "risk" | "nomail" | "unknown";

export interface MailInfo {
  mx: { priority: number; host: string }[];
  mxState: "ok" | "failed";
  nullMx: boolean;
  spf: SpfInfo;
  dmarc: DmarcInfo;
  dkim: DkimInfo;
  mtaSts: "present" | "absent" | "unknown";
  tlsRpt: "present" | "absent" | "unknown";
  rating: MailRating;
}

export interface LookupResult {
  /** The domain that was checked (ASCII form) and its readable form. */
  domain: string;
  unicode: string;
  /** What the visitor typed, reduced to a host. Differs from `domain` for www.example.pl. */
  submittedHost: string;
  checkedAt: string;
  registration: RegistrationInfo;
  dns: DnsGroup[];
  /** DNS check status: false when the resolver could not answer the main queries. */
  dnsAvailable: boolean;
  hosting: HostingAddress[];
  providers: ProviderMatch[];
  mail: MailInfo;
  findings: Finding[];
  /** Indexes into `findings`: the most important ones, at most three. */
  top: number[];
  /** Counters that show how much work the lookup did. */
  coverage: { requests: number; budget: number; incomplete: boolean };
}
