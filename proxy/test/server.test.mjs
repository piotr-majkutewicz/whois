import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createApp, createHttpServer, createUpstream, keyMatches, validateDomain } from "../server.mjs";

const KEY = "k".repeat(40);
const json = (status, extra = {}, body = '{"objectClassName":"domain"}') => ({
  status,
  headers: { "content-type": "application/rdap+json", "set-cookie": "x=1", server: "secret", ...extra },
  body: Buffer.from(body),
});

function setup({ upstreamImpl, ratePerMin = 20, start = 1_000_000 } = {}) {
  const clock = { t: start };
  const calls = [];
  const upstream = async (d) => {
    calls.push(d);
    return upstreamImpl ? upstreamImpl(d, calls.length) : json(200);
  };
  const app = createApp({ proxyKey: KEY, upstream, ratePerMin, now: () => clock.t });
  const get = (path, key = KEY, method = "GET") => app.handle({ method, url: path, headers: key === null ? {} : { "x-proxy-key": key } });
  return { app, clock, calls, get };
}

test("refuses a short key", () => {
  assert.throws(() => createApp({ proxyKey: "short", upstream: async () => json(200) }), /32/);
  assert.throws(() => createApp({ proxyKey: undefined, upstream: async () => json(200) }));
  const r = spawnSync(process.execPath, [fileURLToPath(new URL("../server.mjs", import.meta.url))], { env: { PATH: process.env.PATH, PROXY_KEY: "short" } });
  assert.equal(r.status, 1);
  assert.match(String(r.stderr), /refusing to start/);
  assert.doesNotMatch(String(r.stderr), /short/);
});

test("auth: missing or wrong key looks like a missing endpoint", async () => {
  const { get, calls } = setup();
  for (const key of [null, "", "wrong", KEY + "x", KEY.slice(1)]) {
    for (const path of ["/rdap/domain/example.pl", "/healthz", "/", "/other"]) {
      const r = await get(path, key);
      assert.equal(r.status, 404, `${path} with ${key}`);
      assert.equal(r.body.length, 0);
    }
  }
  assert.equal((await get("/rdap/domain/example.pl", null, "POST")).status, 404); // even a POST reveals nothing
  assert.equal(calls.length, 0);
  assert.equal((await get("/rdap/domain/example.pl")).status, 200);
});

test("key comparison is done on equal-length digests", () => {
  assert.equal(keyMatches(KEY, KEY), true);
  assert.equal(keyMatches("a", KEY), false);
  assert.equal(keyMatches(undefined, KEY), false);
  assert.equal(keyMatches(KEY + KEY, KEY), false);
});

test("methods and unknown paths", async () => {
  const { get } = setup();
  for (const m of ["POST", "PUT", "DELETE", "HEAD", "OPTIONS"]) assert.equal((await get("/rdap/domain/example.pl", KEY, m)).status, 405, m);
  assert.equal((await get("/")).status, 404);
  assert.equal((await get("/rdap/")).status, 404);
  assert.equal((await get("/rdap/ip/1.2.3.4")).status, 404);
  assert.equal((await get("/healthz")).status, 200);
});

test("accepts .pl names, including IDN and second-level zones", () => {
  for (const d of ["example.pl", "moja-firma.pl", "firma.com.pl", "xn--zgl-2ma.pl", "a1.waw.pl", "x".repeat(63) + ".pl"]) assert.equal(validateDomain(d), true, d);
});

test("rejects everything else", async () => {
  const bad = [
    "example.com", "example.pl.com", "pl", ".pl", "example.", "example.pl.", "Example.pl", "EXAMPLE.PL", "1.2.3.4", "127.0.0.1.pl.x",
    "example.pl:8080", "example.pl/x", "example.pl?x=1", "example.pl#a", "exa mple.pl", "exa%20mple.pl", "%65xample.pl", "../example.pl",
    "..%2fexample.pl", "-a.pl", "a-.pl", "a..pl", "a_b.pl", "ab--cd.pl", "zażółć.pl", "x".repeat(64) + ".pl", ("a".repeat(60) + ".").repeat(5) + "pl", "",
    "localhost", "[::1].pl",
  ];
  const { get, calls } = setup();
  for (const d of bad) {
    assert.equal(validateDomain(d), false, d);
    assert.equal((await get(`/rdap/domain/${d}`)).status, 400, d);
  }
  assert.equal(calls.length, 0, "nothing reached the registry");
});

