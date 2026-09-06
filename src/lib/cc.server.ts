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
  status: string; // "valid" | "archived"

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
    re: /NSCIB[-_ ]?CC[-_ ]?(\d{2})[-_](\d{5,7})/i,
    build: (m) => `NSCIB-CC-${m[1]}-${m[2]}`,
  },
  {
    re: /NSCIB[-_ ]?CC[-_ ]?(\d{6,8})(?:[-_](\d{2}))?/i,
    build: (m) => `NSCIB-CC-${m[1]}${m[2] ? `-${m[2]}` : ""}`,
  },
  { re: /\bCC-(\d{2})-(\d{6})\b/i, build: (m) => `NSCIB-CC-${m[1]}-${m[2]}` },
  // Old French scheme files: "2003_12en.pdf" -> ANSSI-CC-2003/12
  {
    re: /^(\d{4})[_-](\d{2})(?:en|fr)?\.pdf$/i,
    build: (m) => `ANSSI-CC-${m[1]}/${m[2]}`,
  },
  // Spanish scheme: "2012-32-CCRA.pdf" / "2012-32-INF-2355.pdf"
  { re: /^(\d{4})-(\d{2})-(?:CCRA|INF)/i, build: (m) => `OC-${m[1]}-${m[2]} (ES)` },
  // UK scheme: "CRP272 v1.0 ....pdf"
  { re: /\bCRP[- ]?(\d{3})\b/i, build: (m) => `CRP${m[1]} (UK)` },
  {
    re: /^(\d{4})(V\d)?[a-c](?:_pdf)?\.pdf$/i,
    build: (m) => `BSI-DSZ-CC-${m[1]}${m[2] ? `-${m[2].toUpperCase()}` : ""}`,
  },
];

// CC_PAT from cc_tachograph.py: how certificate numbers appear inside the
// certification report PDFs (OCR variants included).
const CC_TEXT_PATTERNS = [
  /EUCC[- ]?ANSSI[- ]?(\d{4})[- ]?(\d{2})[- ]?(\d{2})/gi,
  /ANSSI[- ]?CC[- ]?(\d{4})[/ _-](\d{2,3}(?:\s?v\d)?)(?:[- ]?([SMR]\s?\d{2}))?/gi,
  /NSCIB[- ]?CC[- ]?(\d{7})(?:[- ]?(\d{2}))?/gi,
  /NSCIB[- ]?CC[- ]?(\d{2})-(\d{5,7})(?:-(\d{2}))?/gi,
  /BSI[- ]?DSZ[- ]?CC[- ]?(\d{4})(?:[- ]?(V\d))?/gi,
  /\b(OC)[- ](\d{4})[- ](\d{2})\b/g,
  /\b(CRP)[- ]?(\d{3})\b/g,
];

const CERT_IN_TEXT = /((?:EUCC-ANSSI|ANSSI-CC|NSCIB-CC|BSI-DSZ-CC)-[0-9A-Za-z/_.-]{3,30})/;

/** normalise_cc() from cc_tachograph.py: unify OCR / spelling variants. */
export function normaliseCc(raw: string): string {
  let s = raw.toUpperCase().replace(/\s+/g, "").replace(/_/g, "-");
  s = s.replace(/[.,;)]+$/, "");
  // ensure the revision suffix keeps its hyphen: "2022/38R01" -> "2022/38-R01"
  s = s.replace(/([^-])([SMR]\d{2})$/, "$1-$2");
  return s;
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
    if (/EUCC/i.test(m[0])) {
      return `EUCC-ANSSI-${m[1]}-${m[2]}-${m[3]}`;
    }
    if (/ANSSI/i.test(m[0])) {
      const num = (m[2] ?? "").replace(/\s+/g, "");
      const rev = (m[3] ?? "").replace(/\s+/g, "");
      return normaliseCc(`ANSSI-CC-${m[1]}/${num}${rev ? `-${rev}` : ""}`);
    }
    if (/NSCIB/i.test(m[0])) {
      // long form (7 digits + optional suffix) keeps its digits untouched;
      // the split form needs a real hyphen between the groups.
      if (m[1].length === 7) return `NSCIB-CC-${m[1]}${m[2] ? `-${m[2]}` : ""}`;
      return `NSCIB-CC-${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ""}`;
    }
    if (/^OC/i.test(m[0])) return `OC-${m[2]}-${m[3]} (ES)`;
    if (/^CRP/i.test(m[0])) return `CRP${m[2]} (UK)`;
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

