// Regions the planner may name, expanded to ISO country codes. Freelancer.com filters by
// country name, so codes are mapped to its own names via /common/0.1/countries/.

const REGIONS: Record<string, string[]> = {
  europe: [
    "AL", "AD", "AT", "BY", "BE", "BA", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
    "HU", "IS", "IE", "IT", "XK", "LV", "LI", "LT", "LU", "MT", "MD", "MC", "ME", "NL", "MK", "NO",
    "PL", "PT", "RO", "SM", "RS", "SK", "SI", "ES", "SE", "CH", "UA", "GB",
  ],
  "european union": [
    "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV",
    "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  ],
  "eastern europe": ["BY", "BG", "CZ", "HU", "MD", "PL", "RO", "SK", "UA", "RS", "HR", "SI", "BA", "ME", "MK", "AL", "EE", "LV", "LT"],
  "western europe": ["AT", "BE", "FR", "DE", "IE", "LU", "MC", "NL", "CH", "GB", "LI"],
  "southern europe": ["ES", "PT", "IT", "GR", "MT", "CY", "HR", "SI"],
  nordics: ["DK", "FI", "IS", "NO", "SE"],
  "north america": ["US", "CA", "MX"],
  "latin america": [
    "AR", "BO", "BR", "CL", "CO", "CR", "CU", "DO", "EC", "SV", "GT", "HN", "MX", "NI", "PA", "PY",
    "PE", "PR", "UY", "VE",
  ],
  "south america": ["AR", "BO", "BR", "CL", "CO", "EC", "GY", "PY", "PE", "SR", "UY", "VE"],
  "south asia": ["IN", "PK", "BD", "LK", "NP", "BT", "MV", "AF"],
  "southeast asia": ["ID", "MY", "PH", "SG", "TH", "VN", "KH", "LA", "MM", "BN"],
  "east asia": ["CN", "HK", "JP", "KR", "TW", "MN", "MO"],
  "middle east": ["AE", "SA", "QA", "KW", "BH", "OM", "JO", "LB", "IL", "IQ", "IR", "SY", "YE", "TR", "PS"],
  africa: [
    "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CV", "CF", "TD", "CD", "CG", "CI", "DJ", "EG", "GQ",
    "ER", "ET", "GA", "GM", "GH", "GN", "KE", "LS", "LR", "LY", "MG", "MW", "ML", "MR", "MU", "MA",
    "MZ", "NA", "NE", "NG", "RW", "SN", "SC", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "TN", "UG",
    "ZM", "ZW",
  ],
  oceania: ["AU", "NZ", "FJ", "PG"],
};
REGIONS.asia = [...new Set([...REGIONS["south asia"], ...REGIONS["southeast asia"], ...REGIONS["east asia"]])];
REGIONS.eu = REGIONS["european union"];
REGIONS.latam = REGIONS["latin america"];
REGIONS.apac = [...new Set([...REGIONS.asia, ...REGIONS.oceania])];
REGIONS.emea = [...new Set([...REGIONS.europe, ...REGIONS["middle east"], ...REGIONS.africa])];

export const REGION_NAMES = Object.keys(REGIONS);

export interface Country {
  name: string;
  code: string;
}

let countries: Country[] | null = null;

export function setCountries(list: Country[]) {
  countries = list;
}

export function getCountries(): Country[] {
  return countries ?? [];
}

function byCode(code: string): string | null {
  return getCountries().find((c) => c.code.toUpperCase() === code.toUpperCase())?.name ?? null;
}

const ALIASES: Record<string, string> = {
  uk: "GB", "great britain": "GB", england: "GB", britain: "GB", usa: "US", us: "US",
  america: "US", "united states of america": "US", holland: "NL", czechia: "CZ", uae: "AE",
  "south korea": "KR", korea: "KR", russia: "RU", vietnam: "VN",
};

/** Returns Freelancer.com country names for a region ("Europe") or a country ("Spain", "UK"). */
export function resolvePlace(place: string): string[] {
  const key = place.trim().toLowerCase();
  if (!key) return [];
  const region = REGIONS[key];
  if (region) return region.map(byCode).filter((n): n is string => n !== null);
  const aliased = ALIASES[key];
  if (aliased) return [byCode(aliased)].filter((n): n is string => n !== null);
  const exact = getCountries().find((c) => c.name.toLowerCase() === key);
  if (exact) return [exact.name];
  const code = key.length === 2 ? byCode(key) : null;
  if (code) return [code];
  const partial = getCountries().find((c) => c.name.toLowerCase().startsWith(key));
  return partial ? [partial.name] : [];
}

export function isRegion(place: string): boolean {
  return place.trim().toLowerCase() in REGIONS;
}

const DISPLAY_REGIONS = [
  "Europe", "Eastern Europe", "Western Europe", "North America", "Latin America", "South Asia",
  "Southeast Asia", "East Asia", "Middle East", "Africa", "Oceania",
];

/** Region name -> Freelancer.com country names, for the location filter in the UI. */
export function regionMap(): Record<string, string[]> {
  return Object.fromEntries(DISPLAY_REGIONS.map((r) => [r, resolvePlace(r)]));
}
