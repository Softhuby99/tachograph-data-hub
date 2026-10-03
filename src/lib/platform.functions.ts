import { createServerFn } from "@tanstack/react-start";
import { emitEvent, requireAdmin } from "@/lib/events.server";

// v2.55: platform lines. Reading is public (the timeline is part of Market
// Analytics); changing them is admin-only and checked on the server.

export const getPlatformLines = createServerFn({ method: "GET" }).handler(async () => {
  const { listPlatformLines } = await import("@/lib/platform-lines.server");
  return await listPlatformLines();
});

export const savePlatformLineFn = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      id?: string;
      name: string;
      vendor?: string;
      families?: string[];
      patterns?: string[];
      note?: string;
      sort?: number;
    }) => ({
      id: data?.id ? String(data.id) : undefined,
      name: String(data?.name ?? ""),
      vendor: String(data?.vendor ?? ""),
      families: Array.isArray(data?.families) ? data.families.map(String) : [],
      patterns: Array.isArray(data?.patterns) ? data.patterns.map(String) : [],
      note: String(data?.note ?? ""),
      sort: Number(data?.sort ?? 0),
    }),
  )
  .handler(async ({ data }) => {
    await requireAdmin("change platform lines");
    const { savePlatformLine } = await import("@/lib/platform-lines.server");
    const saved = await savePlatformLine(data);
    await emitEvent({
      level: "INFO",
      category: "action",
      code: "platform_line.saved",
      status: "success",
      trigger: "manual",
      actor: "local-admin",
      message: `Platform line "${saved.name}" saved (${saved.families.length} certificate famil${saved.families.length === 1 ? "y" : "ies"})`,
      details: { id: saved.id, families: saved.families, patterns: saved.patterns },
    });
    return saved;
  });

export const deletePlatformLineFn = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string }) => ({ id: String(data?.id ?? "") }))
  .handler(async ({ data }) => {
    await requireAdmin("delete platform line");
    const { deletePlatformLine } = await import("@/lib/platform-lines.server");
    const ok = await deletePlatformLine(data.id);
    if (ok) {
      await emitEvent({
        level: "INFO",
        category: "action",
        code: "platform_line.deleted",
        status: "success",
        trigger: "manual",
        actor: "local-admin",
        message: "Platform line deleted",
        details: { id: data.id },
      });
    }
    return { ok };
  });
