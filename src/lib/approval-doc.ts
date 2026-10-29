// v2.74: reads a type approval certificate (the PDF behind a JRC row).
//
// Why: the JRC tables name manufacturer, product, interoperability certificate
// and dates — but neither the chip nor the security certificate, and for an
// approval one authority issues for another country (e26 Slovenia -> "G1KZ" for
// Kazakhstan) not the country either. The approval certificate itself has all
// three: item 7 "Date and number of certificate" names the security
// certificate, and the model name carries the country code.
//
// Pure functions, no I/O: the text comes from extractPdfText() (cc.server.ts)
// and is flattened to one line, because pdfjs does not keep the line layout.
// Keywords are matched in several languages ("security certificate",
// "Sicherheitszertifikat", "certificat de sécurité", "potrdilo o varnosti", …).

import { COUNTRY_ISO, normalizeCountry } from "./country-flag";
import { parseCertificate, isPlaceholderCertificate } from "./cert-family";
import { generationRank } from "./market-status";
import { resolveFromCardName } from "./ta-country";

export type DocCertificate = {
  /** DD.MM.YYYY, "" when the document names none. */
  date: string;
  /** Certificate number as written, e.g. "ANSSI-CC-2022/38". */
  number: string;
};

export type ApprovalDoc = {
  approvalNumber: string;
  authority: string;
  brand: string;
  modelName: string;
  manufacturer: string;
  submittedOn: string;
  approvalDate: string;
  withdrawnOn: string;
  labs: { functional: string; security: string; interoperability: string };
  certificates: {
    functional: DocCertificate | null;
    security: DocCertificate | null;
    interoperability: DocCertificate | null;
  };
  remarks: string;
};

/** One line, single spaces — the form every regex below works on. */
export function flattenDocText(text: string): string {
  return String(text ?? "")
    .replace(/[\u00a0\u202f]/g, " ")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** "16. 08. 2022", "16/08/2022", "2022-08-16", "6.7.2026" -> "16.08.2022". */
export function docDate(text: string): string {
  const t = String(text ?? "");
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const m = /(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{4})/.exec(t);
  if (!m) return "";
  return `${m[1]!.padStart(2, "0")}.${m[2]!.padStart(2, "0")}.${m[3]}`;
}

const DATE_RE = /\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}/;

// "security certificate" but not "security certification" (that is the lab line).
const SECURITY_KEYWORDS = [
  "security\\s+certificate\\b",
  "sicherheits\\s*-?\\s*zertifikat",
  "sicherheitsbescheinigung",
  "certificat\\s+de\\s+s[ée]curit[ée]",
  "potrdilo\\s+o\\s+varnosti",
  "varnosti\\s*/\\s*security",
  "certificado\\s+de\\s+seguridad",
  "certificato\\s+di\\s+sicurezza",
  "certyfikat\\s+bezpiecze[nń]stwa",
  "bezpe[cč]nostn[ií]\\s+certifik[aá]t",
  "certificat\\s+de\\s+securitate",
  "sertifika\\s+bezpeky",
];
const FUNCTIONAL_KEYWORDS = [
  "functional\\s+certificate\\b",
  "funktionszertifikat",
  "certificat\\s+fonctionnel",
  "potrdilo\\s+o\\s+funkcionalnosti",
  "funkcionalnosti\\s*/\\s*functional",
];
const INTEROP_KEYWORDS = [
  "interoperability\\s+certificate\\b",
  "interoperabilit[äa]ts\\s*-?\\s*zertifikat",
  "certificat\\s+d.interop[ée]rabilit[ée]",
  "interoperabilnosti\\s*/\\s*interoperability",
];

