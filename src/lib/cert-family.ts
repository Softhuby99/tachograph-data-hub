// v2.55: Platform Timeline — certificate families.
//
// The security certificate field is free text: "ANSSI-CC-2022/38",
// "ANSSI-CC-2022/38-M01", "ANSSI-CC-2022/38 + M01", "ANSSI-CC-2022/38
// (+ Wartungsbericht M01 15.12.2022)", "ANSSI-CC-2022/38 family" all name the
// same certificate family with an optional continuation (M = maintenance,
// R = re-assessment, S = surveillance). The original text is never changed;
// this module only derives the family key from it (agreed 02.10.2026, point 9).
// Year variants of NSCIB numbers (CC-19-… vs CC-20-…) are deliberately NOT
// merged here — a person assigns them in the platform line table.

export type CertRef = {
  /** Family key, e.g. "ANSSI-CC-2022/38", "NSCIB-CC-22-0635023", "BSI-DSZ-CC-0889". */
  family: string;
  /** Continuation suffix, e.g. "M01", "R01", "S02" — empty for the base certificate. */
  suffix: string;
  /** Re-issue marker of the base certificate, e.g. "v2" for ANSSI-CC-2022/36v2. */
  variant: string;
  scheme: "ANSSI" | "NSCIB" | "BSI" | "OTHER";
};

const PLACEHOLDER =
  /^(not confirmed|not verified|no clear|legacy security basis|security certificate to verify|to verify|unknown|n\/a|—|-|–)/i;

/** True for texts that name no certificate ("Not confirmed", "… to verify"). */
export function isPlaceholderCertificate(text: string): boolean {
  const t = String(text ?? "").trim();
  return t === "" || PLACEHOLDER.test(t);
}

const SUFFIX_RE =
  /(?:[-\s]|\+\s*|\b(?:Wartungsbericht|maintenance(?: report)?)\s+)([MRS])(\d{2})\b/i;

/**
 * Parses the first certificate named in a free-text field. Returns null when
 * the text names none (empty, placeholder, unknown format).
 */
export function parseCertificate(text: unknown): CertRef | null {
  const t = String(text ?? "").trim();
  if (isPlaceholderCertificate(t)) return null;

  const anssi = /ANSSI-CC-(\d{4})\/(\d{1,3})(v\d+)?/i.exec(t);
  if (anssi) {
    const family = `ANSSI-CC-${anssi[1]}/${anssi[2]!.padStart(2, "0")}`;
    const rest = t.slice(anssi.index + anssi[0].length);
    const suf = SUFFIX_RE.exec(rest);
    return {
      family,
      suffix: suf ? `${suf[1]!.toUpperCase()}${suf[2]}` : "",
      variant: (anssi[3] ?? "").toLowerCase(),
      scheme: "ANSSI",
    };
  }

  const bsi = /BSI-DSZ-CC-(\d{4})(?:-V(\d+))?/i.exec(t);
  if (bsi) {
    return {
      family: `BSI-DSZ-CC-${bsi[1]}`,
      suffix: "",
      variant: bsi[2] ? `V${bsi[2]}` : "",
      scheme: "BSI",
    };
  }

  // NSCIB: "NSCIB-CC-22-0635023", "CC-22-0635023", "NSCIB-CC-0635023-CR".
  const nscib = /(?:NSCIB-)?CC-(?:(\d{2})-)?(\d{5,7})(?:-(?:CR|MA\d*))?/i.exec(t);
  if (nscib) {
    return {
      family: nscib[1] ? `NSCIB-CC-${nscib[1]}-${nscib[2]}` : `NSCIB-CC-${nscib[2]}`,
      suffix: "",
      variant: "",
      scheme: "NSCIB",
    };
  }
  return null;
}

/** Label of a certificate with its continuation, e.g. "ANSSI-CC-2022/38-M01". */
export function certLabel(ref: CertRef): string {
  const variant = ref.variant ? (ref.scheme === "BSI" ? `-${ref.variant}` : ref.variant) : "";
  return `${ref.family}${variant}${ref.suffix ? `-${ref.suffix}` : ""}`;
}

export const SUFFIX_KIND: Record<string, string> = {
  M: "Maintenance",
  R: "Re-assessment",
  S: "Surveillance",
};

/** First plain date (day/month/year) found in a text such as "08.06.2023 (JRC listing)". */
export function firstDate(text: unknown): Date | null {
  const m = /(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(String(text ?? ""));
  if (m) {
    const d = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCDate() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1) return d;
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(String(text ?? ""));
  if (iso) return new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
  return null;
}
