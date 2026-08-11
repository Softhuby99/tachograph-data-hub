// Server-only: definitions + parsers for every JRC page the tool monitors.

export type SourceKey =
  | "card_status"
  | "other_certificates"
  | "public_key_certificates"
  | "key_management"
  | "security_updates";

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
};

export const ANNEX_COLOR_TO_GENERATION: Record<string, string> = {
  "6f9ccc": "G1", // Annex 1B
  "2323dc": "G2.1", // Annex 1C
  "ff9aff": "G2.2", // Annex 1C v2
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
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/&([a-zA-Z]+);/g, (m, name: string) => NAMED_ENTITIES[name] ?? m);
}

export function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export type RawRow = { values: string[]; attrs: string[] };

/** Extract every table row of a JRC page as plain cell text + cell attributes. */
export function extractRows(html: string): RawRow[] {
  const out: RawRow[] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|<\/table>)/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html)) !== null) {
    const cells = Array.from(
      (m[1] ?? "").matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi),
    );
    if (cells.length === 0) continue;
    out.push({
      values: cells.map((c) => cellText(c[2] ?? "")),
      attrs: cells.map((c) => c[1] ?? ""),
    });
  }
  return out;
}

export function generationFromAttrs(attrs: string): string {
  const m = /bgcolor="#([0-9a-fA-F]{6})"/i.exec(attrs);
  return m ? (ANNEX_COLOR_TO_GENERATION[m[1].toLowerCase()] ?? "") : "";
}

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "user-agent": "TachographCardsInfoTool/1.0" },
  });
  if (!res.ok) {
    throw new Error(`JRC request failed [${res.status}]: ${res.statusText}`);
  }
  return res.text();
}

// ---------------------------------------------------------------- other certs

export type OtherCertRow = {
  manufacturer: string;
  component: string; // "Card", "VU", "MS", "M1N1", "DSRC", "Paper", ...
  name: string;
  interopCertificate: string;
  typeApproval: string;
  date: string;
  mandatoryUpdates: string;
  generation: string;
};

export function parseOtherCertificates(html: string): OtherCertRow[] {
  const out: OtherCertRow[] = [];
  for (const row of extractRows(html)) {
    if (row.values.length < 7) continue;
    const v = row.values.slice(-7);
    const a = row.attrs.slice(-7);
    if (v[0].toLowerCase().startsWith("manufacturer")) continue;
    if (!v[0] && !v[1]) continue;
    const sep = v[1].indexOf(" - ");
    const component = sep > 0 ? v[1].slice(0, sep).trim() : v[1].trim();
    const name = sep > 0 ? v[1].slice(sep + 3).trim() : "";
    if (!v[3] && !v[2]) continue;
    out.push({
      manufacturer: v[0],
      component,
      name,
      interopCertificate: v[2],
      typeApproval: v[3],
      date: v[4],
      mandatoryUpdates: v[5],
      generation: generationFromAttrs(a[6]),
    });
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