/** A certificate number: the schemes the app knows, else a JRC-style reference. */
const CERT_NUMBER_RE =
  /(?:ANSSI-CC-\d{4}\/\d{1,3}(?:v\d+)?(?:[-\s]?M\d{2})?|DCSSI[-\s]*(?:CC[-\s]*)?\d{4}\/\d{1,3}|BSI-DSZ-(?:CC|ITSEC)-\d{4}(?:-\d{4})?(?:-V\d+)?(?:-MA-?\d{1,2})?|NSCIB-CC-\d{2}-\d{4,8}(?:-CR\d?)?|CC-\d{2}-\d{4,8}|JRC[_ ]?DT[ _-]?Lab\/[\w\-/.]+|\d{4}\/\d{2}\/[A-Z][\w-]*)/i;

type KeywordHit = { end: number };

function keywordHits(flat: string, keywords: string[]): KeywordHit[] {
  const re = new RegExp(`(?:${keywords.join("|")})`, "gi");
  const hits: KeywordHit[] = [];
  for (const m of flat.matchAll(re)) hits.push({ end: (m.index ?? 0) + m[0].length });
  return hits;
}

/**
 * The certificate named after a keyword: "<keyword>: 16. 08. 2022 ; ANSSI-CC-2022/38".
 * Hits with date AND number win over hits with one of them; a number alone
 * ("Security Certificate ANSSI-CC-2022/38" in the annex list) is still a result.
 */
function certificateAfter(flat: string, keywords: string[]): DocCertificate | null {
  let best: { cert: DocCertificate; score: number } | null = null;
  for (const hit of keywordHits(flat, keywords)) {
    const window = flat.slice(hit.end, hit.end + 150);
    // The window stops where the next lettered item starts ("c. interoperabilnosti").
    const cut = /\s[a-c]\.\s+[A-Za-zČŠŽčšž]/.exec(window);
    const scope = cut ? window.slice(0, cut.index) : window;
    const num = CERT_NUMBER_RE.exec(scope);
    const dateText = DATE_RE.exec(scope)?.[0] ?? "";
    const date = dateText ? docDate(dateText) : "";
    if (!num && !date) continue;
    const cert: DocCertificate = { date, number: num ? num[0].replace(/\s+/g, "") : "" };
    const score = (cert.number ? 2 : 0) + (cert.date ? 1 : 0);
    if (!best || score > best.score) best = { cert, score };
  }
  return best ? best.cert : null;
}

/** "for security certification ANSSI Agence … c." -> the laboratory / body. */
function labFor(flat: string, kind: "functional" | "security" | "interoperability"): string {
  const word =
    kind === "functional"
      ? "functional\\s+certification"
      : kind === "security"
        ? "security\\s+certification"
        : "interoperability\\s+certification";
  const re = new RegExp(
    `${word}\\s*:?\\s*(.{2,140}?)(?=\\s+[a-c]\\.\\s+[A-Za-zČŠŽčšž/]|\\s+7\\s*\\.|\\s+Datum in|\\s+Date and number|$)`,
    "i",
  );
  return re.exec(flat)?.[1]?.trim() ?? "";
}

function between(flat: string, startRe: string, endRe: string, max = 200): string {
  const re = new RegExp(`${startRe}\\s*:?\\s*(.{1,${max}}?)(?=\\s+${endRe})`, "i");
  return re.exec(flat)?.[1]?.trim() ?? "";
}

/** Remarks (item 14) up to the signature line ("V Ljubljani, 08. 09. 2026"). */
function remarksOf(flat: string): string {
  const m = /Remarks\s*\(including the position of seals if applicable\)\s*:?\s*(.{1,400})/i.exec(
    flat,
  );
  if (!m) return "";
  const text = m[1]!;
  const sign = /\s(?:V|In|Á|En|À|Done at)\s+[A-ZČŠŽ][\p{L}-]+,?\s+\d{1,2}\s*[./]/u.exec(text);
  return (sign ? text.slice(0, sign.index) : text).trim();
}

