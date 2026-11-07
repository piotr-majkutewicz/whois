import { MULTI_LABEL_SUFFIXES } from "./psl";
import { toUnicodeHost } from "./punycode";

export type DomainRejection =
  | "empty"
  | "too_long"
  | "ip_address"
  | "local_name"
  | "no_dot"
  | "invalid_chars"
  | "invalid_label"
  | "public_suffix";

export type ParsedDomain =
  | {
      ok: true;
      /** The registrable domain in ASCII (punycode) form, for example "example.pl" for "www.example.pl". */
      domain: string;
      /** The same domain in readable form (IDN decoded). */
      unicode: string;
      /** The host that was submitted, in ASCII form. Differs from `domain` for www.example.pl and similar. */
      submittedHost: string;
      /** The public suffix that was used, for example "com.pl". */
      suffix: string;
    }
  | { ok: false; reason: DomainRejection };

const MAX_INPUT = 2048;
const SPECIAL_TLDS = new Set(["localhost", "local", "localdomain", "internal", "invalid", "lan", "home", "corp", "intranet", "onion", "arpa", "test", "example"]);
const IPV4_LIKE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Pulls the host part out of a domain, URL or e-mail address typed by the visitor. */
function extractHost(raw: string): string | null {
  let s = raw.trim();
  if (s.toLowerCase().startsWith("mailto:")) s = s.slice(7);
  // An e-mail address: keep what follows the last "@" (up to the first slash or question mark).
  if (!s.includes("://")) {
    const cut = s.search(/[/?#]/);
    const authority = cut === -1 ? s : s.slice(0, cut);
    const at = authority.lastIndexOf("@");
    if (at !== -1) s = authority.slice(at + 1);
  }
  const candidate = s.includes("://") ? s : `http://${s}`;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname;
  } catch {
    return null;
  }
}

export function parseDomainInput(raw: unknown): ParsedDomain {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "empty" };
  if (raw.length > MAX_INPUT) return { ok: false, reason: "too_long" };
  if (/[\u0000- \u007f]/.test(raw.trim())) return { ok: false, reason: "invalid_chars" };

  const host0 = extractHost(raw);
  if (host0 === null || host0 === "") return { ok: false, reason: "invalid_chars" };
  // IPv6 literal ("[::1]") and IPv4 in any notation (the URL parser normalises 2130706433 to 127.0.0.1).
  if (host0.startsWith("[") || host0.includes(":")) return { ok: false, reason: "ip_address" };
  const host = host0.replace(/\.$/, "").toLowerCase();
  if (IPV4_LIKE.test(host)) return { ok: false, reason: "ip_address" };
  if (host.length > 253) return { ok: false, reason: "too_long" };

  const labels = host.split(".");
  const tld = labels[labels.length - 1]!;
  if (labels.length === 1) return { ok: false, reason: SPECIAL_TLDS.has(host) ? "local_name" : "no_dot" };
  if (SPECIAL_TLDS.has(tld)) return { ok: false, reason: "local_name" };
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return { ok: false, reason: "invalid_label" };
    if (!/^[a-z0-9-]+$/.test(label)) return { ok: false, reason: "invalid_chars" };
    if (label.startsWith("-") || label.endsWith("-")) return { ok: false, reason: "invalid_label" };
    if (label.slice(2, 4) === "--" && !label.startsWith("xn--")) return { ok: false, reason: "invalid_label" };
  }
  // A TLD is letters (or punycode), never all digits.
  if (!/^[a-z]{2,}$/.test(tld) && !/^xn--[a-z0-9-]+$/.test(tld)) return { ok: false, reason: "invalid_label" };

  // Registrable domain: one label above the public suffix.
  const lastTwo = labels.slice(-2).join(".");
  let suffixLabels = 1;
  if (MULTI_LABEL_SUFFIXES.has(lastTwo)) suffixLabels = 2;
  if (labels.length === suffixLabels) return { ok: false, reason: "public_suffix" };
  const domain = labels.slice(-(suffixLabels + 1)).join(".");
  return {
    ok: true,
    domain,
    unicode: toUnicodeHost(domain),
    submittedHost: host,
    suffix: labels.slice(-suffixLabels).join("."),
  };
}

/** The last label, used to find the registry in the IANA bootstrap file. */
export function tldOf(domain: string): string {
  return domain.slice(domain.lastIndexOf(".") + 1);
}
