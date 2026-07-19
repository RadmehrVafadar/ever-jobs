import { LocationDto } from "@ever-jobs/models";

export type NorthAmericanCountryCode = "CA" | "US";
export type LocationParseConfidence = "high" | "medium" | "low" | "unknown";
export type LocationGeographyRegion =
  | "canada"
  | "united-states"
  | "north-america"
  | "americas"
  | "other"
  | "unknown";

export interface LocationGeographyHint {
  location: LocationDto | null;
  normalizedLabel: string;
  region: LocationGeographyRegion;
  countryCode?: NorthAmericanCountryCode;
  confidence: LocationParseConfidence;
  remoteMentioned: boolean;
}

const CANADIAN_PROVINCE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alberta: "AB",
  "british columbia": "BC",
  manitoba: "MB",
  "new brunswick": "NB",
  "newfoundland and labrador": "NL",
  "newfoundland & labrador": "NL",
  newfoundland: "NL",
  labrador: "NL",
  "nova scotia": "NS",
  "northwest territories": "NT",
  nunavut: "NU",
  ontario: "ON",
  "prince edward island": "PE",
  pei: "PE",
  quebec: "QC",
  saskatchewan: "SK",
  yukon: "YT",
  "yukon territory": "YT",
};

const CANADIAN_PROVINCE_CODES = new Set([
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
]);

const US_STATE_AND_TERRITORY_CODES = new Set([
  "AA",
  "AE",
  "AK",
  "AL",
  "AP",
  "AR",
  "AS",
  "AZ",
  "CA",
  "CO",
  "CT",
  "DC",
  "DE",
  "FL",
  "FM",
  "GA",
  "GU",
  "HI",
  "IA",
  "ID",
  "IL",
  "IN",
  "KS",
  "KY",
  "LA",
  "MA",
  "MD",
  "ME",
  "MH",
  "MI",
  "MN",
  "MO",
  "MP",
  "MS",
  "MT",
  "NC",
  "ND",
  "NE",
  "NH",
  "NJ",
  "NM",
  "NV",
  "NY",
  "OH",
  "OK",
  "OR",
  "PA",
  "PR",
  "PW",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VA",
  "VI",
  "VT",
  "WA",
  "WI",
  "WV",
  "WY",
]);

const US_STATE_NAME_TO_CODE: Readonly<Record<string, string>> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
  "district of columbia": "DC",
  "washington dc": "DC",
  "washington d c": "DC",
};

const OTHER_COUNTRY_NAMES = new Set([
  "australia",
  "brazil",
  "china",
  "france",
  "germany",
  "india",
  "ireland",
  "israel",
  "italy",
  "japan",
  "mexico",
  "netherlands",
  "new zealand",
  "singapore",
  "south korea",
  "spain",
  "sweden",
  "switzerland",
  "uk",
  "united kingdom",
]);

const CANADIAN_PREFERENCE_CITY =
  /^(?:toronto|greater toronto area|gta|waterloo)$/i;
const HARD_LOCATION_DELIMITER = /\s*(?:;|\||\u2022|\r?\n)\s*/;

type WorkFromHomeType = "Hybrid" | "Remote" | "Hybrid or Remote";

export interface ParsedLocationText {
  location: LocationDto | null;
  remoteMentioned: boolean;
  workFromHomeType: WorkFromHomeType | null;
}

export interface ParsedLocationList {
  location: LocationDto | null;
  locations: LocationDto[];
  labels: string[];
  remoteMentioned: boolean;
  workFromHomeType: WorkFromHomeType | null;
}

/**
 * Parse one source label into a structured North-American geography hint.
 * This is intentionally descriptive rather than policy-bearing: watcher tier
 * eligibility is decided by the watcher geography service.
 */
export function parseLocationGeography(
  value: string | LocationDto | null | undefined,
): LocationGeographyHint {
  if (value instanceof LocationDto || isLocationRecord(value)) {
    return classifyLocationDto(value);
  }
  return classifyLocationText(value);
}

