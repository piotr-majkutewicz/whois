import { describe, expect, it } from "vitest";
import { analyzeMail, pickTop, type MailInput } from "../src/analyze";
import { parseDmarc } from "../src/dmarc";
import { parseDohResponse, type DnsAnswer } from "../src/dns";
import { evaluateSpf, parseSpf, type SpfFetch } from "../src/spf";

describe("parseSpf", () => {
  it("reads mechanisms, qualifiers and the final all", () => {
    const r = parseSpf("v=spf1 ip4:1.2.3.0/24 include:_spf.google.com a mx ~all");
    expect(r.all).toBe("~");
    expect(r.errors).toEqual([]);
    expect(r.terms.map((t) => t.mechanism)).toEqual(["ip4", "include", "a", "mx", "all"]);
  });
  it("detects +all, ?all and -all", () => {
    expect(parseSpf("v=spf1 +all").all).toBe("+");
    expect(parseSpf("v=spf1 all").all).toBe("+");
    expect(parseSpf("v=spf1 ?all").all).toBe("?");
    expect(parseSpf("v=spf1 -all").all).toBe("-");
  });
  it("flags broken syntax and unknown mechanisms", () => {
    expect(parseSpf("v=spf1 include: -all").errors).toContain("bad_syntax");
    expect(parseSpf("v=spf1 ip4 -all").errors).toContain("bad_syntax");
    expect(parseSpf("v=spf1 foo:bar -all").errors).toContain("unknown_term");
    expect(parseSpf("v=spf1 inc1ude:x.com -all").errors).toContain("unknown_term");
    expect(parseSpf("v=spf1 redirect= ").errors).toContain("bad_syntax");
  });
  it("reads redirect and ignores exp", () => {
    const r = parseSpf("v=spf1 redirect=_spf.example.com exp=why.example.com");
    expect(r.redirect).toBe("_spf.example.com");
    expect(r.all).toBeNull();
    expect(r.errors).toEqual([]);
  });
});

const fakeDns = (zone: Record<string, string[] | "fail">) => async (name: string): Promise<SpfFetch> => {
  const v = zone[name];
  if (v === "fail") return { state: "failed" };
  return { state: "ok", records: v ?? [] };
};