test("passes 200, 404 and 429 on with only safe headers", async () => {
  const { get } = setup({ upstreamImpl: (d) => (d === "wolna.pl" ? json(404, {}, '{"errorCode":404}') : d === "limit.pl" ? json(429, { "retry-after": "17" }, "{}") : json(200)) });
  const ok = await get("/rdap/domain/example.pl");
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), '{"objectClassName":"domain"}');
  assert.equal(ok.headers["content-type"], "application/rdap+json");
  assert.equal(ok.headers["set-cookie"], undefined);
  assert.equal(ok.headers.server, undefined);
  const nf = await get("/rdap/domain/wolna.pl");
  assert.equal(nf.status, 404);
  assert.match(nf.headers["content-type"], /json/);
  const rl = await get("/rdap/domain/limit.pl");
  assert.equal(rl.status, 429);
  assert.equal(rl.headers["retry-after"], "17");
});

test("passes other upstream statuses on, turns redirects and failures into errors", async () => {
  const { get } = setup({
    upstreamImpl: (d) => {
      if (d === "a.pl") return json(503);
      if (d === "b.pl") return json(302, { location: "https://evil.example/" });
      throw new Error("boom");
    },
  });
  assert.equal((await get("/rdap/domain/a.pl")).status, 503);
  const redirect = await get("/rdap/domain/b.pl");
  assert.equal(redirect.status, 502);
  assert.equal(redirect.headers.location, undefined);
  assert.equal((await get("/rdap/domain/c.pl")).status, 504);
});

test("cache: hit, expiry, short life for 429, nothing cached for errors", async () => {
  const { get, calls, clock } = setup({ upstreamImpl: (d) => (d === "limit.pl" ? json(429, { "retry-after": "5" }) : d === "err.pl" ? json(500) : json(200)) });
  await get("/rdap/domain/example.pl");
  await get("/rdap/domain/example.pl");
  assert.equal(calls.length, 1);
  clock.t += 9 * 60_000;
  await get("/rdap/domain/example.pl");
  assert.equal(calls.length, 1, "still cached after 9 minutes");
  clock.t += 2 * 60_000;
  await get("/rdap/domain/example.pl");
  assert.equal(calls.length, 2, "expired after 10 minutes");

  await get("/rdap/domain/limit.pl");
  await get("/rdap/domain/limit.pl");
  assert.equal(calls.filter((c) => c === "limit.pl").length, 1);
  clock.t += 31_000;
  await get("/rdap/domain/limit.pl");
  assert.equal(calls.filter((c) => c === "limit.pl").length, 2, "429 is kept for 30 seconds only");

  await get("/rdap/domain/err.pl");
  await get("/rdap/domain/err.pl");
  assert.equal(calls.filter((c) => c === "err.pl").length, 2, "5xx is not cached");
});

test("cache is bounded and drops the oldest entries", async () => {
  const { get, app, calls } = setup({ ratePerMin: 100000 });
  for (let i = 0; i < 520; i++) await get(`/rdap/domain/d${i}.pl`);
  assert.equal(app.cacheSize(), 500);
  const before = calls.length;
  await get("/rdap/domain/d519.pl");
  assert.equal(calls.length, before, "newest is still cached");
  await get("/rdap/domain/d0.pl");
  assert.equal(calls.length, before + 1, "oldest was dropped");
});

test("parallel requests for one domain share one registry query", async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const { get, calls } = setup({ upstreamImpl: async () => { await gate; return json(200); } });
  const all = [get("/rdap/domain/example.pl"), get("/rdap/domain/example.pl"), get("/rdap/domain/example.pl")];
  await new Promise((r) => setTimeout(r, 10));
  release();
  const rs = await Promise.all(all);
  assert.equal(calls.length, 1);
  assert.deepEqual(rs.map((r) => r.status), [200, 200, 200]);
});