/**
 * Split a possibly delimited source value without treating every slash as a
 * separator. Ambiguous labels such as `Atlanta / Savannah, GA` stay intact;
 * independently structured labels such as `Toronto, ON / Vancouver, BC` split.
 */
export function splitLocationLabels(raw: string | null | undefined): string[] {
  const normalized = normalizeWhitespace(raw);
  if (!normalized) return [];

  const hardParts = normalized.split(HARD_LOCATION_DELIMITER).filter(Boolean);
  const labels: string[] = [];
  for (const part of hardParts) {
    const conditionalParts = part
      .split(/\s+(?:\/|&|and)\s+/i)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    if (
      conditionalParts.length > 1 &&
      conditionalParts.every(isIndependentlyStructuredLocation)
    ) {
      labels.push(...conditionalParts);
    } else {
      labels.push(part);
    }
  }
  return labels;
}

/**
 * Stable, source-independent identity for one structured location. Callers
 * may sort these identities for canonical keys while retaining source order
 * in `parseLocationList().locations` for display.
 */
export function normalizeLocationIdentity(
  location: LocationDto | null | undefined,
): string {
  if (!location) return "";
  const hint = parseLocationGeography(location);
  const country =
    hint.countryCode?.toLowerCase() ?? normalizeToken(location.country);
  const state =
    normalizeCanadianProvince(location.state) ??
    normalizeUsState(location.state ?? "") ??
    normalizeToken(location.state);
  const city = normalizeToken(location.city);
  return [country, state.toLowerCase(), city].join("|");
}

/**
 * Conservatively split a plain North-American `City, ST` label while retaining
 * recognized workplace qualifiers separately.
 */
export function parseLocationText(
  raw: string | null | undefined,
): ParsedLocationText {
  const normalized = normalizeWhitespace(raw);
  if (!normalized) {
    return {
      location: null,
      remoteMentioned: false,
      workFromHomeType: null,
    };
  }

  const remoteMentioned = /\bremote\b/i.test(normalized);
  const hybridMentioned = /\bhybrid\b/i.test(normalized);
  const workFromHomeType = hybridMentioned
    ? remoteMentioned
      ? "Hybrid or Remote"
      : "Hybrid"
    : remoteMentioned
      ? "Remote"
      : null;

  return {
    location: classifyLocationText(normalized).location,
    remoteMentioned,
    workFromHomeType,
  };
}

/**
 * Normalize ordered source labels into the compatibility singular DTO plus a
 * lossless, deduplicated array. Source order is preserved.
 */
