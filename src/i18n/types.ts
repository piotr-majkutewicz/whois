export type Lang = "pl" | "en";
export const LANGS: readonly Lang[] = ["pl", "en"];
export const DEFAULT_LANG: Lang = "pl";

export function isLang(value: unknown): value is Lang {
  return typeof value === "string" && (LANGS as readonly string[]).includes(value);
}

/** Values that can be put into a text template, for example {days} or {registry}. */
export type Params = Record<string, string | number>;

export function format(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (Object.prototype.hasOwnProperty.call(params, k) ? String(params[k]) : m));
}

/** Keys of finding texts. The finding ids returned by the API are these keys. */
export const FINDING_KEYS = [
  "reg.expired",
  "reg.expires_soon",
  "reg.deleting",
  "reg.on_hold",
  "reg.no_dnssec",
  "dns.no_ns",
  "dns.single_ns",
  "dns.no_address",
  "dns.no_www",
  "dns.no_caa",
  "hosting.non_public",
  "mail.no_mx",
  "spf.missing",
  "spf.missing_nomail",
  "spf.multiple",
  "spf.syntax",
  "spf.too_many_lookups",
  "spf.loop",
  "spf.plus_all",
  "spf.neutral_all",
  "spf.softfail",
  "spf.no_all",
  "spf.incomplete",
  "dmarc.missing",
  "dmarc.multiple",
  "dmarc.invalid",
  "dmarc.policy_none",
  "dmarc.partial",
  "dmarc.no_reports",
  "dkim.not_found",
  "mtasts.missing",
  "tlsrpt.missing",
] as const;
export type FindingKey = (typeof FINDING_KEYS)[number];

export const ERROR_KEYS = [
  "body_unreadable",
  "body_too_large",
  "invalid_json",
  "invalid_lang",
  "domain_missing",
  "domain_empty",
  "domain_too_long",
  "domain_ip",
  "domain_local",
  "domain_no_dot",
  "domain_chars",
  "domain_label",
  "domain_suffix",
  "rate_limited",
  "method_not_allowed",
  "not_found",
  "internal_error",
] as const;
export type ErrorKey = (typeof ERROR_KEYS)[number];

export const STATUS_KEYS = [
  "ok", "inactive", "transfer_lock", "update_lock", "delete_lock", "renew_lock", "hold", "pending_delete", "redemption",
  "pending_create", "pending_transfer", "pending_update", "pending_renew", "grace_period", "other",
] as const;
export type StatusKey = (typeof STATUS_KEYS)[number];

export const RECORD_TYPE_KEYS = ["A", "AAAA", "CNAME", "NS", "MX", "TXT", "CAA", "SOA"] as const;
export type RecordTypeKey = (typeof RECORD_TYPE_KEYS)[number];

export const UI_KEYS = [
  // page
  "metaTitle", "metaDescription", "heading", "intro", "langSwitchLabel", "domainLabel", "domainPlaceholder", "submit", "submitBusy",
  "loadingText", "loadingSlow", "announceLoading", "announceDone", "resultLabel",
  // errors in the page
  "errorNetwork", "errorTimeout", "errorGeneric", "errorHintGeneric", "errorHintRate", "errorHintNetwork", "errorHintSlow", "errorHintInput", "retry",
  // result header
  "statusRegistered", "statusAvailable", "statusUnsupported", "statusRateLimited", "statusUnavailable",
  "expiresIn", "expiresToday", "expiredAgo", "dayOne", "dayMany", "checkedDomain", "availableNote",
  // sections and tiles
  "sectionRegistration", "sectionDns", "sectionHosting", "sectionMail", "tileOk", "tileWarn", "tileBad", "tileUnknown", "tileInfo",
  "tileDnsHeadline", "tileDnsNone", "tileHostingHeadline", "tileHostingNone",
  // summary and findings
  "topHeading", "noTop", "findingsHeading", "noFindings", "severityHigh", "severityMedium", "severityLow", "why", "fix", "howWeKnow",
  // sources
  "srcRdapDomain", "srcRdapDomainProxy", "srcRdapIp", "srcDoh", "srcDerived", "srcCache",
  // registration card
  "rowRegistrar", "rowRegistered", "rowExpires", "rowChanged", "rowStatuses", "rowNameservers", "rowDnssec", "rowOwner",
  "ownerHidden", "dnssecSigned", "dnssecUnsigned", "dnssecUnknown", "valueUnknown",
  "regAvailableText", "regUnsupportedText", "regRateLimitedText", "regUnavailableText", "registryLink", "registryLinkHint", "regDelayNote", "regCachedNote",
  // dns card
  "dnsIntro", "hostApex", "hostWww", "dnsNone", "dnsFailed", "dnsUnavailable", "providersHeading", "providersNote", "providerMail", "providerDns",
  "providerFoundBy", "noProviders",
  // hosting card
  "hostingIntro", "hostingNote", "hostingNetwork", "hostingCountry", "hostingNonPublic", "hostingSkipped", "hostingUnknown", "hostingNoAddress",
  // mail card
  "mailIntro", "mailRatingGood", "mailRatingImprove", "mailRatingRisk", "mailRatingNone", "mailRatingUnknown", "mailRatingLabel",
  "rowMx", "rowSpf", "rowDmarc", "rowDkim", "rowMtaSts", "rowTlsRpt",
  "mxNone", "mxNull", "mxUnknown", "spfNone", "spfMultiple", "spfUnknown", "spfValue", "spfValueMore", "spfNoEnd", "spfBroken",
  "terminalHard", "terminalSoft", "terminalNeutral", "terminalOpen",
  "dmarcNone", "dmarcMultiple", "dmarcUnknown", "dmarcInvalid", "dmarcValue", "policyNone", "policyQuarantine", "policyReject", "reportsYes", "reportsNo",
  "dkimFound", "dkimNotFound", "dkimUnknown", "dkimCname", "dkimNote", "recordPresent", "recordAbsent", "recordUnknown", "mailRecordsNote",
  // not shown, coverage, footer
  "notShownHeading", "coverageHeading", "coverageLine", "coverageIncomplete", "copy", "copied", "copyFailed", "copyFor",
  "copyRating", "copyTop", "ctaText", "ctaLink", "disclaimer",
] as const;
export type UiKey = (typeof UI_KEYS)[number];

export interface FindingText {
  title: string;
  why: string;
  fix: string;
}

export interface Dictionary {
  ui: Record<UiKey, string>;
  findings: Record<FindingKey, FindingText>;
  errors: Record<ErrorKey, string>;
  statuses: Record<StatusKey, { label: string; explain: string }>;
  recordTypes: Record<RecordTypeKey, { title: string; explain: string }>;
  notShown: string[];
}
