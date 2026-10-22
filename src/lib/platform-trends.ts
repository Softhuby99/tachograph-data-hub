import type { TimelineLine } from "./platform-timeline";
import { approvalKeys } from "./market-status";
import { isoForCountry, normalizeCountry } from "./country-flag";

export const RELATIONS = ["in-house", "partner", "unknown"] as const;
export type Relation = (typeof RELATIONS)[number];
const aliases: Record<string, string> = {
  thales: "Thales",
  gemalto: "Thales",
  gemplus: "Thales",
  idemia: "IDEMIA",
  oberthur: "IDEMIA",
  morpho: "IDEMIA",
  "in smart identity": "IDEMIA",
  "in groupe": "IDEMIA",
  ingroupe: "IDEMIA",
  stmicroelectronics: "STMicroelectronics",
  "st microelectronics": "STMicroelectronics",
};
export function vendorName(value: string): string {
  const cleaned = value.trim().replace(/\s+/g, " ");
  const match = Object.keys(aliases).find(
    (a) => cleaned.toLowerCase() === a || cleaned.toLowerCase().startsWith(a + " "),
  );
  return match ? aliases[match] : cleaned;
}
export function buildPlatformTrends(lines: TimelineLine[]) {
  const excluded = new Set<string>();
  const entries = new Map<
    string,
    { vendor: string; country: string; year: number; relation: Relation }
  >();
  for (const line of lines)
    for (const a of line.all) {
      const vendor = vendorName(line.vendor);
      const keys = approvalKeys(a.typeApproval);
      // Several approval numbers cannot safely be paired with several countries.
      const bases = [...new Set(keys.map((k) => `${k.mark}:${k.series}:${k.number}`))];
      const countries = [
        ...new Set((isoForCountry(a.country) ? [a.country] : a.countries).map(normalizeCountry)),
      ];
      if (
        !line.assigned ||
        !vendor ||
        a.derived ||
        !a.date ||
        !Number.isFinite(a.date.getTime()) ||
        bases.length !== 1 ||
        !countries.length ||
        countries.some((c) => !isoForCountry(c))
      ) {
        excluded.add(a.cardId);
        continue;
      }
      const maker = vendorName(a.manufacturer);
      const relation: Relation = !maker
        ? "unknown"
        : maker.toLowerCase() === vendor.toLowerCase()
          ? "in-house"
          : "partner";
      for (const country of countries) {
        const key = JSON.stringify([vendor.toLowerCase(), country, a.generation, bases[0]]);
        const next = { vendor, country, year: a.date.getUTCFullYear(), relation };
        const old = entries.get(key);
        if (!old || next.year < old.year) entries.set(key, next);
        else if (next.year === old.year && old.relation !== relation) old.relation = "unknown";
      }
    }
  const events = [...entries.values()];
  const vendors = [...new Set(events.map((e) => e.vendor))].sort();
  const minYear = events.length
    ? Math.min(...events.map((e) => e.year))
    : new Date().getUTCFullYear();
  const maxYear = events.length ? Math.max(...events.map((e) => e.year)) : minYear;
  const rows: Record<string, number>[] = [];
  for (let year = minYear; year <= maxYear; year++) {
    const row: Record<string, number> = { year };
    vendors.forEach((vendor, i) => {
      const past = events.filter((e) => e.vendor === vendor && e.year <= year);
      row[`coverage${i}`] = new Set(past.map((e) => e.country)).size;
      row[`total${i}`] = past.length;
      RELATIONS.forEach((r) => {
        row[`new${i}-${r}`] = past.filter((e) => e.year === year && e.relation === r).length;
      });
    });
    rows.push(row);
  }
  return { rows, vendors, minYear, maxYear, excluded: excluded.size };
}