export function parseLocationList(
  rawLocations: Array<string | null | undefined>,
): ParsedLocationList {
  const concrete: Array<{ location: LocationDto; label: string; key: string }> =
    [];
  const seen = new Set<string>();
  const countries = new Set<string>();
  const regionalLocations: LocationDto[] = [];
  const scopedRemoteLocations: LocationDto[] = [];
  let remoteMentioned = false;
  let workFromHomeType: WorkFromHomeType | null = null;

  for (const raw of rawLocations) {
    for (const normalized of splitLocationLabels(raw)) {
      const parsed = parseLocationText(normalized);
      const hint = classifyLocationText(normalized);
      remoteMentioned = remoteMentioned || parsed.remoteMentioned;
      workFromHomeType = mergeWorkFromHomeType(
        workFromHomeType,
        parsed.workFromHomeType,
      );

      if (hint.countryCode) countries.add(countryName(hint.countryCode));
      else if (hint.region === "other" && hint.location?.country) {
        countries.add(String(hint.location.country));
      }
      if (
        (hint.region === "north-america" || hint.region === "americas") &&
        hint.location
      ) {
        regionalLocations.push(hint.location);
      }
      if (
        parsed.remoteMentioned &&
        hint.location &&
        (hint.countryCode ||
          hint.region === "north-america" ||
          hint.region === "americas")
      ) {
        scopedRemoteLocations.push(hint.location);
      }

      if (isWorkplaceQualifierOnly(normalized, true)) continue;
      if (isCountryOnly(normalized)) continue;
      if (!hint.location) continue;

      const key = normalizeLocationIdentity(hint.location);
      const label = hint.normalizedLabel || displayLocation(hint.location);
      if (!label || seen.has(key)) continue;
      seen.add(key);
      concrete.push({ location: hint.location, label, key });
    }
  }

  const filteredConcrete = concrete.filter(
    (item) =>
      !isBareCityDuplicate(
        item,
        concrete.map((candidate) => candidate.location),
      ),
  );
  const commonCountry = countries.size === 1 ? [...countries][0] : null;
  const locations = filteredConcrete.map(({ location }) =>
    location.country || !commonCountry
      ? location
      : new LocationDto({ ...location, country: commonCountry }),
  );
  const remoteLocations = deduplicateLocations(
    scopedRemoteLocations.length > 0
      ? scopedRemoteLocations
      : remoteMentioned && commonCountry
        ? [new LocationDto({ city: "Remote", country: commonCountry })]
        : [],
  ).filter(
    (remoteLocation) =>
      !locations.some(
        (location) =>
          normalizeLocationIdentity(location) ===
          normalizeLocationIdentity(remoteLocation),
      ),
  );
  const completeLocations = [...locations, ...remoteLocations];
  const labels = filteredConcrete.map(({ label }) => label);

  if (locations.length === 0) {
    const synthesizedLocations =
      countries.size > 0
        ? [...countries].map(
            (country) =>
              new LocationDto({
                ...(remoteMentioned ? { city: "Remote" } : {}),
                country,
              }),
          )
        : deduplicateLocations(regionalLocations);
    if (synthesizedLocations.length === 0 && remoteMentioned) {
      synthesizedLocations.push(new LocationDto({ city: "Remote" }));
    }
    const synthesizedLocation =
      synthesizedLocations.length <= 1
        ? (synthesizedLocations[0] ?? null)
        : new LocationDto({
            city: synthesizedLocations.map(displayLocation).join("; "),
          });
    return {
      location: synthesizedLocation,
      locations: synthesizedLocations,
      labels,
      remoteMentioned,
      workFromHomeType,
    };
  }

  if (locations.length === 1) {
    return {
      location: locations[0],
      locations: completeLocations,
      labels,
      remoteMentioned,
      workFromHomeType,
    };
  }

  return {
    location: new LocationDto({
      city: labels.join("; "),
      country: commonCountry,
    }),
    locations: completeLocations,
    labels,
    remoteMentioned,
    workFromHomeType,
  };
}

