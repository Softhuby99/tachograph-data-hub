import { createServerFn } from "@tanstack/react-start";
import { optionalAuth } from "@/lib/auth";
import {
  getAllCards,
  getAllOverrides,
  getOverridePatch,
  saveOverride,
  deleteOverride,
} from "@/lib/db.server";

// Shared, database-backed manual edits of card fields.
// The original row in tachograph_cards stays untouched; the patch is merged on read.

// ---- reads (public; no auth) ---------------------------------------------

export const getCards = createServerFn({ method: "GET" }).handler(async () => {
  return await getAllCards();
});

export const getOverrides = createServerFn({ method: "GET" }).handler(async () => {
  return await getAllOverrides();
});

// ---- writes (optional auth) ---------------------------------------------

export const saveCardOverride = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { cardId: string; patch: Record<string, string> }) => ({
    cardId: String(data?.cardId ?? ""),
    patch: (data?.patch ?? {}) as Record<string, string>,
  }))
  .handler(async ({ data, context }) => {
    if (!data.cardId) throw new Error("Missing card id");

    const existing = await getOverridePatch(data.cardId);
    const merged = { ...(existing ?? {}), ...data.patch };

    if (Object.keys(merged).length === 0) {
      await deleteOverride(data.cardId);
      return { ok: true, cleared: true };
    }
    await saveOverride(
      data.cardId,
      merged,
      context?.userId ?? null,
    );
    return { ok: true, cleared: false };
  });

export const resetCardOverride = createServerFn({ method: "POST" })
  .middleware([optionalAuth])
  .inputValidator((data: { cardId: string }) => ({ cardId: String(data?.cardId ?? "") }))
  .handler(async ({ data }) => {
    await deleteOverride(data.cardId);
    return { ok: true };
  });
