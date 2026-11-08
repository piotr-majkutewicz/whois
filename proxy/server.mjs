// RDAP proxy for the .pl registry. One file, no dependencies, Node 22.
//
// It answers a single question, "what does rdap.dns.pl say about this domain?", for one trusted caller
// (the whois Worker). It is meant to run behind a Cloudflare Tunnel with no published port.
import { createHash, timingSafeEqual } from "node:crypto";
import http from "node:http";
import https from "node:https";
import { pathToFileURL } from "node:url";

export const UPSTREAM_HOST = "rdap.dns.pl"; // fixed on purpose, never taken from a request
const DEFAULT_UA = "whois-demo-proxy/1.0 (+https://whois.piotrmajkutewicz.pl)";
const MAX_BODY_BYTES = 256 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const TTL_OK_MS = 10 * 60_000; // 200 and 404
const TTL_LIMITED_MS = 30_000; // 429
const CACHE_LIMIT = 500;

/** A domain under .pl: lowercase ASCII labels, digits, hyphens, punycode. Anything else is rejected. */
export function validateDomain(name) {
  if (typeof name !== "string" || name.length < 4 || name.length > 253) return false;
  const labels = name.split(".");
  if (labels.length < 2 || labels[labels.length - 1] !== "pl") return false;
  return labels.every((l) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l) && (l.slice(2, 4) !== "--" || l.startsWith("xn--")));
}

const digest = (s) => createHash("sha256").update(String(s)).digest();
/** Constant-time comparison: both values are hashed first so that length differences do not leak either. */
export function keyMatches(given, expected) {
  return timingSafeEqual(digest(given ?? ""), digest(expected));
}

/**
 * The real upstream call. Plain https.request so that the address family can be forced to IPv4 (the
 * registry has no IPv6). Redirects are not followed. The body is capped.
 */
export function createUpstream({ request = https.request, userAgent = DEFAULT_UA, timeoutMs = UPSTREAM_TIMEOUT_MS } = {}) {
  return (domain) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: UPSTREAM_HOST,
          path: `/domain/${domain}`,
          method: "GET",
          family: 4,
          headers: { accept: "application/rdap+json", "user-agent": userAgent },
          timeout: timeoutMs,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) {
              req.destroy(new Error("too_large"));
              return;
            }
            chunks.push(c);
          });
          res.on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
          res.on("error", reject);
        },
      );
      req.on("timeout", () => req.destroy(new Error("timeout")));
      req.on("error", reject);
      req.end();
    });
}

/**
 * The request handler as a plain function, so it can be tested without sockets.
 * `upstream(domain)` resolves to { status, headers, body: Buffer } or rejects.
 */
export function createApp({ proxyKey, upstream, ratePerMin = 20, now = Date.now, log = () => {} }) {
  if (typeof proxyKey !== "string" || proxyKey.length < 32) throw new Error("PROXY_KEY must be at least 32 characters");
  const cache = new Map(); // domain -> { expires, response }
  const inflight = new Map(); // domain -> Promise<response>
  const stats = new Map(); // status code -> count (no addresses, no domain names)
  let tokens = ratePerMin;
  let refilledAt = now();

  const count = (status) => stats.set(status, (stats.get(status) ?? 0) + 1);
  const empty = (status, extra = {}) => ({ status, headers: { "cache-control": "no-store", ...extra }, body: Buffer.alloc(0) });

  function takeToken() {
    const t = now();
    tokens = Math.min(ratePerMin, tokens + ((t - refilledAt) / 60_000) * ratePerMin);
    refilledAt = t;
    if (tokens >= 1) {
      tokens -= 1;
      return 0;
    }
    return Math.max(1, Math.ceil(((1 - tokens) / ratePerMin) * 60));
  }

  function shape(up) {
    const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff" };
    const ct = up.headers?.["content-type"];
    if (typeof ct === "string" && ct.length <= 100) headers["content-type"] = ct;
    const ra = up.headers?.["retry-after"];
    if (typeof ra === "string" && /^\d{1,6}$/.test(ra)) headers["retry-after"] = ra;
    return { status: up.status, headers, body: up.body };
  }

  async function query(domain) {
    const hit = cache.get(domain);
    if (hit && hit.expires > now()) return hit.response;
    const running = inflight.get(domain);
    if (running) return running;
    const wait = takeToken();
    if (wait > 0) return empty(429, { "retry-after": String(wait) });
    const promise = (async () => {
      let up;
      try {
        up = await upstream(domain);
      } catch {
        return empty(504);
      }
      if (up.status >= 300 && up.status < 400) return empty(502); // redirects are never followed
      const response = shape(up);
      const ttl = up.status === 200 || up.status === 404 ? TTL_OK_MS : up.status === 429 ? TTL_LIMITED_MS : 0;
      if (ttl > 0) {
        cache.delete(domain);
        cache.set(domain, { expires: now() + ttl, response });
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value); // oldest first
      }
      return response;
    })().finally(() => inflight.delete(domain));
    inflight.set(domain, promise);
    return promise;
  }

  async function handle({ method, url, headers }) {
    const res = await route({ method, url, headers });
    count(res.status);
    return res;
  }

  async function route({ method, url, headers }) {
    // Without the key every path looks the same: 404, nothing is revealed.
    if (!keyMatches(headers["x-proxy-key"], proxyKey)) return empty(404);
    if (method !== "GET") return empty(405, { allow: "GET" });
    if (url === "/healthz") return { status: 200, headers: { "content-type": "text/plain", "cache-control": "no-store" }, body: Buffer.from("ok") };
    const prefix = "/rdap/domain/";
    if (!url.startsWith(prefix)) return empty(404);
    const name = url.slice(prefix.length); // raw: no decoding, so %, ?, # and "/" fail validation
    if (!validateDomain(name)) return empty(400);
    return query(name);
  }

  /** Counts per status code since the last call, then reset. */
  function drainStats() {
    const out = Object.fromEntries(stats);
    stats.clear();
    return out;
  }

  return { handle, drainStats, cacheSize: () => cache.size };
}

export function createHttpServer(app) {
  const server = http.createServer(async (req, res) => {
    try {
      const r = await app.handle({ method: req.method ?? "GET", url: req.url ?? "/", headers: req.headers });
      res.writeHead(r.status, r.headers);
      res.end(r.body);
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 15_000;
  server.keepAliveTimeout = 5_000;
  return server;
}

function main() {
  const env = process.env;
  let app;
  try {
    const ratePerMin = Number(env.RATE_PER_MIN ?? 20);
    if (!Number.isFinite(ratePerMin) || ratePerMin < 1) throw new Error("RATE_PER_MIN must be a positive number");
    app = createApp({ proxyKey: env.PROXY_KEY, upstream: createUpstream({ userAgent: env.USER_AGENT || DEFAULT_UA }), ratePerMin });
  } catch (e) {
    console.error(`rdap-proxy: refusing to start: ${e.message}`);
    process.exit(1);
  }
  const server = createHttpServer(app);
  const port = Number(env.PORT ?? 8080);
  server.listen(port, env.HOST ?? "0.0.0.0", () => console.log(`rdap-proxy: listening on ${port}`));
  // Only counters per status code are logged: no client addresses, no domain names.
  const timer = setInterval(() => {
    const s = app.drainStats();
    if (Object.keys(s).length > 0) console.log(`rdap-proxy: last minute ${JSON.stringify(s)}`);
  }, 60_000);
  timer.unref();
  const stop = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
