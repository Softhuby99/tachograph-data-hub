// v2.77: consistency check with repairs (Tools → Consistency).
//
// Data quality (data-quality.ts) says what is missing or unreadable in a
// record. This module compares the records with each other and with the JRC
// listing the update keeps (jrc_current_listing) and says what CONTRADICTS —
// and, where the right value is known, offers it as a repair:
//
//   flag_mismatch        stored flag is not the flag of the stored country
//   country_spelling     country is an alias ("Kirgisistan") of a known country
//   generation_vs_jrc    card generation differs from the JRC annex of its approval
//   date_missing         Date/Status empty although JRC gives a date
//   date_vs_jrc          Date/Status is a date that differs from the JRC approval date
//   status_missing       JRC interoperability status empty although JRC lists a certificate
//   override_noop        a manual edit that repeats the stored value
//   duplicate            two records for the same device, country, generation and approval
//   placeholder_approval a card whose approval number is not an approval number
//   jrc_without_record   an approval listed on JRC that has no record
//
// "safe" repairs cannot be wrong by construction (a flag follows from the
// country, an empty field gets the listed value); they can be applied in one
// go. The others change a stored value and are applied one by one.
//
// Pure functions without server imports, so the view can share the types.

import { COUNTRY_ISO, flagEmoji, normalizeCountry } from "@/lib/country-flag";
import { parseLooseDate } from "@/lib/expiry";
import { approvalKeys, keysMatch, keysMatchStrict, type ApprovalKey } from "@/lib/market-status";

export type ConsistencyRule =
  | "flag_mismatch"
  | "country_spelling"
  | "generation_vs_jrc"
  | "date_missing"
  | "date_vs_jrc"
  | "status_missing"
  | "override_noop"
  | "duplicate"
  | "placeholder_approval"
  | "jrc_without_record";

export type ConsistencyLevel = "error" | "warning" | "info";

export type ConsistencyFix = {
  /** "set": write the value into the record; "drop_override": remove the manual edit of the field. */
  kind: "set" | "drop_override";
  field: string;
  label: string;
  old: string;
  new: string;
};

export type ListingRow = {
  source_type: string;
  raw_type_approval: string;
  manufacturer: string;
  card_name: string;
  certificate: string;
  jrc_date: string;
  eov: string;
  generation: string;
  device_type: string;
};

export type ConsistencyIssue = {
  id: string;
  rule: ConsistencyRule;
  level: ConsistencyLevel;
  cardId: string | null;
  country: string;
  deviceType: string;
  generation: string;
  typeApproval: string;
  manufacturer: string;
  message: string;
  fix?: ConsistencyFix;
  /** May be applied together with all other safe repairs. */
  safe: boolean;
  /** jrc_without_record: the JRC entry. */
  jrc?: ListingRow;
};

export type ConsistencySummary = {
  records: number;
  listingRows: number;
  issues: number;
  repairable: number;
  safe: number;
  byRule: Record<string, number>;
};

export const CONSISTENCY_RULE_LABELS: Record<ConsistencyRule, string> = {
  flag_mismatch: "Flag does not match the country",
  country_spelling: "Country spelling",
  generation_vs_jrc: "Generation differs from JRC",
  date_missing: "Date / Status empty, JRC has a date",
  date_vs_jrc: "Date / Status differs from the JRC approval date",
  status_missing: "JRC interoperability status empty",
  override_noop: "Manual edit repeats the stored value",
  duplicate: "Duplicate record",
  placeholder_approval: "Approval number is a placeholder",
  jrc_without_record: "Listed on JRC, no record",
};

const FIELD_LABELS: Record<string, string> = {
  country: "Country",
  country_flag: "Flag",
  generation: "Generation",
  date_status: "Date / Status",
  jrc_interoperability_status: "JRC interoperability status",
};

/** Columns a "set" repair may write. */
export const REPAIRABLE_FIELDS = new Set(Object.keys(FIELD_LABELS));

const RECORD_DEVICES = new Set(["Card", "Vehicle Unit", "Motion Sensor"]);

const str = (v: unknown) => String(v ?? "").trim();
const deviceOf = (c: Record<string, unknown>) => str(c["device_type"]) || "Card";

/** JRC date in any of its spellings as DD.MM.YYYY, "" when it is not a date. */
function deDate(value: string): string {
  const m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(str(value));
  return m ? `${m[1]!.padStart(2, "0")}.${m[2]!.padStart(2, "0")}.${m[3]}` : "";
}