/** Reads the fields the app needs from the flattened text of an approval certificate. */
export function parseApprovalText(text: string): ApprovalDoc {
  const flat = flattenDocText(text);
  const approvalNumber =
    /Approval number\s*:?\s*(e\s?\d{1,2}[\w*\-/ ]{1,40}?)(?=\s+1\s*\.|\s+[A-Z][a-z])/i
      .exec(flat)?.[1]
      ?.trim() ?? "";
  const withdrawn =
    /withdrawal of approval\s*:?\s*(.{1,60}?)(?=\s+\d{1,2}\s*\.\s|$)/i.exec(flat)?.[1] ?? "";
  return {
    approvalNumber,
    authority: between(
      flat,
      "Name of competent administration",
      "(?:Obvestilo|Notification|Mitteilung|Communication|Avis|Comunicaci)",
      160,
    ),
    brand: between(flat, "Manufacturing brand or trademark", "2\\s*\\."),
    modelName: between(flat, "Name of model", "3\\s*\\."),
    manufacturer: between(flat, "Name of manufacturer", "4\\s*\\."),
    submittedOn: docDate(/Submitted for approval on\s*:?\s*(.{1,40})/i.exec(flat)?.[1] ?? ""),
    approvalDate: docDate(/Date of approval\s*:?\s*(.{1,40})/i.exec(flat)?.[1] ?? ""),
    withdrawnOn: docDate(withdrawn),
    labs: {
      functional: labFor(flat, "functional"),
      security: labFor(flat, "security"),
      interoperability: labFor(flat, "interoperability"),
    },
    certificates: {
      functional: certificateAfter(flat, FUNCTIONAL_KEYWORDS),
      security: certificateAfter(flat, SECURITY_KEYWORDS),
      interoperability: certificateAfter(flat, INTEROP_KEYWORDS),
    },
    remarks: remarksOf(flat),
  };
}

// ------------------------------------------------------------------ country

const ISO3: Record<string, string> = {
  BIH: "ba",
  ALB: "al",
  KAZ: "kz",
  GEO: "ge",
  MKD: "mk",
  SRB: "rs",
  MNE: "me",
  UKR: "ua",
  MDA: "md",
  ARM: "am",
  AZE: "az",
  UZB: "uz",
  KGZ: "kg",
  TJK: "tj",
  TKM: "tm",
  RUS: "ru",
  BLR: "by",
  TUR: "tr",
  ISR: "il",
  MAR: "ma",
  TUN: "tn",
  MNG: "mn",
  XKX: "xk",
  KOS: "xk",
  SVN: "si",
  HRV: "hr",
  POL: "pl",
  DEU: "de",
  FRA: "fr",
  ESP: "es",
  ITA: "it",
  AUT: "at",
};

const ISO_TO_COUNTRY: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  for (const [name, code] of Object.entries(COUNTRY_ISO)) {
    if (!out[code]) out[code] = name;
  }
  return out;
})();

/** Issuing authority of an eNN mark (UNECE / EU numbering) — for the note only. */
const E_MARK_COUNTRY: Record<string, string> = {
  e1: "Germany",
  e2: "France",
  e3: "Italy",
  e4: "Netherlands",
  e5: "Sweden",
  e6: "Belgium",
  e7: "Hungary",
  e8: "Czechia",
  e9: "Spain",
  e11: "United Kingdom",
  e12: "Austria",
  e13: "Luxembourg",
  e14: "Switzerland",
  e16: "Norway",
  e17: "Finland",
  e18: "Denmark",
  e19: "Romania",
  e20: "Poland",
  e21: "Portugal",
  e22: "Russia",
  e23: "Greece",
  e24: "Ireland",
  e25: "Croatia",
  e26: "Slovenia",
  e27: "Slovakia",
  e28: "Belarus",
  e29: "Estonia",
  e31: "Bosnia and Herzegovina",
  e32: "Latvia",
  e34: "Bulgaria",
  e36: "Lithuania",
  e37: "Türkiye",
  e49: "Cyprus",
  e50: "Malta",
};

