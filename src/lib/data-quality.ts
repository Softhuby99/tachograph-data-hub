// v2.53: data quality checks (Tools → Data quality).
//
// Computed live from the cards with their manual overrides applied — nothing
// is stored per record. The rules were agreed on 02.10.2026:
//  - Errors (mandatory fields)
//      Card:            Country, Generation, Type approval number, Manufacturer,
//                       Application, Date/Status, JRC interoperability status
//      Vehicle Unit /
//      Motion Sensor:   Country, Type approval number, Manufacturer
//  - Warnings (plausibility)
//      Date/Status and certificate dates must be readable as day/month/year,
//      certificate expiry must lie after issue, a card's generation must be
//      G1, G2.1 or G2.2, and the country must be a known country.
// Security certificate and chip data are not mandatory (yet).
//
// Pure functions without server imports, so the view can share the types.

import { parseLooseDate } from "@/lib/expiry";
import { COUNTRY_ISO, normalizeCountry } from "@/lib/country-flag";
import { isPlaceholderCertificate, parseCertificate } from "@/lib/cert-family";

/** "info" = certificate maintenance list (v2.55); not counted as error or warning. */
export type QualityLevel = "error" | "warning" | "info";

export type QualityRule =
  | "missing_field"
  | "date_unreadable"
  | "expiry_before_issue"
  | "generation_unknown"
  | "country_unknown"
  | "certificate_missing"
  | "certificate_unparsed"
  | "certificate_unassigned";

export type QualityIssue = {
  cardId: string;
  level: QualityLevel;
  rule: QualityRule;
  field: string;
  fieldLabel: string;
  value: string;
  message: string;
  country: string;
  deviceType: string;
  typeApproval: string;
  manufacturer: string;
};

export type QualitySummary = {
  records: number;
  recordsWithErrors: number;
  recordsWithWarnings: number;
  errors: number;
  warnings: number;
  /** v2.55: certificate maintenance list entries. */
  infos: number;
  byRule: Record<string, number>;
};

export const FIELD_LABELS: Record<string, string> = {
  country: "Country",
  generation: "Generation",
  type_approval_number: "Type approval number",
  current_manufacturer: "Current manufacturer",
  application: "Application",
  date_status: "Date / Status",
  jrc_interoperability_status: "JRC interoperability status",
  certificate_issued_date: "Date certificate issued",
  certificate_expiry_date: "Certificate validity expiration date",
  security_certificate: "Security certificate",
};

export const RULE_LABELS: Record<QualityRule, string> = {
  missing_field: "Mandatory field empty",
  date_unreadable: "Date not readable (day/month/year)",
  expiry_before_issue: "Expiry not after issue",
  generation_unknown: "Generation not G1 / G2.1 / G2.2",
  country_unknown: "Country not in country list",
  certificate_missing: "Security certificate missing (maintenance list)",
  certificate_unparsed: "Security certificate not recognised (maintenance list)",
  certificate_unassigned: "Certificate family not assigned to a platform line",
};

const CARD_REQUIRED = [
  "country",
  "generation",
  "type_approval_number",
  "current_manufacturer",
  "application",
  "date_status",
  "jrc_interoperability_status",
] as const;
const DEVICE_REQUIRED = ["country", "type_approval_number", "current_manufacturer"] as const;
const GENERATIONS = new Set(["G1", "G2.1", "G2.2"]);
const DATE_FIELDS = ["date_status", "certificate_issued_date", "certificate_expiry_date"] as const;

/** Dashes and blanks people type when a value is unknown count as empty. */
export function isEmptyValue(v: unknown): boolean {
  const s = String(v ?? "").trim();
  return s === "" || /^[-–—]+$/.test(s);
}

const str = (v: unknown) => String(v ?? "").trim();

