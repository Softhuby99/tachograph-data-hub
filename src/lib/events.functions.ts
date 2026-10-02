import { createServerFn } from "@tanstack/react-start";
import {
  ackEvents,
  adminTokenMatches,
  emitEvent,
  eventOverview,
  exportEvents,
  listEvents,
  logAdminDenied,
  requestContext,
  requireAdmin,
  type EventFilter,
} from "@/lib/events.server";
import { envFlag } from "@/lib/env-flag";

// v2.52: operations log (Tools → Log). Every function here is admin-only and
// checks the token on the server; hiding the tab in the UI is not the guard.
// All are POST so nothing is cached by the browser or an intermediary.

function filterFrom(data: unknown): EventFilter {
  const d = (data ?? {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "")).slice(0, 10) : []);
  return {
    levels: list(d["levels"]),
    categories: list(d["categories"]),
    from: typeof d["from"] === "string" ? d["from"] : undefined,
    to: typeof d["to"] === "string" ? d["to"] : undefined,
    includeAcked: d["includeAcked"] === true,
    q: typeof d["q"] === "string" ? d["q"].slice(0, 100) : undefined,
    runId: typeof d["runId"] === "string" ? d["runId"] : undefined,
    limit: Number(d["limit"]) || 100,
    offset: Number(d["offset"]) || 0,
  };
}

/**
 * Admin login. "login": the user typed the token — success and failure are
 * logged. "session": silent re-check of a stored token on page load — only a
 * failure is logged (and the client then forgets the token).
 */
export const verifyAdminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { token: string; mode?: "login" | "session" }) => ({
    token: String(data?.token ?? ""),
    mode: data?.mode === "session" ? ("session" as const) : ("login" as const),
  }))
  .handler(async ({ data }) => {
    const ok = envFlag("AUTH_MODE") === "none" && adminTokenMatches(data.token);
    if (ok) {
      if (data.mode === "login") {
        const ctx = await requestContext();
        await emitEvent({
          level: "INFO",
          category: "auth",
          code: "auth.login.ok",
          status: "success",
          trigger: "manual",
          actor: "local-admin",
          message: "Admin login confirmed",
          clientIp: ctx.clientIp,
          userAgent: ctx.userAgent,
          requestId: ctx.requestId,
        });
      }
      return { ok: true };
    }
    if (data.mode === "login") {
      const ctx = await requestContext();
      await emitEvent({
        level: "WARN",
        category: "auth",
        code: "auth.login.failed",
        status: "denied",
        trigger: "manual",
        message: data.token ? "Admin login failed: wrong token" : "Admin login failed: empty token",
        clientIp: ctx.clientIp,
        userAgent: ctx.userAgent,
        requestId: ctx.requestId,
        httpStatus: 401,
      });
    } else {
      await logAdminDenied("stored admin token re-check", data.token);
    }
    // Slows down guessing a little; no lock-out (agreed 02.10.2026).
    await new Promise((r) => setTimeout(r, 400));
    return { ok: false };
  });

export const getEventLog = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => filterFrom(data))
  .handler(async ({ data }) => {
    await requireAdmin("read operations log");
    return await listEvents(data);
  });

export const getEventOverview = createServerFn({ method: "POST" }).handler(async () => {
  await requireAdmin("read log overview");
  return await eventOverview();
});

export const ackEventLog = createServerFn({ method: "POST" })
  .inputValidator((data: { ids: string[]; note?: string }) => ({
    ids: Array.isArray(data?.ids) ? data.ids.map((id) => String(id ?? "")).slice(0, 500) : [],
    note: String(data?.note ?? "").slice(0, 300),
  }))
  .handler(async ({ data }) => {
    await requireAdmin("acknowledge log entries");
    const count = await ackEvents(data.ids, data.note);
    return { ok: true, count };
  });

export const exportEventLog = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => filterFrom(data))
  .handler(async ({ data }) => {
    await requireAdmin("export operations log");
    const rows = await exportEvents(data);
    const ctx = await requestContext();
    await emitEvent({
      level: "INFO",
      category: "log",
      code: "log.export",
      status: "success",
      trigger: "manual",
      actor: "local-admin",
      message: `Operations log exported (${rows.length} entr${rows.length === 1 ? "y" : "ies"})`,
      requestId: ctx.requestId,
      details: { count: rows.length, filter: { ...data, limit: undefined, offset: undefined } },
    });
    return { exportedAt: new Date().toISOString(), count: rows.length, filter: data, events: rows };
  });
