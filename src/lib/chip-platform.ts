// Chip platform behind a type approval — whose secure card platform (chip +
// operating system) is inside the card, independent of who holds the type
// approval. Example: Malta e2-49 / Latvia e2-50 are approved for Imprimerie
// Nationale, but the certificate names "micromodule Thales Tachograph G2V2 sur
// composant Infineon IFX_CCI_000039h" and ANSSI-CC-2022/38 (Thales).
//
// Primary source is the security certificate number (field 7.2 of the type
// approval certificate), mapped to the certificate's developer as listed on
// the Common Criteria portal (certified_products.csv export, checked
// 01.10.2026). Only certificates that occur in the data are mapped; anything
// else stays "unknown" rather than being guessed. Free-text platform fields
// are a fallback and are marked as such.
//
// Isomorphic, no DB access.

export type PlatformVendor = "Thales" | "IDEMIA" | "STMicroelectronics";

export type ChipPlatform = {
  vendor: PlatformVendor | null;
  /** "certificate" = derived from a known security certificate number;
   *  "text" = derived from the free-text platform fields only. */
  source: "certificate" | "text" | "unknown";
  /** The certificate number or text fragment the vendor was derived from. */
  evidence: string;
};

export type PlatformCard = {
  security_certificate?: string | null;
  security_certificate_lab?: string | null;
  chip_certificate?: string | null;
  certified_security_platform?: string | null;
  chip_platform_vendor?: string | null;
  current_manufacturer?: string | null;
  current_manufacturer_normalized?: string | null;
};

// Security certificate -> developer, per the Common Criteria portal.
const CERTIFICATE_RULES: Array<{ re: RegExp; vendor: PlatformVendor; label: string }> = [
  // THALES DIS FRANCE SA (formerly Gemalto)
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2018\s*[/_\-]\s*11/i, vendor: "Thales", label: "ANSSI-CC-2018/11" },
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2022\s*[/_\-]\s*38/i, vendor: "Thales", label: "ANSSI-CC-2022/38" },
  { re: /EUCC[\s\-_]*ANSSI[\s\-_]*2025[\s\-_]*03[\s\-_]*02/i, vendor: "Thales", label: "EUCC-ANSSI-2025-03-02" },
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2013\s*[/_\-]\s*08/i, vendor: "Thales", label: "ANSSI-CC-2013/08 (Gemalto)" },
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2012\s*[/_\-]\s*28/i, vendor: "Thales", label: "ANSSI-CC-2012/28 (Gemalto)" },
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2007\s*[/_\-]\s*20/i, vendor: "Thales", label: "ANSSI-CC-2007/20 (Gemalto)" },
  // IDEMIA (TachoDrive v4 now IN SMART IDENTITY FRANCE)
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2022\s*[/_\-]\s*36/i, vendor: "IDEMIA", label: "ANSSI-CC-2022/36" },
  { re: /ANSSI[\s\-_]*CC[\s\-_]*2023\s*[/_\-]\s*21/i, vendor: "IDEMIA", label: "ANSSI-CC-2023/21" },
  { re: /(?:NSCIB[\s\-_]*)?CC[\s\-_]*(?:19|20)[\s\-_]*200716|NSCIB[\s\-_]*CC[\s\-_]*200716/i, vendor: "IDEMIA", label: "NSCIB-CC-20-200716" },
  { re: /0286910/, vendor: "IDEMIA", label: "NSCIB-CC-22-0286910" },
  // STMicroelectronics
  { re: /0635023|0635025/, vendor: "STMicroelectronics", label: "NSCIB-CC-22-0635023" },
  { re: /222356/, vendor: "STMicroelectronics", label: "NSCIB-CC-21-222356" },
  { re: /2400153/, vendor: "STMicroelectronics", label: "NSCIB-CC-2400153-01" },
];

const TEXT_RULES: Array<{ re: RegExp; vendor: PlatformVendor }> = [
  { re: /\bthales\b|gemalto|multiapp|ifx[_\s-]?cci/i, vendor: "Thales" },
  { re: /idemia|cosmo|tachodrive|ideal\s*drive/i, vendor: "IDEMIA" },
  { re: /stmicro|j-?tachog?|\bst31/i, vendor: "STMicroelectronics" },
];

/** Approval holders that count as the platform vendor itself. */
const OWN_HOLDER: Record<PlatformVendor, RegExp> = {
  Thales: /thales|gemalto/i,
  IDEMIA: /idemia|oberthur|morpho|in smart identity/i,
  STMicroelectronics: /stmicro/i,
};

export function chipPlatformOf(card: PlatformCard): ChipPlatform {
  const certText = [card.security_certificate, card.security_certificate_lab, card.chip_certificate]
    .map((v) => String(v ?? ""))
    .join(" | ");
  const certVendors = new Set<PlatformVendor>();
  let evidence = "";
  for (const rule of CERTIFICATE_RULES) {
    if (rule.re.test(certText)) {
      certVendors.add(rule.vendor);
      if (!evidence) evidence = rule.label;
    }
  }
  // Exactly one vendor: unambiguous. Several vendors in the certificate
  // fields means the record itself is inconsistent — don't pick one.
  if (certVendors.size === 1) {
    return { vendor: [...certVendors][0], source: "certificate", evidence };
  }
  if (certVendors.size > 1) return { vendor: null, source: "unknown", evidence: "conflicting certificates" };

  const platformText = [card.certified_security_platform, card.chip_platform_vendor, card.chip_certificate]
    .map((v) => String(v ?? ""))
    .join(" | ");
  const textVendors = TEXT_RULES.filter((r) => r.re.test(platformText)).map((r) => r.vendor);
  const uniqueText = [...new Set(textVendors)];
  if (uniqueText.length === 1) {
    return { vendor: uniqueText[0], source: "text", evidence: platformText.replace(/\s*\|\s*/g, " · ").trim() };
  }
  return { vendor: null, source: "unknown", evidence: "" };
}

export function approvalHolderOf(card: PlatformCard): string {
  return String(card.current_manufacturer_normalized || card.current_manufacturer || "").trim();
}

/** Does the platform vendor hold the type approval itself? */
export function isOwnApproval(card: PlatformCard, vendor: PlatformVendor | null): boolean {
  if (!vendor) return false;
  return OWN_HOLDER[vendor].test(approvalHolderOf(card));
}