export function issuerCountryOfApproval(typeApproval: string): string {
  const m = /^\s*(e\d{1,2})\b/i.exec(String(typeApproval ?? ""));
  return m ? (E_MARK_COUNTRY[m[1]!.toLowerCase()] ?? "") : "";
}

/**
 * "CETIS Digital Tachograph G1KZ" -> Kazakhstan, "… G2V2SI v2.0" -> Slovenia,
 * "… G2-BIH" -> Bosnia and Herzegovina. The code must follow the generation
 * token directly (or after a hyphen): a space would pick up ordinary words.
 */
export function countryFromModelCode(name: string): { country: string; code: string } | null {
  const m = /\bG\s?[12](?:\s?V[12])?-?([A-Z]{2,3})(?![A-Za-z0-9])/.exec(String(name ?? ""));
  if (!m) return null;
  const code = m[1]!;
  const iso = code.length === 3 ? ISO3[code] : code.toLowerCase();
  const country = iso ? ISO_TO_COUNTRY[iso] : "";
  return country ? { country, code } : null;
}

export type TargetCountry = {
  country: string;
  basis: string;
  evidence: string;
  /** Issuing country when it differs from the target ("approved by Slovenia for Kazakhstan"). */
  issuer: string;
};

/**
 * The country an approval was applied for — which is not the country of the
 * eNN mark when one authority approves for another. Order: country named in
 * the model name / remarks, then the country code after the generation token,
 * each tried on the approval certificate first and the JRC card name second.
 */
export function resolveTargetCountry(input: {
  typeApproval: string;
  jrcCardName?: string;
  docModelName?: string;
  docRemarks?: string;
}): TargetCountry | null {
  const issuer = issuerCountryOfApproval(input.typeApproval);
  const sources: Array<[string, string]> = [
    ["Model name in the approval certificate", input.docModelName ?? ""],
    ["Remarks in the approval certificate", input.docRemarks ?? ""],
    ["JRC card name", input.jrcCardName ?? ""],
  ];
  for (const [basis, text] of sources) {
    if (!text.trim()) continue;
    const named = resolveFromCardName(text);
    if (named?.country && !named.country.includes(",")) {
      return {
        country: named.country,
        basis,
        evidence: text.slice(0, 160),
        issuer: issuer === named.country ? "" : issuer,
      };
    }
    const code = countryFromModelCode(text);
    if (code) {
      return {
        country: code.country,
        basis: `${basis} (country code "${code.code}")`,
        evidence: text.slice(0, 160),
        issuer: issuer === code.country ? "" : issuer,
      };
    }
  }
  return null;
}

// --------------------------------------------------------------------- chip

export type ChipSource = {
  device_type?: string | null;
  generation?: string | null;
  security_certificate?: string | null;
  chip_platform_vendor?: string | null;
  certified_security_platform?: string | null;
  certificate_issued_date?: string | null;
  certificate_expiry_date?: string | null;
  country?: string | null;
};

export type ChipDerivation = {
  chip_platform_vendor: string;
  certified_security_platform: string;
  certificate_expiry_date: string;
  /** Cards with this certificate and generation that name this platform. */
  support: number;
  /** Cards with this certificate and generation that name any platform. */
  total: number;
  countries: string[];
};

const UNSURE = /verify|to be confirmed|requires confirmation|not confirmed|unknown|unclear|\?/i;

