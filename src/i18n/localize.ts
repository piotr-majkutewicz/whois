import type { Finding, LookupResult, RegistrationState } from "../types";
import { dictionary, format, type FindingKey, type Lang, type Params, type UiKey } from "./index";

/** "3 days", "1 dzień". Used for the {daysText} placeholder. */
export function daysText(n: number, lang: Lang): string {
  const ui = dictionary(lang).ui;
  return `${n} ${n === 1 ? ui.dayOne : ui.dayMany}`;
}

export function findingParams(f: Finding, lang: Lang): Params {
  const p: Params = { ...f.params };
  if (typeof p.days === "number") p.daysText = daysText(p.days, lang);
  return p;
}

const STATE_KEY: Record<RegistrationState, UiKey> = {
  registered: "statusRegistered",
  available: "statusAvailable",
  unsupported: "statusUnsupported",
  rate_limited: "statusRateLimited",
  unavailable: "statusUnavailable",
};

const RATING_KEY = {
  good: "mailRatingGood", improve: "mailRatingImprove", risk: "mailRatingRisk", nomail: "mailRatingNone", unknown: "mailRatingUnknown",
} as const satisfies Record<LookupResult["mail"]["rating"], UiKey>;

export function sourceText(result: LookupResult, source: Finding["source"], lang: Lang): string {
  const ui = dictionary(lang).ui;
  switch (source) {
    case "rdap_domain": return format(result.registration.via === "proxy" ? ui.srcRdapDomainProxy : ui.srcRdapDomain, { registry: result.registration.registry ?? "" });
    case "rdap_ip": return format(ui.srcRdapIp, { registry: result.hosting.find((h) => h.registry)?.registry ?? "" });
    case "doh": return ui.srcDoh;
    case "derived": return ui.srcDerived;
  }
}

export interface LocalizedFinding {
  id: string;
  section: Finding["section"];
  severity: Finding["severity"];
  title: string;
  why: string;
  fix: string;
  source: string;
}

export interface LocalizedResult {
  status: string;
  mailRating: string;
  top: string[];
  findings: LocalizedFinding[];
}

/** Ready-made texts for people who use the API directly. The page builds the same texts in the browser. */
export function localize(result: LookupResult, lang: Lang): LocalizedResult {
  const d = dictionary(lang);
  const findings = result.findings.map((f): LocalizedFinding => {
    const t = d.findings[f.key as FindingKey];
    const p = findingParams(f, lang);
    return {
      id: f.key,
      section: f.section,
      severity: f.severity,
      title: format(t.title, p),
      why: format(t.why, p),
      fix: format(t.fix, p),
      source: sourceText(result, f.source, lang),
    };
  });
  return {
    status: d.ui[STATE_KEY[result.registration.state]],
    mailRating: d.ui[RATING_KEY[result.mail.rating]],
    top: result.top.map((i) => findings[i]!.title),
    findings,
  };
}
