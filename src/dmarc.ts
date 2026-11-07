// DMARC record parsing (RFC 7489). Only counts are kept for report addresses, never the addresses themselves.

export type DmarcPolicy = "none" | "quarantine" | "reject";

export interface DmarcRecord {
  valid: boolean;
  policy: DmarcPolicy | null;
  subdomainPolicy: DmarcPolicy | null;
  /** Percentage of mail the policy applies to. 100 when the tag is absent. */
  pct: number;
  /** Number of aggregate-report (rua) destinations. */
  ruaCount: number;
}

export function isDmarcRecord(txt: string): boolean {
  return /^v=DMARC1\s*(;|$)/i.test(txt.trim());
}

const POLICIES = new Set(["none", "quarantine", "reject"]);

export function parseDmarc(record: string): DmarcRecord {
  const out: DmarcRecord = { valid: false, policy: null, subdomainPolicy: null, pct: 100, ruaCount: 0 };
  const tags = new Map<string, string>();
  for (const part of record.split(";")) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    const k = part.slice(0, i).trim().toLowerCase();
    if (k && !tags.has(k)) tags.set(k, part.slice(i + 1).trim());
  }
  const p = tags.get("p")?.toLowerCase();
  if (p && POLICIES.has(p)) out.policy = p as DmarcPolicy;
  const sp = tags.get("sp")?.toLowerCase();
  if (sp && POLICIES.has(sp)) out.subdomainPolicy = sp as DmarcPolicy;
  const pct = tags.get("pct");
  if (pct !== undefined) {
    const n = Number(pct);
    if (Number.isInteger(n) && n >= 0 && n <= 100) out.pct = n;
  }
  const rua = tags.get("rua");
  if (rua) out.ruaCount = rua.split(",").map((s) => s.trim()).filter((s) => /^mailto:.+@.+/i.test(s)).length;
  out.valid = isDmarcRecord(record) && out.policy !== null;
  return out;
}
