import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  assessExpiry, findDomainService, findIpService, mapStatus, mapStatuses, parseBootstrap, parseDomainRdap, parseIpNetwork,
} from "../src/rdap";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

describe("parseDomainRdap", () => {
  it("reads a .pl style answer", () => {
    const r = parseDomainRdap(fixture("rdap-pl.json"))!;
    expect(r.registrar).toBe("Example Registrar SAS");
    expect(r.registered).toBe("2024-07-18T07:14:08.000Z");
    expect(r.expires).toBe("2028-07-18T07:14:08.000Z");
    expect(r.changed).toBe("2026-07-08T10:57:23.000Z");
    expect(r.nameservers).toEqual(["princess.ns.cloudflare.com", "vicky.ns.cloudflare.com"]);
    expect(r.dnssec).toBe("unsigned");
    expect(r.delayed).toBe(true);
    expect(r.statuses.map((s) => s.id)).toEqual(["ok"]);
  });

  it("reads a .com style answer", () => {
    const r = parseDomainRdap(fixture("rdap-com.json"))!;
    expect(r.registrar).toBe("Example Registrar, Inc.");
    expect(r.dnssec).toBe("signed");
    expect(r.delayed).toBe(false);
    expect(r.statuses.map((s) => s.id)).toEqual(["delete_lock", "transfer_lock", "update_lock"]);
  });

  it("never lets personal data through", () => {
    for (const name of ["rdap-pl.json", "rdap-com.json"]) {
      const out = JSON.stringify(parseDomainRdap(fixture(name)));
      for (const secret of ["Jan Kowalski", "Anna Nowak", "Abuse Person", "Przykladowa", "500600700", "invalid", "Olsztyn", "10-000"]) {
        expect(out, `${name} leaks ${secret}`).not.toContain(secret);
      }
    }
  });

  it("drops a registrar that is marked as a private person", () => {
    const body = { objectClassName: "domain", entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Jan Prywatny"], ["kind", {}, "text", "individual"]]] }] };
    expect(parseDomainRdap(body)!.registrar).toBeNull();
  });

  it("copes with missing and malformed parts", () => {
    const r = parseDomainRdap({ objectClassName: "domain", events: [{ eventAction: "expiration", eventDate: "not a date" }], nameservers: [null, { ldhName: 5 }] })!;
    expect(r.expires).toBeNull();
    expect(r.nameservers).toEqual([]);
    expect(r.dnssec).toBe("unknown");
    expect(parseDomainRdap({ objectClassName: "nameserver" })).toBeNull();
    expect(parseDomainRdap("<html>")).toBeNull();
    expect(parseDomainRdap(null)).toBeNull();
  });
});

describe("status mapping", () => {
  it("maps the common codes", () => {
    expect(mapStatus("client transfer prohibited")).toBe("transfer_lock");
    expect(mapStatus("clientTransferProhibited")).toBe("transfer_lock");
    expect(mapStatus("server_transfer_prohibited")).toBe("transfer_lock");
    expect(mapStatus("clientUpdateProhibited")).toBe("update_lock");
    expect(mapStatus("server delete prohibited")).toBe("delete_lock");
    expect(mapStatus("client renew prohibited")).toBe("renew_lock");
    expect(mapStatus("clientHold")).toBe("hold");
    expect(mapStatus("server hold")).toBe("hold");
    expect(mapStatus("active")).toBe("ok");
    expect(mapStatus("ok")).toBe("ok");
    expect(mapStatus("pending delete")).toBe("pending_delete");
    expect(mapStatus("redemption period")).toBe("redemption");
    expect(mapStatus("auto renew period")).toBe("grace_period");
    expect(mapStatus("something new")).toBe("other");
  });

  it("shows equivalent codes once and keeps unknown ones", () => {
    const s = mapStatuses(["client transfer prohibited", "server transfer prohibited", "weird", "weird2", 5, "x".repeat(200)]);
    expect(s.map((x) => x.id)).toEqual(["transfer_lock", "other", "other"]);
  });
});

describe("assessExpiry", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const inDays = (n: number) => new Date(now.getTime() + n * 86_400_000).toISOString();
  it("classifies by days left", () => {
    expect(assessExpiry(inDays(-3), now)).toMatchObject({ level: "expired", days: -3 });
    expect(assessExpiry(inDays(3), now)).toMatchObject({ level: "high", days: 3 });
    expect(assessExpiry(inDays(6.9), now)).toMatchObject({ level: "high" });
    expect(assessExpiry(inDays(7), now)).toMatchObject({ level: "medium" });
    expect(assessExpiry(inDays(29), now)).toMatchObject({ level: "medium" });
    expect(assessExpiry(inDays(30), now)).toMatchObject({ level: "ok" });
    expect(assessExpiry(inDays(500), now)).toMatchObject({ level: "ok", days: 500 });
  });
  it("is unknown without a valid date", () => {
    expect(assessExpiry(null, now).level).toBe("unknown");
    expect(assessExpiry("garbage", now).level).toBe("unknown");
  });
});

