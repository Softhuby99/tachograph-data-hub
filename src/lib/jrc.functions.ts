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

// ---- reads (public; no auth) ---------------------------------------------

export const getProposals = createServerFn({ method: "GET" }).handler(async () => {
  const { documentedCountry } = await import("@/lib/ta-country");
  const { certificationCountry } = await import("@/lib/cc.server");
  const rows = await getAllProposals();
  // Older proposals were stored before country resolution existed — fill the
  // country in for display (the stored row is not modified). JRC entries
  // resolve via the e-number country list; Common Criteria entries via the
  // certification scheme / certificate prefix.
  return rows.map((p) => {
    if (p.country) return p;
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
    return country ? { ...p, country } : p;
  });
});

export const getCheckRuns = createServerFn({ method: "GET" }).handler(async () => {
  return await getRecentCheckRuns(20);
});

// ---- writes (optional auth) ---------------------------------------------

export const checkUpdates = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .handler(async () => runUpdateCheck());

export const checkUpdateSource = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { source: string }) => ({
    source: String(data?.source ?? ""),
  }))
  .handler(async ({ data }) => runUpdateCheckForSource(data.source as never));

export const approveJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string; country?: string }) => ({
    id: String(data?.id ?? ""),
    country: String(data?.country ?? ""),
  }))
  .handler(async ({ data, context }) => approveProposal(data.id, data.country, context?.userId));

export const rejectJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data, context }) => rejectProposal(data.id, context?.userId));

/** Puts a handled proposal back on the pending list so it can be decided again. */
export const reopenJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data }) => reopenProposal(data.id));

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
    const count = await setProposalsReviewed(data.ids, data.reviewed, context?.userId);
    return { ok: true, count };
  });
