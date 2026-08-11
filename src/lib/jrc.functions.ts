import { createServerFn } from "@tanstack/react-start";
import {
  runUpdateCheck,
  approveProposal,
  rejectProposal,
} from "@/lib/jrc.server";

export const checkUpdates = createServerFn({ method: "POST" }).handler(
  async () => runUpdateCheck(),
);

export const approveJrcProposal = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; country?: string }) => ({
    id: String(data?.id ?? ""),
    country: String(data?.country ?? ""),
  }))
  .handler(async ({ data }) => approveProposal(data.id, data.country));

export const rejectJrcProposal = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data }) => rejectProposal(data.id));