function deduplicateLocations(locations: LocationDto[]): LocationDto[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = normalizeLocationIdentity(location);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function classifyLocationDto(location: LocationDto): LocationGeographyHint {
  const explicitCountry = normalizeCountry(location.country);
  const rendered = displayLocation(location);
  const parsed = classifyLocationText(rendered);

  if (explicitCountry?.code) {
    return {
      ...parsed,
      location: new LocationDto({
        ...location,
        country: countryName(explicitCountry.code),
      }),
      normalizedLabel: rendered,
      region: explicitCountry.code === "CA" ? "canada" : "united-states",
      countryCode: explicitCountry.code,
      confidence: "high",
    };
  }
  if (explicitCountry?.otherName) {
    return {
      ...parsed,
      location,
      normalizedLabel: rendered,
      region: "other",
      confidence: "high",
    };
  }

  const province = normalizeCanadianProvince(location.state);
  if (province) {
    return {
      ...parsed,
      location: new LocationDto({
        ...location,
        state: province,
        country: "Canada",
      }),
      normalizedLabel: displayLocation(
        new LocationDto({ ...location, state: province }),
      ),
      region: "canada",
      countryCode: "CA",
      confidence: "high",
    };
  }
  const usState = normalizeUsState(location.state ?? "");
  if (usState) {
    return {
      ...parsed,
      location: new LocationDto({
        ...location,
        state: usState,
        country: "United States",
      }),
      normalizedLabel: displayLocation(
        new LocationDto({ ...location, state: usState }),
      ),
      region: "united-states",
      countryCode: "US",
      confidence: "high",
    };
  }
  return parsed;
}

function classifyLocationText(
  raw: string | null | undefined,
): LocationGeographyHint {
  const normalized = normalizeWhitespace(raw);
  if (!normalized) return unknownHint(null, "", false, "unknown");

  const remoteMentioned = /\bremote\b/i.test(normalized);
  const geographicText = stripWorkplaceQualifiers(normalized);
  const regionalText = normalizeToken(
    geographicText.replace(
      /\b(?:remote|within|across|anywhere|based|in)\b/gi,
      " ",
    ),
  );

  const exactCountry = normalizeCountry(regionalText);
  if (exactCountry?.code) {
    const name = countryName(exactCountry.code);
    return {
      location: new LocationDto({
        ...(remoteMentioned ? { city: "Remote" } : {}),
        country: name,
      }),
      normalizedLabel: remoteMentioned ? `Remote ${name}` : name,
      region: exactCountry.code === "CA" ? "canada" : "united-states",
      countryCode: exactCountry.code,
      confidence: "high",
      remoteMentioned,
    };
  }

  if (/\bnorth america\b/i.test(geographicText)) {
    return {
      location: new LocationDto({
        city: remoteMentioned ? "Remote North America" : "North America",
      }),
      normalizedLabel: remoteMentioned
        ? "Remote North America"
        : "North America",
      region: "north-america",
      confidence: "medium",
      remoteMentioned,
    };
  }
  if (/\bamericas?\b/i.test(geographicText)) {
    return {
      location: new LocationDto({
        city: remoteMentioned ? "Remote Americas" : "Americas",
      }),
      normalizedLabel: remoteMentioned ? "Remote Americas" : "Americas",
      region: "americas",
      confidence: "medium",
      remoteMentioned,
    };
  }

  const regionalCountry = normalizeCountry(regionalText);
  if (regionalCountry?.code && remoteMentioned) {
    const country = countryName(regionalCountry.code);
    return {
      location: new LocationDto({ city: "Remote", country }),
      normalizedLabel: `Remote ${country}`,
      region: regionalCountry.code === "CA" ? "canada" : "united-states",
      countryCode: regionalCountry.code,
      confidence: "high",
      remoteMentioned,
    };
  }

  const canadian = canonicalCanadianLocation(geographicText);
  if (canadian) {
    return {
      ...canadian,
      region: "canada",
      countryCode: "CA",
      confidence: "high",
      remoteMentioned,
    };
  }
  const american = canonicalUsLocation(geographicText);
  if (american) {
    return {
      ...american,
      region: "united-states",
      countryCode: "US",
      confidence: "high",
      remoteMentioned,
    };
  }

  const cityCountry = canonicalCityCountry(geographicText);
  if (cityCountry) {
    return { ...cityCountry, remoteMentioned };
  }

  const country = normalizeCountry(geographicText);
  if (country?.code) {
    const name = countryName(country.code);
    return {
      location: new LocationDto({ country: name }),
      normalizedLabel: name,
      region: country.code === "CA" ? "canada" : "united-states",
      countryCode: country.code,
      confidence: "high",
      remoteMentioned,
    };
  }
  if (country?.otherName) {
    return {
      location: new LocationDto({ country: country.otherName }),
      normalizedLabel: country.otherName,
      region: "other",
      confidence: "high",
      remoteMentioned,
    };
  }

  const province = normalizeCanadianProvince(geographicText);
  if (province) {
    return {
      location: new LocationDto({ state: province, country: "Canada" }),
      normalizedLabel: province,
      region: "canada",
      countryCode: "CA",
      confidence: "high",
      remoteMentioned,
    };
  }
  const usState = normalizeUsState(geographicText);
  if (usState) {
    return {
      location: new LocationDto({ state: usState, country: "United States" }),
      normalizedLabel: usState,
      region: "united-states",
      countryCode: "US",
      confidence: "high",
      remoteMentioned,
    };
  }

  if (CANADIAN_PREFERENCE_CITY.test(geographicText)) {
    const city = /^(?:gta|greater toronto area)$/i.test(geographicText)
      ? "Greater Toronto Area"
      : titleCase(geographicText);
    return {
      location: new LocationDto({ city, country: "Canada" }),
      normalizedLabel: city,
      region: "canada",
      countryCode: "CA",
      confidence: "medium",
      remoteMentioned,
    };
  }

  if (isWorkplaceQualifierOnly(normalized, true)) {
    return unknownHint(
      new LocationDto({ city: remoteMentioned ? "Remote" : normalized }),
      remoteMentioned ? "Remote" : normalized,
      remoteMentioned,
      "low",
    );
  }

  return unknownHint(
    new LocationDto({ city: normalized }),
    normalized,
    remoteMentioned,
    "low",
  );
}

function canonicalCanadianLocation(
  value: string,
): Pick<LocationGeographyHint, "location" | "normalizedLabel"> | null {
  const parts = commaParts(value);
  if (parts.length < 2 || parts.length > 3) return null;
  const city = parts[0];
  if (/[/&]/.test(city)) return null;
  const province = normalizeCanadianProvince(parts[1]);
  if (!city || !province) return null;
  const trailingCountry = parts[2] ? normalizeCountry(parts[2]) : null;
  if (parts[2] && trailingCountry?.code !== "CA") return null;
  return {
    location: new LocationDto({ city, state: province, country: "Canada" }),
    normalizedLabel: `${city}, ${province}`,
  };
}

function canonicalUsLocation(
  value: string,
): Pick<LocationGeographyHint, "location" | "normalizedLabel"> | null {
  const parts = commaParts(value);
  if (parts.length < 2 || parts.length > 3) return null;
  const city = parts[0];
  if (/[/&]/.test(city)) return null;
  const state = normalizeUsState(parts[1]);
  if (!city || !state) return null;
  const trailingCountry = parts[2] ? normalizeCountry(parts[2]) : null;
  if (parts[2] && trailingCountry?.code !== "US") return null;
  return {
    location: new LocationDto({ city, state, country: "United States" }),
    normalizedLabel: `${city}, ${state}`,
  };
}

function canonicalCityCountry(
  value: string,
): Omit<LocationGeographyHint, "remoteMentioned"> | null {
  const parts = commaParts(value);
  if (parts.length !== 2) return null;
  const city = parts[0];
  const country = normalizeCountry(parts[1]);
  if (!city || !country) return null;

  if (country.code) {
    const name = countryName(country.code);
    return {
      location: new LocationDto({ city, country: name }),
      normalizedLabel: `${city}, ${name}`,
      region: country.code === "CA" ? "canada" : "united-states",
      countryCode: country.code,
      confidence: "high",
    };
  }
  return {
    location: new LocationDto({ city, country: country.otherName }),
    normalizedLabel: `${city}, ${country.otherName}`,
    region: "other",
    confidence: "high",
  };
}

function stripWorkplaceQualifiers(value: string): string {
  let geographicText = value.replace(
    /\(([^()]*)\)/g,
    (whole, content: string) =>
      isWorkplaceQualifierOnly(content, true) ? " " : whole,
  );
  geographicText = normalizeWhitespace(geographicText)
    .replace(/^[/&,+-]\s*/, "")
    .replace(/\s*[/&,+-]$/, "");

  const slashParts = geographicText
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
  if (slashParts.length > 1) {
    const geographicParts = slashParts.filter(
      (part) => !isWorkplaceQualifierOnly(part, false),
    );
    if (geographicParts.length === 1) geographicText = geographicParts[0];
  }
  return normalizeWhitespace(geographicText);
}

function isWorkplaceQualifierOnly(value: string, allowSlash: boolean): boolean {
  if (!/\b(?:hybrid|remote)\b/i.test(value)) return false;
  const withoutWords = value.replace(/\b(?:hybrid|remote|and|or)\b/gi, "");
  const allowedSeparators = allowSlash ? /^[\s/&,+-]*$/ : /^[\s&,+-]*$/;
  return allowedSeparators.test(withoutWords);
}

function isIndependentlyStructuredLocation(value: string): boolean {
  if (isWorkplaceQualifierOnly(value, true)) return true;
  const hint = classifyLocationText(value);
  return hint.region !== "unknown" && hint.confidence !== "low";
}

function normalizeCanadianProvince(value: unknown): string | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  const code = normalized.toUpperCase();
  if (CANADIAN_PROVINCE_CODES.has(code)) return code;
  return CANADIAN_PROVINCE_NAME_TO_CODE[normalized] ?? null;
}