function isoToDe(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  return m ? `${m[3]}.${m[2]}.${m[1]}` : value.trim();
}

// ----------------------------------------------------------- PDF text (port
// of the pdftotext step in cc_tachograph.py)

const CC_TEXT_MAX_PAGES = 8; // number + PP references sit on the first pages
const CC_FETCH_CONCURRENCY = 4;

/** Extract plain text from the first pages of a certificate / report PDF. */
export async function extractPdfText(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerPort = null as never; // run on the main thread (Worker runtime)
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  try {
    const pages = Math.min(doc.numPages, CC_TEXT_MAX_PAGES);
    let text = "";
    for (let p = 1; p <= pages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      text += `${content.items.map((it) => ("str" in it ? it.str : "")).join(" ")}\n`;
    }
    return text;
  } finally {
    try {
      await doc.destroy?.();
    } catch {
      /* older builds expose no destroy() */
    }
  }
}


// ------------------------------------------------------------------ fetching
//
// Port of scrape() in cc_tachograph.py: the portal index page carries the
// complete product list as an embedded JSON array (productList / ppsList).
// Every tachograph entry's certificate PDF is downloaded and read, exactly
// like the script does with pdftotext.

const CC_ARCHIVED_URL = "https://www.commoncriteriaportal.org/products/index.cfm?archived=1";
const CC_FILES = "https://www.commoncriteriaportal.org/nfs/ccpfiles/files/epfiles/";
const CC_UA = "Mozilla/5.0 (compatible; TachoCertMonitor/1.0)";

type PortalProduct = {
  name?: string;
  pps?: string;
  scheme_name?: string;
  eal_name?: string;
  certified?: string;
  archived?: string;
  cert1?: string;
  pdf_cert?: string;
  vendor_name?: string;
  category_name?: string;
};

type PortalPp = { ID?: string; Name?: string; PDF_PP?: string };

/** Read `var <name> = [ ... ]` out of the portal HTML. */
export function extractJsonArray<T>(html: string, variable: string): T[] {
  const marker = `var ${variable} = [`;
  const start = html.indexOf(marker);
  if (start < 0) return [];
  const from = start + marker.length - 1;
  let depth = 0;
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(from, i + 1)) as T[];
        } catch {
          return [];
        }
      }
    }
  }
  return [];
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  nbsp: " ",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  ndash: "–",
  mdash: "—",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  ouml: "ö",
  auml: "ä",
  uuml: "ü",
  szlig: "ß",
  oacute: "ó",
  iacute: "í",
  aacute: "á",
};

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .trim();
}


/** PP number out of the portal's PP list entry ("...PP-0091..." / pp0091b.pdf). */
function ppNumber(pp: PortalPp): string {
  const fromName = /PP-(\d{4})/i.exec(pp.Name ?? "");
  if (fromName) return `PP-${fromName[1]}`;
  const fromFile = /pp(\d{4})/i.exec(pp.PDF_PP ?? "");
  return fromFile ? `PP-${fromFile[1]}` : "";
}

async function fetchPdf(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "user-agent": CC_UA } });
    if (!res.ok) return "";
    const buf = await res.arrayBuffer();
    const head = new Uint8Array(buf.slice(0, 4));
    if (String.fromCharCode(...head) !== "%PDF") return "";
    return await extractPdfText(buf);
  } catch {
    return "";
  }
}

const NON_CARD_PP: Record<string, CcDeviceType> = {
  "PP-0093": "Motion Sensor",
  "PP-0094": "Vehicle Unit",
  "PP-0057": "Vehicle Unit",
};

const CARD_PP = new Set(["PP-0070", "PP-0091"]);