test("own rate limit to the registry: token bucket, cache hits are free", async () => {
  const { get, calls, clock } = setup({ ratePerMin: 3 });
  for (const d of ["a.pl", "b.pl", "c.pl"]) assert.equal((await get(`/rdap/domain/${d}`)).status, 200);
  const over = await get("/rdap/domain/d.pl");
  assert.equal(over.status, 429);
  assert.ok(Number(over.headers["retry-after"]) >= 1);
  assert.equal(calls.length, 3);
  assert.equal((await get("/rdap/domain/a.pl")).status, 200, "cached answers do not use the budget");
  clock.t += 20_000; // one token comes back every 20 seconds
  assert.equal((await get("/rdap/domain/d.pl")).status, 200);
  assert.equal((await get("/rdap/domain/e.pl")).status, 429);
});

test("stats count status codes only", async () => {
  const { get, app } = setup();
  await get("/rdap/domain/example.pl");
  await get("/rdap/domain/bad..pl");
  await get("/x", "nope");
  assert.deepEqual(app.drainStats(), { 200: 1, 400: 1, 404: 1 });
  assert.deepEqual(app.drainStats(), {});
});

// ---- the real upstream function, with a fake request ----
function fakeRequest(script) {
  const seen = {};
  const request = (options, cb) => {
    Object.assign(seen, options);
    const req = new EventEmitter();
    req.destroy = (err) => setImmediate(() => req.emit("error", err));
    req.end = () => script({ req, cb });
    return req;
  };
  return { request, seen };
}
const respond = (status, headers, chunks) => ({ cb }) => {
  const res = new EventEmitter();
  res.statusCode = status;
  res.headers = headers;
  cb(res);
  for (const c of chunks) res.emit("data", Buffer.from(c));
  res.emit("end");
};

test("upstream: fixed host, IPv4 only, honest user agent, no redirects followed", async () => {
  const f = fakeRequest(respond(200, { "content-type": "application/rdap+json" }, ["{}"]));
  const r = await createUpstream({ request: f.request, userAgent: "my-agent/1" })("example.pl");
  assert.equal(r.status, 200);
  assert.equal(f.seen.host, "rdap.dns.pl");
  assert.equal(f.seen.family, 4);
  assert.equal(f.seen.path, "/domain/example.pl");
  assert.equal(f.seen.headers["user-agent"], "my-agent/1");
  assert.equal(f.seen.headers.accept, "application/rdap+json");
  assert.equal(f.seen.timeout, 8000);
  const redirect = fakeRequest(respond(301, { location: "https://elsewhere.example/" }, []));
  assert.equal((await createUpstream({ request: redirect.request })("example.pl")).status, 301); // handed to the app, which turns it into 502
});

test("upstream: response size limit", async () => {
  const big = "x".repeat(100 * 1024);
  const f = fakeRequest(({ req, cb }) => {
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    cb(res);
    for (let i = 0; i < 4; i++) res.emit("data", Buffer.from(big));
  });
  await assert.rejects(createUpstream({ request: f.request })("example.pl"), /too_large/);
});

test("upstream: timeout", async () => {
  const f = fakeRequest(({ req }) => setImmediate(() => req.emit("timeout")));
  await assert.rejects(createUpstream({ request: f.request })("example.pl"), /timeout/);
});

// ---- over a real socket on loopback ----
test("serves over HTTP on loopback", async () => {
  const { app } = setup();
  const server = createHttpServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/rdap/domain/example.pl`)).status, 404);
    const ok = await fetch(`${base}/rdap/domain/example.pl`, { headers: { "x-proxy-key": KEY } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).objectClassName, "domain");
    assert.equal((await fetch(`${base}/rdap/domain/example.com`, { headers: { "x-proxy-key": KEY } })).status, 400);
    assert.equal((await fetch(`${base}/rdap/domain/example.pl`, { method: "POST", headers: { "x-proxy-key": KEY } })).status, 405);
  } finally {
    server.close();
  }
});
