import { describe, expect, it } from "vitest";
import { dictionary, ERROR_KEYS, FINDING_KEYS, format, LANGS, RECORD_TYPE_KEYS, STATUS_KEYS, UI_KEYS } from "../src/i18n";
import { STATUS_IDS } from "../src/rdap";
import { analyzeMail, DKIM_SELECTORS } from "../src/analyze";
import { daysText, localize } from "../src/i18n/localize";
import { runLookup } from "../src/lookup";
import { deps, domain, fakeNet, healthyZone, json, q, fixture } from "./helpers";

const BAD_TEXT = /undefined|\bTODO\b|\bTBD\b|lorem|xxx|\[object/i;

function texts(lang: (typeof LANGS)[number]): [string, string][] {
  const d = dictionary(lang);
  const out: [string, string][] = [];
  for (const k of FINDING_KEYS) out.push([`finding ${k} title`, d.findings[k].title], [`finding ${k} why`, d.findings[k].why], [`finding ${k} fix`, d.findings[k].fix]);
  for (const k of ERROR_KEYS) out.push([`error ${k}`, d.errors[k]]);
  for (const k of UI_KEYS) out.push([`ui ${k}`, d.ui[k]]);
  for (const k of STATUS_KEYS) out.push([`status ${k} label`, d.statuses[k].label], [`status ${k} explain`, d.statuses[k].explain]);
  for (const k of RECORD_TYPE_KEYS) out.push([`record ${k} title`, d.recordTypes[k].title], [`record ${k} explain`, d.recordTypes[k].explain]);
  d.notShown.forEach((v, i) => out.push([`notShown ${i}`, v]));
  return out;
}

const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("dictionaries", () => {
  it("have exactly the same keys in every language", () => {
    const [a, b] = LANGS.map(dictionary) as [ReturnType<typeof dictionary>, ReturnType<typeof dictionary>];
    for (const group of ["ui", "findings", "errors", "statuses", "recordTypes"] as const) {
      expect(Object.keys(a[group]).sort(), group).toEqual(Object.keys(b[group]).sort());
    }
    expect(Object.keys(a.ui).sort()).toEqual([...UI_KEYS].sort());
    expect(Object.keys(a.findings).sort()).toEqual([...FINDING_KEYS].sort());
    expect(Object.keys(a.errors).sort()).toEqual([...ERROR_KEYS].sort());
    expect(a.notShown.length).toBe(b.notShown.length);
  });

  for (const lang of LANGS) {
    it(`have no empty, placeholder or dash-decorated texts (${lang})`, () => {
      for (const [name, text] of texts(lang)) {
        expect(text.trim().length, name).toBeGreaterThan(1);
        expect(text.replace(/\{\w+\}/g, ""), name).not.toMatch(BAD_TEXT);
        expect(text, name).not.toMatch(/[–—]/); // no en or em dashes
      }
    });
  }

  it("use the same placeholders in both languages", () => {
    const pl = dictionary("pl"), en = dictionary("en");
    for (const k of UI_KEYS) expect(names(pl.ui[k]), k).toEqual(names(en.ui[k]));
    for (const k of FINDING_KEYS) {
      for (const part of ["title", "why", "fix"] as const) expect(names(pl.findings[k][part]), `${k}.${part}`).toEqual(names(en.findings[k][part]));
    }
  });

  it("do not copy English into the Polish dictionary", () => {
    const pl = dictionary("pl"), en = dictionary("en");
    const same = (a: string, b: string) => a === b;
    for (const k of FINDING_KEYS) {
      expect(same(pl.findings[k].title, en.findings[k].title), k).toBe(false);
      expect(same(pl.findings[k].why, en.findings[k].why), k).toBe(false);
      expect(same(pl.findings[k].fix, en.findings[k].fix), k).toBe(false);
    }
    for (const k of ERROR_KEYS) expect(same(pl.errors[k], en.errors[k]), k).toBe(false);
    for (const k of STATUS_KEYS) expect(same(pl.statuses[k].label, en.statuses[k].label), k).toBe(false);
  });

  it("keep Polish letters out of English texts", () => {
    const en = texts("en");
    for (const [name, text] of en) expect(text, name).not.toMatch(/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/);
  });

  it("format() fills placeholders and leaves unknown ones", () => {
    expect(format("{a} of {b}", { a: 1, b: "x" })).toBe("1 of x");
    expect(format("{a} {c}", { a: 1 })).toBe("1 {c}");
  });

  it("status ids in the parser match the dictionary", () => {
    expect([...STATUS_IDS].sort()).toEqual([...STATUS_KEYS].sort());
  });

  it("pluralises days", () => {
    expect(daysText(1, "pl")).toBe("1 dzień");
    expect(daysText(5, "pl")).toBe("5 dni");
    expect(daysText(1, "en")).toBe("1 day");
    expect(daysText(0, "en")).toBe("0 days");
  });
});

describe("coverage of findings", () => {
  it("every finding key the code can produce has a text, and every text is produced somewhere", async () => {
    const seen = new Set<string>();
    // Mail scenarios from the mail analysis.
    const mkTxt = (...v: string[]) => ({ state: "ok" as const, rcode: 0, authenticated: false, records: v.map((x) => ({ type: "TXT" as const, name: "x", ttl: 1, data: x })) });
    const empty = { state: "ok" as const, rcode: 0, authenticated: false, records: [] };
    const mx = { state: "ok" as const, rcode: 0, authenticated: false, records: [{ type: "MX" as const, name: "x", ttl: 1, data: "10 mx.x" }] };
    const ev = (terminal: "+" | "?" | "~" | "-" | null, over = {}) => ({ lookups: 1, complete: true, exceeded: false, terminal, problems: [], ...over });
    const base = { mx, txt: mkTxt("v=spf1 -all"), dmarc: mkTxt("v=DMARC1; p=reject; rua=mailto:a@b.cd"), mtaSts: mkTxt("v=STSv1"), tlsRpt: mkTxt("v=TLSRPTv1"), dkim: [{ selector: "a", answer: mkTxt("v=DKIM1; p=x") }], spfEvaluation: ev("-") };
    const variants = [
      { ...base, txt: empty, spfEvaluation: null, dmarc: empty, mtaSts: empty, tlsRpt: empty, dkim: [{ selector: "a", answer: empty }] },
      { ...base, mx: empty, txt: empty, spfEvaluation: null, dmarc: empty },
      { ...base, txt: mkTxt("v=spf1 -all", "v=spf1 -all"), spfEvaluation: null, dmarc: mkTxt("v=DMARC1; p=none", "v=DMARC1; p=none") },
      { ...base, txt: mkTxt("v=spf1 bad: -all"), spfEvaluation: null, dmarc: mkTxt("v=DMARC1; rua=mailto:a@b.cd") },
      { ...base, spfEvaluation: ev("+", { exceeded: true, problems: [{ domain: "x", reason: "cycle" }] }), dmarc: mkTxt("v=DMARC1; p=none; rua=mailto:a@b.cd") },
      { ...base, spfEvaluation: ev("?", { complete: false }), dmarc: mkTxt("v=DMARC1; p=quarantine; pct=10") },
      { ...base, spfEvaluation: ev("~") },
      { ...base, txt: mkTxt("v=spf1 ip4:1.2.3.4"), spfEvaluation: ev(null) },
      { ...base, txt: empty, spfEvaluation: null, mx: empty },
    ];
    for (const v of variants) for (const f of analyzeMail(v).findings) seen.add(f.key);
    // Registration, DNS and hosting scenarios through the full pipeline.
    const run = async (zone: Record<string, any>, rdap: unknown) => {
      const net = fakeNet(zone, { rdapDomain: () => json(rdap) });
      return (await runLookup(domain("example.pl"), deps(net))).findings;
    };
    const iso = (days: number) => new Date(Date.parse("2026-11-07T12:00:00Z") + days * 86_400_000).toISOString();
    const pl = fixture("rdap-pl.json");
    for (const f of await run(healthyZone(), { ...pl, events: [{ eventAction: "expiration", eventDate: iso(-5) }] })) seen.add(f.key);
    for (const f of await run(healthyZone(), { ...pl, events: [{ eventAction: "expiration", eventDate: iso(5) }], nask0_state: undefined, status: ["pending delete", "clientHold"] })) seen.add(f.key);
    const z = healthyZone();
    z["example.pl|NS"] = [q("NS", "ns1.x.pl.")]; z["example.pl|CAA"] = []; z["example.pl|A"] = [q("A", "10.0.0.1")]; z["www.example.pl|A"] = [];
    z["www.example.pl|AAAA"] = []; z["example.pl|AAAA"] = [];
    for (const f of await run(z, pl)) seen.add(f.key);
    const z2 = healthyZone(); z2["example.pl|A"] = []; z2["example.pl|AAAA"] = [];
    for (const f of await run(z2, pl)) seen.add(f.key);
    const z3 = healthyZone(); z3["example.pl|NS"] = [];
    for (const f of await run(z3, pl)) seen.add(f.key);
    const z4 = healthyZone(); z4["example.pl|A"] = [q("A", "203.0.114.5")]; z4["www.example.pl|A"] = []; z4["www.example.pl|AAAA"] = [];
    for (const f of await run(z4, pl)) seen.add(f.key);
    expect([...seen].sort()).toEqual([...FINDING_KEYS].sort());
  });

  it("builds localized API texts for every finding, with the same ids in both languages", async () => {
    const z = healthyZone(); z["_dmarc.example.pl|TXT"] = []; z["example.pl|TXT"] = [q("TXT", "v=spf1 +all")];
    const net = fakeNet(z);
    const r = await runLookup(domain("example.pl"), deps(net));
    const a = localize(r, "pl"), b = localize(r, "en");
    expect(a.findings.map((f) => f.id)).toEqual(b.findings.map((f) => f.id));
    expect(a.findings.length).toBeGreaterThan(2);
    for (const f of [...a.findings, ...b.findings]) {
      for (const t of [f.title, f.why, f.fix, f.source]) expect(t).not.toMatch(/\{\w+\}|undefined/);
    }
    expect(a.status).toBe("Domena jest zajęta");
    expect(b.mailRating).toBe("At risk");
    expect(a.top.length).toBe(Math.min(3, r.top.length));
    expect(DKIM_SELECTORS.length).toBe(7);
  });
});