describe("evaluateSpf", () => {
  it("counts nested includes", async () => {
    const zone = {
      "a.example": ["v=spf1 include:b.example include:c.example -all"],
      "b.example": ["v=spf1 a mx -all"],
      "c.example": ["v=spf1 include:d.example ~all"],
      "d.example": ["v=spf1 ip4:1.2.3.4 -all"],
    };
    const r = await evaluateSpf("root.example", "v=spf1 a include:a.example -all", fakeDns(zone));
    // root: a, include:a. a.example: include:b, include:c. b: a, mx. c: include:d.
    expect(r.lookups).toBe(7);
  });

  it("counts exactly as a receiver does", async () => {
    const zone = {
      "inc.example": ["v=spf1 a mx -all"], // 2 more
    };
    const r = await evaluateSpf("root.example", "v=spf1 include:inc.example a -all", fakeDns(zone));
    expect(r.lookups).toBe(4); // include, a, mx inside, a at the top
    expect(r.exceeded).toBe(false);
    expect(r.complete).toBe(true);
  });

  it("is fine with exactly 10 and fails with 11", async () => {
    const ten = "v=spf1 " + Array.from({ length: 10 }, (_, i) => `include:i${i}.example`).join(" ") + " -all";
    const eleven = "v=spf1 " + Array.from({ length: 11 }, (_, i) => `include:i${i}.example`).join(" ") + " -all";
    const zone: Record<string, string[]> = {};
    for (let i = 0; i < 11; i++) zone[`i${i}.example`] = ["v=spf1 ip4:1.2.3.4 -all"];
    const r10 = await evaluateSpf("root.example", ten, fakeDns(zone));
    expect(r10.lookups).toBe(10);
    expect(r10.exceeded).toBe(false);
    const r11 = await evaluateSpf("root.example", eleven, fakeDns(zone));
    expect(r11.exceeded).toBe(true);
    expect(r11.lookups).toBe(11);
  });

  it("stops following includes once the limit is passed", async () => {
    let fetched = 0;
    const record = "v=spf1 " + Array.from({ length: 30 }, (_, i) => `include:i${i}.example`).join(" ") + " -all";
    const r = await evaluateSpf("root.example", record, async () => {
      fetched++;
      return { state: "ok", records: ["v=spf1 ip4:1.2.3.4 -all"] };
    });
    expect(r.exceeded).toBe(true);
    expect(fetched).toBeLessThanOrEqual(10);
  });

  it("survives a cycle", async () => {
    const zone = { "a.example": ["v=spf1 include:b.example -all"], "b.example": ["v=spf1 include:a.example -all"] };
    const r = await evaluateSpf("root.example", "v=spf1 include:a.example -all", fakeDns(zone));
    expect(r.problems.some((p) => p.reason === "cycle")).toBe(true);
    expect(r.lookups).toBeLessThan(10);
  });

  it("survives a self-include of the root", async () => {
    const r = await evaluateSpf("root.example", "v=spf1 include:root.example -all", fakeDns({}));
    expect(r.problems.map((p) => p.reason)).toContain("cycle");
  });

  it("reports missing, duplicated and unreachable includes", async () => {
    const zone = { "dup.example": ["v=spf1 -all", "v=spf1 +all"], "down.example": "fail" as const };
    const r = await evaluateSpf("root.example", "v=spf1 include:none.example include:dup.example include:down.example -all", fakeDns(zone));
    expect(r.problems.map((p) => p.reason).sort()).toEqual(["missing", "multiple", "unreachable"]);
    expect(r.complete).toBe(false);
  });

  it("follows redirect for the terminal qualifier", async () => {
    const zone = { "shared.example": ["v=spf1 ip4:1.2.3.4 ~all"] };
    const r = await evaluateSpf("root.example", "v=spf1 redirect=shared.example", fakeDns(zone));
    expect(r.terminal).toBe("~");
    expect(r.lookups).toBe(1);
  });

  it("limits the depth", async () => {
    const zone: Record<string, string[]> = {};
    // A straight chain: n0 includes n1 includes n2 ... Each level is one lookup, so the limit of 10 triggers first
    for (let i = 0; i < 30; i++) zone[`n${i}.example`] = [`v=spf1 include:n${i + 1}.example -all`];
    const r = await evaluateSpf("root.example", "v=spf1 include:n0.example -all", fakeDns(zone));
    expect(r.exceeded).toBe(true);
  });

  it("stops at the time limit and says the count is incomplete", async () => {
    let t = 0;
    const zone = { "a.example": ["v=spf1 -all"], "b.example": ["v=spf1 -all"] };
    const r = await evaluateSpf("root.example", "v=spf1 include:a.example include:b.example -all", async (d) => {
      t += 2000;
      return fakeDns(zone)(d);
    }, { deadlineMs: 1500, now: () => t });
    expect(r.complete).toBe(false);
  });
});

describe("parseDmarc", () => {
  it("reads policy, pct and counts report addresses without keeping them", () => {
    const r = parseDmarc("v=DMARC1; p=quarantine; pct=50; rua=mailto:a@x.example, mailto:b@y.example; adkim=s");
    expect(r).toEqual({ valid: true, policy: "quarantine", subdomainPolicy: null, pct: 50, ruaCount: 2 });
    expect(JSON.stringify(r)).not.toContain("x.example");
  });
  it("is invalid without a policy or with a bad one", () => {
    expect(parseDmarc("v=DMARC1; rua=mailto:a@x.example").valid).toBe(false);
    expect(parseDmarc("v=DMARC1; p=banana").valid).toBe(false);
    expect(parseDmarc("v=DMARC1; p=reject; pct=abc").pct).toBe(100);
  });
  it("handles p=none and sp", () => {
    const r = parseDmarc("v=DMARC1;p=none;sp=reject");
    expect(r.policy).toBe("none");
    expect(r.subdomainPolicy).toBe("reject");
  });
});

