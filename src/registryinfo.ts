// A link to the official description of a top-level domain's registry. The tool never requests this page,
// it only offers the link. The address is built from the validated ending of an already validated domain.
import { tldOf } from "./domain";

const IANA_ROOT_DB = "https://www.iana.org/domains/root/db/";

/** IANA page of the ending (it names the registry and links to it), or null for anything that is not a plain ending. */
export function registryInfoUrl(domain: string): string | null {
  const tld = tldOf(domain.toLowerCase());
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  return `${IANA_ROOT_DB}${tld}.html`;
}
