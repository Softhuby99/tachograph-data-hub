// Server-only: definitions + parsers for every JRC page the tool monitors.

import { approvalKeys } from "./market-status";

export type SourceKey =
  | "card_status"
  | "other_certificates"
  | "public_key_certificates"
  | "key_management"
  | "security_updates"
  | "manufacturer_codes"
  | "cc_certificates"
  | "ted_procurement";

export const JRC_SOURCES: Record<SourceKey, { label: string; url: string }> = {
  card_status: {
    label: "Card status",
    url: "https://dtc.jrc.ec.europa.eu/dtc_card_status.php.html",
  },
  other_certificates: {
    label: "Other certificates",
    url: "https://dtc.jrc.ec.europa.eu/dtc_other_certificates.php.html",
  },
  public_key_certificates: {
    label: "Public key certificates",
    url: "https://dtc.jrc.ec.europa.eu/dtc_public_key_certificates_dt.php.html",
  },
  key_management: {
    label: "Key management status",
    url: "https://dtc.jrc.ec.europa.eu/dtc_key_management_status_dt.php.html",
  },
  security_updates: {
    label: "Mandatory security updates",
    url: "https://dtc.jrc.ec.europa.eu/dtc_mandatory_security_software_updates.php.html",
  },
  manufacturer_codes: {
    label: "Manufacturer codes",
    url: "https://dtc.jrc.ec.europa.eu/dtc_manufacturer_code.php.html",
  },
  cc_certificates: {
    label: "Common Criteria certificates",
    url: "https://www.commoncriteriaportal.org/products/index.cfm",
  },
  ted_procurement: {
    label: "TED procurement",
    url: "https://ted.europa.eu/en/search/result",
  },
};

export const ANNEX_COLOR_TO_GENERATION: Record<string, string> = {
  "6f9ccc": "G1", // Annex 1B
  "2323dc": "G2.1", // Annex 1C
  ff9aff: "G2.2", // Annex 1C v2
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  Uuml: "Ü",
  Ouml: "Ö",
  Auml: "Ä",
  szlig: "ß",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  iacute: "í",
  oacute: "ó",
  uacute: "ú",
  aacute: "á",
  ntilde: "ñ",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export type RawRow = {
  values: string[];
  attrs: string[];
  /** v2.74: first link of every cell ("" when none), resolved against the JRC site. */
  links: string[];
};

const JRC_BASE = "https://dtc.jrc.ec.europa.eu/";

function firstHref(cellHtml: string): string {
  const m = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/i.exec(cellHtml);
  if (!m) return "";
  try {
    return new URL(decodeEntities(m[1]!).trim(), JRC_BASE).toString();
  } catch {
    return "";
  }
}

/** Extract every table row of a JRC page as plain cell text + cell attributes. */
export function extractRows(html: string): RawRow[] {
  const out: RawRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|<\/table>)/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const cells = Array.from((m[1] ?? "").matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi));
    if (cells.length === 0) continue;
    out.push({
      values: cells.map((c) => cellText(c[2] ?? "")),
      attrs: cells.map((c) => c[1] ?? ""),
      links: cells.map((c) => firstHref(c[2] ?? "")),
    });
  }
  return out;
}

/** Legend classes of the JRC pages, used when a cell carries a class instead of a colour. */
const ANNEX_CLASS_TO_GENERATION: Record<string, string> = {
  cell_a_1b: "G1",
  cell_a_1c: "G2.1",
  cell_a_1cv2: "G2.2",
};

/** v2.77: bgcolor="#rrggbb" (with or without quotes), a background style, or the legend class. */
export function generationFromAttrs(attrs: string): string {
  const colour =
    /bgcolor\s*=\s*["']?#?([0-9a-fA-F]{6})/i.exec(attrs) ??
    /background(?:-color)?\s*:\s*#([0-9a-fA-F]{6})/i.exec(attrs);
  if (colour) return ANNEX_COLOR_TO_GENERATION[colour[1]!.toLowerCase()] ?? "";
  const cls = /\bcell_a_1(?:b|cv2|c)\b/i.exec(attrs);
  return cls ? (ANNEX_CLASS_TO_GENERATION[cls[0].toLowerCase()] ?? "") : "";
}

/** v2.77: a JRC page that never answers must not hang the whole update run. */
const FETCH_TIMEOUT_MS = 45_000;

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "TachographCardsInfoTool/1.0" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`JRC request failed [${res.status}]: ${res.statusText}`);
  }
  return res.text();
}

// ---------------------------------------------------------------- other certs

