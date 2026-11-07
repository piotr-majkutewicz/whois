// Turns collected DNS and registry data into findings and ratings. Pure functions.
import { isNullMx, parseMx, recordsOf, type DnsAnswer } from "./dns";
import { isDmarcRecord, parseDmarc } from "./dmarc";
import type { SpfEvaluation } from "./spf";
import { isSpfRecord, parseSpf } from "./spf";
import type {
  DkimInfo, DmarcInfo, DnsGroup, Finding, HostingAddress, MailInfo, MailRating, RegistrationInfo, Severity, SourceId, SpfInfo,
} from "./types";

type Params = Record<string, string | number>;
const f = (key: string, section: Finding["section"], severity: Severity, source: SourceId, params: Params = {}): Finding => ({
  key, section, severity, source, params,
});

export const DKIM_SELECTORS = ["google", "default", "selector1", "selector2", "k1", "dkim", "mail"] as const;

// ---- registration ----

export function analyzeRegistration(r: RegistrationInfo): Finding[] {
  if (r.state !== "registered") return [];
  const out: Finding[] = [];
  if (r.expiryLevel === "expired") out.push(f("reg.expired", "registration", "high", "rdap_domain", { days: Math.abs(r.daysToExpiry ?? 0) }));
  else if (r.expiryLevel === "high") out.push(f("reg.expires_soon", "registration", "high", "rdap_domain", { days: r.daysToExpiry ?? 0 }));
  else if (r.expiryLevel === "medium") out.push(f("reg.expires_soon", "registration", "medium", "rdap_domain", { days: r.daysToExpiry ?? 0 }));
  const ids = new Set(r.statuses.map((s) => s.id));
  if (ids.has("pending_delete") || ids.has("redemption")) out.push(f("reg.deleting", "registration", "high", "rdap_domain"));
  if (ids.has("hold")) out.push(f("reg.on_hold", "registration", "high", "rdap_domain"));
  if (r.dnssec === "unsigned") out.push(f("reg.no_dnssec", "registration", "low", "rdap_domain"));
  return out;
}

// ---- DNS and hosting ----

const groupOf = (groups: DnsGroup[], host: "apex" | "www", type: DnsGroup["type"]) => groups.find((g) => g.host === host && g.type === type);
const hasRecords = (g: DnsGroup | undefined) => g !== undefined && g.state === "ok" && g.records.length > 0;
const isEmptyOk = (g: DnsGroup | undefined) => g !== undefined && g.state === "ok" && g.records.length === 0;

export function analyzeDns(groups: DnsGroup[]): Finding[] {
  const out: Finding[] = [];
  const ns = groupOf(groups, "apex", "NS");
  const nsCount = ns?.records.filter((r) => r.type === "NS").length ?? 0;
  if (isEmptyOk(ns)) {
    out.push(f("dns.no_ns", "dns", "high", "doh"));
    return out; // everything else follows from this
  }
  if (ns?.state === "ok" && nsCount === 1) out.push(f("dns.single_ns", "dns", "medium", "doh"));
  const a = groupOf(groups, "apex", "A"), aaaa = groupOf(groups, "apex", "AAAA");
  const apexAddress = hasRecords(a) || hasRecords(aaaa);
  if (isEmptyOk(a) && isEmptyOk(aaaa)) out.push(f("dns.no_address", "dns", "medium", "doh"));
  const wa = groupOf(groups, "www", "A"), waaaa = groupOf(groups, "www", "AAAA");
  if (apexAddress && isEmptyOk(wa) && isEmptyOk(waaaa)) out.push(f("dns.no_www", "dns", "low", "doh"));
  if (isEmptyOk(groupOf(groups, "apex", "CAA"))) out.push(f("dns.no_caa", "dns", "low", "doh"));
  return out;
}

export function analyzeHosting(addresses: HostingAddress[]): Finding[] {
  const bad = addresses.filter((a) => a.kind === "non_public");
  return bad.length > 0 ? [f("hosting.non_public", "hosting", "medium", "doh", { count: bad.length })] : [];
}

// ---- mail ----

export interface MailInput {
  mx: DnsAnswer;
  /** TXT records at the apex, where SPF lives. */
  txt: DnsAnswer;
  dmarc: DnsAnswer;
  mtaSts: DnsAnswer;
  tlsRpt: DnsAnswer;
  dkim: { selector: string; answer: DnsAnswer }[];
  /** Result of walking the SPF includes, or null when there is not exactly one SPF record. */
  spfEvaluation: SpfEvaluation | null;
}

function txtRecords(a: DnsAnswer, test: (s: string) => boolean): string[] {
  return recordsOf(a, "TXT").map((r) => r.data).filter(test);
}

function presence(a: DnsAnswer, test: (s: string) => boolean): "present" | "absent" | "unknown" {
  if (a.state === "failed") return "unknown";
  return txtRecords(a, test).length > 0 ? "present" : "absent";
}