function sameDay(a: string, b: string): boolean {
  const x = parseLooseDate(a);
  const y = parseLooseDate(b);
  return !!x && !!y && x.getTime() === y.getTime();
}

const keyText = (k: ApprovalKey) => `${k.mark}|${k.series}|${k.number}|${k.ext ?? ""}`;

export type ConsistencyCard = Record<string, unknown> & { id: string };

export function checkConsistency(input: {
  /** Records as stored. */
  base: ConsistencyCard[];
  /** Manual edits (patch wins over the stored value). */
  overrides: { card_id: string; patch: Record<string, string> }[];
  listing: ListingRow[];
}): ConsistencyIssue[] {
  const issues: ConsistencyIssue[] = [];
  const patchById = new Map(input.overrides.map((o) => [o.card_id, o.patch ?? {}]));
  const cards = input.base.map((b) => ({
    base: b,
    patch: patchById.get(String(b.id)) ?? {},
    c: { ...b, ...(patchById.get(String(b.id)) ?? {}) } as ConsistencyCard,
  }));
  const listing = input.listing
    .filter((l) => RECORD_DEVICES.has(l.device_type))
    .map((l) => ({ l, keys: approvalKeys(l.raw_type_approval) }));

  const keysById = new Map<string, ApprovalKey[]>();
  for (const { c } of cards)
    keysById.set(String(c.id), approvalKeys(str(c["type_approval_number"])));

  for (const { base, patch, c } of cards) {
    const id = String(c.id);
    const deviceType = deviceOf(c);
    const ref = {
      cardId: id,
      country: str(c["country"]),
      deviceType,
      generation: str(c["generation"]),
      typeApproval: str(c["type_approval_number"]),
      manufacturer: str(c["current_manufacturer"]),
    };
    const add = (
      rule: ConsistencyRule,
      level: ConsistencyLevel,
      message: string,
      fix?: Omit<ConsistencyFix, "label">,
      safe = false,
    ) =>
      issues.push({
        ...ref,
        id: `${rule}:${id}:${fix?.field ?? ""}`,
        rule,
        level,
        message,
        fix: fix ? { ...fix, label: FIELD_LABELS[fix.field] ?? fix.field } : undefined,
        safe: !!fix && safe,
      });

    // ---- country and flag
    const country = str(c["country"]);
    const normalized = normalizeCountry(country);
    if (country && normalized !== country && COUNTRY_ISO[normalized]) {
      add(
        "country_spelling",
        "warning",
        `"${country}" is stored, the country list calls it "${normalized}"`,
        { kind: "set", field: "country", old: country, new: normalized },
        true,
      );
    }
    const flag = flagEmoji(normalized);
    if (flag && str(c["country_flag"]) !== flag) {
      add(
        "flag_mismatch",
        "warning",
        `Flag "${str(c["country_flag"]) || "—"}" is not the flag of ${normalized}`,
        { kind: "set", field: "country_flag", old: str(c["country_flag"]), new: flag },
        true,
      );
    }

    // ---- manual edits that repeat the stored value
    for (const [field, value] of Object.entries(patch)) {
      if (!Object.prototype.hasOwnProperty.call(base, field)) continue; // virtual field
      if (str(base[field]) !== str(value)) continue;
      add(
        "override_noop",
        "info",
        `Manual edit of "${field}" is identical to the stored value`,
        {
          kind: "drop_override",
          field,
          old: str(value).slice(0, 120),
          new: str(value).slice(0, 120),
        },
        true,
      );
    }

    // ---- approval number
    const keys = keysById.get(id) ?? [];
    if (deviceType === "Card" && ref.typeApproval && keys.length === 0) {
      add(
        "placeholder_approval",
        "info",
        `"${ref.typeApproval.slice(0, 60)}" is not an approval number — the record cannot be compared with JRC`,
      );
    }
    if (keys.length === 0) continue;

    // ---- against the JRC listing
    const hits = listing.filter(
      (x) =>
        x.l.device_type === deviceType &&
        x.keys.some((lk) => keys.some((k) => keysMatchStrict(k, lk))),
    );
    if (hits.length === 0) continue;

    if (deviceType === "Card") {
      const gens = [...new Set(hits.map((h) => h.l.generation).filter(Boolean))];
      if (gens.length === 1 && ref.generation !== gens[0]) {
        add(
          "generation_vs_jrc",
          "warning",
          `Stored as ${ref.generation || "—"}; JRC lists ${hits[0]!.l.raw_type_approval} under ${gens[0]}`,
          { kind: "set", field: "generation", old: ref.generation, new: gens[0]! },
        );
      }
    }

    const sameGen = hits.filter((h) => h.l.generation === ref.generation);
    const rows = sameGen.length > 0 ? sameGen : hits;
    const dates = [...new Set(rows.map((h) => deDate(h.l.jrc_date)).filter(Boolean))];
    const dateStatus = str(c["date_status"]);
    if (dates.length === 1) {
      if (!dateStatus) {
        add(
          "date_missing",
          "warning",
          `Date / Status is empty; JRC lists ${dates[0]}`,
          { kind: "set", field: "date_status", old: "", new: dates[0]! },
          true,
        );
      } else if (
        parseLooseDate(dateStatus) &&
        !sameDay(dateStatus, dates[0]!) &&
        // The card status page dates the interoperability certificate, not the
        // approval — only "Other certificates" gives the date of approval.
        rows.every((h) => h.l.source_type === "other_certificates")
      ) {
        add(
          "date_vs_jrc",
          "warning",
          `Date / Status ${dateStatus} differs from the JRC date of approval ${dates[0]}`,
          { kind: "set", field: "date_status", old: dateStatus, new: dates[0]! },
        );
      }
    }

    if (deviceType === "Card" && !str(c["jrc_interoperability_status"])) {
      const withCert = rows.filter((h) => h.l.certificate);
      const certs = [...new Set(withCert.map((h) => h.l.certificate))];
      if (certs.length === 1) {
        const h = withCert[0]!.l;
        const text = [
          h.certificate,
          h.jrc_date ? `issued ${h.jrc_date}` : "",
          h.eov ? `EOV ${h.eov}` : "",
        ]
          .filter(Boolean)
          .join(" · ");
        add(
          "status_missing",
          "warning",
          `JRC interoperability status is empty; JRC lists ${h.certificate}`,
          { kind: "set", field: "jrc_interoperability_status", old: "", new: text },
          true,
        );
      }
    }
  }

  // ---- duplicates: same device, country, generation and approval(s)
  const groups = new Map<string, ConsistencyCard[]>();
  for (const { c } of cards) {
    const keys = keysById.get(String(c.id)) ?? [];
    if (keys.length === 0) continue;
    const g = [
      deviceOf(c),
      normalizeCountry(str(c["country"])).toLowerCase(),
      str(c["generation"]),
      keys.map(keyText).sort().join("+"),
    ].join("#");
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const c of members) {
      issues.push({
        id: `duplicate:${String(c.id)}:`,
        rule: "duplicate",
        level: "warning",
        cardId: String(c.id),
        country: str(c["country"]),
        deviceType: deviceOf(c),
        generation: str(c["generation"]),
        typeApproval: str(c["type_approval_number"]),
        manufacturer: str(c["current_manufacturer"]),
        message: `${members.length} records for the same device type, country, generation and approval — keep one`,
        safe: false,
      });
    }
  }

  // ---- JRC entries without a record
  const seen = new Set<string>();
  for (const { l, keys } of listing) {
    if (keys.length === 0) continue;
    const covered = cards.some(
      ({ c }) =>
        deviceOf(c) === l.device_type &&
        (keysById.get(String(c.id)) ?? []).some((k) => keys.some((lk) => keysMatch(k, lk))),
    );
    if (covered) continue;
    const key = `${l.device_type}|${keys.map(keyText).sort().join("+")}|${l.generation}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push({
      id: `jrc_without_record:${key}`,
      rule: "jrc_without_record",
      level: "info",
      cardId: null,
      country: "",
      deviceType: l.device_type,
      generation: l.generation,
      typeApproval: l.raw_type_approval,
      manufacturer: l.manufacturer,
      message: `${l.card_name || l.device_type}${l.jrc_date ? ` (${l.jrc_date})` : ""} — on the JRC list, not in Data`,
      safe: false,
      jrc: l,
    });
  }

  return issues;
}

export function summariseConsistency(
  records: number,
  listingRows: number,
  issues: ConsistencyIssue[],
): ConsistencySummary {
  const byRule: Record<string, number> = {};
  for (const i of issues) byRule[i.rule] = (byRule[i.rule] ?? 0) + 1;
  return {
    records,
    listingRows,
    issues: issues.length,
    repairable: issues.filter((i) => i.fix).length,
    safe: issues.filter((i) => i.safe).length,
    byRule,
  };
}
