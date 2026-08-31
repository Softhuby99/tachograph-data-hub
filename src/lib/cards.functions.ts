import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Shared, database-backed manual edits of card fields.
// The original row in tachograph_cards stays untouched; the patch is merged on read.

export const saveCardOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cardId: string; patch: Record<string, string> }) => ({
    cardId: String(data?.cardId ?? ""),
    patch: (data?.patch ?? {}) as Record<string, string>,
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    if (!data.cardId) throw new Error("Missing card id");

    const { data: existing, error: readError } = await supabase
      .from("tachograph_card_overrides")
      .select("patch")
      .eq("card_id", data.cardId)
      .maybeSingle();
    if (readError) throw new Error(readError.message);

    const merged = {
      ...((existing?.patch as Record<string, string> | null) ?? {}),
      ...data.patch,
    };

    if (Object.keys(merged).length === 0) {
      const { error } = await supabase
        .from("tachograph_card_overrides")
        .delete()
        .eq("card_id", data.cardId);
      if (error) throw new Error(error.message);
      return { ok: true, cleared: true };
    }

    const { error } = await supabase
      .from("tachograph_card_overrides")
      .upsert(
        { card_id: data.cardId, patch: merged, edited_by: userId },
        { onConflict: "card_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true, cleared: false };
  });

export const resetCardOverride = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { cardId: string }) => ({ cardId: String(data?.cardId ?? "") }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tachograph_card_overrides")
      .delete()
      .eq("card_id", data.cardId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
