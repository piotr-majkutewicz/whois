import { describe, expect, it } from "vitest";
import { isNullMx, parseDohResponse, parseMx, parseTxtData, recordsOf } from "../src/dns";
import { classifyIp, inCidr, parseIp } from "../src/ip";
import { detectProviders, matchProvider } from "../src/providers";

describe("DoH parsing", () => {
  it("joins TXT chunks and strips quotes", () => {
    expect(parseTxtData('"v=spf1 -all"')).toBe("v=spf1 -all");
    expect(parseTxtData('"abc" "def"')).toBe("abcdef");
    expect(parseTxtData('"say \\"hi\\""')).toBe('say "hi"');
  });

  it("parses answers and normalises names", () => {
    const a = parseDohResponse({
      Status: 0, AD: true,
      Answer: [
        { name: "Example.com.", type: 15, TTL: 300, data: "10 Mail.Example.com." },
        { name: "example.com.", type: 2, TTL: 300, data: "NS1.Example.com." },
        { name: "example.com.", type: 16, TTL: 60, data: '"v=spf1 -all"' },
        { name: "example.com.", type: 99, TTL: 60, data: "ignored" },
      ],
    });
    expect(a.state).toBe("ok");
    if (a.state !== "ok") return;
    expect(a.authenticated).toBe(true);
    expect(recordsOf(a, "MX")[0]!.data).toBe("10 mail.example.com");
    expect(recordsOf(a, "NS")[0]!.data).toBe("ns1.example.com");
    expect(recordsOf(a, "TXT")[0]!.data).toBe("v=spf1 -all");
    expect(a.records).toHaveLength(3);
  });

  it("treats NXDOMAIN as an answer and SERVFAIL as a failure", () => {
    expect(parseDohResponse({ Status: 3 })).toMatchObject({ state: "ok", rcode: 3, records: [] });
    expect(parseDohResponse({ Status: 2 })).toEqual({ state: "failed" });
    expect(parseDohResponse({ Status: 5 })).toEqual({ state: "failed" });
    expect(parseDohResponse("nope")).toEqual({ state: "failed" });
    expect(parseDohResponse({})).toEqual({ state: "failed" });
  });

  it("sorts MX by priority and detects a null MX", () => {
    const a = parseDohResponse({ Status: 0, Answer: [{ name: "x.", type: 15, TTL: 1, data: "20 b.x." }, { name: "x.", type: 15, TTL: 1, data: "10 a.x." }] });
    expect(parseMx(recordsOf(a, "MX")).map((m) => m.host)).toEqual(["a.x", "b.x"]);
    const nul = parseDohResponse({ Status: 0, Answer: [{ name: "x.", type: 15, TTL: 1, data: "0 ." }] });
    expect(isNullMx(parseMx(recordsOf(nul, "MX")))).toBe(true);
  });
});

describe("IP classification", () => {
  it("flags private and special IPv4 ranges", () => {
    for (const ip of ["10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "127.0.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "192.0.2.5", "198.51.100.1", "203.0.113.9", "198.18.0.1"]) {
      expect(classifyIp(ip), ip).not.toBe("public");
    }
  });
  it("accepts public IPv4", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "172.32.0.1", "172.15.255.255", "93.184.216.34", "100.63.255.255"]) expect(classifyIp(ip), ip).toBe("public");
  });
  it("handles IPv6", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "2002:c000:0204::1", "64:ff9b::1", "::ffff:7f00:1"]) {
      expect(classifyIp(ip), ip).not.toBe("public");
    }
    for (const ip of ["2606:4700:4700::1111", "2a01:4f8::1", "::ffff:8.8.8.8"]) expect(classifyIp(ip), ip).toBe("public");
  });
  it("rejects malformed addresses", () => {
    for (const ip of ["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "::g", "1::2::3", "example.com"]) expect(classifyIp(ip), ip).toBe("invalid");
  });
  it("matches CIDR blocks", () => {
    expect(inCidr(parseIp("10.1.2.3")!, "10.0.0.0/8")).toBe(true);
    expect(inCidr(parseIp("11.1.2.3")!, "10.0.0.0/8")).toBe(false);
    expect(inCidr(parseIp("2a01:4f8::1")!, "2a00::/12")).toBe(true);
    expect(inCidr(parseIp("1.2.3.4")!, "2a00::/12")).toBe(false);
  });
});

describe("provider detection", () => {
  it("recognises mail providers from MX hosts", () => {
    expect(matchProvider("aspmx.l.google.com")?.id).toBe("google");
    expect(matchProvider("example-pl.mail.protection.outlook.com")?.id).toBe("microsoft");
    expect(matchProvider("mx1.mail.ovh.net")?.id).toBe("ovh");
    expect(matchProvider("mx.zoho.eu")?.id).toBe("zoho");
    expect(matchProvider("poczta.home.pl")?.id).toBe("homepl");
    expect(matchProvider("mx1.cyberfolks.pl")?.id).toBe("cyberfolks");
    expect(matchProvider("mail.nazwa.pl")?.id).toBe("nazwapl");
  });
  it("recognises DNS providers and respects label boundaries", () => {
    expect(matchProvider("ns-1234.awsdns-12.org")?.id).toBe("aws");
    expect(matchProvider("kate.ns.cloudflare.com")?.id).toBe("cloudflare");
    expect(matchProvider("evilgoogle.com")).toBeNull();
    expect(matchProvider("google.com.evil.example")).toBeNull();
    expect(matchProvider("ns.unknown.example")).toBeNull();
  });
  it("groups hosts by provider", () => {
    const m = detectProviders("mail", ["aspmx.l.google.com", "alt1.aspmx.l.google.com", "mx.other.example"]);
    expect(m).toHaveLength(1);
    expect(m[0]!.hosts).toHaveLength(2);
  });
});
