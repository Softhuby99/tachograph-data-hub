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
    re: /ANSSI[-_]CC[-_](\d{4})[-_](\d{2,3})(?:[-_]?([SMR]\d{2}))?/i,
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

const CERT_IN_TEXT = /((?:EUCC-ANSSI|ANSSI-CC|NSCIB-CC|BSI-DSZ-CC)-[0-9A-Za-z/_.-]{3,30})/;

export function certificateNumber(
  product: string,
  reportUrl: string,
): { number: string; source: string } {
  const inName = CERT_IN_TEXT.exec(product);
  if (inName) return { number: inName[1].replace(/[.,;)]+$/, ""), source: "Product name" };
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
  if (/ms_pp|pp-0093|motion sensor/.test(hay)) return "Motion Sensor";
  if (/vu_pp|pp-0094|pp-0057|vehicle unit/.test(hay) && !/tachographcard|tc_pp/.test(hay))
    return "Vehicle Unit";
  if (/tc_pp|pp-0091|pp-0070|tachographcard|tachograph card|tacho/.test(hay)) {
    if (/vehicle unit|dtco/.test(hay)) return "Vehicle Unit";
    return "Card";
  }
  return null;
}

export function generationOf(product: string, pps: string, deviceType: CcDeviceType): string {
  if (deviceType !== "Card") return "";
  const hay = `${product} ${pps}`.toUpperCase().replace(/\s+/g, "");
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
