/**
 * Country → ISO code → flag. Shared by the UI and by the update-approval flow,
 * so that a card's flag is always derived from its country field and can never
 * contradict it.
 *
 * Background: the flag used to be read from the stored `country_flag` emoji
 * whenever the ISO lookup missed. A country value carrying a stray space or a
 * non-breaking space (as JRC table cells sometimes do) missed the lookup, and
 * the card then kept showing the flag of whatever country it had been before —
 * e.g. a Dutch flag on a record whose country had been corrected to Germany.
 * The lookup below therefore normalises before matching, and the write paths
 * normalise the value itself.
 */

export const COUNTRY_ISO: Record<string, string> = {
  Albania: "al",
  Armenia: "am",
  Austria: "at",
  Azerbaijan: "az",
  Belarus: "by",
  Belgium: "be",
  "Bosnia and Herzegovina": "ba",
  Bulgaria: "bg",
  Croatia: "hr",
  Cyprus: "cy",
  Czechia: "cz",
  Denmark: "dk",
  Estonia: "ee",
  Finland: "fi",
  France: "fr",
  Georgia: "ge",
  Germany: "de",
  Greece: "gr",
  Hungary: "hu",
  Iceland: "is",
  Ireland: "ie",
  Israel: "il",
  Italy: "it",
  Kazakhstan: "kz",
  Kyrgyzstan: "kg",
  Latvia: "lv",
  Liechtenstein: "li",
  Lithuania: "lt",
  Luxembourg: "lu",
  Malta: "mt",
  Moldova: "md",
  Monaco: "mc",
  Montenegro: "me",
  Netherlands: "nl",
  "North Macedonia": "mk",
  Norway: "no",
  Poland: "pl",
  Portugal: "pt",
  Romania: "ro",
  Russia: "ru",
  "San Marino": "sm",
  Serbia: "rs",
  Slovakia: "sk",
  Slovenia: "si",
  Spain: "es",
  Sweden: "se",
  Switzerland: "ch",
  Tajikistan: "tj",
  Turkmenistan: "tm",
  Türkiye: "tr",
  Ukraine: "ua",
  "United Kingdom": "gb",
  Uzbekistan: "uz",
};

/** Spellings seen in JRC tables and imports that mean an entry above. */
const COUNTRY_ALIASES: Record<string, string> = {
  "czech republic": "Czechia",
  deutschland: "Germany",
  holland: "Netherlands",
  "the netherlands": "Netherlands",
  macedonia: "North Macedonia",
  "north macedonia (fyrom)": "North Macedonia",
  turkey: "Türkiye",
  turkiye: "Türkiye",
  "russian federation": "Russia",
  "united kingdom of great britain and northern ireland": "United Kingdom",
  uk: "United Kingdom",
  "great britain": "United Kingdom",
  "bosnia & herzegovina": "Bosnia and Herzegovina",
  "bosnia-herzegovina": "Bosnia and Herzegovina",
  "republic of moldova": "Moldova",
};

/**
 * Canonical country name for a stored value: trims, collapses inner runs of
 * whitespace (including NBSP), then matches case-insensitively. Returns the
 * input trimmed when nothing matches, so unknown countries stay visible.
 */
export function normalizeCountry(country: string): string {
  const cleaned = String(country ?? "")
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .trim();
  if (cleaned.length === 0) return "";
  if (COUNTRY_ISO[cleaned]) return cleaned;
  const lower = cleaned.toLowerCase();
  const alias = COUNTRY_ALIASES[lower];
  if (alias) return alias;
  for (const name of Object.keys(COUNTRY_ISO)) {
    if (name.toLowerCase() === lower) return name;
  }
  return cleaned;
}

/** ISO 3166-1 alpha-2 code (lowercase) for a country, or "" if unknown. */
export function isoForCountry(country: string): string {
  return COUNTRY_ISO[normalizeCountry(country)] ?? "";
}

/** flagcdn URL for a country, or null when the country is not in the map. */
export function flagUrl(country: string, size: 40 | 80 = 40): string | null {
  const code = isoForCountry(country);
  return code ? `https://flagcdn.com/w${size}/${code}.png` : null;
}

/**
 * Regional-indicator emoji for a country, or "" when unknown. Used to keep the
 * stored `country_flag` column consistent whenever a country is written.
 */
export function flagEmoji(country: string): string {
  const code = isoForCountry(country);
  if (code.length !== 2) return "";
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((ch) => 0x1f1e6 + (ch.charCodeAt(0) - 65)),
  );
}
