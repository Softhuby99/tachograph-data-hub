import { createServerFn } from "@tanstack/react-start";
import { adminAuth } from "@/lib/auth";
import { logActionFailure, requireAdmin } from "@/lib/events.server";

// v2.77: consistency check with repairs (Tools → Consistency). Admin only,
// checked on the server — a hidden tab is not the guard.

export const getConsistency = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin("read consistency check");
  const { computeConsistency } = await import("@/lib/consistency.server");
  return await computeConsistency();
});

export const applyConsistencyFixesFn = createServerFn({ method: "POST" })
  .middleware([adminAuth])
  .inputValidator((data: { ids?: string[]; allSafe?: boolean }) => ({
    ids: Array.isArray(data?.ids) ? data.ids.map((id) => String(id ?? "")).slice(0, 2000) : [],
    allSafe: data?.allSafe === true,
  }))
  .handler(async ({ data, context }) =>
    logActionFailure(
      "Apply consistency repairs",
      { details: { count: data.ids.length, allSafe: data.allSafe } },
      async () => {
        const { applyConsistencyFixes } = await import("@/lib/consistency.server");
        return applyConsistencyFixes(data, context?.userId ?? null);
      },
    ),
  );

export const proposeMissingJrcEntriesFn = createServerFn({ method: "POST" })
  .middleware([adminAuth])
  .inputValidator((data: { ids?: string[] }) => ({
    ids: Array.isArray(data?.ids) ? data.ids.map((id) => String(id ?? "")).slice(0, 2000) : [],
  }))
  .handler(async ({ data }) =>
    logActionFailure(
      "Propose JRC entries without a record",
      { details: { count: data.ids.length } },
      async () => {
        const { proposeMissingJrcEntries } = await import("@/lib/consistency.server");
        return proposeMissingJrcEntries(data.ids);
      },
    ),
  );
