// v2.53: data quality — server side. The list is computed on request (admin
// only, see quality.functions.ts); the log gets ONE summary entry after the
// daily automatic run, and only when the numbers changed since the last one.

import { getAllCards, getAllOverrides } from "@/lib/db.server";
import {
  checkCards,
  mergeOverrides,
  summarise,
  type QualityIssue,
  type QualitySummary,
} from "@/lib/data-quality";
import { emitEvent } from "@/lib/events.server";
import { getSetting, putSetting } from "@/lib/settings.server";

export async function computeDataQuality(): Promise<{
  computedAt: string;
  summary: QualitySummary;
  issues: QualityIssue[];
}> {
  const [cards, overrides] = await Promise.all([getAllCards(), getAllOverrides()]);
  const merged = mergeOverrides(cards, overrides);
  const issues = checkCards(merged);
  return { computedAt: new Date().toISOString(), summary: summarise(merged, issues), issues };
}

type StoredSummary = {
  errors: number;
  warnings: number;
  byRule: Record<string, number>;
  at: string;
};

/** jsonb returns keys sorted, so compare the counts, not the JSON text. */
function sameCounts(a: Record<string, number>, b: Record<string, number>): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0");

/** Writes the summary event when the counts changed since the last daily run. */
export async function recordQualitySummary(
  trigger: "scheduler" | "cron",
  runId?: string,
): Promise<QualitySummary> {
  const { summary } = await computeDataQuality();
  const last = await getSetting<StoredSummary | null>("data_quality_last", null);
  const changed =
    !last ||
    last.errors !== summary.errors ||
    last.warnings !== summary.warnings ||
    sameCounts(last.byRule ?? {}, summary.byRule) === false;
  if (changed) {
    // The first summary is a baseline (INFO); later ones warn when errors grew.
    const more = last ? summary.errors > last.errors : false;
    await emitEvent({
      level: more ? "WARN" : "INFO",
      category: "quality",
      code: "quality.summary.changed",
      status: "info",
      trigger,
      runId,
      message: last
        ? `Data quality: ${summary.errors} error(s) (${sign(summary.errors - last.errors)}), ` +
          `${summary.warnings} warning(s) (${sign(summary.warnings - last.warnings)}) ` +
          `in ${summary.records} records`
        : `Data quality baseline: ${summary.errors} error(s), ${summary.warnings} warning(s) in ${summary.records} records`,
      details: { ...summary, previous: last },
    });
  }
  await putSetting("data_quality_last", {
    errors: summary.errors,
    warnings: summary.warnings,
    byRule: summary.byRule,
    at: new Date().toISOString(),
  });
  return summary;
}
