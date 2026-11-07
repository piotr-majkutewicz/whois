// A deliberately small list of multi-label public suffixes. It is NOT the full Public Suffix List.
// It covers .pl (functional and regional zones) and the most common second-level zones of other
// countries. A suffix missing here makes the tool treat "name.suffix" as the registrable domain
// one label too high (for example "shop.example.xx" instead of "example.xx"). See the README.
const PL_ZONES = [
  "com", "net", "org", "info", "biz", "edu", "gov", "mil", "aid", "agro", "atm", "auto", "gmina", "gsm",
  "mail", "media", "miasta", "nieruchomosci", "nom", "pc", "powiat", "priv", "realestate", "rel", "sex",
  "shop", "sklep", "sos", "szkola", "targi", "tm", "tourism", "travel", "turystyka", "art", "augustow",
  "bialystok", "bydgoszcz", "gda", "gdansk", "gdynia", "gliwice", "katowice", "kielce", "krakow", "lodz",
  "lublin", "olsztyn", "opole", "poznan", "radom", "rzeszow", "slupsk", "szczecin", "torun", "warszawa",
  "waw", "wroc", "wroclaw", "zakopane", "mazowsze", "mazury", "pomorze", "podlasie", "slask", "malopolska",
  "wielkopolska", "zachodniopomorze", "podhale", "beskidy", "kaszuby", "lubelskie",
];

const OTHER = [
  "co.uk", "org.uk", "me.uk", "ltd.uk", "plc.uk", "net.uk", "ac.uk", "gov.uk", "sch.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "id.au",
  "co.nz", "net.nz", "org.nz", "govt.nz", "ac.nz",
  "co.za", "org.za", "net.za", "gov.za",
  "co.jp", "ne.jp", "or.jp", "ac.jp", "go.jp",
  "co.in", "net.in", "org.in", "firm.in", "gen.in", "ind.in",
  "com.br", "net.br", "org.br", "gov.br", "edu.br",
  "com.mx", "org.mx", "gob.mx", "com.ar", "com.co", "com.pe", "com.ve",
  "com.tr", "net.tr", "org.tr", "gen.tr",
  "com.cn", "net.cn", "org.cn", "gov.cn", "com.hk", "com.tw", "com.sg", "com.my", "com.ph", "co.id", "co.th",
  "co.kr", "or.kr", "com.ua", "kiev.ua", "org.ua", "com.ru", "co.il", "org.il", "com.eg", "com.sa", "com.pk",
  "com.ng", "co.ke", "com.gr", "com.pt", "com.es", "com.ro", "com.hr", "com.cy", "com.mt", "co.at", "or.at",
];

export const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([...PL_ZONES.map((z) => `${z}.pl`), ...OTHER]);
