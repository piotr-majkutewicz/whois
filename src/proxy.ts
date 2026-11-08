// Optional intermediary for the .pl registry. The registry rate-limits the shared address pool of Workers,
// so a small proxy on a separate server can ask on the Worker's behalf (see proxy/README.md).
import { parseIPv4, parseIPv6 } from "./ip";

export interface ProxyConfig {
  /** Always "https://host" without a trailing slash. */
  base: string;
  key: string;
  /** Cloudflare Access service token, sent only when both parts are configured. */
  access: { id: string; secret: string } | null;
}

export interface ProxyEnv {
  RDAP_PROXY_URL?: string;
  RDAP_PROXY_KEY?: string;
  RDAP_PROXY_ACCESS_ID?: string;
  RDAP_PROXY_ACCESS_SECRET?: string;
}

/** The registry the proxy serves. Other registries are always asked directly. */
export const PROXIED_REGISTRY_HOST = "rdap.dns.pl";

export type ProxyParse = { config: ProxyConfig | null; problem: "url" | "key" | null };

/**
 * Reads the proxy settings. Rules for the URL: https only, a host name (no IP address, no port, no
 * credentials), a path of "/" at most, no query. Any host name is accepted, not only ones in one zone,
 * because the tunnel host name is the owner's choice and the shared key still has to match.
 * Invalid settings are ignored (the Worker then asks the registry directly) and reported as a problem
 * code only, never with the values.
 */
export function parseProxyConfig(env: ProxyEnv): ProxyParse {
  const raw = env.RDAP_PROXY_URL?.trim();
  if (!raw) return { config: null, problem: null };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { config: null, problem: "url" };
  }
  const host = url.hostname;
  const isIp = host.startsWith("[") || parseIPv4(host) !== null || parseIPv6(host) !== null || /^[0-9.]+$/.test(host);
  const okHost = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(host);
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password || isIp || !okHost) return { config: null, problem: "url" };
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) return { config: null, problem: "url" };
  const key = env.RDAP_PROXY_KEY?.trim();
  if (!key) return { config: null, problem: "key" };
  const id = env.RDAP_PROXY_ACCESS_ID?.trim();
  const secret = env.RDAP_PROXY_ACCESS_SECRET?.trim();
  return { config: { base: `https://${host}`, key, access: id && secret ? { id, secret } : null }, problem: null };
}

export function proxyHeaders(c: ProxyConfig): Record<string, string> {
  const h: Record<string, string> = { "x-proxy-key": c.key };
  if (c.access) {
    h["cf-access-client-id"] = c.access.id;
    h["cf-access-client-secret"] = c.access.secret;
  }
  return h;
}
