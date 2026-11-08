import { describe, expect, it } from "vitest";
import { Net, USER_AGENT } from "../src/net.js";

describe("outgoing requests", () => {
  it("identify the tool honestly with a descriptive User-Agent", async () => {
    let seen: Record<string, string> = {};
    const net = new Net(async (_url, init) => {
      seen = init?.headers as Record<string, string>;
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    });
    await net.getJson("https://example.invalid/test", "application/rdap+json");
    expect(seen["user-agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^whois-demo\/\d/);
    expect(USER_AGENT).toContain("https://whois.piotrmajkutewicz.pl");
    // It names the tool; it must not pretend to be a browser.
    expect(USER_AGENT).not.toMatch(/Mozilla|Chrome|Safari|AppleWebKit/i);
    expect(seen.accept).toBe("application/rdap+json");
  });
});