export function analyzeMail(input: MailInput): { mail: MailInfo; findings: Finding[] } {
  const findings: Finding[] = [];
  const mxList = input.mx.state === "ok" ? parseMx(recordsOf(input.mx, "MX")) : [];
  const nullMx = isNullMx(mxList);
  const hasMail = input.mx.state === "ok" && mxList.length > 0 && !nullMx;
  const noMail = input.mx.state === "ok" && !hasMail;

  // SPF
  const spf: SpfInfo = { state: "unknown", record: null, terminal: null, lookups: 0, complete: true, exceeded: false, syntaxError: false, cycle: false };
  if (input.txt.state === "ok") {
    const records = txtRecords(input.txt, isSpfRecord);
    spf.state = records.length === 0 ? "none" : records.length === 1 ? "one" : "multiple";
    if (records.length === 1) {
      spf.record = records[0]!.slice(0, 600);
      const parsed = parseSpf(records[0]!);
      spf.terminal = parsed.all;
      spf.syntaxError = parsed.errors.length > 0;
      const ev = input.spfEvaluation;
      if (ev) {
        spf.terminal = ev.terminal;
        spf.lookups = ev.lookups;
        spf.complete = ev.complete;
        spf.exceeded = ev.exceeded;
        spf.cycle = ev.problems.some((p) => p.reason === "cycle");
        spf.syntaxError = spf.syntaxError || ev.problems.some((p) => p.reason === "syntax");
      }
    }
  }

  // DMARC
  const dmarc: DmarcInfo = { state: "unknown", valid: false, policy: null, pct: 100, ruaCount: 0 };
  if (input.dmarc.state === "ok") {
    const records = txtRecords(input.dmarc, isDmarcRecord);
    dmarc.state = records.length === 0 ? "none" : records.length === 1 ? "one" : "multiple";
    if (records.length === 1) {
      const p = parseDmarc(records[0]!);
      dmarc.valid = p.valid;
      dmarc.policy = p.policy;
      dmarc.pct = p.pct;
      dmarc.ruaCount = p.ruaCount;
    }
  }

  // DKIM
  const dkim: DkimInfo = { tried: input.dkim.map((d) => d.selector), found: [], failed: 0 };
  for (const { selector, answer } of input.dkim) {
    if (answer.state === "failed") {
      dkim.failed++;
      continue;
    }
    const looksLikeKey = (s: string) => /(^|;)\s*(v=DKIM1|p=|k=rsa|k=ed25519)/i.test(s);
    if (txtRecords(answer, looksLikeKey).length > 0) dkim.found.push({ selector, kind: "txt" });
    else if (recordsOf(answer, "CNAME").length > 0) dkim.found.push({ selector, kind: "cname" });
  }

  const mtaSts = presence(input.mtaSts, (s) => /^v=STSv1/i.test(s.trim()));
  const tlsRpt = presence(input.tlsRpt, (s) => /^v=TLSRPTv1/i.test(s.trim()));

  // ---- findings ----
  const sev = (withMail: Severity, without: Severity): Severity => (hasMail ? withMail : without);
  if (noMail && !nullMx) findings.push(f("mail.no_mx", "mail", "medium", "doh"));
  if (spf.state === "none") findings.push(f(hasMail ? "spf.missing" : "spf.missing_nomail", "mail", sev("high", "low"), "doh"));
  else if (spf.state === "multiple") findings.push(f("spf.multiple", "mail", "high", "doh"));
  else if (spf.state === "one") {
    if (spf.syntaxError) findings.push(f("spf.syntax", "mail", "high", "doh"));
    if (spf.exceeded) findings.push(f("spf.too_many_lookups", "mail", "high", "doh"));
    if (spf.cycle) findings.push(f("spf.loop", "mail", "high", "doh"));
    if (spf.terminal === "+") findings.push(f("spf.plus_all", "mail", "high", "doh"));
    else if (spf.terminal === "?") findings.push(f("spf.neutral_all", "mail", "medium", "doh"));
    else if (spf.terminal === "~") findings.push(f("spf.softfail", "mail", "low", "doh"));
    else if (spf.terminal === null && !spf.syntaxError) findings.push(f("spf.no_all", "mail", "medium", "doh"));
    if (!spf.complete && !spf.exceeded) findings.push(f("spf.incomplete", "mail", "low", "derived", { lookups: spf.lookups }));
  }
  if (dmarc.state === "none") findings.push(f("dmarc.missing", "mail", sev("medium", "low"), "doh"));
  else if (dmarc.state === "multiple") findings.push(f("dmarc.multiple", "mail", "medium", "doh"));
  else if (dmarc.state === "one") {
    if (!dmarc.valid) findings.push(f("dmarc.invalid", "mail", "medium", "doh"));
    else {
      if (dmarc.policy === "none") findings.push(f("dmarc.policy_none", "mail", "medium", "doh"));
      else if (dmarc.pct < 100) findings.push(f("dmarc.partial", "mail", "low", "doh", { pct: dmarc.pct }));
      if (dmarc.ruaCount === 0) findings.push(f("dmarc.no_reports", "mail", "low", "doh"));
    }
  }
  if (hasMail) {
    if (dkim.found.length === 0) findings.push(f("dkim.not_found", "mail", "low", "doh", { count: dkim.tried.length }));
    if (mtaSts === "absent") findings.push(f("mtasts.missing", "mail", "low", "doh"));
    if (tlsRpt === "absent") findings.push(f("tlsrpt.missing", "mail", "low", "doh"));
  }

  let rating: MailRating;
  if (input.mx.state === "failed" || input.txt.state === "failed") rating = "unknown";
  else if (noMail) rating = "nomail";
  else if (findings.some((x) => x.severity === "high")) rating = "risk";
  else if (findings.some((x) => x.severity === "medium")) rating = "improve";
  else rating = "good";

  return {
    mail: { mx: mxList, mxState: input.mx.state === "ok" ? "ok" : "failed", nullMx, spf, dmarc, dkim, mtaSts, tlsRpt, rating },
    findings,
  };
}

// ---- ordering ----

const RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/** At most three indexes of high or medium findings, most severe first, keeping the original order within a level. */
export function pickTop(findings: Finding[]): number[] {
  return findings
    .map((x, i) => ({ x, i }))
    .filter(({ x }) => x.severity !== "low")
    .sort((a, b) => RANK[a.x.severity] - RANK[b.x.severity] || a.i - b.i)
    .slice(0, 3)
    .map(({ i }) => i);
}