/** "Bulgaria, Poland" and "Georgia / Azerbaijan" name several countries. */
function unknownCountries(value: string): string[] {
  const known = (p: string) => !!COUNTRY_ISO[normalizeCountry(p)];
  if (known(value)) return []; // e.g. "Bosnia and Herzegovina"
  return value
    .split(/\s*(?:,|;|\/|\+|&)\s*/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .filter((p) => !known(p));
}

export type QualityCard = Record<string, unknown> & { id: string };

/** Applies the manual overrides the same way the UI does (patch wins). */
export function mergeOverrides(
  cards: Record<string, unknown>[],
  overrides: { card_id: string; patch: Record<string, string> }[],
): QualityCard[] {
  const byId = new Map(overrides.map((o) => [o.card_id, o.patch ?? {}]));
  return cards.map((c) => ({ ...c, ...(byId.get(String(c["id"])) ?? {}) }) as QualityCard);
}

export function checkCards(
  cards: QualityCard[],
  /** v2.55: platform lines — families outside every line go on the maintenance list. */
  lines?: { families: string[] }[],
): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const lineFamilies = lines ? new Set(lines.flatMap((l) => l.families)) : null;
  for (const c of cards) {
    const deviceType = str(c["device_type"]) || "Card";
    const isCard = deviceType === "Card";
    const base = {
      cardId: String(c.id),
      country: str(c["country"]),
      deviceType,
      typeApproval: str(c["type_approval_number"]),
      manufacturer: str(c["current_manufacturer"]),
    };
    const add = (level: QualityLevel, rule: QualityRule, field: string, message: string) =>
      issues.push({
        ...base,
        level,
        rule,
        field,
        fieldLabel: FIELD_LABELS[field] ?? field,
        value: str(c[field]).slice(0, 200),
        message,
      });

    const required = isCard ? CARD_REQUIRED : DEVICE_REQUIRED;
    const missing = new Set<string>();
    for (const f of required) {
      if (isEmptyValue(c[f])) {
        missing.add(f);
        add("error", "missing_field", f, `${FIELD_LABELS[f]} is empty`);
      }
    }

    for (const f of DATE_FIELDS) {
      const v = str(c[f]);
      if (missing.has(f) || isEmptyValue(v)) continue;
      if (!parseLooseDate(v)) {
        add(
          "warning",
          "date_unreadable",
          f,
          `${FIELD_LABELS[f]} "${v.slice(0, 60)}" is not a plain date`,
        );
      }
    }

    const issued = parseLooseDate(c["certificate_issued_date"]);
    const expiry = parseLooseDate(c["certificate_expiry_date"]);
    if (issued && expiry && expiry.getTime() <= issued.getTime()) {
      add(
        "warning",
        "expiry_before_issue",
        "certificate_expiry_date",
        `Certificate expiry ${str(c["certificate_expiry_date"])} is not after issue ${str(c["certificate_issued_date"])}`,
      );
    }

    if (isCard && !missing.has("generation") && !GENERATIONS.has(str(c["generation"]))) {
      add(
        "warning",
        "generation_unknown",
        "generation",
        `Generation "${str(c["generation"])}" is not G1, G2.1 or G2.2`,
      );
    }

    // v2.55: certificate maintenance list (Platform Timeline) — cards only.
    if (isCard) {
      const certText = str(c["security_certificate"]);
      const ref = parseCertificate(certText);
      if (!ref && isPlaceholderCertificate(certText)) {
        add("info", "certificate_missing", "security_certificate", certText ? `Placeholder "${certText.slice(0, 60)}" — no certificate number` : "No security certificate");
      } else if (!ref) {
        add("info", "certificate_unparsed", "security_certificate", `"${certText.slice(0, 60)}" is not a recognised certificate number`);
      } else if (lineFamilies && !lineFamilies.has(ref.family)) {
        add("info", "certificate_unassigned", "security_certificate", `${ref.family} belongs to no platform line`);
      }
    }

    if (!missing.has("country") && !isEmptyValue(c["country"])) {
      const unknown = unknownCountries(str(c["country"]));
      if (unknown.length > 0) {
        add(
          "warning",
          "country_unknown",
          "country",
          `Not in the country list: ${unknown.join(", ")}`,
        );
      }
    }
  }
  return issues;
}

export function summarise(cards: QualityCard[], issues: QualityIssue[]): QualitySummary {
  const byRule: Record<string, number> = {};
  const errIds = new Set<string>();
  const warnIds = new Set<string>();
  for (const i of issues) {
    byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
    if (i.level === "error") errIds.add(i.cardId);
    else if (i.level === "warning") warnIds.add(i.cardId);
  }
  return {
    records: cards.length,
    recordsWithErrors: errIds.size,
    recordsWithWarnings: warnIds.size,
    errors: issues.filter((i) => i.level === "error").length,
    warnings: issues.filter((i) => i.level === "warning").length,
    infos: issues.filter((i) => i.level === "info").length,
    byRule,
  };
}
