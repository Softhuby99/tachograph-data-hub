import { type PartKind } from "@/lib/market-share";
import { type ExpiryState } from "@/lib/expiry";
import { type TachoCard } from "@/components/tacho/types";

export function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter((s) => s && s.trim().length > 0))).sort();
}

/**
 * The device types the sources publish. Offered everywhere as a fixed list, not
 * derived from the data: a type that does not occur yet must still be
 * selectable, otherwise a record can never be set to it in the first place.
 */
export const DEVICE_TYPES = ["Card", "Vehicle Unit", "Motion Sensor"] as const;

export const EXPIRY_LABELS: Record<ExpiryState, string> = {
  expired: "Expired",
  critical: "Expires within 3 months",
  warning: "Expires within 6 months",
  ok: "Valid",
  unknown: "Not dated",
};

export const EXPIRY_DOT: Record<ExpiryState, string> = {
  expired: "bg-destructive",
  critical: "bg-destructive",
  warning: "bg-amber-500",
  ok: "bg-emerald-500",
  unknown: "bg-muted-foreground/40",
};

export const GROUP1_FIELDS: Array<[keyof TachoCard, string]> = [
  ["country", "Country"],
  ["device_type", "Device Type"],
  ["generation", "Generation"],
  ["application", "Application"],
  ["tachograph_application_os", "Tachograph Application / OS"],
  ["type_approval_number", "Type Approval Number"],
  ["issued_by_authority", "Issued by Authority"],
  ["date_status", "Date / Status"],
  ["certificate_holder", "Certificate Holder"],
  ["certified_security_platform", "Certified Security Platform"],
  ["chip_certificate", "Chip Certificate"],
  ["chip_platform_vendor", "Chip / Platform Vendor"],
  ["security_certificate", "Security Certificate"],
  ["certificate_issued_date", "Date Certificate Issued"],
  ["certificate_expiry_date", "Certificate Validity Expiration Date"],
  ["security_certificate_lab", "Security Certificate Lab"],
  ["functional_certificate_lab", "Functional Certificate Lab"],
  ["jrc_interoperability_status", "JRC Interoperability Status"],
  ["jrc_certificate_source", "JRC / Certificate Source"],
  ["primary_source", "Primary Source"],
  ["card_quantities", "Card Quantities"],
];

// v2.59: own / partner colouring in the market share table.
export const PART_LABEL: Record<PartKind, string> = {
  own: "own approval (platform vendor holds it)",
  partner: "via partner (another card manufacturer holds it)",
  unknown: "platform unknown",
};
