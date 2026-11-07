import { describe, expect, it } from "vitest";
import { parseDomainInput } from "../src/domain";
import { decodePunycode } from "../src/punycode";

const ok = (input: string) => {
  const r = parseDomainInput(input);
  if (!r.ok) throw new Error(`rejected: ${r.reason}`);
  return r;
};
const reason = (input: unknown) => {
  const r = parseDomainInput(input);
  return r.ok ? "accepted" : r.reason;
};

describe("parseDomainInput", () => {
  it("accepts a plain domain and lowercases it", () => {
    expect(ok("Example.PL").domain).toBe("example.pl");
  });

  it("reduces www and other subdomains to the registrable domain", () => {
    const r = ok("www.example.pl");
    expect(r.domain).toBe("example.pl");
    expect(r.submittedHost).toBe("www.example.pl");
    expect(ok("mail.sklep.example.com").domain).toBe("example.com");
  });

  it("understands multi-label public suffixes", () => {
    expect(ok("www.firma.com.pl").domain).toBe("firma.com.pl");
    expect(ok("firma.waw.pl").domain).toBe("firma.waw.pl");
    expect(ok("shop.example.co.uk").domain).toBe("example.co.uk");
    expect(ok("firma.com.pl").suffix).toBe("com.pl");
    expect(reason("com.pl")).toBe("public_suffix");
  });

  it("extracts the host from URLs", () => {
    expect(ok("https://www.example.com/path?q=1#x").domain).toBe("example.com");
    expect(ok("http://user:pass@example.com:8080/").domain).toBe("example.com");
    expect(ok("  example.com/  ").domain).toBe("example.com");
  });

  it("extracts the domain from e-mail addresses", () => {
    expect(ok("jan.kowalski@firma.pl").domain).toBe("firma.pl");
    expect(ok("mailto:biuro@www.firma.pl").domain).toBe("firma.pl");
  });

  it("handles IDN through punycode and shows the readable form", () => {
    const r = ok("zażółć-gęślą.pl");
    expect(r.domain).toMatch(/^xn--/);
    expect(r.unicode).toBe("zażółć-gęślą.pl");
    expect(ok("münchen.de").domain).toBe("xn--mnchen-3ya.de");
    expect(ok("xn--mnchen-3ya.de").unicode).toBe("münchen.de");
  });

  it("accepts hyphens inside labels", () => {
    expect(ok("moja-firma-2.pl").domain).toBe("moja-firma-2.pl");
    expect(reason("-firma.pl")).toBe("invalid_label");
    expect(reason("firma-.pl")).toBe("invalid_label");
  });

  it("rejects IP addresses in every notation", () => {
    expect(reason("127.0.0.1")).toBe("ip_address");
    expect(reason("http://8.8.8.8/")).toBe("ip_address");
    expect(reason("2130706433")).toBe("ip_address"); // the URL parser turns it into 127.0.0.1
    expect(reason("http://2130706433/")).toBe("ip_address");
    expect(reason("[::1]")).toBe("ip_address");
    expect(reason("http://[2001:db8::1]/")).toBe("ip_address");
    expect(reason("0x7f.0.0.1")).toBe("ip_address");
  });

  it("rejects local names and names without a dot", () => {
    expect(reason("localhost")).toBe("local_name");
    expect(reason("app.localhost")).toBe("local_name");
    expect(reason("printer.local")).toBe("local_name");
    expect(reason("intranet")).toBe("local_name");
    expect(reason("firma")).toBe("no_dot");
  });

  it("rejects invalid input", () => {
    expect(reason("")).toBe("empty");
    expect(reason("   ")).toBe("empty");
    expect(reason(42)).toBe("empty");
    expect(reason("a".repeat(64) + ".com")).toBe("invalid_label");
    expect(reason(("a".repeat(60) + ".").repeat(5) + "com")).toBe("too_long");
    expect(reason("x".repeat(3000))).toBe("too_long");
    expect(reason("exa mple.com")).toBe("invalid_chars");
    expect(reason("exa_mple.com")).toBe("invalid_chars");
    expect(reason("example.123")).toBe("invalid_chars");
    expect(reason("example..com")).toBe("invalid_label");
    expect(reason("ftp://example.com")).toBe("invalid_chars"); // only http(s) URLs are understood
  });
});

describe("punycode", () => {
  it("decodes known labels", () => {
    expect(decodePunycode("mnchen-3ya")).toBe("münchen");
    expect(decodePunycode("!!")).toBeNull();
  });
});
