// v2.55: platform line table (see db/migrations/0009_platform_lines.sql).
// Local PostgreSQL only; the hosted backend gets an empty list, so the
// timeline then shows every certificate family as "not assigned".

import { eventsBackendAvailable, eventsQuery } from "@/lib/db.server";
import type { PlatformLine } from "@/lib/platform-timeline";

const clean = (list: unknown, max = 40): string[] =>
  Array.isArray(list)
    ? [
        ...new Set(
          list.map((v) => String(v ?? "").trim()).filter((v) => v.length > 0 && v.length <= 120),
        ),
      ].slice(0, max)
    : [];

export async function listPlatformLines(): Promise<PlatformLine[]> {
  if (!eventsBackendAvailable()) return [];
  try {
    return await eventsQuery<PlatformLine>(
      `SELECT id, name, vendor, families, patterns, note, sort
         FROM public.platform_lines ORDER BY sort, name`,
    );
  } catch {
    return []; // table missing (migration not applied yet)
  }
}

export async function savePlatformLine(line: Partial<PlatformLine>): Promise<PlatformLine> {
  if (!eventsBackendAvailable()) throw new Error("Platform lines need the local database");
  const name = String(line.name ?? "")
    .trim()
    .slice(0, 120);
  if (!name) throw new Error("A platform line needs a name");
  const values = [
    name,
    String(line.vendor ?? "")
      .trim()
      .slice(0, 120),
    clean(line.families),
    clean(line.patterns),
    String(line.note ?? "")
      .trim()
      .slice(0, 500),
    Number.isFinite(Number(line.sort)) ? Math.trunc(Number(line.sort)) : 0,
  ];
  // A family belongs to one line only: assigning it here removes it elsewhere.
  const families = values[2] as string[];
  const rows = line.id
    ? await eventsQuery<PlatformLine>(
        `UPDATE public.platform_lines
            SET name = $2, vendor = $3, families = $4, patterns = $5, note = $6, sort = $7, updated_at = now()
          WHERE id = $1
          RETURNING id, name, vendor, families, patterns, note, sort`,
        [line.id, ...values],
      )
    : await eventsQuery<PlatformLine>(
        `INSERT INTO public.platform_lines (name, vendor, families, patterns, note, sort)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, vendor, families, patterns, note, sort`,
        values,
      );
  const saved = rows[0];
  if (!saved) throw new Error("Platform line not found");
  if (families.length > 0) {
    await eventsQuery(
      `UPDATE public.platform_lines
          SET families = ARRAY(SELECT f FROM unnest(families) f WHERE NOT (f = ANY($2::text[]))),
              updated_at = now()
        WHERE id <> $1 AND families && $2::text[]`,
      [saved.id, families],
    );
  }
  return saved;
}

export async function deletePlatformLine(id: string): Promise<boolean> {
  if (!eventsBackendAvailable()) return false;
  const rows = await eventsQuery(`DELETE FROM public.platform_lines WHERE id = $1 RETURNING id`, [
    id,
  ]);
  return rows.length > 0;
}
