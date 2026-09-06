import { createServerFn } from "@tanstack/react-start";
import { optionalAuth } from "@/lib/auth";
import {
  getAllCards,
  getAllOverrides,
  getOverridePatch,
  saveOverride,
  deleteOverride,
  insertCard,
} from "@/lib/db.server";
import { flagEmoji, normalizeCountry } from "@/lib/country-flag";

// Shared, database-backed manual edits of card fields.
// The original row in tachograph_cards stays untouched; the patch is merged on read.

// ---- reads (public; no auth) ---------------------------------------------

type CardData = Record<string, string | number | null>;
type OverrideData = { card_id: string; patch: Record<string, string> };

export const getCards = createServerFn({ method: "GET" }).handler(async () => {
  return (await getAllCards()) as CardData[];
});

export const getOverrides = createServerFn({ method: "GET" }).handler(async () => {
  return (await getAllOverrides()) as OverrideData[];
});

// ---- writes (optional auth) ---------------------------------------------

export const saveCardOverride = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { cardId: string; patch: Record<string, string> }) => ({
    cardId: String(data?.cardId ?? ""),
    patch: (data?.patch ?? {}) as Record<string, string>,
  }))
  .handler(async ({ data, context }) => {
    if (!data.cardId) throw new Error("Missing card id");

    const existing = await getOverridePatch(data.cardId);
    const merged = { ...(existing ?? {}), ...data.patch };

    // Editing the country must also move the flag. Without this the override
    // changes the country while the card row keeps its old country_flag, and
    // the record shows the previous country's flag whenever the ISO lookup
    // misses (e.g. on a value with trailing whitespace).
    if (typeof merged["country"] === "string") {
      merged["country"] = normalizeCountry(merged["country"]);
      merged["country_flag"] = flagEmoji(merged["country"]);
    }

    if (Object.keys(merged).length === 0) {
      await deleteOverride(data.cardId);
      return { ok: true, cleared: true };
    }
    await saveOverride(data.cardId, merged, context?.userId ?? null);
    return { ok: true, cleared: false };
  });

export const resetCardOverride = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { cardId: string }) => ({ cardId: String(data?.cardId ?? "") }))
  .handler(async ({ data }) => {
    await deleteOverride(data.cardId);
    return { ok: true };
  });

// ---- CSV import ----------------------------------------------------------

const DB_COLUMNS = [
  "country",
  "country_flag",
  "generation",
  "application",
  "current_manufacturer",
  "current_manufacturer_normalized",
  "chip_platform_vendor",
  "security_certificate",
  "chip_certificate",
  "certificate_issued_date",
  "certificate_expiry_date",
  "type_approval_number",
  "certified_security_platform",
  "certificate_holder",
  "date_status",
  "issued_by_authority",
  "jrc_interoperability_status",
  "functional_certificate_lab",
  "security_certificate_lab",
  "tachograph_application_os",
  "distinction_from_manufacturer",
  "jrc_certificate_source",
  "primary_source",
  "latest_tender",
  "winner_contractor",
  "procurement_status",
  "procurement_scope",
  "tender_source",
  "verification_note",
  "data_reference_date",
];
const DATE_COLUMNS = new Set([
  "certificate_issued_date",
  "certificate_expiry_date",
  "data_reference_date",
]);

const matchKey = (r: Record<string, unknown>) =>
  [r["country"], r["type_approval_number"], r["generation"]]
    .map((v) =>
      String(v ?? "")
        .trim()
        .toLowerCase(),
    )
    .join("|");

/**
 * Imports rows coming from a CSV file. Existing rows (matched by id, or by
 * country + type approval number + generation) are updated through the shared
 * override table; unknown rows are inserted as new cards.
 */
export const importCards = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { rows: Record<string, string>[] }) => ({
    rows: Array.isArray(data?.rows) ? data.rows : [],
  }))
  .handler(async ({ data, context }) => {
    const cards = (await getAllCards()) as Record<string, unknown>[];
    const byId = new Map(cards.map((c) => [String(c["id"]), c]));
    const byKey = new Map(cards.map((c) => [matchKey(c), c]));
    const overrides = await getAllOverrides();
    const patchById = new Map(
      overrides.map((o) => [o.card_id, (o.patch ?? {}) as Record<string, string>]),
    );

    let updated = 0;
    let created = 0;
    let unchanged = 0;
    const errors: string[] = [];

    for (const [index, raw] of data.rows.entries()) {
      try {
        const row: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
          const value = String(v ?? "").trim();
          if (k === "id" || value === "") continue;
          row[k] = value;
        }
        const target =
          (raw["id"] && byId.get(String(raw["id"]).trim())) || byKey.get(matchKey(raw));

        if (target) {
          const id = String(target["id"]);
          const current = { ...target, ...(patchById.get(id) ?? {}) };
          const patch: Record<string, string> = {};
          for (const [k, v] of Object.entries(row)) {
            if (String(current[k] ?? "") !== v) patch[k] = v;
          }
          if (Object.keys(patch).length === 0) {
            unchanged++;
            continue;
          }
          const merged = { ...(patchById.get(id) ?? {}), ...patch };
          await saveOverride(id, merged, context?.userId ?? null);
          patchById.set(id, merged);
          updated++;
        } else {
          const insert: Record<string, unknown> = {};
          for (const col of DB_COLUMNS) {
            if (row[col] != null) insert[col] = row[col];
          }
          for (const col of DATE_COLUMNS) {
            const v = String(insert[col] ?? "");
            if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) delete insert[col];
          }
          if (!insert["country"]) {
            errors.push(`Row ${index + 2}: no country — skipped.`);
            continue;
          }
          await insertCard(insert);
          created++;
        }
      } catch (e) {
        errors.push(`Row ${index + 2}: ${(e as Error).message}`);
      }
    }

    return { updated, created, unchanged, errors };
  });
