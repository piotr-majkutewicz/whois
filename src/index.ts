import { defaultCache } from "./cache";
import { parseDomainInput, type DomainRejection } from "./domain";
import { DEFAULT_LANG, dictionary, isLang, type ErrorKey, type Lang } from "./i18n";
import { localize } from "./i18n/localize";
import { runLookup } from "./lookup";
import { renderUi } from "./ui";

export interface Env {
  /** Optional: the binding is missing in some local setups and the code copes with that. */
  RATE_LIMITER?: RateLimit;
}

const MAX_BODY_BYTES = 2048;

const BASE_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "strict-transport-security": "max-age=31536000",
  // The public demo must not be indexed. Crawlers can only see this if robots.txt allows crawling.
  "x-robots-tag": "noindex, nofollow",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...BASE_HEADERS, ...extra },
  });
}

/** Error responses: a stable code plus a message in the requested language. */
function apiError(status: number, code: string, key: ErrorKey, lang: Lang, extra: Record<string, string> = {}): Response {
  return json({ error: { code, key, message: dictionary(lang).errors[key] } }, status, extra);
}

const REJECTION_KEY: Record<DomainRejection, ErrorKey> = {
  empty: "domain_empty",
  too_long: "domain_too_long",
  ip_address: "domain_ip",
  local_name: "domain_local",
  no_dot: "domain_no_dot",
  invalid_chars: "domain_chars",
  invalid_label: "domain_label",
  public_suffix: "domain_suffix",
};

/** Language from the ?lang= query parameter. Missing or unknown values give null. */
function queryLang(url: URL): Lang | null {
  const v = url.searchParams.get("lang");
  return isLang(v) ? v : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch {
      // Never leak internals: nothing about the failure is sent to the client.
      return apiError(500, "internal_error", "internal_error", DEFAULT_LANG);
    }
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const readOnly = request.method === "GET" || request.method === "HEAD";

  if (url.pathname === "/" && readOnly) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return new Response(request.method === "HEAD" ? null : renderUi(nonce, queryLang(url) ?? DEFAULT_LANG), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        ...BASE_HEADERS,
      },
    });
  }

  // Crawling stays allowed on purpose, otherwise search engines could not read the noindex signal.
  if (url.pathname === "/robots.txt" && readOnly) {
    return new Response(request.method === "HEAD" ? null : "User-agent: *\nAllow: /\n", {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...BASE_HEADERS },
    });
  }

  if (url.pathname === "/api/lookup") {
    if (request.method !== "POST") {
      return apiError(405, "method_not_allowed", "method_not_allowed", queryLang(url) ?? DEFAULT_LANG, { allow: "POST" });
    }
    return handleLookup(request, env, queryLang(url) ?? DEFAULT_LANG);
  }

  return apiError(404, "not_found", "not_found", queryLang(url) ?? DEFAULT_LANG);
}

async function handleLookup(request: Request, env: Env, queryLanguage: Lang): Promise<Response> {
  // Until the body is parsed, errors use the language from the query string (default: Polish).
  let lang = queryLanguage;

  // Rate limit first, before any outbound request. Skipped when the binding is not available.
  // The key is the visitor's address, kept only by the platform's counter. Nothing is logged here.
  if (env.RATE_LIMITER) {
    const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
    const { success } = await env.RATE_LIMITER.limit({ key });
    if (!success) return apiError(429, "rate_limited", "rate_limited", lang, { "retry-after": "60" });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return apiError(413, "body_too_large", "body_too_large", lang);
  let text: string;
  try {
    text = await request.text();
  } catch {
    return apiError(400, "invalid_body", "body_unreadable", lang);
  }
  if (text.length > MAX_BODY_BYTES) return apiError(413, "body_too_large", "body_too_large", lang);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, "invalid_json", "invalid_json", lang);
  }
  const fields = (body !== null && typeof body === "object" ? body : {}) as { domain?: unknown; lang?: unknown };

  // The "lang" field in the body wins over ?lang=. An unknown value is rejected, not guessed.
  if (fields.lang !== undefined && fields.lang !== null) {
    if (!isLang(fields.lang)) return apiError(400, "invalid_lang", "invalid_lang", lang);
    lang = fields.lang;
  }

  if (typeof fields.domain !== "string") return apiError(400, "invalid_domain", "domain_missing", lang);
  const parsed = parseDomainInput(fields.domain);
  if (!parsed.ok) return apiError(400, "invalid_domain", REJECTION_KEY[parsed.reason], lang);

  try {
    const result = await runLookup(parsed, { fetch: (u, init) => fetch(u, init), cache: defaultCache() });
    return json({ lang, neutral: result, texts: localize(result, lang) });
  } catch {
    return apiError(500, "internal_error", "internal_error", lang);
  }
}
