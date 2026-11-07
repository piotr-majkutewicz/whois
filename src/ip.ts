// IP address helpers: parsing, classification of non-public ranges, and CIDR matching.
// Everything is pure. Non-public addresses found in DNS answers are never queried.

export type IpClass = "public" | "private" | "loopback" | "link_local" | "shared" | "reserved" | "multicast" | "documentation";

export function parseIPv4(s: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

/** Expands an IPv6 address to eight 16-bit groups. Returns null for malformed input. */
export function parseIPv6(input: string): number[] | null {
  let s = input.toLowerCase();
  if (s.includes("%")) s = s.slice(0, s.indexOf("%"));
  let tail: number[] = [];
  // Embedded IPv4 in the last 32 bits (::ffff:1.2.3.4).
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (v4) {
    const p = parseIPv4(v4[1]!);
    if (!p) return null;
    tail = [(p[0]! << 8) | p[1]!, (p[2]! << 8) | p[3]!];
    s = s.slice(0, s.length - v4[1]!.length) + "0:0";
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = toGroups(halves[0]!);
  const rest = halves.length === 2 ? toGroups(halves[1]!) : [];
  if (!head || !rest) return null;
  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return null;
    groups = [...head, ...new Array<number>(fill).fill(0), ...rest];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  if (tail.length === 2) {
    groups[6] = tail[0]!;
    groups[7] = tail[1]!;
  }
  return groups;
}

export function classifyIPv4(p: number[]): IpClass {
  const [a, b, c] = p as [number, number, number, number];
  if (a === 0) return "reserved";
  if (a === 10) return "private";
  if (a === 100 && b >= 64 && b <= 127) return "shared";
  if (a === 127) return "loopback";
  if (a === 169 && b === 254) return "link_local";
  if (a === 172 && b >= 16 && b <= 31) return "private";
  if (a === 192 && b === 0 && c === 0) return "reserved";
  if (a === 192 && b === 0 && c === 2) return "documentation";
  if (a === 192 && b === 88 && c === 99) return "reserved";
  if (a === 192 && b === 168) return "private";
  if (a === 198 && (b === 18 || b === 19)) return "reserved";
  if (a === 198 && b === 51 && c === 100) return "documentation";
  if (a === 203 && b === 0 && c === 113) return "documentation";
  if (a >= 224 && a <= 239) return "multicast";
  if (a >= 240) return "reserved";
  return "public";
}

export function classifyIPv6(g: number[]): IpClass {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  if (g.every((x) => x === 0)) return "reserved"; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return "loopback";
  // IPv4-mapped (::ffff:a.b.c.d): judge by the embedded IPv4 address.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return classifyIPv4([g6 >> 8, g6 & 255, g7 >> 8, g7 & 255]);
  }
  if ((g0 & 0xfe00) === 0xfc00) return "private"; // fc00::/7 unique local
  if ((g0 & 0xffc0) === 0xfe80) return "link_local"; // fe80::/10
  if ((g0 & 0xff00) === 0xff00) return "multicast";
  if (g0 === 0x2001 && g1 === 0x0db8) return "documentation";
  // Only global unicast 2000::/3 can be public. 6to4 (2002::/16), Teredo (2001::/32) and NAT64 are skipped.
  if ((g0 & 0xe000) !== 0x2000) return "reserved";
  if (g0 === 0x2002) return "reserved";
  if (g0 === 0x2001 && g1 === 0) return "reserved";
  return "public";
}

export type ParsedIp = { version: 4; groups: number[] } | { version: 6; groups: number[] };

export function parseIp(s: string): ParsedIp | null {
  const v4 = parseIPv4(s);
  if (v4) return { version: 4, groups: v4 };
  if (s.includes(":")) {
    const v6 = parseIPv6(s);
    if (v6) return { version: 6, groups: v6 };
  }
  return null;
}

export function classifyIp(s: string): IpClass | "invalid" {
  const ip = parseIp(s);
  if (!ip) return "invalid";
  return ip.version === 4 ? classifyIPv4(ip.groups) : classifyIPv6(ip.groups);
}

export function ipToBigInt(ip: ParsedIp): bigint {
  if (ip.version === 4) return ip.groups.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n);
  return ip.groups.reduce((acc, p) => (acc << 16n) | BigInt(p), 0n);
}

/** True when the address lies inside the CIDR block ("1.0.0.0/8", "2001:200::/23"). */
export function inCidr(ip: ParsedIp, cidr: string): boolean {
  const slash = cidr.indexOf("/");
  if (slash === -1) return false;
  const base = parseIp(cidr.slice(0, slash));
  const len = Number(cidr.slice(slash + 1));
  if (!base || base.version !== ip.version || !Number.isInteger(len)) return false;
  const bits = ip.version === 4 ? 32 : 128;
  if (len < 0 || len > bits) return false;
  const shift = BigInt(bits - len);
  return ipToBigInt(ip) >> shift === ipToBigInt(base) >> shift;
}
