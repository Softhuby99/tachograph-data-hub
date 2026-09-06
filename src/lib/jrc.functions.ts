import { createServerFn } from "@tanstack/react-start";
import { optionalAuth } from "@/lib/auth";
import {
  runUpdateCheck,
  runUpdateCheckForSource,
  approveProposal,
  rejectProposal,
} from "@/lib/jrc.server";
import { getAllProposals, getRecentCheckRuns } from "@/lib/db.server";

// ---- reads (public; no auth) ---------------------------------------------

export const getProposals = createServerFn({ method: "GET" }).handler(async () => {
  const { resolveTaCountry } = await import("@/lib/ta-country");
  const rows = await getAllProposals();
  // Older proposals were stored before country resolution existed — fill the
  // country in for display (the stored row is not modified).
  return rows.map((p) => {
    if (p.country) return p;
    const hit = resolveTaCountry(p.jrc_type_approval ?? "");
    const payload = (p.payload ?? {}) as Record<string, string>;
    const fromPayload = payload["Resolved country"] || payload["Certification country"] || "";
    const country = hit?.country || (fromPayload === "not derivable" ? "" : fromPayload);
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
  .handler(async ({ data }) => approveProposal(data.id, data.country));

export const rejectJrcProposal = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data }) => rejectProposal(data.id));
