// Server-only: Common Criteria portal (commoncriteriaportal.org) certified
// products export, reduced to digital tachograph entries and split by device
// type (Card / Motion Sensor / Vehicle Unit).
//
// The portal publishes the full product list as CSV. It carries the
// certification date and the validity expiration date, but not the official
// certificate number — that one is derived from the certification report file
// name and from the product name (both contain it in practice).

export const CC_PRODUCTS_URL = "https://www.commoncriteriaportal.org/products/certified_products.csv";
export const CC_PORTAL_URL = "https://www.commoncriteriaportal.org/products/index.cfm";

export type CcDeviceType = "Card" | "Motion Sensor" | "Vehicle Unit";

export type CcEntry = {
  certificate: string; // e.g. ANSSI-CC-2022/38-R01 ("" when not derivable)
  certificateSource: string; // where the number came from
  deviceType: CcDeviceType;
  product: string;
  vendor: string;
  scheme: string;
  assurance: string;
  protectionProfiles: string;
  generation: string; // G1 / G2.1 / G2.2 (comma separated), "" for VU/MS
  issued: string; // DD.MM.YYYY
  expires: string; // DD.MM.YYYY
  reportUrl: string;
};

// ---------------------------------------------------------------- csv parsing

/** Minimal RFC4180 parser (quoted fields, embedded commas + newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      field = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

// ------------------------------------------------------- certificate numbers

const FILENAME_RULES: { re: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  {
    re: /ANSSI[-_]CC[-_](\d{4})[-_](\d{2,3}(?:v\d)?)(?:[-_]?([SMR]\d{2}))?/i,
    build: (m) => `ANSSI-CC-${m[1]}/${m[2]}${m[3] ? `-${m[3].toUpperCase()}` : ""}`,
  },
  {
    re: /EUCC[-_]ANSSI[-_](\d{4})[-_](\d{2})[-_](\d{2})/i,
    build: (m) => `EUCC-ANSSI-${m[1]}-${m[2]}-${m[3]}`,
  },
  {
    re: /NSCIB[-_ ]?CC[-_ ]?(\d{2})[-_](\d{5,6})/i,
    build: (m) => `NSCIB-CC-${m[1]}-${m[2]}`,
  },
  {
    re: /NSCIB[-_ ]?CC[-_ ]?(\d{6,8})(?:[-_](\d{2}))?/i,
    build: (m) => `NSCIB-CC-${m[1]}${m[2] ? `-${m[2]}` : ""}`,
  },
  { re: /\bCC-(\d{2})-(\d{6})\b/i, build: (m) => `NSCIB-CC-${m[1]}-${m[2]}` },
  {
    re: /^(\d{4})(V\d)?[a-c](?:_pdf)?\.pdf$/i,
    build: (m) => `BSI-DSZ-CC-${m[1]}${m[2] ? `-${m[2].toUpperCase()}` : ""}`,
  },
];

// CC_PAT from cc_tachograph.py: how certificate numbers appear inside the
// certification report PDFs (OCR variants included).
const CC_TEXT_PATTERNS = [
  /(?:EUCC[- ]?ANSSI|ANSSI[- ]?CC)[- ]?(\d{4})[/ _-](\d{2,3}(?:\s?v\d)?)(?:[- ]?([SMR]\s?\d{2}))?/gi,
  /NSCIB[- ]?CC[- ]?(\d{2})[- ]?(\d{5,6})(?:[- ]?(\d{2}))?/gi,
  /BSI[- ]?DSZ[- ]?CC[- ]?(\d{4})(?:[- ]?(V\d))?/gi,
];

const CERT_IN_TEXT = /((?:EUCC-ANSSI|ANSSI-CC|NSCIB-CC|BSI-DSZ-CC)-[0-9A-Za-z/_.-]{3,30})/;

/** normalise_cc() from cc_tachograph.py: unify OCR / spelling variants. */
export function normaliseCc(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, "").replace(/_/g, "-");
  s = s.replace(/[/]/, "/"); // keep the ANSSI year/number slash
  s = s.replace(/-([SMR])(\d{2})$/, "-$1$2");
  return s.replace(/[.,;)]+$/, "");
}

