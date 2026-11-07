import { en } from "./en";
import { pl } from "./pl";
import { DEFAULT_LANG, type Dictionary, type Lang } from "./types";

export * from "./types";

const DICTIONARIES: Record<Lang, Dictionary> = { pl, en };

export function dictionary(lang: Lang = DEFAULT_LANG): Dictionary {
  return DICTIONARIES[lang];
}