function normalizeUsState(value: string): string | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  const code = normalized.toUpperCase();
  if (US_STATE_AND_TERRITORY_CODES.has(code)) return code;
  return US_STATE_NAME_TO_CODE[normalized] ?? null;
}

function normalizeCountry(
  value: unknown,
):
  | { code: NorthAmericanCountryCode; otherName?: never }
  | { code?: never; otherName: string }
  | null {
  const normalized = normalizeToken(value);
  if (!normalized) return null;
  const compact = normalized.replace(/[^a-z]/g, "");
  if (["canada", "canadian", "ca", "can"].includes(compact)) {
    return { code: "CA" };
  }
  if (
    [
      "us",
      "usa",
      "unitedstates",
      "unitedstatesofamerica",
      "america",
      "american",
    ].includes(compact)
  ) {
    return { code: "US" };
  }
  if (OTHER_COUNTRY_NAMES.has(normalized)) {
    return { otherName: titleCase(normalized) };
  }
  return null;
}

function isCountryOnly(value: string): boolean {
  return (
    Boolean(normalizeCountry(stripWorkplaceQualifiers(value))) &&
    !/\bremote\b/i.test(value) &&
    commaParts(value).length === 1
  );
}

function commaParts(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function mergeWorkFromHomeType(
  current: WorkFromHomeType | null,
  next: WorkFromHomeType | null,
): WorkFromHomeType | null {
  if (!current) return next;
  if (!next || next === current) return current;
  return "Hybrid or Remote";
}

function isBareCityDuplicate(
  item: { location: LocationDto; label: string },
  locations: LocationDto[],
): boolean {
  const city = item.location.city?.trim().toLowerCase();
  if (
    !city ||
    item.location.state ||
    item.location.country ||
    item.label.includes(",")
  ) {
    return false;
  }
  return locations.some(
    (candidate) =>
      candidate !== item.location &&
      candidate.city?.trim().toLowerCase() === city &&
      Boolean(candidate.state),
  );
}

function displayLocation(location: LocationDto): string {
  return [location.city, location.state, location.country]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join(", ");
}

function countryName(code: NorthAmericanCountryCode): string {
  return code === "CA" ? "Canada" : "United States";
}

function normalizeWhitespace(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim();
}

function normalizeToken(value: unknown): string {
  return normalizeWhitespace(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.]/g, " ")
    .replace(/[\u2010-\u2015_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function titleCase(value: string): string {
  return value.replace(/\b\p{L}/gu, (letter) => letter.toUpperCase());
}

function unknownHint(
  location: LocationDto | null,
  normalizedLabel: string,
  remoteMentioned: boolean,
  confidence: LocationParseConfidence,
): LocationGeographyHint {
  return {
    location,
    normalizedLabel,
    region: "unknown",
    confidence,
    remoteMentioned,
  };
}

function isLocationRecord(value: unknown): value is LocationDto {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return "city" in candidate || "state" in candidate || "country" in candidate;
}
