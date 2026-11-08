# RDAP proxy for the .pl registry

A tiny service (one file, Node 22, no dependencies) that fetches `https://rdap.dns.pl/domain/<name>` on behalf of the whois Worker. The `.pl` registry rate-limits (HTTP 429) the shared address pool that Cloudflare Workers use, but answers normally from other addresses. This proxy runs on a server of your own and is reachable **only** by the Worker.

## Security model

Layers, from the outside in:

1. **No open ports.** The compose file publishes nothing. `cloudflared` only makes an outbound connection to Cloudflare, and the proxy listens only on the private Docker network.
2. **Cloudflare Access (optional).** A service token in front of the tunnel hostname: Cloudflare rejects anything without `CF-Access-Client-Id` and `CF-Access-Client-Secret` before it reaches the server.
3. **Shared secret.** Every request needs `x-proxy-key` equal to `PROXY_KEY` (at least 32 characters, otherwise the server refuses to start). The comparison is constant time. A missing or wrong key gets an empty `404`, the same as any unknown path.
4. **Strict input.** Only `GET /rdap/domain/<name>`, where the name is lowercase ASCII, digits, hyphens or punycode, and ends in `.pl` (`com.pl` and similar are fine). IP addresses, ports, paths, queries, `%`, spaces and upper case get `400`. The upstream host is fixed in the code (`rdap.dns.pl`), the request is forced to IPv4 (the registry has no IPv6), redirects are not followed, the answer is capped at 256 KB and the call times out after 8 s.
5. **Limits and cache.** At most `RATE_PER_MIN` (default 20) requests per minute go to the registry, answers are cached for 10 minutes (404 too) and 429 for 30 seconds, and parallel requests for one domain share a single query. When the budget is exhausted the proxy answers `429` with `Retry-After`.

Hardening of the container: non-root user, read-only filesystem, all capabilities dropped, `no-new-privileges`, 64 MB memory limit. Logs hold only counters per status code, once a minute: no addresses and no domain names.

The proxy passes the registry's body through unchanged (the Worker filters out personal data, see the main README) and forwards only `content-type` and `retry-after`.

## What it does not do

It does not serve any other registry or endpoint, does not store anything on disk, does not authenticate users, does not make a lookup "better" than the registry's own answer, and does not bypass a block: if the registry limits your server's address too, you will get `429` as well (see the end of this file).

## Setup on the VPS (Docker)

1. **Create a tunnel.** In Cloudflare Zero Trust: Networks > Tunnels > Create a tunnel > Cloudflared. Name it, copy the **tunnel token** (the long string after `--token`). Do not paste it anywhere except the `.env` file below.
2. **Add a public hostname** to the tunnel, for example `rdap-proxy.piotrmajkutewicz.pl` (any hostname in a zone on your account), service type `HTTP`, URL `http://rdap-proxy:8080`. The container name resolves on the compose network. For a hostname in your own zone Cloudflare creates the DNS record automatically.
3. **Copy this directory** to the server and create the settings:
   ```sh
   cd proxy
   cp .env.example .env
   chmod 600 .env
   # fill in PROXY_KEY (openssl rand -hex 32) and TUNNEL_TOKEN
   ```
4. **Start it:**
   ```sh
   docker compose up -d --build
   docker compose ps          # both services running, rdap-proxy "healthy"
   docker compose logs cloudflared | tail   # "Registered tunnel connection"
   ```
   `cloudflared` runs as `tunnel --no-autoupdate run` and reads `TUNNEL_TOKEN` from the environment (the documented way to pass the token without putting it on the command line).
5. **Optional: Cloudflare Access.** In Zero Trust: Access > Service Auth > create a service token (keep the id and secret). Under Access > Applications add a self-hosted application for the tunnel hostname with a policy of action `Service Auth` that includes this token. The Worker then also sends `CF-Access-Client-Id` and `CF-Access-Client-Secret`.
6. **Configure the Worker** (from the repository root; the values are asked for interactively, so they do not end up in your shell history):
   ```sh
   npx wrangler secret put RDAP_PROXY_URL             # https://rdap-proxy.piotrmajkutewicz.pl
   npx wrangler secret put RDAP_PROXY_KEY             # same value as PROXY_KEY
   npx wrangler secret put RDAP_PROXY_ACCESS_ID       # only with Access
   npx wrangler secret put RDAP_PROXY_ACCESS_SECRET   # only with Access
   ```
   `RDAP_PROXY_URL` must be `https`, a host name (no IP address), no port, no path.

## Smoke tests

```sh
H=https://rdap-proxy.piotrmajkutewicz.pl
K=...   # PROXY_KEY

curl -s -o /dev/null -w '%{http_code}\n' $H/rdap/domain/example.pl                      # 404 (no key)
curl -s -o /dev/null -w '%{http_code}\n' -H "x-proxy-key: $K" $H/rdap/domain/example.com  # 400 (not .pl)
curl -s -H "x-proxy-key: $K" $H/rdap/domain/example.pl | head -c 300                      # RDAP JSON
```
With Access enabled add `-H "CF-Access-Client-Id: ..." -H "CF-Access-Client-Secret: ..."` to each.

From the VPS itself, check that the registry answers your outgoing IPv4 address and see which address that is:
```sh
curl -4 -s https://api.ipify.org; echo        # outgoing IPv4 address
curl -4 -s -o /dev/null -w '%{http_code}\n' -H 'accept: application/rdap+json' https://rdap.dns.pl/domain/example.pl
```
`200` or `404` is fine, `429` means the registry limits this address as well.

## Running and testing locally

```sh
node --test                                         # offline unit tests, nothing to install
PROXY_KEY=$(openssl rand -hex 32) PORT=8973 HOST=127.0.0.1 node server.mjs
```

## Maintenance

- Update: `git pull && docker compose up -d --build`, and `docker compose pull cloudflared && docker compose up -d` for the tunnel client (auto-update is off on purpose, updates are yours to schedule).
- Rotate the key: change `PROXY_KEY` in `.env`, `docker compose up -d`, then `wrangler secret put RDAP_PROXY_KEY`.
- Settings: `RATE_PER_MIN` (default 20) and `USER_AGENT` (default `whois-demo-proxy/1.0 (+https://whois.piotrmajkutewicz.pl)`; it introduces the service honestly, do not imitate a browser).

## If the registry still limits you

If `curl -4` from the VPS gets `429` too, lower `RATE_PER_MIN`, keep the cache as it is, and contact NASK (the `.pl` registry, see the contact details on https://www.dns.pl/) with the outgoing address, the purpose (a small public tool that shows registration data) and the request rate. The Worker keeps working in the meantime: it falls back to asking the registry directly and shows a friendly "try again in a moment" message.
