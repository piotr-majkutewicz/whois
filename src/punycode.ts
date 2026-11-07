// Punycode decoding (RFC 3492), only for showing an IDN name in its readable form.
const BASE = 36, TMIN = 1, TMAX = 26, SKEW = 38, DAMP = 700, INITIAL_BIAS = 72, INITIAL_N = 128;

function adapt(delta: number, numPoints: number, first: boolean): number {
  delta = first ? Math.floor(delta / DAMP) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((BASE - TMIN) * TMAX) >> 1) {
    delta = Math.floor(delta / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * delta) / (delta + SKEW));
}

function digit(cp: number): number {
  if (cp >= 48 && cp <= 57) return cp - 22; // 0-9 -> 26..35
  if (cp >= 97 && cp <= 122) return cp - 97; // a-z
  if (cp >= 65 && cp <= 90) return cp - 65;
  return BASE;
}

/** Decodes one label without the "xn--" prefix. Returns null when the input is not valid punycode. */
export function decodePunycode(input: string): string | null {
  const out: number[] = [];
  const basic = input.lastIndexOf("-");
  for (let j = 0; j < Math.max(basic, 0); j++) {
    const c = input.charCodeAt(j);
    if (c >= 128) return null;
    out.push(c);
  }
  let n = INITIAL_N, i = 0, bias = INITIAL_BIAS;
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length; ) {
    const oldi = i;
    for (let w = 1, k = BASE; ; k += BASE) {
      if (idx >= input.length) return null;
      const d = digit(input.charCodeAt(idx++));
      if (d >= BASE) return null;
      i += d * w;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (d < t) break;
      w *= BASE - t;
    }
    const len = out.length + 1;
    bias = adapt(i - oldi, len, oldi === 0);
    n += Math.floor(i / len);
    i %= len;
    if (n > 0x10ffff) return null;
    out.splice(i++, 0, n);
  }
  try {
    return String.fromCodePoint(...out);
  } catch {
    return null;
  }
}

/** "xn--bcher-kva.example" -> "bücher.example". Labels that cannot be decoded stay as they are. */
export function toUnicodeHost(host: string): string {
  return host
    .split(".")
    .map((l) => (l.startsWith("xn--") ? (decodePunycode(l.slice(4)) ?? l) : l))
    .join(".");
}
