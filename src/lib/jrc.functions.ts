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
  return await getAllProposals();
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