/**
 * cert_number() from cc_tachograph.py: pull the official certificate number
 * out of the report PDF text; returns "" when nothing is found.
 */
export function certificateFromText(text: string): string {
  const flat = text.replace(/\s+/g, " ");
  for (const re of CC_TEXT_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(flat);
    if (!m) continue;
    const prefix = /EUCC/i.test(m[0])
      ? "EUCC-ANSSI"
      : /ANSSI/i.test(m[0])
        ? "ANSSI-CC"
        : /NSCIB/i.test(m[0])
          ? "NSCIB-CC"
          : "BSI-DSZ-CC";
    if (prefix === "EUCC-ANSSI" || prefix === "ANSSI-CC") {
      const num = (m[2] ?? "").replace(/\s+/g, "");
      const rev = (m[3] ?? "").replace(/\s+/g, "");
      return normaliseCc(`${prefix}-${m[1]}/${num}${rev ? `-${rev}` : ""}`);
    }
    if (prefix === "NSCIB-CC") {
      return m[3] ? `NSCIB-CC-${m[2]}${m[3]}` : `NSCIB-CC-${m[1]}-${m[2]}`;
    }
    return `BSI-DSZ-CC-${m[1]}${m[2] ? `-${m[2].toUpperCase()}` : ""}`;
  }
  const loose = CERT_IN_TEXT.exec(flat);
  return loose ? normaliseCc(loose[1]) : "";
}

export function certificateNumber(
  product: string,
  reportUrl: string,
  pdfText?: string,
): { number: string; source: string } {
  if (pdfText) {
    const fromPdf = certificateFromText(pdfText);
    if (fromPdf) return { number: fromPdf, source: "Certificate PDF" };
  }
  const inName = CERT_IN_TEXT.exec(product);
  if (inName) return { number: normaliseCc(inName[1]), source: "Product name" };
  let file = reportUrl.split("/").pop() ?? "";
  try {
    file = decodeURIComponent(file);
  } catch {
    /* keep raw file name */
  }
  for (const rule of FILENAME_RULES) {
    const m = rule.re.exec(file);
    if (m) return { number: rule.build(m), source: "Certification report" };
  }
  return { number: "", source: "" };
}