function deviceFromPps(pps: string[], product: string): CcDeviceType {
  // A card profile wins: report PDFs of card certificates regularly reference
  // the vehicle-unit profile as well (e.g. ANSSI-CC-2022/36v2-R01).
  if (pps.some((pp) => CARD_PP.has(pp))) return "Card";
  for (const pp of pps) {
    const hit = NON_CARD_PP[pp];
    if (hit) return hit;
  }

  const hay = product.toLowerCase();
  if (/motion sensor|kitas|\bsensor\b/.test(hay)) return "Motion Sensor";
  if (/vehicle unit|\bdtco\b|\bvu\b/.test(hay)) return "Vehicle Unit";
  return "Card";
}

const PP_GEN: Record<string, string> = { "PP-0070": "G1", "PP-0091": "G2.1" };

/** generations() from cc_tachograph.py. */
function generationsOf(pps: string[], product: string, certText: string, issued: string): string {
  const gens = new Set<string>();
  for (const pp of pps) if (PP_GEN[pp]) gens.add(PP_GEN[pp]);
  const hay = `${product} ${certText}`.toUpperCase().replace(/\s+/g, "");
  if (hay.includes("G2V2")) gens.add("G2.2");
  if (gens.size === 0) {
    const year = Number(issued.slice(0, 4));
    if (year && year < 2018) return "G1 (derived from date)";
    return "";
  }
  return Array.from(gens).sort().join(", ");
}

async function scrapePortal(pageUrl: string, status: string): Promise<CcEntry[]> {
  const res = await fetch(pageUrl, { headers: { "user-agent": CC_UA } });
  if (!res.ok) {
    throw new Error(`Common Criteria request failed [${res.status}]: ${res.statusText}`);
  }
  const html = await res.text();
  const products = extractJsonArray<PortalProduct>(html, "productList");
  const ppsList = extractJsonArray<PortalPp>(html, "ppsList");
  const ppById = new Map(ppsList.map((p) => [p.ID ?? "", ppNumber(p)]));
  const ppNameById = new Map(ppsList.map((p) => [p.ID ?? "", decodeEntities(p.Name ?? "")]));

  // Like the script, which reads the whole product cell: the product name, its
  // protection profile links and the category are all searched for "tachograph".
  const tacho = products.filter((p) => {
    const ppNames = (p.pps ?? "")
      .split(",")
      .map((id) => ppNameById.get(id.trim()) ?? "")
      .join(" ");
    return /tachograph/i.test(`${decodeEntities(p.name ?? "")} ${ppNames} ${p.category_name ?? ""}`);
  });

  const out: CcEntry[] = [];

  const queue = [...tacho];
  async function worker() {
    for (let item = queue.pop(); item; item = queue.pop()) {
      const product = decodeEntities(item.name ?? "");
      const certFile = (item.cert1 ?? "").trim();
      const reportFile = (item.pdf_cert ?? "").trim();
      const certUrl = certFile ? CC_FILES + encodeURIComponent(certFile) : "";
      const reportUrl = reportFile ? CC_FILES + encodeURIComponent(reportFile) : "";

      // Certificate PDF first; the report only as a fallback (the report text
      // regularly names foreign certificates, e.g. the chip's).
      const certOwnText = certUrl ? await fetchPdf(certUrl) : "";
      // The report is read as well, but only for protection-profile detection:
      // its text regularly names foreign certificate numbers (e.g. the chip's).
      const reportText = reportUrl ? await fetchPdf(reportUrl) : "";
      const certText = `${certOwnText}\n${reportText}`;

      let { number, source } = certificateNumber(product, certUrl || reportUrl, certOwnText);
      if (!number) {
        const guess = certificateNumber(product, reportUrl, "");
        number = guess.number;
        source = guess.source;
      }
      // Filename rules yield the number without the year suffix; the report
      // head carries the full form.
      if (source === "Certification report" && number.startsWith("BSI-DSZ-CC-")) {
        const head = certText.slice(0, 600);
        const m = new RegExp(`${number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-V\\d)?-(\\d{4})`, "i").exec(head);
        if (m) {
          number = `${number}${(m[1] ?? "").toUpperCase()}-${m[2]}`;
          source = "Report header";
        }
      }

      const ppPortal = (item.pps ?? "")
        .split(",")
        .map((id) => ppById.get(id.trim()) ?? "")
        .filter(Boolean);
      const ppCert = Array.from(new Set((certText.match(/PP-\d{4}/gi) ?? []).map((s) => s.toUpperCase())));
      const pps = (ppCert.length > 0 ? ppCert : ppPortal).sort();

      const deviceType = deviceFromPps(pps, product);
      out.push({
        certificate: number,
        certificateSource: source,
        deviceType,
        product,
        vendor: decodeEntities(item.vendor_name ?? ""),
        scheme: decodeEntities(item.scheme_name ?? ""),
        assurance: (item.eal_name ?? "").trim(),
        protectionProfiles: pps.join(" + "),
        generation:
          deviceType === "Card"
            ? generationsOf(pps, product, certText, (item.certified ?? "").trim())
            : "",
        issued: isoToDe(item.certified ?? ""),
        expires: isoToDe(item.archived ?? ""),
        reportUrl: reportUrl || certUrl,
        status,
      });
    }
  }
  await Promise.all(Array.from({ length: CC_FETCH_CONCURRENCY }, worker));
  return out;
}

