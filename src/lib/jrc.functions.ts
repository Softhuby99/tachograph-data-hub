import { createServerFn } from "@tanstack/react-start";
import { optionalAuth } from "@/lib/auth";
import {
  runUpdateCheck,
  runUpdateCheckForSource,
  approveProposal,
  rejectProposal,
  reopenProposal,
} from "@/lib/jrc.server";
import { getAllProposals, getRecentCheckRuns, setProposalsReviewed } from "@/lib/db.server";
import { logActionFailure } from "@/lib/events.server";

// ---- reads (public; no auth) ---------------------------------------------

export const getProposals = createServerFn({ method: "GET" }).handler(async () => {
  const { documentedCountry } = await import("@/lib/ta-country");
  const { certificationCountry } = await import("@/lib/cc.server");
  const rows = await getAllProposals();
  // v2.54 (code review 16/17): live state of each pending field change — the
  // value a reader sees now, a manual edit on top, and whether the record
  // changed since the proposal was found. The approval re-checks all of it.
  const { getAllCards, getAllOverrides } = await import("@/lib/db.server");
  const { fieldStates } = await import("@/lib/jrc.server");
  const pendingWithCard = rows.filter((p) => p.status === "pending" && p.card_id);
  let live = new Map<string, ReturnType<typeof fieldStates>>();
  if (pendingWithCard.length > 0) {
    const [cards, overrides] = await Promise.all([getAllCards(), getAllOverrides()]);
    const cardById = new Map(cards.map((c) => [String(c["id"]), c]));
    const ovById = new Map(overrides.map((o) => [o.card_id, o.patch]));
    live = new Map(
      pendingWithCard.flatMap((p) => {
        const card = cardById.get(String(p.card_id));
        const fields = p.changes?.fields ?? [];
        if (!card || fields.length === 0) return [];
        return [[p.id, fieldStates(fields, card, ovById.get(String(p.card_id)) ?? null)] as const];
      }),
    );
  }
  // Older proposals were stored before country resolution existed — fill the
  // country in for display (the stored row is not modified). JRC entries
  // resolve via the e-number country list; Common Criteria entries via the
  // certification scheme / certificate prefix.
  return rows.map((p) => {
    if (p.country) return live.has(p.id) ? { ...p, live: live.get(p.id) } : p;
    const hit = documentedCountry(p.jrc_type_approval ?? "");
    const payload = (p.payload ?? {}) as Record<string, string>;
    const fromPayload = payload["Resolved country"] || payload["Certification country"] || "";
    let country = hit?.country || (fromPayload === "not derivable" ? "" : fromPayload);
    if (!country) {
      country = certificationCountry({
        scheme: payload["Scheme"],
        certificate: payload["Security certificate"],
      });
    }
    const withLive = live.has(p.id) ? { ...p, live: live.get(p.id) } : p;
    return country ? { ...withLive, country } : withLive;
  });
});

export const getCheckRuns = createServerFn({ method: "GET" }).handler(async () => {
  return await getRecentCheckRuns(20);
});

/** v2.53: schedule shown in the Update Monitor header (public, no log data). */
export const getScheduleInfo = createServerFn({ method: "GET" }).handler(async () => {
  const { schedulerStatus } = await import("@/lib/scheduler.server");
  const s = await schedulerStatus();
  return {
    available: s.available,
    enabled: s.enabled,
    time: s.time,
    timezone: s.timezone,
    nextRunAt: s.nextRunAt,
    running: s.running,
  };
});

// ---- writes (optional auth) ---------------------------------------------

export const checkUpdates = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .handler(async () =>
    logActionFailure("Update run", {}, async () => {
      const { withManualLease } = await import("@/lib/scheduler.server");
      return withManualLease(() => runUpdateCheck("manual"));
    }),
  );

export const checkUpdateSource = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { source: string }) => ({
    source: String(data?.source ?? ""),
  }))
  .handler(async ({ data }) =>
    logActionFailure(
      "Update source " + data.source,
      { details: { source: data.source } },
      async () => {
        // v2.53: refused while an automatic run holds the lease; holds a short
        // lease itself so the scheduler waits for a manual check.
        const { withManualLease } = await import("@/lib/scheduler.server");
        return withManualLease(() =>
          runUpdateCheckForSource(data.source as never, { trigger: "manual" }),
        );
      },
    ),
  );

export const approveJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator(
    (data: {
      id: string;
      country?: string;
      resolutions?: Record<string, "source" | "manual">;
      confirmStale?: boolean;
    }) => {
      const resolutions: Record<string, "source" | "manual"> = {};
      for (const [k, v] of Object.entries(data?.resolutions ?? {})) {
        if (/^[a-z_]{1,64}$/.test(k) && (v === "source" || v === "manual")) resolutions[k] = v;
      }
      return {
        id: String(data?.id ?? ""),
        country: String(data?.country ?? ""),
        resolutions,
        confirmStale: data?.confirmStale === true,
      };
    },
  )
  .handler(async ({ data, context }) =>
    logActionFailure(
      "Approve proposal",
      { proposalId: data.id, details: { country: data.country } },
      () =>
        approveProposal(data.id, data.country, context?.userId, {
          resolutions: data.resolutions,
          confirmStale: data.confirmStale,
        }),
    ),
  );

export const rejectJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data, context }) =>
    logActionFailure("Reject proposal", { proposalId: data.id }, () =>
      rejectProposal(data.id, context?.userId),
    ),
  );

/** Puts a handled proposal back on the pending list so it can be decided again. */
export const reopenJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data }) =>
    logActionFailure("Reopen proposal", { proposalId: data.id }, () => reopenProposal(data.id)),
  );

/**
 * Marks proposals as read, or clears the marker. Purely a progress marker for
 * working through the handled list — it changes no status and writes no card.
 */
export const markJrcProposalsReviewed = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { ids: string[]; reviewed?: boolean }) => ({
    ids: Array.isArray(data?.ids) ? data.ids.map((id) => String(id ?? "")) : [],
    reviewed: data?.reviewed !== false,
  }))
  .handler(async ({ data, context }) => {
    const count = await logActionFailure(
      "Mark proposals reviewed",
      { details: { count: data.ids.length } },
      () => setProposalsReviewed(data.ids, data.reviewed, context?.userId),
    );
    return { ok: true, count };
  });