/** Comparable form: ignores case, separators and the /-vs- notation. */
export function normCert(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Without a revision/maintenance suffix (-R01, -S02, -M01). */
export function baseCert(value: string): string {
  return normCert(value.replace(/-(?:r|s|m|ma[-_]?)\d{1,2}$/i, ""));
}

// -------------------------------------------------------------- device + gen

export function deviceTypeOf(product: string, pps: string, category: string): CcDeviceType | null {
  const hay = `${product} ${pps} ${category}`.toLowerCase();
  // Protection profile tokens are matched on their own, so unrelated products
  // (e.g. a database with "DBMS_PP") never look like a motion sensor.
  const pp = new Set(
    pps
      .toLowerCase()
      .split(/[,;]/)
      .map((t) => t.trim()),
  );
  const has = (...tokens: string[]) => tokens.some((t) => pp.has(t));
  const tachoContext =
    /tacho|dtco|motion sensor|vehicle unit/.test(hay) ||
    has("tc_pp", "ms_pp", "vu_pp", "tachographcard_v1.02");
  if (!tachoContext) return null;
  if (has("ms_pp") || /pp-0093|motion sensor/.test(hay)) return "Motion Sensor";
  if ((has("vu_pp") || /pp-0094|pp-0057|vehicle unit/.test(hay)) && !has("tachographcard_v1.02", "tc_pp"))
    return "Vehicle Unit";
  if (has("tc_pp", "tachographcard_v1.02") || /pp-0091|pp-0070|tachograph card|tacho/.test(hay)) {
    if (/vehicle unit|dtco/.test(hay)) return "Vehicle Unit";
    return "Card";
  }
  return null;
}

/** generations() from cc_tachograph.py: PP refs + product/cert text. */
export function generationOf(
  product: string,
  pps: string,
  deviceType: CcDeviceType,
  pdfText?: string,
): string {
  if (deviceType !== "Card") return "";
  const hay = `${product} ${pps} ${pdfText ?? ""}`.toUpperCase().replace(/\s+/g, "");
  const gens = new Set<string>();
  if (/TACHOGRAPHCARD_V1\.02|PP-0070|\bG1\b|,G1|G1,/.test(hay)) gens.add("G1");
  if (/TC_PP|PP-0091|G2V1/.test(hay)) gens.add("G2.1");
  if (/G2V2/.test(hay)) gens.add("G2.2");
  return Array.from(gens).join(", ");
}

function toDe(usDate: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(usDate.trim());
  return m ? `${m[2]}.${m[1]}.${m[3]}` : usDate.trim();
}

// ------------------------------------------------------------------ fetching

export function parseCcProducts(csv: string): CcEntry[] {
  const rows = parseCsv(csv);
  if (rows.length === 0) return [];
  const header = rows[0].map((h) => h.trim());
  const idx = (name: string) => header.indexOf(name);
  const iCat = idx("Category");
  const iName = idx("Name");
  const iVendor = idx("Manufacturer");
  const iScheme = idx("Scheme");
  const iEal = idx("Assurance Level");
  const iPp = idx("Protection Profile(s)");
  const iIssued = idx("Certification Date");
  const iExp = idx("Archived Date");
  const iReport = idx("Certification Report URL");

  const out = new Map<string, CcEntry>();
  for (const row of rows.slice(1)) {
    const product = (row[iName] ?? "").replace(/&#x2f;/gi, "/").trim();
    const pps = (row[iPp] ?? "").trim();
    const category = (row[iCat] ?? "").trim();
    const deviceType = deviceTypeOf(product, pps, category);
    if (!deviceType) continue;
    const reportUrl = (row[iReport] ?? "").trim();
    const { number, source } = certificateNumber(product, reportUrl);
    const entry: CcEntry = {
      certificate: number,
      certificateSource: source,
      deviceType,
      product,
      vendor: (row[iVendor] ?? "").replace(/&#x2f;/gi, "/").trim(),
      scheme: (row[iScheme] ?? "").trim(),
      assurance: (row[iEal] ?? "").trim(),
      protectionProfiles: pps,
      generation: generationOf(product, pps, deviceType),
      issued: toDe(row[iIssued] ?? ""),
      expires: toDe(row[iExp] ?? ""),
      reportUrl,
    };
    const key = `${entry.deviceType}|${entry.certificate || entry.product}|${entry.issued}`;
    if (!out.has(key)) out.set(key, entry);
  }
  return Array.from(out.values());
}

export async function fetchCcEntries(): Promise<CcEntry[]> {
  const res = await fetch(CC_PRODUCTS_URL, {
    headers: { "user-agent": "TachographCardsInfoTool/1.0" },
  });
  if (!res.ok) {
    throw new Error(`Common Criteria request failed [${res.status}]: ${res.statusText}`);
  }
  return parseCcProducts(await res.text());
}

// ----------------------------------------------------------------- proposals

export type CcCardRow = {
  id: string;
  country: string;
  generation: string;
  security_certificate: string;
  certificate_issued_date: string;
  certificate_expiry_date: string;
  current_manufacturer: string;
};

type CcProposal = {
  fingerprint: string;
  kind: string;
  card_id: string | null;
  country: string;
  generation: string;
  jrc_manufacturer: string;
  jrc_card_name: string;
  jrc_certificate: string;
  jrc_date: string;
  jrc_eov: string;
  jrc_type_approval: string;
  source_url: string;
  source_type: string;
  source_label: string;
  title: string;
  payload: Record<string, string>;
  changes: { fields: { field: string; label: string; old: string; new: string }[] };
  status: string;
};

const SOURCE = "cc_certificates";
const SOURCE_LABEL = "Common Criteria portal";

function payloadOf(e: CcEntry): Record<string, string> {
  return {
    "Device type": e.deviceType,
    "Security certificate": e.certificate || "not published",
    "Certificate number from": e.certificateSource || "—",
    Product: e.product,
    Vendor: e.vendor,
    Generation: e.generation,
    "Protection profile(s)": e.protectionProfiles,
    "Assurance level": e.assurance,
    Scheme: e.scheme,
    "Date Certificate Issued": e.issued,
    "Certificate Validity Expiration Date": e.expires,
    "Certification report": e.reportUrl,
  };
}

/**
 * Cards get field proposals (issue / expiry date) when the portal knows the
 * certificate; everything else — and every Motion Sensor / Vehicle Unit entry —
 * becomes an informational proposal.
 */
export function buildCcProposals(entries: CcEntry[], cards: CcCardRow[]): CcProposal[] {
  const out: CcProposal[] = [];
  const seen = new Set<string>();

  for (const e of entries) {
    const matches =
      e.deviceType === "Card" && e.certificate
        ? cards.filter((c) => {
            const have = normCert(c.security_certificate || "");
            if (!have) return false;
            return have.includes(normCert(e.certificate)) || have.includes(baseCert(e.certificate));
          })
        : [];

    if (matches.length > 0) {
      for (const card of matches) {
        const fields: CcProposal["changes"]["fields"] = [];
        if (e.issued && (card.certificate_issued_date || "").trim() !== e.issued) {
          fields.push({
            field: "certificate_issued_date",
            label: "Date Certificate Issued",
            old: card.certificate_issued_date || "",
            new: e.issued,
          });
        }
        if (e.expires && (card.certificate_expiry_date || "").trim() !== e.expires) {
          fields.push({
            field: "certificate_expiry_date",
            label: "Certificate Validity Expiration Date",
            old: card.certificate_expiry_date || "",
            new: e.expires,
          });
        }
        if (fields.length === 0) continue;
        const fp = `${SOURCE}:card:${card.id}:${normCert(e.certificate)}:${e.issued}:${e.expires}`;
        if (seen.has(fp)) continue;
        seen.add(fp);
        out.push({
          fingerprint: fp,
          kind: "changed",
          card_id: card.id,
          country: card.country,
          generation: card.generation || e.generation,
          jrc_manufacturer: e.vendor,
          jrc_card_name: e.product,
          jrc_certificate: e.certificate,
          jrc_date: e.issued,
          jrc_eov: e.expires,
          jrc_type_approval: "",
          source_url: e.reportUrl || CC_PORTAL_URL,
          source_type: SOURCE,
          source_label: `${SOURCE_LABEL} · Card`,
          title: `Card · ${card.country} · ${e.certificate} — certificate dates`,
          payload: payloadOf(e),
          changes: { fields },
          status: "pending",
        });
      }
      continue;
    }

    const fp = `${SOURCE}:${e.deviceType}:${normCert(e.certificate) || e.product}:${e.issued}:${e.expires}`;
    if (seen.has(fp)) continue;
    seen.add(fp);
    out.push({
      fingerprint: fp,
      kind: "info",
      card_id: null,
      country: "",
      generation: e.generation,
      jrc_manufacturer: e.vendor,
      jrc_card_name: e.product,
      jrc_certificate: e.certificate,
      jrc_date: e.issued,
      jrc_eov: e.expires,
      jrc_type_approval: "",
      source_url: e.reportUrl || CC_PORTAL_URL,
      source_type: SOURCE,
      source_label: `${SOURCE_LABEL} · ${e.deviceType}`,
      title: `${e.deviceType} · ${e.certificate || e.product} — ${e.vendor}`,
      payload: payloadOf(e),
      changes: { fields: [] },
      status: "pending",
    });
  }
  return out;
}