/** What an "Other certificates" row is about (v2.77). */
export type ComponentKind = "Card" | "VU" | "MS" | "Paper" | "DSRC" | "M1N1" | "Other";

/**
 * v2.77: the component cell is free text. Most rows read "VU - DTCO 1381", but
 * about fifty do not ("Paper Tacho", "DSRC Module R08 (Upgrade)", "Tachograph
 * G1 v1.5 AETR cards for Moldova", "TACHO2b"). Reading only the text before
 * " - " turned those into device types of their own and hid a card entry among
 * the information-only rows. The prefix still decides when there is one; the
 * keywords classify the rest.
 */
export function classifyComponent(cell: string): ComponentKind {
  const text = cell.trim();
  const prefix = (text.includes(" - ") ? text.slice(0, text.indexOf(" - ")) : text)
    .trim()
    .toLowerCase();
  if (prefix === "card" || prefix === "cards") return "Card";
  if (prefix === "vu") return "VU";
  if (prefix === "ms") return "MS";
  if (/\bpaper\b|papier|thermal printer|thermo/i.test(text)) return "Paper";
  if (/\bdsrc\b/i.test(text)) return "DSRC";
  if (/m1\s*n1/i.test(text)) return "M1N1";
  if (/\bvehicle unit\b/i.test(text) || /^vu\b/i.test(text)) return "VU";
  if (/\bmotion sensor\b/i.test(text) || /^ms\b/i.test(text)) return "MS";
  if (/\bcards?\b/i.test(text)) return "Card";
  return "Other";
}

export type OtherCertRow = {
  manufacturer: string;
  component: string; // text before " - " (or the whole cell): "Card", "VU", "MS", "Paper", ...
  /** v2.77: classified component — use this, not `component`, to decide what a row is. */
  kind: ComponentKind;
  name: string;
  interopCertificate: string;
  typeApproval: string;
  date: string;
  mandatoryUpdates: string;
  generation: string;
  /** v2.74: link of the type approval cell (the approval certificate PDF), "" when none. */
  pdfUrl: string;
};

/**
 * "Other certificates": Manufacturer | Component | Interoperability certificate |
 * Type approval | Date | [Mandatory security updates] | Annex [| Annex].
 *
 * v2.77: read from the LEFT. The first five columns are always there; what
 * follows is an optional "mandatory updates" cell and one or two annex colour
 * cells. Taking "the last seven cells" shifted every row with two annex cells
 * (the Stoneridge transitional vehicle units) by one column: the component
 * became the manufacturer, the certificate the component, the date the
 * approval. The legend table under the list ("Annex1B | Annex1C | …") was read
 * as an entry as well.
 */
export function parseOtherCertificates(html: string): OtherCertRow[] {
  const out: OtherCertRow[] = [];
  for (const row of extractRows(html)) {
    // Legend and layout tables are not data.
    if (row.attrs.some((a) => /cell_invis/i.test(a))) continue;
    let values = row.values;
    let attrs = row.attrs;
    let links = row.links;
    // A header block can be glued in front of the first data row: skip it.
    if ((values[0] ?? "").toLowerCase().startsWith("manufacturer")) {
      let start = attrs.findIndex((a) => /tableCell/i.test(a));
      if (start < 0 && values.length >= 12) start = Math.floor(values.length / 2);
      if (start <= 0) continue; // header only
      values = values.slice(start);
      attrs = attrs.slice(start);
      links = links.slice(start);
    }
    // Two rows can sit in one <tr> (a missing row tag on the page): read record
    // after record. A record ends with its annex colour cell(s).
    let p = 0;
    while (values.length - p >= 6) {
      const [manufacturer = "", componentCell = "", interop = "", typeApproval = "", date = ""] =
        values.slice(p, p + 5);
      const pdfUrl = links[p + 3] ?? "";
      let i = p + 5;
      let generation = "";
      const extra: string[] = [];
      while (i < values.length && !generationFromAttrs(attrs[i] ?? "")) {
        if (values[i]) extra.push(values[i]!);
        i++;
      }
      // No colour at all: the rest of the row belongs to this record.
      const coloured = i < values.length;
      while (i < values.length && generationFromAttrs(attrs[i] ?? "")) {
        generation = generationFromAttrs(attrs[i] ?? "");
        i++;
      }
      p = coloured ? i : values.length;
      if (!manufacturer && !componentCell) continue;
      if (!typeApproval && !interop) continue;
      const mandatoryUpdates = coloured ? extra.join(" ") : (extra[0] ?? "");
      const sep = componentCell.indexOf(" - ");
      const component = sep > 0 ? componentCell.slice(0, sep).trim() : componentCell.trim();
      const name = sep > 0 ? componentCell.slice(sep + 3).trim() : "";
      out.push({
        manufacturer,
        component,
        kind: classifyComponent(componentCell),
        name,
        interopCertificate: interop,
        typeApproval,
        date,
        mandatoryUpdates,
        generation,
        pdfUrl,
      });
    }
  }
  // An extension of an approval is the same kind of product: "TACHO2b"
  // (e1-215-03) is paper because "Paper - TACHO2b" (e1-215-02) is.
  const base = (r: OtherCertRow) =>
    approvalKeys(r.typeApproval).map((k) => `${k.mark}|${k.series}|${k.number}`);
  const kindByBase = new Map<string, ComponentKind>();
  for (const r of out) {
    if (r.kind === "Other") continue;
    for (const k of base(r)) if (!kindByBase.has(k)) kindByBase.set(k, r.kind);
  }
  for (const r of out) {
    if (r.kind !== "Other") continue;
    const found = base(r)
      .map((k) => kindByBase.get(k))
      .find((k) => k !== undefined);
    if (found) r.kind = found;
  }
  return out;
}

