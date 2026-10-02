import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/events.server";

// v2.53: data quality (Tools → Data quality). Admin-only, checked on the
// server — like the operations log, a hidden tab is not the guard.

export const getDataQuality = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin("read data quality");
  const { computeDataQuality } = await import("@/lib/data-quality.server");
  return await computeDataQuality();
});