function key(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mostFrequent(values: string[]): string {
  const count = new Map<string, { text: string; n: number }>();
  for (const v of values) {
    const k = key(v);
    const hit = count.get(k);
    if (hit) hit.n += 1;
    else count.set(k, { text: v, n: 1 });
  }
  return (
    [...count.values()].sort((a, b) => b.n - a.n || b.text.length - a.text.length)[0]?.text ?? ""
  );
}

/**
 * The platform the other cards with the same security certificate AND the same
 * generation name. One certificate covers a platform family (ANSSI-CC-2022/38:
 * Thales G1 v1.6 and G2V2 on Infineon IFX_CCI_000039H), so the generation
 * decides which of its names applies. A derivation, never a reading — callers
 * mark it "likely".
 */
export function deriveChipFromCertificate(
  cards: ChipSource[],
  certificate: string,
  generation: string,
  deviceType = "Card",
  issuedDate = "",
): ChipDerivation | null {
  if (isPlaceholderCertificate(certificate)) return null;
  const family = parseCertificate(certificate)?.family;
  if (!family) return null;
  const gen = generationRank(generation);
  const peers = cards.filter((c) => {
    if ((c.device_type || "Card") !== deviceType) return false;
    if (parseCertificate(c.security_certificate)?.family !== family) return false;
    if (generationRank(c.generation) !== gen) return false;
    const text = String(c.chip_platform_vendor ?? "").trim();
    return text !== "" && !UNSURE.test(text);
  });
  if (peers.length === 0) return null;
  const vendor = mostFrequent(peers.map((c) => String(c.chip_platform_vendor).trim()));
  const sameVendor = peers.filter((c) => key(String(c.chip_platform_vendor)) === key(vendor));
  const platform = mostFrequent(
    sameVendor
      .map((c) => String(c.certified_security_platform ?? "").trim())
      .filter((t) => t !== "" && !UNSURE.test(t)),
  );
  // Validity belongs to the certificate (and its maintenance), not to the generation:
  // taken from cards with the same certificate AND the same issue date, any generation.
  const expiry = issuedDate
    ? mostFrequent(
        cards
          .filter(
            (c) =>
              (c.device_type || "Card") === deviceType &&
              parseCertificate(c.security_certificate)?.family === family &&
              String(c.certificate_issued_date ?? "").trim() === issuedDate &&
              String(c.certificate_expiry_date ?? "").trim() !== "",
          )
          .map((c) => String(c.certificate_expiry_date).trim()),
      )
    : "";
  return {
    chip_platform_vendor: vendor,
    certified_security_platform: platform,
    certificate_expiry_date: expiry,
    support: sameVendor.length,
    total: peers.length,
    countries: [...new Set(sameVendor.map((c) => String(c.country ?? "")).filter(Boolean))].sort(),
  };
}

// --------------------------------------------------------------- enrichment

export type ProposedField = { field: string; label: string; old: string; new: string };

export type Enrichment = {
  /** Fields the approval fills on the new record (shown to the reviewer, applied on approval). */
  fields: ProposedField[];
  /** Evidence lines for the proposal card. */
  payload: Record<string, string>;
  /** Target country when the approval certificate / JRC name settles it. */
  country: string;
};

const LABELS: Record<string, string> = {
  security_certificate: "Security Certificate",
  certificate_issued_date: "Date Certificate Issued",
  certificate_expiry_date: "Certificate Validity Expiration Date",
  issued_by_authority: "Issued by Authority",
  functional_certificate_lab: "Functional Certificate Lab",
  security_certificate_lab: "Security Certificate Lab",
  certificate_holder: "Certificate Holder",
  chip_platform_vendor: "Chip / Platform Vendor",
  certified_security_platform: "Certified Security Platform",
  verification_note: "Verification Note",
};

/** Columns an approval's enrichment may write into a new record. */
export const ENRICHMENT_COLUMNS = new Set(Object.keys(LABELS));

function withLabs(lab: string, cert: DocCertificate | null): string {
  const parts = [
    lab,
    cert ? [cert.number, cert.date && `(${cert.date})`].filter(Boolean).join(" ") : "",
  ];
  return parts.filter(Boolean).join(" — ");
}

/**
 * Everything the approval certificate and the existing records say about a new
 * JRC entry. `doc` may be null (PDF not found / not readable): the country from
 * the JRC card name still applies.
 */
export function buildEnrichment(input: {
  typeApproval: string;
  jrcCardName: string;
  generation: string;
  deviceType?: string;
  doc: ApprovalDoc | null;
  docUrl: string;
  cards: ChipSource[];
  today: string;
}): Enrichment {
  const { doc } = input;
  const fields: ProposedField[] = [];
  const payload: Record<string, string> = {};
  const add = (field: string, value: string) => {
    const v = String(value ?? "").trim();
    if (v) fields.push({ field, label: LABELS[field] ?? field, old: "", new: v });
  };

  const target = resolveTargetCountry({
    typeApproval: input.typeApproval,
    jrcCardName: input.jrcCardName,
    docModelName: doc?.modelName,
    docRemarks: doc?.remarks,
  });
  if (target) {
    payload["Applicant country"] = target.country;
    payload["Country source"] = target.basis;
    payload["Country evidence"] = target.evidence;
    if (target.issuer)
      payload["Approval issued by"] =
        `${target.issuer} (approval mark ${input.typeApproval.split(/[-_ ]/)[0]})`;
  }

  if (input.docUrl) payload["Approval document"] = input.docUrl;
  if (!doc) {
    if (input.docUrl)
      payload["Approval document read"] =
        "not readable — security certificate and chip not checked";
    return { fields, payload, country: target?.country ?? "" };
  }

  if (doc.approvalDate) payload["Approval date (document)"] = doc.approvalDate;
  if (doc.modelName) payload["Model name (document)"] = doc.modelName;
  const sec = doc.certificates.security;
  if (!sec || !sec.number) {
    payload["Security certificate"] = "none named in the approval document";
  } else {
    payload["Security certificate"] = sec.number;
    if (sec.date) payload["Certificate issued"] = sec.date;
    payload["Basis"] = "Exact: security certificate named in the approval certificate (item 7)";
    add("security_certificate", sec.number);
    add("certificate_issued_date", sec.date);
    add("security_certificate_lab", withLabs(doc.labs.security, sec));
    if (doc.labs.security) payload["Security lab"] = doc.labs.security;

    const chip = deriveChipFromCertificate(
      input.cards,
      sec.number,
      input.generation,
      input.deviceType || "Card",
      sec.date,
    );
    if (chip) {
      add("chip_platform_vendor", chip.chip_platform_vendor);
      add("certified_security_platform", chip.certified_security_platform);
      add("certificate_expiry_date", chip.certificate_expiry_date);
      payload["Chip basis"] =
        `Derived (likely): ${chip.support} of ${chip.total} cards with ${sec.number} and the same generation name this platform (${chip.countries.slice(0, 6).join(", ")}) — check before approving`;
      payload["Chip"] = chip.chip_platform_vendor;
    } else {
      payload["Chip basis"] =
        `No other card with ${sec.number} and this generation names a platform — chip stays empty`;
    }
  }
  add("issued_by_authority", doc.authority);
  add("functional_certificate_lab", withLabs(doc.labs.functional, doc.certificates.functional));
  add("certificate_holder", doc.manufacturer);
  const note = [
    doc.approvalDate &&
      `Approval ${doc.approvalNumber || input.typeApproval} of ${doc.approvalDate}`,
    doc.submittedOn && `submitted ${doc.submittedOn}`,
    doc.remarks && doc.remarks.replace(/^[^/]*\/\s*/, "").slice(0, 160),
    doc.certificates.interoperability?.number &&
      `interoperability certificate ${doc.certificates.interoperability.number}${doc.certificates.interoperability.date ? ` of ${doc.certificates.interoperability.date}` : ""}`,
    `read from the approval certificate on ${input.today}`,
  ]
    .filter(Boolean)
    .map((part) => String(part).replace(/[.;\s]+$/, ""))
    .join("; ");
  add("verification_note", note);
  return { fields, payload, country: target?.country ?? "" };
}

export { normalizeCountry };
