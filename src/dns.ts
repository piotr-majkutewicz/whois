// DNS-over-HTTPS (Cloudflare JSON API): parsing of answers. The network call itself lives in lookup.ts.

export const DNS_TYPE_CODES = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, CAA: 257 } as const;
export type DnsTypeName = keyof typeof DNS_TYPE_CODES;
const CODE_TO_NAME = new Map<number, DnsTypeName>(Object.entries(DNS_TYPE_CODES).map(([k, v]) => [v, k as DnsTypeName]));

export interface DnsRecord {
  type: DnsTypeName;
  /** The record name as returned (lowercase, no trailing dot). */
  name: string;
  ttl: number;
  /** Parsed value, see `describeRecord`. For TXT the quoted chunks are joined. */
  data: string;
}

export type DnsAnswer =
  | { state: "ok"; rcode: number; records: DnsRecord[]; authenticated: boolean }
  | { state: "failed" };

export const RCODE_NXDOMAIN = 3;

export function trimDot(s: string): string {
  return s.endsWith(".") ? s.slice(0, -1) : s;
}

/** Joins the quoted chunks of a TXT answer: "\"abc\" \"def\"" -> "abcdef". */
export function parseTxtData(data: string): string {
  const chunks: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(data)) !== null) chunks.push(m[1]!.replace(/\\(.)/g, "$1"));
  // Not quoted at all (some resolvers): use the text as it is.
  return chunks.length > 0 ? chunks.join("") : data;
}

/** Turns the Cloudflare JSON body into a DnsAnswer. Anything that does not look like DNS JSON is "failed". */
export function parseDohResponse(body: unknown): DnsAnswer {
  if (typeof body !== "object" || body === null) return { state: "failed" };
  const b = body as { Status?: unknown; AD?: unknown; Answer?: unknown };
  if (typeof b.Status !== "number") return { state: "failed" };
  // SERVFAIL (2) and REFUSED (5) mean the resolver could not answer. That is not "the record does not exist".
  if (b.Status !== 0 && b.Status !== RCODE_NXDOMAIN) return { state: "failed" };
  const records: DnsRecord[] = [];
  if (Array.isArray(b.Answer)) {
    for (const raw of b.Answer) {
      if (typeof raw !== "object" || raw === null) continue;
      const a = raw as { name?: unknown; type?: unknown; TTL?: unknown; data?: unknown };
      if (typeof a.name !== "string" || typeof a.type !== "number" || typeof a.data !== "string") continue;
      const type = CODE_TO_NAME.get(a.type);
      if (!type) continue;
      let data = a.data;
      if (type === "TXT") data = parseTxtData(data);
      else if (type === "NS" || type === "CNAME") data = trimDot(data).toLowerCase();
      else if (type === "MX") {
        const [prio, host] = data.split(/\s+/);
        data = `${prio} ${trimDot(host ?? "").toLowerCase()}`;
      }
      records.push({ type, name: trimDot(a.name).toLowerCase(), ttl: typeof a.TTL === "number" ? a.TTL : 0, data });
    }
  }
  return { state: "ok", rcode: b.Status, records, authenticated: b.AD === true };
}

/** Records of one type that answer the queried name (CNAME chains are followed by the resolver). */
export function recordsOf(answer: DnsAnswer, type: DnsTypeName): DnsRecord[] {
  return answer.state === "ok" ? answer.records.filter((r) => r.type === type) : [];
}

export interface MxEntry {
  priority: number;
  host: string;
}

export function parseMx(records: DnsRecord[]): MxEntry[] {
  return records
    .map((r) => {
      const [p, h] = r.data.split(" ");
      return { priority: Number(p), host: h ?? "" };
    })
    .filter((m) => Number.isFinite(m.priority))
    .sort((a, b) => a.priority - b.priority || a.host.localeCompare(b.host));
}

/** A "null MX" (RFC 7505) says the domain does not receive mail at all. */
export function isNullMx(mx: MxEntry[]): boolean {
  return mx.length === 1 && (mx[0]!.host === "" || mx[0]!.host === ".");
}
