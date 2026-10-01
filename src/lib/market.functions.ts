import { createServerFn } from "@tanstack/react-start";
import { getCurrentListing as dbGetCurrentListing, type CurrentListingRow } from "@/lib/db.server";

// Read-only, like getCards/getOverrides in cards.functions.ts — the current
// listing is a public mirror of what JRC shows, not a manual edit surface.

export type CurrentListingData = CurrentListingRow & { updated_at: string };

export const getCurrentListing = createServerFn({ method: "GET" }).handler(async () => {
  return (await dbGetCurrentListing()) as CurrentListingData[];
});