describe("bootstrap files", () => {
  const dns = parseBootstrap({ services: [[["com", "net"], ["http://old.example/", "https://rdap.verisign.com/com/v1/"]], [["pl"], ["https://rdap.dns.pl"]], [["xx"], ["http://insecure.example/"]], "junk"] })!;
  it("finds the registry for a ending and insists on HTTPS", () => {
    expect(findDomainService(dns, "com")).toBe("https://rdap.verisign.com/com/v1/");
    expect(findDomainService(dns, "PL")).toBe("https://rdap.dns.pl/");
    expect(findDomainService(dns, "xx")).toBeNull();
    expect(findDomainService(dns, "zz")).toBeNull();
  });
  it("picks the most specific IP block", () => {
    const v4 = parseBootstrap({ services: [[["1.0.0.0/8"], ["https://rdap.apnic.example/"]], [["1.1.1.0/24"], ["https://rdap.special.example/"]]] })!;
    expect(findIpService(v4, "1.1.1.1")).toBe("https://rdap.special.example/");
    expect(findIpService(v4, "1.2.3.4")).toBe("https://rdap.apnic.example/");
    expect(findIpService(v4, "9.9.9.9")).toBeNull();
    const v6 = parseBootstrap({ services: [[["2a00::/12"], ["https://rdap.db.ripe.example/"]]] })!;
    expect(findIpService(v6, "2a01:4f8::1")).toBe("https://rdap.db.ripe.example/");
    expect(findIpService(v6, "2606:4700::1")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(parseBootstrap({})).toBeNull();
    expect(parseBootstrap(null)).toBeNull();
  });
});

describe("parseIpNetwork", () => {
  it("keeps the network name, organisation and country, but not people", () => {
    const n = parseIpNetwork(fixture("rdap-ip.json"))!;
    expect(n).toEqual({ name: "EXAMPLE-NET", organisation: "Example Hosting Sp. z o.o.", country: "PL", cidr: "203.0.114.0/24" });
    expect(JSON.stringify(n)).not.toContain("Tech Person");
  });
  it("returns null for other objects", () => {
    expect(parseIpNetwork({ objectClassName: "domain" })).toBeNull();
    expect(parseIpNetwork({ objectClassName: "ip network" })).toBeNull();
  });
});

import { registryInfoUrl } from "../src/registryinfo";

describe("registryInfoUrl", () => {
  it("builds the IANA page of the ending", () => {
    expect(registryInfoUrl("firma.de")).toBe("https://www.iana.org/domains/root/db/de.html");
    expect(registryInfoUrl("startup.io")).toBe("https://www.iana.org/domains/root/db/io.html");
    expect(registryInfoUrl("Przyklad.PL")).toBe("https://www.iana.org/domains/root/db/pl.html");
    expect(registryInfoUrl("example.co.uk")).toBe("https://www.iana.org/domains/root/db/uk.html");
    expect(registryInfoUrl("xn--80ak6aa92e.xn--p1ai")).toBe("https://www.iana.org/domains/root/db/xn--p1ai.html");
  });
  it("gives nothing for anything that is not a plain ending", () => {
    for (const d of ["a.b/../c", "firma.d3", "firma.x_y", "firma.", "a.b?x=1", "firma.xn--", "firma.1", "firma.<script>"]) expect(registryInfoUrl(d), d).toBeNull();
  });
});
