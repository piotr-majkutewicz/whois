// Recognition of well-known mail and DNS providers from hostnames. This is a pattern match on record
// values, shown to the visitor as "recognised from the records", never as certainty.

export interface Provider {
  id: string;
  name: string;
  /** Hostname suffixes, matched on label boundaries ("google.com" matches "aspmx.l.google.com"). */
  suffixes: string[];
}

export const PROVIDERS: readonly Provider[] = [
  { id: "google", name: "Google Workspace / Gmail", suffixes: ["google.com", "googlemail.com"] },
  { id: "microsoft", name: "Microsoft 365", suffixes: ["mail.protection.outlook.com", "outlook.com"] },
  { id: "ovh", name: "OVHcloud", suffixes: ["ovh.net", "ovh.com", "ovh.pl", "ovh.eu"] },
  { id: "homepl", name: "home.pl", suffixes: ["home.pl"] },
  { id: "cyberfolks", name: "cyber_Folks", suffixes: ["cyberfolks.pl", "cyber-folks.pl", "cyberfolks.eu"] },
  { id: "nazwapl", name: "nazwa.pl", suffixes: ["nazwa.pl"] },
  { id: "zoho", name: "Zoho", suffixes: ["zoho.com", "zoho.eu", "zohomail.com", "zohomail.eu"] },
  { id: "cloudflare", name: "Cloudflare", suffixes: ["ns.cloudflare.com", "mx.cloudflare.net", "cloudflare.net"] },
  { id: "azpl", name: "AZ.pl", suffixes: ["az.pl"] },
  { id: "lhpl", name: "LH.pl", suffixes: ["lh.pl"] },
  { id: "seohost", name: "SEOHOST", suffixes: ["seohost.pl"] },
  { id: "hostido", name: "Hostido", suffixes: ["hostido.net.pl", "hostido.pl"] },
  { id: "dhosting", name: "dhosting.pl", suffixes: ["dhosting.pl"] },
  { id: "linuxpl", name: "linuxpl.com", suffixes: ["linuxpl.com"] },
  { id: "nask", name: "NASK (dns.pl)", suffixes: ["dns.pl"] },
  { id: "aws", name: "Amazon Web Services", suffixes: ["awsdns-00.com", "amazonaws.com", "amazonses.com"] },
  { id: "godaddy", name: "GoDaddy", suffixes: ["domaincontrol.com", "secureserver.net"] },
  { id: "namecheap", name: "Namecheap", suffixes: ["registrar-servers.com", "privateemail.com"] },
  { id: "ionos", name: "IONOS", suffixes: ["ui-dns.com", "ui-dns.de", "ui-dns.org", "ui-dns.biz", "ionos.com", "kundenserver.de", "1and1.com"] },
  { id: "proton", name: "Proton Mail", suffixes: ["protonmail.ch", "proton.me"] },
  { id: "fastmail", name: "Fastmail", suffixes: ["messagingengine.com"] },
  { id: "wix", name: "Wix", suffixes: ["wixdns.net"] },
  { id: "hetzner", name: "Hetzner", suffixes: ["your-server.de", "hetzner.com", "second-ns.de", "second-ns.com"] },
  { id: "gandi", name: "Gandi", suffixes: ["gandi.net"] },
];

/** Provider IDs for numbered AWS name servers (ns-123.awsdns-45.com and similar). */
const AWS_NS = /(^|\.)awsdns-\d+\.(com|net|org|co\.uk)$/;

export function matchProvider(host: string): Provider | null {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (AWS_NS.test(h)) return PROVIDERS.find((p) => p.id === "aws")!;
  let best: { p: Provider; len: number } | null = null;
  for (const p of PROVIDERS) {
    for (const s of p.suffixes) {
      if ((h === s || h.endsWith("." + s)) && (!best || s.length > best.len)) best = { p, len: s.length };
    }
  }
  return best?.p ?? null;
}

export interface ProviderMatch {
  kind: "mail" | "dns";
  id: string;
  name: string;
  /** The hostnames from the records that led to the match. */
  hosts: string[];
}

export function detectProviders(kind: "mail" | "dns", hosts: string[]): ProviderMatch[] {
  const map = new Map<string, ProviderMatch>();
  for (const host of hosts) {
    const p = matchProvider(host);
    if (!p) continue;
    const m = map.get(p.id) ?? { kind, id: p.id, name: p.name, hosts: [] };
    if (!m.hosts.includes(host)) m.hosts.push(host);
    map.set(p.id, m);
  }
  return [...map.values()];
}