export async function fetchCcEntries(): Promise<CcEntry[]> {
  const [valid, archived] = await Promise.all([
    scrapePortal(CC_PORTAL_URL, "valid"),
    scrapePortal(CC_ARCHIVED_URL, "archived"),
  ]);
  const out = new Map<string, CcEntry>();
  for (const e of [...valid, ...archived]) {
    const key = `${e.deviceType}|${e.certificate || e.product}|${e.issued}`;
    if (!out.has(key)) out.set(key, e);
  }
  return Array.from(out.values());
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

const SCHEME_COUNTRY: Record<string, string> = {
  de: "Germany",
  deu: "Germany",
  germany: "Germany",
  fr: "France",
  fra: "France",
  france: "France",
  nl: "Netherlands",
  nld: "Netherlands",
  netherlands: "Netherlands",
  es: "Spain",
  esp: "Spain",
  spain: "Spain",
  it: "Italy",
  ita: "Italy",
  italy: "Italy",
  se: "Sweden",
  swe: "Sweden",
  sweden: "Sweden",
  no: "Norway",
  nor: "Norway",
  norway: "Norway",
  uk: "United Kingdom",
  gb: "United Kingdom",
  "united kingdom": "United Kingdom",
  tr: "Turkey",
  tur: "Turkey",
  turkey: "Turkey",
  pl: "Poland",
  pol: "Poland",
  poland: "Poland",
  eu: "European Union (EUCC)",
};

/** Country of the certification scheme that issued the certificate. */
export function certificationCountry(e: {
  scheme?: string;
  certificate?: string;
  reportUrl?: string;
}): string {
  const scheme = (e.scheme ?? "").trim().toLowerCase();
  if (scheme && SCHEME_COUNTRY[scheme]) return SCHEME_COUNTRY[scheme];
  const cert = (e.certificate ?? "").toUpperCase();
  if (cert.startsWith("BSI-")) return "Germany";
  if (cert.startsWith("EUCC-ANSSI") || cert.startsWith("ANSSI-")) return "France";
  if (cert.startsWith("NSCIB-")) return "Netherlands";
  if (cert.startsWith("CRP")) return "United Kingdom";
  if (cert.startsWith("OC-") || cert.includes("(ES)")) return "Spain";
  if (cert.startsWith("EUCC-")) return "European Union (EUCC)";
  return "";
}

function payloadOf(e: CcEntry): Record<string, string> {
  const certCountry = certificationCountry(e);
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
    "Certification country": certCountry || "not derivable",
    "Country note": certCountry
      ? "Country of the certification scheme — not the issuing member state of a card."
      : "No country could be derived from the certificate scheme.",
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
