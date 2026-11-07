// SPF: parsing and counting of DNS lookups (RFC 7208). Pure logic; DNS access is injected.

export type SpfQualifier = "+" | "-" | "~" | "?";

export interface SpfTerm {
  qualifier: SpfQualifier;
  mechanism: string;
  value: string | null;
}

export interface SpfRecord {
  terms: SpfTerm[];
  redirect: string | null;
  /** Qualifier of the "all" term, or null when there is none. */
  all: SpfQualifier | null;
  /** Problems that make the record invalid (a receiving server answers "permerror"). */
  errors: ("unknown_term" | "bad_syntax")[];
}

const MECHANISMS = new Set(["all", "include", "a", "mx", "ptr", "ip4", "ip6", "exists"]);
const NEEDS_VALUE = new Set(["include", "ip4", "ip6", "exists"]);

export function isSpfRecord(txt: string): boolean {
  return /^v=spf1(\s|$)/i.test(txt.trim());
}

export function parseSpf(record: string): SpfRecord {
  const out: SpfRecord = { terms: [], redirect: null, all: null, errors: [] };
  const parts = record.trim().split(/\s+/).slice(1);
  for (const part of parts) {
    if (part === "") continue;
    // Modifiers look like name=value.
    const eq = /^([a-z][a-z0-9_.-]*)=(.*)$/i.exec(part);
    if (eq && !/[:/]/.test(eq[1]!)) {
      const name = eq[1]!.toLowerCase();
      if (name === "redirect") {
        if (!eq[2]) out.errors.push("bad_syntax");
        else out.redirect = eq[2].toLowerCase();
      }
      // exp= and unknown modifiers are allowed by the RFC and do not matter for this tool.
      continue;
    }
    let qualifier: SpfQualifier = "+";
    let rest = part;
    if ("+-~?".includes(rest[0]!)) {
      qualifier = rest[0] as SpfQualifier;
      rest = rest.slice(1);
    }
    const m = /^([a-z0-9]+)(?:[:/](.*))?$/i.exec(rest);
    if (!m) {
      out.errors.push("bad_syntax");
      continue;
    }
    const mechanism = m[1]!.toLowerCase();
    if (!MECHANISMS.has(mechanism)) {
      out.errors.push("unknown_term");
      continue;
    }
    // "a/24" and "mx/24" have a CIDR length and no domain; "a:domain/24" has both.
    const value = rest.length > mechanism.length ? rest.slice(mechanism.length + (rest[mechanism.length] === ":" ? 1 : 0)) : null;
    if (NEEDS_VALUE.has(mechanism) && !value) {
      out.errors.push("bad_syntax");
      continue;
    }
    if (mechanism === "all") out.all = qualifier;
    out.terms.push({ qualifier, mechanism, value: value && value.length > 0 ? value : null });
  }
  return out;
}

/** What the resolver tells us about the SPF record of one domain. */
export type SpfFetch =
  | { state: "ok"; records: string[] } // every TXT record that starts with v=spf1 (may be zero or several)
  | { state: "failed" };

export interface SpfProblem {
  /** The domain the problem was found at. */
  domain: string;
  reason: "missing" | "multiple" | "cycle" | "unreachable" | "syntax";
}

export interface SpfEvaluation {
  /** Number of DNS-querying terms, counted like a receiving server counts them (limit: 10). */
  lookups: number;
  /** True when the count is the whole story. False when some include could not be followed. */
  complete: boolean;
  exceeded: boolean;
  /** The qualifier of the final "all", following redirect= when there is no all in the first record. */
  terminal: SpfQualifier | null;
  problems: SpfProblem[];
}

const MAX_DEPTH = 10;
const LIMIT = 10;

export interface EvalOptions {
  /** Hard stop for the whole walk in milliseconds, checked between steps. */
  deadlineMs?: number;
  now?: () => number;
}

/**
 * Walks include: and redirect= terms and counts lookups. The walk stops as soon as the count passes the
 * limit of 10, because the answer is already known. `fetchSpf` should cache by domain: the same include
 * appearing twice is counted twice (as receivers do) but fetched once.
 */
export async function evaluateSpf(
  domain: string,
  rootRecord: string,
  fetchSpf: (domain: string) => Promise<SpfFetch>,
  options: EvalOptions = {},
): Promise<SpfEvaluation> {
  const now = options.now ?? Date.now;
  const started = now();
  const result: SpfEvaluation = { lookups: 0, complete: true, exceeded: false, terminal: null, problems: [], };
  const cache = new Map<string, SpfFetch>();
  const get = async (d: string): Promise<SpfFetch> => {
    const hit = cache.get(d);
    if (hit) return hit;
    const r = await fetchSpf(d);
    cache.set(d, r);
    return r;
  };
  const timedOut = () => options.deadlineMs !== undefined && now() - started > options.deadlineMs;

  async function follow(target: string, path: string[], depth: number): Promise<SpfQualifier | null> {
    const fetched = await get(target);
    if (fetched.state === "failed") {
      result.complete = false;
      result.problems.push({ domain: target, reason: "unreachable" });
      return null;
    }
    if (fetched.records.length === 0) {
      result.problems.push({ domain: target, reason: "missing" });
      return null;
    }
    if (fetched.records.length > 1) {
      result.problems.push({ domain: target, reason: "multiple" });
      return null;
    }
    return walk(target, fetched.records[0]!, [...path, target], depth + 1);
  }

  async function walk(name: string, record: string, path: string[], depth: number): Promise<SpfQualifier | null> {
    const parsed = parseSpf(record);
    if (parsed.errors.length > 0) result.problems.push({ domain: name, reason: "syntax" });
    let terminal: SpfQualifier | null = parsed.all;
    for (const term of parsed.terms) {
      if (!["include", "a", "mx", "ptr", "exists"].includes(term.mechanism)) continue;
      result.lookups++;
      if (result.lookups > LIMIT) {
        result.exceeded = true;
        return terminal;
      }
      if (term.mechanism !== "include") continue;
      const target = term.value!.toLowerCase();
      if (path.includes(target)) {
        result.problems.push({ domain: target, reason: "cycle" });
      } else if (depth >= MAX_DEPTH || timedOut()) {
        result.complete = false;
      } else {
        await follow(target, path, depth);
        if (result.exceeded) return terminal;
      }
    }
    if (parsed.redirect && !parsed.all) {
      result.lookups++;
      if (result.lookups > LIMIT) {
        result.exceeded = true;
        return terminal;
      }
      const target = parsed.redirect;
      if (path.includes(target)) result.problems.push({ domain: target, reason: "cycle" });
      else if (depth >= MAX_DEPTH || timedOut()) result.complete = false;
      else terminal = await follow(target, path, depth);
    }
    return terminal;
  }

  result.terminal = await walk(domain, rootRecord, [domain], 0);
  return result;
}