// ---- mail analysis ----
const ans = (status: number, ...answers: [number, string][]): DnsAnswer =>
  parseDohResponse({ Status: status, Answer: answers.map(([type, data]) => ({ name: "x.", type, TTL: 1, data })) });
const txt = (...v: string[]) => ans(0, ...v.map((x): [number, string] => [16, JSON.stringify(x)]));
const none = () => ans(0);
const FAILED: DnsAnswer = { state: "failed" };

function input(over: Partial<MailInput> = {}): MailInput {
  return {
    mx: ans(0, [15, "10 mx.example.com."]),
    txt: txt("v=spf1 include:_spf.example.com -all"),
    dmarc: txt("v=DMARC1; p=reject; rua=mailto:r@example.com"),
    mtaSts: txt("v=STSv1; id=1"),
    tlsRpt: txt("v=TLSRPTv1; rua=mailto:t@example.com"),
    dkim: [{ selector: "google", answer: txt("v=DKIM1; k=rsa; p=ABC") }, { selector: "default", answer: ans(3) }],
    spfEvaluation: { lookups: 2, complete: true, exceeded: false, terminal: "-", problems: [] },
    ...over,
  };
}
const keys = (r: ReturnType<typeof analyzeMail>) => r.findings.map((f) => f.key);

describe("analyzeMail", () => {
  it("rates a complete setup as good", () => {
    const r = analyzeMail(input());
    expect(r.findings).toEqual([]);
    expect(r.mail.rating).toBe("good");
    expect(r.mail.dkim.found).toEqual([{ selector: "google", kind: "txt" }]);
    expect(r.mail.spf).toMatchObject({ state: "one", terminal: "-", lookups: 2 });
  });

  it("rates missing SPF as a risk", () => {
    const r = analyzeMail(input({ txt: txt("google-site-verification=abc"), spfEvaluation: null }));
    expect(keys(r)).toContain("spf.missing");
    expect(r.findings.find((f) => f.key === "spf.missing")!.severity).toBe("high");
    expect(r.mail.rating).toBe("risk");
  });

  it("flags two SPF records", () => {
    const r = analyzeMail(input({ txt: txt("v=spf1 -all", "v=spf1 include:x.example -all"), spfEvaluation: null }));
    expect(keys(r)).toContain("spf.multiple");
    expect(r.mail.rating).toBe("risk");
  });

  it("flags +all, ?all, ~all and a missing all", () => {
    const base = (terminal: "+" | "?" | "~" | null) => analyzeMail(input({ spfEvaluation: { lookups: 1, complete: true, exceeded: false, terminal, problems: [] } }));
    expect(keys(base("+"))).toContain("spf.plus_all");
    expect(keys(base("?"))).toContain("spf.neutral_all");
    expect(base("?").mail.rating).toBe("improve");
    expect(keys(base("~"))).toContain("spf.softfail");
    expect(base("~").mail.rating).toBe("good"); // only a low finding
    expect(keys(analyzeMail(input({ txt: txt("v=spf1 ip4:1.2.3.4"), spfEvaluation: { lookups: 0, complete: true, exceeded: false, terminal: null, problems: [] } })))).toContain("spf.no_all");
  });

  it("flags a broken SPF record", () => {
    const r = analyzeMail(input({ txt: txt("v=spf1 includ:oops -all"), spfEvaluation: null }));
    expect(keys(r)).toContain("spf.syntax");
    expect(r.mail.rating).toBe("risk");
  });

  it("flags more than 10 lookups and cycles", () => {
    const r = analyzeMail(input({ spfEvaluation: { lookups: 11, complete: true, exceeded: true, terminal: "-", problems: [{ domain: "x", reason: "cycle" }] } }));
    expect(keys(r)).toEqual(expect.arrayContaining(["spf.too_many_lookups", "spf.loop"]));
  });

  it("says when the SPF count could not be completed", () => {
    const r = analyzeMail(input({ spfEvaluation: { lookups: 4, complete: false, exceeded: false, terminal: "-", problems: [] } }));
    expect(keys(r)).toContain("spf.incomplete");
  });

  it("handles missing, weak and invalid DMARC", () => {
    expect(keys(analyzeMail(input({ dmarc: none() })))).toContain("dmarc.missing");
    expect(analyzeMail(input({ dmarc: none() })).mail.rating).toBe("improve");
    expect(keys(analyzeMail(input({ dmarc: txt("v=DMARC1; p=none; rua=mailto:r@x.example") })))).toContain("dmarc.policy_none");
    expect(keys(analyzeMail(input({ dmarc: txt("v=DMARC1; p=quarantine; pct=25; rua=mailto:r@x.example") })))).toContain("dmarc.partial");
    expect(keys(analyzeMail(input({ dmarc: txt("v=DMARC1; p=reject") })))).toContain("dmarc.no_reports");
    expect(keys(analyzeMail(input({ dmarc: txt("v=DMARC1; rua=mailto:r@x.example") })))).toContain("dmarc.invalid");
    expect(keys(analyzeMail(input({ dmarc: txt("v=DMARC1; p=none", "v=DMARC1; p=reject") })))).toContain("dmarc.multiple");
  });

  it("is honest about DKIM", () => {
    const r = analyzeMail(input({ dkim: [{ selector: "google", answer: none() }, { selector: "default", answer: FAILED }] }));
    expect(keys(r)).toContain("dkim.not_found");
    expect(r.mail.dkim.failed).toBe(1);
    const cname = analyzeMail(input({ dkim: [{ selector: "selector1", answer: ans(3, [5, "selector1-x._domainkey.x.onmicrosoft.com."]) }] }));
    expect(cname.mail.dkim.found).toEqual([{ selector: "selector1", kind: "cname" }]);
  });

  it("notes missing MTA-STS and TLS-RPT only as low findings", () => {
    const r = analyzeMail(input({ mtaSts: none(), tlsRpt: none() }));
    expect(r.findings.map((f) => [f.key, f.severity])).toEqual([["mtasts.missing", "low"], ["tlsrpt.missing", "low"]]);
    expect(r.mail.rating).toBe("good");
  });

  it("handles domains without mail", () => {
    const r = analyzeMail(input({ mx: none(), txt: none(), dmarc: none() }));
    expect(r.mail.rating).toBe("nomail");
    expect(keys(r)).toEqual(expect.arrayContaining(["mail.no_mx", "spf.missing_nomail", "dmarc.missing"]));
    expect(r.findings.every((f) => f.severity !== "high")).toBe(true);
  });

  it("treats a null MX as intentional", () => {
    const r = analyzeMail(input({ mx: ans(0, [15, "0 ."]), txt: txt("v=spf1 -all"), dmarc: txt("v=DMARC1; p=reject; rua=mailto:a@x.example") }));
    expect(r.mail.nullMx).toBe(true);
    expect(keys(r)).not.toContain("mail.no_mx");
    expect(r.mail.rating).toBe("nomail");
  });

  it("does not claim anything when a query failed", () => {
    const r = analyzeMail(input({ txt: FAILED, spfEvaluation: null, dmarc: FAILED, mtaSts: FAILED, tlsRpt: FAILED }));
    expect(r.mail.spf.state).toBe("unknown");
    expect(r.mail.dmarc.state).toBe("unknown");
    expect(r.mail.mtaSts).toBe("unknown");
    expect(keys(r).some((k) => /missing/.test(k))).toBe(false);
    expect(r.mail.rating).toBe("unknown");
    expect(analyzeMail(input({ mx: FAILED })).mail.rating).toBe("unknown");
  });
});

describe("pickTop", () => {
  it("returns at most three, most severe first, never low ones", () => {
    const mk = (severity: "high" | "medium" | "low") => ({ key: "k", section: "mail" as const, severity, source: "doh" as const, params: {} });
    const list = [mk("low"), mk("medium"), mk("high"), mk("medium"), mk("high"), mk("medium")];
    expect(pickTop(list)).toEqual([2, 4, 1]);
    expect(pickTop([mk("low")])).toEqual([]);
  });
});