// ------------------------------------------------------ public key certs (DT)

export type PublicKeyRow = {
  country: string;
  endOfValidity: string;
  certificate: string;
  equipment: string;
  sha1: string;
};

export function parsePublicKeyCertificates(html: string): PublicKeyRow[] {
  const out: PublicKeyRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 6) continue;
    const v = row.values.slice(-5);
    if (v[0].toLowerCase() === "country") continue;
    if (!v[0] || !v[2]) continue;
    out.push({
      country: v[0],
      endOfValidity: v[1],
      certificate: v[2],
      equipment: v[3],
      sha1: v[4],
    });
  }
  return out;
}

// -------------------------------------------------------------- key mgmt (DT)

export type KeyManagementRow = {
  country: string;
  stateAuthority: string;
  policyApproved: string;
  tcc: string;
  kmwc: string;
  vuc: string;
  kmvu: string;
  km: string;
};

export function parseKeyManagement(html: string): KeyManagementRow[] {
  const out: KeyManagementRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 9) continue;
    const v = row.values.slice(-8);
    if (v[0].toLowerCase() === "country") continue;
    if (!v[0]) continue;
    out.push({
      country: v[0],
      stateAuthority: v[1],
      policyApproved: v[2],
      tcc: v[3],
      kmwc: v[4],
      vuc: v[5],
      kmvu: v[6],
      km: v[7],
    });
  }
  return out;
}

// ------------------------------------------------------------ security updates

export type SecurityUpdateRow = {
  brand: string;
  model: string;
  versions: string;
  typeApprovals: string;
  vulnerableVersions: string;
  updateVersions: string;
  versionsAfter: string;
  approvalsAfter: string;
  mandatoryFrom: string;
  deadline: string;
};

export function parseSecurityUpdates(html: string): SecurityUpdateRow[] {
  const out: SecurityUpdateRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 9) continue;
    const v = row.values;
    if (v[0].toLowerCase() === "brand") continue;
    if (!v[0]) continue;
    // Some rows omit the "mandatory from" column; pad from the right.
    const padded = v.length >= 10 ? v.slice(-10) : [...v.slice(0, 8), "", ...v.slice(8)];
    out.push({
      brand: padded[0] ?? "",
      model: padded[1] ?? "",
      versions: padded[2] ?? "",
      typeApprovals: padded[3] ?? "",
      vulnerableVersions: padded[4] ?? "",
      updateVersions: padded[5] ?? "",
      versionsAfter: padded[6] ?? "",
      approvalsAfter: padded[7] ?? "",
      mandatoryFrom: padded[8] ?? "",
      deadline: padded[9] ?? "",
    });
  }
  return out;
}

// -------------------------------------------------------- manufacturer codes

export type ManufacturerCodeRow = {
  manufacturer: string;
  code: string;
  date: string;
};

/** JRC "Manufacturer code" page: Assignment | Value | Date. */
export function parseManufacturerCodes(html: string): ManufacturerCodeRow[] {
  const out: ManufacturerCodeRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 3) continue;
    const v = row.values.slice(-3);
    if (!v[0] || v[0].toLowerCase() === "assignment") continue;
    if (!/^[0-9a-f]{1,4}h?$/i.test(v[1].trim())) continue;
    out.push({ manufacturer: v[0], code: v[1].trim(), date: v[2] });
  }
  return out;
}
